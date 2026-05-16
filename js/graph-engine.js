/**
 * Graph Engine — Decisão e Execução Causal
 * Cada rodada gera grafo completo: ROUND_DETECTED → ROUND_SETTLED
 * Nós: pendente, rodando, passou, aviso, bloqueado, falhou, ignorado
 */

const GraphEngine = (() => {
  const graphs = new Map(); // traceId → grafo completo
  const nodeRegistry = new Map(); // nodeId → nó com metadados

  const NodeStatus = Object.freeze({
    PENDING: 'pending',
    RUNNING: 'running',
    PASSED: 'passed',
    WARNING: 'warning',
    BLOCKED: 'blocked',
    FAILED: 'failed',
    SKIPPED: 'skipped'
  });

  const StandardNodes = Object.freeze({
    ROUND_DETECTED: 'ROUND_DETECTED',
    HISTORY_UPDATED: 'HISTORY_UPDATED',
    PATTERN_MATCHED: 'PATTERN_MATCHED',
    CONTEXT_EVALUATED: 'CONTEXT_EVALUATED',
    CONSENSUS_RESOLVED: 'CONSENSUS_RESOLVED',
    CONVICTION_CALCULATED: 'CONVICTION_CALCULATED',
    DECISION_CREATED: 'DECISION_CREATED',
    SAFETY_CHECKED: 'SAFETY_CHECKED',
    OPERATOR_CONFIRMED: 'OPERATOR_CONFIRMED',
    ACTION_EXECUTED: 'ACTION_EXECUTED',
    ACTION_CONFIRMED: 'ACTION_CONFIRMED',
    ROUND_SETTLED: 'ROUND_SETTLED'
  });

  // Inicializar grafo vazio
  function createGraph(roundId, traceId) {
    const graph = {
      roundId,
      traceId,
      startedAt: Date.now(),
      completedAt: null,
      nodes: new Map(),
      edges: [], // { from, to, type: 'causal'|'blocking'|'conditional' }
      totalLatencyMs: 0,
      status: NodeStatus.PENDING,
      summary: {}
    };

    // Criar nós padrão
    Object.values(StandardNodes).forEach(nodeId => {
      createNode(graph, nodeId);
    });

    graphs.set(traceId, graph);
    return graph;
  }

  function createNode(graph, nodeId) {
    const node = {
      nodeId,
      status: NodeStatus.PENDING,
      input: {},
      output: {},
      reason: '',
      blockedBy: [],
      latencyMs: 0,
      confidence: 0,
      conviction: 0,
      consensus: 0,
      risk: 0,
      evidenceIds: [],
      traceId: graph.traceId,
      timestamp: Date.now(),
      metadata: {}
    };

    graph.nodes.set(nodeId, node);
    nodeRegistry.set(`${graph.traceId}:${nodeId}`, node);
    return node;
  }

  function updateNode(traceId, nodeId, updates) {
    const graph = graphs.get(traceId);
    if (!graph) return null;

    const node = graph.nodes.get(nodeId);
    if (!node) return null;

    const previousStatus = node.status;
    const startTime = Date.now();

    // Aplicar atualizações
    Object.assign(node, updates);
    node.latencyMs = Date.now() - startTime;

    // Registrar transição de status
    if (previousStatus !== node.status) {
      logStatusTransition(traceId, nodeId, previousStatus, node.status);
    }

    return node;
  }

  function setNodeRunning(traceId, nodeId) {
    return updateNode(traceId, nodeId, {
      status: NodeStatus.RUNNING,
      timestamp: Date.now()
    });
  }

  function setNodePassed(traceId, nodeId, output = {}, metadata = {}) {
    return updateNode(traceId, nodeId, {
      status: NodeStatus.PASSED,
      output,
      metadata,
      timestamp: Date.now()
    });
  }

  function setNodeWarning(traceId, nodeId, reason = '', metadata = {}) {
    return updateNode(traceId, nodeId, {
      status: NodeStatus.WARNING,
      reason,
      metadata,
      timestamp: Date.now()
    });
  }

  function setNodeBlocked(traceId, nodeId, blockedBy = [], reason = '') {
    return updateNode(traceId, nodeId, {
      status: NodeStatus.BLOCKED,
      blockedBy,
      reason,
      timestamp: Date.now()
    });
  }

  function setNodeFailed(traceId, nodeId, reason = '', metadata = {}) {
    return updateNode(traceId, nodeId, {
      status: NodeStatus.FAILED,
      reason,
      metadata,
      timestamp: Date.now()
    });
  }

  function setNodeSkipped(traceId, nodeId, reason = '') {
    return updateNode(traceId, nodeId, {
      status: NodeStatus.SKIPPED,
      reason,
      timestamp: Date.now()
    });
  }

  // Arestas causais: A causa B, A bloqueia B, etc
  function addEdge(traceId, fromNodeId, toNodeId, type = 'causal', metadata = {}) {
    const graph = graphs.get(traceId);
    if (!graph) return null;

    const edge = {
      from: fromNodeId,
      to: toNodeId,
      type, // 'causal' | 'blocking' | 'conditional'
      metadata,
      timestamp: Date.now()
    };

    graph.edges.push(edge);
    return edge;
  }

  // Registrar evidência em um nó
  function addEvidence(traceId, nodeId, evidenceId, evidence = {}) {
    const node = nodeRegistry.get(`${traceId}:${nodeId}`);
    if (!node) return null;

    node.evidenceIds.push(evidenceId);
    node.metadata.evidence = node.metadata.evidence || {};
    node.metadata.evidence[evidenceId] = evidence;

    return node;
  }

  // Atualizar métricas de confiança/convicção/consenso
  function updateMetrics(traceId, nodeId, metrics = {}) {
    const node = nodeRegistry.get(`${traceId}:${nodeId}`);
    if (!node) return null;

    if (metrics.confidence !== undefined) node.confidence = metrics.confidence;
    if (metrics.conviction !== undefined) node.conviction = metrics.conviction;
    if (metrics.consensus !== undefined) node.consensus = metrics.consensus;
    if (metrics.risk !== undefined) node.risk = metrics.risk;

    return node;
  }

  function logStatusTransition(traceId, nodeId, from, to) {
    const node = nodeRegistry.get(`${traceId}:${nodeId}`);
    if (!node) return;

    node.metadata.statusHistory = node.metadata.statusHistory || [];
    node.metadata.statusHistory.push({
      from,
      to,
      timestamp: Date.now()
    });
  }

  // Obter caminho causal até um nó
  function getCausalPath(traceId, targetNodeId) {
    const graph = graphs.get(traceId);
    if (!graph) return [];

    const path = [];
    const visited = new Set();

    function traverse(nodeId) {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);

      const node = graph.nodes.get(nodeId);
      if (node) path.push(node);

      // Encontrar nós que causam este
      graph.edges
        .filter(e => e.to === nodeId && e.type === 'causal')
        .forEach(e => traverse(e.from));
    }

    traverse(targetNodeId);
    return path.reverse();
  }

  // Obter bloqueadores
  function getBlockers(traceId, nodeId) {
    const graph = graphs.get(traceId);
    if (!graph) return [];

    const blockers = [];

    graph.edges
      .filter(e => e.to === nodeId && e.type === 'blocking')
      .forEach(e => {
        const blocker = graph.nodes.get(e.from);
        if (blocker && blocker.status !== NodeStatus.PASSED) {
          blockers.push(blocker);
        }
      });

    return blockers;
  }

  // Finalizar grafo
  function finalizeGraph(traceId) {
    const graph = graphs.get(traceId);
    if (!graph) return null;

    graph.completedAt = Date.now();
    graph.totalLatencyMs = graph.completedAt - graph.startedAt;

    // Calcular status geral
    const nodeStatuses = Array.from(graph.nodes.values()).map(n => n.status);
    if (nodeStatuses.includes(NodeStatus.FAILED)) {
      graph.status = NodeStatus.FAILED;
    } else if (nodeStatuses.includes(NodeStatus.BLOCKED)) {
      graph.status = NodeStatus.BLOCKED;
    } else if (nodeStatuses.includes(NodeStatus.WARNING)) {
      graph.status = NodeStatus.WARNING;
    } else {
      graph.status = NodeStatus.PASSED;
    }

    // Gerar resumo
    graph.summary = {
      totalNodes: graph.nodes.size,
      passed: Array.from(graph.nodes.values()).filter(n => n.status === NodeStatus.PASSED).length,
      warnings: Array.from(graph.nodes.values()).filter(n => n.status === NodeStatus.WARNING).length,
      blocked: Array.from(graph.nodes.values()).filter(n => n.status === NodeStatus.BLOCKED).length,
      failed: Array.from(graph.nodes.values()).filter(n => n.status === NodeStatus.FAILED).length,
      skipped: Array.from(graph.nodes.values()).filter(n => n.status === NodeStatus.SKIPPED).length,
      latencyMs: graph.totalLatencyMs
    };

    return graph;
  }

  // Exportar grafo para visualização
  function exportGraph(traceId) {
    const graph = graphs.get(traceId);
    if (!graph) return null;

    return {
      roundId: graph.roundId,
      traceId: graph.traceId,
      startedAt: graph.startedAt,
      completedAt: graph.completedAt,
      totalLatencyMs: graph.totalLatencyMs,
      status: graph.status,
      nodes: Array.from(graph.nodes.values()),
      edges: graph.edges,
      summary: graph.summary
    };
  }

  // Obter últimos N grafos
  function getRecentGraphs(limit = 10) {
    return Array.from(graphs.values())
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, limit)
      .map(g => exportGraph(g.traceId));
  }

  // Limpar grafos antigos (> 1 hora)
  function cleanupOldGraphs(ageMs = 3600000) {
    const now = Date.now();
    for (const [traceId, graph] of graphs.entries()) {
      if (now - graph.startedAt > ageMs) {
        graphs.delete(traceId);
      }
    }
  }

  return {
    // Criação e gerenciamento
    createGraph,
    finalizeGraph,
    exportGraph,
    getRecentGraphs,
    cleanupOldGraphs,

    // Nós
    createNode,
    updateNode,
    setNodeRunning,
    setNodePassed,
    setNodeWarning,
    setNodeBlocked,
    setNodeFailed,
    setNodeSkipped,

    // Arestas e evidência
    addEdge,
    addEvidence,
    updateMetrics,

    // Consultas
    getCausalPath,
    getBlockers,

    // Constantes
    NodeStatus,
    StandardNodes
  };
})();

// Exportar para uso global
window.GraphEngine = GraphEngine;
