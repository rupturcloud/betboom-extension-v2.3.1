/**
 * lifecycle-gate.js
 * ---------------------------------------------------------------------------
 * LifecycleGate — Adapter fino sobre RoundLifecycle.
 *
 * Permite que PlanExecutor (e qualquer outro consumidor) leia o estado da
 * rodada e se inscreva em mudancas de fase SEM importar RoundLifecycle
 * diretamente. Isso quebra o acoplamento entre o PlanExecutor e o
 * RoundLifecycle, mantendo cada modulo isolado.
 *
 * Convencoes:
 *   - Padrao IIFE como os demais modulos do projeto.
 *   - Resiliente: se nada estiver attached, todos os getters retornam null
 *     ou false; subscribe retorna um no-op unsubscribe. NUNCA throw.
 *   - Logs com prefixo `[LifecycleGate]`.
 *
 * Janela de apostas:
 *   Para `getBettingWindowRemainingMs`, usamos a fase `apostando` reportada
 *   por `RoundLifecycle.getPhaseElapsedMs(roundId)` e subtraimos do valor
 *   maximo conhecido. O default e 10s (heuristico do Bac Bo); se voce souber
 *   um valor melhor, ajuste via `setBettingWindowMs(ms)`.
 *
 * Nao depende de outros modulos do projeto. Tudo via `attach()`.
 * ---------------------------------------------------------------------------
 */

const LifecycleGate = (() => {
  'use strict';

  const PREFIX = '[LifecycleGate]';

  // Janela de apostas estimada para a fase APOSTANDO. Pode ser sobrescrita
  // por `setBettingWindowMs`. Mantemos um default conservador.
  const DEFAULT_BETTING_WINDOW_MS = 10_000;

  let lifecycle = null;
  let bettingWindowMs = DEFAULT_BETTING_WINDOW_MS;

  // ===========================================================================
  // Helpers internos
  // ===========================================================================

  function log(...args) {
    try {
      // eslint-disable-next-line no-console
      console.log(PREFIX, ...args);
    } catch (_) {
      // silencioso
    }
  }

  function warn(...args) {
    try {
      // eslint-disable-next-line no-console
      console.warn(PREFIX, ...args);
    } catch (_) {
      // silencioso
    }
  }

  function hasLifecycle() {
    return lifecycle && typeof lifecycle === 'object';
  }

  function safeCall(fn, ...args) {
    if (typeof fn !== 'function') return null;
    try {
      return fn(...args);
    } catch (err) {
      warn('Falha ao chamar metodo do lifecycle:', err && err.message);
      return null;
    }
  }

  function getCurrentRoundSafe() {
    if (!hasLifecycle()) return null;
    return safeCall(lifecycle.getCurrentRound && lifecycle.getCurrentRound.bind(lifecycle));
  }

  function noopUnsubscribe() {
    return undefined;
  }

  // ===========================================================================
  // API publica
  // ===========================================================================

  return {
    /**
     * Conecta a instancia de RoundLifecycle. Idempotente.
     * @param {object} lifecycleInstance — modulo RoundLifecycle ja inicializado.
     */
    attach(lifecycleInstance) {
      if (!lifecycleInstance || typeof lifecycleInstance !== 'object') {
        warn('attach() chamado sem instancia valida; ignorando.');
        return;
      }
      lifecycle = lifecycleInstance;
      log('attach OK');
    },

    /**
     * Desconecta. Apos isso, getters voltam a retornar null/false.
     */
    detach() {
      lifecycle = null;
      log('detach OK');
    },

    /**
     * Permite ajustar a janela de apostas estimada (ms).
     * @param {number} ms
     */
    setBettingWindowMs(ms) {
      if (typeof ms === 'number' && ms > 0 && Number.isFinite(ms)) {
        bettingWindowMs = ms;
        log('bettingWindowMs ajustado para', ms);
      }
    },

    /**
     * Retorna o roundId ativo ou null.
     * @returns {string|null}
     */
    getCurrentRoundId() {
      const r = getCurrentRoundSafe();
      if (!r) return null;
      return r.roundId || r.id || null;
    },

    /**
     * Retorna a fase atual ('apostando' | 'fechado' | 'jogando' | 'resultado'
     * | 'observing' | ...) ou null.
     * @returns {string|null}
     */
    getCurrentPhase() {
      const r = getCurrentRoundSafe();
      if (!r) return null;
      return r.phase || r.fase || r.faseAtual || null;
    },

    /**
     * Tempo restante (ms) na janela de apostas. Se nao estamos em
     * `apostando`, retorna 0. Se nao houver attach, retorna null.
     * @returns {number|null}
     */
    getBettingWindowRemainingMs() {
      if (!hasLifecycle()) return null;
      const r = getCurrentRoundSafe();
      if (!r) return 0;
      const fase = r.phase || r.fase || r.faseAtual;
      if (fase !== 'apostando') return 0;
      const roundId = r.roundId || r.id;
      if (!roundId) return 0;
      const elapsed = safeCall(
        lifecycle.getPhaseElapsedMs && lifecycle.getPhaseElapsedMs.bind(lifecycle),
        roundId
      );
      if (typeof elapsed !== 'number' || !Number.isFinite(elapsed)) {
        // Fallback: se a API nao existe, retorna a janela cheia para nao bloquear.
        return bettingWindowMs;
      }
      const restante = bettingWindowMs - elapsed;
      return restante > 0 ? restante : 0;
    },

    /**
     * Inscreve um callback para mudanca de fase. Retorna unsubscribe.
     * Aceita assinaturas que recebem o evento bruto do RoundLifecycle.
     * @param {(evento:object)=>void} cb
     * @returns {()=>void}
     */
    onPhaseChange(cb) {
      if (!hasLifecycle() || typeof cb !== 'function') return noopUnsubscribe;
      const off = safeCall(
        lifecycle.subscribe && lifecycle.subscribe.bind(lifecycle),
        'phase_change',
        cb
      );
      if (typeof off === 'function') return off;
      return noopUnsubscribe;
    },

    /**
     * Inscreve um callback para o fim da rodada. Retorna unsubscribe.
     * @param {(evento:object)=>void} cb
     * @returns {()=>void}
     */
    onRoundEnd(cb) {
      if (!hasLifecycle() || typeof cb !== 'function') return noopUnsubscribe;
      const off = safeCall(
        lifecycle.subscribe && lifecycle.subscribe.bind(lifecycle),
        'round_end',
        cb
      );
      if (typeof off === 'function') return off;
      return noopUnsubscribe;
    },

    /**
     * Conveniencia: estamos na janela de apostas?
     * @returns {boolean}
     */
    isApostando() {
      return this.getCurrentPhase() === 'apostando';
    },

    /**
     * Estado interno (debug).
     */
    _debug() {
      return {
        attached: hasLifecycle(),
        bettingWindowMs,
        current: getCurrentRoundSafe()
      };
    }
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LifecycleGate;
}

/* ---------------------------------------------------------------------------
 * Exemplo de uso (apenas referencia, nao executa em runtime):
 *
 *   // Bootstrap (em algum entrypoint, ex: background ou content):
 *   LifecycleGate.attach(RoundLifecycle);
 *   LifecycleGate.setBettingWindowMs(10_000);
 *
 *   // Dentro do PlanExecutor.attachLifecycle(gate):
 *   const roundId = gate.getCurrentRoundId();
 *   if (gate.isApostando() && gate.getBettingWindowRemainingMs() > 1500) {
 *     // ainda da tempo de apostar
 *   }
 *
 *   const off = gate.onPhaseChange(evt => {
 *     if (evt.para === 'fechado') cancelarPlanosAbertos();
 *   });
 *   // ... mais tarde:
 *   off();
 * ------------------------------------------------------------------------- */
