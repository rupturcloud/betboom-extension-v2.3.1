/**
 * BetBoom Event Store v2.0
 * =======================
 * SSoT (Single Source of Truth) de eventos do sistema.
 * Armazena histórico completo em IndexedDB com:
 *  - `seq` monotônico crescente persistido entre reloads
 *  - Índices por `roundId`, `seq`, `timestamp`, `eventType`/`type`
 *  - Pub/sub interno para assinantes (subscribe)
 *  - API nova (append / query / queryByRoundId / subscribe)
 *  - Backward compat: addEvent, queryByEventType, exportAll, getStats, clearAll
 *
 * Schema (v2):
 *  - Object store `events`:
 *      keyPath: 'id' (autoIncrement)
 *      campos persistidos:
 *        { id, type, payload, ts, seq, roundId,
 *          eventType, data, timestamp, traceId }   ← campos legados duplicados p/ compat
 *      índices: roundId, seq (unique), timestamp, eventType, type
 *  - Object store `_counters`:
 *      keyPath: 'name'
 *      registros: { name: 'seq', value: <number> }
 */

const EventStore = (() => {
  const PREFIX = '[EventStore]';
  const DB_NAME = 'betboom-event-store';
  const DB_VERSION = 2;
  const STORE_NAME = 'events';
  const COUNTERS_STORE = '_counters';
  const SEQ_COUNTER_KEY = 'seq';
  const MAX_EVENTS = 10000;

  let db = null;
  let isInitialized = false;
  let initPromise = null;

  // ────────────────────────────────────────────────────────────────────
  // Contador `seq` em memória (síncrono). Persistência é fire-and-forget.
  // ────────────────────────────────────────────────────────────────────
  let seqCounter = 0;
  let seqLoaded = false;

  // ────────────────────────────────────────────────────────────────────
  // Pub/sub
  //   subscribers: Map<type, Set<callback>>
  //   wildcard subscribers ficam em subscribers.get('*')
  // ────────────────────────────────────────────────────────────────────
  const subscribers = new Map();

  /**
   * Inicializar IndexedDB com migração de schema.
   */
  function initDB() {
    if (initPromise) return initPromise;

    initPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined' || !indexedDB) {
        console.warn(`${PREFIX} ⚠️ IndexedDB não disponível, usando fallback em memory`);
        resolve(null);
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error(`${PREFIX} ❌ Falha ao abrir IndexedDB:`, request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        db = request.result;
        isInitialized = true;
        console.log(`${PREFIX} ✅ IndexedDB inicializado (v${DB_VERSION})`);

        // Carregar contador `seq` do disco e sincronizar com maior seq de eventos
        bootstrapSeq()
          .then(() => {
            console.log(`${PREFIX} 🔢 seq inicial = ${seqCounter}`);
            resolve(db);
          })
          .catch((err) => {
            console.warn(`${PREFIX} ⚠️ Falha ao carregar seq, usando 0:`, err);
            seqLoaded = true;
            resolve(db);
          });
      };

      request.onupgradeneeded = (event) => {
        const database = event.target.result;
        const tx = event.target.transaction;

        // ── events store ──────────────────────────────────────────────
        let store;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          store = database.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
          store.createIndex('roundId', 'roundId', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('eventType', 'eventType', { unique: false });
          console.log(`${PREFIX} 📋 Object Store '${STORE_NAME}' criado`);
        } else {
          store = tx.objectStore(STORE_NAME);
        }

        // Adicionar índice `seq` (unique) se ainda não existir
        if (!store.indexNames.contains('seq')) {
          try {
            store.createIndex('seq', 'seq', { unique: true });
            console.log(`${PREFIX} 📋 Índice 'seq' adicionado`);
          } catch (e) {
            console.warn(`${PREFIX} ⚠️ Não foi possível criar índice 'seq' unique, tentando non-unique:`, e);
            try {
              store.createIndex('seq', 'seq', { unique: false });
            } catch (_) { /* ignore */ }
          }
        }

        // Adicionar índice `type` (novo nome canônico)
        if (!store.indexNames.contains('type')) {
          store.createIndex('type', 'type', { unique: false });
          console.log(`${PREFIX} 📋 Índice 'type' adicionado`);
        }

        // Reforço: índice por roundId pode não existir em bases muito antigas
        if (!store.indexNames.contains('roundId')) {
          store.createIndex('roundId', 'roundId', { unique: false });
          console.log(`${PREFIX} 📋 Índice 'roundId' adicionado`);
        }

        // ── counters store ────────────────────────────────────────────
        if (!database.objectStoreNames.contains(COUNTERS_STORE)) {
          database.createObjectStore(COUNTERS_STORE, { keyPath: 'name' });
          console.log(`${PREFIX} 📋 Object Store '${COUNTERS_STORE}' criado`);
        }
      };
    });

    return initPromise;
  }

  /**
   * Carrega `seq` do disco e, por segurança, reconcilia com o maior `seq`
   * já presente em `events`. Garante monotonia mesmo se o counter ficou
   * dessincronizado por falha de I/O em sessão anterior.
   */
  function bootstrapSeq() {
    return new Promise((resolve, reject) => {
      if (!db) {
        seqLoaded = true;
        resolve();
        return;
      }

      let counterValue = 0;
      let maxSeqInEvents = 0;
      let pending = 2;
      let errored = false;

      const done = () => {
        if (errored) return;
        if (--pending === 0) {
          seqCounter = Math.max(counterValue, maxSeqInEvents);
          seqLoaded = true;
          // Persistir o valor reconciliado (fire-and-forget)
          persistSeq(seqCounter);
          resolve();
        }
      };

      try {
        const tx = db.transaction([COUNTERS_STORE, STORE_NAME], 'readonly');

        const counterReq = tx.objectStore(COUNTERS_STORE).get(SEQ_COUNTER_KEY);
        counterReq.onsuccess = () => {
          if (counterReq.result && typeof counterReq.result.value === 'number') {
            counterValue = counterReq.result.value;
          }
          done();
        };
        counterReq.onerror = () => done();

        // Pega maior seq existente (último item do índice)
        try {
          const seqIndex = tx.objectStore(STORE_NAME).index('seq');
          const cursorReq = seqIndex.openCursor(null, 'prev');
          cursorReq.onsuccess = (ev) => {
            const cursor = ev.target.result;
            if (cursor && typeof cursor.value.seq === 'number') {
              maxSeqInEvents = cursor.value.seq;
            }
            done();
          };
          cursorReq.onerror = () => done();
        } catch (_) {
          // índice ainda pode não existir em sessão de migração
          done();
        }
      } catch (e) {
        errored = true;
        reject(e);
      }
    });
  }

  /**
   * Persiste contador `seq` no store `_counters` (fire-and-forget).
   */
  function persistSeq(value) {
    if (!db) return;
    try {
      const tx = db.transaction([COUNTERS_STORE], 'readwrite');
      const store = tx.objectStore(COUNTERS_STORE);
      store.put({ name: SEQ_COUNTER_KEY, value });
    } catch (e) {
      console.warn(`${PREFIX} ⚠️ Falha ao persistir seq:`, e);
    }
  }

  /**
   * Gera próximo `seq` de forma síncrona e atômica em escopo JS single-thread.
   * Como JS roda single-threaded, dois `append` paralelos jamais conseguem
   * pegar o mesmo número (a operação `++seqCounter` é indivisível).
   */
  function nextSeq() {
    return ++seqCounter;
  }

  // ────────────────────────────────────────────────────────────────────
  // Pub/sub
  // ────────────────────────────────────────────────────────────────────

  /**
   * Inscreve callback para tipo(s) de evento.
   * @param {string|string[]} eventTypes - tipo único, array, ou '*' p/ todos.
   * @param {(event:object)=>void} callback
   * @returns {()=>void} função unsubscribe
   */
  function subscribe(eventTypes, callback) {
    if (typeof callback !== 'function') {
      console.warn(`${PREFIX} ⚠️ subscribe: callback inválido`);
      return () => {};
    }

    const types = normalizeTypes(eventTypes);
    const registered = [];

    for (const t of types) {
      if (!subscribers.has(t)) subscribers.set(t, new Set());
      subscribers.get(t).add(callback);
      registered.push(t);
    }

    return function unsubscribe() {
      for (const t of registered) {
        const set = subscribers.get(t);
        if (set) {
          set.delete(callback);
          if (set.size === 0) subscribers.delete(t);
        }
      }
    };
  }

  function normalizeTypes(eventTypes) {
    if (eventTypes === '*' || eventTypes == null) return ['*'];
    if (Array.isArray(eventTypes)) {
      const out = eventTypes.filter((t) => typeof t === 'string' && t.length > 0);
      return out.length ? out : ['*'];
    }
    if (typeof eventTypes === 'string') return [eventTypes];
    return ['*'];
  }

  /**
   * Notifica assinantes (async-safe, isolado por try/catch).
   */
  function notifySubscribers(event) {
    // Despacha no microtask p/ não bloquear append
    queueMicrotask(() => {
      const targets = new Set();
      const exact = subscribers.get(event.type);
      if (exact) exact.forEach((cb) => targets.add(cb));
      const wildcard = subscribers.get('*');
      if (wildcard) wildcard.forEach((cb) => targets.add(cb));

      for (const cb of targets) {
        try {
          cb(event);
        } catch (e) {
          console.error(`${PREFIX} ❌ Subscriber lançou exceção:`, e);
        }
      }
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // API nova: append
  // ────────────────────────────────────────────────────────────────────

  /**
   * Sanitiza payload p/ garantir serialização (sem funções, sem DOM, sem refs circulares).
   */
  function safeSerialize(payload) {
    try {
      // structuredClone é o padrão moderno; cai em JSON em fallback.
      if (typeof structuredClone === 'function') {
        return structuredClone(payload);
      }
    } catch (_) { /* fallback abaixo */ }
    try {
      return JSON.parse(JSON.stringify(payload, (_k, v) => {
        if (typeof v === 'function') return undefined;
        if (v && typeof v === 'object' && v.nodeType && v.nodeName) return undefined; // DOM
        return v;
      }));
    } catch (e) {
      console.warn(`${PREFIX} ⚠️ payload não serializável, gravando string fallback:`, e);
      return { _unserializable: true, repr: String(payload) };
    }
  }

  /**
   * Append novo evento.
   *
   * @param {string} type
   * @param {object} payload
   * @returns {{ seq:number, persistedAt:number }}  síncrono no `seq`
   *
   * Observação: a gravação em IndexedDB é fire-and-forget (não bloqueia).
   * O `seq` retornado já é único e monotônico crescente.
   */
  function append(type, payload) {
    if (!seqLoaded) {
      // Caso muito raro: chamado antes do bootstrap. Usa contador atual mesmo assim;
      // o bootstrap só sobe o valor (Math.max), então não há colisão real.
      console.warn(`${PREFIX} ⚠️ append chamado antes do bootstrap completar`);
    }

    const seq = nextSeq();
    const ts = Date.now();
    const cleanPayload = safeSerialize(payload || {});
    const roundId = (cleanPayload && cleanPayload.roundId) || null;

    const event = {
      // Campos canônicos novos
      type,
      payload: cleanPayload,
      ts,
      seq,
      roundId,
      // Campos legados (backward compat com leitores antigos)
      eventType: type,
      data: cleanPayload,
      timestamp: ts,
      traceId: (cleanPayload && cleanPayload.traceId) ||
               `event-${ts}-${Math.random().toString(16).slice(2, 8)}`
    };

    // Persistência fire-and-forget
    persistEvent(event);

    // Persistir contador (também fire-and-forget, a cada N por economia? simples: sempre)
    persistSeq(seq);

    // Notificar assinantes
    notifySubscribers(event);

    return { seq, persistedAt: ts };
  }

  function persistEvent(event) {
    if (!db) {
      console.warn(`${PREFIX} ⚠️ IndexedDB indisponível, evento não persistido (seq=${event.seq})`);
      return;
    }
    try {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.add(event);

      request.onsuccess = () => {
        // Limpeza assíncrona
        cleanupIfNeeded();
      };
      request.onerror = () => {
        console.error(`${PREFIX} ❌ Erro ao armazenar evento (seq=${event.seq}):`, request.error);
      };
    } catch (e) {
      console.error(`${PREFIX} ❌ Exceção ao persistir (seq=${event.seq}):`, e);
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // API legada: addEvent — redireciona para append
  // ────────────────────────────────────────────────────────────────────
  async function addEvent(eventType, data) {
    await initDB().catch(() => {});
    const { seq, persistedAt } = append(eventType, data);
    return { ok: true, seq, persistedAt };
  }

  // ────────────────────────────────────────────────────────────────────
  // Limpeza
  // ────────────────────────────────────────────────────────────────────
  async function cleanupIfNeeded() {
    if (!db) return;
    return new Promise((resolve) => {
      try {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.count();
        request.onsuccess = () => {
          if (request.result > MAX_EVENTS) {
            console.log(`${PREFIX} 🧹 Limpando eventos (${request.result} > ${MAX_EVENTS})`);
            deleteOldestEvents(request.result - MAX_EVENTS);
          }
          resolve();
        };
        request.onerror = () => resolve();
      } catch (_) {
        resolve();
      }
    });
  }

  async function deleteOldestEvents(count) {
    if (!db) return;
    return new Promise((resolve) => {
      try {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        // Apaga os mais antigos por `seq` (mais correto que por timestamp em corrida)
        const index = store.index('seq');
        index.openCursor(null, 'next').onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor && count > 0) {
            cursor.delete();
            count--;
            cursor.continue();
          }
        };
        transaction.oncomplete = () => {
          console.log(`${PREFIX} ✅ Limpeza concluída`);
          resolve();
        };
        transaction.onerror = () => resolve();
      } catch (_) {
        resolve();
      }
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // API nova: queryByRoundId (ordenado por seq ASC)
  // ────────────────────────────────────────────────────────────────────
  async function queryByRoundId(roundId) {
    await initDB().catch(() => {});
    if (!db) return [];
    if (roundId == null) return [];

    return new Promise((resolve) => {
      try {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const index = store.index('roundId');
        const request = index.getAll(roundId);
        request.onsuccess = () => {
          const out = (request.result || []).slice().sort((a, b) => (a.seq || 0) - (b.seq || 0));
          resolve(out);
        };
        request.onerror = () => {
          console.error(`${PREFIX} ❌ queryByRoundId failed:`, request.error);
          resolve([]);
        };
      } catch (e) {
        console.error(`${PREFIX} ❌ queryByRoundId exception:`, e);
        resolve([]);
      }
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // API nova: query(type, filters)
  // ────────────────────────────────────────────────────────────────────
  /**
   * @param {string|string[]} type
   * @param {{ since?:number, until?:number, roundId?:string, limit?:number }} [filters]
   * @returns {Promise<object[]>}
   */
  async function query(type, filters) {
    await initDB().catch(() => {});
    if (!db) return [];

    const types = type === '*' || type == null
      ? null
      : (Array.isArray(type) ? type.filter((t) => typeof t === 'string') : [type]);
    const f = filters || {};

    return new Promise((resolve) => {
      try {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);

        // Estratégia: se filtro principal é roundId, usa índice roundId.
        // Senão, se há um único type, usa índice type. Senão, pega tudo.
        let request;
        if (f.roundId) {
          request = store.index('roundId').getAll(f.roundId);
        } else if (types && types.length === 1) {
          // Tenta índice 'type' (canônico) e cai p/ 'eventType' (legado)
          let idx;
          try { idx = store.index('type'); } catch (_) { idx = null; }
          if (!idx) {
            try { idx = store.index('eventType'); } catch (_) { idx = null; }
          }
          request = idx ? idx.getAll(types[0]) : store.getAll();
        } else {
          request = store.getAll();
        }

        request.onsuccess = () => {
          let out = request.result || [];

          if (types && types.length) {
            const set = new Set(types);
            out = out.filter((e) => set.has(e.type) || set.has(e.eventType));
          }
          if (typeof f.since === 'number') {
            out = out.filter((e) => (e.ts || e.timestamp || 0) >= f.since);
          }
          if (typeof f.until === 'number') {
            out = out.filter((e) => (e.ts || e.timestamp || 0) <= f.until);
          }

          out.sort((a, b) => (a.seq || 0) - (b.seq || 0));

          if (typeof f.limit === 'number' && f.limit >= 0) {
            out = out.slice(0, f.limit);
          }
          resolve(out);
        };
        request.onerror = () => {
          console.error(`${PREFIX} ❌ query failed:`, request.error);
          resolve([]);
        };
      } catch (e) {
        console.error(`${PREFIX} ❌ query exception:`, e);
        resolve([]);
      }
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // API legada: queryByEventType
  // ────────────────────────────────────────────────────────────────────
  async function queryByEventType(eventType) {
    return query(eventType);
  }

  // ────────────────────────────────────────────────────────────────────
  // Export / stats / clear (legado)
  // ────────────────────────────────────────────────────────────────────
  async function exportAll() {
    await initDB().catch(() => {});
    if (!db) return [];
    return new Promise((resolve) => {
      try {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();
        request.onsuccess = () => {
          const out = (request.result || []).slice().sort((a, b) => (a.seq || 0) - (b.seq || 0));
          resolve(out);
        };
        request.onerror = () => resolve([]);
      } catch (_) {
        resolve([]);
      }
    });
  }

  async function getStats() {
    await initDB().catch(() => {});
    if (!db) return { available: false };
    return new Promise((resolve) => {
      try {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.count();
        request.onsuccess = () => {
          resolve({
            available: true,
            totalEvents: request.result,
            dbName: DB_NAME,
            dbVersion: DB_VERSION,
            maxEvents: MAX_EVENTS,
            currentSeq: seqCounter,
            subscribers: Array.from(subscribers.entries()).reduce((acc, [k, v]) => {
              acc[k] = v.size;
              return acc;
            }, {})
          });
        };
        request.onerror = () => resolve({ available: false });
      } catch (_) {
        resolve({ available: false });
      }
    });
  }

  async function clearAll() {
    await initDB().catch(() => {});
    if (!db) return;
    return new Promise((resolve) => {
      try {
        const transaction = db.transaction([STORE_NAME, COUNTERS_STORE], 'readwrite');
        transaction.objectStore(STORE_NAME).clear();
        transaction.objectStore(COUNTERS_STORE).clear();
        transaction.oncomplete = () => {
          seqCounter = 0;
          console.log(`${PREFIX} 🗑️ Todos os eventos e contadores foram removidos`);
          resolve();
        };
        transaction.onerror = () => resolve();
      } catch (_) {
        resolve();
      }
    });
  }

  // Public API
  return {
    // núcleo
    init: initDB,
    // API nova (SSoT)
    append,
    query,
    queryByRoundId,
    subscribe,
    // API legada (backward compat)
    addEvent,
    queryByEventType,
    exportAll,
    getStats,
    clearAll
  };
})();

// Auto-inicializar
if (typeof window !== 'undefined') {
  EventStore.init().then(() => {
    window.EventStore = EventStore;
    console.log('[EventStore] ✅ Módulo carregado e inicializado (v2 SSoT)');
  }).catch((err) => {
    console.warn('[EventStore] ⚠️ Falha na inicialização:', err);
    window.EventStore = EventStore;
  });
}

/* ────────────────────────────────────────────────────────────────────
 * EXEMPLO DE USO (não executar — apenas referência):
 *
 *   // 1) Append síncrono (retorna seq imediato)
 *   const { seq, persistedAt } = EventStore.append('round.started', {
 *     roundId: 'R-2026-05-14-001',
 *     dealer: 'Ana',
 *     ts: Date.now()
 *   });
 *   console.log('seq atribuído =', seq);
 *
 *   // 2) Query por roundId (Promise<Event[]> ordenado por seq ASC)
 *   const eventos = await EventStore.queryByRoundId('R-2026-05-14-001');
 *   console.table(eventos);
 *
 *   // 3) Subscribe (com unsubscribe)
 *   const off = EventStore.subscribe(['round.started', 'round.ended'], (ev) => {
 *     console.log('[live]', ev.type, ev.seq, ev.payload);
 *   });
 *   // ...mais tarde
 *   off();
 *
 *   // 4) Subscribe wildcard
 *   const offAll = EventStore.subscribe('*', (ev) => console.log('ANY:', ev.type));
 *
 *   // 5) Query com filtros
 *   const recentes = await EventStore.query(
 *     ['round.started', 'bet.placed'],
 *     { since: Date.now() - 60_000, limit: 50 }
 *   );
 * ──────────────────────────────────────────────────────────────────── */
