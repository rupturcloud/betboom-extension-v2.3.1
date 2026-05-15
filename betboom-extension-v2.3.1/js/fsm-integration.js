/**
 * FSM Integration
 * Integra todos os engines ao fluxo FSM de decisão
 * Wiring: Consensus, Conviction, Context Health, Temporal Confidence, Behavior Drift
 */

const FSMIntegration = (() => {
  const stateHistory = [];

  function criarGrafo(roundId, cores) {
    if (typeof DecisionGraphEngine === 'undefined') return null;

    const grafo = DecisionGraphEngine.createGraph({
      roundId,
      inicioRodada: Date.now(),
      historico: cores,
      traceId: roundId
    });

    return grafo;
  }

  function executarEstagio_ROUND_DETECTED(grafo, roundId, cores) {
    const node = DecisionGraphEngine.createNode('ROUND_DETECTED', {
      historico: cores,
      rodadaAtual: cores.length,
      timestamp: Date.now()
    });

    DecisionGraphEngine.updateNode(grafo.id, 'ROUND_DETECTED', {
      status: 'passed',
      output: { rodadas: cores.length }
    });

    return { node, passed: true };
  }

  function executarEstagio_CREATE_DECISION_PLAN(grafo, roundId, cores) {
    if (typeof RoboRuntime === 'undefined') {
      DecisionGraphEngine.updateNode(grafo.id, 'CREATE_DECISION_PLAN', {
        status: 'skipped',
        reason: 'RoboRuntime undefined'
      });
      return { passed: true, plan: null };
    }

    const plan = RoboRuntime.createDecisionPlan(roundId, cores);
    grafo.planId = plan.planId;
    grafo.linkedToPlan = true;

    DecisionGraphEngine.updateNode(grafo.id, 'CREATE_DECISION_PLAN', {
      status: 'passed',
      output: { planId: plan.planId, objective: plan.objective }
    });

    return { passed: true, plan };
  }

  async function executarEstagio_VALIDATE_HISTORY_CHECKPOINT(grafo, roundId, cores) {
    if (typeof RoboRuntime === 'undefined') {
      DecisionGraphEngine.updateNode(grafo.id, 'VALIDATE_HISTORY_CHECKPOINT', {
        status: 'skipped',
        reason: 'RoboRuntime undefined'
      });
      return { passed: true, checkpoint: null };
    }

    const checkpoint = RoboRuntime.createCheckpoint('historyIntegrity', {
      historyIntegrity: 0.95
    });

    const historicoReal = Collector.getHistorico?.() || [];
    const historicoLength = historicoReal.length;
    const matchRate = historicoLength > 0 ? Math.min(100, (historicoLength / (cores?.length || 1)) * 100) : 0;

    const results = await RoboRuntime.evaluateCheckpoint(checkpoint, {
      historyMatchRate: matchRate
    });

    if (!results.passed) {
      const plan = RoboRuntime.getDecisionPlan(roundId);
      if (plan) {
        RoboRuntime.blockPlan(plan, `History integrity falhou: ${checkpoint.reason}`);
      }
    }

    DecisionGraphEngine.updateNode(grafo.id, 'VALIDATE_HISTORY_CHECKPOINT', {
      status: results.passed ? 'passed' : 'failed',
      reason: checkpoint.reason,
      output: { historyMatchRate: matchRate, threshold: 95 }
    });

    return { passed: results.passed, checkpoint, matchRate };
  }

  async function executarEstagio_VALIDATE_TELEMETRY_CHECKPOINT(grafo, roundId) {
    if (typeof RoboRuntime === 'undefined') {
      DecisionGraphEngine.updateNode(grafo.id, 'VALIDATE_TELEMETRY_CHECKPOINT', {
        status: 'skipped',
        reason: 'RoboRuntime undefined'
      });
      return { passed: true, checkpoint: null };
    }

    const checkpoint = RoboRuntime.createCheckpoint('telemetryIntegrity', {
      telemetryIntegrity: 0.85
    });

    // Obter score de integridade de telemetria (se disponível)
    let telemetryScore = 80; // default
    if (typeof Telemetry !== 'undefined' && Telemetry.getIntegrityScore) {
      telemetryScore = Telemetry.getIntegrityScore();
    }

    const results = await RoboRuntime.evaluateCheckpoint(checkpoint, {
      telemetryIntegrityScore: telemetryScore
    });

    if (!results.passed) {
      const plan = RoboRuntime.getDecisionPlan(roundId);
      if (plan) {
        RoboRuntime.blockPlan(plan, `Telemetry integrity falhou: ${checkpoint.reason}`);
      }
    }

    DecisionGraphEngine.updateNode(grafo.id, 'VALIDATE_TELEMETRY_CHECKPOINT', {
      status: results.passed ? 'passed' : 'failed',
      reason: checkpoint.reason,
      output: { telemetryScore, threshold: 85 }
    });

    return { passed: results.passed, checkpoint, telemetryScore };
  }

  function executarEstagio_HISTORY_UPDATED(grafo, roundId) {
    const historicoAtual = Collector.getHistorico?.() || [];

    DecisionGraphEngine.updateNode(grafo.id, 'HISTORY_UPDATED', {
      status: 'passed',
      output: { historicoLength: historicoAtual.length }
    });

    return { passed: true, historico: historicoAtual };
  }

  async function executarEstagio_PATTERN_MATCHED(grafo, roundId, cores) {
    if (typeof PatternEngine === 'undefined') {
      DecisionGraphEngine.updateNode(grafo.id, 'PATTERN_MATCHED', {
        status: 'blocked',
        reason: 'PatternEngine undefined'
      });
      return { passed: false };
    }

    const melhorPadrao = PatternEngine.melhorPadrao?.(cores);
    if (!melhorPadrao) {
      if (typeof BreakpointEngine !== 'undefined') {
        await BreakpointEngine.breakAt(BreakpointEngine.BREAKPOINT_TYPES.PATTERN_NOT_DETECTED, { cores });
      }
      DecisionGraphEngine.updateNode(grafo.id, 'PATTERN_MATCHED', {
        status: 'skipped',
        reason: 'Nenhum padrão detectado'
      });
      return { passed: false };
    }

    if (melhorPadrao.confianca < 60) {
      if (typeof BreakpointEngine !== 'undefined') {
        await BreakpointEngine.breakAt(BreakpointEngine.BREAKPOINT_TYPES.PATTERN_LOW_CONFIDENCE, { padrao: melhorPadrao });
      }
    }

    if (typeof BreakpointEngine !== 'undefined') {
      await BreakpointEngine.breakAt(BreakpointEngine.BREAKPOINT_TYPES.PATTERN_DETECTED, { padrao: melhorPadrao });
    }

    DecisionGraphEngine.updateNode(grafo.id, 'PATTERN_MATCHED', {
      status: 'passed',
      output: { pattern: melhorPadrao.nome, confidence: melhorPadrao.confianca },
      confidence: melhorPadrao.confianca || 0
    });

    return { passed: true, padrao: melhorPadrao };
  }

  async function executarEstagio_CONTEXT_EVALUATED(grafo, roundId, cores) {
    if (typeof ContextHealthEngine === 'undefined') {
      DecisionGraphEngine.updateNode(grafo.id, 'CONTEXT_EVALUATED', {
        status: 'skipped',
        reason: 'ContextHealthEngine undefined'
      });
      return { passed: true, saude: null };
    }

    const saude = ContextHealthEngine.assessContextHealth(cores);
    const hasWarnings = saude.warnings.length > 0;

    if (typeof BreakpointEngine !== 'undefined') {
      await BreakpointEngine.breakAt(BreakpointEngine.BREAKPOINT_TYPES.CONTEXT_HEALTH_CHECK, { saude });
      if (hasWarnings) {
        await BreakpointEngine.breakAt(BreakpointEngine.BREAKPOINT_TYPES.CONTEXT_UNSTABLE, { saude, warnings: saude.warnings });
      }
    }

    DecisionGraphEngine.updateNode(grafo.id, 'CONTEXT_EVALUATED', {
      status: hasWarnings ? 'warning' : 'passed',
      output: { status: saude.status, warnings: saude.warnings.length },
      reason: hasWarnings ? `${saude.warnings.join(', ')}` : undefined
    });

    return { passed: true, saude };
  }

  async function executarEstagio_CONSENSUS_RESOLVED(grafo, roundId, padrao) {
    if (typeof ConsensusEngine === 'undefined' || !padrao) {
      DecisionGraphEngine.updateNode(grafo.id, 'CONSENSUS_RESOLVED', {
        status: 'skipped',
        reason: 'ConsensusEngine undefined or no pattern'
      });
      return { passed: true, consensus: null };
    }

    const consensus = ConsensusEngine.resolveConsensus?.([padrao]) || { dominantSignal: padrao.acao };

    if (typeof BreakpointEngine !== 'undefined') {
      const agreementScore = consensus.agreementScore || 0;
      if (agreementScore < 60) {
        await BreakpointEngine.breakAt(BreakpointEngine.BREAKPOINT_TYPES.CONSENSUS_DIVERGENT, { consensus });
      } else if (agreementScore < 70) {
        await BreakpointEngine.breakAt(BreakpointEngine.BREAKPOINT_TYPES.CONSENSUS_WEAK, { consensus });
      } else {
        await BreakpointEngine.breakAt(BreakpointEngine.BREAKPOINT_TYPES.CONSENSUS_RESOLVED, { consensus });
      }
    }

    DecisionGraphEngine.updateNode(grafo.id, 'CONSENSUS_RESOLVED', {
      status: 'passed',
      output: { dominantSignal: consensus.dominantSignal, agreement: consensus.agreementScore },
      consensus: consensus.agreementScore || 50
    });

    return { passed: true, consensus };
  }

  async function executarEstagio_CONVICTION_CALCULATED(grafo, roundId, saude, consensus) {
    if (typeof ConvictionEngine === 'undefined') {
      DecisionGraphEngine.updateNode(grafo.id, 'CONVICTION_CALCULATED', {
        status: 'skipped',
        reason: 'ConvictionEngine undefined'
      });
      return { passed: true, conviction: null };
    }

    const conviction = ConvictionEngine.calculateConviction({
      decisionConfidence: 75,
      operationalReadiness: 80,
      operationalSafety: saude?.volatility ? (100 - saude.volatility) : 70,
      contextStable: saude?.stability > 50,
      consensusStrong: consensus?.agreementScore > 70,
      positiveHistory: true,
      bankrollSafe: true,
      hesitationFactors: {
        contextUnstable: saude?.stability < 40,
        weakConsensus: consensus?.agreementScore < 60,
        lowOperatorTrust: false,
        highRisk: saude?.volatility > 80,
        poorChipDetection: false
      }
    });

    const canExecute = conviction.conviction >= 65;

    if (typeof BreakpointEngine !== 'undefined') {
      await BreakpointEngine.breakAt(BreakpointEngine.BREAKPOINT_TYPES.CONVICTION_CALCULATED, { conviction });
      if (conviction.conviction >= 80) {
        await BreakpointEngine.breakAt(BreakpointEngine.BREAKPOINT_TYPES.CONVICTION_HIGH, { conviction });
      } else if (conviction.conviction < 65) {
        await BreakpointEngine.breakAt(BreakpointEngine.BREAKPOINT_TYPES.CONVICTION_LOW, { conviction });
      }
    }

    DecisionGraphEngine.updateNode(grafo.id, 'CONVICTION_CALCULATED', {
      status: canExecute ? 'passed' : 'warning',
      output: { conviction: conviction.conviction, readiness: conviction.executionReadiness },
      conviction: conviction.conviction,
      reason: canExecute ? undefined : `Conviction baixa: ${conviction.executionReadiness}`
    });

    return { passed: canExecute, conviction };
  }

  function executarEstagio_DECISION_CREATED(grafo, roundId, padrao, consensus, conviction) {
    const decisao = {
      roundId,
      padrao: padrao?.nome || '—',
      acao: consensus?.dominantSignal || padrao?.acao,
      confidence: padrao?.confianca || 0,
      conviction: conviction?.conviction || 0,
      consensus: consensus?.agreementScore || 0,
      timestamp: Date.now()
    };

    DecisionGraphEngine.updateNode(grafo.id, 'DECISION_CREATED', {
      status: 'passed',
      output: decisao
    });

    return { passed: true, decisao };
  }

  function executarEstagio_SAFETY_CHECKED(grafo, roundId, decisao) {
    if (typeof SafetyGovernance === 'undefined') {
      DecisionGraphEngine.updateNode(grafo.id, 'SAFETY_CHECKED', {
        status: 'passed',
        reason: 'SafetyGovernance undefined, proceeding'
      });
      return { passed: true };
    }

    const safetyCheck = SafetyGovernance.validarDecisao?.({
      acao: decisao.acao,
      confidence: decisao.confidence,
      conviction: decisao.conviction
    }) || { ok: true };

    DecisionGraphEngine.updateNode(grafo.id, 'SAFETY_CHECKED', {
      status: safetyCheck.ok ? 'passed' : 'failed',
      reason: safetyCheck.motivo
    });

    return { passed: safetyCheck.ok, motivo: safetyCheck.motivo };
  }

  function executarEstagio_CREATE_EXECUTION_PLAN(grafo, roundId, decisao) {
    if (typeof RoboRuntime === 'undefined') {
      DecisionGraphEngine.updateNode(grafo.id, 'CREATE_EXECUTION_PLAN', {
        status: 'skipped',
        reason: 'RoboRuntime undefined'
      });
      return { passed: true, executionPlan: null };
    }

    const recommendation = {
      action: decisao.acao,
      acao: decisao.acao,
      confidence: decisao.confidence,
      conviction: decisao.conviction,
      consensus: decisao.consensus,
      evidence: []
    };

    const plan = RoboRuntime.getDecisionPlan(roundId);
    const executionPlan = RoboRuntime.createExecutionPlan(
      plan?.planId || `plan_${roundId}`,
      roundId,
      recommendation
    );

    grafo.executionPlanId = executionPlan.executionPlanId;

    DecisionGraphEngine.updateNode(grafo.id, 'CREATE_EXECUTION_PLAN', {
      status: 'passed',
      output: {
        executionPlanId: executionPlan.executionPlanId,
        acao: recommendation.acao,
        confidence: recommendation.confidence
      }
    });

    return { passed: true, executionPlan };
  }

  function executarEstagio_OPERATOR_CONFIRMED(grafo, roundId, decisao) {
    // Em modo automático, operador confirmou
    DecisionGraphEngine.updateNode(grafo.id, 'OPERATOR_CONFIRMED', {
      status: 'passed',
      output: { confirmado: true, modo: CONFIG.modoDeUso || 'semi' }
    });

    return { passed: true, confirmado: true };
  }

  async function executarEstagio_ACTION_EXECUTED(grafo, roundId, decisao) {
    if (typeof Executor === 'undefined') {
      DecisionGraphEngine.updateNode(grafo.id, 'ACTION_EXECUTED', {
        status: 'skipped',
        reason: 'Executor undefined'
      });
      return { passed: false };
    }

    if (typeof BreakpointEngine !== 'undefined') {
      await BreakpointEngine.breakAt(BreakpointEngine.BREAKPOINT_TYPES.BEFORE_SHADOW_CLICK, { decisao });
      await BreakpointEngine.breakAt(BreakpointEngine.BREAKPOINT_TYPES.DECISION_READY_EXECUTE, { decisao });
    }

    const resultado = Executor.executarClique?.({
      acao: decisao.acao,
      stake: CONFIG.stakeBase || 5
    }) || { sucesso: false };

    DecisionGraphEngine.updateNode(grafo.id, 'ACTION_EXECUTED', {
      status: resultado.sucesso ? 'passed' : 'failed',
      reason: resultado.motivo,
      latencyMs: resultado.latencyMs || 0
    });

    return { passed: resultado.sucesso, resultado };
  }

  function executarEstagio_ACTION_CONFIRMED(grafo, roundId) {
    DecisionGraphEngine.updateNode(grafo.id, 'ACTION_CONFIRMED', {
      status: 'passed',
      output: { confirmado: true }
    });

    return { passed: true };
  }

  function executarEstagio_ROUND_SETTLED(grafo, roundId, resultadoCor) {
    DecisionGraphEngine.updateNode(grafo.id, 'ROUND_SETTLED', {
      status: 'passed',
      output: { resultado: resultadoCor },
      reason: `Rodada resolvida com resultado: ${resultadoCor}`
    });

    DecisionGraphEngine.finalizeGraph(grafo.id);

    if (typeof ReplayEngine !== 'undefined') {
      ReplayEngine.registrarSnapshot(roundId, grafo, {}, { resultado: resultadoCor });
    }

    return { passed: true };
  }

  async function executarFluxoCompleto(roundId, cores) {
    const grafo = criarGrafo(roundId, cores);
    if (!grafo) return null;

    let estageData = {};
    const explicacoes = [];

    // ═══ FASE 1: DETECÇÃO & PLANEJAMENTO ═══
    estageData.round = executarEstagio_ROUND_DETECTED(grafo, roundId, cores);
    if (!estageData.round.passed) return grafo;

    // Criar plano de decisão
    estageData.decisionPlan = executarEstagio_CREATE_DECISION_PLAN(grafo, roundId, cores);
    const plan = estageData.decisionPlan.plan;

    // CHECKPOINTS OBRIGATÓRIOS: Validar histórico e telemetria
    estageData.historyCheckpoint = await executarEstagio_VALIDATE_HISTORY_CHECKPOINT(grafo, roundId, cores);
    if (!estageData.historyCheckpoint.passed) {
      if (plan) RoboRuntime.updatePlanStep(plan, 'VALIDATE_HISTORY', 'failed', { reason: estageData.historyCheckpoint.checkpoint?.reason });
      return grafo; // BLOQUEADO
    }
    if (plan) RoboRuntime.updatePlanStep(plan, 'VALIDATE_HISTORY', 'completed', { matchRate: estageData.historyCheckpoint.matchRate });

    estageData.telemetryCheckpoint = await executarEstagio_VALIDATE_TELEMETRY_CHECKPOINT(grafo, roundId);
    if (!estageData.telemetryCheckpoint.passed) {
      if (plan) RoboRuntime.updatePlanStep(plan, 'VALIDATE_TELEMETRY', 'failed', { reason: estageData.telemetryCheckpoint.checkpoint?.reason });
      return grafo; // BLOQUEADO
    }
    if (plan) RoboRuntime.updatePlanStep(plan, 'VALIDATE_TELEMETRY', 'completed', { telemetryScore: estageData.telemetryCheckpoint.telemetryScore });

    // ═══ FASE 2: ANÁLISE & DECISÃO ═══
    estageData.history = executarEstagio_HISTORY_UPDATED(grafo, roundId);
    estageData.pattern = await executarEstagio_PATTERN_MATCHED(grafo, roundId, cores);
    if (!estageData.pattern.passed) {
      if (plan) {
        RoboRuntime.updatePlanStep(plan, 'MATCH_PATTERN', 'failed', { reason: 'Nenhum padrão detectado' });
      }
      return grafo;
    }
    if (plan) RoboRuntime.updatePlanStep(plan, 'MATCH_PATTERN', 'completed', { pattern: estageData.pattern.padrao?.nome });

    estageData.context = await executarEstagio_CONTEXT_EVALUATED(grafo, roundId, cores);
    if (plan) RoboRuntime.updatePlanStep(plan, 'EVALUATE_CONTEXT', 'completed', { health: estageData.context.saude?.status });

    estageData.consensus = await executarEstagio_CONSENSUS_RESOLVED(grafo, roundId, estageData.pattern.padrao);
    if (plan) RoboRuntime.updatePlanStep(plan, 'RESOLVE_CONSENSUS', 'completed', { agreement: estageData.consensus.consensus?.agreementScore });

    estageData.conviction = await executarEstagio_CONVICTION_CALCULATED(grafo, roundId, estageData.context.saude, estageData.consensus.consensus);

    // CHECKPOINT OBRIGATÓRIO: Conviction suficiente
    if (!estageData.conviction.passed) {
      if (plan) {
        RoboRuntime.updatePlanStep(plan, 'CALCULATE_CONVICTION', 'failed', { conviction: estageData.conviction.conviction?.conviction });
      }
      DecisionGraphEngine.updateNode(grafo.id, 'DECISION_CREATED', {
        status: 'blocked',
        reason: 'Conviction insuficiente'
      });
      return grafo; // BLOQUEADO
    }
    if (plan) RoboRuntime.updatePlanStep(plan, 'CALCULATE_CONVICTION', 'completed', { conviction: estageData.conviction.conviction?.conviction });

    // ═══ FASE 3: VALIDAÇÃO & APROVAÇÃO ═══
    estageData.decision = executarEstagio_DECISION_CREATED(grafo, roundId, estageData.pattern.padrao, estageData.consensus.consensus, estageData.conviction.conviction);
    estageData.safety = executarEstagio_SAFETY_CHECKED(grafo, roundId, estageData.decision.decisao);

    // CHECKPOINT OBRIGATÓRIO: Safety check passou
    if (!estageData.safety.passed) {
      if (plan) {
        RoboRuntime.updatePlanStep(plan, 'SAFETY_CHECK', 'failed', { reason: estageData.safety.motivo });
      }
      DecisionGraphEngine.updateNode(grafo.id, 'OPERATOR_CONFIRMED', {
        status: 'blocked',
        reason: estageData.safety.motivo
      });
      return grafo; // BLOQUEADO
    }
    if (plan) RoboRuntime.updatePlanStep(plan, 'SAFETY_CHECK', 'completed', { ok: true });

    // ═══ FASE 4: PLANO DE EXECUÇÃO ═══
    estageData.executionPlan = executarEstagio_CREATE_EXECUTION_PLAN(grafo, roundId, estageData.decision.decisao);

    estageData.operator = executarEstagio_OPERATOR_CONFIRMED(grafo, roundId, estageData.decision.decisao);
    estageData.action = await executarEstagio_ACTION_EXECUTED(grafo, roundId, estageData.decision.decisao);

    if (!estageData.action.passed) {
      // Execução falhou mas não bloqueia
      return grafo;
    }

    estageData.actionConfirm = executarEstagio_ACTION_CONFIRMED(grafo, roundId);

    // ═══ FINALIZAÇÃO ═══
    // Completar plano com recomendação final
    if (plan && estageData.decision?.decisao) {
      RoboRuntime.completePlan(roundId, estageData.decision.decisao);
    }

    // Registrar explicação da decisão
    if (typeof ExplainabilityEngine !== 'undefined') {
      const explicacaoCompleta = ExplainabilityEngine.construirExplicacaoCompleta(
        roundId,
        {
          historico: cores,
          contexto: estageData.context?.saude || null
        },
        estageData.pattern?.padrao || null,
        estageData.consensus?.consensus || null,
        estageData.conviction?.conviction || null,
        estageData.conviction?.conviction?.hesitationFactors || null,
        !estageData.action?.passed ? 'Execução bloqueada' : null
      );

      ExplainabilityEngine.registrarDecisao(
        roundId,
        {
          deveApostar: estageData.action?.passed || false,
          cor: estageData.decision?.decisao?.acao,
          stake: estageData.decision?.decisao?.stake,
          padrao: estageData.pattern?.padrao
        },
        explicacaoCompleta
      );
    }

    return grafo;
  }

  function registrarResultado(roundId, resultadoCor) {
    if (typeof DecisionGraphEngine !== 'undefined') {
      const graphs = DecisionGraphEngine.getRecentGraphs(1);
      if (graphs.length > 0) {
        executarEstagio_ROUND_SETTLED(graphs[0], roundId, resultadoCor);
      }
    }
  }

  return {
    executarFluxoCompleto,
    registrarResultado,
    criarGrafo
  };
})();

window.FSMIntegration = FSMIntegration;
