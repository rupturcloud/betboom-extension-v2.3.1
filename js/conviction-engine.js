/**
 * Conviction Engine — Separação de Confidence vs Conviction
 * Confidence: qual padrão casou (F1 score)
 * Conviction: deve EXECUTAR agora? (prontidão operacional)
 */

const ConvictionEngine = (() => {
  const convictionHistory = [];

  function calculateConviction(context = {}) {
    const {
      confidence = 0,
      consensusAgreement = 0,
      contextStability = 0,
      operatorTrust = 0,
      riskLevel = 0,
      balanceSafety = 0,
      executionHistoryWinRate = 0,
      strategySimilarity = 0,
      timeoutPressure = 0,
      chipDetectionQuality = 0
    } = context;

    // Fatores de CONFIANÇA na decisão
    const decisionConfidence = (
      confidence * 0.35 +
      consensusAgreement * 0.20 +
      strategySimilarity * 0.15
    ) / 0.70;

    // Fatores de PRONTIDÃO OPERACIONAL
    const operationalReadiness = (
      contextStability * 0.25 +
      chipDetectionQuality * 0.20 +
      balanceSafety * 0.20 +
      operatorTrust * 0.20 +
      executionHistoryWinRate * 0.15
    ) / 1.0;

    // Fatores de HESITAÇÃO
    const hesitationFactors = [];
    if (contextStability < 60) hesitationFactors.push('contextUnstable');
    if (consensusAgreement < 50) hesitationFactors.push('weakConsensus');
    if (operatorTrust < 60) hesitationFactors.push('lowOperatorTrust');
    if (riskLevel > 70) hesitationFactors.push('highRisk');
    if (chipDetectionQuality < 70) hesitationFactors.push('poorChipDetection');

    // Fatores de CONFIANÇA
    const trustFactors = [];
    if (contextStability > 75) trustFactors.push('stableContext');
    if (consensusAgreement > 75) trustFactors.push('strongConsensus');
    if (executionHistoryWinRate > 65) trustFactors.push('positiveHistory');
    if (balanceSafety > 80) trustFactors.push('bankrollSafe');

    // Pressão OPERACIONAL (timeout, sequência de losses, etc)
    const executionPressure = Math.min(
      Math.max(timeoutPressure * 0.5, 0), // Timeout natural
      100
    );

    // Segurança OPERACIONAL (bankroll, gale limit, etc)
    const operationalSafety = Math.max(
      Math.min(balanceSafety, 100) -
      (Math.max(riskLevel - 50, 0) * 0.5), // Risco reduz segurança
      0
    );

    // CONVICTION SCORE — Prontidão para executar
    // Combina: decisão confiante + operação segura - hesitação
    const convictionScore = Math.max(
      Math.min(
        (decisionConfidence * 0.40 +
         operationalReadiness * 0.40 +
         operationalSafety * 0.20) -
        (hesitationFactors.length * 5), // Penalidade por hesitação
        100
      ),
      0
    );

    // Determinação final de PRONTIDÃO
    let executionReadiness = 'BLOCKED';
    let recommendation = 'NÃO_EXECUTAR';

    if (convictionScore >= 80) {
      executionReadiness = 'READY';
      recommendation = 'EXECUTAR';
    } else if (convictionScore >= 65) {
      executionReadiness = 'CAUTION';
      recommendation = 'EXECUTAR_COM_CAUTELA';
    } else if (convictionScore >= 50) {
      executionReadiness = 'HESITANT';
      recommendation = 'HESITAR_AGUARDAR_SINAL';
    } else {
      executionReadiness = 'BLOCKED';
      recommendation = 'BLOQUEAR_RISCO_ALTO';
    }

    const conviction = {
      convictionScore: Math.round(convictionScore),
      executionReadiness,
      recommendation,
      components: {
        decisionConfidence: Math.round(decisionConfidence),
        operationalReadiness: Math.round(operationalReadiness),
        operationalSafety: Math.round(operationalSafety),
        executionPressure: Math.round(executionPressure)
      },
      factors: {
        hesitationFactors,
        trustFactors,
        hesitationCount: hesitationFactors.length,
        trustCount: trustFactors.length
      },
      timestamp: Date.now()
    };

    convictionHistory.push(conviction);
    if (convictionHistory.length > 1000) convictionHistory.shift();

    return conviction;
  }

  // Explicar hesitação
  function explainHesitation(hesitationFactors = []) {
    const explanations = {
      contextUnstable: 'Contexto volatilizado — predições menos confiáveis',
      weakConsensus: 'Estratégias conflitam — baixa concordância (agreement < 50)',
      lowOperatorTrust: 'Operador duvidoso — histórico de rejeições',
      highRisk: 'Risco operacional alto — bankroll em risco',
      poorChipDetection: 'Fichas detectadas com baixa qualidade — click pode falhar',
      balanceLow: 'Saldo próximo do limite de stop loss',
      galeProgression: 'Progressão de gale avançada — próximo loss crítico'
    };

    return hesitationFactors.map(f => explanations[f] || f);
  }

  // Explicar confiança
  function explainTrust(trustFactors = []) {
    const explanations = {
      stableContext: 'Contexto estável — padrões previsíveis',
      strongConsensus: 'Estratégias concordam — sinal forte',
      positiveHistory: 'Histórico positivo — padrão validado',
      bankrollSafe: 'Bankroll seguro — margem confortável',
      highConfidence: 'Padrão casou com alta confiança (85%+)'
    };

    return trustFactors.map(f => explanations[f] || f);
  }

  // Explicação natural por faixa de conviction (uso no overlay HITL)
  function explainConviction(conviction) {
    if (!conviction || typeof conviction.convictionScore !== 'number') {
      return 'Aguardando sinal...';
    }
    const score = conviction.convictionScore;
    if (score >= 88) return 'Sinal excelente — alta confiança operacional';
    if (score >= 80) return 'Bom sinal — executando com supervisão';
    if (score >= 65) return 'Sinal moderado — aguardar confirmação humana';
    if (score >= 50) return 'Sinal fraco — sugere hesitar';
    return 'Sinal de risco — recomendado bloquear';
  }

  // Detectar mudança de conviction (drift)
  function detectConvictionDrift(windowSize = 10) {
    if (convictionHistory.length < windowSize) return null;

    const recent = convictionHistory.slice(-windowSize);
    const avgRecent = recent.reduce((sum, c) => sum + c.convictionScore, 0) / windowSize;

    const previous = convictionHistory.slice(-windowSize * 2, -windowSize);
    const avgPrevious = previous.length > 0
      ? previous.reduce((sum, c) => sum + c.convictionScore, 0) / previous.length
      : avgRecent;

    const driftPercentage = ((avgRecent - avgPrevious) / Math.max(avgPrevious, 1)) * 100;

    return {
      driftPercentage: Math.round(driftPercentage),
      avgRecent: Math.round(avgRecent),
      avgPrevious: Math.round(avgPrevious),
      direction: driftPercentage > 5 ? 'UP' : driftPercentage < -5 ? 'DOWN' : 'STABLE',
      isSignificant: Math.abs(driftPercentage) > 15
    };
  }

  // Histórico
  function getHistory(limit = 50) {
    return convictionHistory.slice(-limit);
  }

  return {
    calculateConviction,
    explainHesitation,
    explainTrust,
    explainConviction,
    detectConvictionDrift,
    getHistory
  };
})();

window.ConvictionEngine = ConvictionEngine;
