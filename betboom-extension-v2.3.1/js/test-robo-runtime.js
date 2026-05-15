/**
 * Test Suite para Robô Runtime
 * Execute no console do navegador: TestRoboRuntime.runFullTest()
 */

const TestRoboRuntime = (() => {
  const results = [];

  function log(test, passed, details = '') {
    const status = passed ? '✓' : '✗';
    const color = passed ? '#0f0' : '#f00';
    console.log(`%c${status}%c ${test}${details ? ' — ' + details : ''}`, `color: ${color}; font-weight: bold;`, 'color: inherit;');
    results.push({ test, passed, details });
  }

  function testDecisionPlanCreation() {
    console.log('\n=== Test: Decision Plan Creation ===');

    const roundId = 'TEST_ROUND_001';
    const cores = [
      { cor: 'vermelho', timestamp: Date.now() - 5000 },
      { cor: 'preto', timestamp: Date.now() - 3000 }
    ];

    const plan = RoboRuntime.createDecisionPlan(roundId, cores);

    log('DecisionPlan created', !!plan);
    log('Plan has planId', !!plan.planId);
    log('Plan has objective', !!plan.objective);
    log('Plan has steps array', Array.isArray(plan.steps));
    log('Plan has 7 steps', plan.steps.length === 7);
    log('Plan status is "created"', plan.status === 'created');
    log('Plan facts stored', cores.length === plan.facts.historicoLength);

    return plan;
  }

  function testCheckpointCreation(plan) {
    console.log('\n=== Test: Checkpoint Creation & Evaluation ===');

    const checkpoint = RoboRuntime.createCheckpoint('historyIntegrity', {
      historyIntegrity: 0.95
    });

    log('Checkpoint created', !!checkpoint);
    log('Checkpoint has id', !!checkpoint.id);
    log('Checkpoint status is "pending"', checkpoint.status === 'pending');

    return checkpoint;
  }

  async function testCheckpointEvaluation(checkpoint) {
    console.log('\n=== Test: Checkpoint Evaluation ===');

    // Test: checkpoint passes with high match rate
    const passContext = { historyMatchRate: 98 };
    const passResults = await RoboRuntime.evaluateCheckpoint(checkpoint, passContext);
    log('Checkpoint PASSES at 98% match', passResults.passed);
    log('Checkpoint status updated to "passed"', checkpoint.status === 'passed');

    // Test: checkpoint fails with low match rate
    const failCheckpoint = RoboRuntime.createCheckpoint('historyIntegrity', {
      historyIntegrity: 0.95
    });
    const failContext = { historyMatchRate: 80 };
    const failResults = await RoboRuntime.evaluateCheckpoint(failCheckpoint, failContext);
    log('Checkpoint FAILS at 80% match', !failResults.passed);
    log('Checkpoint status updated to "failed"', failCheckpoint.status === 'failed');
    log('Failure reason recorded', !!failCheckpoint.reason);
  }

  function testPlanStepTracking(plan) {
    console.log('\n=== Test: Plan Step Tracking ===');

    const updated = RoboRuntime.updatePlanStep(plan, 'VALIDATE_HISTORY', 'completed', { matchRate: 98 });
    log('Step updated', updated);
    log('Step status changed', plan.steps[0].status === 'completed');
    log('Completed steps counter incremented', plan.completedSteps === 1);

    // Test: failed step
    const failedUpdated = RoboRuntime.updatePlanStep(plan, 'MATCH_PATTERN', 'failed', { reason: 'No pattern found' });
    log('Failed step recorded', failedUpdated);
    log('Failed steps array populated', plan.failedSteps.length > 0);
  }

  function testPlanBlocking(plan) {
    console.log('\n=== Test: Plan Blocking ===');

    const blockReason = 'History integrity below threshold';
    RoboRuntime.blockPlan(plan, blockReason);

    log('Plan status changed to "blocked"', plan.status === 'blocked');
    log('Blocker reason recorded', plan.blockers.length > 0);
    log('Blocker reason matches', plan.blockers[0]?.reason === blockReason);
  }

  function testExecutionPlanCreation(planId, roundId) {
    console.log('\n=== Test: Execution Plan Creation ===');

    const recommendation = {
      action: 'RED',
      acao: 'RED',
      confidence: 75,
      conviction: 78,
      consensus: 82
    };

    const execPlan = RoboRuntime.createExecutionPlan(planId, roundId, recommendation);

    log('ExecutionPlan created', !!execPlan);
    log('ExecutionPlan has executionPlanId', !!execPlan.executionPlanId);
    log('ExecutionPlan has 5 steps', execPlan.steps.length === 5);
    log('ExecutionPlan stores recommendation', execPlan.recommendation.acao === 'RED');
    log('ExecutionPlan status is "created"', execPlan.status === 'created');

    return execPlan;
  }

  function testPlanRetrieval(roundId, planId) {
    console.log('\n=== Test: Plan Retrieval & Status ===');

    const retrieved = RoboRuntime.getDecisionPlan(roundId);
    log('DecisionPlan retrieved by roundId', !!retrieved);

    const status = RoboRuntime.getPlanStatus(roundId);
    log('Plan status retrieved', !!status);
    log('Status includes planId', status?.planId === planId);
    log('Status includes currentProgress', typeof status?.completedSteps === 'number');
  }

  function testCheckpointHistory() {
    console.log('\n=== Test: Checkpoint History ===');

    const history = RoboRuntime.getCheckpointHistory();
    log('Checkpoint history retrieved', Array.isArray(history));
    log('History contains records', history.length > 0);
  }

  async function runFullTest() {
    console.clear();
    console.log('%c╔════════════════════════════════════════════════╗', 'color: #0f0;');
    console.log('%c║     ROBÔ RUNTIME — FULL TEST SUITE            ║', 'color: #0f0;');
    console.log('%c╚════════════════════════════════════════════════╝', 'color: #0f0;');

    // Verificar pré-requisitos
    console.log('\n=== Pre-requisites Check ===');
    const hasRoboRuntime = typeof RoboRuntime !== 'undefined';
    const hasDecisionGraphEngine = typeof DecisionGraphEngine !== 'undefined';

    log('RoboRuntime available', hasRoboRuntime);
    log('DecisionGraphEngine available', hasDecisionGraphEngine);

    if (!hasRoboRuntime) {
      console.error('ERRO: RoboRuntime não está disponível!');
      return;
    }

    // Rodar testes
    const plan = testDecisionPlanCreation();
    const checkpoint = testCheckpointCreation(plan);
    await testCheckpointEvaluation(checkpoint);
    testPlanStepTracking(plan);
    testPlanBlocking(plan);
    const execPlan = testExecutionPlanCreation(plan.planId, plan.roundId);
    testPlanRetrieval(plan.roundId, plan.planId);
    testCheckpointHistory();

    // Resumo
    console.log('\n=== TEST SUMMARY ===');
    const passed = results.filter(r => r.passed).length;
    const total = results.length;
    const percentage = ((passed / total) * 100).toFixed(1);

    console.log(`%cRESULTADO: ${passed}/${total} (${percentage}%)`, `color: ${passed === total ? '#0f0' : '#f00'}; font-weight: bold;`);

    if (passed === total) {
      console.log('%c✓ TODOS OS TESTES PASSARAM!', 'color: #0f0; font-size: 14px; font-weight: bold;');
    } else {
      console.log(`%c✗ ${total - passed} TESTES FALHARAM!`, 'color: #f00; font-size: 14px; font-weight: bold;');
    }

    console.log('\n=== PRÓXIMOS PASSOS ===');
    console.log('1. Recarregar a extensão no navegador (chrome://extensions/)');
    console.log('2. Abrir jogo BacBo na plataforma BetBoom');
    console.log('3. Verificar console para logs de [RoboRuntime]');
    console.log('4. Visualizar Plan Status no canto inferior esquerdo (PlanVisualizer)');
    console.log('5. Testar cada checkpoint: RoboRuntime.getCheckpointHistory()');

    return { passed, total, percentage, results };
  }

  return {
    runFullTest,
    // Exposed para testes manuais
    testDecisionPlanCreation,
    testCheckpointCreation,
    testCheckpointEvaluation,
    testPlanStepTracking,
    testPlanBlocking,
    testExecutionPlanCreation,
    testPlanRetrieval,
    testCheckpointHistory
  };
})();

// Alias para fácil acesso
window.RoboTest = TestRoboRuntime;

console.log('[TestRoboRuntime] Loaded. Run: RoboTest.runFullTest()');
