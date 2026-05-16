/**
 * BetBoom Auto Pattern — Background Service Worker v2
 * Gerencia comunicação entre popup e content scripts.
 * Carrega automaticamente a Estratégia Will como padrão.
 */

try {
  importScripts('config.js');
} catch (error) {
  console.warn('[BetBoom Auto] Falha ao carregar config.js no service worker:', error?.message || error);
}

const NON_BLOCKING_SW_ERRORS = [
  /receiving end does not exist/i,
  /message port closed/i,
  /frame with id 0 was removed/i,
  /tab was closed/i,
  /the page keeping the extension port is moved into back\/forward cache/i,
  /extension context invalidated/i
];

function isNonBlockingServiceWorkerNoise(message) {
  if (!message) return false;
  return NON_BLOCKING_SW_ERRORS.some((pattern) => pattern.test(message));
}

function logServiceWorkerNoise(message) {
  console.info('[BetBoom Auto] [service.worker] ruído não-bloqueante:', message);
}

// Instalação da extensão
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[BetBoom Auto] Extensão instalada:', details.reason);

  const configPadrao = typeof BBConfigUtils !== 'undefined' && BBConfigUtils.getPersistedDefaults
    ? BBConfigUtils.getPersistedDefaults()
    : {};

  chrome.storage.local.get('config', (data) => {
    if (!data.config) {
      chrome.storage.local.set({ config: configPadrao });
      console.log('[BetBoom Auto] === ESTRATÉGIA WILL CARREGADA ===');
      console.log('[BetBoom Auto] 18 padrões ativos como estratégia inicial.');
    } else {
      console.log('[BetBoom Auto] Configuração existente mantida.');
    }
  });

  // Logar padrões ativos
  console.log('[BetBoom Auto] Padrões da Estratégia Will:');
  const nomes = [
    '1. Xadrez', '2. Reversão (até G1)', '3. Pós-Empate',
    '4. Diagonal', '5. Casadinho', '6. Linha Devedora',
    '7. Quebra de Padrão', '8. Sequência de 2', '9. Sequência de 3 (até G1)',
    '10. Ponta / Quadrante', '11. Xadrez sem Gale', '12. Ping-Pong',
    '13. Xadrez Duplo (2-2-2)', '14. Tendência Dominante',
    '15. Correção Após Empate', '16. Espelho',
    '17. Canal Horizontal', '18. Reversão Diagonal'
  ];
  nomes.forEach(n => console.log(`[BetBoom Auto]  ${n}`));

  try {
    const keys = [
      BBStrategyUtils.STORAGE_KEYS.strategyLibrary,
      BBStrategyUtils.STORAGE_KEYS.strategyLibraryBootstrapped,
      BBStrategyUtils.STORAGE_KEYS.strategyPreferences
    ];

    chrome.storage.local.get(keys, (data) => {
      const bootstrap = BBStrategyUtils.ensureBootstrapPayload(data);
      if (!bootstrap.shouldBootstrap) return;

      chrome.storage.local.set({
        [BBStrategyUtils.STORAGE_KEYS.strategyLibrary]: bootstrap.strategyLibrary,
        [BBStrategyUtils.STORAGE_KEYS.strategyLibraryBootstrapped]: true,
        [BBStrategyUtils.STORAGE_KEYS.strategyPreferences]: bootstrap.strategyPreferences
      });

      console.log('[BetBoom Auto] Estratégias padrão do Will carregadas automaticamente.');
    });
  } catch (error) {
    console.warn('[BetBoom Auto] Falha ao bootstrapar estratégias padrão:', error?.message || error);
  }
});

// Comunicação entre popup e content script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'BB_RELAY_WS_EVENT' || msg?.type === 'BB_RELAY_OPERATOR_EVENT') {
    const tabId = sender?.tab?.id;
    const payload = msg.envelope || msg.event;
    if (!tabId || !payload) {
      sendResponse?.({ ok: false, error: 'Relay inválido' });
      return false;
    }

    chrome.tabs.sendMessage(
      tabId,
      msg?.type === 'BB_RELAY_WS_EVENT'
        ? {
            type: 'BB_TOP_FRAME_WS_EVENT',
            envelope: payload
          }
        : {
            type: 'BB_TOP_FRAME_OPERATOR_EVENT',
            event: payload
          },
      { frameId: 0 },
      () => {
        if (chrome.runtime.lastError) {
          const message = chrome.runtime.lastError.message || 'Erro desconhecido';
          if (isNonBlockingServiceWorkerNoise(message)) {
            logServiceWorkerNoise(message);
            sendResponse?.({ ok: true, nonBlocking: true });
            return;
          }

          console.warn('[BetBoom Auto] Falha ao reenviar evento para frame 0:', message);
          sendResponse?.({ ok: false, error: message });
          return;
        }

        sendResponse?.({ ok: true });
      }
    );

    return true;
  }

  if (msg.target === 'content') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, msg, (response) => {
          sendResponse(response);
        });
      } else {
        sendResponse({ error: 'Nenhuma aba ativa encontrada' });
      }
    });
    return true;
  }
});

/**
 * HardwareAutomationEngine
 * Utiliza a API chrome.debugger para disparar eventos de mouse reais.
 */
const HardwareAutomationEngine = {
  attachedTabs: new Set(),

  async attach(tabId) {
    if (this.attachedTabs.has(tabId)) return;
    return new Promise((resolve, reject) => {
      chrome.debugger.attach({ tabId }, '1.3', () => {
        if (chrome.runtime.lastError) {
          const msg = chrome.runtime.lastError.message;
          if (msg.includes('already attached')) {
            this.attachedTabs.add(tabId);
            resolve();
          } else {
            console.error('[BetBoom Hardware] Erro ao anexar debugger:', msg);
            reject(chrome.runtime.lastError);
          }
        } else {
          console.log('[BetBoom Hardware] Debugger anexado à aba:', tabId);
          this.attachedTabs.add(tabId);
          resolve();
        }
      });
    });
  },

  async detach(tabId) {
    if (!this.attachedTabs.has(tabId)) return;
    return new Promise((resolve) => {
      chrome.debugger.detach({ tabId }, () => {
        this.attachedTabs.delete(tabId);
        console.log('[BetBoom Hardware] Debugger removido da aba:', tabId);
        resolve();
      });
    });
  },

  async dispatchClick(tabId, x, y) {
    try {
      await this.attach(tabId);

      const commonParams = {
        x: Math.round(x),
        y: Math.round(y),
        button: 'left',
        clickCount: 1,
        pointerType: 'mouse'
      };

      // Sequência de hardware: Move -> Press -> Release
      await this.sendCommand(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...commonParams });
      // Pequeno delay para simular o tempo de clique físico
      await new Promise(r => setTimeout(r, 60));
      await this.sendCommand(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...commonParams });

      console.log(`[BetBoom Hardware] Clique executado em: ${commonParams.x}, ${commonParams.y}`);
      return true;
    } catch (error) {
      console.error('[BetBoom Hardware] Falha no despacho do clique:', error.message);
      return false;
    }
  },

  sendCommand(tabId, method, params) {
    return new Promise((resolve, reject) => {
      chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
        if (chrome.runtime.lastError) {
          console.error(`[BetBoom Hardware] Erro no comando ${method}:`, chrome.runtime.lastError.message);
          reject(chrome.runtime.lastError);
        } else {
          resolve(result);
        }
      });
    });
  }
};

// Listener para desconexão acidental do debugger
chrome.debugger.onDetach.addListener((source, reason) => {
  console.warn(`[BetBoom Hardware] Debugger desconectado da aba ${source.tabId}. Motivo: ${reason}`);
  HardwareAutomationEngine.attachedTabs.delete(source.tabId);
});

// Adicionar listener para cliques de hardware no handler de mensagens existente
const originalOnMessage = chrome.runtime.onMessage.addListener;
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'BB_EXECUTE_HARDWARE_CLICK') {
    const tabId = sender?.tab?.id || msg.tabId;
    if (!tabId) {
      sendResponse({ ok: false, error: 'tabId não encontrado' });
      return false;
    }

    HardwareAutomationEngine.dispatchClick(tabId, msg.x, msg.y)
      .then(ok => sendResponse({ ok }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    
    return true; // async
  }
});

// Listener para quando uma aba é atualizada
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    const isBetBoom = tab.url.includes('betboom.com') || 
                      tab.url.includes('betboom.bet.br') ||
                      tab.url.includes('betboom.mx');
    
    if (isBetBoom) {
      console.log('[BetBoom Auto] Página BetBoom detectada. Ativando Soberania de Hardware...', tab.url);
      
      // Auto-attach imediato para "bloquear" o browser e mostrar o banner de debug
      HardwareAutomationEngine.attach(tabId)
        .then(() => {
          console.log('[BetBoom Auto] 🚀 Soberania Ativa! Banner de depuração exibido.');
        })
        .catch(err => {
          console.warn('[BetBoom Auto] Falha no auto-attach:', err.message);
        });
    }
  }
});

// Garantir attach também em abas já abertas na inicialização
chrome.tabs.query({ url: ["*://*.betboom.com/*", "*://*.betboom.bet.br/*", "*://*.betboom.mx/*"] }, (tabs) => {
  tabs.forEach(tab => {
    HardwareAutomationEngine.attach(tab.id).catch(() => {});
  });
});
