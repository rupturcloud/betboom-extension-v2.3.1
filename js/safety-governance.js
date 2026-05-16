/**
 * BetBoom Safety & Governance Layer v1.0
 * ======================================
 * Implementa safeguards contra comportamentos perigosos:
 * - Circuit breaker automático em caso de falhas
 * - Rate limiting de operações
 * - Validação de limites de risco
 * - Alertas de anomalia
 * - Kill switch automático em degradação crítica
 *
 * Responsabilidades:
 * - Monitorar taxa de erro e falhas
 * - Bloqueiar operações perigosas
 * - Aplicar limites de stake e frequência
 * - Notificar operador sobre anomalias
 * - Ativar parada automática se necessário
 */

const SafetyGovernance = (() => {
  const PREFIX = '[SafetyGovernance]';

  // Circuit breaker states
  const STATES = {
    HEALTHY: 'healthy',
    DEGRADED: 'degraded',
    CRITICAL: 'critical',
    BREAKER_OPEN: 'breaker-open'
  };

  let state = {
    currentState: STATES.HEALTHY,
    lastStateChange: Date.now(),
    consecutiveErrors: 0,
    consecutiveFailures: 0,
    recentOperations: [],
    rateLimitWindow: 60000, // 1 minuto
    rateLimitMax: 10,
    thresholds: {
      errorRateThreshold: 0.3,  // 30% de erro = degradação
      failureRateThreshold: 0.5, // 50% de falha = crítico
      consecutiveErrorsThreshold: 3,
      consecutiveFailuresThreshold: 5,
      circuitBreakerResetTime: 300000 // 5 minutos
    },
    alerts: [],
    disabledReasons: []
  };

  function recordOperation(operationType, success) {
    const now = Date.now();
    state.recentOperations.push({
      timestamp: now,
      operationType,
      success
    });

    // Manter apenas últimos 100 ou últimos 1 minuto
    state.recentOperations = state.recentOperations.filter(
      op => now - op.timestamp < 120000
    ).slice(-100);

    if (success) {
      state.consecutiveErrors = 0;
      state.consecutiveFailures = 0;
    } else {
      state.consecutiveErrors += 1;
      state.consecutiveFailures += 1;
    }

    evaluateHealth();
  }

  function evaluateHealth() {
    const now = Date.now();
    const recentOps = state.recentOperations.filter(
      op => now - op.timestamp < state.rateLimitWindow
    );

    if (recentOps.length === 0) {
      transitionTo(STATES.HEALTHY);
      return;
    }

    const failedOps = recentOps.filter(op => !op.success).length;
    const errorRate = failedOps / recentOps.length;
    const failureCount = state.consecutiveFailures;
    const errorCount = state.consecutiveErrors;

    // Determinar estado
    if (state.currentState === STATES.BREAKER_OPEN) {
      // Verificar se pode sair do circuit breaker
      const timeSinceLastChange = now - state.lastStateChange;
      if (timeSinceLastChange >= state.thresholds.circuitBreakerResetTime) {
        console.log(`${PREFIX} 🔋 Circuit breaker resetado após ${timeSinceLastChange}ms`);
        transitionTo(STATES.HEALTHY);
      }
      return;
    }

    if (failureCount >= state.thresholds.consecutiveFailuresThreshold ||
        errorRate >= state.thresholds.failureRateThreshold) {
      transitionTo(STATES.BREAKER_OPEN);
      return;
    }

    if (errorCount >= state.thresholds.consecutiveErrorsThreshold ||
        errorRate >= state.thresholds.errorRateThreshold) {
      transitionTo(STATES.CRITICAL);
      return;
    }

    if (errorRate > 0.1) {
      transitionTo(STATES.DEGRADED);
      return;
    }

    transitionTo(STATES.HEALTHY);
  }

  function transitionTo(newState) {
    if (state.currentState === newState) return;

    const oldState = state.currentState;
    state.currentState = newState;
    state.lastStateChange = Date.now();

    const messages = {
      [STATES.HEALTHY]: '✅ Sistema saudável',
      [STATES.DEGRADED]: '⚠️ Sistema degradado - taxa de erro elevada',
      [STATES.CRITICAL]: '🔴 Sistema crítico - taxa de falha crítica',
      [STATES.BREAKER_OPEN]: '🛑 CIRCUIT BREAKER ATIVADO - Sistema pausado'
    };

    console.warn(`${PREFIX} Estado: ${oldState} → ${newState} | ${messages[newState]}`);

    if (newState === STATES.BREAKER_OPEN) {
      createAlert('circuit-breaker', `Circuit breaker ativado. Sistema pausará por ${state.thresholds.circuitBreakerResetTime / 1000}s`);
    }
  }

  function canExecuteOperation(operationType) {
    if (state.currentState === STATES.BREAKER_OPEN) {
      return {
        allowed: false,
        reason: 'Circuit breaker ativo - sistema pausado'
      };
    }

    if (state.currentState === STATES.CRITICAL) {
      // Permitir apenas leitura e verificações
      if (!['check', 'read', 'verify', 'test'].includes(operationType)) {
        return {
          allowed: false,
          reason: 'Sistema em estado crítico - operações bloqueadas'
        };
      }
    }

    // Rate limiting
    const now = Date.now();
    const recentOps = state.recentOperations.filter(
      op => now - op.timestamp < state.rateLimitWindow
    );

    if (recentOps.length >= state.rateLimitMax) {
      return {
        allowed: false,
        reason: `Rate limit atingido (${state.rateLimitMax} ops/min)`
      };
    }

    return { allowed: true };
  }

  function validateBetRisk(stake, saldoAtual, bancaInicial) {
    const validations = [];
    const isRisky = [];

    // 1. Stake não pode ser > 5% da banca atual
    const maxStakePct = 5;
    const maxStake = (saldoAtual * maxStakePct) / 100;
    if (stake > maxStake) {
      validations.push(`Stake ${stake} ultrapassa ${maxStakePct}% da banca (max: ${maxStake.toFixed(2)})`);
      isRisky.push('oversized-stake');
    }

    // 2. Saldo não pode cair abaixo de 20% da banca inicial
    const minBalance = (bancaInicial * 20) / 100;
    if (saldoAtual - stake < minBalance) {
      validations.push(`Stake deixaria saldo abaixo de 20% da banca inicial (min: ${minBalance.toFixed(2)})`);
      isRisky.push('insufficient-bankroll');
    }

    // 3. Não apostar com menos de 10% da banca em caixa
    if (saldoAtual < bancaInicial * 0.1) {
      validations.push('Saldo abaixo de 10% da banca inicial');
      isRisky.push('low-bankroll');
    }

    return {
      valid: isRisky.length === 0,
      riskFactors: isRisky,
      validations
    };
  }

  function createAlert(tipo, mensagem) {
    const alert = {
      id: `alert-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      tipo,
      mensagem,
      timestamp: Date.now(),
      lido: false
    };

    state.alerts.push(alert);
    if (state.alerts.length > 50) {
      state.alerts = state.alerts.slice(-50);
    }

    console.error(`${PREFIX} 🚨 ALERTA: [${tipo.toUpperCase()}] ${mensagem}`);

    // Notificar via eventos
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('betboom-safety-alert', {
        detail: alert
      }));
    }

    return alert;
  }

  function getStatus() {
    const now = Date.now();
    const recentOps = state.recentOperations.filter(
      op => now - op.timestamp < state.rateLimitWindow
    );

    const failedOps = recentOps.filter(op => !op.success).length;
    const errorRate = recentOps.length > 0 ? failedOps / recentOps.length : 0;

    return {
      currentState: state.currentState,
      healthy: state.currentState === STATES.HEALTHY,
      errorRate: Number((errorRate * 100).toFixed(1)),
      consecutiveErrors: state.consecutiveErrors,
      consecutiveFailures: state.consecutiveFailures,
      recentOperations: recentOps.length,
      pendingAlerts: state.alerts.filter(a => !a.lido).length,
      timeSinceStateChange: now - state.lastStateChange
    };
  }

  function acknowledgeAlert(alertId) {
    const alert = state.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.lido = true;
    }
  }

  function reset() {
    state.consecutiveErrors = 0;
    state.consecutiveFailures = 0;
    transitionTo(STATES.HEALTHY);
    console.log(`${PREFIX} ✅ Sistema resetado`);
  }

  return {
    recordOperation,
    canExecuteOperation,
    validateBetRisk,
    createAlert,
    acknowledgeAlert,
    getStatus,
    reset,
    recordOperationSuccess: (type) => recordOperation(type, true),
    recordOperationFailure: (type) => recordOperation(type, false)
  };
})();

// Auto-inicializar
if (typeof window !== 'undefined') {
  window.SafetyGovernance = SafetyGovernance;
  console.log('[SafetyGovernance] ✅ Módulo carregado');
}
