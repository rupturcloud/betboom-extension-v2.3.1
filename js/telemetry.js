/**
 * BetBoom Telemetry Collector v1.0
 * ==============================
 * Coleta métricas de performance em tempo real:
 * - Latência de detecção (chip, padrão, clique)
 * - Taxa de sucesso de operações
 * - Erros e bloqueios
 * - Comportamento do sistema
 *
 * Responsabilidades:
 * - Medir tempo de cada operação crítica
 * - Agregar métricas por tipo de operação
 * - Calcular percentis e p99
 * - Registrar anomalias
 * - Persistir snapshots em localStorage
 */

const TelemetryCollector = (() => {
  const PREFIX = '[Telemetry]';
  const STORAGE_KEY = 'bb_telemetry_metrics';
  const MAX_METRICS = 1000;

  let metrics = [];
  let currentSession = null;
  let operationStack = [];

  function generateSessionId() {
    return `telem-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  }

  function initSession() {
    currentSession = {
      id: generateSessionId(),
      startedAt: Date.now(),
      operationCount: 0,
      totalLatency: 0,
      errors: [],
      anomalies: []
    };
    console.log(`${PREFIX} ✅ Sessão iniciada: ${currentSession.id}`);
  }

  function recordMetric(operationType, data) {
    const metric = {
      timestamp: Date.now(),
      operationType, // detection_chip, detection_pattern, click_execution, decision_cycle, etc
      sessionId: currentSession?.id || null,
      duration: data.duration || null, // milliseconds
      success: data.success !== false,
      error: data.error || null,
      metadata: data.metadata || {}
    };

    metrics.push(metric);
    if (currentSession) {
      currentSession.operationCount += 1;
      if (data.duration) {
        currentSession.totalLatency += data.duration;
      }
    }

    // Manter limite
    if (metrics.length > MAX_METRICS) {
      metrics = metrics.slice(-MAX_METRICS);
    }

    persistToStorage();
    return metric;
  }

  function startOperation(operationType) {
    const op = {
      operationType,
      startedAt: Date.now(),
      sessionId: currentSession?.id || null
    };
    operationStack.push(op);
    return op;
  }

  function endOperation(op, success = true, error = null) {
    if (!op) return null;

    const duration = Date.now() - op.startedAt;
    const metric = recordMetric(op.operationType, {
      duration,
      success,
      error,
      metadata: { startedAt: op.startedAt, sessionId: op.sessionId }
    });

    operationStack = operationStack.filter(item => item !== op);

    if (error || duration > 1000) {
      console.warn(`${PREFIX} ⚠️ Operação lenta/erro: ${op.operationType} | ${duration}ms | ${error || 'sucesso'}`);
      if (currentSession && (error || duration > 1000)) {
        if (error) {
          currentSession.errors.push({ operationType: op.operationType, error, timestamp: Date.now() });
        }
        if (duration > 1000) {
          currentSession.anomalies.push({ operationType: op.operationType, duration, timestamp: Date.now() });
        }
      }
    }

    return metric;
  }

  function persistToStorage() {
    try {
      const toSave = metrics.slice(-100); // Últimas 100 métricas
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch (e) {
      console.warn(`${PREFIX} ⚠️ Falha ao persistir telemetria:`, e.message);
    }
  }

  function loadFromStorage() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        metrics = JSON.parse(saved);
        console.log(`${PREFIX} ✅ Carregadas ${metrics.length} métricas do storage`);
      }
    } catch (e) {
      console.warn(`${PREFIX} ⚠️ Falha ao carregar telemetria:`, e.message);
      metrics = [];
    }
  }

  function calculatePercentile(arr, percentile) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  function getMetricsByType(operationType) {
    return metrics.filter(m => m.operationType === operationType);
  }

  function getStats(operationType = null) {
    const filtered = operationType
      ? getMetricsByType(operationType)
      : metrics;

    if (filtered.length === 0) {
      return {
        count: 0,
        successRate: 0,
        avgLatency: 0,
        p50Latency: 0,
        p95Latency: 0,
        p99Latency: 0,
        maxLatency: 0,
        errors: 0
      };
    }

    const durations = filtered.filter(m => m.duration !== null).map(m => m.duration);
    const successCount = filtered.filter(m => m.success).length;
    const errorCount = filtered.filter(m => !m.success).length;

    return {
      count: filtered.length,
      successRate: Number(((successCount / filtered.length) * 100).toFixed(1)),
      avgLatency: durations.length ? Number((durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(2)) : 0,
      p50Latency: calculatePercentile(durations, 50),
      p95Latency: calculatePercentile(durations, 95),
      p99Latency: calculatePercentile(durations, 99),
      maxLatency: Math.max(...durations, 0),
      errors: errorCount
    };
  }

  function getDashboard() {
    const operationTypes = Array.from(new Set(metrics.map(m => m.operationType)));
    const dashboard = {
      sessionId: currentSession?.id,
      startedAt: currentSession?.startedAt,
      totalOperations: currentSession?.operationCount || 0,
      avgLatency: currentSession?.operationCount ? (currentSession.totalLatency / currentSession.operationCount).toFixed(2) : 0,
      totalErrors: currentSession?.errors.length || 0,
      totalAnomalies: currentSession?.anomalies.length || 0,
      byOperation: {}
    };

    operationTypes.forEach(type => {
      dashboard.byOperation[type] = getStats(type);
    });

    return dashboard;
  }

  function recordDetectionLatency(chipValue, duration, success) {
    return recordMetric('detection_chip', {
      duration,
      success,
      metadata: { chipValue }
    });
  }

  function recordPatternDetectionLatency(patternName, duration, success) {
    return recordMetric('detection_pattern', {
      duration,
      success,
      metadata: { patternName }
    });
  }

  function recordClickExecution(alvo, duration, success, error = null) {
    return recordMetric('click_execution', {
      duration,
      success,
      error,
      metadata: { alvo }
    });
  }

  function recordDecisionCycle(duration, success, error = null) {
    return recordMetric('decision_cycle', {
      duration,
      success,
      error
    });
  }

  function recordIdempotencyCheck(roundId, passed, reason = null) {
    return recordMetric('idempotency_check', {
      duration: 0,
      success: passed,
      error: reason,
      metadata: { roundId }
    });
  }

  function recordEvidenceLog(eventType, duration, success) {
    return recordMetric('evidence_log', {
      duration,
      success,
      metadata: { eventType }
    });
  }

  function clearAll() {
    metrics = [];
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (_) {}
    console.log(`${PREFIX} 🗑️ Telemetria limpa`);
  }

  return {
    init: initSession,
    recordMetric,
    startOperation,
    endOperation,
    recordDetectionLatency,
    recordPatternDetectionLatency,
    recordClickExecution,
    recordDecisionCycle,
    recordIdempotencyCheck,
    recordEvidenceLog,
    getStats,
    getDashboard,
    getMetricsByType,
    clearAll,
    reload: loadFromStorage
  };
})();

// Auto-inicializar
if (typeof window !== 'undefined') {
  TelemetryCollector.reload();
  TelemetryCollector.init();
  window.TelemetryCollector = TelemetryCollector;
  console.log('[Telemetry] ✅ Módulo carregado e inicializado');
}
