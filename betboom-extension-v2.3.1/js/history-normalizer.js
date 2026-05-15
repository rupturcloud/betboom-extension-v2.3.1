/**
 * HistoryNormalizer — Normalização de dados crus para contrato
 *
 * Responsabilidades:
 * 1. Mapear vencedor (player, banker, tie) de qualquer formato
 * 2. Mapear cor (azul, vermelho, empate) para cores normalizadas
 * 3. Gerar signature determinística
 * 4. Construir objeto round com contrato
 * 5. Preservar raw payload
 */

const HistoryNormalizer = (() => {
  /**
   * Mapeia vencedor para resultado normalizado
   * Aceita: 'player', 'Player', 'P', 'PLAYER', 'você', 'Player Hand'
   *         'banker', 'Banker', 'B', 'BANKER', 'casa', 'Banker Hand'
   *         'tie', 'Tie', 'T', 'TIE', 'empate', 'Draw'
   */
  function mapResult(vencedor) {
    if (!vencedor) return null;

    const v = String(vencedor).trim().toLowerCase();

    // Player
    if (v === 'player' || v === 'p' || v === 'você' || v.includes('player')) {
      return 'player';
    }

    // Banker
    if (v === 'banker' || v === 'b' || v === 'casa' || v.includes('banker')) {
      return 'banker';
    }

    // Tie
    if (v === 'tie' || v === 't' || v === 'empate' || v.includes('tie') || v.includes('draw')) {
      return 'tie';
    }

    console.warn(`[HistoryNormalizer] Vencedor desconhecido:`, vencedor);
    return null;
  }

  /**
   * Mapeia cor para cor normalizada
   * Aceita: 'azul', 'blue', 'black', 'preto' → 'blue'
   *         'vermelho', 'red' → 'red'
   *         'empate', 'tie', 'white', 'green' → 'green'
   */
  function mapColor(cor) {
    if (!cor) return null;

    const c = String(cor).trim().toLowerCase();

    // Blue (Player)
    if (c.includes('azul') || c.includes('blue') || c.includes('black') || c.includes('preto') || c === 'p') {
      return 'blue';
    }

    // Red (Banker)
    if (c.includes('verm') || c.includes('red') || c === 'b') {
      return 'red';
    }

    // Green (Tie)
    if (c.includes('empate') || c.includes('tie') || c.includes('white') || c.includes('green') || c === 't') {
      return 'green';
    }

    console.warn(`[HistoryNormalizer] Cor desconhecida:`, cor);
    return null;
  }

  /**
   * Mapeia resultado para cor (fallback se cor não estiver presente)
   */
  function resultToColor(result) {
    switch (result) {
      case 'player':
        return 'blue';
      case 'banker':
        return 'red';
      case 'tie':
        return 'green';
      default:
        return null;
    }
  }

  /**
   * Gera signature determinística
   * Prioridade: roundId > (timestamp + result + playerScore + bankerScore)
   */
  function generateSignature(round) {
    // Se tem roundId, usar como base
    if (round.roundId) {
      return `round:${round.roundId}`;
    }

    // Fallback: timestamp + result + scores
    const timestamp = round.timestamp || 0;
    const result = round.result || 'unknown';
    const pScore = round.playerScore || 0;
    const bScore = round.bankerScore || 0;

    const sig = `${timestamp}:${result}:${pScore}:${bScore}`;
    return `auto:${sig}`;
  }

  /**
   * Normaliza um round individual
   * Input: raw object de qualquer fonte
   * Output: round com contrato HistoryStore.ROUND_SCHEMA
   */
  function normalizeRound(raw, source) {
    if (!raw || typeof raw !== 'object') {
      console.warn(`[HistoryNormalizer] Raw inválido para normalizar:`, raw);
      return null;
    }

    // Extrair campos com fallbacks
    const roundId = raw.roundId || raw.rodada || raw.id || null;
    let result = mapResult(raw.result || raw.vencedor || raw.winner || null);
    let color = mapColor(raw.color || raw.cor || null);

    // Se não tem cor, derivar de resultado
    if (!color && result) {
      color = resultToColor(result);
    }

    // Se não tem resultado, derivar de cor
    if (!result && color) {
      switch (color) {
        case 'blue':
          result = 'player';
          break;
        case 'red':
          result = 'banker';
          break;
        case 'green':
          result = 'tie';
          break;
      }
    }

    // Validação mínima
    if (!result || !color) {
      console.warn(`[HistoryNormalizer] Não conseguiu mapear result/color:`, {
        rawResult: raw.result,
        rawColor: raw.color,
        mapped: { result, color }
      });
      return null;
    }

    // Extrair scores
    const playerScore = raw.playerScore || raw.player_score || raw.playerPoints || null;
    const bankerScore = raw.bankerScore || raw.banker_score || raw.bankerPoints || null;

    // Timestamp
    const timestamp = raw.timestamp || raw.createdAt || raw.occurredAt || Date.now();

    // Signature
    const signature = generateSignature({
      roundId,
      timestamp,
      result,
      playerScore,
      bankerScore
    });

    // Confidence — usa calculateConfidence se não veio explícito no raw
    const rawConfidence = raw.confidence != null ? Number(raw.confidence) : null;
    const confidence = rawConfidence != null
      ? rawConfidence
      : calculateConfidence({ roundId, timestamp, result, playerScore, bankerScore }, source);

    // Construir round normalizado
    const normalized = {
      roundId,
      index: null,
      result,
      color,
      playerScore: playerScore ? Number(playerScore) : null,
      bankerScore: bankerScore ? Number(bankerScore) : null,
      timestamp: Number(timestamp),
      source,
      confidence: Number(confidence),
      signature,
      raw // Preservar original
    };

    console.log(`[HistoryNormalizer] Round normalizado:`, {
      roundId,
      result,
      color,
      source,
      signature
    });

    return normalized;
  }

  /**
   * Normaliza múltiplos rounds (batch)
   */
  function normalizeHistory(rawList, source) {
    if (!Array.isArray(rawList)) {
      console.warn(`[HistoryNormalizer] normalizeHistory recebeu não-array:`, typeof rawList);
      return [];
    }

    const normalized = [];
    let skipped = 0;

    for (const raw of rawList) {
      const norm = normalizeRound(raw, source);
      if (norm) {
        normalized.push(norm);
      } else {
        skipped++;
      }
    }

    console.log(`[HistoryNormalizer] Batch normalizado:`, {
      source,
      total: rawList.length,
      normalized: normalized.length,
      skipped
    });

    return normalized;
  }

  /**
   * Detecta tipo de payload (snapshot, novo resultado, etc)
   */
  function detectPayloadType(payload) {
    if (Array.isArray(payload)) {
      return 'snapshot';
    }

    if (payload && typeof payload === 'object') {
      // Se tem array dentro, é snapshot parcial
      if (payload.history && Array.isArray(payload.history)) {
        return 'partial_snapshot';
      }

      // Se tem campo de resultado, é novo resultado
      if (payload.result || payload.vencedor) {
        return 'new_result';
      }

      // Se tem confirmação, é confirmação
      if (payload.confirmed || payload.confirmed_at) {
        return 'confirmation';
      }
    }

    return 'unknown';
  }

  /**
   * Calcula confidence do round com base na fonte e nos dados disponíveis
   * Fonte pesa 60%, completude dos dados pesa 40%
   */
  function calculateConfidence(round, source) {
    const SOURCE_BASE = {
      websocket: 1.0,
      dom: 0.9,
      visual: 0.7,
      storage: 0.6
    };

    const src = source || round.source || 'visual';
    const sourceScore = SOURCE_BASE[src] || 0.5;

    // Completude: cada campo presente adiciona peso
    let completude = 0;
    let campos = 0;
    const checks = [
      [round.roundId, 0.25],
      [round.playerScore != null, 0.20],
      [round.bankerScore != null, 0.20],
      [round.timestamp && round.timestamp > 0, 0.20],
      [round.result, 0.15]
    ];
    for (const [present, weight] of checks) {
      campos += weight;
      if (present) completude += weight;
    }

    const completudeScore = campos > 0 ? completude / campos : 0;
    const confidence = (sourceScore * 0.6) + (completudeScore * 0.4);

    console.log(`[HistoryNormalizer] calculateConfidence: source=${src} (${sourceScore}) completude=${completudeScore.toFixed(2)} → ${confidence.toFixed(3)}`);

    return Math.min(1.0, Math.max(0.0, confidence));
  }

  /**
   * Valida se normalized round pode ser armazenado
   */
  function validateNormalized(normalized) {
    if (!normalized) return false;
    if (!normalized.result || !normalized.color) return false;
    if (!normalized.timestamp || !normalized.signature) return false;
    if (!normalized.source) return false;
    return true;
  }

  return {
    mapResult,
    mapColor,
    resultToColor,
    generateSignature,
    calculateConfidence,
    normalizeRound,
    normalizeHistory,
    detectPayloadType,
    validateNormalized
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = HistoryNormalizer;
}
