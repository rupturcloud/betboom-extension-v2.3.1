/**
 * Plan Visualizer
 * Mostra status de DecisionPlan e ExecutionPlan no overlay
 */

const PlanVisualizer = (() => {
  let visualElement = null;
  const UPDATE_INTERVAL = 500; // ms
  let updateTimer = null;

  function createVisualElement() {
    const el = document.createElement('div');
    el.id = 'bb-plan-visualizer';
    el.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 20px;
      background: rgba(0, 0, 0, 0.9);
      color: #0f0;
      font-family: 'Courier New', monospace;
      font-size: 11px;
      padding: 10px;
      border: 1px solid #0f0;
      border-radius: 4px;
      max-width: 350px;
      z-index: 9999;
      max-height: 400px;
      overflow-y: auto;
      cursor: pointer;
    `;
    el.title = 'Click to toggle details';
    return el;
  }

  function formatStepStatus(status) {
    const icons = {
      'pending': '○',
      'completed': '✓',
      'failed': '✗',
      'in_progress': '●'
    };
    const colors = {
      'pending': '#666',
      'completed': '#0f0',
      'failed': '#f00',
      'in_progress': '#ff0'
    };
    return `<span style="color: ${colors[status] || '#999'}">${icons[status] || '?'}</span>`;
  }

  function renderPlanStatus(plan) {
    if (!plan) return '<div style="color: #666;">No plan</div>';

    const completionRate = plan.completedSteps / plan.steps.length * 100;
    const blocked = plan.blockers.length > 0;
    const statusColor = blocked ? '#f00' : (completionRate === 100 ? '#0f0' : '#ff0');

    let html = `
      <div style="border-bottom: 1px solid #333; padding-bottom: 8px; margin-bottom: 8px;">
        <div><strong>Plan:</strong> <span style="color: #08f; font-size: 10px;">${plan.planId.slice(0, 16)}...</span></div>
        <div><strong>Status:</strong> <span style="color: ${statusColor};">${plan.status}</span></div>
        <div><strong>Progress:</strong> ${plan.completedSteps}/${plan.steps.length} (${completionRate.toFixed(0)}%)</div>
        <div style="background: #333; height: 4px; margin: 4px 0; border-radius: 2px;">
          <div style="background: ${statusColor}; height: 100%; width: ${completionRate}%; border-radius: 2px; transition: width 0.2s;"></div>
        </div>
    `;

    if (blocked) {
      html += `<div style="color: #f00;"><strong>BLOQUEADO:</strong> ${plan.blockers[0]?.reason || 'Unknown'}</div>`;
    }

    html += '</div>';

    // Lista de passos
    html += '<div style="font-size: 10px;"><strong>Passos:</strong>';
    plan.steps.forEach(step => {
      const icon = formatStepStatus(step.status);
      const stepColor = step.status === 'completed' ? '#0f0' : (step.status === 'failed' ? '#f00' : '#666');
      html += `<div style="color: ${stepColor}; margin-left: 10px;">${icon} ${step.name}</div>`;
    });
    html += '</div>';

    if (plan.failedSteps?.length > 0) {
      html += `<div style="color: #f00; margin-top: 8px; font-size: 10px;"><strong>Falhas:</strong> ${plan.failedSteps.map(s => s.stepName).join(', ')}</div>`;
    }

    return html;
  }

  function updateDisplay() {
    if (!visualElement || !typeof RoboRuntime !== 'undefined') return;

    // Pegar rodada atual
    const currentRound = Collector?.getCurrentRound?.() || 0;
    const plan = RoboRuntime.getPlanStatus(currentRound);

    if (!plan) {
      visualElement.innerHTML = '<div style="color: #666; font-size: 10px;">Aguardando rodada...</div>';
      return;
    }

    visualElement.innerHTML = renderPlanStatus(plan);
  }

  function mount() {
    if (visualElement) return;

    visualElement = createVisualElement();
    document.body.appendChild(visualElement);

    // Click para toggle detalhes
    visualElement.addEventListener('click', () => {
      visualElement.style.display = visualElement.style.display === 'none' ? 'block' : 'none';
    });

    // Atualizar periodicamente
    updateTimer = setInterval(updateDisplay, UPDATE_INTERVAL);
    updateDisplay();

    console.log('[PlanVisualizer] Montado no overlay');
  }

  function unmount() {
    if (updateTimer) {
      clearInterval(updateTimer);
      updateTimer = null;
    }
    if (visualElement && visualElement.parentNode) {
      visualElement.parentNode.removeChild(visualElement);
      visualElement = null;
    }
    console.log('[PlanVisualizer] Desmontado');
  }

  function show() {
    if (!visualElement) mount();
    if (visualElement) visualElement.style.display = 'block';
  }

  function hide() {
    if (visualElement) visualElement.style.display = 'none';
  }

  return {
    mount,
    unmount,
    show,
    hide,
    updateDisplay
  };
})();

// Auto-mount quando disponível
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    if (typeof RoboRuntime !== 'undefined' && typeof Collector !== 'undefined') {
      PlanVisualizer.mount();
    }
  });
} else {
  if (typeof RoboRuntime !== 'undefined' && typeof Collector !== 'undefined') {
    PlanVisualizer.mount();
  }
}

window.PlanVisualizer = PlanVisualizer;
