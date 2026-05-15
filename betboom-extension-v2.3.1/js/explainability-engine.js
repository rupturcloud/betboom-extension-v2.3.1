/**
 * Explainability Engine (Phase 3)
 * Registra e explica cada decisão: por que entrou, por que não, por que hesitou
 * Fornece rastreamento causal e narrativa para auditoria
 */

const ExplainabilityEngine = (() => {
  const explanations = [];
  const decisionTraces = new Map();

  // ═══ 1. PATTERN DETECTION EXPLANATION ═══
  // Explicar por que um padrão foi detectado

  function explicarDeteccaoPadrao(padrao, cores, contexto) {
    const explicacao = {
      tipo: 'pattern_detection',
      timestamp: Date.now(),
      padrao: {
        nome: padrao.nome,
        id: padrao.id,
        confianca: padrao.confianca,
        acao: padrao.acao
      },
      motivos: [],
      evidencias: []
    };

    // Motivo 1: Match com histórico
    if (cores && cores.length > 0) {
      const matches = cores.filter(c => c === padrao.acao).length;
      const percentage = (matches / cores.length) * 100;
      if (matches > 0) {
        explicacao.motivos.push(`Padrão detectado em ${matches} de ${cores.length} rodadas (${Math.round(percentage)}%)`);
        explicacao.evidencias.push({
          tipo: 'historical_match',
          occurrences: matches,
          total: cores.length,
          percentage: Math.round(percentage)
        });
      }
    }

    // Motivo 2: F1 Score
    if (padrao.f1Score || padrao.precision) {
      explicacao.motivos.push(`F1 Score: ${Math.round(padrao.f1Score || padrao.precision * 100)}%`);
      explicacao.evidencias.push({
        tipo: 'f1_score',
        score: padrao.f1Score || padrao.precision
      });
    }

    // Motivo 3: Contexto
    if (contexto?.volatility !== undefined) {
      const saude = 100 - contexto.volatility;
      explicacao.motivos.push(`Saúde do contexto: ${Math.round(saude)}% (volatilidade ${contexto.volatility}%)`);
      explicacao.evidencias.push({
        tipo: 'context_health',
        health: saude,
        volatility: contexto.volatility
      });
    }

    return explicacao;
  }

  // ═══ 2. CONSENSUS EXPLANATION ═══
  // Explicar como o consenso foi alcançado

  function explicarConsensus(consensus, padroes) {
    const explicacao = {
      tipo: 'consensus_resolution',
      timestamp: Date.now(),
      resultado: {
        dominantSignal: consensus.dominantSignal,
        agreementScore: consensus.agreementScore
      },
      motivos: [],
      divergencias: []
    };

    if (!padroes || padroes.length === 0) {
      explicacao.motivos.push('Apenas um padrão detectado (consenso trivial)');
      return explicacao;
    }

    // Analisar votação
    const votacao = {};
    padroes.forEach(p => {
      const acao = p.acao || 'unknown';
      votacao[acao] = (votacao[acao] || 0) + 1;
    });

    const vencedor = Object.entries(votacao).sort((a, b) => b[1] - a[1])[0];
    if (vencedor) {
      const votos = vencedor[1];
      const percentage = (votos / padroes.length) * 100;
      explicacao.motivos.push(`Ação "${vencedor[0]}" venceu com ${votos} de ${padroes.length} votos (${Math.round(percentage)}%)`);
    }

    // Divergências
    Object.entries(votacao).forEach(([acao, votos]) => {
      if (acao !== consensus.dominantSignal) {
        explicacao.divergencias.push({
          acao,
          votos,
          percentual: Math.round((votos / padroes.length) * 100)
        });
      }
    });

    return explicacao;
  }

  // ═══ 3. CONVICTION EXPLANATION ═══
  // Explicar por que conviction foi calculada assim

  function explicarConviccao(conviction, componentes) {
    const explicacao = {
      tipo: 'conviction_calculation',
      timestamp: Date.now(),
      conviction: {
        score: conviction.conviction,
        executionReadiness: conviction.executionReadiness,
        level: conviction.conviction >= 80 ? 'ALTA' : (conviction.conviction >= 65 ? 'MÉDIA' : 'BAIXA')
      },
      motivos: [],
      fatoresPositivos: [],
      fatoresNegativos: []
    };

    // Fatores positivos
    if (componentes?.decisionConfidence >= 70) {
      explicacao.fatoresPositivos.push(`Confiança na decisão: ${componentes.decisionConfidence}%`);
    }

    if (componentes?.operationalReadiness >= 75) {
      explicacao.fatoresPositivos.push(`Prontidão operacional: ${componentes.operationalReadiness}%`);
    }

    if (componentes?.contextStable) {
      explicacao.fatoresPositivos.push('Contexto estável');
    }

    if (componentes?.consensusStrong) {
      explicacao.fatoresPositivos.push('Consenso forte entre padrões');
    }

    if (componentes?.positiveHistory) {
      explicacao.fatoresPositivos.push('Histórico positivo da estratégia');
    }

    // Fatores negativos
    if (componentes?.hesitationFactors?.contextUnstable) {
      explicacao.fatoresNegativos.push('Contexto instável detectado');
    }

    if (componentes?.hesitationFactors?.weakConsensus) {
      explicacao.fatoresNegativos.push('Consenso fraco entre padrões');
    }

    if (componentes?.hesitationFactors?.highRisk) {
      explicacao.fatoresNegativos.push('Risco operacional elevado');
    }

    if (componentes?.hesitationFactors?.lowOperatorTrust) {
      explicacao.fatoresNegativos.push('Baixa confiança no operador');
    }

    // Síntese
    if (conviction.conviction >= 80) {
      explicacao.motivos.push('Conviction ALTA: Todos os sinais verdes, proceder com confiança');
    } else if (conviction.conviction >= 65) {
      explicacao.motivos.push('Conviction MÉDIA: Condições aceitáveis, mas monitorar riscos');
    } else {
      explicacao.motivos.push('Conviction BAIXA: Riscos detectados, não proceder');
    }

    return explicacao;
  }

  // ═══ 4. HESITATION EXPLANATION ═══
  // Explicar por que o sistema hesitou (se hesitou)

  function explicarHesitacao(hesitationFactors, conviction) {
    if (!hesitationFactors || Object.values(hesitationFactors).every(v => !v)) {
      return null;
    }

    const explicacao = {
      tipo: 'hesitation_analysis',
      timestamp: Date.now(),
      hesitou: true,
      motivos: [],
      severidade: 'baixa',
      recomendacao: 'proceder com cautela'
    };

    const fatoresAtivos = [];

    if (hesitationFactors.contextUnstable) {
      fatoresAtivos.push('Contexto instável');
    }
    if (hesitationFactors.weakConsensus) {
      fatoresAtivos.push('Consenso fraco');
    }
    if (hesitationFactors.highRisk) {
      fatoresAtivos.push('Risco alto');
    }
    if (hesitationFactors.lowOperatorTrust) {
      fatoresAtivos.push('Baixa confiança no operador');
    }
    if (hesitationFactors.poorChipDetection) {
      fatoresAtivos.push('Detecção de chip compromised');
    }

    explicacao.motivos = fatoresAtivos;

    // Definir severidade
    if (fatoresAtivos.length >= 3) {
      explicacao.severidade = 'alta';
      explicacao.recomendacao = 'não proceder neste momento';
    } else if (fatoresAtivos.length === 2) {
      explicacao.severidade = 'média';
      explicacao.recomendacao = 'proceder com máxima cautela';
    }

    return explicacao;
  }

  // ═══ 5. BLOCKING EXPLANATION ═══
  // Explicar por que a decisão foi bloqueada

  function explicarBloqueio(motivo, evidencias) {
    return {
      tipo: 'decision_blocking',
      timestamp: Date.now(),
      bloqueado: true,
      motivo,
      evidencias,
      severidade: motivo.includes('CRÍTICA') ? 'critica' : 'normal',
      recomendacao: 'Revisar condições antes de tentar novamente'
    };
  }

  // ═══ 6. DECISION NARRATIVE ═══
  // Gerar narrativa em linguagem natural para uma decisão

  function gerarNarrativaPT(roundId, explicacoes) {
    if (!explicacoes || explicacoes.length === 0) {
      return 'Nenhuma explicação disponível para esta rodada.';
    }

    const partes = [];

    // Abertura
    partes.push(`Análise da Rodada ${roundId}:`);

    // Detecção de padrão
    const deteccao = explicacoes.find(e => e.tipo === 'pattern_detection');
    if (deteccao) {
      partes.push(
        `\n1. **Detecção de Padrão**: ${deteccao.padrao.nome}\n` +
        `   - Confiança: ${deteccao.padrao.confianca}%\n` +
        `   - Ação sugerida: ${deteccao.padrao.acao}\n` +
        `   - ${deteccao.motivos.join('\n   - ')}`
      );
    }

    // Consenso
    const consensus = explicacoes.find(e => e.tipo === 'consensus_resolution');
    if (consensus) {
      const divergText = consensus.divergencias.length > 0
        ? `\n   - Divergências: ${consensus.divergencias.map(d => `${d.acao} (${d.votos} votos)`).join(', ')}`
        : '';
      partes.push(
        `\n2. **Resolução de Consenso**: ${consensus.resultado.dominantSignal}\n` +
        `   - Score de concordância: ${consensus.resultado.agreementScore}%\n` +
        `   - ${consensus.motivos.join('\n   - ')}${divergText}`
      );
    }

    // Convicção
    const conviction = explicacoes.find(e => e.tipo === 'conviction_calculation');
    if (conviction) {
      const positivos = conviction.fatoresPositivos.length > 0
        ? `\n   - Favoráveis: ${conviction.fatoresPositivos.join('; ')}`
        : '';
      const negativos = conviction.fatoresNegativos.length > 0
        ? `\n   - Desfavoráveis: ${conviction.fatoresNegativos.join('; ')}`
        : '';
      partes.push(
        `\n3. **Cálculo de Convicção**: ${conviction.conviction.score}% (${conviction.conviction.level})\n` +
        `   - ${conviction.motivos[0]}${positivos}${negativos}`
      );
    }

    // Hesitação
    const hesitacao = explicacoes.find(e => e.tipo === 'hesitation_analysis');
    if (hesitacao) {
      partes.push(
        `\n4. **Análise de Hesitação**: Severidade ${hesitacao.severidade.toUpperCase()}\n` +
        `   - Motivos: ${hesitacao.motivos.join('; ')}\n` +
        `   - Recomendação: ${hesitacao.recomendacao}`
      );
    }

    // Bloqueio
    const bloqueio = explicacoes.find(e => e.tipo === 'decision_blocking');
    if (bloqueio) {
      partes.push(
        `\n❌ **DECISÃO BLOQUEADA** (${bloqueio.severidade.toUpperCase()})\n` +
        `   - Motivo: ${bloqueio.motivo}\n` +
        `   - ${bloqueio.recomendacao}`
      );
    }

    return partes.join('\n');
  }

  // ═══ 7. DECISION TRACE REGISTRATION ═══
  // Registrar trace completo de uma decisão para auditoria

  function registrarDecisao(roundId, decisao, explicacoes) {
    const trace = {
      roundId,
      timestamp: Date.now(),
      decisaoFinal: decisao.deveApostar ? 'EXECUTADA' : 'REJEITADA',
      detalhe: {
        cor: decisao.cor || null,
        stake: decisao.stake || null,
        padrao: decisao.padrao?.nome || null
      },
      explicacoes,
      narrativaPT: gerarNarrativaPT(roundId, explicacoes)
    };

    explanations.push(trace);
    decisionTraces.set(roundId, trace);

    // Manter apenas últimas 200 decisões
    if (explanations.length > 200) {
      explanations.shift();
    }

    return trace;
  }

  // ═══ 8. ORCHESTRATED EXPLANATION BUILDER ═══
  // Construir explicação completa de uma decisão

  function construirExplicacaoCompleta(roundId, decisao, padrao, consensus, conviction, hesitation, motivoBloqueio) {
    const explicacoes = [];

    // 1. Padrão
    if (padrao) {
      explicacoes.push(explicarDeteccaoPadrao(
        padrao,
        decisao.historico,
        decisao.contexto
      ));
    }

    // 2. Consenso
    if (consensus && padrao) {
      explicacoes.push(explicarConsensus(
        consensus,
        [padrao]
      ));
    }

    // 3. Convicção
    if (conviction) {
      explicacoes.push(explicarConviccao(
        conviction,
        {
          decisionConfidence: padrao?.confianca || 75,
          operationalReadiness: conviction.executionReadiness || 80,
          contextStable: decisao.contexto?.stability > 50,
          consensusStrong: consensus?.agreementScore > 70,
          positiveHistory: true,
          hesitationFactors: hesitation || {}
        }
      ));
    }

    // 4. Hesitação
    if (hesitation) {
      const analiseHesitacao = explicarHesitacao(hesitation, conviction);
      if (analiseHesitacao) {
        explicacoes.push(analiseHesitacao);
      }
    }

    // 5. Bloqueio
    if (motivoBloqueio) {
      explicacoes.push(explicarBloqueio(
        motivoBloqueio,
        { padrao: padrao?.nome, conviction: conviction?.conviction }
      ));
    }

    return explicacoes;
  }

  // ═══ 9. QUERY & RETRIEVAL ═══
  // Recuperar explicações

  function obterExplicacao(roundId) {
    return decisionTraces.get(roundId) || null;
  }

  function obterHistorico(limite = 50) {
    return explanations.slice(-limite);
  }

  function buscarPorMotivo(keyword) {
    return explanations.filter(e => {
      const narrativa = e.narrativaPT.toLowerCase();
      return narrativa.includes(keyword.toLowerCase());
    });
  }

  function obterEstatisticas() {
    const total = explanations.length;
    const executadas = explanations.filter(e => e.decisaoFinal === 'EXECUTADA').length;
    const rejeitadas = total - executadas;

    return {
      total,
      executadas,
      rejeitadas,
      taxaExecucao: total > 0 ? Math.round((executadas / total) * 100) : 0,
      ultimas: explanations.slice(-10).map(e => ({
        roundId: e.roundId,
        decisao: e.decisaoFinal,
        padrao: e.detalhe.padrao
      }))
    };
  }

  // ═══ 10. EXPORT & AUDIT ═══
  // Exportar para auditoria

  function exportarAuditoria(roundIds = null) {
    const dados = roundIds && Array.isArray(roundIds)
      ? explanations.filter(e => roundIds.includes(e.roundId))
      : explanations;

    return {
      exportado: new Date().toISOString(),
      totalDecisoes: dados.length,
      decisoes: dados.map(d => ({
        roundId: d.roundId,
        timestamp: new Date(d.timestamp).toISOString(),
        decisao: d.decisaoFinal,
        detalhes: d.detalhe,
        narrativa: d.narrativaPT
      }))
    };
  }

  return {
    // Explicadores individuais
    explicarDeteccaoPadrao,
    explicarConsensus,
    explicarConviccao,
    explicarHesitacao,
    explicarBloqueio,

    // Narrativa
    gerarNarrativaPT,

    // Construção completa
    construirExplicacaoCompleta,
    registrarDecisao,

    // Consultas
    obterExplicacao,
    obterHistorico,
    buscarPorMotivo,
    obterEstatisticas,

    // Auditoria
    exportarAuditoria
  };
})();

window.ExplainabilityEngine = ExplainabilityEngine;
