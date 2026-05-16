/**
 * BetBoom Idempotency Layer v1.0
 * ==============================
 * Garante: uma rodada = uma sugestão ativa + uma tentativa de clique
 * Previne execução duplicada e race conditions.
 *
 * Responsabilidades:
 * - Rastrear rodada atual
 * - Bloquear sugestão duplicada na mesma rodada
 * - Bloquear clique duplicado na mesma rodada
 * - Limpar estado quando rodada muda
 * - Logging detalhado de tentativas de duplicação
 */

const IdempotencyLayer = (() => {
  const PREFIX = '[IdempotencyLayer]';

  let currentRoundId = null;
  let suggestionRecord = null;
  let clickRecord = null;
  let clickAttempts = 0;

  /**
   * Registrar ou validar sugestão para rodada
   * @returns { ok: boolean, motivo?: string, isNew: boolean }
   */
  function registerSuggestion(roundId, padraoNome, confianca, alvo) {
    // Se rodada mudou, limpar estado anterior
    if (roundId !== currentRoundId) {
      if (currentRoundId) {
        console.log(`${PREFIX} 🔄 Rodada mudou: ${currentRoundId} → ${roundId}. Limpando estado.`);
      }
      currentRoundId = roundId;
      suggestionRecord = null;
      clickRecord = null;
      clickAttempts = 0;
    }

    // Se já existe sugestão nesta rodada
    if (suggestionRecord) {
      console.warn(`${PREFIX} ❌ Sugestão duplicada bloqueada para rodada ${roundId}`);
      console.warn(`   Sugestão anterior: ${suggestionRecord.padraoNome} (${suggestionRecord.confianca}%)`);
      console.warn(`   Tentativa: ${padraoNome} (${confianca}%)`);
      return {
        ok: false,
        motivo: 'sugestao-duplicada',
        isNew: false,
        sugestaoAnterior: suggestionRecord
      };
    }

    // Registrar nova sugestão
    suggestionRecord = {
      roundId,
      padraoNome,
      confianca,
      alvo,
      timestamp: Date.now(),
      traceId: `sugg-${roundId}-${Math.random().toString(16).slice(2, 8)}`
    };

    console.log(`${PREFIX} ✅ Sugestão registrada para rodada ${roundId}: ${padraoNome} → ${alvo} (${confianca}%)`);
    return {
      ok: true,
      motivo: null,
      isNew: true,
      sugestaoRegistrada: suggestionRecord
    };
  }

  /**
   * Registrar ou validar clique para rodada
   * @returns { ok: boolean, motivo?: string, tentativa: number }
   */
  function registerClick(roundId, alvo, stake) {
    // Validação de rodada
    if (roundId !== currentRoundId) {
      console.warn(`${PREFIX} ❌ Clique em rodada dessintonizada: atual=${currentRoundId}, tentativa=${roundId}`);
      return {
        ok: false,
        motivo: 'rodada-dessintonizada',
        tentativa: 0
      };
    }

    // Validação de sugestão (clique sem sugestão?)
    if (!suggestionRecord) {
      console.warn(`${PREFIX} ❌ Clique sem sugestão prévia para rodada ${roundId}`);
      return {
        ok: false,
        motivo: 'clique-sem-sugestao',
        tentativa: 0
      };
    }

    // Se já existe clique nesta rodada
    clickAttempts++;
    if (clickRecord) {
      console.warn(`${PREFIX} ❌ Clique duplicado bloqueado para rodada ${roundId} (tentativa ${clickAttempts})`);
      console.warn(`   Clique anterior: ${clickRecord.alvo} R$${clickRecord.stake} às ${new Date(clickRecord.timestamp).toLocaleTimeString()}`);
      return {
        ok: false,
        motivo: 'clique-duplicado',
        tentativa: clickAttempts,
        clickAnterior: clickRecord
      };
    }

    // Validação de alvo (deve bater com sugestão)
    if (alvo !== suggestionRecord.alvo) {
      console.error(`${PREFIX} ❌ DIVERGÊNCIA CRÍTICA: Sugestão=${suggestionRecord.alvo}, Clique=${alvo}`);
      return {
        ok: false,
        motivo: 'alvo-divergente',
        tentativa: clickAttempts,
        esperado: suggestionRecord.alvo
      };
    }

    // Registrar clique
    clickRecord = {
      roundId,
      alvo,
      stake,
      timestamp: Date.now(),
      tentativa: clickAttempts,
      traceId: `click-${roundId}-${Math.random().toString(16).slice(2, 8)}`
    };

    console.log(`${PREFIX} ✅ Clique registrado para rodada ${roundId}: ${alvo} R$${stake} (tentativa ${clickAttempts})`);
    return {
      ok: true,
      motivo: null,
      tentativa: clickAttempts,
      clickRegistrado: clickRecord
    };
  }

  /**
   * Obter estado atual
   */
  function getState() {
    return {
      currentRoundId,
      hasSuggestion: !!suggestionRecord,
      hasClick: !!clickRecord,
      clickAttempts,
      suggestionRecord,
      clickRecord
    };
  }

  /**
   * Testar idempotência (debug)
   */
  function testIdempotency() {
    console.group(`${PREFIX} 🧪 Teste de Idempotência`);

    // Teste 1: Sugestão duplicada
    const round1 = '12345';
    const r1 = registerSuggestion(round1, 'PlayerStreak', 75, 'player');
    console.log('✅ Primeira sugestão:', r1.ok ? 'OK' : 'FALHOU');

    const r2 = registerSuggestion(round1, 'TieProtection', 40, 'tie');
    console.log('✅ Sugestão duplicada bloqueada:', !r2.ok ? 'OK' : 'FALHOU');

    // Teste 2: Clique duplicado
    const r3 = registerClick(round1, 'player', 50);
    console.log('✅ Primeiro clique:', r3.ok ? 'OK' : 'FALHOU');

    const r4 = registerClick(round1, 'player', 50);
    console.log('✅ Clique duplicado bloqueado:', !r4.ok ? 'OK' : 'FALHOU');

    // Teste 3: Nova rodada limpa estado
    const round2 = '12346';
    const r5 = registerSuggestion(round2, 'NewPattern', 60, 'banker');
    console.log('✅ Nova rodada permite nova sugestão:', r5.ok ? 'OK' : 'FALHOU');

    console.groupEnd();
  }

  // Public API
  return {
    registerSuggestion,
    registerClick,
    getState,
    testIdempotency
  };
})();

if (typeof window !== 'undefined') {
  window.IdempotencyLayer = IdempotencyLayer;
  console.log('[IdempotencyLayer] ✅ Módulo carregado');
}
