/**
 * Behavior Drift Engine
 * Detectar quando comportamento do sistema muda (padrões de decisão, taxa de acerto, etc)
 */

const BehaviorDriftEngine = (() => {
  const behaviorSamples = []; // histórico de comportamento
  const decisionPatterns = new Map(); // padrão → frequência
  const thresholds = {
    driftThreshold: 15, // % de mudança antes de alertar
    minSamplesForDrift: 20
  };

  function recordBehavior(round) {
    // round: { pattern, decision, result, confidence, timestamp }
    behaviorSamples.push({
      pattern: round.pattern?.nome || 'unknown',
      decision: round.decision || 'no_decision',
      result: round.result || 'pending', // win/loss/no_result
      confidence: round.confidence || 0,
      conviction: round.conviction || 0,
      timestamp: Date.now(),
      winRate: calculateWinRateAtMoment(round.result === 'win')
    });

    // Rastrear frequência de padrões
    const patternName = round.pattern?.nome || 'unknown';
    decisionPatterns.set(patternName, (decisionPatterns.get(patternName) || 0) + 1);

    if (behaviorSamples.length > 1000) behaviorSamples.shift();
  }

  function calculateWinRateAtMoment(isWin) {
    // Calcular taxa de vitória nas últimas 30 rodadas
    const recent = behaviorSamples.slice(-30);
    if (recent.length === 0) return 0;

    const wins = recent.filter(s => s.result === 'win').length;
    return Math.round((wins / recent.length) * 100);
  }

  function detectBehaviorDrift(windowSize = 50) {
    if (behaviorSamples.length < windowSize * 2) return null;

    // Dividir histórico em dois períodos
    const all = behaviorSamples.slice(-windowSize * 2);
    const oldPeriod = all.slice(0, windowSize);
    const newPeriod = all.slice(windowSize);

    // Métricas do período antigo
    const oldMetrics = {
      avgConfidence: oldPeriod.reduce((sum, s) => sum + s.confidence, 0) / oldPeriod.length,
      avgConviction: oldPeriod.reduce((sum, s) => sum + s.conviction, 0) / oldPeriod.length,
      winRate: (oldPeriod.filter(s => s.result === 'win').length / oldPeriod.length) * 100,
      decisionRate: (oldPeriod.filter(s => s.decision !== 'no_decision').length / oldPeriod.length) * 100
    };

    // Métricas do período novo
    const newMetrics = {
      avgConfidence: newPeriod.reduce((sum, s) => sum + s.confidence, 0) / newPeriod.length,
      avgConviction: newPeriod.reduce((sum, s) => sum + s.conviction, 0) / newPeriod.length,
      winRate: (newPeriod.filter(s => s.result === 'win').length / newPeriod.length) * 100,
      decisionRate: (newPeriod.filter(s => s.decision !== 'no_decision').length / newPeriod.length) * 100
    };

    // Calcular mudanças percentuais
    const changes = {
      confidence: ((newMetrics.avgConfidence - oldMetrics.avgConfidence) / oldMetrics.avgConfidence) * 100,
      conviction: ((newMetrics.avgConviction - oldMetrics.avgConviction) / oldMetrics.avgConviction) * 100,
      winRate: newMetrics.winRate - oldMetrics.winRate,
      decisionRate: newMetrics.decisionRate - oldMetrics.decisionRate
    };

    // Detectar drifts significativos
    const drifts = [];
    if (Math.abs(changes.confidence) > thresholds.driftThreshold) {
      drifts.push({
        metric: 'confidence',
        direction: changes.confidence > 0 ? 'UP' : 'DOWN',
        changePercent: Math.round(changes.confidence),
        from: Math.round(oldMetrics.avgConfidence),
        to: Math.round(newMetrics.avgConfidence)
      });
    }

    if (Math.abs(changes.conviction) > thresholds.driftThreshold) {
      drifts.push({
        metric: 'conviction',
        direction: changes.conviction > 0 ? 'UP' : 'DOWN',
        changePercent: Math.round(changes.conviction),
        from: Math.round(oldMetrics.avgConviction),
        to: Math.round(newMetrics.avgConviction)
      });
    }

    if (Math.abs(changes.winRate) > 10) { // 10 pontos percentuais
      drifts.push({
        metric: 'winRate',
        direction: changes.winRate > 0 ? 'UP' : 'DOWN',
        changePercent: Math.round(changes.winRate),
        from: Math.round(oldMetrics.winRate),
        to: Math.round(newMetrics.winRate)
      });
    }

    if (Math.abs(changes.decisionRate) > 15) {
      drifts.push({
        metric: 'decisionRate',
        direction: changes.decisionRate > 0 ? 'UP' : 'DOWN',
        changePercent: Math.round(changes.decisionRate),
        from: Math.round(oldMetrics.decisionRate),
        to: Math.round(newMetrics.decisionRate)
      });
    }

    return {
      hasDrift: drifts.length > 0,
      driftCount: drifts.length,
      drifts,
      severity: drifts.length >= 2 ? 'HIGH' : drifts.length >= 1 ? 'MEDIUM' : 'LOW',
      oldMetrics,
      newMetrics
    };
  }

  function getPatternDistribution() {
    const total = Array.from(decisionPatterns.values()).reduce((a, b) => a + b, 0);
    const distribution = Array.from(decisionPatterns.entries()).map(([pattern, count]) => ({
      pattern,
      count,
      percentage: Math.round((count / total) * 100)
    })).sort((a, b) => b.count - a.count);

    return distribution;
  }

  function isPatternsHealthy() {
    const distribution = getPatternDistribution();
    if (distribution.length === 0) return true;

    // Verificar se um padrão domina demais (>70%)
    const topPattern = distribution[0];
    if (topPattern.percentage > 70) {
      return {
        healthy: false,
        reason: `Pattern ${topPattern.pattern} dominates ${topPattern.percentage}% of decisions`,
        dominantPattern: topPattern.pattern,
        dominantPercent: topPattern.percentage
      };
    }

    // Verificar entropia mínima
    if (distribution.length < 3) {
      return {
        healthy: false,
        reason: `Only ${distribution.length} patterns used, expected >= 3`,
        patternCount: distribution.length
      };
    }

    return { healthy: true, reason: 'Pattern distribution healthy' };
  }

  return {
    recordBehavior,
    detectBehaviorDrift,
    getPatternDistribution,
    isPatternsHealthy,
    getHistory: (limit = 100) => behaviorSamples.slice(-limit),
    setDriftThreshold: (value) => { thresholds.driftThreshold = value; }
  };
})();

window.BehaviorDriftEngine = BehaviorDriftEngine;
