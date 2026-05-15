/**
 * BetBoom Auto Pattern — Camada Canônica de Decisão
 * Fonte única, linear e auditável da decisão operacional.
 */

const CanonicalDecisionEngine = (() => {
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function normalizeColor(value) {
    if (typeof BBStrategyUtils !== 'undefined' && BBStrategyUtils.normalizeCor) {
      return BBStrategyUtils.normalizeCor(value);
    }
    return value || null;
  }

  function buildEmptyDecision(input = {}, reason = 'Nenhum padrão detectado.') {
    return {
      version: '1.0.0',
      roundId: input.roundId || CONFIG.roundIdAtual || null,
      padraoDetectado: null,
      corAlvo: null,
      confirmacoesSecundarias: [],
      matrixConfirmations: 0,
      analiseConfirmada: false,
      forcaConfirmacao: 'baixa',
      contextoMesa: 'neutra',
      riscoOperacional: 'alto',
      indiceDeConfianca: 0,
      temperaturaDaEntrada: 'vermelho',
      recomendacaoOperacional: 'nao-va',
      justificativas: [reason],
      decisaoFinal: 'aguardando',
      regra: {
        familiaCanonica: null,
        limiteGaleOficial: 0,
        ateG1: true
      },
      contexto: {
        surfLongo: false,
        conflitoDeSinais: false,
        bateEQuebra: false,
        confirmacaoRecenteInsuficiente: true,
        integridadeTecnica: {
          score: 0,
          nivel: 'baixa'
        },
        ausenciaConfirmacaoRepetida: false
      },
      excecao: {
        overrideHumano: false,
        observada: false,
        notas: []
      }
    };
  }

  function mapCanonicalFamily(pattern = {}) {
    const matcherType = pattern.matcherType || null;
    const mapped = pattern.mappedPatternKey || null;
    const nome = String(pattern.nome || '').toLowerCase();

    if (matcherType === 'alternating-sequence' || /xadrez|altern/.test(nome)) {
      return 'alternancia';
    }
    if (matcherType === 'dominant-last-4' || /ponta|quadrante|domin|tend/.test(nome) || mapped === 'ponta') {
      return 'dominancia';
    }
    if (/revers|quebra|correc/.test(nome)) {
      return 'reversao-controlada';
    }
    return 'sequencia-controlada';
  }

  function resolveTechnicalIntegrity(technicalRead = {}) {
    const channels = Array.isArray(technicalRead.channels) ? technicalRead.channels : [];
    let score = 0;
    const reasons = [];

    if (channels.includes('evo-game')) {
      score += 35;
      reasons.push('Canal evo-game ativo');
    } else {
      reasons.push('Canal evo-game ausente');
    }

    if (technicalRead.wsDadosRecebidos === true) {
      score += 20;
      reasons.push('Leitura WS viva');
    } else {
      reasons.push('Sem leitura WS recente');
    }

    if (technicalRead.resultadoConfirmadoDisponivel === true || CONFIG.ultimoResultadoConfirmado) {
      score += 10;
      reasons.push('Resultado confirmado disponível');
    }

    if (technicalRead.saldoDisponivel === true || Number.isFinite(Number(CONFIG.saldoReal))) {
      score += 10;
      reasons.push('Saldo oficial disponível');
    }

    if (technicalRead.overlayReady === true || CONFIG.overlayReady === true) {
      score += 10;
      reasons.push('Overlay operacional ativo');
    }

    if (technicalRead.estadoRodada || CONFIG.estadoRodadaAtual) {
      score += 15;
      reasons.push(`Estado da rodada conhecido: ${technicalRead.estadoRodada || CONFIG.estadoRodadaAtual}`);
    }

    score = clamp(score, 0, 100);

    let nivel = 'baixa';
    if (score >= 80) nivel = 'alta';
    else if (score >= 55) nivel = 'media';

    return { score, nivel, reasons };
  }

  function buildRecentStructure(history = []) {
    const clean = Array.isArray(history)
      ? history.map(normalizeColor).filter(Boolean)
      : [];

    const last12 = clean.slice(-12);
    const nonTie = last12.filter((item) => item !== 'empate');
    const transitions = [];

    for (let index = 1; index < nonTie.length; index += 1) {
      transitions.push(nonTie[index] !== nonTie[index - 1]);
    }

    const changeCount = transitions.filter(Boolean).length;
    const lastColor = nonTie[nonTie.length - 1] || null;
    let streak = 0;

    for (let index = nonTie.length - 1; index >= 0; index -= 1) {
      if (nonTie[index] === lastColor) streak += 1;
      else break;
    }

    const vermelhos = nonTie.filter((item) => item === 'vermelho').length;
    const azuis = nonTie.filter((item) => item === 'azul').length;

    return {
      clean,
      last12,
      nonTie,
      changeCount,
      streakColor: lastColor,
      streakSize: streak,
      vermelhos,
      azuis,
      surfLongo: streak >= 4,
      bateEQuebra: nonTie.length >= 5 && changeCount >= 4,
      alternanciaForte: nonTie.length >= 4 && changeCount >= nonTie.length - 2
    };
  }

  function countOpposingStrategies(detectedStrategies = [], targetColor = null, patternId = null) {
    if (!Array.isArray(detectedStrategies) || !targetColor) {
      return { count: 0, labels: [] };
    }

    const labels = detectedStrategies
      .filter(Boolean)
      .filter((item) => (item.strategyId || item.id || null) !== patternId)
      .filter((item) => normalizeColor(item.acao) && normalizeColor(item.acao) !== targetColor)
      .map((item) => item.nome || item.strategy?.nome || 'Estratégia conflitante');

    return {
      count: labels.length,
      labels: labels.slice(0, 4)
    };
  }

  function buildSecondaryConfirmations(input) {
    const pattern = input.detectedPattern || null;
    const technical = input.technicalIntegrity;
    const targetColor = normalizeColor(pattern?.acao || pattern?.entradaEsperada);
    const conflict = countOpposingStrategies(
      input.detectedStrategies || [],
      targetColor,
      pattern?.strategyId || pattern?.id || null
    );
    const confirmations = [];

    const sequenceConfirmed = Boolean(pattern?.recognizedSequence || pattern?.sequenceBase);
    confirmations.push({
      id: 'sequencia-base',
      label: 'Sequência base confirmada',
      ok: sequenceConfirmed,
      detail: sequenceConfirmed ? (pattern?.recognizedSequence || pattern?.sequenceBase) : 'Sem sequência explícita',
      kind: 'regra'
    });

    confirmations.push({
      id: 'sem-conflito',
      label: 'Sem conflito direto de sinais',
      ok: conflict.count === 0,
      detail: conflict.count === 0 ? 'Nenhuma estratégia ativa conflitante.' : `${conflict.count} conflito(s): ${conflict.labels.join(', ')}`,
      kind: 'contexto'
    });

    confirmations.push({
      id: 'integridade-tecnica',
      label: 'Integridade técnica da leitura',
      ok: technical.score >= 55,
      detail: `${technical.score}/100 • ${technical.nivel}`,
      kind: 'tecnica'
    });

    const secondaryGraph = input.secondaryGraph || null;
    const secondaryAvailable = secondaryGraph && typeof secondaryGraph.confirmed === 'boolean';
    confirmations.push({
      id: 'grafico-secundario',
      label: 'Gráfico secundário / casa de baixo',
      ok: secondaryAvailable ? secondaryGraph.confirmed === true : false,
      detail: secondaryAvailable
        ? (secondaryGraph.detail || (secondaryGraph.confirmed ? 'Confirmou a leitura.' : 'Não confirmou a leitura.'))
        : 'Indisponível nesta build — não entra na conta.',
      kind: 'secundario',
      unavailable: !secondaryAvailable
    });

    return {
      confirmations,
      matrixConfirmations: confirmations.filter((item) => item.ok).length,
      availableCount: confirmations.filter((item) => item.unavailable !== true).length,
      conflict
    };
  }

  function classifyConfirmationStrength(matrixConfirmations, conflictCount) {
    if (matrixConfirmations >= 3 && conflictCount === 0) return 'alta';
    if (matrixConfirmations >= 2) return 'media';
    return 'baixa';
  }

  function classifyTableContext(input, secondary, technical, history) {
    const performance = input.strategyPerformance || null;
    let score = 50;
    const reasons = [];

    if (performance && Number.isFinite(Number(performance.taxaAcerto))) {
      if (Number(performance.disparou || 0) >= 3 && Number(performance.taxaAcerto) >= 58) {
        score += 15;
        reasons.push(`Estratégia vem bem na janela (${performance.taxaAcerto}% de acerto).`);
      } else if (Number(performance.disparou || 0) >= 3 && Number(performance.taxaAcerto) <= 45) {
        score -= 18;
        reasons.push(`Estratégia vem mal na janela (${performance.taxaAcerto}% de acerto).`);
      }
    }

    if (secondary.conflict.count > 0) {
      score -= Math.min(24, secondary.conflict.count * 10);
      reasons.push('Há conflito entre sinais ativos.');
    }

    if (history.surfLongo) {
      score -= 12;
      reasons.push(`Surf longo detectado (${history.streakSize} na mesma cor).`);
    }

    if (history.bateEQuebra) {
      score -= 10;
      reasons.push('Mesa em padrão bate e quebra.');
    }

    if (secondary.matrixConfirmations < 2) {
      score -= 12;
      reasons.push('Confirmação insuficiente na leitura atual.');
    } else if (secondary.matrixConfirmations >= 3) {
      score += 8;
      reasons.push('Leitura com boa confirmação recente.');
    }

    if (technical.score >= 80) {
      score += 10;
      reasons.push('Leitura técnica está íntegra.');
    } else if (technical.score < 55) {
      score -= 14;
      reasons.push('Leitura técnica ainda está parcial.');
    }

    score = clamp(score, 0, 100);

    let label = 'neutra';
    if (score >= 65) label = 'favoravel';
    else if (score < 42) label = 'desfavoravel';

    if (!reasons.length) {
      reasons.push('Mesa sem sinais fortes a favor ou contra.');
    }

    return {
      score,
      label,
      reasons
    };
  }

  function classifyOperationalRisk(input, analysisConfirmed, confirmationStrength, tableContext, technical, conflictCount) {
    let score = 35;
    const reasons = [];

    if (!analysisConfirmed) {
      score += 22;
      reasons.push('Análise ainda não está confirmada.');
    }

    if (confirmationStrength === 'baixa') {
      score += 18;
      reasons.push('Força de confirmação baixa.');
    } else if (confirmationStrength === 'media') {
      score += 8;
      reasons.push('Força de confirmação apenas mediana.');
    } else {
      score -= 8;
      reasons.push('Confirmação forte reduz o risco.');
    }

    if (tableContext.label === 'desfavoravel') {
      score += 20;
      reasons.push('Contexto da mesa é desfavorável.');
    } else if (tableContext.label === 'favoravel') {
      score -= 10;
      reasons.push('Contexto da mesa favorece a entrada.');
    }

    if (conflictCount > 0) {
      score += Math.min(18, conflictCount * 8);
      reasons.push('Conflito entre sinais aumenta o risco.');
    }

    if (technical.score < 55) {
      score += 18;
      reasons.push('Leitura técnica fraca.');
    } else if (technical.score >= 80) {
      score -= 8;
      reasons.push('Leitura técnica robusta.');
    }

    if (!input.estadoRodada) {
      score += 6;
      reasons.push('Estado da rodada ainda não foi confirmado.');
    }

    score = clamp(score, 0, 100);

    let label = 'medio';
    if (score < 40) label = 'baixo';
    else if (score >= 70) label = 'alto';

    return {
      score,
      label,
      reasons
    };
  }

  function computeConfidence(pattern, secondary, tableContext, technical, operationalRisk) {
    const patternConfidence = clamp(Number(pattern?.confianca || pattern?.confidence || 70), 0, 100);
    const secondaryScore = secondary.availableCount > 0
      ? (secondary.matrixConfirmations / secondary.availableCount) * 100
      : secondary.matrixConfirmations * 25;
    const tableScore = tableContext.score;
    const technicalScore = technical.score;
    const riskDiscount = operationalRisk.label === 'alto'
      ? 16
      : (operationalRisk.label === 'medio' ? 7 : 0);

    const score = clamp(
      (patternConfidence * 0.34) +
      (secondaryScore * 0.22) +
      (tableScore * 0.22) +
      (technicalScore * 0.22) -
      riskDiscount,
      0,
      100
    );

    let temperature = 'vermelho';
    if (score >= 72) temperature = 'verde';
    else if (score >= 48) temperature = 'amarelo';

    return {
      score: Number(score.toFixed(1)),
      temperature
    };
  }

  function deriveRecommendation(analysisConfirmed, operationalRisk, confidence, tableContext) {
    if (!analysisConfirmed) return 'nao-va';
    if (operationalRisk.label === 'alto') return 'nao-va';
    if (confidence.score >= 72 && tableContext.label !== 'desfavoravel') return 'pode-ir';
    if (confidence.score >= 48) return 'cautela';
    return 'nao-va';
  }

  function deriveDecisionStatus(pattern, recommendation, estadoRodada) {
    if (!pattern) return 'aguardando';
    if (recommendation === 'nao-va') return 'abortada';
    if (estadoRodada === 'apostando') return 'autorizada';
    return 'aguardando';
  }

  function build(input = {}) {
    const pattern = input.detectedPattern || null;
    if (!pattern || !normalizeColor(pattern.acao || pattern.entradaEsperada)) {
      return buildEmptyDecision(input);
    }

    const history = buildRecentStructure(input.history || []);
    const targetColor = normalizeColor(pattern.acao || pattern.entradaEsperada);
    const technical = resolveTechnicalIntegrity(input.technicalRead || {});
    const secondary = buildSecondaryConfirmations({
      ...input,
      detectedPattern: pattern,
      technicalIntegrity: technical
    });

    const analysisConfirmed = Boolean(
      targetColor &&
      technical.score >= 55 &&
      secondary.conflict.count === 0 &&
      secondary.matrixConfirmations >= 2
    );

    const confirmationStrength = classifyConfirmationStrength(
      secondary.matrixConfirmations,
      secondary.conflict.count
    );

    const tableContext = classifyTableContext(input, secondary, technical, history);
    const operationalRisk = classifyOperationalRisk(
      input,
      analysisConfirmed,
      confirmationStrength,
      tableContext,
      technical,
      secondary.conflict.count
    );
    const confidence = computeConfidence(pattern, secondary, tableContext, technical, operationalRisk);
    const recommendation = deriveRecommendation(analysisConfirmed, operationalRisk, confidence, tableContext);
    const decisionStatus = deriveDecisionStatus(pattern, recommendation, input.estadoRodada || CONFIG.estadoRodadaAtual || null);
    const family = mapCanonicalFamily(pattern);

    const justifications = [
      `Padrão canônico: ${family}.`,
      `Confirmações válidas: ${secondary.matrixConfirmations}/${secondary.availableCount}.`,
      ...tableContext.reasons.slice(0, 2),
      ...operationalRisk.reasons.slice(0, 2)
    ].filter(Boolean);

    return {
      version: '1.0.0',
      roundId: input.roundId || CONFIG.roundIdAtual || null,
      padraoDetectado: {
        id: pattern.strategyId || pattern.id || null,
        nome: pattern.nome || null,
        origem: pattern.source || 'legacy',
        familiaCanonica: family,
        sequenciaReconhecida: pattern.recognizedSequence || pattern.sequenceBase || null,
        confiancaBase: Number(pattern.confianca || pattern.confidence || 0),
        limiteGaleOficial: Number.isFinite(Number(pattern.maxGalesPermitido))
          ? Number(pattern.maxGalesPermitido)
          : Number(pattern.limiteGale || 0)
      },
      corAlvo: targetColor,
      confirmacoesSecundarias: secondary.confirmations,
      matrixConfirmations: secondary.matrixConfirmations,
      analiseConfirmada: analysisConfirmed,
      forcaConfirmacao: confirmationStrength,
      contextoMesa: tableContext.label,
      riscoOperacional: operationalRisk.label,
      indiceDeConfianca: confidence.score,
      temperaturaDaEntrada: confidence.temperature,
      recomendacaoOperacional: recommendation,
      justificativas: justifications.slice(0, 6),
      decisaoFinal: decisionStatus,
      regra: {
        familiaCanonica: family,
        limiteGaleOficial: Number.isFinite(Number(pattern.maxGalesPermitido))
          ? Number(pattern.maxGalesPermitido)
          : Number(pattern.limiteGale || 0),
        ateG1: Number.isFinite(Number(pattern.maxGalesPermitido))
          ? Number(pattern.maxGalesPermitido) <= 1
          : true,
        analiseConfirmada: analysisConfirmed,
        corAlvo: targetColor
      },
      contexto: {
        surfLongo: history.surfLongo,
        conflitoDeSinais: secondary.conflict.count > 0,
        conflitoRotulos: secondary.conflict.labels,
        bateEQuebra: history.bateEQuebra,
        confirmacaoRecenteInsuficiente: secondary.matrixConfirmations < 2,
        ausenciaConfirmacaoRepetida: secondary.matrixConfirmations < 2 && history.changeCount >= 3,
        integridadeTecnica: {
          score: technical.score,
          nivel: technical.nivel,
          sinais: technical.reasons
        },
        technicalRead: {
          channels: Array.isArray(input.technicalRead?.channels) ? [...input.technicalRead.channels] : [],
          wsDadosRecebidos: input.technicalRead?.wsDadosRecebidos === true,
          estadoRodada: input.estadoRodada || CONFIG.estadoRodadaAtual || null
        }
      },
      excecao: {
        overrideHumano: false,
        observada: false,
        notas: []
      }
    };
  }

  return {
    build,
    buildEmptyDecision
  };
})();

globalThis.CanonicalDecisionEngine = CanonicalDecisionEngine;
