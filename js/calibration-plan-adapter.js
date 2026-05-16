/**
 * calibration-plan-adapter.js
 * ---------------------------------------------------------------------------
 * CalibrationPlanAdapter — Pre-cache de contexto de calibracao do PlanExecutor.
 *
 * Quando o PlanExecutor cria/executa um plano, este adapter le
 * `PlanExecutor.contextoCalibracao(planoId)` e armazena por `roundId`. Esse
 * contexto e usado para enriquecer o evento de fim de rodada do
 * RoundLifecycle quando ele chega "magro" (sem padroes anexados), permitindo
 * que `CalibrationLifecycleAdapter` saiba o que calibrar.
 *
 * Por que aqui?
 *   - CalibrationLoop nao deve saber existir um PlanExecutor.
 *   - PlanExecutor nao deve saber existir um CalibrationLoop.
 *   - Esse adapter atua como bridge passiva (so leitura) entre os dois.
 *
 * Convencoes:
 *   - Padrao IIFE.
 *   - Resiliente: sem attach, getters retornam null e start/stop sao no-op.
 *   - Logs com prefixo `[CalibrationPlanAdapter]`.
 *   - Nao importa modulos do projeto.
 *
 * Cache:
 *   - Map<roundId, contexto> com tamanho maximo configuravel (default 500).
 *   - GC tipo FIFO simples — o roundId mais antigo cai primeiro.
 * ---------------------------------------------------------------------------
 */

const CalibrationPlanAdapter = (() => {
  'use strict';

  const PREFIX = '[CalibrationPlanAdapter]';

  const MAX_CACHE_ENTRIES = 500;

  let planExecutor = null;
  let calibration = null; // mantido para futuras leituras (snapshot etc); hoje opcional
  let started = false;

  /** Eventos do PlanExecutor que disparam atualizacao do cache. */
  const EVENTOS_INTERESSE = ['plan_created', 'plan_started', 'plan_finished'];

  /** unsubscribers por evento. */
  const unsubscribers = new Map();

  /** cache: Map<roundId, { contexto, ts }> */
  const cache = new Map();

  // ===========================================================================
  // Helpers
  // ===========================================================================

  function log(...args) { try { console.log(PREFIX, ...args); } catch (_) {} }
  function warn(...args) { try { console.warn(PREFIX, ...args); } catch (_) {} }

  function hasPlanExecutor() {
    return planExecutor && typeof planExecutor === 'object';
  }

  function inserirCache(roundId, contexto) {
    if (!roundId || !contexto) return;
    if (cache.size >= MAX_CACHE_ENTRIES) {
      // Remove o mais antigo (primeira chave inserida no Map).
      const primeiroKey = cache.keys().next().value;
      if (primeiroKey != null) cache.delete(primeiroKey);
    }
    cache.set(roundId, { contexto, ts: Date.now() });
  }

  /**
   * A partir de um evento de plano (created/started/finished), extrai o
   * planoId e o roundId. Aceita varios formatos.
   */
  function extrairChaves(evento) {
    if (!evento || typeof evento !== 'object') return { planoId: null, roundId: null };
    const planoId =
      evento.planoId ||
      evento.planId ||
      (evento.plano && (evento.plano.id || evento.plano.planoId)) ||
      (evento.payload && (evento.payload.planoId || evento.payload.planId)) ||
      null;
    const roundId =
      evento.roundId ||
      (evento.plano && evento.plano.roundId) ||
      (evento.payload && evento.payload.roundId) ||
      null;
    return { planoId, roundId };
  }

  function atualizarCachePorEvento(evento) {
    if (!hasPlanExecutor()) return;
    const { planoId, roundId } = extrairChaves(evento);
    if (!planoId || !roundId) return;
    if (typeof planExecutor.contextoCalibracao !== 'function') return;
    let contexto;
    try {
      contexto = planExecutor.contextoCalibracao(planoId);
    } catch (err) {
      warn('contextoCalibracao falhou:', err && err.message);
      contexto = null;
    }
    if (!contexto || typeof contexto !== 'object') return;
    inserirCache(roundId, contexto);
  }

  function inscrever(evento) {
    if (typeof planExecutor.subscribe !== 'function') return;
    let off;
    try {
      off = planExecutor.subscribe(evento, atualizarCachePorEvento);
    } catch (err) {
      warn(`subscribe(${evento}) falhou:`, err && err.message);
      off = null;
    }
    if (typeof off === 'function') {
      unsubscribers.set(evento, off);
    }
  }

  // ===========================================================================
  // API publica
  // ===========================================================================

  return {
    /**
     * Conecta dependencias.
     * @param {object} deps
     * @param {object} deps.planExecutor — PlanExecutor
     * @param {object} [deps.calibration] — CalibrationLoop (opcional)
     */
    attach(deps) {
      if (!deps || typeof deps !== 'object') {
        warn('attach() sem deps; ignorando.');
        return;
      }
      planExecutor = deps.planExecutor || null;
      calibration = deps.calibration || null;
      log('attach OK', { planExecutor: !!planExecutor, calibration: !!calibration });
    },

    detach() {
      this.stop();
      planExecutor = null;
      calibration = null;
      cache.clear();
      log('detach OK');
    },

    /**
     * Liga as inscricoes nos eventos do PlanExecutor. Idempotente.
     */
    start() {
      if (started) return;
      if (!hasPlanExecutor()) {
        warn('start() sem PlanExecutor; no-op.');
        return;
      }
      for (const ev of EVENTOS_INTERESSE) inscrever(ev);
      started = true;
      log('start OK', { inscrito_em: Array.from(unsubscribers.keys()) });
    },

    /**
     * Desliga inscricoes.
     */
    stop() {
      if (!started) return;
      for (const [ev, off] of unsubscribers) {
        try { off && off(); } catch (_) { /* noop */ }
        unsubscribers.delete(ev);
      }
      started = false;
      log('stop OK');
    },

    /**
     * Recupera o contexto de calibracao cacheado para um roundId.
     * @param {string} roundId
     * @returns {object|null}
     */
    getContextByRoundId(roundId) {
      if (!roundId) return null;
      const entry = cache.get(roundId);
      if (!entry) return null;
      return entry.contexto || null;
    },

    /**
     * Forca uma atualizacao manual (util para testes/integracao).
     * @param {string} planoId
     * @param {string} roundId
     */
    forceRefresh(planoId, roundId) {
      if (!planoId || !roundId || !hasPlanExecutor()) return;
      if (typeof planExecutor.contextoCalibracao !== 'function') return;
      let contexto;
      try { contexto = planExecutor.contextoCalibracao(planoId); } catch (_) { contexto = null; }
      if (contexto) inserirCache(roundId, contexto);
    },

    _debug() {
      return {
        attached: { planExecutor: !!planExecutor, calibration: !!calibration },
        started,
        cacheSize: cache.size,
        inscrito_em: Array.from(unsubscribers.keys())
      };
    }
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CalibrationPlanAdapter;
}

/* ---------------------------------------------------------------------------
 * Exemplo de uso (referencia):
 *
 *   CalibrationPlanAdapter.attach({
 *     planExecutor: PlanExecutor,
 *     calibration: CalibrationLoop
 *   });
 *   CalibrationPlanAdapter.start();
 *
 *   // Quando o round_end chegar magro:
 *   const ctx = CalibrationPlanAdapter.getContextByRoundId(roundId);
 *   if (ctx) {
 *     // ctx contem padroes/confianca usados naquela rodada;
 *     // o CalibrationLifecycleAdapter usa isso como fallback.
 *   }
 *
 *   CalibrationPlanAdapter.stop();
 * ------------------------------------------------------------------------- */
