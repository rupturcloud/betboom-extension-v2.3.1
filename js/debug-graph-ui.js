/**
 * Debug Graph UI
 * Renderização visual do grafo de decisão com timeline, cores, latências
 * P2: Estabilização da visualização operacional
 */

const DebugGraphUI = (() => {
  const nodeColors = {
    pending: '#475569',
    running: '#3b82f6',
    passed: '#10b981',
    warning: '#f59e0b',
    blocked: '#ef4444',
    failed: '#dc2626',
    skipped: '#64748b'
  };

  const nodePositions = {
    ROUND_DETECTED: { x: 50, y: 50 },
    HISTORY_UPDATED: { x: 150, y: 50 },
    PATTERN_MATCHED: { x: 250, y: 50 },
    CONTEXT_EVALUATED: { x: 350, y: 50 },
    CONSENSUS_RESOLVED: { x: 450, y: 50 },
    CONVICTION_CALCULATED: { x: 550, y: 50 },
    DECISION_CREATED: { x: 650, y: 50 },
    SAFETY_CHECKED: { x: 750, y: 50 },
    OPERATOR_CONFIRMED: { x: 850, y: 50 },
    ACTION_EXECUTED: { x: 950, y: 50 },
    ACTION_CONFIRMED: { x: 1050, y: 50 },
    ROUND_SETTLED: { x: 1150, y: 50 }
  };

  function criarContainerDebug() {
    const container = document.createElement('div');
    container.id = 'bb-debug-graph-container';
    container.style.cssText = `
      position: fixed;
      right: 20px;
      top: 120px;
      width: 1200px;
      height: 400px;
      background: rgba(15,23,42,0.95);
      border: 1px solid rgba(100,116,139,0.3);
      border-radius: 8px;
      overflow: hidden;
      z-index: 9998;
      font-family: 'Monaco', 'Courier New', monospace;
      display: none;
      flex-direction: column;
    `;

    const header = document.createElement('div');
    header.style.cssText = `
      padding: 10px 15px;
      background: rgba(30,41,59,0.8);
      border-bottom: 1px solid rgba(100,116,139,0.3);
      display: flex;
      justify-content: space-between;
      align-items: center;
      color: #cbd5e1;
      font-size: 11px;
    `;
    header.innerHTML = `
      <span>📊 Grafo de Decisão</span>
      <div style="display:flex; gap:10px;">
        <button id="bb-graph-pause" style="background:#334; color:#94a3b8; border:1px solid #555; padding:4px 8px; border-radius:3px; cursor:pointer; font-size:10px;">⏸ Pausar</button>
        <button id="bb-graph-clear" style="background:#334; color:#94a3b8; border:1px solid #555; padding:4px 8px; border-radius:3px; cursor:pointer; font-size:10px;">🗑️ Limpar</button>
        <button id="bb-graph-close" style="background:#334; color:#94a3b8; border:1px solid #555; padding:4px 8px; border-radius:3px; cursor:pointer; font-size:10px;">✕</button>
      </div>
    `;

    const canvas = document.createElement('canvas');
    canvas.id = 'bb-graph-canvas';
    canvas.width = 1200;
    canvas.height = 350;
    canvas.style.cssText = `
      display: block;
      background: linear-gradient(135deg, rgba(15,23,42,0.5) 0%, rgba(30,41,59,0.5) 100%);
    `;

    const timeline = document.createElement('div');
    timeline.id = 'bb-graph-timeline';
    timeline.style.cssText = `
      padding: 8px 15px;
      background: rgba(20,28,40,0.6);
      border-top: 1px solid rgba(100,116,139,0.2);
      height: auto;
      overflow-x: auto;
      font-size: 9px;
      color: #94a3b8;
      display: flex;
      gap: 15px;
      align-items: center;
    `;

    container.appendChild(header);
    container.appendChild(canvas);
    container.appendChild(timeline);

    document.body.appendChild(container);

    document.getElementById('bb-graph-close').addEventListener('click', fecharGrafo);
    document.getElementById('bb-graph-pause').addEventListener('click', () => {
      const btn = document.getElementById('bb-graph-pause');
      btn.textContent = btn.textContent.includes('Pausar') ? '▶ Retomar' : '⏸ Pausar';
    });
    document.getElementById('bb-graph-clear').addEventListener('click', () => {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      document.getElementById('bb-graph-timeline').innerHTML = '';
    });

    return container;
  }

  function abrirGrafo() {
    const container = document.getElementById('bb-debug-graph-container') || criarContainerDebug();
    container.style.display = 'flex';
  }

  function fecharGrafo() {
    const container = document.getElementById('bb-debug-graph-container');
    if (container) container.style.display = 'none';
  }

  function renderizarGrafo(grafo) {
    const container = document.getElementById('bb-debug-graph-container');
    if (!container) criarContainerDebug();

    const canvas = document.getElementById('bb-graph-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(20,28,40,0.3)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!grafo || !grafo.nodes || grafo.nodes.length === 0) {
      ctx.fillStyle = '#64748b';
      ctx.font = '12px Monaco';
      ctx.fillText('Aguardando grafo...', 500, 175);
      return;
    }

    // Renderizar arestas
    grafo.nodes.forEach(node => {
      node.blockedBy.forEach(blockerNodeId => {
        const blocker = grafo.nodes.find(n => n.nodeId === blockerNodeId);
        if (blocker) {
          const fromPos = nodePositions[blockerNodeId] || { x: 100, y: 100 };
          const toPos = nodePositions[node.nodeId] || { x: 100, y: 100 };

          ctx.strokeStyle = 'rgba(100,116,139,0.4)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(fromPos.x + 30, fromPos.y + 50);
          ctx.lineTo(toPos.x - 30, toPos.y + 50);
          ctx.stroke();

          // Seta
          const dx = toPos.x - fromPos.x;
          const dy = toPos.y - fromPos.y;
          const angle = Math.atan2(dy, dx);
          ctx.fillStyle = 'rgba(100,116,139,0.6)';
          ctx.save();
          ctx.translate(toPos.x - 30, toPos.y + 50);
          ctx.rotate(angle);
          ctx.fillRect(0, -2, 8, 4);
          ctx.restore();
        }
      });
    });

    // Renderizar nós
    grafo.nodes.forEach(node => {
      const pos = nodePositions[node.nodeId] || { x: 100, y: 100 };
      const color = nodeColors[node.status] || nodeColors.pending;

      // Círculo externo
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 28, 0, Math.PI * 2);
      ctx.stroke();

      // Preenchimento
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.2;
      ctx.fill();
      ctx.globalAlpha = 1;

      // Rótulo do nó
      const label = node.nodeId.replace(/_/g, '\n').substring(0, 8);
      ctx.fillStyle = color;
      ctx.font = 'bold 8px Monaco';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, pos.x, pos.y);

      // Latência
      if (node.latencyMs > 0) {
        ctx.fillStyle = '#94a3b8';
        ctx.font = '7px Monaco';
        ctx.fillText(`${node.latencyMs}ms`, pos.x, pos.y + 35);
      }

      // Status badge
      const badge = node.status.substring(0, 1).toUpperCase();
      ctx.fillStyle = color;
      ctx.fillRect(pos.x + 22, pos.y - 22, 12, 12);
      ctx.fillStyle = '#000';
      ctx.font = 'bold 8px Monaco';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(badge, pos.x + 28, pos.y - 16);
    });

    // Timeline
    atualizarTimeline(grafo);
  }

  function atualizarTimeline(grafo) {
    const timeline = document.getElementById('bb-graph-timeline');
    if (!timeline) return;

    const nodeSequence = [
      'ROUND_DETECTED', 'HISTORY_UPDATED', 'PATTERN_MATCHED', 'CONTEXT_EVALUATED',
      'CONSENSUS_RESOLVED', 'CONVICTION_CALCULATED', 'DECISION_CREATED', 'SAFETY_CHECKED',
      'OPERATOR_CONFIRMED', 'ACTION_EXECUTED', 'ACTION_CONFIRMED', 'ROUND_SETTLED'
    ];

    let html = 'Timeline: ';
    nodeSequence.forEach((nodeId, idx) => {
      const node = grafo.nodes.find(n => n.nodeId === nodeId);
      if (node) {
        const cor = nodeColors[node.status];
        const emoji = node.status === 'passed' ? '✓' : (node.status === 'failed' ? '✗' : '•');
        html += `<span style="color:${cor}; margin-right:2px;">${emoji} ${nodeId.substring(0, 4)}</span>`;
        if (idx < nodeSequence.length - 1) html += ' → ';
      }
    });

    timeline.innerHTML = html;
  }

  function monitorarGrafo(intervalMs = 500) {
    setInterval(() => {
      if (typeof DecisionGraphEngine === 'undefined') return;
      const container = document.getElementById('bb-debug-graph-container');
      if (!container || container.style.display === 'none') return;

      const graphs = DecisionGraphEngine.getRecentGraphs?.(1) || [];
      if (graphs.length > 0) {
        renderizarGrafo(graphs[0]);
      }
    }, intervalMs);
  }

  return {
    abrirGrafo,
    fecharGrafo,
    renderizarGrafo,
    monitorarGrafo,
    criarContainerDebug
  };
})();

window.DebugGraphUI = DebugGraphUI;
