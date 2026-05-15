/**
 * lifecycle-replay-projector.js
 * ---------------------------------------------------------------------------
 * LifecycleReplayProjector — Projecao read-only do FSM de RoundLifecycle.
 *
 * Reconstroi o ciclo de vida de rodadas passadas exclusivamente a partir dos
 * eventos `lifecycle_event` (e tipos correlatos) persistidos no EventStore.
 * E usado pelo ReplayEngine para "rodar" replays sem precisar manter um
 * RoundLifecycle vivo nem importar diretamente o modulo.
 *
 * Tipos de evento esperados no EventStore (qualquer um destes serve):
 *   - 'lifecycle_event'   (envelope generico com sub-tipo em payload)
 *   - 'round_start'
 *   - 'phase_change'
 *   - 'round_end'
 *   - 'round_anomaly'
 *
 * Saida (RoundProjection):
 *   {
 *     roundId: string,
 *     fases:    [ { nome, t0, t1, duracaoMs, metadata? } ],
 *     anomalias: [ { tipo, ts, detalhe? } ],
 *     t0:       number | null,       // inicio da rodada
 *     t1:       number | null,       // fim da rodada
 *     outcome:  object | null        // payload do round_end
 *   }
 *
 * Convencoes:
 *   - Padrao IIFE.
 *   - Resiliente: sem `attach`, todos os metodos retornam estruturas vazias
 *     ao inves de throw. Logs com prefixo `[LifecycleReplayProjector]`.
 *   - Nao importa outros modulos do projeto. EventStore vem via attach().
 * ---------------------------------------------------------------------------
 */

const LifecycleReplayProjector = (() => {
  'use strict';

  const PREFIX = '[LifecycleReplayProjector]';

  // Tipos lidos do EventStore. Mantemos uma lista ampla para tolerar
  // variacoes de envelope (`lifecycle_event` x eventos diretos).
  const LIFECYCLE_TYPES = [
    'lifecycle_event',
    'round_start',
    'phase_change',
    'round_end',
    'round_anomaly'
  ];

  let eventStore = null;

  // ===========================================================================
  // Helpers
  // ===========================================================================

  function log(...args) {
    try { console.log(PREFIX, ...args); } catch (_) { /* noop */ }
  }

  function warn(...args) {
    try { console.warn(PREFIX, ...args); } catch (_) { /* noop */ }
  }

  function hasStore() {
    return eventStore && typeof eventStore === 'object';
  }

  /**
   * Normaliza um evento bruto do EventStore para uma forma estavel:
   *   { type, payload, ts, roundId, seq }
   * Aceita os varios formatos historicos (data/payload, timestamp/ts).
   */
  function normalizar(ev) {
    if (!ev || typeof ev !== 'object') return null;
    const type = ev.type || ev.eventType || (ev.payload && ev.payload.type) || null;
    const payload = ev.payload || ev.data || {};
    const ts = ev.ts || ev.timestamp || payload.ts || payload.timestamp || 0;
    const seq = typeof ev.seq === 'number' ? ev.seq : null;
    const roundId =
      ev.roundId ||
      payload.roundId ||
      payload.round_id ||
      null;
    return { type, payload, ts, roundId, seq };
  }

  /**
   * Identifica o "sub-tipo" semantico do evento, indiferente ao envelope.
   * Retorna uma das strings: 'round_start' | 'phase_change' | 'round_end' |
   * 'round_anomaly' | null.
   */
  function classificar(ev) {
    if (!ev) return null;
    const direto = ev.type;
    if (
      direto === 'round_start' ||
      direto === 'phase_change' ||
      direto === 'round_end' ||
      direto === 'round_anomaly'
    ) {
      return direto;
    }
    // Envelope: ev.type === 'lifecycle_event', sub-tipo em payload.
    const sub = ev.payload && (ev.payload.tipo || ev.payload.subtype || ev.payload.evento);
    if (
      sub === 'round_start' ||
      sub === 'phase_change' ||
      sub === 'round_end' ||
      sub === 'round_anomaly'
    ) {
      return sub;
    }
    return null;
  }

  async function fetchLifecycleEvents(roundId) {
    if (!hasStore()) return [];
    if (typeof eventStore.queryByRoundId !== 'function') return [];
    let raw;
    try {
      raw = await eventStore.queryByRoundId(roundId);
    } catch (err) {
      warn('queryByRoundId falhou:', err && err.message);
      return [];
    }
    if (!Array.isArray(raw)) return [];
    const filtrados = [];
    for (const ev of raw) {
      const norm = normalizar(ev);
      if (!norm) continue;
      if (norm.type && LIFECYCLE_TYPES.indexOf(norm.type) === -1) continue;
      if (!classificar(norm)) continue;
      filtrados.push(norm);
    }
    // Ordena por seq (ou ts como fallback) para determinismo.
    filtrados.sort((a, b) => {
      if (a.seq != null && b.seq != null) return a.seq - b.seq;
      return (a.ts || 0) - (b.ts || 0);
    });
    return filtrados;
  }

  /**
   * Reduz uma lista ja filtrada/ordenada para uma RoundProjection.
   */
  function reduzir(roundId, eventos) {
    const proj = {
      roundId,
      fases: [],
      anomalias: [],
      t0: null,
      t1: null,
      outcome: null
    };

    let faseAberta = null; // { nome, t0, metadata }

    function fecharFase(tFim) {
      if (!faseAberta) return;
      const t1 = typeof tFim === 'number' ? tFim : faseAberta.t0;
      proj.fases.push({
        nome: faseAberta.nome,
        t0: faseAberta.t0,
        t1,
        duracaoMs: Math.max(0, t1 - faseAberta.t0),
        metadata: faseAberta.metadata || null
      });
      faseAberta = null;
    }

    for (const ev of eventos) {
      const kind = classificar(ev);
      const p = ev.payload || {};
      const ts = ev.ts || p.ts || 0;

      if (kind === 'round_start') {
        proj.t0 = ts;
        // RoundLifecycle convenciona iniciar em APOSTANDO.
        const faseInicial = p.faseInicial || p.fase || 'apostando';
        faseAberta = { nome: faseInicial, t0: ts, metadata: p.metadata || null };
      } else if (kind === 'phase_change') {
        const para = p.para || p.fase || p.novoEstado;
        fecharFase(ts);
        if (para) {
          faseAberta = { nome: para, t0: ts, metadata: p.metadata || null };
        }
      } else if (kind === 'round_end') {
        fecharFase(ts);
        proj.t1 = ts;
        proj.outcome = p.resultado || p.outcome || p || null;
      } else if (kind === 'round_anomaly') {
        proj.anomalias.push({
          tipo: p.tipo || p.anomalia || 'desconhecida',
          ts,
          detalhe: p.detalhe || p.detalhes || null
        });
      }
    }

    // Se a rodada nao foi formalmente encerrada, deixa a fase aberta sem t1.
    if (faseAberta) {
      proj.fases.push({
        nome: faseAberta.nome,
        t0: faseAberta.t0,
        t1: null,
        duracaoMs: null,
        metadata: faseAberta.metadata || null
      });
    }

    return proj;
  }

  /**
   * Descobre roundIds recentes usando `query(type, filters)`.
   * Implementacao tolerante: tenta com 'round_start'; se vier vazio,
   * tenta com 'lifecycle_event'.
   */
  async function descobrirRoundIdsRecentes(n) {
    if (!hasStore() || typeof eventStore.query !== 'function') return [];
    const limite = typeof n === 'number' && n > 0 ? n : 20;

    async function tentar(tipo) {
      let resp;
      try {
        resp = await eventStore.query(tipo, {});
      } catch (err) {
        warn(`query(${tipo}) falhou:`, err && err.message);
        return [];
      }
      if (!Array.isArray(resp)) return [];
      return resp;
    }

    let eventos = await tentar('round_start');
    if (!eventos.length) eventos = await tentar('lifecycle_event');

    // Mapeia para roundIds unicos preservando ordem de chegada (do mais
    // recente para o mais antigo).
    const vistos = new Set();
    const ordenados = eventos
      .map(normalizar)
      .filter(Boolean)
      .filter(ev => ev.roundId)
      .sort((a, b) => {
        if (a.seq != null && b.seq != null) return b.seq - a.seq;
        return (b.ts || 0) - (a.ts || 0);
      });

    const out = [];
    for (const ev of ordenados) {
      if (vistos.has(ev.roundId)) continue;
      vistos.add(ev.roundId);
      out.push(ev.roundId);
      if (out.length >= limite) break;
    }
    return out;
  }

  // ===========================================================================
  // API publica
  // ===========================================================================

  return {
    /**
     * Conecta a instancia do EventStore.
     * @param {object} eventStoreInstance
     */
    attach(eventStoreInstance) {
      if (!eventStoreInstance || typeof eventStoreInstance !== 'object') {
        warn('attach() chamado sem instancia valida; ignorando.');
        return;
      }
      eventStore = eventStoreInstance;
      log('attach OK');
    },

    detach() {
      eventStore = null;
      log('detach OK');
    },

    /**
     * Reconstroi a projecao de uma rodada.
     * @param {string} roundId
     * @returns {Promise<object>}
     */
    async getRoundProjection(roundId) {
      const empty = {
        roundId: roundId || null,
        fases: [],
        anomalias: [],
        t0: null,
        t1: null,
        outcome: null
      };
      if (!roundId || !hasStore()) return empty;
      const eventos = await fetchLifecycleEvents(roundId);
      if (!eventos.length) return empty;
      return reduzir(roundId, eventos);
    },

    /**
     * Projecoes das ultimas N rodadas. Ordem do mais recente para o mais antigo.
     * @param {number} n
     * @returns {Promise<object[]>}
     */
    async getRecentRounds(n) {
      if (!hasStore()) return [];
      const ids = await descobrirRoundIdsRecentes(n);
      const out = [];
      for (const id of ids) {
        // Sequencial para preservar baixa pressao no IndexedDB.
        // eslint-disable-next-line no-await-in-loop
        const proj = await this.getRoundProjection(id);
        out.push(proj);
      }
      return out;
    },

    _debug() {
      return { attached: hasStore(), tiposLidos: LIFECYCLE_TYPES.slice() };
    }
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LifecycleReplayProjector;
}

/* ---------------------------------------------------------------------------
 * Exemplo de uso (apenas referencia, nao executa em runtime):
 *
 *   LifecycleReplayProjector.attach(EventStore);
 *
 *   // Reconstruir uma rodada:
 *   const proj = await LifecycleReplayProjector.getRoundProjection('round-42');
 *   // proj.fases -> [{ nome:'apostando', t0, t1, duracaoMs }, ...]
 *
 *   // Ultimas 10 rodadas para alimentar o ReplayEngine em lote:
 *   const recentes = await LifecycleReplayProjector.getRecentRounds(10);
 *   for (const r of recentes) {
 *     ReplayEngine.replayRound(r.roundId, { simulacao: true });
 *   }
 * ------------------------------------------------------------------------- */
