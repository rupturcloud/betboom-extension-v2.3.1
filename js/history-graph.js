/**
 * HistoryGraph — Execution graph (nós + fluxo)
 *
 * Responsabilidades:
 * 1. Criar nós de execução para cada etapa
 * 2. Rastrear status, latência, input/output de cada nó
 * 3. Construir caminho de execução completo
 * 4. Detectar erros e deadlocks no fluxo
 */

const HistoryGraph = (() => {
  let currentGraph = null;

  /**
   * Tipos de nós
   */
  const NODE_TYPES = [
    'CAPTURED',
    'NORMALIZED',
    'DEDUPED',
    'ORDERED',
    'STORED',
    'DIFFED',
    'VALIDATED',
    'RENDERED',
    'COMPARED',
    'REPORTED'
  ];

  /**
   * Cria nó de execução
   */
  function createGraphNode(type, status = 'pending') {
    const nodeId = `node_${type}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

    if (!NODE_TYPES.includes(type)) {
      console.warn(`[HistoryGraph] Tipo de nó desconhecido:`, type);
    }

    return {
      nodeId,
      type,
      status, // 'pending'|'running'|'passed'|'warning'|'blocked'|'failed'|'skipped'
      inputCount: 0,
      outputCount: 0,
      reason: null,
      evidenceIds: [],
      latencyMs: 0,
      startTime: null,
      endTime: null,
      timestamp: Date.now(),
      parent: null,
      children: []
    };
  }

  /**
   * Cria novo grafo
   */
  function createExecutionGraph(planId, traceId) {
    currentGraph = {
      graphId: `graph_${Date.now()}`,
      planId,
      traceId,
      nodes: [],
      nodeMap: new Map(),
      executionPath: [],
      status: 'created',
      createdAt: Date.now(),
      completedAt: null
    };

    return currentGraph;
  }

  /**
   * Adiciona nó ao grafo
   */
  function addNode(type, parentNodeId = null) {
    if (!currentGraph) {
      console.error(`[HistoryGraph] Grafo não inicializado`);
      return null;
    }

    const node = createGraphNode(type);
    node.parent = parentNodeId;

    currentGraph.nodes.push(node);
    currentGraph.nodeMap.set(node.nodeId, node);

    // Se tem parent, adicionar como child
    if (parentNodeId) {
      const parent = currentGraph.nodeMap.get(parentNodeId);
      if (parent) {
        parent.children.push(node.nodeId);
      }
    }

    console.log(`[HistoryGraph] Nó criado:`, {
      nodeId: node.nodeId,
      type,
      parent: parentNodeId
    });

    return node;
  }

  /**
   * Marca nó como running
   */
  function markNodeRunning(nodeId) {
    if (!currentGraph) return false;

    const node = currentGraph.nodeMap.get(nodeId);
    if (!node) {
      console.warn(`[HistoryGraph] Nó não encontrado:`, nodeId);
      return false;
    }

    node.status = 'running';
    node.startTime = Date.now();

    return true;
  }

  /**
   * Marca nó como passed
   */
  function markNodePassed(nodeId, inputCount = 0, outputCount = 0) {
    if (!currentGraph) return false;

    const node = currentGraph.nodeMap.get(nodeId);
    if (!node) {
      console.warn(`[HistoryGraph] Nó não encontrado:`, nodeId);
      return false;
    }

    node.status = 'passed';
    node.endTime = Date.now();
    node.latencyMs = node.endTime - node.startTime;
    node.inputCount = inputCount;
    node.outputCount = outputCount;

    currentGraph.executionPath.push(node.nodeId);

    console.log(`[HistoryGraph] Nó passed:`, {
      nodeId,
      type: node.type,
      latencyMs: node.latencyMs,
      input: inputCount,
      output: outputCount
    });

    return true;
  }

  /**
   * Marca nó como warning
   */
  function markNodeWarning(nodeId, reason = '') {
    if (!currentGraph) return false;

    const node = currentGraph.nodeMap.get(nodeId);
    if (!node) return false;

    node.status = 'warning';
    node.endTime = Date.now();
    node.latencyMs = node.endTime - node.startTime;
    node.reason = reason;

    currentGraph.executionPath.push(node.nodeId);

    console.warn(`[HistoryGraph] ⚠️ Nó warning:`, {
      nodeId,
      type: node.type,
      reason
    });

    return true;
  }

  /**
   * Marca nó como bloqueado/falhado
   */
  function markNodeFailed(nodeId, reason = '') {
    if (!currentGraph) return false;

    const node = currentGraph.nodeMap.get(nodeId);
    if (!node) return false;

    node.status = 'failed';
    node.endTime = Date.now();
    node.latencyMs = node.endTime - node.startTime;
    node.reason = reason;

    currentGraph.executionPath.push(node.nodeId);
    currentGraph.status = 'failed';

    // Marcar children como blocked
    for (const childId of node.children) {
      const child = currentGraph.nodeMap.get(childId);
      if (child && child.status === 'pending') {
        child.status = 'blocked';
      }
    }

    console.error(`[HistoryGraph] 🔴 Nó failed:`, {
      nodeId,
      type: node.type,
      reason,
      blockedChildren: node.children.length
    });

    return true;
  }

  /**
   * Marca nó como skipped
   */
  function markNodeSkipped(nodeId, reason = '') {
    if (!currentGraph) return false;

    const node = currentGraph.nodeMap.get(nodeId);
    if (!node) return false;

    node.status = 'skipped';
    node.reason = reason;

    return true;
  }

  /**
   * Adiciona evidência a um nó
   */
  function addEvidenceToNode(nodeId, evidenceId) {
    if (!currentGraph) return false;

    const node = currentGraph.nodeMap.get(nodeId);
    if (!node) return false;

    node.evidenceIds.push(evidenceId);
    return true;
  }

  /**
   * Retorna grafo completo
   */
  function getExecutionGraph() {
    return currentGraph ? { ...currentGraph } : null;
  }

  /**
   * Retorna caminho de execução
   */
  function getExecutionPath() {
    if (!currentGraph) return [];
    return currentGraph.executionPath.map(nodeId => {
      const node = currentGraph.nodeMap.get(nodeId);
      return {
        nodeId,
        type: node.type,
        status: node.status,
        latencyMs: node.latencyMs,
        reason: node.reason
      };
    });
  }

  /**
   * Detecta ciclos ou deadlocks no grafo
   */
  function detectCycles() {
    if (!currentGraph) return { hasCycle: false };

    const visited = new Set();
    const recursionStack = new Set();

    function hasCycleDFS(nodeId, visited, stack) {
      visited.add(nodeId);
      stack.add(nodeId);

      const node = currentGraph.nodeMap.get(nodeId);
      if (!node) return false;

      for (const childId of node.children) {
        if (!visited.has(childId)) {
          if (hasCycleDFS(childId, visited, stack)) {
            return true;
          }
        } else if (stack.has(childId)) {
          return true; // Ciclo detectado
        }
      }

      stack.delete(nodeId);
      return false;
    }

    for (const node of currentGraph.nodes) {
      if (!visited.has(node.nodeId)) {
        if (hasCycleDFS(node.nodeId, visited, recursionStack)) {
          return {
            hasCycle: true,
            error: 'Ciclo detectado no grafo'
          };
        }
      }
    }

    return { hasCycle: false };
  }

  /**
   * Retorna statísticas do grafo
   */
  function getGraphStats() {
    if (!currentGraph) {
      return { nodes: 0, passed: 0, failed: 0, skipped: 0 };
    }

    const stats = {
      nodes: currentGraph.nodes.length,
      passed: 0,
      warning: 0,
      failed: 0,
      blocked: 0,
      skipped: 0,
      pending: 0,
      totalLatencyMs: 0
    };

    for (const node of currentGraph.nodes) {
      stats[node.status] = (stats[node.status] || 0) + 1;
      if (node.latencyMs) {
        stats.totalLatencyMs += node.latencyMs;
      }
    }

    return stats;
  }

  /**
   * Marca grafo como completo
   */
  function completeGraph() {
    if (!currentGraph) return false;

    currentGraph.completedAt = Date.now();

    // Detectar ciclos
    const cycleCheck = detectCycles();
    if (cycleCheck.hasCycle) {
      currentGraph.status = 'error_cycle';
      console.error(`[HistoryGraph] 🔴 Ciclo detectado no grafo`);
    } else {
      currentGraph.status = 'completed';
      console.log(`[HistoryGraph] ✓ Grafo completado`);
    }

    return true;
  }

  /**
   * Reseta grafo
   */
  function resetGraph() {
    currentGraph = null;
  }

  return {
    createExecutionGraph,
    addNode,
    markNodeRunning,
    markNodePassed,
    markNodeWarning,
    markNodeFailed,
    markNodeSkipped,
    addEvidenceToNode,
    getExecutionGraph,
    getExecutionPath,
    detectCycles,
    getGraphStats,
    completeGraph,
    resetGraph,
    NODE_TYPES
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = HistoryGraph;
}
