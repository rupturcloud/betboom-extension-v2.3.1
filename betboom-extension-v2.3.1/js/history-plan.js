/**
 * HistoryPlan — Runtime plan operacional
 *
 * Responsabilidades:
 * 1. Criar plano antes de executar atualização de histórico
 * 2. Rastrear status de cada etapa
 * 3. Permitir bloqueio de operações se alguma etapa falhar
 * 4. Integrar com execution graph
 */

const HistoryPlan = (() => {
  let activePlan = null;
  let planHistory = [];

  /**
   * Cria novo plano de execução
   */
  function createHistoryPlan(objective, source = 'unknown') {
    const planId = `plan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const traceId = `trace_${Date.now()}`;

    const plan = {
      planId,
      traceId,
      type: 'history_update',
      createdAt: Date.now(),
      objective, // 'capture', 'normalize', 'store', 'diff', 'render', 'validate'
      source,
      expectedInputCount: null,
      steps: [
        'capture',
        'normalize',
        'dedupe',
        'order',
        'store',
        'diff',
        'validate',
        'render',
        'compare',
        'report'
      ],
      stepStatus: {}, // Map<step, 'pending'|'running'|'passed'|'warning'|'blocked'|'failed'|'skipped'>
      stepResults: {}, // Map<step, result>
      status: 'created',
      blockers: [],
      errors: [],
      startTime: null,
      endTime: null,
      durationMs: null
    };

    // Inicializar status de todos os steps
    for (const step of plan.steps) {
      plan.stepStatus[step] = 'pending';
    }

    activePlan = plan;
    planHistory.push(plan);

    // Limpar histórico antigo (manter últimas 20)
    if (planHistory.length > 20) {
      planHistory = planHistory.slice(-20);
    }

    console.log(`[HistoryPlan] Novo plano criado:`, {
      planId,
      traceId,
      objective
    });

    return plan;
  }

  /**
   * Marca step como running
   */
  function markStepRunning(step) {
    if (!activePlan) return false;

    if (!activePlan.stepStatus.hasOwnProperty(step)) {
      console.warn(`[HistoryPlan] Step desconhecido:`, step);
      return false;
    }

    if (!activePlan.startTime) {
      activePlan.startTime = Date.now();
      activePlan.status = 'running';
    }

    activePlan.stepStatus[step] = 'running';

    console.log(`[HistoryPlan] Step running:`, {
      planId: activePlan.planId,
      step
    });

    return true;
  }

  /**
   * Marca step como passed
   */
  function markStepPassed(step, result = null) {
    if (!activePlan) return false;

    if (!activePlan.stepStatus.hasOwnProperty(step)) {
      console.warn(`[HistoryPlan] Step desconhecido:`, step);
      return false;
    }

    activePlan.stepStatus[step] = 'passed';
    if (result) {
      activePlan.stepResults[step] = result;
    }

    console.log(`[HistoryPlan] Step passed:`, {
      planId: activePlan.planId,
      step
    });

    return true;
  }

  /**
   * Marca step como warning
   */
  function markStepWarning(step, reason = '') {
    if (!activePlan) return false;

    activePlan.stepStatus[step] = 'warning';
    if (reason) {
      activePlan.errors.push({ step, reason });
    }

    console.warn(`[HistoryPlan] ⚠️ Step warning:`, {
      planId: activePlan.planId,
      step,
      reason
    });

    return true;
  }

  /**
   * Marca step como bloqueado ou falhado
   */
  function markStepBlocked(step, reason = '') {
    if (!activePlan) return false;

    activePlan.stepStatus[step] = 'blocked';
    activePlan.status = 'blocked';
    activePlan.blockers.push({ step, reason });

    // Marcar steps subsequentes como skipped
    let foundCurrent = false;
    for (const s of activePlan.steps) {
      if (s === step) {
        foundCurrent = true;
        continue;
      }
      if (foundCurrent && activePlan.stepStatus[s] === 'pending') {
        activePlan.stepStatus[s] = 'skipped';
      }
    }

    console.error(`[HistoryPlan] 🔴 Step bloqueado:`, {
      planId: activePlan.planId,
      step,
      reason,
      skipped: activePlan.steps.length - activePlan.steps.indexOf(step) - 1
    });

    return true;
  }

  /**
   * Marca step como falhado
   */
  function markStepFailed(step, error = '') {
    if (!activePlan) return false;

    activePlan.stepStatus[step] = 'failed';
    activePlan.status = 'failed';
    activePlan.errors.push({ step, error });

    // Marcar steps subsequentes como skipped
    let foundCurrent = false;
    for (const s of activePlan.steps) {
      if (s === step) {
        foundCurrent = true;
        continue;
      }
      if (foundCurrent && activePlan.stepStatus[s] === 'pending') {
        activePlan.stepStatus[s] = 'skipped';
      }
    }

    console.error(`[HistoryPlan] 🔴 Step failed:`, {
      planId: activePlan.planId,
      step,
      error
    });

    return true;
  }

  /**
   * Marca step como skipped
   */
  function markStepSkipped(step, reason = '') {
    if (!activePlan) return false;

    activePlan.stepStatus[step] = 'skipped';
    if (reason) {
      activePlan.errors.push({ step, reason });
    }

    return true;
  }

  /**
   * Marca plano como completed
   */
  function completePlan() {
    if (!activePlan) return false;

    activePlan.endTime = Date.now();
    activePlan.durationMs = activePlan.endTime - activePlan.startTime;

    // Determinar status final
    const statuses = Object.values(activePlan.stepStatus);
    if (statuses.includes('failed') || statuses.includes('blocked')) {
      activePlan.status = 'failed';
    } else if (statuses.includes('warning')) {
      activePlan.status = 'warning';
    } else {
      activePlan.status = 'completed';
    }

    console.log(`[HistoryPlan] Plano concluído:`, {
      planId: activePlan.planId,
      status: activePlan.status,
      duration: activePlan.durationMs,
      errors: activePlan.errors.length
    });

    return true;
  }

  /**
   * Retorna plano ativo
   */
  function getHistoryPlan() {
    return activePlan ? { ...activePlan } : null;
  }

  /**
   * Retorna histórico de planos (últimos 20)
   */
  function getPlanHistory() {
    return planHistory.slice().reverse(); // Mais recentes primeiro
  }

  /**
   * Retorna status consolidado do plano ativo
   */
  function getPlanStatus() {
    if (!activePlan) {
      return { status: 'no_plan', activePlan: null };
    }

    const passedSteps = Object.entries(activePlan.stepStatus)
      .filter(([_, status]) => status === 'passed')
      .map(([step, _]) => step);

    const failedSteps = Object.entries(activePlan.stepStatus)
      .filter(([_, status]) => status === 'failed' || status === 'blocked')
      .map(([step, _]) => step);

    return {
      status: activePlan.status,
      planId: activePlan.planId,
      traceId: activePlan.traceId,
      objective: activePlan.objective,
      passedSteps,
      failedSteps,
      blockers: activePlan.blockers,
      errors: activePlan.errors,
      duration: activePlan.durationMs,
      progress: `${passedSteps.length}/${activePlan.steps.length}`
    };
  }

  /**
   * Reseta plano ativo
   */
  function resetPlan() {
    activePlan = null;
  }

  return {
    createHistoryPlan,
    markStepRunning,
    markStepPassed,
    markStepWarning,
    markStepBlocked,
    markStepFailed,
    markStepSkipped,
    completePlan,
    getHistoryPlan,
    getPlanHistory,
    getPlanStatus,
    resetPlan
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = HistoryPlan;
}
