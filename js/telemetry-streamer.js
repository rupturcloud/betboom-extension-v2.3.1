/*
 * TelemetryStreamer — envia eventos da extensao pro servidor local
 * (tools/telemetry-server.js) em tempo real. Diego (18/05): em vez de
 * ele copiar logs, eu (Claude) consulto o servidor direto.
 *
 * - Endpoint default: http://127.0.0.1:9876/event
 * - Fila com flush por batch (200ms ou 20 eventos)
 * - Silencioso se servidor offline (so log no console, nao trava)
 * - Polling de comandos a cada 3s (GET /commands)
 * - Suporta comandos: dispararCalibracao, modoObservacao, aplicarConfig,
 *   recarregar, pararBot, iniciarBot
 *
 * Tipos de evento (campo .type):
 *   - boot               (carga inicial)
 *   - decisao_tomada     (DecisionEngine.decidir retornou deveApostar=true)
 *   - guard_origem_bloqueado (decisao nao-WMSG bloqueada)
 *   - click_executado    (executarAposta chamou)
 *   - bet_confirmation   (CONFIRMADA / NAO_ENTROU)
 *   - calibracao_feita   (BBCalibrator.tudo concluiu)
 *   - modo_observacao_mudou
 *   - stop_atingido      (stopWin/stopLoss bateu)
 *   - padrao_detectado   (WMSG match no atualizarUI)
 *   - estado_rodada      (mudanca de fase apostando/jogando/etc)
 *   - error              (qualquer erro capturado)
 */
(function () {
  'use strict';

  const PREFIX = '[Telemetry-Stream]';
  // Default localhost:9876. Sobrescrevivel via CONFIG.telemetryServerUrl.
  const ENDPOINT = () => (typeof CONFIG !== 'undefined' && CONFIG.telemetryServerUrl)
    || 'http://127.0.0.1:9876';

  const queue = [];
  const MAX_QUEUE = 200;
  let flushTimer = null;
  let serverOnline = null; // null=unknown, true=ok, false=offline
  let lastHealthCheck = 0;

  function push(event) {
    if (!event || !event.type) return;
    const enriched = {
      ...event,
      _ts: new Date().toISOString(),
      _round: typeof CONFIG !== 'undefined' ? CONFIG.roundIdAtual : null,
      _estado: typeof CONFIG !== 'undefined' ? CONFIG.estadoRodadaAtual : null,
      _banca: typeof CONFIG !== 'undefined' ? CONFIG.saldoReal : null,
    };
    queue.push(enriched);
    if (queue.length > MAX_QUEUE) queue.shift();
    scheduleFlush();
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(flush, 200);
  }

  async function flush() {
    flushTimer = null;
    if (queue.length === 0) return;
    const batch = queue.splice(0, 20);
    try {
      const resp = await fetch(`${ENDPOINT()}/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
      });
      serverOnline = resp.ok;
      if (!resp.ok) console.warn(`${PREFIX} flush HTTP ${resp.status}`);
    } catch (e) {
      // Servidor offline — log so 1x a cada 30s pra nao inundar
      const now = Date.now();
      if (serverOnline !== false || now - lastHealthCheck > 30000) {
        console.log(`${PREFIX} offline (rode: node tools/telemetry-server.js) — ${e.message}`);
        lastHealthCheck = now;
      }
      serverOnline = false;
      // Re-enfileira pra tentar de novo? Nao — perda controlada.
    }
    if (queue.length > 0) scheduleFlush();
  }

  async function pollCommands() {
    try {
      const resp = await fetch(`${ENDPOINT()}/commands`);
      if (!resp.ok) return;
      const cmds = await resp.json();
      if (!Array.isArray(cmds) || cmds.length === 0) return;
      for (const c of cmds) {
        try {
          await executarComando(c);
        } catch (e) {
          push({ type: 'error', erro: `cmd ${c.cmd}: ${e?.message || e}` });
        }
        // ack
        try { await fetch(`${ENDPOINT()}/commands?ack=${c.id}`); } catch (_) {}
      }
    } catch (_) { /* servidor offline */ }
  }

  /**
   * Executa comando recebido do servidor (Diego/Claude controla extensao remoto).
   */
  async function executarComando(c) {
    console.log(`${PREFIX} 📨 comando recebido: ${c.cmd}`, c.args || {});
    push({ type: 'comando_recebido', cmd: c.cmd, args: c.args });
    switch (c.cmd) {
      case 'snapshot':
        if (typeof BBDebug !== 'undefined') push({ type: 'snapshot', snap: BBDebug.snapshot() });
        break;
      case 'calibrar':
        // Liga via overlay (que tem ponte pro MAIN world)
        if (typeof Overlay !== 'undefined' && Overlay.dispararCalibracao) {
          Overlay.dispararCalibracao();
        }
        break;
      case 'modo_observacao':
        if (typeof CONFIG !== 'undefined') CONFIG.modoTeste = c.args?.on === true;
        try { chrome.storage.local.set({ 'bb-modo-teste': CONFIG.modoTeste }); } catch (_) {}
        break;
      case 'parar':
        if (typeof Overlay !== 'undefined' && Overlay.pararBot) Overlay.pararBot();
        break;
      case 'iniciar':
        if (typeof Overlay !== 'undefined' && Overlay.iniciarBot) Overlay.iniciarBot();
        break;
      case 'aplicar_config':
        if (c.args) {
          for (const [k, v] of Object.entries(c.args)) {
            if (typeof CONFIG !== 'undefined' && k in CONFIG) CONFIG[k] = v;
          }
        }
        break;
      case 'aposta_teste':
        if (typeof window.BBCalibrator !== 'undefined') {
          const r = await window.BBCalibrator.executarAposta(c.args?.cor || 'azul', c.args?.stake || 5);
          push({ type: 'aposta_teste_result', result: r });
        }
        break;
      case 'limpar_calibracao':
        if (typeof window.BBCalibrator !== 'undefined') window.BBCalibrator.limpar();
        break;
      default:
        console.warn(`${PREFIX} comando desconhecido: ${c.cmd}`);
    }
  }

  // Health check inicial
  fetch(`${ENDPOINT()}/health`)
    .then((r) => r.json())
    .then((j) => {
      serverOnline = true;
      console.log(`${PREFIX} ✅ servidor online — uptime ${j.uptime_s}s, ${j.total_events} eventos`);
      push({ type: 'boot', extension_version: 'v16-telemetry-server', user_agent: navigator.userAgent });
    })
    .catch(() => {
      serverOnline = false;
      console.log(`${PREFIX} 🛰  servidor offline. Inicie com: node tools/telemetry-server.js`);
    });

  // Polling de comandos a cada 3s
  setInterval(pollCommands, 3000);

  // Hook em bb-bet-confirmation pra streamar veredito
  window.addEventListener('bb-bet-confirmation', (ev) => {
    push({
      type: 'bet_confirmation',
      veredito: ev?.detail?.veredito,
      cor: ev?.detail?.cor,
      stake: ev?.detail?.stake,
      saldoAntes: ev?.detail?.saldoAntes,
      saldoDepois: ev?.detail?.saldoDepois,
      delta: ev?.detail?.delta,
    });
  });

  // API publica pra outros modulos chamarem
  window.TelemetryStream = {
    push,
    flush,
    isOnline: () => serverOnline === true,
    queueSize: () => queue.length,
    endpoint: ENDPOINT,
  };

  console.log(`${PREFIX} ✅ carregado — endpoint ${ENDPOINT()}`);
})();
