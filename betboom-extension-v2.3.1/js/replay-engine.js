/**
 * BetBoom Replay Engine v2.3 — READ-ONLY
 * ======================================
 * Modulo de replay deterministico para auditoria e debug de rodadas passadas.
 * Reconstroi a linha do tempo de uma rodada a partir do EventStore (SSoT)
 * SEM executar cliques reais — apenas reproduz o que aconteceu.
 *
 * ATENCAO (READ-ONLY):
 *   - Nao escreve no storage primario.
 *   - Nao toca no DOM.
 *   - Propaga `simulacao=true` e `executionMode='replay'` via `window.__replayContext`.
 *
 * Fonte canonica (SSoT):
 *   - EventStore.queryByRoundId(roundId)      // canal primario
 *   - EventStore.query(type, filters)         // listagens
 *   - EventStore.subscribe(types, callback)   // invalidacao de cache
 *
 * Fonte secundaria (apenas indice opcional, NUNCA primaria):
 *   - EvidenceEngine.queryByRoundId           // tolerado se presente, ignorado se ausente
 *
 * API publica:
 *   - async replayRound(roundId, options)
 *   - async reconstruirTimeline(roundId)            // alias compat
 *   - async listarRodadasDisponiveis(limit)         // alias compat
 *   - async compararRodadas(a, b) / compareRounds(a, b)
 *   - async exportarRodada(roundId) / exportTimeline(roundId, format)
 *   - getReplayCache(roundId), invalidateCache(roundId?)
 *   - subscribeReplayEvents(cb): unsubscribe
 *   - attachEventStore(eventStore)
 *   - getStatus()
 *
 * Eventos emitidos no barramento interno (subscribeReplayEvents):
 *   - replay_started, replay_step, replay_completed,
 *   - replay_anomaly_detected, replay_divergence, replay_failed
 *
 * Conformidade:
 *   - Async-safe (varios replays simultaneos suportados)
 *   - Read-only: assertion runtime + header acima
 *   - Logs com prefixo [ReplayEngine]
 */

const ReplayEngine = (() => {
  const PREFIX = '[ReplayEngine]';
  const VERSAO = '2.3';

  // ===========================================================================
  // READ-ONLY assertion
  // ===========================================================================
  const READ_ONLY = Object.freeze({ enabled: true, motivo: 'replay-engine v2.3 read-only' });

  /**
   * Erro lancado quando EventStore (SSoT) nao esta disponivel para operacoes
   * que exigem rigor maximo (ex.: replayToCalibration).
   */
  class ReplayEngineUnavailableError extends Error {
    constructor(mensagem) {
      super(mensagem || 'EventStore indisponivel; replay nao pode prosseguir');
      this.name = 'ReplayEngineUnavailableError';
    }
  }

  // Tipos de evento canonicos (normalizados a partir das duas fontes)
  const TIPOS_CONHECIDOS = Object.freeze({
    PATTERN_DETECTED: 'pattern_detected',
    DECISION_MADE: 'decision_made',
    CLICK_EXECUTED: 'click_executed',
    RESULT_CONFIRMED: 'result_confirmed',
    PHASE_CHANGE: 'phase_change',
    LIFECYCLE_EVENT: 'lifecycle_event',
    SUGGESTION: 'suggestion_made',
    CHIP_DETECTED: 'chip_detected',
    TARGET_DETECTED: 'target_detected',
    ERROR: 'error_recorded',
    ROUND_START: 'rodada_iniciada',
    UNKNOWN: 'unknown'
  });

  // Mapeamento de tipos brutos (varios sinonimos) -> tipo canonico
  const MAPA_TIPOS = Object.freeze({
    pattern_detected: TIPOS_CONHECIDOS.PATTERN_DETECTED,
    pattern: TIPOS_CONHECIDOS.PATTERN_DETECTED,
    decision_made: TIPOS_CONHECIDOS.DECISION_MADE,
    decision: TIPOS_CONHECIDOS.DECISION_MADE,
    decision_taken: TIPOS_CONHECIDOS.DECISION_MADE,
    click_executed: TIPOS_CONHECIDOS.CLICK_EXECUTED,
    click: TIPOS_CONHECIDOS.CLICK_EXECUTED,
    result_confirmed: TIPOS_CONHECIDOS.RESULT_CONFIRMED,
    confirmation_received: TIPOS_CONHECIDOS.RESULT_CONFIRMED,
    result: TIPOS_CONHECIDOS.RESULT_CONFIRMED,
    phase_change: TIPOS_CONHECIDOS.PHASE_CHANGE,
    phase: TIPOS_CONHECIDOS.PHASE_CHANGE,
    lifecycle_event: TIPOS_CONHECIDOS.LIFECYCLE_EVENT,
    lifecycle: TIPOS_CONHECIDOS.LIFECYCLE_EVENT,
    suggestion_made: TIPOS_CONHECIDOS.SUGGESTION,
    chip_detected: TIPOS_CONHECIDOS.CHIP_DETECTED,
    target_detected: TIPOS_CONHECIDOS.TARGET_DETECTED,
    error_recorded: TIPOS_CONHECIDOS.ERROR,
    error: TIPOS_CONHECIDOS.ERROR,
    rodada_iniciada: TIPOS_CONHECIDOS.ROUND_START
  });

  // Fases validas e transicoes aceitas (heuristica de fallback)
  const FASES_VALIDAS = ['idle', 'awaiting', 'betting', 'confirming', 'awaiting_result', 'finished'];
  const TRANSICOES_VALIDAS = Object.freeze({
    idle: ['awaiting', 'betting'],
    awaiting: ['betting', 'idle'],
    betting: ['confirming', 'awaiting_result', 'idle'],
    confirming: ['awaiting_result', 'betting', 'idle'],
    awaiting_result: ['finished', 'idle'],
    finished: ['idle', 'awaiting']
  });

  // Thresholds de anomalia (ms)
  const THRESHOLD_CLIQUE_DUPLICADO_MS = 250;
  const THRESHOLD_LATENCIA_DECISAO_CLIQUE_MS = 5000;

  // ===========================================================================
  // Estado interno
  // ===========================================================================

  // Mapa LRU verdadeiro: chave roundId -> entrada de cache
  const CACHE_LIMITE = 50;
  const cacheReplay = new Map(); // preserva ordem de uso (re-set move ao final)

  // LRU de replays em andamento (chave handle.id -> meta)
  const REPLAYS_LIMITE = 50;
  const replaysAtivos = new Map();
  let seqReplay = 0;

  // EventStore explicitamente anexado (overrides window.EventStore)
  let eventStoreRef = null;

  // Subscription de invalidacao
  let unsubscribeInvalidate = null;

  // Barramento interno de eventos do replay
  const listenersBarramento = new Set();

  // ===========================================================================
  // Barramento de eventos do replay (pub/sub interno)
  // ===========================================================================

  function emit(tipo, payload) {
    const evento = Object.assign({ tipo, ts: Date.now() }, payload || {});
    for (const cb of listenersBarramento) {
      try {
        cb(evento);
      } catch (e) {
        console.warn(`${PREFIX} listener barramento lancou:`, e && e.message);
      }
    }
    // Espelhamento opcional para EventStore se ele aceitar tipos custom (nao bloqueia).
    // Replay NUNCA escreve no EventStore primario; este caminho fica desativado por padrao.
    // (Mantido como hook futuro; intencional NO-OP para preservar read-only.)
  }

  function subscribeReplayEvents(cb) {
    if (typeof cb !== 'function') return () => {};
    listenersBarramento.add(cb);
    return () => listenersBarramento.delete(cb);
  }

  // ===========================================================================
  // EventStore — resolucao + subscribe para invalidacao
  // ===========================================================================

  function resolverEventStore() {
    if (eventStoreRef) return eventStoreRef;
    if (typeof window !== 'undefined' && window.EventStore) return window.EventStore;
    return null;
  }

  function eventStoreDisponivel() {
    const es = resolverEventStore();
    return !!(es && typeof es.queryByRoundId === 'function');
  }

  function attachEventStore(eventStore) {
    eventStoreRef = eventStore || null;
    // Re-arma subscription de invalidacao
    if (typeof unsubscribeInvalidate === 'function') {
      try { unsubscribeInvalidate(); } catch (_) { /* noop */ }
      unsubscribeInvalidate = null;
    }
    const es = resolverEventStore();
    if (es && typeof es.subscribe === 'function') {
      try {
        unsubscribeInvalidate = es.subscribe(
          Object.values(TIPOS_CONHECIDOS),
          (ev) => {
            const rid = ev && (ev.roundId || (ev.payload && ev.payload.roundId) || (ev.data && ev.data.roundId));
            if (rid) invalidateCache(rid);
          }
        );
      } catch (e) {
        console.warn(`${PREFIX} falha ao registrar subscribe de invalidacao:`, e && e.message);
      }
    }
    return !!es;
  }

  // ===========================================================================
  // Cache LRU
  // ===========================================================================

  function getReplayCache(roundId) {
    if (!roundId) return null;
    const entrada = cacheReplay.get(roundId);
    if (!entrada) return null;
    // Toque LRU: move para o final
    cacheReplay.delete(roundId);
    cacheReplay.set(roundId, entrada);
    return entrada;
  }

  function setReplayCache(roundId, valor) {
    if (!roundId) return;
    if (cacheReplay.has(roundId)) cacheReplay.delete(roundId);
    cacheReplay.set(roundId, valor);
    // Evicao LRU verdadeira: descarta o mais antigo (primeiro do Map)
    while (cacheReplay.size > CACHE_LIMITE) {
      const maisAntigo = cacheReplay.keys().next().value;
      if (maisAntigo === undefined) break;
      cacheReplay.delete(maisAntigo);
    }
  }

  function invalidateCache(roundId) {
    if (roundId == null) {
      cacheReplay.clear();
      return true;
    }
    return cacheReplay.delete(roundId);
  }

  // ===========================================================================
  // Helpers privados
  // ===========================================================================

  /**
   * Normaliza um evento bruto vindo do EventStore para formato unificado.
   * Aceita schema novo (append({type, payload}) -> {seq, persistedAt}).
   */
  function normalizarEvento(eventoBruto, origem) {
    if (!eventoBruto || typeof eventoBruto !== 'object') return null;

    const tipoBruto =
      eventoBruto.type ||
      eventoBruto.eventType ||
      eventoBruto.tipo ||
      'unknown';

    const tipoCanonico = MAPA_TIPOS[tipoBruto] || tipoBruto || TIPOS_CONHECIDOS.UNKNOWN;

    // Sequencia canonica (SSoT): seq > id ordenado. Timestamp eh apenas desempate.
    const seq =
      typeof eventoBruto.seq === 'number'
        ? eventoBruto.seq
        : (typeof eventoBruto.sequence === 'number' ? eventoBruto.sequence : null);

    // Timestamp pode estar em ISO string, number, ou persistedAt
    let ts =
      eventoBruto.persistedAt ||
      eventoBruto.timestamp ||
      eventoBruto.ts;
    if (typeof ts === 'string') {
      const parsed = Date.parse(ts);
      ts = isNaN(parsed) ? Date.now() : parsed;
    } else if (typeof ts !== 'number') {
      ts = Date.now();
    }

    const payload = eventoBruto.payload || eventoBruto.data || {};
    const roundId =
      eventoBruto.roundId ||
      (payload && payload.roundId) ||
      null;

    return {
      seq,
      tipo: tipoCanonico,
      tipoBruto,
      timestamp: ts,
      roundId,
      data: payload,
      traceId: eventoBruto.traceId || (payload && payload.traceId) || null,
      origem: origem || 'EventStore'
    };
  }

  /**
   * Le eventos do EventStore (SSoT) para um roundId especifico.
   * EvidenceEngine eh ignorada como fonte primaria.
   */
  async function lerEventosDoStorage(roundId) {
    const eventos = [];
    const es = resolverEventStore();

    if (!es || typeof es.queryByRoundId !== 'function') {
      console.warn(`${PREFIX} EventStore.queryByRoundId indisponivel — replay devolve vazio`);
      return eventos;
    }

    try {
      const lista = await es.queryByRoundId(roundId);
      if (Array.isArray(lista)) {
        for (const ev of lista) {
          const norm = normalizarEvento(ev, 'EventStore');
          if (norm) eventos.push(norm);
        }
      }
    } catch (e) {
      console.warn(`${PREFIX} falha lendo EventStore:`, e && e.message);
    }

    return eventos;
  }

  /**
   * Ordena eventos por `seq` ASC. Timestamp eh apenas desempate quando seq ausente.
   * ROUND_START vence em ultimo recurso.
   */
  function ordenarEventos(eventos) {
    return [...eventos].sort((a, b) => {
      const aSeq = a.seq;
      const bSeq = b.seq;
      const aTemSeq = typeof aSeq === 'number';
      const bTemSeq = typeof bSeq === 'number';

      if (aTemSeq && bTemSeq) {
        if (aSeq !== bSeq) return aSeq - bSeq;
      } else if (aTemSeq !== bTemSeq) {
        // Eventos com seq vem antes dos sem seq (mais confiaveis)
        return aTemSeq ? -1 : 1;
      }

      // Desempate por timestamp
      if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;

      // Desempate final: ROUND_START antes
      if (a.tipo === TIPOS_CONHECIDOS.ROUND_START && b.tipo !== TIPOS_CONHECIDOS.ROUND_START) return -1;
      if (b.tipo === TIPOS_CONHECIDOS.ROUND_START && a.tipo !== TIPOS_CONHECIDOS.ROUND_START) return 1;
      return 0;
    });
  }

  /**
   * Transforma a lista normalizada em steps com ordem e delta.
   */
  function construirSteps(eventosOrdenados) {
    const steps = [];
    let tsAnterior = null;
    for (let i = 0; i < eventosOrdenados.length; i++) {
      const ev = eventosOrdenados[i];
      const delta = tsAnterior == null ? 0 : Math.max(0, ev.timestamp - tsAnterior);
      steps.push({
        ordem: i + 1,
        seq: ev.seq,
        timestamp: ev.timestamp,
        tipo: ev.tipo,
        tipoBruto: ev.tipoBruto,
        data: ev.data,
        delta,
        origem: ev.origem,
        roundId: ev.roundId,
        traceId: ev.traceId
      });
      tsAnterior = ev.timestamp;
    }
    return steps;
  }

  /**
   * Deriva fases a partir de eventos `lifecycle_event` ou `phase_change`.
   * Substitui a heuristica paralela MAPA_TIPOS para fases.
   */
  function derivarFases(steps) {
    const transicoes = [];
    for (const s of steps) {
      if (s.tipo !== TIPOS_CONHECIDOS.LIFECYCLE_EVENT && s.tipo !== TIPOS_CONHECIDOS.PHASE_CHANGE) continue;
      const d = s.data || {};
      const para =
        d.para || d.to || d.novaFase || d.fase || d.phase || d.newPhase || null;
      const de =
        d.de || d.from || d.faseAnterior || d.previousPhase || null;
      if (para) {
        transicoes.push({ ordem: s.ordem, seq: s.seq, timestamp: s.timestamp, de, para });
      }
    }
    return transicoes;
  }

  /**
   * Identifica anomalias na linha do tempo em tempo O(n) usando indices por tipo.
   */
  function detectarAnomalias(steps) {
    const anomalias = [];

    // Indices por tipo (1 passada)
    const porTipo = new Map();
    for (const s of steps) {
      let bucket = porTipo.get(s.tipo);
      if (!bucket) {
        bucket = [];
        porTipo.set(s.tipo, bucket);
      }
      bucket.push(s);
    }

    const cliques = porTipo.get(TIPOS_CONHECIDOS.CLICK_EXECUTED) || [];
    const decisoes = porTipo.get(TIPOS_CONHECIDOS.DECISION_MADE) || [];

    // 1) Cliques duplicados — varredura linear no array ja ordenado, comparando vizinhos por alvo.
    const ultimoCliquePorAlvo = new Map();
    for (const cli of cliques) {
      const alvo = (cli.data && (cli.data.alvo || cli.data.target)) || null;
      if (!alvo) continue;
      const prev = ultimoCliquePorAlvo.get(alvo);
      if (prev) {
        const dt = Math.abs(cli.timestamp - prev.timestamp);
        if (dt <= THRESHOLD_CLIQUE_DUPLICADO_MS) {
          anomalias.push({
            tipo: 'clique_duplicado',
            mensagem: `Clique duplicado em "${alvo}" (delta ${dt}ms)`,
            ordens: [prev.ordem, cli.ordem],
            severidade: 'media'
          });
        }
      }
      ultimoCliquePorAlvo.set(alvo, cli);
    }

    // 2/3/4) Pareamento decisao <-> clique usando ponteiro avancado (O(n))
    // decisoes e cliques estao ordenados por seq/timestamp; rolamos um ponteiro de cliques.
    let pc = 0;
    for (const dec of decisoes) {
      // Avanca pc ate primeiro clique com timestamp >= dec.timestamp
      while (pc < cliques.length && cliques[pc].timestamp < dec.timestamp) pc++;
      const cliquePos = pc < cliques.length ? cliques[pc] : null;
      if (!cliquePos) {
        anomalias.push({
          tipo: 'decisao_sem_clique',
          mensagem: `Decisao na ordem ${dec.ordem} nao gerou clique`,
          ordens: [dec.ordem],
          severidade: 'alta'
        });
      } else {
        const latencia = cliquePos.timestamp - dec.timestamp;
        if (latencia > THRESHOLD_LATENCIA_DECISAO_CLIQUE_MS) {
          anomalias.push({
            tipo: 'latencia_alta',
            mensagem: `Latencia decisao->clique de ${latencia}ms (> ${THRESHOLD_LATENCIA_DECISAO_CLIQUE_MS}ms)`,
            ordens: [dec.ordem, cliquePos.ordem],
            severidade: 'media'
          });
        }
      }
    }

    // Cliques sem decisao previa
    let pd = 0;
    for (const cli of cliques) {
      // Avanca pd enquanto houver decisoes com timestamp <= cli.timestamp
      while (pd < decisoes.length && decisoes[pd].timestamp <= cli.timestamp) pd++;
      if (pd === 0) {
        anomalias.push({
          tipo: 'clique_sem_decisao',
          mensagem: `Clique na ordem ${cli.ordem} sem decisao previa`,
          ordens: [cli.ordem],
          severidade: 'alta'
        });
      }
    }

    // 5) Saltos de fase invalidos — usa derivarFases (lifecycle_event como fonte preferida)
    const transicoes = derivarFases(steps);
    let faseAtual = null;
    for (const t of transicoes) {
      const proxima = t.para;
      if (proxima && FASES_VALIDAS.indexOf(proxima) === -1) {
        anomalias.push({
          tipo: 'fase_desconhecida',
          mensagem: `Fase desconhecida "${proxima}" na ordem ${t.ordem}`,
          ordens: [t.ordem],
          severidade: 'baixa'
        });
      } else if (faseAtual && proxima) {
        const permitidas = TRANSICOES_VALIDAS[faseAtual] || [];
        if (permitidas.indexOf(proxima) === -1) {
          anomalias.push({
            tipo: 'salto_de_fase_invalido',
            mensagem: `Transicao invalida ${faseAtual} -> ${proxima} (ordem ${t.ordem})`,
            ordens: [t.ordem],
            severidade: 'alta'
          });
        }
      }
      if (proxima) faseAtual = proxima;
    }

    return anomalias;
  }

  /**
   * Gera sumario humano-legivel da rodada.
   */
  function gerarSumario(steps) {
    const contagem = steps.reduce((acc, s) => {
      acc[s.tipo] = (acc[s.tipo] || 0) + 1;
      return acc;
    }, {});

    const inicio = steps.length ? steps[0].timestamp : null;
    const fim = steps.length ? steps[steps.length - 1].timestamp : null;
    const duracaoMs = inicio && fim ? fim - inicio : 0;
    const fases = derivarFases(steps);

    return {
      totalSteps: steps.length,
      contagemPorTipo: contagem,
      inicio,
      fim,
      duracaoMs,
      fases
    };
  }

  /**
   * Espera ms milissegundos de forma assincrona.
   */
  function aguardar(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms | 0)));
  }

  /**
   * Registra replay ativo e retorna handle.
   */
  function abrirReplay(roundId, modo) {
    const id = `replay-${++seqReplay}-${Date.now().toString(36)}`;
    const meta = {
      id,
      roundId,
      modo,
      iniciadoEm: Date.now(),
      stepAtual: 0,
      totalSteps: 0,
      finalizado: false,
      finalizadoEm: null
    };
    replaysAtivos.set(id, meta);
    return meta;
  }

  /**
   * Marca replay como finalizado e faz evicao LRU real:
   * preferencia para remover entradas ja `finalizado=true` mais antigas
   * (em vez de simplesmente apagar a primeira do Map, o que poderia remover
   * um replay ativo).
   */
  function fecharReplay(id) {
    const meta = replaysAtivos.get(id);
    if (meta) {
      meta.finalizado = true;
      meta.finalizadoEm = Date.now();
    }
    if (replaysAtivos.size > REPLAYS_LIMITE) {
      let alvoKey = null;
      let alvoFinalizadoEm = Infinity;
      for (const [k, m] of replaysAtivos) {
        if (m.finalizado && typeof m.finalizadoEm === 'number' && m.finalizadoEm < alvoFinalizadoEm) {
          alvoFinalizadoEm = m.finalizadoEm;
          alvoKey = k;
        }
      }
      // Se nao ha finalizado para descartar, nao remove ninguem (mantem todos ativos).
      if (alvoKey) replaysAtivos.delete(alvoKey);
    }
  }

  /**
   * Garante contexto global de replay durante a execucao.
   */
  function instalarContextoReplay(ctx) {
    if (typeof window === 'undefined') return null;
    const anterior = window.__replayContext || null;
    window.__replayContext = Object.freeze({
      simulacao: !!ctx.simulacao,
      executionMode: ctx.executionMode || 'replay',
      roundId: ctx.roundId || null,
      replayId: ctx.replayId || null,
      readOnly: READ_ONLY.enabled
    });
    return anterior;
  }

  function restaurarContextoReplay(anterior) {
    if (typeof window === 'undefined') return;
    if (anterior === null || anterior === undefined) {
      try { delete window.__replayContext; } catch (_) { window.__replayContext = undefined; }
    } else {
      window.__replayContext = anterior;
    }
  }

  // ===========================================================================
  // API publica — replayRound
  // ===========================================================================

  /**
   * Reproduz uma rodada de forma deterministica.
   *
   * @param {string} roundId
   * @param {object} [options]
   * @param {boolean} [options.simulacao=true]            sempre verdadeiro em replay
   * @param {boolean} [options.replayToCalibration=false] se true exige EventStore disponivel
   * @param {number}  [options.fromStep]                  recorta a partir do step (1-based)
   * @param {number}  [options.toStep]                    recorta ate o step (1-based, inclusivo)
   * @param {number}  [options.speed=1]                   fator de velocidade (afeta stepDelay)
   * @param {number}  [options.stepDelay=500]             ms entre steps no modo visual
   * @param {function} [options.onStep]                   callback (step, contexto)
   * @param {('dry-run'|'visual'|'text')} [options.mode='dry-run']
   * @returns {Promise<{ok, roundId, steps, summary, anomalias, divergencias, duration, fromCache}>}
   */
  async function replayRound(roundId, options = {}) {
    const modo = options.mode || 'dry-run';
    const speed = typeof options.speed === 'number' && options.speed > 0 ? options.speed : 1;
    const stepDelayBase = typeof options.stepDelay === 'number' ? options.stepDelay : 500;
    const stepDelay = Math.max(0, Math.round(stepDelayBase / speed));
    const onStep = typeof options.onStep === 'function' ? options.onStep : null;
    const simulacao = options.simulacao !== false; // default true
    const replayToCalibration = !!options.replayToCalibration;
    const fromStep = Number.isInteger(options.fromStep) ? options.fromStep : null;
    const toStep = Number.isInteger(options.toStep) ? options.toStep : null;

    if (!roundId) {
      return {
        ok: false,
        erro: 'roundId obrigatorio',
        roundId: null,
        steps: [],
        anomalias: [],
        divergencias: [],
        duration: 0,
        fromCache: false
      };
    }

    // P0: bloqueia replayToCalibration se EventStore.queryByRoundId indisponivel
    if (replayToCalibration && !eventStoreDisponivel()) {
      const err = new ReplayEngineUnavailableError(
        'replayToCalibration requer EventStore.queryByRoundId disponivel'
      );
      console.error(`${PREFIX} ${err.message}`);
      emit('replay_failed', { replayId: null, roundId, erro: err.message });
      throw err;
    }

    const handle = abrirReplay(roundId, modo);
    const contextoAnterior = instalarContextoReplay({
      simulacao,
      executionMode: 'replay',
      roundId,
      replayId: handle.id
    });

    console.log(
      `${PREFIX} iniciando replay ${handle.id} (rodada=${roundId}, modo=${modo}, simulacao=${simulacao}, speed=${speed})`
    );

    try {
      // 1) Tentativa de cache
      const cached = getReplayCache(roundId);
      let steps;
      let fromCache = false;

      if (cached && Array.isArray(cached.steps)) {
        steps = cached.steps;
        fromCache = true;
      } else {
        const doStorage = await lerEventosDoStorage(roundId);
        const eventos = ordenarEventos(doStorage);
        steps = construirSteps(eventos);
        setReplayCache(roundId, { steps, geradoEm: Date.now() });
      }

      // Recorte fromStep/toStep (apos cache para reutilizar o conjunto integral)
      const stepsCompletos = steps;
      if (fromStep || toStep) {
        const ini = fromStep ? Math.max(1, fromStep) : 1;
        const fim = toStep ? Math.min(stepsCompletos.length, toStep) : stepsCompletos.length;
        steps = stepsCompletos.slice(ini - 1, fim);
      }

      handle.totalSteps = steps.length;

      const summary = gerarSumario(stepsCompletos);
      const anomalias = detectarAnomalias(stepsCompletos);

      emit('replay_started', {
        replayId: handle.id,
        roundId,
        totalSteps: steps.length,
        simulacao,
        ts: Date.now()
      });

      if (steps.length === 0) {
        console.warn(`${PREFIX} nenhum evento encontrado para rodada ${roundId}`);
        emit('replay_completed', {
          replayId: handle.id,
          roundId,
          duration: 0,
          stepsExecutados: 0,
          anomalias: anomalias.length,
          fromCache
        });
        return {
          ok: false,
          motivo: 'sem-eventos',
          roundId,
          steps: [],
          duration: 0,
          summary,
          anomalias,
          divergencias: [],
          fromCache
        };
      }

      const contextoOnStep = Object.freeze({
        replayId: handle.id,
        roundId,
        simulacao,
        executionMode: 'replay',
        readOnly: READ_ONLY.enabled
      });

      const inicioReplay = Date.now();

      if (modo === 'visual' || modo === 'text') {
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          handle.stepAtual = step.ordem;

          if (modo === 'text') {
            console.log(
              `${PREFIX} step ${step.ordem}/${stepsCompletos.length} tipo=${step.tipo} seq=${step.seq} ts=${step.timestamp} delta=${step.delta}ms`,
              step.data
            );
          }

          if (onStep) {
            try {
              await onStep(step, contextoOnStep);
            } catch (e) {
              console.warn(`${PREFIX} onStep lancou excecao no step ${step.ordem}:`, e && e.message);
            }
          }

          emit('replay_step', {
            replayId: handle.id,
            roundId,
            step,
            ordem: step.ordem,
            total: stepsCompletos.length
          });

          if (modo === 'visual' && i < steps.length - 1 && stepDelay > 0) {
            await aguardar(stepDelay);
          }
        }
      }
      // dry-run: nao chama onStep nem espera

      const duration = Date.now() - inicioReplay;

      console.log(
        `${PREFIX} replay ${handle.id} concluido: ${steps.length} steps em ${duration}ms, anomalias=${anomalias.length}, fromCache=${fromCache}`
      );

      // Emite anomalias detectadas
      for (const a of anomalias) {
        emit('replay_anomaly_detected', {
          replayId: handle.id,
          roundId,
          anomalia: a
        });
      }

      emit('replay_completed', {
        replayId: handle.id,
        roundId,
        duration,
        stepsExecutados: steps.length,
        anomalias: anomalias.length,
        fromCache
      });

      return {
        ok: true,
        roundId,
        modo,
        steps,
        duration,
        summary,
        anomalias,
        divergencias: [],
        fromCache
      };
    } catch (e) {
      console.error(`${PREFIX} falha no replay ${handle.id}:`, e && e.message);
      emit('replay_failed', { replayId: handle.id, roundId, erro: e && e.message });
      return {
        ok: false,
        erro: e && e.message,
        roundId,
        steps: [],
        anomalias: [],
        divergencias: [],
        duration: 0,
        fromCache: false
      };
    } finally {
      restaurarContextoReplay(contextoAnterior);
      fecharReplay(handle.id);
    }
  }

  // ===========================================================================
  // Timeline / Listagem / Diff / Export
  // ===========================================================================

  /**
   * Reconstroi a timeline da rodada sem reproduzir nada.
   */
  async function reconstruirTimeline(roundId) {
    if (!roundId) {
      return { roundId: null, eventos: [], inicio: null, fim: null };
    }
    const brutos = await lerEventosDoStorage(roundId);
    const eventos = ordenarEventos(brutos);
    const inicio = eventos.length ? eventos[0].timestamp : null;
    const fim = eventos.length ? eventos[eventos.length - 1].timestamp : null;
    return { roundId, eventos, inicio, fim };
  }

  /**
   * Lista rodadas disponiveis para replay usando EventStore (SSoT).
   * Tenta `EventStore.query` quando possivel; fallback para `exportAll`.
   */
  async function listarRodadasDisponiveis(limit = 50) {
    const lim = Math.max(1, Math.min(1000, limit | 0));
    const setIds = new Set();
    const ultimoTimestampPorRound = new Map();

    function registrar(roundId, ts) {
      if (!roundId) return;
      setIds.add(roundId);
      const atual = ultimoTimestampPorRound.get(roundId) || 0;
      if (ts > atual) ultimoTimestampPorRound.set(roundId, ts);
    }

    const es = resolverEventStore();
    if (!es) {
      console.warn(`${PREFIX} EventStore indisponivel — listarRodadasDisponiveis vazia`);
      return [];
    }

    try {
      let todos = null;
      if (typeof es.query === 'function') {
        // Sem filtro de tipo: retorna tudo
        todos = await es.query(null, {});
      } else if (typeof es.exportAll === 'function') {
        todos = await es.exportAll();
      }
      if (Array.isArray(todos)) {
        for (const ev of todos) {
          const rid = ev && (ev.roundId || (ev.payload && ev.payload.roundId) || (ev.data && ev.data.roundId));
          const tsBruto = ev && (ev.persistedAt || ev.timestamp || ev.ts);
          const ts = typeof tsBruto === 'number' ? tsBruto : (Date.parse(tsBruto) || 0);
          registrar(rid, ts);
        }
      }
    } catch (e) {
      console.warn(`${PREFIX} falha listando EventStore:`, e && e.message);
    }

    const lista = Array.from(setIds.values()).map((id) => ({
      roundId: id,
      ultimoEvento: ultimoTimestampPorRound.get(id) || 0
    }));
    lista.sort((a, b) => b.ultimoEvento - a.ultimoEvento);
    return lista.slice(0, lim);
  }

  /**
   * Compara duas rodadas e devolve divergencias + similaridade [0..1].
   */
  async function compareRounds(roundIdA, roundIdB) {
    if (!roundIdA || !roundIdB) {
      return { ok: false, erro: 'ambos roundIds obrigatorios', divergencias: [], similaridade: 0 };
    }

    const [tlA, tlB] = await Promise.all([
      reconstruirTimeline(roundIdA),
      reconstruirTimeline(roundIdB)
    ]);

    const tiposA = tlA.eventos.map((e) => e.tipo);
    const tiposB = tlB.eventos.map((e) => e.tipo);

    const divergencias = [];
    const tamMax = Math.max(tiposA.length, tiposB.length);
    let iguais = 0;
    for (let i = 0; i < tamMax; i++) {
      const a = tiposA[i];
      const b = tiposB[i];
      if (a === b && a !== undefined) {
        iguais++;
      } else {
        divergencias.push({
          ordem: i + 1,
          tipoA: a || null,
          tipoB: b || null,
          dataA: tlA.eventos[i] ? tlA.eventos[i].data : null,
          dataB: tlB.eventos[i] ? tlB.eventos[i].data : null
        });
      }
    }

    const similaridade = tamMax === 0 ? 1 : iguais / tamMax;

    emit('replay_divergence', {
      replayId: null,
      roundIdA,
      roundIdB,
      similaridade,
      divergencias
    });

    return {
      ok: true,
      roundIdA,
      roundIdB,
      tamanhoA: tiposA.length,
      tamanhoB: tiposB.length,
      divergencias,
      similaridade
    };
  }

  /**
   * Exporta a rodada nos formatos json (default) ou ndjson.
   */
  async function exportTimeline(roundId, format = 'json') {
    if (!roundId) return null;
    const timeline = await reconstruirTimeline(roundId);
    const steps = construirSteps(timeline.eventos);

    if (format === 'ndjson') {
      const linhas = [];
      const cabecalho = {
        tipo: '__meta__',
        versao: VERSAO,
        geradoEm: new Date().toISOString(),
        roundId,
        inicio: timeline.inicio,
        fim: timeline.fim,
        totalEventos: timeline.eventos.length
      };
      linhas.push(JSON.stringify(cabecalho));
      for (const ev of timeline.eventos) linhas.push(JSON.stringify(ev));
      return linhas.join('\n');
    }

    const payload = {
      versao: VERSAO,
      geradoEm: new Date().toISOString(),
      roundId,
      inicio: timeline.inicio,
      fim: timeline.fim,
      totalEventos: timeline.eventos.length,
      eventos: timeline.eventos,
      steps,
      summary: gerarSumario(steps),
      anomalias: detectarAnomalias(steps)
    };
    try {
      return JSON.stringify(payload, null, 2);
    } catch (e) {
      console.warn(`${PREFIX} falha serializando rodada ${roundId}:`, e && e.message);
      return null;
    }
  }

  /**
   * Status atual dos replays em andamento.
   */
  function getStatus() {
    const ativos = [];
    replaysAtivos.forEach((meta) => {
      if (!meta.finalizado) {
        ativos.push({
          id: meta.id,
          roundId: meta.roundId,
          modo: meta.modo,
          stepAtual: meta.stepAtual,
          totalSteps: meta.totalSteps,
          iniciadoEm: meta.iniciadoEm
        });
      }
    });
    return {
      versao: VERSAO,
      readOnly: READ_ONLY.enabled,
      eventStoreDisponivel: eventStoreDisponivel(),
      cacheTamanho: cacheReplay.size,
      cacheLimite: CACHE_LIMITE,
      replaysAtivos: ativos.length,
      detalhes: ativos,
      totalRegistrados: replaysAtivos.size
    };
  }

  // ===========================================================================
  // Inicializacao — tenta anexar EventStore global se ja existir
  // ===========================================================================
  if (typeof window !== 'undefined') {
    try { attachEventStore(window.EventStore || null); } catch (_) { /* noop */ }
  }

  // ===========================================================================
  // API publica
  // ===========================================================================
  return {
    // API nova
    replayRound,
    compareRounds,
    exportTimeline,
    getReplayCache,
    invalidateCache,
    subscribeReplayEvents,
    attachEventStore,
    getStatus,

    // Aliases backward-compat
    reconstruirTimeline,
    listarRodadasDisponiveis,
    compararRodadas: compareRounds,
    exportarRodada: (roundId) => exportTimeline(roundId, 'json'),

    // Constantes e tipos
    TIPOS: TIPOS_CONHECIDOS,
    READ_ONLY,
    ReplayEngineUnavailableError,
    VERSAO
  };
})();

// Expor no window para outros modulos
if (typeof window !== 'undefined') {
  window.ReplayEngine = ReplayEngine;
  console.log('[ReplayEngine] modulo carregado (v2.3 — replay deterministico read-only)');
}

/*
 * =============================================================================
 * Exemplo de uso
 * =============================================================================
 *
 *   // 0) Garantir EventStore anexado (opcional — auto-detecta window.EventStore)
 *   ReplayEngine.attachEventStore(window.EventStore);
 *
 *   // 1) Assinar eventos do barramento de replay
 *   const off = ReplayEngine.subscribeReplayEvents((ev) => console.log(ev.tipo, ev));
 *
 *   // 2) Listar rodadas com eventos persistidos
 *   const rodadas = await ReplayEngine.listarRodadasDisponiveis(20);
 *
 *   // 3) Reconstruir timeline pura (sem replay)
 *   const tl = await ReplayEngine.reconstruirTimeline('round-123');
 *
 *   // 4) Replay textual
 *   await ReplayEngine.replayRound('round-123', { mode: 'text' });
 *
 *   // 5) Replay visual com callback (UI assina cada step)
 *   await ReplayEngine.replayRound('round-123', {
 *     mode: 'visual',
 *     stepDelay: 400,
 *     speed: 2,
 *     onStep: (s, ctx) => atualizarOverlay(s, ctx)
 *   });
 *
 *   // 6) Dry-run rapido (sem delays, so o relatorio)
 *   const r = await ReplayEngine.replayRound('round-123', { mode: 'dry-run' });
 *
 *   // 7) Replay-to-calibration (exige EventStore — pode lancar ReplayEngineUnavailableError)
 *   await ReplayEngine.replayRound('round-123', { replayToCalibration: true });
 *
 *   // 8) Comparar duas rodadas
 *   const diff = await ReplayEngine.compareRounds('round-100', 'round-101');
 *
 *   // 9) Exportar rodada
 *   const json = await ReplayEngine.exportTimeline('round-123', 'json');
 *   const ndjson = await ReplayEngine.exportTimeline('round-123', 'ndjson');
 *
 *   // 10) Cache
 *   ReplayEngine.getReplayCache('round-123');
 *   ReplayEngine.invalidateCache('round-123');
 *
 *   // 11) Status
 *   console.log(ReplayEngine.getStatus());
 *
 *   // 12) Desinscrever do barramento
 *   off();
 */
