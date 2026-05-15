/**
 * calibration-lifecycle-adapter.js
 * ---------------------------------------------------------------------------
 * CalibrationLifecycleAdapter — Liga RoundLifecycle -> CalibrationLoop.
 *
 * Responsabilidade:
 *   Escutar `round_end` do RoundLifecycle e propagar para CalibrationLoop
 *   via `registrarResultado({ source: 'live', ... })`. Faz deduplicacao
 *   (roundId + padraoId) com TTL de 1h, valida payload e usa o
 *   PlanExecutor (opcional) para descobrir quais padroes esperaram aquela
 *   rodada — caso o evento de lifecycle nao traga esse contexto.
 *
 * Por que aqui?
 *   - CalibrationLoop e RoundLifecycle nao devem se conhecer.
 *   - A unica fonte autorizada de "rodada terminou" e o RoundLifecycle.
 *   - PlanExecutor mantem o vinculo roundId -> planoId/padraoId que
 *     CalibrationLoop precisa para creditar/debitar acertos.
 *
 * Convencoes:
 *   - Padrao IIFE.
 *   - Resiliente: sem `attach`, `start`/`stop` viram no-op. Logs com
 *     prefixo `[CalibrationLifecycleAdapter]`.
 *   - Nao importa modulos do projeto. Tudo via injecao.
 *
 * Dedup:
 *   - Set de chaves `${roundId}::${padraoId}` com TTL de 60 minutos.
 *   - Limpeza preguicosa a cada `registrarResultado`.
 * ---------------------------------------------------------------------------
 */

const CalibrationLifecycleAdapter = (() => {
  'use strict';

  const PREFIX = '[CalibrationLifecycleAdapter]';

  const DEDUP_TTL_MS = 60 * 60 * 1000; // 1 hora
  const MAX_DEDUP_ENTRIES = 5_000;     // guardrail de memoria

  let lifecycle = null;
  let calibration = null;
  let planExecutor = null;

  let started = false;
  let unsubscribeRoundEnd = null;

  /** dedup: Map<chave, timestampMs> */
  const dedup = new Map();

  const stats = {
    processados: 0,
    duplicados: 0,
    rejeitados: 0
  };

  // ===========================================================================
  // Helpers
  // ===========================================================================

  function log(...args) { try { console.log(PREFIX, ...args); } catch (_) {} }
  function warn(...args) { try { console.warn(PREFIX, ...args); } catch (_) {} }

  function podeAttachado() {
    return !!(lifecycle && calibration);
  }

  function limparDedupExpirado() {
    const agora = Date.now();
    if (dedup.size <= MAX_DEDUP_ENTRIES) {
      // Limpeza barata: itera so se a janela estourou.
      for (const [k, ts] of dedup) {
        if (agora - ts > DEDUP_TTL_MS) dedup.delete(k);
      }
      return;
    }
    // Estouro: limpa tudo o que ja expirou.
    for (const [k, ts] of dedup) {
      if (agora - ts > DEDUP_TTL_MS) dedup.delete(k);
    }
    // Se ainda estiver acima do teto, faz GC agressivo (remove mais antigos).
    if (dedup.size > MAX_DEDUP_ENTRIES) {
      const sobrando = dedup.size - MAX_DEDUP_ENTRIES;
      let i = 0;
      for (const k of dedup.keys()) {
        if (i++ >= sobrando) break;
        dedup.delete(k);
      }
    }
  }

  function jaProcessado(roundId, padraoId) {
    const k = `${roundId}::${padraoId}`;
    if (!dedup.has(k)) return false;
    const ts = dedup.get(k);
    if (Date.now() - ts > DEDUP_TTL_MS) {
      dedup.delete(k);
      return false;
    }
    return true;
  }

  function marcarProcessado(roundId, padraoId) {
    dedup.set(`${roundId}::${padraoId}`, Date.now());
  }

  /**
   * Valida o payload minimo para registrar no CalibrationLoop.
   * Retorna `true` se ok, `false` se rejeitado (e incrementa stats).
   */
  function validar(payload) {
    if (!payload || typeof payload !== 'object') return false;
    if (!payload.roundId || typeof payload.roundId !== 'string') return false;
    if (!payload.padraoId || typeof payload.padraoId !== 'string') return false;
    if (typeof payload.confiancaNominal !== 'number' || !Number.isFinite(payload.confiancaNominal)) {
      return false;
    }
    if (!payload.resultado) return false;
    const r = String(payload.resultado).toLowerCase();
    if (r !== 'win' && r !== 'loss' && r !== 'tie') return false;
    return true;
  }

  /**
   * Extrai a lista de candidatos { padraoId, confiancaNominal } a partir do
   * evento `round_end`. Procura em varias chaves possiveis e, se nao achar
   * nada, recorre ao PlanExecutor.listarPorRoundId(roundId).
   */
  function extrairCandidatos(evento) {
    const out = [];
    if (!evento || typeof evento !== 'object') return out;

    const candidatosDiretos =
      evento.candidatos ||
      evento.padroes ||
      (evento.payload && (evento.payload.candidatos || evento.payload.padroes));

    if (Array.isArray(candidatosDiretos)) {
      for (const c of candidatosDiretos) {
        if (!c) continue;
        const padraoId = c.padraoId || c.padrao || c.id;
        const confiancaNominal =
          typeof c.confiancaNominal === 'number' ? c.confiancaNominal :
          typeof c.confianca === 'number' ? c.confianca : null;
        if (padraoId && confiancaNominal != null) {
          out.push({ padraoId, confiancaNominal });
        }
      }
    }

    if (out.length) return out;

    // Fallback: PlanExecutor.listarPorRoundId
    const roundId =
      evento.roundId ||
      (evento.payload && evento.payload.roundId) ||
      null;

    if (
      roundId &&
      planExecutor &&
      typeof planExecutor.listarPorRoundId === 'function'
    ) {
      let planos;
      try {
        planos = planExecutor.listarPorRoundId(roundId);
      } catch (err) {
        warn('planExecutor.listarPorRoundId falhou:', err && err.message);
        planos = null;
      }
      if (Array.isArray(planos)) {
        for (const p of planos) {
          if (!p) continue;
          const padraoId = p.padraoId || (p.decisao && p.decisao.padraoId);
          const confiancaNominal =
            typeof p.confiancaNominal === 'number' ? p.confiancaNominal :
            (p.decisao && typeof p.decisao.confianca === 'number') ? p.decisao.confianca :
            null;
          if (padraoId && confiancaNominal != null) {
            out.push({ padraoId, confiancaNominal });
          }
        }
      }
    }

    return out;
  }

  /**
   * Extrai o resultado ('win'|'loss'|'tie') do evento round_end. Aceita
   * varios formatos historicos.
   */
  function extrairResultado(evento) {
    if (!evento) return null;
    const r =
      evento.resultado ||
      (evento.payload && evento.payload.resultado) ||
      (evento.stats && evento.stats.resultado) ||
      null;
    if (!r) return null;
    if (typeof r === 'string') return r.toLowerCase();
    if (typeof r === 'object') {
      if (typeof r.tipo === 'string') return r.tipo.toLowerCase();
      if (typeof r.outcome === 'string') return r.outcome.toLowerCase();
    }
    return null;
  }

  function handleRoundEnd(evento) {
    if (!podeAttachado()) return;
    limparDedupExpirado();

    const roundId =
      evento && (evento.roundId || (evento.payload && evento.payload.roundId));
    if (!roundId) {
      stats.rejeitados += 1;
      return;
    }

    const resultado = extrairResultado(evento);
    if (!resultado) {
      stats.rejeitados += 1;
      return;
    }

    const candidatos = extrairCandidatos(evento);
    if (!candidatos.length) {
      // Sem candidato nao ha o que calibrar. Nao e erro — apenas nao se aplica.
      return;
    }

    const ts =
      (evento && (evento.ts || evento.timestamp)) ||
      (evento && evento.payload && (evento.payload.ts || evento.payload.timestamp)) ||
      Date.now();

    for (const c of candidatos) {
      if (jaProcessado(roundId, c.padraoId)) {
        stats.duplicados += 1;
        continue;
      }

      const payload = {
        roundId,
        padraoId: c.padraoId,
        confiancaNominal: c.confiancaNominal,
        resultado,
        source: 'live',
        ts
      };

      if (!validar(payload)) {
        stats.rejeitados += 1;
        continue;
      }

      try {
        calibration.registrarResultado(payload);
        marcarProcessado(roundId, c.padraoId);
        stats.processados += 1;
      } catch (err) {
        warn('registrarResultado falhou:', err && err.message);
        stats.rejeitados += 1;
      }
    }
  }

  // ===========================================================================
  // API publica
  // ===========================================================================

  return {
    /**
     * Conecta as dependencias por injecao.
     * @param {object} deps
     * @param {object} deps.lifecycle      — RoundLifecycle
     * @param {object} deps.calibration    — CalibrationLoop
     * @param {object} [deps.planExecutor] — PlanExecutor (opcional)
     */
    attach(deps) {
      if (!deps || typeof deps !== 'object') {
        warn('attach() sem deps; ignorando.');
        return;
      }
      lifecycle = deps.lifecycle || null;
      calibration = deps.calibration || null;
      planExecutor = deps.planExecutor || null;
      log('attach OK', {
        lifecycle: !!lifecycle,
        calibration: !!calibration,
        planExecutor: !!planExecutor
      });
    },

    detach() {
      this.stop();
      lifecycle = null;
      calibration = null;
      planExecutor = null;
      log('detach OK');
    },

    /**
     * Liga a escuta em `round_end`. Idempotente.
     */
    start() {
      if (started) return;
      if (!podeAttachado()) {
        warn('start() sem attach completo; no-op.');
        return;
      }
      if (typeof lifecycle.subscribe !== 'function') {
        warn('lifecycle.subscribe ausente; no-op.');
        return;
      }
      try {
        unsubscribeRoundEnd = lifecycle.subscribe('round_end', handleRoundEnd);
      } catch (err) {
        warn('Falha ao subscribe(round_end):', err && err.message);
        unsubscribeRoundEnd = null;
        return;
      }
      started = true;
      log('start OK');
    },

    /**
     * Desliga a escuta.
     */
    stop() {
      if (!started) return;
      if (typeof unsubscribeRoundEnd === 'function') {
        try { unsubscribeRoundEnd(); } catch (_) { /* noop */ }
      }
      unsubscribeRoundEnd = null;
      started = false;
      log('stop OK');
    },

    /**
     * Estatisticas operacionais.
     */
    getStats() {
      return {
        processados: stats.processados,
        duplicados: stats.duplicados,
        rejeitados: stats.rejeitados,
        dedupSize: dedup.size,
        started
      };
    },

    _debug() {
      return {
        attached: { lifecycle: !!lifecycle, calibration: !!calibration, planExecutor: !!planExecutor },
        started,
        stats: this.getStats()
      };
    }
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CalibrationLifecycleAdapter;
}

/* ---------------------------------------------------------------------------
 * Exemplo de uso (referencia):
 *
 *   CalibrationLifecycleAdapter.attach({
 *     lifecycle: RoundLifecycle,
 *     calibration: CalibrationLoop,
 *     planExecutor: PlanExecutor
 *   });
 *   CalibrationLifecycleAdapter.start();
 *
 *   // Mais tarde, telemetria:
 *   console.log(CalibrationLifecycleAdapter.getStats());
 *   // { processados: 132, duplicados: 4, rejeitados: 1, ... }
 *
 *   CalibrationLifecycleAdapter.stop();
 * ------------------------------------------------------------------------- */
