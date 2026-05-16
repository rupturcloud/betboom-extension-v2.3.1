/**
 * BetBoom F1 Scorer v1.0
 * =====================
 * Qualifica decisões de apostas usando F1 Score (harmônica de precisão e recall).
 * Integra histórico de estratégia, contexto de mesa e saúde do sistema.
 *
 * Responsabilidades:
 * - Calcular confiança da decisão (0-100)
 * - Ponderar força do padrão, histórico e contexto
 * - Detectar anomalias e degradação de performance
 * - Sugerir ajustes de risk management
 */

const F1Scorer = (() => {
  const PREFIX = '[F1Scorer]';

  /**
   * Estrutura para armazenar métricas por estratégia
   */
  const strategyMetrics = new Map();

  function getOrCreateMetrics(strategyId, strategyName) {
    const key = strategyId || strategyName;
    if (!strategyMetrics.has(key)) {
      strategyMetrics.set(key, {
        nome: strategyName || strategyId,
        totalDisparo: 0,
        totalWins: 0,
        totalLosses: 0,
        totalTies: 0,
        recentDisparo: 0,      // últimos 10
        recentWins: 0,         // últimos 10
        confiancaHistorica: 50, // 0-100
        lastUpdated: Date.now()
      });
    }
    return strategyMetrics.get(key);
  }

  function updateStrategyResult(strategyId, strategyName, resultado) {
    const metrics = getOrCreateMetrics(strategyId, strategyName);

    // Atualizar contadores globais
    metrics.totalDisparo += 1;
    metrics.recentDisparo = Math.min(metrics.recentDisparo + 1, 10);

    if (resultado === 'win') {
      metrics.totalWins += 1;
      metrics.recentWins = Math.min(metrics.recentWins + 1, 10);
    } else if (resultado === 'loss') {
      metrics.totalLosses += 1;
      metrics.recentWins = Math.max(metrics.recentWins - 1, 0);
    } else if (resultado === 'tie') {
      metrics.totalTies += 1;
    }

    // Recalcular confiança histórica
    const totalResolvido = metrics.totalWins + metrics.totalLosses;
    if (totalResolvido > 0) {
      metrics.confiancaHistorica = Number(((metrics.totalWins / totalResolvido) * 100).toFixed(1));
    }

    metrics.lastUpdated = Date.now();
    console.log(`${PREFIX} 📊 Métrica atualizada: ${strategyName} | W=${metrics.totalWins} L=${metrics.totalLosses} | Confiança=${metrics.confiancaHistorica}%`);
  }

  /**
   * Calcula F1 Score para uma decisão
   * F1 = 2 * (precision * recall) / (precision + recall)
   *
   * Neste contexto:
   * - Precision: confiança histórica da estratégia (taxa de acerto)
   * - Recall: força do padrão detectado (0-100)
   * - Resultado: F1 Score combinado (0-100)
   */
  function calculateF1(padraoForça, confiancaEstrategia) {
    const precision = confiancaEstrategia / 100;  // 0-1
    const recall = padraoForça / 100;               // 0-1

    if (precision + recall === 0) return 0;

    const f1 = 2 * (precision * recall) / (precision + recall);
    return Number((f1 * 100).toFixed(1)); // 0-100
  }

  /**
   * Pondera múltiplos fatores para gerar score final
   */
  function scoreDecision(decisao) {
    if (!decisao) return { score: 0, motivos: ['Decisão nula'] };

    const motivos = [];
    let score = 50; // baseline

    // 1. Confiança histórica da estratégia
    const metrics = strategyMetrics.get(decisao.strategyId || decisao.estrategia);
    const confiancaEstr = metrics?.confiancaHistorica || 50;
    const fator1 = confiancaEstr * 0.35; // 35% weight
    score += (fator1 - 50 * 0.35);
    motivos.push(`Histórico estratégia: ${confiancaEstr.toFixed(1)}%`);

    // 2. Força do padrão
    const padraoForça = decisao.decisionModel?.indiceDeConfianca || decisao.confianca || 50;
    const fator2 = padraoForça * 0.35; // 35% weight
    score += (fator2 - 50 * 0.35);
    motivos.push(`Força do padrão: ${padraoForça}%`);

    // 3. F1 Score (combinação de precision x recall)
    const f1 = calculateF1(padraoForça, confiancaEstr);
    const fator3 = f1 * 0.20; // 20% weight
    score += (fator3 - 50 * 0.20);
    motivos.push(`F1 Score: ${f1.toFixed(1)}%`);

    // 4. Contexto da mesa (se disponível)
    if (decisao.decisionModel?.contextoMesa) {
      const contextos = {
        'otima': 100,
        'boa': 80,
        'neutra': 50,
        'ruim': 20,
        'muito-ruim': 0
      };
      const pontuacaoContexto = contextos[decisao.decisionModel.contextoMesa] || 50;
      const fator4 = pontuacaoContexto * 0.10; // 10% weight
      score += (fator4 - 50 * 0.10);
      motivos.push(`Contexto mesa: ${decisao.decisionModel.contextoMesa} (${pontuacaoContexto}%)`);
    }

    // Aplicar penalidades
    if (decisao.decisionModel?.riscoOperacional === 'alto') {
      score -= 15;
      motivos.push('Penalidade: Risco operacional alto');
    }

    // Limitar entre 0 e 100
    score = Math.max(0, Math.min(100, score));

    // Determinar recomendação
    let recomendacao = 'nao-vai';
    if (score >= 75) recomendacao = 'vai-forte';
    else if (score >= 60) recomendacao = 'vai';
    else if (score >= 40) recomendacao = 'revisao';

    return {
      score: Number(score.toFixed(1)),
      recomendacao,
      motivos,
      f1Score: f1,
      confiancaEstrategia: confiancaEstr,
      padraoForça,
      timestamp: Date.now()
    };
  }

  /**
   * Calcula saúde geral do sistema
   */
  function getSystemHealth() {
    if (strategyMetrics.size === 0) {
      return {
        saudavel: true,
        scoreSaude: 100,
        mensagem: 'Nenhuma métrica coletada',
        anomalias: []
      };
    }

    const metricas = Array.from(strategyMetrics.values());
    const anomalias = [];

    // Checar taxa de acerto geral
    let totalWins = 0, totalLosses = 0;
    metricas.forEach(m => {
      totalWins += m.totalWins;
      totalLosses += m.totalLosses;
    });

    let taxaAcertoGeral = 50;
    if (totalWins + totalLosses > 0) {
      taxaAcertoGeral = (totalWins / (totalWins + totalLosses)) * 100;
    }

    let scoreSaude = 100;

    // Penalidade por taxa de acerto baixa
    if (taxaAcertoGeral < 40) {
      anomalias.push(`Taxa de acerto crítica: ${taxaAcertoGeral.toFixed(1)}%`);
      scoreSaude -= 30;
    } else if (taxaAcertoGeral < 50) {
      anomalias.push(`Taxa de acerto abaixo de 50%: ${taxaAcertoGeral.toFixed(1)}%`);
      scoreSaude -= 15;
    }

    // Checar degradação de estratégia
    metricas.forEach(m => {
      if (m.totalDisparo >= 5) {
        const recentTaxaAcerto = m.recentDisparo > 0
          ? (m.recentWins / m.recentDisparo) * 100
          : 50;

        if (recentTaxaAcerto < m.confiancaHistorica - 20) {
          anomalias.push(`Degradação em ${m.nome}: ${recentTaxaAcerto.toFixed(1)}% vs ${m.confiancaHistorica.toFixed(1)}%`);
          scoreSaude -= 10;
        }
      }
    });

    // Penalidade por falta de diversidade
    if (metricas.length < 2) {
      anomalias.push('Poucas estratégias diversificadas');
      scoreSaude -= 5;
    }

    scoreSaude = Math.max(0, Math.min(100, scoreSaude));

    return {
      saudavel: scoreSaude >= 60,
      scoreSaude: Number(scoreSaude.toFixed(1)),
      taxaAcertoGeral: Number(taxaAcertoGeral.toFixed(1)),
      totalDisparo: metricas.reduce((s, m) => s + m.totalDisparo, 0),
      totalEstrategias: metricas.length,
      anomalias,
      metricas: metricas.map(m => ({
        nome: m.nome,
        confianca: m.confiancaHistorica,
        disparos: m.totalDisparo,
        wins: m.totalWins
      }))
    };
  }

  /**
   * Recomenda ajuste de risk management baseado em performance
   */
  function recommendRiskAdjustment(saude, statsGeral) {
    const recomendacoes = [];

    if (saude.scoreSaude < 50) {
      recomendacoes.push({
        tipo: 'reducer-stake',
        percentual: 50,
        motivo: 'Saúde do sistema baixa'
      });
    } else if (saude.scoreSaude < 70) {
      recomendacoes.push({
        tipo: 'reducer-stake',
        percentual: 25,
        motivo: 'Saúde do sistema moderada'
      });
    } else if (saude.scoreSaude >= 85) {
      recomendacoes.push({
        tipo: 'increase-stake',
        percentual: 15,
        motivo: 'Saúde do sistema excelente'
      });
    }

    if (saude.anomalias.length > 0) {
      recomendacoes.push({
        tipo: 'review',
        motivo: `${saude.anomalias.length} anomalia(s) detectada(s)`
      });
    }

    return recomendacoes;
  }

  return {
    scoreDecision,
    updateStrategyResult,
    getSystemHealth,
    recommendRiskAdjustment,
    getStrategyMetrics: (strategyId) => strategyMetrics.get(strategyId),
    getAllMetrics: () => Array.from(strategyMetrics.values()),
    clearMetrics: () => strategyMetrics.clear()
  };
})();

// Auto-inicializar
if (typeof window !== 'undefined') {
  window.F1Scorer = F1Scorer;
  console.log('[F1Scorer] ✅ Módulo carregado');
}
