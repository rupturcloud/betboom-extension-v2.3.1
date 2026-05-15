/**
 * Causality Engine (Phase 3)
 * Rastreia relações causais entre eventos e decisões
 * Constrói cadeias de causalidade para diagnóstico de problemas
 */

const CausalityEngine = (() => {
  const causalGraph = [];
  const eventLog = [];
  const rootCauseAnalyses = [];

  // ═══ 1. EVENT REGISTRATION ═══
  // Registrar eventos com contexto causal

  function registrarEvento(tipo, dados, causa = null) {
    const evento = {
      id: `event-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      tipo,
      timestamp: Date.now(),
      dados,
      causa: causa || null,
      consequencias: []
    };

    eventLog.push(evento);
    if (eventLog.length > 1000) eventLog.shift();

    return evento;
  }

  // ═══ 2. CAUSAL LINK REGISTRATION ═══
  // Registrar relação causa → efeito

  function registrarCausalidade(eventoOrigem, eventoConsequencia, tipo = 'direto') {
    if (!eventoOrigem || !eventoConsequencia) return null;

    const link = {
      id: `causal-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      causa: {
        id: eventoOrigem.id,
        tipo: eventoOrigem.tipo,
        timestamp: eventoOrigem.timestamp
      },
      efeito: {
        id: eventoConsequencia.id,
        tipo: eventoConsequencia.tipo,
        timestamp: eventoConsequencia.timestamp
      },
      tipoRelacao: tipo, // 'direto', 'indireto', 'condicional'
      forca: 1.0, // 0-1, força da relação
      timestamp: Date.now()
    };

    causalGraph.push(link);
    if (causalGraph.length > 500) causalGraph.shift();

    if (eventoOrigem.consequencias) {
      eventoOrigem.consequencias.push(eventoConsequencia.id);
    }

    return link;
  }

  // ═══ 3. ROOT CAUSE ANALYSIS ═══
  // Analisar cadeia causal até a raiz

  function rastrearAtéRaiz(eventoId, profundidadeMax = 10) {
    const cadeia = [];
    let eventoAtual = eventLog.find(e => e.id === eventoId);
    let profundidade = 0;

    while (eventoAtual && eventoAtual.causa && profundidade < profundidadeMax) {
      cadeia.unshift(eventoAtual);
      eventoAtual = eventLog.find(e => e.id === eventoAtual.causa);
      profundidade++;
    }

    if (eventoAtual) {
      cadeia.unshift(eventoAtual);
    }

    return {
      eventoOrigem: eventoId,
      raiz: cadeia[0]?.id || null,
      cadeia: cadeia.map(e => ({
        id: e.id,
        tipo: e.tipo,
        timestamp: e.timestamp
      })),
      profundidade,
      atingiuLimite: profundidade === profundidadeMax
    };
  }

  // ═══ 4. FAILURE CHAIN ANALYSIS ═══
  // Analisar cadeias de falhas

  function analisarCadeiaFalha(tipoFalhaInicial) {
    const falhas = eventLog.filter(e =>
      e.tipo.includes('falha') ||
      e.tipo.includes('erro') ||
      e.tipo.includes('bloqueio')
    );

    const sequencias = [];

    for (let i = 0; i < falhas.length - 1; i++) {
      const atual = falhas[i];
      const proxima = falhas[i + 1];
      const intervalo = proxima.timestamp - atual.timestamp;

      if (intervalo < 5000) { // Menos de 5 segundos
        sequencias.push({
          falha1: {
            tipo: atual.tipo,
            timestamp: atual.timestamp
          },
          falha2: {
            tipo: proxima.tipo,
            timestamp: proxima.timestamp
          },
          intervaloMs: intervalo,
          podeSerRelacionada: true
        });
      }
    }

    return {
      totalFalhas: falhas.length,
      sequenciasDetectadas: sequencias.length,
      sequencias
    };
  }

  // ═══ 5. DECISION CAUSALITY ═══
  // Rastrear causas de uma decisão

  function rastrearCausasDaDecisao(roundId) {
    const eventosRodada = eventLog.filter(e => e.dados?.roundId === roundId);

    const causas = {
      padrao: null,
      consensus: null,
      conviction: null,
      bloqueios: []
    };

    eventosRodada.forEach(e => {
      if (e.tipo === 'pattern_detected') {
        causas.padrao = {
          nome: e.dados.nome,
          confianca: e.dados.confianca,
          timestamp: e.timestamp
        };
      } else if (e.tipo === 'consensus_resolved') {
        causas.consensus = {
          dominantSignal: e.dados.dominantSignal,
          agreement: e.dados.agreementScore,
          timestamp: e.timestamp
        };
      } else if (e.tipo === 'conviction_calculated') {
        causas.conviction = {
          score: e.dados.conviction,
          readiness: e.dados.executionReadiness,
          timestamp: e.timestamp
        };
      } else if (e.tipo === 'decision_blocked') {
        causas.bloqueios.push({
          motivo: e.dados.motivo,
          severidade: e.dados.severidade,
          timestamp: e.timestamp
        });
      }
    });

    return causas;
  }

  // ═══ 6. COUNTERFACTUAL ANALYSIS ═══
  // Analisar "e se" alterações tivessem acontecido

  function analisarContrafactual(roundId, alteracao) {
    const causas = rastrearCausasDaDecisao(roundId);

    const cenarios = {
      original: {
        padrao: causas.padrao,
        conviction: causas.conviction,
        resultado: !causas.bloqueios.length ? 'EXECUTADA' : 'BLOQUEADA'
      },
      alterado: null
    };

    // Simular alteração
    switch (alteracao.tipo) {
      case 'aumentar_conviction':
        cenarios.alterado = {
          conviction: {
            ...causas.conviction,
            score: Math.min(causas.conviction.score + 10, 100)
          },
          resultado: causas.conviction.score + 10 >= 65 ? 'EXECUTADA' : 'BLOQUEADA'
        };
        break;

      case 'remover_bloqueio':
        cenarios.alterado = {
          bloqueios: causas.bloqueios.filter((_, i) => i !== alteracao.bloqueioIndex),
          resultado: causas.bloqueios.length - 1 === 0 ? 'EXECUTADA' : 'BLOQUEADA'
        };
        break;

      case 'mudar_consenso':
        cenarios.alterado = {
          consensus: {
            ...causas.consensus,
            dominantSignal: alteracao.novoSinal
          },
          resultado: 'EXECUTADA'
        };
        break;
    }

    return cenarios;
  }

  // ═══ 7. SYSTEMIC PATTERN DETECTION ═══
  // Detectar padrões sistêmicos de problemas

  function detectarPadroesSystemicos() {
    const padroes = [];

    // Padrão 1: Cascata de falhas
    const cadeias = analisarCadeiaFalha();
    if (cadeias.sequenciasDetectadas > 3) {
      padroes.push({
        tipo: 'cascata_falhas',
        severidade: 'alta',
        ocorrencias: cadeias.sequenciasDetectadas,
        descricao: 'Múltiplas falhas em sequência rápida detectadas'
      });
    }

    // Padrão 2: Bloqueios frequentes
    const bloqueios = eventLog.filter(e => e.tipo === 'decision_blocked');
    const taxaBloqueio = (bloqueios.length / eventLog.length) * 100;
    if (taxaBloqueio > 30) {
      padroes.push({
        tipo: 'taxa_bloqueio_alta',
        severidade: 'média',
        percentual: Math.round(taxaBloqueio),
        ocorrencias: bloqueios.length,
        descricao: `${Math.round(taxaBloqueio)}% de decisões estão sendo bloqueadas`
      });
    }

    // Padrão 3: Degradação de confiança
    const convictions = eventLog
      .filter(e => e.tipo === 'conviction_calculated')
      .slice(-20);

    if (convictions.length > 5) {
      const scores = convictions.map(e => e.dados.conviction);
      const mediaRecente = scores.reduce((a, b) => a + b) / scores.length;
      const scorePath = scores.slice(-5);
      const emDecrescimo = scorePath.every((v, i, arr) => i === 0 || v <= arr[i - 1]);

      if (emDecrescimo && mediaRecente < 60) {
        padroes.push({
          tipo: 'degradacao_confianca',
          severidade: 'alta',
          mediaRecente: Math.round(mediaRecente),
          trend: 'descendente',
          descricao: 'Confiança em declínio contínuo nas últimas rodadas'
        });
      }
    }

    return padroes;
  }

  // ═══ 8. IMPACT ASSESSMENT ═══
  // Avaliar impacto de um evento

  function avaliarImpacto(eventoId) {
    const evento = eventLog.find(e => e.id === eventoId);
    if (!evento) return null;

    const consequencias = eventLog.filter(e =>
      e.timestamp > evento.timestamp &&
      e.timestamp < evento.timestamp + 10000 // 10 segundos após
    );

    const tipoCausos = {};
    consequencias.forEach(c => {
      tipoCausos[c.tipo] = (tipoCausos[c.tipo] || 0) + 1;
    });

    return {
      eventoOrigem: {
        id: evento.id,
        tipo: evento.tipo,
        timestamp: evento.timestamp
      },
      totalConsequencias: consequencias.length,
      tiposAfetados: tipoCausos,
      janelaTempo: '10s',
      impactoEstimado: consequencias.length > 5 ? 'alto' : (consequencias.length > 2 ? 'medio' : 'baixo')
    };
  }

  // ═══ 9. ROOT CAUSE REPORT ═══
  // Gerar relatório de causa raiz

  function gerarRelatorioCausaRaiz(roundId) {
    const raiz = rastrearAtéRaiz(roundId);
    const causas = rastrearCausasDaDecisao(roundId);
    const impacto = avaliarImpacto(roundId);

    return {
      analise: {
        rodada: roundId,
        data: new Date().toISOString(),
        tipoAnalise: 'Root Cause Analysis'
      },
      raizIdentificada: {
        id: raiz.raiz,
        profundidadeRastreamento: raiz.profundidade,
        cadeiaCompleta: raiz.cadeia
      },
      causasImediatas: causas,
      impactoDetectado: impacto,
      recomendacoes: gerarRecomendacoes(causas, impacto)
    };
  }

  function gerarRecomendacoes(causas, impacto) {
    const recomendacoes = [];

    if (causas.bloqueios.length > 0) {
      recomendacoes.push(
        `Revisar bloqueios: ${causas.bloqueios.map(b => b.motivo).join(', ')}`
      );
    }

    if (causas.conviction && causas.conviction.score < 65) {
      recomendacoes.push('Conviction baixa - aumentar confiança no contexto');
    }

    if (impacto && impacto.impactoEstimado === 'alto') {
      recomendacoes.push('Impacto cascata detectado - investigar propagação');
    }

    return recomendacoes;
  }

  // ═══ 10. EXPORT & ANALYTICS ═══
  // Exportar para análise

  function exportarCausalGraph(filtroTipo = null) {
    const links = filtroTipo
      ? causalGraph.filter(l => l.causa.tipo === filtroTipo || l.efeito.tipo === filtroTipo)
      : causalGraph;

    return {
      exportado: new Date().toISOString(),
      totalLinks: links.length,
      links: links.map(l => ({
        causa: l.causa,
        efeito: l.efeito,
        tipoRelacao: l.tipoRelacao,
        forca: l.forca
      }))
    };
  }

  function obterEstatisticas() {
    const eventos = eventLog.length;
    const links = causalGraph.length;
    const falhas = eventLog.filter(e => e.tipo.includes('falha') || e.tipo.includes('erro')).length;

    return {
      totalEventos: eventos,
      totalLinks: links,
      totalFalhas: falhas,
      taxaFalha: eventos > 0 ? (falhas / eventos * 100).toFixed(2) + '%' : '0%',
      densidadeCausal: eventos > 0 ? (links / eventos).toFixed(2) : '0'
    };
  }

  return {
    // Registro
    registrarEvento,
    registrarCausalidade,

    // Análise de causalidade
    rastrearAtéRaiz,
    analisarCadeiaFalha,
    rastrearCausasDaDecisao,

    // Análise contrafactual
    analisarContrafactual,

    // Padrões sistêmicos
    detectarPadroesSystemicos,

    // Impacto
    avaliarImpacto,

    // Relatórios
    gerarRelatorioCausaRaiz,

    // Exportação
    exportarCausalGraph,
    obterEstatisticas,

    // Debug
    obterEventLog: () => eventLog.slice(-50),
    obterCausalGraph: () => causalGraph.slice(-50)
  };
})();

window.CausalityEngine = CausalityEngine;
