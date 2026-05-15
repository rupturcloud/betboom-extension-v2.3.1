/**
 * Temporal Confidence Engine
 * Confiança que decai com o tempo (sinais antigos = menos confiáveis)
 * Comportamento humano: recency bias
 */

const TemporalConfidenceEngine = (() => {
  const confidenceSamples = [];
  const decayHalfLife = 1800000; // 30 minutos — após isso, confiança cai 50%

  function calculateTemporalConfidence(baseConfidence, ageMs) {
    // Decay exponencial: C(t) = C0 * e^(-t/halfLife)
    const decayFactor = Math.exp(-ageMs / decayHalfLife);
    return Math.round(baseConfidence * decayFactor);
  }

  function recordConfidenceSnapshot(pattern, confidence, context = {}) {
    confidenceSamples.push({
      pattern: pattern?.nome || 'unknown',
      baseConfidence: confidence,
      recordedAt: Date.now(),
      context: {
        stability: context.stability || 50,
        consensusAgreement: context.consensusAgreement || 50,
        historicalWinRate: context.historicalWinRate || 50
      }
    });

    if (confidenceSamples.length > 500) confidenceSamples.shift();
  }

  function getTemporalConfidenceAtTime(timestamp) {
    // Dado um tempo específico no passado, qual era a confiança "útil"
    const sample = confidenceSamples.find(s => s.recordedAt === timestamp);
    if (!sample) return null;

    const ageMs = Date.now() - sample.recordedAt;
    return {
      recordedAt: sample.recordedAt,
      baseConfidence: sample.baseConfidence,
      currentValue: calculateTemporalConfidence(sample.baseConfidence, ageMs),
      ageMs,
      decayPercentage: Math.round((1 - Math.exp(-ageMs / decayHalfLife)) * 100)
    };
  }

  function getWeightedConfidenceWindow(windowMs = 300000) {
    // Últimos N ms, ponderados por decaimento temporal
    const now = Date.now();
    const relevant = confidenceSamples.filter(s => now - s.recordedAt <= windowMs);

    if (relevant.length === 0) return 0;

    let weightedSum = 0;
    let totalWeight = 0;

    relevant.forEach(sample => {
      const ageMs = now - sample.recordedAt;
      const weight = Math.exp(-ageMs / decayHalfLife);
      weightedSum += sample.baseConfidence * weight;
      totalWeight += weight;
    });

    return Math.round(weightedSum / totalWeight);
  }

  function predictConfidenceTrend(windowSize = 10) {
    // Tendência: confiança está subindo ou caindo?
    const recent = confidenceSamples.slice(-windowSize);
    if (recent.length < 2) return null;

    const half = Math.floor(recent.length / 2);
    const oldHalf = recent.slice(0, half);
    const newHalf = recent.slice(half);

    const oldAvg = oldHalf.reduce((sum, s) => sum + s.baseConfidence, 0) / oldHalf.length;
    const newAvg = newHalf.reduce((sum, s) => sum + s.baseConfidence, 0) / newHalf.length;

    const trend = newAvg - oldAvg;
    const trendPercent = (trend / oldAvg) * 100;

    return {
      trend: Math.sign(trend) === 1 ? 'UP' : Math.sign(trend) === -1 ? 'DOWN' : 'STABLE',
      percentChange: Math.round(trendPercent),
      oldAvg: Math.round(oldAvg),
      newAvg: Math.round(newAvg),
      direction: trend > 2 ? 'improving' : trend < -2 ? 'degrading' : 'stable'
    };
  }

  function getConfidenceHalfLife() {
    return decayHalfLife;
  }

  return {
    calculateTemporalConfidence,
    recordConfidenceSnapshot,
    getTemporalConfidenceAtTime,
    getWeightedConfidenceWindow,
    predictConfidenceTrend,
    getConfidenceHalfLife,
    getHistory: (limit = 50) => confidenceSamples.slice(-limit)
  };
})();

window.TemporalConfidenceEngine = TemporalConfidenceEngine;
