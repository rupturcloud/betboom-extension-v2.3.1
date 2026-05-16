/**
 * BetBoom Evidence Engine v1.0
 * =============================
 * Registra evidência JSON estruturada para auditoria e replay.
 * Cada ação (detecção, clique, confirmação) gera um evento estruturado.
 *
 * Responsabilidades:
 * - Capturar estado ANTES de cada ação (DOM snapshot)
 * - Registrar confirmação do usuário
 * - Capturar estado DEPOIS de cada ação
 * - Gerar traceId único para rastreabilidade
 * - Persistir em localStorage (últimas 100 evidências)
 * - Fornecer API para Query de evidências por roundId
 */

const EvidenceEngine = (() => {
  const PREFIX = '[EvidenceEngine]';
  const STORAGE_KEY = 'bb_evidence_log';
  const MAX_EVIDENCES = 100;

  let currentRoundId = null;
  let evidenceCache = [];

  /**
   * Gera ID único para rastreamento
   */
  function generateTraceId() {
    return `trace-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  }

  /**
   * Captura snapshot do DOM para auditoria
   */
  function captureBeforeState() {
    try {
      return {
        timestamp: Date.now(),
        chipElements: document.querySelectorAll('[data-automation-id^="chip-"], [data-betia-id^="chip-"]').length,
        playerButtonFound: !!document.querySelector('[data-betia-id="bet-player"], [data-automation-id="betting-grid-item-player"]'),
        bankerButtonFound: !!document.querySelector('[data-betia-id="bet-banker"], [data-automation-id="betting-grid-item-banker"]'),
        tieButtonFound: !!document.querySelector('[data-betia-id="bet-tie"], [data-automation-id="betting-grid-item-tie"]'),
        timerVisible: !!document.querySelector('[class*="timer" i], [class*="countdown" i]'),
        confirmButtonVisible: !!document.querySelector('[data-betia-id="bet-confirm"], [data-automation-id="bet-button-confirm"]')
      };
    } catch (_) {
      return { error: 'snapshot-failed', timestamp: Date.now() };
    }
  }

  /**
   * Captura snapshot DEPOIS de ação
   */
  function captureAfterState() {
    try {
      // Verificar mudança visual (algum botão foi clicado? highlight visual?)
      return {
        timestamp: Date.now(),
        chipElements: document.querySelectorAll('[data-automation-id^="chip-"], [data-betia-id^="chip-"]').length,
        playerButtonActive: document.querySelector('[data-betia-id="bet-player"][class*="active"], [data-automation-id="betting-grid-item-player"][class*="active"]') !== null,
        bankerButtonActive: document.querySelector('[data-betia-id="bet-banker"][class*="active"], [data-automation-id="betting-grid-item-banker"][class*="active"]') !== null,
        tieButtonActive: document.querySelector('[data-betia-id="bet-tie"][class*="active"], [data-automation-id="betting-grid-item-tie"][class*="active"]') !== null
      };
    } catch (_) {
      return { error: 'snapshot-failed', timestamp: Date.now() };
    }
  }

  /**
   * Registra um evento de evidência
   */
  function recordEvidence(eventType, data) {
    const traceId = generateTraceId();
    const timestamp = new Date().toISOString();

    const evidence = {
      traceId,
      timestamp,
      roundId: currentRoundId,
      eventType, // 'chip_detected', 'target_detected', 'click_executed', 'confirmation_received', etc.
      data,
      beforeState: eventType.includes('before') ? undefined : (eventType.includes('after') ? undefined : captureBeforeState())
    };

    evidenceCache.push(evidence);
    persistToStorage();

    console.log(`${PREFIX} 📝 Evento registrado: ${eventType}`, {
      traceId,
      roundId: currentRoundId,
      timestamp
    });

    return traceId;
  }

  /**
   * Persistir evidências em localStorage
   */
  function persistToStorage() {
    try {
      const toSave = evidenceCache.slice(-MAX_EVIDENCES);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch (e) {
      console.warn(`${PREFIX} ⚠️ Falha ao persistir evidência:`, e.message);
    }
  }

  /**
   * Carregar evidências do localStorage na inicialização
   */
  function loadFromStorage() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        evidenceCache = JSON.parse(saved);
        console.log(`${PREFIX} ✅ Carregadas ${evidenceCache.length} evidências do storage`);
      }
    } catch (e) {
      console.warn(`${PREFIX} ⚠️ Falha ao carregar evidências:`, e.message);
      evidenceCache = [];
    }
  }

  /**
   * Notificar sobre nova rodada
   */
  function onNovaRodada(roundId) {
    if (roundId !== currentRoundId) {
      currentRoundId = roundId;
      recordEvidence('rodada_iniciada', { roundId });
      console.log(`${PREFIX} 🔄 Rodada ${roundId} iniciada`);
    }
  }

  /**
   * API Pública
   */
  return {
    /**
     * Registrar detecção de ficha
     */
    recordChipDetected(valor, seletor) {
      return recordEvidence('chip_detected', {
        valor,
        seletor,
        afterState: captureAfterState()
      });
    },

    /**
     * Registrar detecção de alvo (Player/Banker/Tie)
     */
    recordTargetDetected(alvo, seletor, confirmadoVisualmente) {
      return recordEvidence('target_detected', {
        alvo,
        seletor,
        confirmadoVisualmente,
        afterState: captureAfterState()
      });
    },

    /**
     * Registrar clique executado
     */
    recordClickExecuted(alvo, stake, x, y, success) {
      return recordEvidence('click_executed', {
        alvo,
        stake,
        x,
        y,
        success,
        afterState: captureAfterState()
      });
    },

    /**
     * Registrar confirmação do usuário
     */
    recordConfirmation(userAction, timestamp) {
      return recordEvidence('confirmation_received', {
        userAction, // 'approved', 'rejected', 'skipped'
        timestamp,
        afterState: captureAfterState()
      });
    },

    /**
     * Registrar erro/bloqueio
     */
    recordError(tipo, motivo, metadata) {
      return recordEvidence('error_recorded', {
        tipo,
        motivo,
        metadata,
        afterState: captureAfterState()
      });
    },

    /**
     * Registrar sugestão de padrão
     */
    recordSuggestion(padraoNome, confianca, alvo) {
      return recordEvidence('suggestion_made', {
        padraoNome,
        confianca,
        alvo,
        afterState: captureAfterState()
      });
    },

    /**
     * Notificar sobre nova rodada
     */
    onNovaRodada(roundId) {
      onNovaRodada(roundId);
    },

    /**
     * Consultar evidências por roundId
     */
    queryByRoundId(roundId) {
      return evidenceCache.filter(e => e.roundId === roundId);
    },

    /**
     * Consultar últimas N evidências
     */
    queryLatest(n = 10) {
      return evidenceCache.slice(-n);
    },

    /**
     * Consultar evidências por tipo de evento
     */
    queryByEventType(eventType) {
      return evidenceCache.filter(e => e.eventType === eventType);
    },

    /**
     * Exportar todas as evidências (para análise)
     */
    exportAll() {
      return [...evidenceCache];
    },

    /**
     * Limpar evidências (cuidado!)
     */
    clearAll() {
      evidenceCache = [];
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch (_) {}
      console.log(`${PREFIX} 🗑️ Todas as evidências foram removidas`);
    },

    /**
     * Recarregar do storage (útil após inicialização)
     */
    reload() {
      loadFromStorage();
    },

    /**
     * Obter estatísticas de evidências
     */
    getStats() {
      return {
        total: evidenceCache.length,
        byType: evidenceCache.reduce((acc, e) => {
          acc[e.eventType] = (acc[e.eventType] || 0) + 1;
          return acc;
        }, {}),
        byRound: evidenceCache.reduce((acc, e) => {
          if (e.roundId) {
            acc[e.roundId] = (acc[e.roundId] || 0) + 1;
          }
          return acc;
        }, {}),
        currentRound: currentRoundId,
        oldestTimestamp: evidenceCache[0]?.timestamp,
        newestTimestamp: evidenceCache[evidenceCache.length - 1]?.timestamp
      };
    }
  };
})();

// Inicializar
if (typeof window !== 'undefined') {
  EvidenceEngine.reload();
  window.EvidenceEngine = EvidenceEngine;
  console.log('[EvidenceEngine] ✅ Módulo carregado');
}
