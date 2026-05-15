/**
 * HistoryStore — Armazenamento de histórico real como fonte de verdade
 *
 * Responsabilidades:
 * 1. Manter realHistory com contrato de dados claro
 * 2. Deduplicar por roundId, signature, timestamp+result
 * 3. Ordenar por timestamp confirmado
 * 4. Implementar política de merge (fonte melhor sobrescreve inferior)
 * 5. Expor métodos para query, export, reset
 */

const HistoryStore = (() => {
  // Contrato de dados — IMUTÁVEL
  const ROUND_SCHEMA = {
    roundId: null,        // string | null — identificador único
    index: null,          // number — posição no histórico completo
    result: null,         // 'player' | 'banker' | 'tie'
    color: null,          // 'blue' | 'red' | 'green' (normalizado)
    playerScore: null,    // number | null
    bankerScore: null,    // number | null
    timestamp: null,      // number — timestamp da rodada
    source: null,         // 'websocket' | 'dom' | 'visual' | 'storage'
    confidence: null,     // number 0-1
    signature: null,      // string — hash determinístico
    raw: null             // object — payload original preservado
  };

  // Ordem de confiança das fontes
  const SOURCE_CONFIDENCE = {
    websocket: 1.0,
    dom: 0.9,
    visual: 0.7,
    storage: 0.6
  };

  let realHistory = [];
  let roundIndex = new Map();       // Map<signature, roundObject>
  let roundIdIndex = new Map();     // Map<roundId, roundObject>
  let divergenceLog = [];           // Log de conflitos

  /**
   * Gera signature canônica para um round.
   * Contrato compartilhado entre collector.js, content.js e history-store.js
   * para evitar duplicatas entre paths diferentes (snapshot bulk vs wire vs sync).
   *
   * Aceita aliases: vencedor|result|cor, gameId|roundId
   * Capitaliza o resultado: 'banker' → 'Banker', 'PLAYER' → 'Player'.
   * Quando há id, retorna 'gid:<id>:<Result>'.
   * Fallback determinístico (sem id): 'auto:<Result>:<ps>:<bs>:<occurrence>'.
   */
  function generateSignature(round) {
    if (!round || typeof round !== 'object') return null;

    const id = round.gameId || round.roundId || null;
    const rawResult = round.vencedor || round.result || round.cor || '';
    const resultCap = String(rawResult).charAt(0).toUpperCase() + String(rawResult).slice(1).toLowerCase();
    if (!resultCap) return null;

    if (id) return `gid:${id}:${resultCap}`;

    const ps = Number.isFinite(Number(round.playerScore)) ? Number(round.playerScore) : '?';
    const bs = Number.isFinite(Number(round.bankerScore)) ? Number(round.bankerScore) : '?';
    const occ = Number.isFinite(Number(round.occurrence)) ? Number(round.occurrence) : 0;
    return `auto:${resultCap}:${ps}:${bs}:${occ}`;
  }

  /**
   * Valida se um round cumpre o contrato
   */
  function validateRound(round) {
    if (!round || typeof round !== 'object') return false;
    if (!round.result || !round.color) return false;
    if (!round.timestamp || typeof round.timestamp !== 'number') return false;
    if (!round.source || !round.signature) return false;
    return true;
  }

  /**
   * Calcula score de confiança: source * confidence
   */
  function getConfidenceScore(round) {
    const sourceScore = SOURCE_CONFIDENCE[round.source] || 0.5;
    return sourceScore * (round.confidence || 0.8);
  }

  /**
   * Política de merge: fonte melhor sobrescreve inferior
   */
  function shouldMergeOrReplace(existing, incoming) {
    const existingScore = getConfidenceScore(existing);
    const incomingScore = getConfidenceScore(incoming);

    if (incomingScore > existingScore) {
      return 'replace'; // Nova fonte é melhor
    } else if (incomingScore === existingScore && incoming.timestamp > existing.timestamp) {
      return 'replace'; // Mesma fonte, mas mais recente
    } else if (incomingScore < existingScore) {
      return 'keep'; // Fonte existente é melhor
    } else {
      return 'keep'; // Conflito — não sobrescreve
    }
  }

  /**
   * Adiciona round individual com validação de duplicata
   */
  function addRound(round) {
    if (!validateRound(round)) {
      console.warn('[HistoryStore] Round inválido, rejeitado:', round);
      return { added: false, reason: 'invalid_schema' };
    }

    const sig = round.signature;
    const rId = round.roundId;

    // Verificar se já existe por signature
    if (roundIndex.has(sig)) {
      const existing = roundIndex.get(sig);
      const action = shouldMergeOrReplace(existing, round);

      if (action === 'replace') {
        // Sobrescrever entrada existente
        const idx = realHistory.findIndex(r => r.signature === sig);
        if (idx >= 0) {
          realHistory[idx] = { ...ROUND_SCHEMA, ...round };
          roundIndex.set(sig, realHistory[idx]);
          if (rId) roundIdIndex.set(rId, realHistory[idx]);

          console.log(`[HistoryStore] Round atualizado (${existing.source} → ${round.source}):`, {
            roundId: rId,
            signature: sig
          });
          return { added: false, reason: 'updated', index: idx };
        }
      } else {
        // Manter existente, registrar divergência
        divergenceLog.push({
          type: 'duplicate_ignored',
          signature: sig,
          existing: { source: existing.source, confidence: existing.confidence },
          incoming: { source: round.source, confidence: round.confidence },
          timestamp: Date.now()
        });

        console.log(`[HistoryStore] Duplicata ignorada (${round.source} inferior):`, {
          signature: sig,
          kept: existing.source,
          discarded: round.source
        });
        return { added: false, reason: 'duplicate_ignored' };
      }
    }

    // Verificar se já existe por roundId
    if (rId && roundIdIndex.has(rId)) {
      const existing = roundIdIndex.get(rId);
      if (existing.signature !== sig) {
        divergenceLog.push({
          type: 'roundid_conflict',
          roundId: rId,
          existingSignature: existing.signature,
          incomingSignature: sig,
          existing: existing.source,
          incoming: round.source,
          at: Date.now(),
          timestamp: Date.now()
        });

        const SOURCE_PRIORITY = { websocket: 4, dom: 3, visual: 2, storage: 1 };
        const existingP = SOURCE_PRIORITY[existing.source] || 0;
        const incomingP = SOURCE_PRIORITY[round.source] || 0;

        if (incomingP > existingP) {
          // Fonte nova é melhor — atualizar sem duplicar
          const idx = realHistory.findIndex(r => r.roundId === rId);
          if (idx >= 0) {
            realHistory[idx] = { ...existing, source: round.source, confidence: round.confidence, updatedAt: Date.now() };
            roundIdIndex.set(rId, realHistory[idx]);
            roundIndex.delete(existing.signature);
            roundIndex.set(realHistory[idx].signature, realHistory[idx]);
          }
          console.log(`[HistoryStore] MERGE roundId=${rId} | ${existing.source} → ${round.source}`);
        } else {
          console.log(`[HistoryStore] KEPT roundId=${rId} | mantendo ${existing.source} sobre ${round.source}`);
        }

        return { added: false, reason: 'roundid_conflict', merged: incomingP > existingP };
      }
    }

    // Anti-duplicate: round novo com gid:<id>:Result pode ser o mesmo round
    // que veio antes via snapshot bulk (sem roundId, sig 'auto:Banker:6:9:0').
    // Procura órfão com mesmo result+playerScore+bankerScore sem roundId, e mergeia.
    if (rId && sig && sig.indexOf('gid:') === 0) {
      const ps = Number(round.playerScore);
      const bs = Number(round.bankerScore);
      const result = round.result;
      if (Number.isFinite(ps) && Number.isFinite(bs) && result) {
        const orfaoIdx = realHistory.findIndex(r =>
          !r.roundId &&
          r.result === result &&
          Number(r.playerScore) === ps &&
          Number(r.bankerScore) === bs &&
          r.signature && r.signature.indexOf('auto:') === 0
        );
        if (orfaoIdx >= 0) {
          const orfao = realHistory[orfaoIdx];
          roundIndex.delete(orfao.signature);
          realHistory[orfaoIdx] = { ...ROUND_SCHEMA, ...orfao, ...round, index: orfaoIdx };
          roundIndex.set(sig, realHistory[orfaoIdx]);
          roundIdIndex.set(rId, realHistory[orfaoIdx]);
          console.log(`[HistoryStore] 🔗 MERGE orphan-auto → gid (idx=${orfaoIdx}, ${orfao.signature} → ${sig})`);
          return { added: false, reason: 'merged_with_orphan', index: orfaoIdx };
        }
      }
    }

    // Novo round — adicionar ao final
    const newRound = { ...ROUND_SCHEMA, ...round, index: realHistory.length };
    realHistory.push(newRound);
    roundIndex.set(sig, newRound);
    if (rId) roundIdIndex.set(rId, newRound);

    console.log(`[HistoryStore] Round adicionado:`, {
      index: newRound.index,
      result: newRound.result,
      source: newRound.source,
      signature: sig
    });

    return { added: true, index: newRound.index };
  }

  /**
   * Adiciona múltiplos rounds (batch)
   */
  function addMany(rounds) {
    if (!Array.isArray(rounds)) {
      console.warn('[HistoryStore] addMany recebeu não-array:', typeof rounds);
      return { added: 0, updated: 0, duplicates: 0 };
    }

    let stats = { added: 0, updated: 0, duplicates: 0 };

    for (const round of rounds) {
      const result = addRound(round);
      if (result.added) {
        stats.added++;
      } else if (result.reason === 'updated') {
        stats.updated++;
      } else if (result.reason === 'duplicate_ignored') {
        stats.duplicates++;
      }
    }

    console.log(`[HistoryStore] Batch processado:`, stats);
    return stats;
  }

  /**
   * Replace snapshot — substitui histórico inteiro com nova fonte
   * Política: não apagar dados existentes se snapshot é parcial
   */
  function replaceSnapshot(rounds, source) {
    if (!Array.isArray(rounds) || rounds.length === 0) {
      console.warn('[HistoryStore] replaceSnapshot chamado com array vazio');
      return { kept: realHistory.length, replaced: 0 };
    }

    console.log(`[HistoryStore] replaceSnapshot iniciado de ${source}:`, {
      snapshotCount: rounds.length,
      existingCount: realHistory.length
    });

    // Se snapshot é menor que histórico existente — não descartar
    if (rounds.length < realHistory.length) {
      console.log(`[HistoryStore] ⚠️ Snapshot parcial (${rounds.length} < ${realHistory.length}) — mergeando`);
      return addMany(rounds);
    }

    // Snapshot completo ou maior — pode sobrescrever
    const oldCount = realHistory.length;
    realHistory = [];
    roundIndex.clear();
    roundIdIndex.clear();

    const stats = addMany(rounds);

    console.log(`[HistoryStore] Snapshot aplicado:`, {
      before: oldCount,
      after: realHistory.length,
      added: stats.added
    });

    return { kept: 0, replaced: oldCount, new: realHistory.length };
  }

  /**
   * Deduplica por signature + roundId + (timestamp+result+score)
   */
  function dedupe() {
    const before = realHistory.length;

    // Remover por signature (já mantido pelo index)
    // Remover por roundId duplicado
    const seenRoundIds = new Set();
    const deduped = [];

    for (const round of realHistory) {
      if (round.roundId) {
        if (seenRoundIds.has(round.roundId)) {
          divergenceLog.push({
            type: 'roundid_dedupe',
            roundId: round.roundId,
            signature: round.signature,
            timestamp: Date.now()
          });
          continue; // Pular duplicata
        }
        seenRoundIds.add(round.roundId);
      }
      deduped.push(round);
    }

    realHistory = deduped;

    // Reconstruir índices
    roundIndex.clear();
    roundIdIndex.clear();
    for (const round of realHistory) {
      roundIndex.set(round.signature, round);
      if (round.roundId) roundIdIndex.set(round.roundId, round);
    }

    const after = realHistory.length;
    console.log(`[HistoryStore] Dedupe concluído:`, {
      before,
      after,
      removed: before - after
    });

    return { before, after, removed: before - after };
  }

  /**
   * Ordena por timestamp (confirmado)
   */
  function order() {
    const before = realHistory.slice();
    realHistory.sort((a, b) => a.timestamp - b.timestamp);

    // Atualizar índices
    for (let i = 0; i < realHistory.length; i++) {
      realHistory[i].index = i;
    }

    // Detectar inversão
    let inverted = false;
    for (let i = 1; i < before.length; i++) {
      if (before[i - 1].timestamp > before[i].timestamp) {
        inverted = true;
        break;
      }
    }

    if (inverted) {
      console.log(`[HistoryStore] ⚠️ Histórico foi reordenado por timestamp`);
    }

    return { inverted, count: realHistory.length };
  }

  /**
   * Retorna histórico real completo
   */
  function getRealHistory() {
    return realHistory.slice(); // cópia
  }

  /**
   * Retorna janela de 156 slots (TOTAL_SLOTS fixo do grid)
   * Implementa a lógica exata: windowHistory = realHistory.slice(-TOTAL_SLOTS)
   * Retorna apenas os rounds; o renderer aplica o offset para calcular slots vazios
   */
  function getWindowHistory() {
    const TOTAL_SLOTS = 156;
    const window = realHistory.slice(-TOTAL_SLOTS);
    console.log(`[HistoryStore] getWindowHistory: ${realHistory.length} total → ${window.length} na janela (${TOTAL_SLOTS - window.length} slots vazios)`);
    return window;
  }

  /**
   * Retorna últimos N rounds
   */
  function getLastRounds(n) {
    if (n <= 0) return [];
    return realHistory.slice(-Math.min(n, realHistory.length));
  }

  /**
   * Busca por signature
   */
  function getBySignature(sig) {
    return roundIndex.get(sig) || null;
  }

  /**
   * Busca por roundId
   */
  function getByRoundId(rId) {
    return roundIdIndex.get(rId) || null;
  }

  /**
   * Retorna count
   */
  function getCount() {
    return realHistory.length;
  }

  /**
   * Reseta histórico completo
   */
  function reset() {
    const count = realHistory.length;
    realHistory = [];
    roundIndex.clear();
    roundIdIndex.clear();
    divergenceLog = [];

    console.log(`[HistoryStore] ✓ Histórico resetado (apagadas ${count} rodadas)`);
    return { resetCount: count };
  }

  /**
   * Exporta histórico como JSON
   */
  function exportJSON() {
    return {
      version: '2.3.1',
      exported: new Date().toISOString(),
      count: realHistory.length,
      history: realHistory.map(r => ({ ...r, raw: undefined })), // Sem raw para economizar espaço
      divergenceLog: divergenceLog.slice(-20) // Últimas 20 divergências
    };
  }

  /**
   * Retorna diagnostics
   */
  function getDiagnostics() {
    return {
      count: realHistory.length,
      indexSizeSignature: roundIndex.size,
      indexSizeRoundId: roundIdIndex.size,
      divergences: divergenceLog.length,
      lastDivergence: divergenceLog[divergenceLog.length - 1] || null,
      sourceDistribution: {
        websocket: realHistory.filter(r => r.source === 'websocket').length,
        dom: realHistory.filter(r => r.source === 'dom').length,
        visual: realHistory.filter(r => r.source === 'visual').length,
        storage: realHistory.filter(r => r.source === 'storage').length
      }
    };
  }

  /**
   * Função canônica de geração de signature.
   * Single source of truth — chamada por collector.js e content.js
   * pra garantir que o mesmo round real sempre gere a MESMA signature,
   * evitando duplicação no addRound.
   */
  function generateSignature(round) {
    if (!round) return null;
    const id = round.gameId || round.roundId || null;
    const rawResult = round.vencedor || round.result || round.cor || '';
    const resultStr = String(rawResult).trim();
    if (!resultStr) return null;
    const resultCap = resultStr.charAt(0).toUpperCase() + resultStr.slice(1).toLowerCase();

    if (id) return `gid:${id}:${resultCap}`;

    const ps = Number.isFinite(Number(round.playerScore)) ? Number(round.playerScore) : '?';
    const bs = Number.isFinite(Number(round.bankerScore)) ? Number(round.bankerScore) : '?';
    const occ = Number.isFinite(Number(round.occurrence)) ? Number(round.occurrence) : 0;
    return `auto:${resultCap}:${ps}:${bs}:${occ}`;
  }

  return {
    addRound,
    addMany,
    replaceSnapshot,
    dedupe,
    order,
    getRealHistory,
    getWindowHistory,
    getLastRounds,
    getBySignature,
    getByRoundId,
    getCount,
    reset,
    export: exportJSON,   // alias spec-compliant
    exportJSON,           // mantém compatibilidade com chamadores existentes
    getDiagnostics,
    generateSignature,    // canônica — usada por collector + content.js
    ROUND_SCHEMA,
    SOURCE_CONFIDENCE
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = HistoryStore;
}
