/**
 * BetBoom Auto Pattern — WebSocket Interceptor enxuto (MVP)
 *
 * Responsabilidade única:
 * - hook de WebSocket no page world
 * - classificação do socket por canal
 * - bridge de payload bruto para o content script do frame local
 */

(function() {
  'use strict';

  const PREFIX = '[BetBoom WS]';
  const SOURCE = 'betboom-ws-interceptor';
  const OriginalWebSocket = window.WebSocket;
  const textDecoder = new TextDecoder();
  const INTERCEPTOR_TOKEN = document.currentScript?.dataset?.betboomInterceptorToken || null;

  if (!OriginalWebSocket || window.__betboomWsInterceptorInstalled) {
    return;
  }
  window.__betboomWsInterceptorInstalled = true;

  if (OriginalWebSocket.__betboomWrapped) {
    console.log(`${PREFIX} WebSocket já estava protegido neste frame.`);
    return;
  }

  // Trava de segurança: Limpar cache do local storage (versão antiga v2.1.0) 
  // para evitar que configurações zumbis crashem o Hardware Engine da v2.3.0
  try {
     if (window.localStorage.getItem('bb_config_zombie')) {
         window.localStorage.removeItem('bb_config_zombie');
     }
  } catch(e) {}

  function classificarCanal(socketUrl) {
    let parsed;
    try {
      parsed = new URL(socketUrl, window.location.href);
    } catch (_) {
      return 'other';
    }

    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();

    if (host.includes('betboom.bet.br') && path === '/api/v1/ws/') {
      return 'betboom-platform';
    }
    if (path.includes('/public/bacbo/player/game/')) {
      return 'evo-game';
    }
    if (path.includes('/public/chat/table/')) {
      return 'evo-chat';
    }
    if (host.includes('egcvi.com') || path.includes('/websocketstream2')) {
      return 'evo-video';
    }
    return 'other';
  }

  function postEnvelope(envelope) {
    if (!INTERCEPTOR_TOKEN) {
      console.warn(`${PREFIX} Token do interceptor ausente; envelope descartado.`);
      return;
    }

    window.postMessage({
      source: SOURCE,
      token: INTERCEPTOR_TOKEN,
      payload: envelope
    }, '*');
  }

  function criarEnvelope(channel, socketUrl, direction, extras = {}) {
    return {
      kind: 'bb_ws_raw',
      channel,
      socketUrl,
      frameUrl: window.location.href,
      direction,
      text: null,
      binaryLength: null,
      timestamp: Date.now(),
      ...extras
    };
  }

  function tentarTexto(raw, channel) {
    if (typeof raw === 'string') {
      return { text: raw, binaryLength: null };
    }

    if (raw instanceof ArrayBuffer) {
      if (channel === 'evo-video') {
        return { text: null, binaryLength: raw.byteLength };
      }

      try {
        return {
          text: textDecoder.decode(new Uint8Array(raw)),
          binaryLength: raw.byteLength
        };
      } catch (_) {
        return { text: null, binaryLength: raw.byteLength };
      }
    }

    return null;
  }

  function capturarMensagem(channel, socketUrl, direction, raw) {
    const direct = tentarTexto(raw, channel);
    if (direct) {
      postEnvelope(criarEnvelope(channel, socketUrl, direction, direct));
      return;
    }

    if (raw instanceof Blob) {
      const binaryLength = raw.size;
      if (channel === 'evo-video') {
        postEnvelope(criarEnvelope(channel, socketUrl, direction, { text: null, binaryLength }));
        return;
      }

      raw.text()
        .then((text) => {
          postEnvelope(criarEnvelope(channel, socketUrl, direction, { text, binaryLength }));
        })
        .catch(() => {
          postEnvelope(criarEnvelope(channel, socketUrl, direction, { text: null, binaryLength }));
        });
      return;
    }

    postEnvelope(criarEnvelope(channel, socketUrl, direction));
  }

  window.WebSocket = function(...args) {
    const ws = new OriginalWebSocket(...args);
    const socketUrl = String(args[0] || '');
    const channel = classificarCanal(socketUrl);

    console.log(`${PREFIX} Nova conexão [${channel}]:`, socketUrl);
    postEnvelope(criarEnvelope(channel, socketUrl, 'open'));

    ws.addEventListener('message', (event) => {
      capturarMensagem(channel, socketUrl, 'received', event.data);
    });

    ws.addEventListener('close', () => {
      postEnvelope(criarEnvelope(channel, socketUrl, 'close'));
    });

    const originalSend = ws.send.bind(ws);
    ws.send = function(data) {
      capturarMensagem(channel, socketUrl, 'sent', data);
      return originalSend(data);
    };

    return ws;
  };

  window.WebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
  window.WebSocket.OPEN = OriginalWebSocket.OPEN;
  window.WebSocket.CLOSING = OriginalWebSocket.CLOSING;
  window.WebSocket.CLOSED = OriginalWebSocket.CLOSED;
  window.WebSocket.prototype = OriginalWebSocket.prototype;
  window.WebSocket.__betboomWrapped = true;

  console.log(`${PREFIX} Interceptor enxuto ativo.`);
})();
