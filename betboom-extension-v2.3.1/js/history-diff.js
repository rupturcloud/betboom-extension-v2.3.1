/**
 * HistoryDiff — Detecção de mudanças (diff loop)
 *
 * Responsabilidades:
 * 1. Comparar previousHistory vs nextHistory
 * 2. Identificar: added, removed, updated, reordered, colorChanged
 * 3. Gerar hash do diff para detecção de duplicatas
 * 4. Evitar re-render se não há mudanças
 */

const HistoryDiff = (() => {
  /**
   * Calcula hash simples de um round para comparação rápida
   */
  function hashRound(round) {
    if (!round) return '';
    return `${round.roundId || round.signature}:${round.color}`;
  }

  /**
   * Calcula hash do histórico inteiro
   */
  function hashHistory(history) {
    if (!Array.isArray(history)) return '';
    return history.map(hashRound).join('|');
  }

  /**
   * Compara dois arrays por signature/roundId
   */
  function diffHistory(prevHistory, nextHistory) {
    if (!Array.isArray(prevHistory)) prevHistory = [];
    if (!Array.isArray(nextHistory)) nextHistory = [];

    const added = [];
    const removed = [];
    const updated = [];
    const duplicated = [];
    const reordered = [];
    const colorChanged = [];

    // Mapear previous por signature
    const prevMap = new Map();
    for (const round of prevHistory) {
      prevMap.set(round.signature, round);
    }

    // Detectar added, updated, reordered
    const nextMap = new Map();
    for (const round of nextHistory) {
      nextMap.set(round.signature, round);

      if (prevMap.has(round.signature)) {
        // Já existia
        const prevRound = prevMap.get(round.signature);

        // Detectar mudança de cor
        if (prevRound.color !== round.color) {
          colorChanged.push({
            signature: round.signature,
            before: prevRound.color,
            after: round.color
          });
          updated.push({
            signature: round.signature,
            type: 'color_changed'
          });
        }

        // Detectar mudança de posição (reordenação)
        const prevIdx = prevHistory.findIndex(r => r.signature === round.signature);
        const nextIdx = nextHistory.findIndex(r => r.signature === round.signature);
        if (prevIdx !== nextIdx) {
          reordered.push({
            signature: round.signature,
            before: prevIdx,
            after: nextIdx
          });
        }
      } else {
        // Novo round
        added.push({
          signature: round.signature,
          roundId: round.roundId,
          result: round.result,
          color: round.color
        });
      }
    }

    // Detectar removed
    for (const round of prevHistory) {
      if (!nextMap.has(round.signature)) {
        removed.push({
          signature: round.signature,
          roundId: round.roundId,
          result: round.result
        });
      }
    }

    // Detectar duplicatas (mesma signature, múltiplos itens)
    const signatureCounts = new Map();
    for (const round of nextHistory) {
      const count = (signatureCounts.get(round.signature) || 0) + 1;
      signatureCounts.set(round.signature, count);
    }
    for (const [sig, count] of signatureCounts.entries()) {
      if (count > 1) {
        duplicated.push({
          signature: sig,
          count
        });
      }
    }

    // Gerar hashes
    const prevHash = hashHistory(prevHistory);
    const nextHash = hashHistory(nextHistory);
    const hasChanges = prevHash !== nextHash;

    const diff = {
      added,
      removed,
      updated,
      duplicated,
      reordered,
      colorChanged,
      countBefore: prevHistory.length,
      countAfter: nextHistory.length,
      hasChanges,
      prevHash,
      nextHash
    };

    // Log estruturado
    if (hasChanges) {
      console.log(`[HistoryDiff] Mudanças detectadas:`, {
        before: prevHistory.length,
        after: nextHistory.length,
        added: added.length,
        removed: removed.length,
        updated: updated.length,
        reordered: reordered.length,
        colorChanged: colorChanged.length,
        duplicated: duplicated.length
      });

      if (colorChanged.length > 0) {
        console.warn(`[HistoryDiff] ⚠️ Cores mudaram:`, colorChanged);
      }

      if (reordered.length > 0) {
        console.warn(`[HistoryDiff] ⚠️ Ordem invertida:`, reordered);
      }

      if (duplicated.length > 0) {
        console.error(`[HistoryDiff] 🔴 Duplicatas detectadas:`, duplicated);
      }
    } else {
      console.log(`[HistoryDiff] Sem mudanças (hash igual)`);
    }

    return diff;
  }

  /**
   * Compara apenas últimos N rounds (tail-based comparison)
   * Útil para detectar mudança incremental
   */
  function diffHistoryTail(prevHistory, nextHistory, tailSize = 10) {
    if (!Array.isArray(prevHistory)) prevHistory = [];
    if (!Array.isArray(nextHistory)) nextHistory = [];

    const prevTail = prevHistory.slice(-tailSize);
    const nextTail = nextHistory.slice(-tailSize);

    const tailDiff = diffHistory(prevTail, nextTail);
    tailDiff.tailSize = tailSize;

    return tailDiff;
  }

  /**
   * Detecta se há mudanças sem computar diff completo (rápido)
   */
  function hasChanges(prevHistory, nextHistory) {
    if (!Array.isArray(prevHistory)) prevHistory = [];
    if (!Array.isArray(nextHistory)) nextHistory = [];

    if (prevHistory.length !== nextHistory.length) {
      return true;
    }

    // Comparar hashes
    const prevHash = hashHistory(prevHistory);
    const nextHash = hashHistory(nextHistory);
    return prevHash !== nextHash;
  }

  /**
   * Merge diff com histórico anterior (para estado consolidado)
   */
  function mergeWithPrevious(prevDiff, nextDiff) {
    return {
      // Cumulativo
      totalAdded: (prevDiff?.added?.length || 0) + (nextDiff?.added?.length || 0),
      totalRemoved: (prevDiff?.removed?.length || 0) + (nextDiff?.removed?.length || 0),
      totalUpdated: (prevDiff?.updated?.length || 0) + (nextDiff?.updated?.length || 0),
      totalReordered: (prevDiff?.reordered?.length || 0) + (nextDiff?.reordered?.length || 0),

      // Últimas mudanças
      lastAdded: nextDiff?.added || [],
      lastRemoved: nextDiff?.removed || [],
      lastUpdated: nextDiff?.updated || [],
      lastReordered: nextDiff?.reordered || [],

      // Counts
      countBefore: prevDiff?.countBefore,
      countAfter: nextDiff?.countAfter,

      // Hashes
      prevHash: prevDiff?.prevHash,
      nextHash: nextDiff?.nextHash,

      timestamp: Date.now()
    };
  }

  return {
    diffHistory,
    diffHistoryTail,
    hasChanges,
    mergeWithPrevious,
    hashRound,
    hashHistory
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = HistoryDiff;
}
