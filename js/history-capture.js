/**
 * HistoryCapture — Captura de histórico de múltiplas fontes
 *
 * Responsabilidades:
 * 1. Capturar de WebSocket (eventos em tempo real)
 * 2. Capturar de DOM (estado atual da banca)
 * 3. Capturar de Visual/OCR (fallback)
 * 4. Capturar de Storage (reidratação)
 * 5. Emitir eventos estruturados
 */

const HistoryCapture = (() => {
  // Event listeners
  let captureListeners = [];

  /**
   * Emite evento de captura estruturado
   */
  function emitCaptureEvent(event) {
    console.log(`[HistoryCapture] Evento:`, event.type, {
      source: event.source,
      count: event.count,
      confidence: event.confidence,
      timestamp: event.timestamp
    });

    for (const listener of captureListeners) {
      try {
        listener(event);
      } catch (err) {
        console.error(`[HistoryCapture] Listener error:`, err);
      }
    }
  }

  /**
   * Registra listener para eventos de captura
   */
  function onCapture(listener) {
    if (typeof listener === 'function') {
      captureListeners.push(listener);
    }
  }

  /**
   * CAPTURA 1: WebSocket — observar eventos de resultados em tempo real
   * Entrada: payload do WS (já normalizado por Collector)
   */
  function captureFromWebSocket(payload) {
    if (!payload || typeof payload !== 'object') {
      console.warn(`[HistoryCapture] WebSocket payload inválido:`, typeof payload);
      return {
        success: false,
        reason: 'invalid_payload',
        captured: []
      };
    }

    const captured = [];

    // Caso 1: Payload é um round individual
    if (payload.roundId || payload.result) {
      captured.push({
        ...payload,
        _source: 'websocket',
        _captured: Date.now()
      });
    }

    // Caso 2: Payload é array de rounds (snapshot histórico)
    else if (Array.isArray(payload)) {
      for (const item of payload) {
        captured.push({
          ...item,
          _source: 'websocket',
          _captured: Date.now()
        });
      }
    }

    // Caso 3: Payload tem campo 'history' (estrutura nested)
    else if (payload.history && Array.isArray(payload.history)) {
      for (const item of payload.history) {
        captured.push({
          ...item,
          _source: 'websocket',
          _captured: Date.now()
        });
      }
    }

    // Caso 4: Payload tem campo 'result' (novo resultado)
    else if (payload.result) {
      captured.push({
        ...payload,
        _source: 'websocket',
        _captured: Date.now()
      });
    }

    const event = {
      type: 'HISTORY_CAPTURED',
      source: 'websocket',
      payloadType: captured.length > 1 ? 'snapshot' : 'new_result',
      count: captured.length,
      confidence: 1.0,
      timestamp: Date.now(),
      captured
    };

    console.log(`[HistoryCapture] WebSocket: ${captured.length} rounds capturados`);
    emitCaptureEvent(event);

    return { success: true, count: captured.length };
  }

  /**
   * CAPTURA 2: DOM — extrair histórico atual renderizado no tabuleiro
   * Busca por .bb-bola ou equivalente
   */
  function captureFromDOM() {
    const captured = [];

    // Procurar por bolinhas renderizadas (qualquer container com classe)
    const ballElements = document.querySelectorAll(
      '.bb-bola, [class*="ball"], [class*="bola"], [data-history-item]'
    );

    if (ballElements.length === 0) {
      console.log(`[HistoryCapture] DOM: Nenhuma bolinha encontrada`);
      return {
        success: false,
        reason: 'no_balls_found',
        captured: []
      };
    }

    for (let i = 0; i < ballElements.length; i++) {
      const el = ballElements[i];

      // Extrair cor
      let color = null;
      const classes = el.className || '';
      if (classes.includes('blue') || classes.includes('player') || classes.includes('azul')) {
        color = 'azul';
      } else if (classes.includes('red') || classes.includes('banker') || classes.includes('vermelho')) {
        color = 'vermelho';
      } else if (classes.includes('green') || classes.includes('tie') || classes.includes('empate')) {
        color = 'empate';
      }

      // Fallback: CSS computado
      if (!color) {
        const bgColor = window.getComputedStyle(el).backgroundColor;
        if (bgColor.includes('255') && bgColor.includes('0')) {
          // Vermelho
          color = 'vermelho';
        } else if (bgColor.includes('0') && bgColor.includes('0')) {
          // Azul/Preto
          color = 'azul';
        } else if (bgColor.includes('255') && bgColor.includes('255')) {
          // Branco/Verde
          color = 'empate';
        }
      }

      if (color) {
        captured.push({
          index: i,
          color,
          _source: 'dom',
          _element: el.innerText || el.textContent || '',
          _captured: Date.now()
        });
      }
    }

    const event = {
      type: 'HISTORY_CAPTURED',
      source: 'dom',
      payloadType: 'visual_snapshot',
      count: captured.length,
      confidence: 0.9,
      timestamp: Date.now(),
      captured
    };

    console.log(`[HistoryCapture] DOM: ${captured.length} bolinhas extraídas`);
    emitCaptureEvent(event);

    return { success: captured.length > 0, count: captured.length };
  }

  /**
   * CAPTURA 3: Visual/OCR — fallback visual (não implementado em MV3)
   * Mantém hook para futuro
   */
  function captureFromVisual() {
    console.log(`[HistoryCapture] Visual/OCR: Não implementado em MV3 (permissões)`);
    return {
      success: false,
      reason: 'not_implemented',
      captured: []
    };
  }

  /**
   * CAPTURA 4: Storage — restaurar histórico de localStorage/sessionStorage
   */
  function captureFromStorage() {
    const captured = [];

    // Procurar por chaves conhecidas
    const storageKeys = [
      'betboom_history',
      'history',
      'app_state',
      'game_history',
      'bb_history',
      'betting_history'
    ];

    for (const key of storageKeys) {
      try {
        // Tentar localStorage
        const item = localStorage.getItem(key);
        if (item) {
          const parsed = JSON.parse(item);
          if (Array.isArray(parsed)) {
            for (const round of parsed) {
              captured.push({
                ...round,
                _source: 'storage:localStorage',
                _key: key,
                _captured: Date.now()
              });
            }
          }
        }
      } catch (err) {
        // Ignorar parse errors
      }

      try {
        // Tentar sessionStorage
        const item = sessionStorage.getItem(key);
        if (item) {
          const parsed = JSON.parse(item);
          if (Array.isArray(parsed)) {
            for (const round of parsed) {
              captured.push({
                ...round,
                _source: 'storage:sessionStorage',
                _key: key,
                _captured: Date.now()
              });
            }
          }
        }
      } catch (err) {
        // Ignorar parse errors
      }
    }

    // Deduplicar por signature se disponível
    const seen = new Set();
    const deduped = [];
    for (const item of captured) {
      const key = item.roundId || `${item.timestamp}:${item.result}`;
      if (!seen.has(key)) {
        deduped.push(item);
        seen.add(key);
      }
    }

    const event = {
      type: 'HISTORY_CAPTURED',
      source: 'storage',
      payloadType: 'snapshot',
      count: deduped.length,
      confidence: 0.6,
      timestamp: Date.now(),
      captured: deduped
    };

    if (deduped.length > 0) {
      console.log(`[HistoryCapture] Storage: ${deduped.length} rounds restaurados`);
      emitCaptureEvent(event);
    }

    return { success: deduped.length > 0, count: deduped.length };
  }

  /**
   * Captura de múltiplas fontes em paralelo (startup)
   * Ordem de confiança: WebSocket > DOM > Storage > Visual
   */
  function captureMultiple(sources = ['websocket', 'dom', 'storage']) {
    console.log(`[HistoryCapture] Iniciando captura múltipla de:`, sources);

    const results = {};

    if (sources.includes('websocket')) {
      // WebSocket é observado via callback, não captura aqui
      results.websocket = { success: false, reason: 'listened_via_callback' };
    }

    if (sources.includes('dom')) {
      results.dom = captureFromDOM();
    }

    if (sources.includes('storage')) {
      results.storage = captureFromStorage();
    }

    if (sources.includes('visual')) {
      results.visual = captureFromVisual();
    }

    console.log(`[HistoryCapture] Resultado captura múltipla:`, results);
    return results;
  }

  /**
   * Hook para integração com Collector
   * Deve ser chamado quando Collector emite novo resultado
   */
  function onCollectorNewResult(callback) {
    return callback;
  }

  return {
    captureFromWebSocket,
    captureFromDOM,
    captureFromVisual,
    captureFromStorage,
    captureMultiple,
    onCapture,
    emitCaptureEvent,
    onCollectorNewResult
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = HistoryCapture;
}
