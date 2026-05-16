/**
 * Context Health Engine — Monitorar saúde do contexto operacional
 * Estabilidade, volatilidade, entropia, ruído, pureza de sinal
 */

const ContextHealthEngine = (() => {
  const healthHistory = [];
  const rollingWindowSize = 50;

  function assessContextHealth(historico = []) {
    if (historico.length < 4) {
      return createHealthSnapshot({
        stability: 50,
        volatility: 50,
        entropy: 50,
        noise: 50,
        signalPurity: 50,
        predictability: 50,
        degradation: 0,
        confidenceDrift: 0
      });
    }

    // ESTABILIDADE: Consistência de cores nos últimos N
    const stability = calculateStability(historico.slice(-20));

    // VOLATILIDADE: Mudanças rápidas de cor
    const volatility = 100 - stability;

    // ENTROPIA: Variedade de resultados (Shannon entropy)
    const entropy = calculateEntropy(historico.slice(-20));

    // RUÍDO: Sequências curtas anormais
    const noise = calculateNoise(historico.slice(-20));

    // PUREZA DE SINAL: Padrões claros vs aleatório
    const signalPurity = 100 - noise;

    // PREVISIBILIDADE: Baseada em padrões detectáveis
    const predictability = calculatePredictability(historico.slice(-20));

    // DEGRADAÇÃO: Mudança em estabilidade recente
    const degradation = calculateDegradation(historico);

    // DRIFT DE CONFIANÇA: Queda em padrões detectados
    const confidenceDrift = calculateConfidenceDrift(historico);

    return createHealthSnapshot({
      stability,
      volatility,
      entropy,
      noise,
      signalPurity,
      predictability,
      degradation,
      confidenceDrift
    });
  }

  function calculateStability(cores) {
    // Quanto % as cores se repetem
    if (cores.length < 2) return 50;

    let sequenceLengths = 0;
    let currentColor = cores[0];
    let currentSequence = 1;

    for (let i = 1; i < cores.length; i++) {
      if (cores[i] === currentColor) {
        currentSequence++;
      } else {
        sequenceLengths += currentSequence;
        currentColor = cores[i];
        currentSequence = 1;
      }
    }
    sequenceLengths += currentSequence;

    // Média de sequência
    const avgSequenceLength = sequenceLengths / cores.length;
    return Math.min(Math.round(avgSequenceLength * 20), 100);
  }

  function calculateEntropy(cores) {
    // Shannon entropy — quanto de variedade
    const freqs = {};
    cores.forEach(c => freqs[c] = (freqs[c] || 0) + 1);

    const total = cores.length;
    let entropy = 0;
    Object.values(freqs).forEach(count => {
      const p = count / total;
      entropy -= p * Math.log2(p);
    });

    // Normalizar (máximo ~ 1.58 para 3 cores)
    return Math.round((entropy / 1.58) * 100);
  }

  function calculateNoise(cores) {
    // Padrões anormais: sequências muito curtas
    let transitions = 0;
    let singletons = 0;

    for (let i = 0; i < cores.length - 1; i++) {
      if (cores[i] !== cores[i + 1]) transitions++;
    }

    // Muitas transições = ruído
    const transitionRate = (transitions / cores.length) * 100;
    return Math.min(transitionRate, 100);
  }

  function calculatePredictability(cores) {
    // Detectar padrões simples (alternância, sequência)
    let alternations = 0;

    for (let i = 1; i < cores.length; i++) {
      if (cores[i] !== cores[i - 1]) alternations++;
    }

    // Alternação perfeita = altamente previsível
    const alternationRate = (alternations / cores.length) * 100;

    // Buscar sequências repetidas
    let repeatedPatterns = 0;
    const patterns = {};

    for (let i = 0; i < cores.length - 2; i++) {
      const pattern = `${cores[i]}-${cores[i + 1]}-${cores[i + 2]}`;
      patterns[pattern] = (patterns[pattern] || 0) + 1;
    }

    repeatedPatterns = Object.values(patterns).filter(count => count > 1).length;

    // Combinar: alternação + repetição
    const predictability = (alternationRate * 0.5) + (repeatedPatterns * 10);
    return Math.min(Math.round(predictability), 100);
  }

  function calculateDegradation(historico) {
    // Comparar estabilidade recente vs histórica
    if (historico.length < 40) return 0;

    const recent10 = calculateStability(historico.slice(-10));
    const previous10 = calculateStability(historico.slice(-20, -10));

    const degradation = Math.max(previous10 - recent10, 0);
    return degradation;
  }

  function calculateConfidenceDrift(historico) {
    // Simular: estabilidade de histórico pode indicar drift
    if (historico.length < 50) return 0;

    const old = calculateStability(historico.slice(0, 25));
    const new_ = calculateStability(historico.slice(-25));

    const drift = Math.abs(old - new_);
    return Math.round(drift);
  }

  function createHealthSnapshot(metrics) {
    const health = {
      stability: Math.round(metrics.stability),
      volatility: Math.round(metrics.volatility),
      entropy: Math.round(metrics.entropy),
      noise: Math.round(metrics.noise),
      signalPurity: Math.round(metrics.signalPurity),
      predictability: Math.round(metrics.predictability),
      degradation: Math.round(metrics.degradation),
      confidenceDrift: Math.round(metrics.confidenceDrift),
      timestamp: Date.now(),
      warnings: []
    };

    // Gerar alertas
    if (health.volatility > 70) health.warnings.push('HIGH_VOLATILITY');
    if (health.entropy > 80) health.warnings.push('HIGH_ENTROPY');
    if (health.noise > 60) health.warnings.push('HIGH_NOISE');
    if (health.degradation > 20) health.warnings.push('CONTEXT_DEGRADING');
    if (health.confidenceDrift > 15) health.warnings.push('CONFIDENCE_DRIFT');
    if (health.signalPurity < 40) health.warnings.push('WEAK_SIGNAL');

    // Status geral
    health.status = 'HEALTHY';
    if (health.warnings.length >= 2) health.status = 'WARNING';
    if (health.warnings.length >= 3) health.status = 'CRITICAL';

    healthHistory.push(health);
    if (healthHistory.length > rollingWindowSize) healthHistory.shift();

    return health;
  }

  function getHealthStats(windowSize = 20) {
    const recent = healthHistory.slice(-windowSize);

    if (recent.length === 0) return null;

    return {
      avgStability: Math.round(recent.reduce((sum, h) => sum + h.stability, 0) / recent.length),
      avgVolatility: Math.round(recent.reduce((sum, h) => sum + h.volatility, 0) / recent.length),
      avgEntropy: Math.round(recent.reduce((sum, h) => sum + h.entropy, 0) / recent.length),
      avgSignalPurity: Math.round(recent.reduce((sum, h) => sum + h.signalPurity, 0) / recent.length),
      warningCount: recent.filter(h => h.warnings.length > 0).length,
      criticalRounds: recent.filter(h => h.status === 'CRITICAL').length,
      warningRounds: recent.filter(h => h.status === 'WARNING').length,
      healthyRounds: recent.filter(h => h.status === 'HEALTHY').length
    };
  }

  function getHistory(limit = 50) {
    return healthHistory.slice(-limit);
  }

  return {
    assessContextHealth,
    getHealthStats,
    getHistory
  };
})();

window.ContextHealthEngine = ContextHealthEngine;
