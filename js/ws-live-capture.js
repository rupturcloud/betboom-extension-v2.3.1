/**
 * WS Live Capture + Auto Bet (Valor Mínimo)
 * ==========================================
 * Cole este script no console DO IFRAME da Evolution (não da página pai).
 * Para acessar o iframe: DevTools > Console > dropdown "top" > selecione o frame evo-games
 *
 * O script faz:
 *  1. Intercepta todos os eventos WebSocket em tempo real
 *  2. Loga payloads de entrada e saída
 *  3. Executa uma aposta de valor mínimo quando a mesa abre
 */

(function () {
  'use strict';

  // Barramento de eventos para sincronização entre módulos
  const EventBus = {
    listeners: {},
    on(event, callback) {
      if (!this.listeners[event]) this.listeners[event] = [];
      this.listeners[event].push(callback);
    },
    emit(event, data) {
      if (this.listeners[event]) {
        this.listeners[event].forEach(cb => {
          try { cb(data); } catch (e) { console.error(`[BB-BUS] Erro no listener ${event}:`, e); }
        });
      }
      // Também disparar via CustomEvent para o resto da extensão
      window.dispatchEvent(new CustomEvent(`bb:${event}`, { detail: data }));
    }
  };
  window.BB_BUS = EventBus;

  const LOG = (tag, data) => {
    console.log(`%c[BB-LIVE][${tag}]`, 'color:#0f0;font-weight:bold', data);
  };

  // ── 1. INTERCEPTAR WEBSOCKET ──────────────────────────────────────────────
  const NativeWS = window.WebSocket;
  const wsMessages = [];

  window.WebSocket = function (...args) {
    const ws = new NativeWS(...args);
    LOG('WS_CONNECT', `URL: ${args[0]}`);

    ws.addEventListener('message', (evt) => {
      const raw = evt.data;
      // Ignorar binários (ArrayBuffer/Blob)
      if (typeof raw !== 'string') return;

      // Limpeza do envelope Evolution (começa com "!")
      const clean = raw.startsWith('!') ? raw.slice(1) : raw;
      let parsed = null;
      try { parsed = JSON.parse(clean); } catch (_) {}

      // Guardar e logar
      const entry = { ts: Date.now(), raw: raw.slice(0, 200), parsed };
      wsMessages.push(entry);

      // Logar só os tipos relevantes para Bac Bo
      const type = parsed?.type || parsed?.[0] || '';
      if (/(bac|bet|road|dice|result|state|balance|round)/i.test(type)) {
        LOG('WS_RECV', { type, data: parsed });
        
        // --- SISTEMA DE GATILHOS (Zero Latency) ---
        // Se for início de apostas no Bac Bo (Evolution)
        if (type === 'state' && parsed.args?.state === 'BETTING') {
          EventBus.emit('BACBO_BETTING_OPEN', { 
            ts: Date.now(), 
            roundId: parsed.args?.roundId || null,
            timer: parsed.args?.timer || null
          });
        }
        
        // Se for resultado da rodada
        if (type === 'result' || type === 'dice') {
          EventBus.emit('BACBO_RESULT', { 
            ts: Date.now(), 
            vencedor: parsed.args?.vencedor || null,
            cor: parsed.args?.vencedor === 'PLAYER' ? 'azul' : (parsed.args?.vencedor === 'BANKER' ? 'vermelho' : 'empate'),
            roundId: parsed.args?.roundId || null
          });
        }
        
        // Evento genérico para telemetria
        EventBus.emit('WS_MESSAGE', { type, data: parsed });
      }
    });

    ws.addEventListener('open', () => LOG('WS_OPEN', args[0]));
    ws.addEventListener('close', (e) => LOG('WS_CLOSE', `code=${e.code}`));
    ws.addEventListener('error', (e) => LOG('WS_ERROR', e));

    // Interceptar mensagens enviadas pelo cliente também
    const origSend = ws.send.bind(ws);
    ws.send = function (data) {
      if (typeof data === 'string') {
        LOG('WS_SEND', data.slice(0, 200));
      }
      return origSend(data);
    };

    window._BB_WS = ws; // Guardar referência
    return ws;
  };
  Object.assign(window.WebSocket, NativeWS); // Preservar propriedades estáticas

  LOG('WS_HOOK', '✅ Interceptor ativo. Aguardando conexão...');

  // ── 2. MAPEADOR DE BOTÕES ─────────────────────────────────────────────────
  function encontrar(seletores) {
    for (const s of seletores) {
      try {
        const el = document.querySelector(s);
        if (el) return { el, s };
      } catch (_) {}
    }
    return null;
  }

  function clicar(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y };
    ['mouseover', 'mousedown', 'mouseup', 'click'].forEach(ev =>
      el.dispatchEvent(new MouseEvent(ev, opts))
    );
    el.click();
    return true;
  }

  const SEL = {
    player: [
      '[data-role="player-bet-spot"]', '[class*="player"][class*="spot"]',
      '[class*="Player"][class*="Spot"]', '[class*="betspot--player"]',
      '[class*="wc-bet-spot--player"]', '[data-element="player"]',
    ],
    banker: [
      '[data-role="banker-bet-spot"]', '[class*="banker"][class*="spot"]',
      '[class*="Banker"][class*="Spot"]', '[class*="betspot--banker"]',
      '[class*="wc-bet-spot--banker"]', '[data-element="banker"]',
    ],
    tie: [
      '[data-role="tie-bet-spot"]', '[class*="tie"][class*="spot"]',
      '[class*="Tie"][class*="Spot"]', '[class*="betspot--tie"]',
      '[class*="wc-bet-spot--tie"]', '[data-element="tie"]',
    ],
    chips: [
      '[class*="chip"i]:not([class*="tray"i]):not([class*="container"i])',
      '[data-role*="chip"]', '[class*="Chip"]:not([class*="Tray"])',
    ],
    undo: [
      '[data-role="undo"]', '[class*="undo"i]', 'button[class*="Undo"]',
      '[aria-label*="undo" i]', '[aria-label*="clear" i]',
    ],
    timer: [
      '[class*="timer" i]', '[class*="countdown" i]', '[data-role="timer"]',
      '[class*="Clock"]', '[class*="clock"]',
    ],
  };

  // ── 3. MAPA COMPLETO DA MESA ─────────────────────────────────────────────
  window.BB = {
    mapear() {
      console.group('%c[BB] 🗺️ MAPA DA MESA', 'color:cyan;font-weight:bold');
      for (const [nome, lista] of Object.entries(SEL)) {
        const found = encontrar(lista);
        if (found) {
          console.log(`%c✅ ${nome.padEnd(10)}`, 'color:lime', found.s,
            '|', found.el.textContent?.trim().slice(0, 30));
        } else {
          console.log(`%c❌ ${nome.padEnd(10)}`, 'color:red', 'NÃO ENCONTRADO');
        }
      }
      // Listar todos os botões para inspeção manual
      const btns = [...document.querySelectorAll('button,[role=button]')]
        .filter(b => b.getBoundingClientRect().width > 0);
      console.log(`\n📋 Botões visíveis (${btns.length}):`);
      btns.forEach(b =>
        console.log('  >', b.className.trim().slice(0, 70), '|', b.textContent?.trim().slice(0, 20))
      );
      console.groupEnd();
    },

    // ── 4. APOSTA MÍNIMA AUTOMÁTICA ────────────────────────────────────────
    async apostar(lado = 'player') {
      LOG('BET_START', `Tentando apostar em: ${lado}`);

      // Ler o valor mínimo da mesa direto da interface
      const minEl = document.querySelector(
        '[class*="min"i][class*="bet"i], [class*="limit"i], [data-min], [class*="minbet"i]'
      );
      if (minEl) {
        LOG('BET_MIN', `Valor mínimo lido da interface: ${minEl.textContent?.trim()}`);
      }

      // Mapear TODAS as fichas e seus valores
      const chips = [...document.querySelectorAll(
        '[class*="chip"i]:not([class*="tray"i]):not([class*="container"i]),' +
        '[data-role*="chip"],[class*="Chip"]:not([class*="Tray"])'
      )].filter(c => c.getBoundingClientRect().width > 0);

      if (chips.length === 0) {
        LOG('BET_ERROR', '❌ Nenhuma ficha encontrada');
        return false;
      }

      // Logar TODAS as fichas e seus valores para diagnóstico
      LOG('BET_CHIPS_ALL', chips.map((c, i) =>
        `[${i}] valor=${c.textContent?.trim() || c.getAttribute('data-value') || '?'} | class=${c.className.slice(0, 40)}`
      ));

      // Usar a PRIMEIRA ficha (menor valor disponível)
      const chip = chips[0];
      const chipValor = chip.textContent?.trim() || chip.getAttribute('data-value') || '?';
      LOG('BET_CHIP', `Ficha selecionada: valor=${chipValor}`);
      clicar(chip);
      await new Promise(r => setTimeout(r, 300));

      // Encontrar e clicar no spot
      const found = encontrar(SEL[lado] || SEL.player);
      if (!found) {
        LOG('BET_ERROR', `❌ Spot "${lado}" não encontrado`);
        return false;
      }

      LOG('BET_CLICK', `Clicando em: ${found.s}`);
      clicar(found.el);
      LOG('BET_OK', `✅ Aposta enviada em ${lado} com ficha de ${chipValor}`);
      return true;
    },

    async testeCompleto() {
      console.group('%c[BB] 🚀 TESTE COMPLETO (valor mínimo)', 'color:yellow;font-weight:bold');
      this.mapear();
      await new Promise(r => setTimeout(r, 1000));

      LOG('TEST', '--- Apostando em PLAYER (azul) ---');
      await this.apostar('player');
      await new Promise(r => setTimeout(r, 2000));

      LOG('TEST', '--- Removendo aposta ---');
      const undo = encontrar(SEL.undo);
      if (undo) { clicar(undo.el); LOG('TEST', '✅ Aposta removida'); }

      await new Promise(r => setTimeout(r, 1000));
      LOG('TEST', '--- Apostando em BANKER (vermelho) ---');
      await this.apostar('banker');
      await new Promise(r => setTimeout(r, 2000));

      const undo2 = encontrar(SEL.undo);
      if (undo2) { clicar(undo2.el); }

      console.groupEnd();
    },

    // Ver últimas mensagens do WebSocket
    ws(n = 10) {
      const ultimas = wsMessages.slice(-n);
      ultimas.forEach((m, i) =>
        console.log(`[${i}]`, new Date(m.ts).toLocaleTimeString(), m.parsed || m.raw)
      );
      return ultimas;
    },

    // Ver apenas resultados de rodadas
    resultados() {
      return wsMessages
        .filter(m => m.parsed?.type && /(road|result|dice)/i.test(m.parsed.type))
        .map(m => ({ tipo: m.parsed.type, data: m.parsed }));
    }
  };

  console.log('%c[BB] ✅ Scripts carregados! Comandos disponíveis:', 'color:cyan;font-weight:bold');
  console.log('  BB.mapear()         → mapeia botões da mesa');
  console.log('  BB.apostar("player") → aposta valor mínimo em player');
  console.log('  BB.apostar("banker") → aposta valor mínimo em banker');
  console.log('  BB.testeCompleto()  → teste full automatizado');
  console.log('  BB.ws(10)           → últimas 10 mensagens WebSocket');
  console.log('  BB.resultados()     → apenas resultados de rodadas');
})();
