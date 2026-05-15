/**
 * BetBoom Auto Pattern — Observabilidade Estratégica v2.1
 * Camada independente de analytics, janelas, recomendações e leitura do operador.
 */

const SessionAnalyticsEngine = (() => {
  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function nowTs(value = null) {
    return Number.isFinite(Number(value)) ? Number(value) : Date.now();
  }

  function createSession(meta = {}) {
    const startedAt = nowTs(meta.startedAt);
    const saldoInicial = Number.isFinite(Number(meta.bancaInicialSessao))
      ? Number(meta.bancaInicialSessao)
      : (Number.isFinite(Number(meta.saldoAtual)) ? Number(meta.saldoAtual) : null);

    return {
      id: meta.id || `sess-${startedAt}-${Math.random().toString(16).slice(2, 8)}`,
      startedAt,
      endedAt: null,
      active: true,
      modoTeste: meta.modoTeste !== false,
      modoDebug: meta.modoDebug === true,
      bancaInicialSessao: saldoInicial,
      saldoAtual: Number.isFinite(Number(meta.saldoAtual)) ? Number(meta.saldoAtual) : saldoInicial,
      lucroPrejuizoSessao: saldoInicial !== null && Number.isFinite(Number(meta.saldoAtual))
        ? Number(meta.saldoAtual) - Number(saldoInicial)
        : 0,
      rounds: [],
      updatedAt: startedAt,
      contextoTempoReal: {
        estadoRodada: null,
        technicalIntegrity: 0,
        channels: [],
        wsDadosRecebidos: false,
        mesaConfirmadaAberta: false,
        targetVisualConfirmado: false
      },
      ultimaRecomendacao: null,
      ultimaConfianca: null,
      ultimaStakeSugerida: null,
      ultimaTemperatura: null,
      ultimaSugestaoOperacional: null
    };
  }

  function createRound(roundId, meta = {}) {
    const createdAt = nowTs(meta.timestamp || meta.createdAt);
    return {
      roundId: roundId || `round-${createdAt}`,
      rodadaNumero: meta.rodadaNumero ?? meta.rodada ?? null,
      sessionId: meta.sessionId || null,
      createdAt,
      updatedAt: createdAt,
      resolvedAt: null,
      history: Array.isArray(meta.history) ? [...meta.history] : [],
      context: {
        mesaClassificacao: 'neutra',
        mesaScore: 50,
        conflictCount: 0,
        conflictStrategies: [],
        technicalIntegrity: 0,
        leituraTecnica: 'parcial',
        streakCor: null,
        streakTamanho: 0,
        estadoRodada: meta.estadoRodada || null,
        naoEntradaJustificada: false,
        motivoNaoEntrada: null,
        abortos: 0,
        divergencias: 0,
        qualidadeLeitura: 'parcial'
      },
      decision: null,
      entry: null,
      result: null,
      classification: 'sem-entrada',
      operatorAction: 'sem-entrada',
      recommendation: null,
      evidence: []
    };
  }

  function ensureRound(session, roundId, meta = {}) {
    if (!session) return null;
    const id = roundId || meta.roundId || `round-${Date.now()}`;
    let round = session.rounds.find((item) => item.roundId === id);
    if (!round) {
      round = createRound(id, {
        ...meta,
        sessionId: session.id,
        rodadaNumero: meta.rodadaNumero ?? meta.rodada ?? (session.rounds.length + 1)
      });
      session.rounds.push(round);
    }

    if (Array.isArray(meta.history) && meta.history.length) {
      round.history = [...meta.history];
    }
    if (meta.rodadaNumero != null || meta.rodada != null) {
      round.rodadaNumero = meta.rodadaNumero ?? meta.rodada;
    }
    round.updatedAt = nowTs(meta.timestamp || meta.updatedAt);
    session.updatedAt = round.updatedAt;
    return round;
  }

  function updateSessionBalance(session, saldoAtual) {
    if (!session || !Number.isFinite(Number(saldoAtual))) return;
    const saldo = Number(saldoAtual);
    if (!Number.isFinite(session.bancaInicialSessao)) {
      session.bancaInicialSessao = saldo;
    }
    session.saldoAtual = saldo;
    if (Number.isFinite(session.bancaInicialSessao)) {
      session.lucroPrejuizoSessao = saldo - Number(session.bancaInicialSessao);
    }
    session.updatedAt = Date.now();
  }

  function normalizeClassification(round) {
    const hasDecision = Boolean(round?.decision?.estrategia || round?.decision?.strategyId);
    const hasEntry = round?.entry?.statusInicial === 'executada';
    const isManual = round?.entry?.tipoEntrada === 'manual';
    const isAuto = round?.entry?.tipoEntrada === 'automatica';
    const suggested = BBStrategyUtils.normalizeCor(round?.decision?.entradaSugerida);
    const executed = BBStrategyUtils.normalizeCor(round?.entry?.entradaExecutada);

    if (round?.entry?.statusFinal === 'abortada' || round?.entry?.statusInicial === 'abortada') {
      return {
        classification: 'abortada',
        operatorAction: 'abortada'
      };
    }

    if (!hasEntry && hasDecision) {
      return {
        classification: round?.context?.naoEntradaJustificada ? 'entrada evitada por decisão do operador' : 'sem entrada após sugestão',
        operatorAction: round?.context?.naoEntradaJustificada ? 'entrada-evitada' : 'ignorou-robo'
      };
    }

    if (!hasEntry && !hasDecision) {
      return {
        classification: 'sem entrada',
        operatorAction: 'sem-entrada'
      };
    }

    if (isManual && hasDecision) {
      if (suggested && executed && suggested === executed) {
        return {
          classification: 'entrada manual alinhada ao robô',
          operatorAction: 'seguiu-robo'
        };
      }
      return {
        classification: 'entrada manual divergente do robô',
        operatorAction: 'foi-contra-robo'
      };
    }

    if (isManual && !hasDecision) {
      return {
        classification: 'entrada manual sem sugestão',
        operatorAction: 'manual-sem-sugestao'
      };
    }

    if (isAuto) {
      return {
        classification: 'entrada automática do sistema',
        operatorAction: 'sistema'
      };
    }

    return {
      classification: 'sem entrada',
      operatorAction: 'sem-entrada'
    };
  }

  function compactRound(round) {
    return clone({
      roundId: round.roundId,
      rodadaNumero: round.rodadaNumero,
      sessionId: round.sessionId,
      createdAt: round.createdAt,
      updatedAt: round.updatedAt,
      resolvedAt: round.resolvedAt,
      history: Array.isArray(round.history) ? round.history.slice(-12) : [],
      context: round.context || {},
      decision: round.decision || null,
      entry: round.entry || null,
      result: round.result || null,
      classification: round.classification,
      operatorAction: round.operatorAction,
      recommendation: round.recommendation || null,
      evidence: Array.isArray(round.evidence) ? round.evidence.slice(-10) : []
    });
  }

  function getResolvedRounds(session) {
    return Array.isArray(session?.rounds)
      ? session.rounds.filter((round) => round?.resolvedAt)
      : [];
  }

  function buildSessionCounters(session) {
    const rounds = Array.isArray(session?.rounds) ? session.rounds : [];
    const counters = {
      totalRodadasObservadas: rounds.length,
      totalEntradas: 0,
      entradasAutomaticas: 0,
      entradasManuais: 0,
      wins: 0,
      losses: 0,
      ties: 0,
      noTrade: 0,
      abortos: 0,
      seguiuRobo: 0,
      foiContraRobo: 0,
      manualSemSugestao: 0,
      ignorouRobo: 0
    };

    rounds.forEach((round) => {
      const hasEntry = round?.entry?.statusInicial === 'executada';
      if (hasEntry) {
        counters.totalEntradas += 1;
        if (round.entry.tipoEntrada === 'manual') counters.entradasManuais += 1;
        if (round.entry.tipoEntrada === 'automatica') counters.entradasAutomaticas += 1;
      }

      switch (round?.entry?.statusFinal) {
        case 'win':
          counters.wins += 1;
          break;
        case 'loss':
          counters.losses += 1;
          break;
        case 'tie':
          counters.ties += 1;
          break;
        case 'abortada':
          counters.abortos += 1;
          break;
        default:
          break;
      }

      switch (round?.operatorAction) {
        case 'seguiu-robo':
          counters.seguiuRobo += 1;
          break;
        case 'foi-contra-robo':
          counters.foiContraRobo += 1;
          break;
        case 'manual-sem-sugestao':
          counters.manualSemSugestao += 1;
          break;
        case 'ignorou-robo':
        case 'entrada-evitada':
          counters.ignorouRobo += 1;
          break;
        default:
          break;
      }

      if (String(round?.classification || '').includes('sem entrada') || String(round?.classification || '').includes('evitada')) {
        counters.noTrade += 1;
      }
    });

    const totalResolvido = counters.wins + counters.losses;
    counters.taxaAcerto = totalResolvido > 0 ? Number(((counters.wins / totalResolvido) * 100).toFixed(1)) : 0;
    return counters;
  }

  function buildOperatorProfile(session) {
    const rounds = Array.isArray(session?.rounds) ? session.rounds : [];
    const counters = buildSessionCounters(session);
    const seguiuRounds = rounds.filter((round) => round?.operatorAction === 'seguiu-robo');
    const contraRounds = rounds.filter((round) => round?.operatorAction === 'foi-contra-robo');
    const ruinedContextEntries = rounds.filter((round) => round?.entry?.statusInicial === 'executada' && round?.context?.mesaClassificacao === 'ruim');
    const noTradeRounds = rounds.filter((round) => String(round?.classification || '').includes('sem entrada') || String(round?.classification || '').includes('evitada'));

    const followWins = seguiuRounds.filter((round) => round?.entry?.statusFinal === 'win').length;
    const againstWins = contraRounds.filter((round) => round?.entry?.statusFinal === 'win').length;

    const bancaInicial = Number.isFinite(Number(session?.bancaInicialSessao)) ? Number(session.bancaInicialSessao) : null;
    const stakes = rounds
      .filter((round) => Number.isFinite(Number(round?.entry?.stake)) && Number(round.entry.stake) > 0)
      .map((round) => Number(round.entry.stake));
    const avgStake = stakes.length ? stakes.reduce((sum, value) => sum + value, 0) / stakes.length : 0;
    const avgStakePct = bancaInicial && bancaInicial > 0 ? (avgStake / bancaInicial) * 100 : 0;

    const stakeDisciplineEntries = rounds.filter((round) => round?.entry?.statusInicial === 'executada' && Number.isFinite(Number(round?.decision?.stakeSugerida?.valor)));
    const stakeDiscipline = stakeDisciplineEntries.length
      ? (stakeDisciplineEntries.filter((round) => Number(round.entry.stake) <= (Number(round.decision.stakeSugerida.valor) * 1.25)).length / stakeDisciplineEntries.length) * 100
      : 100;

    const galeDisciplineEntries = rounds.filter((round) => round?.entry?.statusInicial === 'executada' && Number.isFinite(Number(round?.decision?.gale)));
    const galeDiscipline = galeDisciplineEntries.length
      ? (galeDisciplineEntries.filter((round) => Number(round.entry.gale || 0) <= Number(round.decision.gale || 0)).length / galeDisciplineEntries.length) * 100
      : 100;

    const labels = [];
    if (avgStakePct >= 2.5) labels.push('agressivo');
    else if (avgStakePct >= 1.2) labels.push('moderado');
    else labels.push('conservador');

    if (stakeDiscipline >= 85 && galeDiscipline >= 85) labels.push('disciplinado');
    else if (counters.foiContraRobo > counters.seguiuRobo && ruinedContextEntries.length >= 2) labels.push('impulsivo');

    if (noTradeRounds.length >= Math.max(2, Math.round(rounds.length * 0.2))) labels.push('seletivo');

    return {
      taxaAdesaoAoRobo: counters.totalEntradas > 0
        ? Number(((counters.seguiuRobo / Math.max(1, counters.seguiuRobo + counters.foiContraRobo + counters.manualSemSugestao)) * 100).toFixed(1))
        : 0,
      taxaWinQuandoSegue: seguiuRounds.length ? Number(((followWins / seguiuRounds.length) * 100).toFixed(1)) : 0,
      taxaWinQuandoVaiContra: contraRounds.length ? Number(((againstWins / contraRounds.length) * 100).toFixed(1)) : 0,
      frequenciaEntradaContextoRuim: counters.totalEntradas ? Number(((ruinedContextEntries.length / counters.totalEntradas) * 100).toFixed(1)) : 0,
      frequenciaNoTrade: rounds.length ? Number(((noTradeRounds.length / rounds.length) * 100).toFixed(1)) : 0,
      agressividadeOperacional: Number(avgStakePct.toFixed(2)),
      disciplinaStake: Number(stakeDiscipline.toFixed(1)),
      disciplinaGale: Number(galeDiscipline.toFixed(1)),
      resiliênciaSequenciaRuim: counters.losses >= 2 && counters.wins >= counters.losses ? 'resiliente' : 'em observação',
      comportamentoMesaDesfavoravel: ruinedContextEntries.length > 1 ? 'precisa reduzir exposição' : 'controlado',
      labels: Array.from(new Set(labels))
    };
  }

  return {
    clone,
    createSession,
    ensureRound,
    updateSessionBalance,
    normalizeClassification,
    compactRound,
    getResolvedRounds,
    buildSessionCounters,
    buildOperatorProfile
  };
})();

const StrategyAnalyticsEngine = (() => {
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function computeRobustnessScore(metric) {
    const sampleScore = clamp((metric.disparou / 12) * 25, 0, 25);
    const hitRateScore = clamp((metric.taxaAcerto / 100) * 45, 0, 45);
    const conflictPenalty = clamp(metric.taxaConflito * 0.15, 0, 15);
    const avoidPenalty = clamp(metric.taxaEntradaEvitada * 0.1, 0, 10);
    const abortPenalty = clamp(metric.abortos * 2, 0, 10);
    return Number(clamp(sampleScore + hitRateScore - conflictPenalty - avoidPenalty - abortPenalty + 20, 0, 100).toFixed(1));
  }

  function buildStrategyMetrics(rounds, totalRounds = 0) {
    const map = new Map();

    rounds.forEach((round) => {
      const decision = round?.decision;
      if (!decision?.estrategia && !decision?.strategyId) return;

      const key = decision.strategyId || decision.estrategia;
      if (!map.has(key)) {
        map.set(key, {
          strategyId: decision.strategyId || null,
          nome: decision.estrategia || 'Estratégia',
          origem: decision.origem || null,
          disparou: 0,
          wins: 0,
          losses: 0,
          ties: 0,
          conflitos: 0,
          entradasEvitadas: 0,
          entradasExecutadas: 0,
          abortos: 0,
          janelas: {},
          taxaAcerto: 0,
          taxaDisparo: 0,
          taxaConflito: 0,
          taxaEntradaEvitada: 0,
          scoreRobustez: 0
        });
      }

      const metric = map.get(key);
      metric.disparou += 1;
      if (Number(round?.context?.conflictCount || 0) > 0) metric.conflitos += 1;
      if (!round?.entry || round?.entry?.statusInicial !== 'executada') metric.entradasEvitadas += 1;
      if (round?.entry?.statusInicial === 'executada') metric.entradasExecutadas += 1;
      if (round?.entry?.statusFinal === 'win') metric.wins += 1;
      if (round?.entry?.statusFinal === 'loss') metric.losses += 1;
      if (round?.entry?.statusFinal === 'tie') metric.ties += 1;
      if (round?.entry?.statusFinal === 'abortada' || round?.entry?.statusInicial === 'abortada') metric.abortos += 1;
    });

    const results = Array.from(map.values()).map((metric) => {
      const resolved = metric.wins + metric.losses;
      metric.taxaAcerto = resolved > 0 ? Number(((metric.wins / resolved) * 100).toFixed(1)) : 0;
      metric.taxaDisparo = totalRounds > 0 ? Number(((metric.disparou / totalRounds) * 100).toFixed(1)) : 0;
      metric.taxaConflito = metric.disparou > 0 ? Number(((metric.conflitos / metric.disparou) * 100).toFixed(1)) : 0;
      metric.taxaEntradaEvitada = metric.disparou > 0 ? Number(((metric.entradasEvitadas / metric.disparou) * 100).toFixed(1)) : 0;
      metric.scoreRobustez = computeRobustnessScore(metric);
      return metric;
    });

    return results.sort((a, b) => b.scoreRobustez - a.scoreRobustez || b.taxaAcerto - a.taxaAcerto);
  }

  function buildWindowReport(rounds, windowName) {
    const totalRounds = rounds.length;
    const strategyMetrics = buildStrategyMetrics(rounds, totalRounds);
    const favoravel = rounds.filter((round) => round?.context?.mesaClassificacao === 'favoravel').length;
    const neutra = rounds.filter((round) => round?.context?.mesaClassificacao === 'neutra').length;
    const ruim = rounds.filter((round) => round?.context?.mesaClassificacao === 'ruim').length;
    const abortos = rounds.filter((round) => round?.entry?.statusFinal === 'abortada' || round?.entry?.statusInicial === 'abortada').length;
    const divergencias = rounds.filter((round) => round?.operatorAction === 'foi-contra-robo').length;
    const noTrade = rounds.filter((round) => String(round?.classification || '').includes('sem entrada') || String(round?.classification || '').includes('evitada')).length;

    return {
      janela: windowName,
      totalRodadas: totalRounds,
      totalEntradas: rounds.filter((round) => round?.entry?.statusInicial === 'executada').length,
      strategies: strategyMetrics,
      contextos: {
        favoravel,
        neutra,
        ruim,
        abortos,
        divergencias,
        noTrade
      }
    };
  }

  return {
    buildStrategyMetrics,
    buildWindowReport
  };
})();

const RecommendationEngine = (() => {
  function createRecommendation(payload = {}) {
    return {
      id: payload.id || `rec-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      titulo: payload.titulo || 'Recomendação',
      descricao: payload.descricao || '',
      evidencia: payload.evidencia || '',
      janela: payload.janela || 'sessao',
      impactoEstimado: payload.impactoEstimado || 'médio',
      prioridadeSugerida: payload.prioridadeSugerida || 'média',
      sugestaoIssue: payload.sugestaoIssue || null,
      timestamp: payload.timestamp || Date.now()
    };
  }

  function generate(snapshot = {}) {
    const recommendations = [];
    const sessionStrategies = Array.isArray(snapshot?.strategies?.session) ? snapshot.strategies.session : [];
    const window24h = snapshot?.windows?.['24h'];
    const operator = snapshot?.operatorProfile || {};
    const session = snapshot?.session || {};

    sessionStrategies.forEach((metric) => {
      if (metric.disparou >= 5 && metric.taxaAcerto <= 45) {
        recommendations.push(createRecommendation({
          titulo: `Queda de efetividade: ${metric.nome}`,
          descricao: 'A estratégia vem performando abaixo do esperado na sessão.',
          evidencia: `${metric.nome} disparou ${metric.disparou}x com ${metric.taxaAcerto}% de acerto e robustez ${metric.scoreRobustez}.`,
          janela: 'sessao',
          impactoEstimado: 'alto',
          prioridadeSugerida: 'alta',
          sugestaoIssue: `Investigar ajuste fino da estratégia ${metric.nome}`
        }));
      }

      if (metric.disparou >= 5 && metric.taxaAcerto >= 60) {
        recommendations.push(createRecommendation({
          titulo: `Alta efetividade: ${metric.nome}`,
          descricao: 'Estratégia com evidência positiva consistente nesta janela.',
          evidencia: `${metric.nome} disparou ${metric.disparou}x com ${metric.taxaAcerto}% de acerto e robustez ${metric.scoreRobustez}.`,
          janela: 'sessao',
          impactoEstimado: 'médio',
          prioridadeSugerida: 'média',
          sugestaoIssue: `Documentar contexto favorável da estratégia ${metric.nome}`
        }));
      }

      if (metric.disparou >= 4 && metric.taxaConflito >= 30) {
        recommendations.push(createRecommendation({
          titulo: `Conflito recorrente: ${metric.nome}`,
          descricao: 'A estratégia está colidindo com outras leituras ativas.',
          evidencia: `${metric.nome} teve ${metric.taxaConflito}% de conflito nas rodadas em que disparou.`,
          janela: 'sessao',
          impactoEstimado: 'médio',
          prioridadeSugerida: 'média',
          sugestaoIssue: `Revisar prioridade/mutual exclusion de ${metric.nome}`
        }));
      }
    });

    if (window24h?.contextos?.ruim >= 3 && session?.counters?.losses > session?.counters?.wins) {
      recommendations.push(createRecommendation({
        titulo: 'Reduzir exposição em mesa desfavorável',
        descricao: 'A sessão atual mostra leitura em contexto ruim com perdas superiores às vitórias.',
        evidencia: `Nas últimas 24h houve ${window24h.contextos.ruim} rodadas em mesa ruim e a sessão atual está com ${session.counters.losses} losses para ${session.counters.wins} wins.`,
        janela: '24h',
        impactoEstimado: 'alto',
        prioridadeSugerida: 'alta',
        sugestaoIssue: 'Investigar travas adicionais para mesa desfavorável'
      }));
    }

    if ((operator.taxaWinQuandoVaiContra || 0) > (operator.taxaWinQuandoSegue || 0) + 10 && (session.counters?.foiContraRobo || 0) >= 3) {
      recommendations.push(createRecommendation({
        titulo: 'Investigar padrão não coberto pelo robô',
        descricao: 'O operador vem performando melhor quando diverge da sugestão atual.',
        evidencia: `Win seguindo robô: ${operator.taxaWinQuandoSegue || 0}%. Win indo contra: ${operator.taxaWinQuandoVaiContra || 0}%.`,
        janela: 'sessao',
        impactoEstimado: 'médio',
        prioridadeSugerida: 'média',
        sugestaoIssue: 'Abrir estudo de padrão recorrente não coberto'
      }));
    }

    if ((session.counters?.ignorouRobo || 0) >= 3) {
      recommendations.push(createRecommendation({
        titulo: 'Muitas entradas evitadas',
        descricao: 'Há recorrência de rounds em que o robô sugeriu entrada, mas ela foi evitada.',
        evidencia: `${session.counters.ignorouRobo} rounds com sugestão ignorada/evitada nesta sessão.`,
        janela: 'sessao',
        impactoEstimado: 'baixo',
        prioridadeSugerida: 'baixa',
        sugestaoIssue: 'Revisar clareza operacional do overlay para decisão do operador'
      }));
    }

    return recommendations.slice(0, 8);
  }

  return {
    generate
  };
})();

const ObservabilityEngine = (() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const STORAGE_KEY = 'bbObservabilityArchive';
  const MS_24H = 24 * 60 * 60 * 1000;
  const MS_7D = 7 * MS_24H;
  const MS_30D = 30 * MS_24H;

  const state = {
    loaded: false,
    loadPromise: null,
    persistTimer: null,
    archive: {
      version: 1,
      updatedAt: Date.now(),
      rounds: [],
      recommendations: []
    },
    session: null,
    currentTelemetry: {
      lastSaldo: null,
      fonteSaldo: null,
      channels: [],
      totalMessages: 0,
      wsDadosRecebidos: false,
      technicalIntegrity: 0,
      qualityLabel: 'parcial',
      mesaConfirmadaAberta: false,
      targetVisualConfirmado: false,
      estadoRodada: null
    }
  };

  function isTopFrame() {
    try {
      return typeof window !== 'undefined' ? window.top === window : true;
    } catch (_) {
      return true;
    }
  }

  function canUseStorage() {
    return isTopFrame() && typeof chrome !== 'undefined' && chrome?.storage?.local;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function storageGet(key) {
    return new Promise((resolve) => {
      if (!canUseStorage()) {
        resolve({});
        return;
      }
      chrome.storage.local.get(key, resolve);
    });
  }

  function storageSet(payload) {
    return new Promise((resolve) => {
      if (!canUseStorage()) {
        resolve();
        return;
      }
      chrome.storage.local.set(payload, resolve);
    });
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function ensureArchive(raw) {
    const archive = raw && typeof raw === 'object' ? raw : {};
    return {
      version: 1,
      updatedAt: archive.updatedAt || Date.now(),
      rounds: Array.isArray(archive.rounds) ? archive.rounds.slice(-2500) : [],
      recommendations: Array.isArray(archive.recommendations) ? archive.recommendations.slice(-400) : []
    };
  }

  function pruneArchive() {
    const cutoff = Date.now() - MS_30D;
    state.archive.rounds = state.archive.rounds
      .filter((round) => Number(round?.resolvedAt || round?.updatedAt || round?.createdAt || 0) >= cutoff)
      .slice(-2500);
    state.archive.recommendations = state.archive.recommendations
      .filter((item) => Number(item?.timestamp || 0) >= cutoff)
      .slice(-400);
    state.archive.updatedAt = Date.now();
  }

  function schedulePersist() {
    if (!canUseStorage()) return;
    if (state.persistTimer) clearTimeout(state.persistTimer);
    state.persistTimer = setTimeout(async () => {
      pruneArchive();
      await storageSet({ [STORAGE_KEY]: state.archive });
    }, 600);
  }

  async function bootstrap() {
    if (state.loaded) return state.archive;
    if (state.loadPromise) return state.loadPromise;

    state.loadPromise = (async () => {
      const data = await storageGet(STORAGE_KEY);
      state.archive = ensureArchive(data?.[STORAGE_KEY]);
      pruneArchive();
      state.loaded = true;
      return state.archive;
    })();

    return state.loadPromise;
  }

  function ensureSession(meta = {}) {
    if (!state.session) {
      state.session = SessionAnalyticsEngine.createSession({
        modoTeste: CONFIG.modoTeste,
        modoDebug: CONFIG.modoDebug,
        saldoAtual: Number.isFinite(Number(CONFIG.saldoReal)) ? Number(CONFIG.saldoReal) : state.currentTelemetry.lastSaldo,
        bancaInicialSessao: Number.isFinite(Number(meta.bancaInicialSessao)) ? Number(meta.bancaInicialSessao) : null
      });
    }
    return state.session;
  }

  function findPendingDecisionRound(session, excludeRoundId = null) {
    if (!session?.rounds?.length) return null;
    const candidates = [...session.rounds]
      .reverse()
      .filter((round) =>
        round &&
        round.roundId !== excludeRoundId &&
        round.decision &&
        !round.entry &&
        !round.result
      );
    return candidates[0] || null;
  }

  function migratePlannedDecision(session, targetRound, realRoundId) {
    const plannedRound = findPendingDecisionRound(session, realRoundId);
    if (!plannedRound || !targetRound) return;
    if (targetRound.decision || targetRound.entry || targetRound.result) return;

    targetRound.history = plannedRound.history?.length ? [...plannedRound.history] : targetRound.history;
    targetRound.context = { ...plannedRound.context, ...targetRound.context };
    targetRound.decision = plannedRound.decision ? { ...plannedRound.decision } : null;
    targetRound.recommendation = plannedRound.recommendation ? { ...plannedRound.recommendation } : null;
    targetRound.evidence = Array.isArray(plannedRound.evidence) ? [...plannedRound.evidence, ...targetRound.evidence] : targetRound.evidence;
    targetRound.updatedAt = Date.now();

    session.rounds = session.rounds.filter((round) => round !== plannedRound);
  }

  function iniciarSessao(meta = {}) {
    const saldoInicial = Number.isFinite(Number(meta.saldoInicial))
      ? Number(meta.saldoInicial)
      : (Number.isFinite(Number(CONFIG.saldoReal)) ? Number(CONFIG.saldoReal) : state.currentTelemetry.lastSaldo);

    state.session = SessionAnalyticsEngine.createSession({
      modoTeste: CONFIG.modoTeste,
      modoDebug: CONFIG.modoDebug,
      saldoAtual: saldoInicial,
      bancaInicialSessao: saldoInicial,
      startedAt: Date.now()
    });

    schedulePersist();
    return getSnapshot();
  }

  function encerrarSessao(reason = 'encerrada') {
    if (!state.session) return null;
    state.session.active = false;
    state.session.endedAt = Date.now();
    state.session.updatedAt = Date.now();
    state.session.motivoEncerramento = reason;
    schedulePersist();
    return getSnapshot();
  }

  function mergeRoundIntoArchive(round) {
    if (!round?.roundId || !round?.resolvedAt) return;
    const compact = SessionAnalyticsEngine.compactRound(round);
    const index = state.archive.rounds.findIndex((item) => item.roundId === compact.roundId && item.sessionId === compact.sessionId);
    if (index >= 0) {
      state.archive.rounds[index] = compact;
    } else {
      state.archive.rounds.push(compact);
    }
    pruneArchive();
  }

  function resolveStreak(history = []) {
    const cleaned = history.filter((cor) => cor === 'vermelho' || cor === 'azul' || cor === 'empate');
    if (!cleaned.length) return { cor: null, tamanho: 0 };
    const last = cleaned[cleaned.length - 1];
    let tamanho = 0;
    for (let index = cleaned.length - 1; index >= 0; index -= 1) {
      if (cleaned[index] === last) tamanho += 1;
      else break;
    }
    return { cor: last, tamanho };
  }

  function classifyTechnicalIntegrity() {
    const channels = Array.isArray(state.currentTelemetry.channels) ? state.currentTelemetry.channels : [];
    let score = 0;
    if (channels.includes('evo-game')) score += 45;
    if (state.currentTelemetry.wsDadosRecebidos) score += 20;
    if (Number(state.currentTelemetry.totalMessages || 0) > 0) score += 10;
    if (CONFIG.estadoRodadaAtual) score += 10;
    if (Number.isFinite(Number(CONFIG.saldoReal))) score += 15;
    score = clamp(score, 0, 100);

    let qualityLabel = 'baixa';
    if (score >= 80) qualityLabel = 'alta';
    else if (score >= 55) qualityLabel = 'média';

    state.currentTelemetry.technicalIntegrity = score;
    state.currentTelemetry.qualityLabel = qualityLabel;
    return { score, qualityLabel };
  }

  function classifyMesa(history = [], decision = null, detectedStrategies = []) {
    const last12 = Array.isArray(history) ? history.slice(-12) : [];
    const streak = resolveStreak(last12);
    const nonTie = last12.filter((cor) => cor !== 'empate');
    const vermelhos = nonTie.filter((cor) => cor === 'vermelho').length;
    const azuis = nonTie.filter((cor) => cor === 'azul').length;
    const dominantDiff = Math.abs(vermelhos - azuis);
    const conflictCount = Math.max(0, (Array.isArray(detectedStrategies) ? detectedStrategies.length : 0) - (decision ? 1 : 0));
    const technical = classifyTechnicalIntegrity().score;

    let mesaScore = 50;
    if (dominantDiff <= 2) mesaScore += 10;
    if (streak.tamanho >= 3) mesaScore -= 12;
    if (conflictCount > 0) mesaScore -= Math.min(18, conflictCount * 8);
    if (technical >= 80) mesaScore += 12;
    if (technical < 55) mesaScore -= 15;
    if (CONFIG.estadoRodadaAtual === 'apostando') mesaScore += 6;
    mesaScore = clamp(mesaScore, 0, 100);

    let mesaClassificacao = 'neutra';
    if (mesaScore >= 70) mesaClassificacao = 'favoravel';
    else if (mesaScore < 45) mesaClassificacao = 'ruim';

    return {
      mesaClassificacao,
      mesaScore,
      conflictCount,
      conflictStrategies: Array.isArray(detectedStrategies)
        ? detectedStrategies.slice(1, 4).map((item) => item.nome || item.strategy?.nome || item.strategyId || 'Estratégia')
        : [],
      technicalIntegrity: technical,
      leituraTecnica: state.currentTelemetry.qualityLabel,
      streakCor: streak.cor,
      streakTamanho: streak.tamanho,
      estadoRodada: CONFIG.estadoRodadaAtual || null,
      qualidadeLeitura: state.currentTelemetry.qualityLabel
    };
  }

  function getRecentResolvedStrategyMetric(strategyId, strategyName) {
    const session = ensureSession();
    const resolved = SessionAnalyticsEngine.getResolvedRounds(session);
    const matching = resolved.filter((round) => {
      const decision = round?.decision;
      if (!decision) return false;
      if (strategyId && decision.strategyId === strategyId) return true;
      return !strategyId && decision.estrategia === strategyName;
    }).slice(-10);

    const wins = matching.filter((round) => round?.entry?.statusFinal === 'win').length;
    const losses = matching.filter((round) => round?.entry?.statusFinal === 'loss').length;
    const conflicts = matching.filter((round) => Number(round?.context?.conflictCount || 0) > 0).length;
    const resolvedCount = wins + losses;

    return {
      amostra: matching.length,
      hitRate: resolvedCount > 0 ? (wins / resolvedCount) * 100 : 55,
      conflicts,
      losses
    };
  }

  function calculateConfidence(decision, context) {
    const patternStrength = clamp(Number(decision?.padrao?.confianca || decision?.padrao?.confidence || 70), 0, 100);
    const strategyMetric = getRecentResolvedStrategyMetric(decision?.padrao?.strategyId || decision?.padrao?.id || null, decision?.padrao?.nome || null);
    const strategyComponent = strategyMetric.amostra >= 3
      ? clamp((strategyMetric.hitRate * 0.6) + Math.min(strategyMetric.amostra * 2, 20), 0, 100)
      : 58;
    const technicalComponent = clamp(Number(context?.technicalIntegrity || 0), 0, 100);
    const mesaComponent = clamp(Number(context?.mesaScore || 50), 0, 100);
    const conflictPenalty = Math.min(20, Number(context?.conflictCount || 0) * 10);
    const riskPenalty = (Number(context?.streakTamanho || 0) >= 3 ? 6 : 0) + (strategyMetric.losses >= 2 ? 6 : 0);

    const score = clamp(
      (patternStrength * 0.35) +
      (strategyComponent * 0.25) +
      (technicalComponent * 0.2) +
      (mesaComponent * 0.2) -
      conflictPenalty -
      riskPenalty,
      0,
      100
    );

    let temperatura = 'cold';
    let recomendacao = 'não vá';
    if (score >= 72) {
      temperatura = 'hot';
      recomendacao = 'pode ir';
    } else if (score >= 48) {
      temperatura = 'warm';
      recomendacao = 'cautela';
    }

    return {
      score: Number(score.toFixed(1)),
      temperatura,
      recomendacao,
      componentes: {
        forcaPadrao: Number(patternStrength.toFixed(1)),
        historicoEstrategia: Number(strategyComponent.toFixed(1)),
        qualidadeMesa: Number(mesaComponent.toFixed(1)),
        integridadeTecnica: Number(technicalComponent.toFixed(1)),
        conflitos: Number(context?.conflictCount || 0),
        riscoOperacional: Number(riskPenalty.toFixed(1))
      }
    };
  }

  function calculateStakeSuggestion(confidence, context) {
    const session = ensureSession();
    const bancaBase = Number.isFinite(Number(session?.bancaInicialSessao)) && Number(session.bancaInicialSessao) > 0
      ? Number(session.bancaInicialSessao)
      : Number(CONFIG.bancaInicial || 0);
    const stakeBaseConfigurada = Number(CONFIG.stakeInicial || 0);
    const stakeBase = stakeBaseConfigurada > 0
      ? stakeBaseConfigurada
      : Math.max(1, Number((bancaBase * 0.006).toFixed(2)));

    let fatorConfianca = 0.55;
    if (confidence.score >= 72) fatorConfianca = 1;
    else if (confidence.score >= 48) fatorConfianca = 0.8;

    let fatorContexto = context?.mesaClassificacao === 'favoravel' ? 1 : 0.8;
    if (context?.mesaClassificacao === 'ruim') fatorContexto = 0.5;

    let fatorSessao = 1;
    if (Number(session?.lucroPrejuizoSessao || 0) < 0) fatorSessao = 0.85;
    if (Number(context?.streakTamanho || 0) >= 3) fatorSessao *= 0.9;

    const valor = clamp(
      Number((stakeBase * fatorConfianca * fatorContexto * fatorSessao).toFixed(2)),
      1,
      Number(CONFIG.stakeMax || stakeBase || 1)
    );

    const motivo = `Base ${stakeBase.toFixed(2)} • ${confidence.recomendacao} • mesa ${context?.mesaClassificacao || 'neutra'}`;
    return {
      base: Number(stakeBase.toFixed(2)),
      valor,
      motivo
    };
  }

  function mapCanonicalTemperature(value) {
    if (value === 'verde') return 'hot';
    if (value === 'amarelo') return 'warm';
    if (value === 'vermelho') return 'cold';
    return value || 'cold';
  }

  function mapCanonicalRecommendation(value) {
    if (value === 'pode-ir') return 'pode ir';
    if (value === 'cautela') return 'cautela';
    if (value === 'nao-va') return 'não vá';
    return value || 'não vá';
  }

  function buildContextFromCanonical(model, fallback = {}) {
    if (!model) return fallback;
    return {
      ...fallback,
      mesaClassificacao: model.contextoMesa === 'desfavoravel' ? 'ruim' : (model.contextoMesa || fallback.mesaClassificacao || 'neutra'),
      mesaScore: Number.isFinite(Number(model.indiceDeConfianca))
        ? Number(model.indiceDeConfianca)
        : Number(fallback.mesaScore || 50),
      conflictCount: Array.isArray(model?.contexto?.conflitoRotulos) ? model.contexto.conflitoRotulos.length : Number(fallback.conflictCount || 0),
      conflictStrategies: Array.isArray(model?.contexto?.conflitoRotulos) ? [...model.contexto.conflitoRotulos] : (fallback.conflictStrategies || []),
      technicalIntegrity: Number(model?.contexto?.integridadeTecnica?.score || fallback.technicalIntegrity || 0),
      leituraTecnica: model?.contexto?.integridadeTecnica?.nivel || fallback.leituraTecnica || 'parcial',
      streakCor: fallback.streakCor || null,
      streakTamanho: fallback.streakTamanho || 0,
      estadoRodada: CONFIG.estadoRodadaAtual || null,
      qualidadeLeitura: model?.contexto?.integridadeTecnica?.nivel || fallback.qualidadeLeitura || 'parcial',
      surfLongo: model?.contexto?.surfLongo === true,
      bateEQuebra: model?.contexto?.bateEQuebra === true,
      confirmacaoRecenteInsuficiente: model?.contexto?.confirmacaoRecenteInsuficiente === true,
      ausenciaConfirmacaoRepetida: model?.contexto?.ausenciaConfirmacaoRepetida === true
    };
  }

  function buildConfidenceFromCanonical(model, fallback = {}) {
    if (!model) return fallback;
    return {
      score: Number(model.indiceDeConfianca || fallback.score || 0),
      temperatura: mapCanonicalTemperature(model.temperaturaDaEntrada),
      recomendacao: mapCanonicalRecommendation(model.recomendacaoOperacional),
      componentes: {
        forcaPadrao: Number(model?.padraoDetectado?.confiancaBase || 0),
        historicoEstrategia: Number(fallback.componentes?.historicoEstrategia || 0),
        qualidadeMesa: Number(fallback.componentes?.qualidadeMesa || 0),
        integridadeTecnica: Number(model?.contexto?.integridadeTecnica?.score || 0),
        conflitos: Array.isArray(model?.contexto?.conflitoRotulos) ? model.contexto.conflitoRotulos.length : 0,
        riscoOperacional: model.riscoOperacional || 'medio'
      }
    };
  }

  function atualizarTempoReal(meta = {}) {
    state.currentTelemetry.channels = Array.isArray(meta.channels)
      ? [...meta.channels]
      : state.currentTelemetry.channels;
    state.currentTelemetry.totalMessages = Number(meta.totalMessages ?? state.currentTelemetry.totalMessages ?? 0);
    state.currentTelemetry.wsDadosRecebidos = meta.wsDadosRecebidos === true || state.currentTelemetry.wsDadosRecebidos === true;
    state.currentTelemetry.estadoRodada = meta.estadoRodada || CONFIG.estadoRodadaAtual || state.currentTelemetry.estadoRodada;
    if (typeof meta.mesaConfirmadaAberta === 'boolean') {
      state.currentTelemetry.mesaConfirmadaAberta = meta.mesaConfirmadaAberta;
    }
    if (typeof meta.targetVisualConfirmado === 'boolean') {
      state.currentTelemetry.targetVisualConfirmado = meta.targetVisualConfirmado;
    }
    classifyTechnicalIntegrity();

    const session = state.session;
    if (session) {
      session.contextoTempoReal = {
        ...session.contextoTempoReal,
        estadoRodada: state.currentTelemetry.estadoRodada,
        technicalIntegrity: state.currentTelemetry.technicalIntegrity,
        channels: [...state.currentTelemetry.channels],
        wsDadosRecebidos: state.currentTelemetry.wsDadosRecebidos,
        mesaConfirmadaAberta: state.currentTelemetry.mesaConfirmadaAberta,
        targetVisualConfirmado: state.currentTelemetry.targetVisualConfirmado
      };
      session.updatedAt = Date.now();
    }
  }

  function atualizarSaldo(saldo, meta = {}) {
    const numeric = Number(saldo);
    if (!Number.isFinite(numeric)) return;
    state.currentTelemetry.lastSaldo = numeric;
    state.currentTelemetry.fonteSaldo = meta.source || state.currentTelemetry.fonteSaldo;
    const session = state.session;
    if (session?.active) {
      SessionAnalyticsEngine.updateSessionBalance(session, numeric);
    }
  }

  function registrarDecisao(decisao, meta = {}) {
    const session = ensureSession();
    const round = SessionAnalyticsEngine.ensureRound(session, meta.roundId || CONFIG.roundIdAtual || null, {
      rodadaNumero: meta.rodadaNumero,
      history: meta.history,
      estadoRodada: CONFIG.estadoRodadaAtual,
      timestamp: Date.now()
    });

    const detectedStrategies = Array.isArray(meta.detectedStrategies)
      ? meta.detectedStrategies
      : [];
    const canonical = decisao?.decisionModel || null;
    const contextBase = classifyMesa(meta.history || round.history || [], decisao, detectedStrategies);
    const context = buildContextFromCanonical(canonical, contextBase);
    const confidenceBase = calculateConfidence(decisao, contextBase);
    const confidence = buildConfidenceFromCanonical(canonical, confidenceBase);
    const stakeSugerida = calculateStakeSuggestion(confidence, context);

    round.context = {
      ...round.context,
      ...context,
      naoEntradaJustificada: false,
      motivoNaoEntrada: null
    };
    round.decision = {
      strategyId: decisao?.padrao?.strategyId || decisao?.padrao?.id || null,
      estrategia: decisao?.padrao?.nome || null,
      origem: decisao?.source || decisao?.padrao?.source || null,
      sequenciaReconhecida: decisao?.recognizedSequence || decisao?.padrao?.recognizedSequence || decisao?.padrao?.sequenceBase || null,
      entradaSugerida: decisao?.cor || null,
      gale: Number.isFinite(Number(decisao?.maxGalesPermitido)) ? Number(decisao.maxGalesPermitido) : 0,
      protecaoEmpate: decisao?.protecaoEmpate === true,
      confiancaBase: Number(decisao?.padrao?.confianca || decisao?.padrao?.confidence || 0),
      confidenceIndex: confidence.score,
      temperatura: confidence.temperatura,
      recomendacao: confidence.recomendacao,
      canonical: canonical ? {
        patternDetected: canonical.padraoDetectado?.nome || null,
        targetColor: canonical.corAlvo || null,
        matrixConfirmations: Number(canonical.matrixConfirmations || 0),
        confirmedAnalysis: canonical.analiseConfirmada === true,
        confirmationStrength: canonical.forcaConfirmacao || null,
        tableContext: canonical.contextoMesa || null,
        operationalRisk: canonical.riscoOperacional || null,
        confidenceIndex: Number(canonical.indiceDeConfianca || 0),
        recommendation: canonical.recomendacaoOperacional || null,
        decisionStatus: canonical.decisaoFinal || null,
        reasons: Array.isArray(canonical.justificativas) ? [...canonical.justificativas] : [],
        confirmacoesSecundarias: Array.isArray(canonical.confirmacoesSecundarias) ? [...canonical.confirmacoesSecundarias] : []
      } : null,
      componentesConfianca: confidence.componentes,
      stakeSugerida,
      mesaClassificacao: context.mesaClassificacao,
      mesaScore: context.mesaScore,
      conflictCount: context.conflictCount,
      conflictStrategies: context.conflictStrategies,
      technicalIntegrity: context.technicalIntegrity,
      leituraTecnica: context.leituraTecnica,
      timestamp: Date.now()
    };
    round.recommendation = {
      temperatura: confidence.temperatura,
      texto: confidence.recomendacao,
      stakeSugerida,
      score: confidence.score,
      motivo: canonical?.justificativas?.[0] || `${context.mesaClassificacao} • integridade ${context.technicalIntegrity}`
    };
    round.evidence.push({
      tipo: 'decisao',
      timestamp: Date.now(),
      descricao: `${round.decision.estrategia || 'Estratégia'} → ${round.decision.entradaSugerida || '—'}`
    });
    round.updatedAt = Date.now();

    session.ultimaConfianca = confidence.score;
    session.ultimaTemperatura = confidence.temperatura;
    session.ultimaSugestaoOperacional = confidence.recomendacao;
    session.ultimaStakeSugerida = stakeSugerida;
    session.ultimaRecomendacao = round.recommendation;

    schedulePersist();

    return clone({
      roundId: round.roundId,
      context: round.context,
      decision: round.decision,
      recommendation: round.recommendation
    });
  }

  function registrarEntrada(entry, meta = {}) {
    if (!entry) return null;
    const session = ensureSession();
    const round = SessionAnalyticsEngine.ensureRound(session, entry.roundId || CONFIG.roundIdAtual || null, {
      rodadaNumero: meta.rodadaNumero ?? entry.rodada,
      history: meta.history,
      timestamp: entry.timestampEntrada || Date.now()
    });
    migratePlannedDecision(session, round, entry.roundId || CONFIG.roundIdAtual || null);

    round.entry = {
      tipoEntrada: entry.tipoEntrada || meta.tipoEntrada || 'automatica',
      estrategia: entry.estrategia || round?.decision?.estrategia || null,
      origem: entry.origem || round?.decision?.origem || null,
      entradaSugerida: entry.entradaSugerida || round?.decision?.entradaSugerida || null,
      entradaExecutada: entry.entradaExecutada || null,
      gale: Number(entry.gale || 0),
      protecaoEmpate: entry.protecaoEmpate === true,
      stake: Number(entry.stake || 0),
      statusInicial: entry.statusInicial || 'executada',
      statusExecucao: entry.statusExecucao || 'executada',
      statusFinal: entry.statusFinal || 'pendente',
      targetVisualConfirmado: typeof entry.targetVisualConfirmado === 'boolean' ? entry.targetVisualConfirmado : null,
      targetVisualCor: entry.targetVisualCor || null,
      targetVisualTexto: entry.targetVisualTexto || null,
      targetSelector: entry.targetSelector || null,
      timestampEntrada: entry.timestampEntrada || Date.now()
    };

    const relation = SessionAnalyticsEngine.normalizeClassification(round);
    round.classification = relation.classification;
    round.operatorAction = relation.operatorAction;
    round.context.abortos = round.entry.statusFinal === 'abortada' || round.entry.statusInicial === 'abortada'
      ? Number(round.context.abortos || 0) + 1
      : round.context.abortos;
    if (round.operatorAction === 'foi-contra-robo') {
      round.context.divergencias = Number(round.context.divergencias || 0) + 1;
    }

    round.evidence.push({
      tipo: 'entrada',
      timestamp: round.entry.timestampEntrada,
      descricao: `${round.entry.tipoEntrada} • ${round.entry.entradaExecutada || '—'} • ${round.entry.statusExecucao}`
    });
    round.updatedAt = Date.now();
    schedulePersist();
    return clone(round);
  }

  function registrarResultado(resultado, meta = {}) {
    const session = ensureSession();
    const roundId = resultado?.roundId || resultado?.gameId || meta.roundId || CONFIG.roundIdAtual || null;
    const round = SessionAnalyticsEngine.ensureRound(session, roundId, {
      rodadaNumero: meta.rodadaNumero ?? resultado?.rodada,
      history: meta.history,
      timestamp: resultado?.timestamp || Date.now()
    });
    migratePlannedDecision(session, round, roundId);

    round.result = {
      cor: resultado?.cor || null,
      vencedor: resultado?.vencedor || resultado?.winner || null,
      playerScore: resultado?.playerScore ?? null,
      bankerScore: resultado?.bankerScore ?? null,
      timestampResultado: resultado?.timestamp || Date.now(),
      statusFinal: meta.entry?.statusFinal || round.entry?.statusFinal || 'no-trade'
    };

    if (meta.entry) {
      round.entry = {
        ...(round.entry || {}),
        ...meta.entry,
        statusFinal: meta.entry.statusFinal || round.entry?.statusFinal || 'pendente',
        statusExecucao: meta.entry.statusExecucao || round.entry?.statusExecucao || 'resultado-confirmado'
      };
    }

    const relation = SessionAnalyticsEngine.normalizeClassification(round);
    round.classification = relation.classification;
    round.operatorAction = relation.operatorAction;

    if (!round.entry && round.decision) {
      round.context.naoEntradaJustificada = true;
      round.context.motivoNaoEntrada = meta.motivoNaoEntrada || 'Rodada fechou sem entrada registrada';
      round.classification = 'entrada evitada por decisão do operador';
      round.operatorAction = 'entrada-evitada';
    }

    round.resolvedAt = resultado?.timestamp || Date.now();
    round.updatedAt = round.resolvedAt;
    round.evidence.push({
      tipo: 'resultado',
      timestamp: round.resolvedAt,
      descricao: `${round.result.vencedor || round.result.cor || '—'} ${round.result.playerScore ?? '?'}x${round.result.bankerScore ?? '?'}`
    });

    mergeRoundIntoArchive(round);
    schedulePersist();
    return clone(round);
  }

  function collectAllRounds() {
    const archiveRounds = Array.isArray(state.archive.rounds) ? state.archive.rounds : [];
    const sessionRounds = state.session?.rounds ? state.session.rounds.map((round) => SessionAnalyticsEngine.compactRound(round)) : [];
    const all = [...archiveRounds];
    sessionRounds.forEach((round) => {
      const index = all.findIndex((item) => item.roundId === round.roundId && item.sessionId === round.sessionId);
      if (index >= 0) all[index] = round;
      else all.push(round);
    });
    return all;
  }

  function buildWindowMap() {
    const allRounds = collectAllRounds();
    const now = Date.now();
    const buckets = {
      sessao: state.session?.rounds ? state.session.rounds.map((round) => SessionAnalyticsEngine.compactRound(round)) : [],
      '24h': allRounds.filter((round) => Number(round?.resolvedAt || round?.updatedAt || 0) >= now - MS_24H),
      '7d': allRounds.filter((round) => Number(round?.resolvedAt || round?.updatedAt || 0) >= now - MS_7D),
      '30d': allRounds.filter((round) => Number(round?.resolvedAt || round?.updatedAt || 0) >= now - MS_30D)
    };

    return {
      sessao: StrategyAnalyticsEngine.buildWindowReport(buckets.sessao, 'sessao'),
      '24h': StrategyAnalyticsEngine.buildWindowReport(buckets['24h'], '24h'),
      '7d': StrategyAnalyticsEngine.buildWindowReport(buckets['7d'], '7d'),
      '30d': StrategyAnalyticsEngine.buildWindowReport(buckets['30d'], '30d')
    };
  }

  function buildSessionSnapshot() {
    if (!state.session) return null;
    const session = state.session;
    const counters = SessionAnalyticsEngine.buildSessionCounters(session);
    const strategyMetrics = StrategyAnalyticsEngine.buildStrategyMetrics(session.rounds, session.rounds.length || 0);
    const operatorProfile = SessionAnalyticsEngine.buildOperatorProfile(session);

    return {
      id: session.id,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      active: session.active,
      modoTeste: session.modoTeste,
      modoDebug: session.modoDebug,
      bancaInicialSessao: session.bancaInicialSessao,
      saldoAtual: session.saldoAtual,
      lucroPrejuizoSessao: session.lucroPrejuizoSessao,
      counters,
      strategyMetrics,
      operatorProfile,
      live: {
        technicalIntegrity: state.currentTelemetry.technicalIntegrity,
        qualityLabel: state.currentTelemetry.qualityLabel,
        channels: [...state.currentTelemetry.channels],
        estadoRodada: state.currentTelemetry.estadoRodada,
        ultimaConfianca: session.ultimaConfianca,
        ultimaTemperatura: session.ultimaTemperatura,
        ultimaStakeSugerida: session.ultimaStakeSugerida,
        ultimaRecomendacao: session.ultimaRecomendacao,
        ultimaSugestaoOperacional: session.ultimaSugestaoOperacional
      },
      rounds: session.rounds.map((round) => SessionAnalyticsEngine.compactRound(round))
    };
  }

  function getSnapshot() {
    const session = buildSessionSnapshot();
    const windows = buildWindowMap();
    const recommendations = session
      ? RecommendationEngine.generate({
        session,
        windows,
        strategies: {
          session: session.strategyMetrics,
          windows
        },
        operatorProfile: session.operatorProfile
      })
      : state.archive.recommendations.slice(-8);

    if (session) {
      state.archive.recommendations = [
        ...state.archive.recommendations.filter((item) => !recommendations.some((rec) => rec.titulo === item.titulo && rec.janela === item.janela)),
        ...recommendations
      ].slice(-400);
    }

    const readyMetrics = {
      prontoParaExecutar: Array.isArray(session?.rounds) ? session.rounds.filter((round) => round?.recommendation?.texto === 'pode ir').length : 0,
      falhasMesa: Array.isArray(session?.rounds) ? session.rounds.filter((round) => round?.context?.motivoNaoEntrada === 'mesa-nao-confirmada').length : 0,
      falhasAlvo: Array.isArray(session?.rounds) ? session.rounds.filter((round) => round?.entry?.targetVisualConfirmado === false).length : 0,
      falhasStake: Array.isArray(session?.rounds) ? session.rounds.filter((round) => round?.entry?.statusExecucao === 'falha-stake').length : 0,
      falhasDecisao: Array.isArray(session?.rounds) ? session.rounds.filter((round) => round?.classification === 'abortada').length : 0
    };

    return {
      session,
      windows,
      strategies: {
        session: session?.strategyMetrics || [],
        byWindow: {
          '24h': windows['24h'].strategies,
          '7d': windows['7d'].strategies,
          '30d': windows['30d'].strategies
        }
      },
      operatorProfile: session?.operatorProfile || null,
      recommendations,
      readyMetrics,
      archive: {
        rounds: state.archive.rounds.length,
        recommendations: state.archive.recommendations.length
      }
    };
  }

  return {
    bootstrap,
    iniciarSessao,
    encerrarSessao,
    atualizarTempoReal,
    atualizarSaldo,
    registrarDecisao,
    registrarEntrada,
    registrarResultado,
    getSnapshot,
    getWindowReports() {
      return buildWindowMap();
    }
  };
})();

globalThis.SessionAnalyticsEngine = SessionAnalyticsEngine;
globalThis.StrategyAnalyticsEngine = StrategyAnalyticsEngine;
globalThis.RecommendationEngine = RecommendationEngine;
globalThis.ObservabilityEngine = ObservabilityEngine;
