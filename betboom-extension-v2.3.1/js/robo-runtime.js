/**
 * Robô Runtime
 * Decisão e Execução com Planos, Grafos e Checkpoints Obrigatórios
 *
 * Fluxo:
 * ROUND_DETECTED → CREATE_DECISION_PLAN → VALIDATE_HISTORY → VALIDATE_TELEMETRY
 * → MATCH_PATTERN → EVALUATE_CONTEXT → RESOLVE_CONSENSUS → CALCULATE_CONVICTION
 * → SAFETY_CHECK → CREATE_EXECUTION_PLAN → WAIT_OPERATOR_CONFIRMATION
 * → SHADOW_CLICK → EXECUTE_CLICK → CONFIRM_ACTION → SETTLE_ROUND → REPORT
 *
 * Princípio: Nenhuma ação sem plano. Nenhum plano sem fatos. Nenhuma execução sem checkpoint.
 */

const RoboRuntime = (() => {
  const decisions = new Map(); // roundId → DecisionPlan
  const executions = new Map(); // executionPlanId → ExecutionPlan
  const checkpointResults = new Map(); // checkpointId → {status, reason, evidence}

  // ═══ 1. DECISION PLAN ═══
  // {planId, roundId, objective, facts, hypotheses, requiredEvidence, steps, status, confidence, blockers, traceId}

  function createDecisionPlan(roundId, cores) {
    const planId = `plan_${roundId}_${Date.now()}`;
    const traceId = roundId; // correlação com outros eventos

    const plan = {
      planId,
      roundId,
      traceId,
      createdAt: Date.now(),
      objective: 'Determinar melhor ação baseado em histórico e padrões',
      status: 'created', // created, validating, planning, ready, blocked, executed

      // FATOS (o que sabemos com certeza)
      facts: {
        historicoReal: cores || [],
        historicoLength: cores?.length || 0,
        timestamp: Date.now()
      },

      // HIPÓTESES (o que achamos que pode acontecer)
      hypotheses: [],

      // EVIDÊNCIAS NECESSÁRIAS (antes de decidir)
      requiredEvidence: [
        { type: 'historyIntegrity', threshold: 0.95, status: 'pending' },
        { type: 'telemetryIntegrity', threshold: 0.85, status: 'pending' },
        { type: 'patternConfidence', threshold: 0.60, status: 'pending' },
        { type: 'contextHealth', threshold: 0.70, status: 'pending' }
      ],

      // PASSOS DO PLANO
      steps: [
        { step: 1, name: 'VALIDATE_HISTORY', status: 'pending', blockingCheckpoint: true },
        { step: 2, name: 'VALIDATE_TELEMETRY', status: 'pending', blockingCheckpoint: true },
        { step: 3, name: 'MATCH_PATTERN', status: 'pending', blockingCheckpoint: false },
        { step: 4, name: 'EVALUATE_CONTEXT', status: 'pending', blockingCheckpoint: false },
        { step: 5, name: 'RESOLVE_CONSENSUS', status: 'pending', blockingCheckpoint: false },
        { step: 6, name: 'CALCULATE_CONVICTION', status: 'pending', blockingCheckpoint: true },
        { step: 7, name: 'SAFETY_CHECK', status: 'pending', blockingCheckpoint: true }
      ],

      // ESTADO DO PLANO
      confidence: 0,
      blockers: [],
      completedSteps: 0,
      failedSteps: [],

      // RESULTADO FINAL (preenchido ao final)
      recommendation: {
        action: null,
        acao: null,
        confidence: 0,
        conviction: 0,
        consensus: 0,
        evidence: []
      }
    };

    decisions.set(roundId, plan);
    console.log(`[RoboRuntime] DecisionPlan criado: ${planId} para rodada ${roundId}`);
    return plan;
  }

  // ═══ 2. EXECUTION PLAN ═══
  // {executionPlanId, planId, roundId, steps, currentStep, status, traceId}

  function createExecutionPlan(planId, roundId, recommendation) {
    const executionPlanId = `exec_${planId}_${Date.now()}`;

    const plan = {
      executionPlanId,
      planId,
      roundId,
      traceId: roundId,
      createdAt: Date.now(),
      status: 'created', // created, ready, waiting_confirmation, executing, completed, failed

      // AÇÃO RECOMENDADA
      recommendation,

      // PASSOS DE EXECUÇÃO
      steps: [
        { step: 1, name: 'WAIT_OPERATOR_CONFIRMATION', status: 'pending', checkpoint: true },
        { step: 2, name: 'SHADOW_CLICK', status: 'pending', checkpoint: false },
        { step: 3, name: 'EXECUTE_CLICK', status: 'pending', checkpoint: true },
        { step: 4, name: 'CONFIRM_ACTION', status: 'pending', checkpoint: false },
        { step: 5, name: 'SETTLE_ROUND', status: 'pending', checkpoint: false }
      ],

      currentStep: 0,
      completedSteps: [],
      failedSteps: [],

      // RESULTADO DA EXECUÇÃO
      executionResult: {
        clicked: false,
        success: false,
        latencyMs: 0,
        reason: null,
        evidence: []
      }
    };

    executions.set(executionPlanId, plan);
    console.log(`[RoboRuntime] ExecutionPlan criado: ${executionPlanId}`);
    return plan;
  }

  // ═══ 3. CHECKPOINT SYSTEM ═══
  // Validação obrigatória antes de avançar

  function createCheckpoint(checkpointType, requiredConditions = {}) {
    return {
      id: `ckpt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      type: checkpointType,
      createdAt: Date.now(),
      status: 'pending', // pending, passed, failed
      requiredConditions,
      actualResults: {},
      reason: null,
      evidence: []
    };
  }

  async function evaluateCheckpoint(checkpoint, context = {}) {
    const results = {
      passed: true,
      failures: [],
      evidence: []
    };

    // CHECKPOINT: History Integrity (≥95% match)
    if (checkpoint.requiredConditions.historyIntegrity) {
      const threshold = checkpoint.requiredConditions.historyIntegrity;
      const matchRate = context.historyMatchRate || 0;
      const passed = matchRate >= (threshold * 100);

      if (!passed) {
        results.passed = false;
        results.failures.push(`History integrity: ${matchRate.toFixed(1)}% < ${threshold * 100}%`);
      }
      results.evidence.push({
        metric: 'historyMatchRate',
        value: matchRate,
        threshold: threshold * 100,
        passed
      });
      checkpoint.actualResults.historyMatchRate = matchRate;
    }

    // CHECKPOINT: Telemetry Integrity (≥85%)
    if (checkpoint.requiredConditions.telemetryIntegrity) {
      const threshold = checkpoint.requiredConditions.telemetryIntegrity;
      const telemetryScore = context.telemetryIntegrityScore || 0;
      const passed = telemetryScore >= (threshold * 100);

      if (!passed) {
        results.passed = false;
        results.failures.push(`Telemetry integrity: ${telemetryScore.toFixed(1)}% < ${threshold * 100}%`);
      }
      results.evidence.push({
        metric: 'telemetryIntegrityScore',
        value: telemetryScore,
        threshold: threshold * 100,
        passed
      });
      checkpoint.actualResults.telemetryScore = telemetryScore;
    }

    // CHECKPOINT: Pattern Confidence (≥60%)
    if (checkpoint.requiredConditions.patternConfidence) {
      const threshold = checkpoint.requiredConditions.patternConfidence;
      const confidence = context.patternConfidence || 0;
      const passed = confidence >= threshold;

      if (!passed) {
        results.passed = false;
        results.failures.push(`Pattern confidence: ${confidence.toFixed(1)}% < ${threshold}%`);
      }
      results.evidence.push({
        metric: 'patternConfidence',
        value: confidence,
        threshold,
        passed
      });
      checkpoint.actualResults.patternConfidence = confidence;
    }

    // CHECKPOINT: Context Health (≥70%)
    if (checkpoint.requiredConditions.contextHealth) {
      const threshold = checkpoint.requiredConditions.contextHealth;
      const health = context.contextHealthScore || 0;
      const passed = health >= threshold;

      if (!passed) {
        results.passed = false;
        results.failures.push(`Context health: ${health.toFixed(1)}% < ${threshold}%`);
      }
      results.evidence.push({
        metric: 'contextHealth',
        value: health,
        threshold,
        passed
      });
      checkpoint.actualResults.contextHealth = health;
    }

    // CHECKPOINT: Interaction Candidate (confidence ≥ threshold, valid element)
    if (checkpoint.requiredConditions.interactionCandidate) {
      const threshold = checkpoint.requiredConditions.interactionCandidate;
      const candidate = context.candidate || null;
      const passed = candidate && candidate.confidence >= threshold && candidate.elementValid;

      if (!passed) {
        results.passed = false;
        results.failures.push(`No valid interaction candidate at confidence threshold ${threshold}`);
      }
      results.evidence.push({
        metric: 'interactionCandidate',
        candidate: candidate ? { score: candidate.confidence, valid: candidate.elementValid } : null,
        threshold,
        passed
      });
      checkpoint.actualResults.interactionCandidate = passed;
    }

    // Marcar resultado do checkpoint
    checkpoint.status = results.passed ? 'passed' : 'failed';
    checkpoint.reason = results.passed ? 'OK' : results.failures.join('; ');
    checkpoint.evidence = results.evidence;

    checkpointResults.set(checkpoint.id, results);

    if (!results.passed) {
      console.warn(`[RoboRuntime] Checkpoint FALHOU: ${checkpoint.type}`, results.failures);
    } else {
      console.log(`[RoboRuntime] Checkpoint PASSOU: ${checkpoint.type}`);
    }

    return results;
  }

  // ═══ 4. PLAN STEP TRACKING ═══

  function updatePlanStep(plan, stepName, status, metadata = {}) {
    const step = plan.steps.find(s => s.name === stepName);
    if (!step) {
      console.warn(`[RoboRuntime] Step ${stepName} não encontrado no plano`);
      return false;
    }

    step.status = status;
    step.completedAt = Date.now();
    step.metadata = metadata;

    if (status === 'completed') {
      plan.completedSteps++;
    } else if (status === 'failed') {
      plan.failedSteps.push({ stepName, reason: metadata.reason || 'unknown' });
    }

    return true;
  }

  function blockPlan(plan, reason) {
    plan.status = 'blocked';
    plan.blockers.push({
      blockedAt: Date.now(),
      reason,
      evidence: ''
    });
    console.error(`[RoboRuntime] Plano BLOQUEADO: ${reason}`);
  }

  // ═══ 5. GRAPH GENERATION ═══
  // Node-based representation of decision path

  function generateDecisionGraph(planId, roundId) {
    if (typeof DecisionGraphEngine === 'undefined') {
      console.warn('[RoboRuntime] DecisionGraphEngine não disponível');
      return null;
    }

    // Reutilizar grafo existente ou criar novo
    const grafo = DecisionGraphEngine.createGraph({
      roundId,
      inicioRodada: Date.now(),
      historico: [],
      traceId: roundId
    });

    // Grafo vinculado ao plano
    if (grafo) {
      grafo.planId = planId;
      grafo.linkedToPlan = true;
    }

    return grafo;
  }

  // ═══ 6. PLAN STATE & INSPECTION ═══

  function getDecisionPlan(roundId) {
    return decisions.get(roundId) || null;
  }

  function getExecutionPlan(executionPlanId) {
    return executions.get(executionPlanId) || null;
  }

  function getPlanStatus(roundId) {
    const plan = decisions.get(roundId);
    if (!plan) return null;

    return {
      planId: plan.planId,
      status: plan.status,
      completedSteps: plan.completedSteps,
      totalSteps: plan.steps.length,
      confidence: plan.confidence,
      blockers: plan.blockers,
      failedSteps: plan.failedSteps,
      recommendation: plan.recommendation
    };
  }

  function getCheckpointHistory(filter = {}) {
    const results = Array.from(checkpointResults.values());

    if (filter.type) {
      return results.filter(r => r.evidence.some(e => e.metric === filter.type));
    }

    return results;
  }

  // ═══ 7. PLAN COMPLETION ═══

  function completePlan(roundId, recommendation) {
    const plan = decisions.get(roundId);
    if (!plan) return false;

    plan.status = 'executed';
    plan.recommendation = recommendation;
    plan.completedAt = Date.now();

    console.log(`[RoboRuntime] Plano COMPLETADO: ${plan.planId}`, recommendation);
    return true;
  }

  // Export
  return {
    // Decision Plan
    createDecisionPlan,
    getDecisionPlan,
    updatePlanStep,
    blockPlan,
    completePlan,
    getPlanStatus,

    // Execution Plan
    createExecutionPlan,
    getExecutionPlan,

    // Checkpoints
    createCheckpoint,
    evaluateCheckpoint,
    getCheckpointHistory,

    // Graphs
    generateDecisionGraph
  };
})();

window.RoboRuntime = RoboRuntime;
