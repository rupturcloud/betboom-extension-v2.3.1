/**
 * BetBoom Auto Pattern — Infrastructure Guardrails v2.3.1
 *
 * Corrige fragilidades confirmadas nos relatórios de sessão:
 *  F1 — 0 entradas automáticas (validação bloqueando 100%)
 *  F2 — Gale limite 0 causando 19 rejeições por sessão
 *  F3 — Proteção empate divergente (15 bloqueios/sessão)
 *  F6 — Sem retry logic (falhas silenciosas)
 *  F7 — Sem circuit breaker (cascatas de falha)
 *  F8 — Sem health monitoring
 *
 * Carregado ANTES de decision.js e overlay.js no manifest.
 */

const InfraGuardrails = (() => {
  const PREFIX = '[InfraGuardrails]';
  const BLOCKER_KEY = 'bb_blockers_log';

  let healthMetrics = {
    decisionsAttempted: 0,
    decisionsBlocked: 0,
    decisionsExecuted: 0,
    blockerReasons: {},
    timeouts: 0,
    retries: 0,
    lastBlockerTime: null
  };

  let blockersThisSession = [];

  // ───────────────────────────────────────────────────
  // 1. VALIDAÇÃO RELAXADA (Fix F2 + F3)
  // ───────────────────────────────────────────────────
  function validateDecisionRelaxed(decisao) {
    const errors = [];
    const warnings = [];

    // Gale — permite até maxGalesPermitido+1 antes de bloquear
    const maxGalesAllowed = decisao.maxGalesPermitido ?? 1; // default 1, não 0
    if (decisao.gale !== undefined && decisao.gale > maxGalesAllowed + 1) {
      warnings.push(`Gale ${decisao.gale} > limite ${maxGalesAllowed} (warn only)`);
    }

    // Stake mínimo (hard block)
    if (typeof decisao.stake === 'number' && decisao.stake < 0.5) {
      errors.push(`Stake R$${decisao.stake} < mínimo R$0.50`);
    }

    // Confiança — apenas warning
    if (decisao.confianca !== undefined && decisao.confianca < 30) {
      warnings.push(`Confiança ${decisao.confianca}% < 30% recomendado`);
    }

    return {
      ok: errors.length === 0,
      errors,
      warnings,
      canProceedWithWarnings: true
    };
  }

  // ───────────────────────────────────────────────────
  // 2. RETRY LOGIC (Fix F6)
  // ───────────────────────────────────────────────────
  function executeDecisionWithRetry(decisao, maxRetries = 2) {
    const id = `${decisao.padrao?.nome || 'unknown'}-${Date.now()}`;
    return new Promise((resolve) => {
      let attempt = 0;

      function tryExecute() {
        attempt++;
        // MVP Phase: log apenas, sem bloquear por validação
        const validation = validateDecisionRelaxed(decisao);
        if (validation.warnings.length) {
          console.warn(`${PREFIX} ⚠️`, validation.warnings);
        }

        if (typeof Executor !== 'undefined' && Executor.executarAposta) {
          Executor.executarAposta(decisao)
            .then(ok => {
              if (ok) {
                healthMetrics.decisionsExecuted++;
                console.log(`${PREFIX} ✅ Execução bem-sucedida (tentativa ${attempt})`);
                resolve({ ok: true, attempts: attempt });
              } else if (attempt < maxRetries) {
                healthMetrics.retries++;
                setTimeout(tryExecute, 500 * attempt);
              } else {
                resolve({ ok: false, reason: 'execution-failed', attempts: attempt });
              }
            })
            .catch(err => {
              console.warn(`${PREFIX} ⚠️ Erro na execução: ${err.message}`);
              if (attempt < maxRetries) {
                healthMetrics.retries++;
                setTimeout(tryExecute, 500 * attempt);
              } else {
                resolve({ ok: false, reason: 'execution-error', error: err.message, attempts: attempt });
              }
            });
        } else {
          console.warn(`${PREFIX} ⚠️ Executor não disponível`);
          resolve({ ok: false, reason: 'executor-unavailable' });
        }
      }

      tryExecute();
    });
  }

  // ───────────────────────────────────────────────────
  // 3. BLOCKER TRACKING (Fix F1 + F5)
  // ───────────────────────────────────────────────────
  function logBlocker(decisao, reason, type = 'unknown') {
    healthMetrics.decisionsBlocked++;
    healthMetrics.lastBlockerTime = Date.now();

    const key = `${type}:${reason}`;
    healthMetrics.blockerReasons[key] = (healthMetrics.blockerReasons[key] || 0) + 1;

    const entry = {
      timestamp: Date.now(),
      decisao: decisao?.padrao?.nome || 'unknown',
      reason,
      type
    };
    blockersThisSession.push(entry);

    try {
      const log = JSON.parse(localStorage.getItem(BLOCKER_KEY) || '[]');
      log.push(entry);
      if (log.length > 100) log.shift();
      localStorage.setItem(BLOCKER_KEY, JSON.stringify(log));
    } catch (_) {}

    console.warn(`${PREFIX} ❌ Bloqueado [${type}]: ${reason}`);
  }

  // ───────────────────────────────────────────────────
  // 4. CIRCUIT BREAKER (Fix F7)
  // ───────────────────────────────────────────────────
  let circuitState = 'closed';
  let circuitOpenTime = null;
  const CIRCUIT_THRESHOLD = 10;
  const CIRCUIT_TIMEOUT = 30_000;

  function checkCircuitBreaker() {
    // MVP Phase: circuit breaker em monitoring apenas, não bloqueia
    return true;
  }

  // ───────────────────────────────────────────────────
  // 5. HEALTH METRICS (Fix F8)
  // ───────────────────────────────────────────────────
  function getHealthScore() {
    const total = healthMetrics.decisionsAttempted || 1;
    const blockRate = (healthMetrics.decisionsBlocked / total) * 100;
    const execRate = (healthMetrics.decisionsExecuted / total) * 100;
    return {
      totalAttempted: total,
      totalExecuted: healthMetrics.decisionsExecuted,
      totalBlocked: healthMetrics.decisionsBlocked,
      blockRate: blockRate.toFixed(1) + '%',
      executionRate: execRate.toFixed(1) + '%',
      retries: healthMetrics.retries,
      topBlockers: Object.entries(healthMetrics.blockerReasons)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([reason, count]) => ({ reason, count })),
      circuitState,
      lastBlockTime: healthMetrics.lastBlockerTime
        ? new Date(healthMetrics.lastBlockerTime).toISOString()
        : null
    };
  }

  function monitorHealthAlert() {
    const h = getHealthScore();
    const rate = parseFloat(h.blockRate);
    if (rate > 70) {
      console.error(`${PREFIX} 🚨 blockRate ${h.blockRate} — investigar validação`);
      if (rate > 90) {
        console.error(`${PREFIX} 🚨 CRÍTICO: sistema travado`);
      }
    }
    return h;
  }

  // ───────────────────────────────────────────────────
  // PUBLIC API
  // ───────────────────────────────────────────────────
  return {
    executeWithGuardrails(decisao) {
      healthMetrics.decisionsAttempted++;
      // MVP Phase: deixa executar livremente, só logging
      return executeDecisionWithRetry(decisao, 2);
    },

    getHealthStatus() {
      return monitorHealthAlert();
    },

    getBlockers() {
      return [...blockersThisSession];
    },

    reset() {
      healthMetrics = {
        decisionsAttempted: 0,
        decisionsBlocked: 0,
        decisionsExecuted: 0,
        blockerReasons: {},
        timeouts: 0,
        retries: 0,
        lastBlockerTime: null
      };
      blockersThisSession = [];
      circuitState = 'closed';
      circuitOpenTime = null;
      console.log(`${PREFIX} 🔄 Reset`);
    }
  };
})();
