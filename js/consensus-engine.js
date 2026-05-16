/**
 * Consensus Engine — Resolver conflitos entre estratégias
 * Vota entre padrões detectados, resuelve desacordos
 */

const ConsensusEngine = (() => {
  const consensusHistory = [];

  function resolveConsensus(detectedPatterns = []) {
    if (detectedPatterns.length === 0) {
      return createConsensusResult('NO_SIGNAL', [], 0);
    }

    // Agrupar por ação (CASA vs FORA)
    const byAction = {};
    detectedPatterns.forEach(p => {
      const action = p.enter || p.acao || 'unknown';
      if (!byAction[action]) byAction[action] = [];
      byAction[action].push(p);
    });

    // Contar votos
    const votes = Object.entries(byAction).map(([action, patterns]) => ({
      action,
      count: patterns.length,
      patterns,
      avgConfidence: patterns.reduce((sum, p) => sum + (p.confianca || 0), 0) / patterns.length,
      avgConviction: patterns.reduce((sum, p) => sum + (p.conviction || 0), 0) / patterns.length
    }));

    // Ordenar por votação
    votes.sort((a, b) => b.count - a.count || b.avgConfidence - a.avgConfidence);

    const dominantVote = votes[0];
    const minorityVotes = votes.slice(1);

    // Calcular agreement
    const totalVotes = detectedPatterns.length;
    const agreementScore = Math.round((dominantVote.count / totalVotes) * 100);

    // Detectar conflito
    const hasConflict = minorityVotes.length > 0 && minorityVotes[0].count > totalVotes * 0.25;

    const consensus = createConsensusResult(
      dominantVote.action,
      dominantVote.patterns,
      agreementScore,
      {
        dominantVote,
        minorityVotes,
        hasConflict,
        conflictingStrategies: hasConflict
          ? minorityVotes[0].patterns.map(p => p.nome)
          : [],
        allVotes: votes
      }
    );

    consensusHistory.push(consensus);
    if (consensusHistory.length > 500) consensusHistory.shift();

    return consensus;
  }

  function createConsensusResult(action, patterns, agreement, metadata = {}) {
    return {
      dominantSignal: action,
      agreementScore: agreement,
      patternCount: patterns.length,
      dominantPatterns: patterns.map(p => p.nome),
      conflictingStrategies: metadata.conflictingStrategies || [],
      consensusStrength: agreement > 75 ? 'STRONG' : agreement > 50 ? 'MODERATE' : 'WEAK',
      hasConflict: metadata.hasConflict || false,
      finalDecisionReason: buildDecisionReason(action, agreement, patterns),
      metadata,
      timestamp: Date.now()
    };
  }

  function buildDecisionReason(action, agreement, patterns) {
    if (agreement === 0) return 'Sem sinal detectado';

    const patternNames = patterns.slice(0, 3).map(p => p.nome).join(', ');
    const strength = agreement > 75 ? 'forte' : agreement > 50 ? 'moderado' : 'fraco';

    return `${action} com ${strength} consenso (${agreement}%): ${patternNames}${patterns.length > 3 ? ` + ${patterns.length - 3} outros` : ''}`;
  }

  // Detectar conflito entre estratégias opostas
  function detectConflict(patterns) {
    const actions = {};
    patterns.forEach(p => {
      const action = p.enter || p.acao;
      actions[action] = (actions[action] || 0) + 1;
    });

    const actionList = Object.entries(actions).sort((a, b) => b[1] - a[1]);

    if (actionList.length < 2) return null;

    const dominant = actionList[0][1];
    const minority = actionList[1][1];

    const conflictRatio = minority / (dominant + minority);

    return {
      hasConflict: conflictRatio > 0.25,
      conflictRatio: Math.round(conflictRatio * 100),
      dominantAction: actionList[0][0],
      minorityAction: actionList[1][0],
      dominantCount: dominant,
      minorityCount: minority
    };
  }

  // Resumir histórico de consenso
  function getConsensusStats(windowSize = 50) {
    const recent = consensusHistory.slice(-windowSize);

    if (recent.length === 0) return null;

    return {
      totalRounds: recent.length,
      avgAgreement: Math.round(
        recent.reduce((sum, c) => sum + c.agreementScore, 0) / recent.length
      ),
      strongConsensusRounds: recent.filter(c => c.agreementScore > 75).length,
      conflictRounds: recent.filter(c => c.hasConflict).length,
      conflictRate: Math.round(
        (recent.filter(c => c.hasConflict).length / recent.length) * 100
      ),
      strengthDistribution: {
        strong: recent.filter(c => c.consensusStrength === 'STRONG').length,
        moderate: recent.filter(c => c.consensusStrength === 'MODERATE').length,
        weak: recent.filter(c => c.consensusStrength === 'WEAK').length
      }
    };
  }

  function getHistory(limit = 50) {
    return consensusHistory.slice(-limit);
  }

  return {
    resolveConsensus,
    detectConflict,
    getConsensusStats,
    getHistory
  };
})();

window.ConsensusEngine = ConsensusEngine;
