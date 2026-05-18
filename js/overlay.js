/**
 * BetBoom Auto Pattern — Overlay v2
 * Painel flutuante com:
 *  - Padrão detectado
 *  - Entrada sugerida
 *  - Status do bot
 *  - Status do iframe
 */

console.log('%c[BB-OVERLAY] versão COUNTDOWN-v3 carregada', 'color:#fbbf24;font-weight:bold;font-size:14px');

const Overlay = (() => {
  let container = null;
  let isMinimizado = false;
  let updateInterval = null;
  let ultimoSaldoKey = null;
  let ultimoResultadoKey = null;
  let ultimoEstadoKey = null;
  let ultimoWsKey = null;
  let ultimoLogKey = null;
  let ultimoDebugKey = null;
  let ultimaDecisaoRoundKey = null;
  let ultimoOperadorKey = null;
  let ultimoResumoEntradaKey = null;
  let decisaoArmada = null;
  let countdownTimer = null;
  let countdownSecondsLeft = 0;
  const COUNTDOWN_SEGUNDOS = 5;
  let apostasAcumuladas = { player: 0, banker: 0, tie: 0 };
  let historicoAnterior = [];

  const operatorState = {
    conectado: false,
    lendoJogo: false,
    prontoParaOperar: false
  };

  /**
   * Cria o HTML do overlay.
   */
  function criarHTML() {
    const div = document.createElement('div');
    div.id = 'bb-auto-overlay';
    div.innerHTML = `
      <div class="bb-header" id="bb-header">
        <span class="bb-title">🎯 Claudinho HITL</span>
        <div class="bb-header-btns">
          <button id="bb-btn-calibrate" class="bb-btn-sm" title="Ensina coords reais dos spots/fichas (faça 1x)" style="background:#9333ea;color:#fff;font-weight:600">🎯 CAL</button>
          <button id="bb-btn-pin" class="bb-btn-sm" title="Fixar/Desfixar Janela">📌</button>
          <button id="bb-btn-minimize" class="bb-btn-sm" title="Minimizar">−</button>
          <button id="bb-btn-close" class="bb-btn-sm" title="Fechar">×</button>
        </div>
      </div>
      <!-- BARRA DE CONTROLES RAPIDOS — Diego (18/05): stake, protecao, stop win,
           stop loss precisam estar no topo, sempre visiveis e editaveis.
           Sao "liberadores/bloqueadores" da extensao, precisam ter coerencia
           com a banca. Botao SUGERIR aplica proporcoes recomendadas. -->
      <div id="bb-quick-config-bar" style="display:flex;gap:4px;align-items:center;padding:6px 8px;background:linear-gradient(135deg,rgba(30,41,59,0.85),rgba(15,23,42,0.85));border-bottom:1px solid rgba(99,102,241,0.3);font-size:10px;flex-wrap:wrap;">
        <label style="display:flex;align-items:center;gap:3px;color:#cbd5e1;font-weight:700;" title="Stake da aposta — lista de fichas BetBoom">💵 STAKE
          <select id="bb-qc-stake" style="padding:3px 5px;background:rgba(15,23,42,0.9);color:#fff;border:1px solid rgba(99,102,241,0.4);border-radius:3px;font-weight:800;font-size:11px;cursor:pointer;">
            <option value="5">⚪ R$ 5</option>
            <option value="10">🩷 R$ 10</option>
            <option value="25">🔴 R$ 25</option>
            <option value="125">🟢 R$ 125</option>
            <option value="500">⚫ R$ 500</option>
            <option value="2500">🟣 R$ 2.5K</option>
            <option value="5000">🟡 R$ 5K</option>
            <option value="12000">🟠 R$ 12K+</option>
          </select>
        </label>
        <label style="display:flex;align-items:center;gap:3px;color:#cbd5e1;font-weight:700;" title="Protecao empate — '0 | Desprotegido' = sem protecao">🛡 PROT
          <select id="bb-qc-protvalor" style="padding:3px 5px;background:rgba(15,23,42,0.9);color:#fff;border:1px solid rgba(99,102,241,0.4);border-radius:3px;font-weight:800;font-size:11px;cursor:pointer;">
            <option value="0">🚫 0 | Desprotegido</option>
            <option value="5">⚪ Proteger com R$ 5</option>
            <option value="10">🩷 Proteger com R$ 10</option>
            <option value="25">🔴 Proteger com R$ 25</option>
            <option value="125">🟢 Proteger com R$ 125</option>
            <option value="500">⚫ Proteger com R$ 500</option>
            <option value="2500">🟣 Proteger com R$ 2.5K</option>
            <option value="5000">🟡 Proteger com R$ 5K</option>
            <option value="12000">🟠 Proteger com R$ 12K+</option>
          </select>
        </label>
        <label style="display:flex;align-items:center;gap:3px;color:#86efac;font-weight:700;" title="Para sessao ao atingir esse lucro">🎯 SW
          <input id="bb-qc-stopwin" type="number" min="1" step="1" value="1000" style="width:60px;padding:3px 5px;background:rgba(15,23,42,0.8);color:#86efac;border:1px solid rgba(34,197,94,0.4);border-radius:3px;font-weight:800;font-size:11px;text-align:right;">
        </label>
        <label style="display:flex;align-items:center;gap:3px;color:#fca5a5;font-weight:700;" title="Para sessao ao atingir essa perda">🛡 SL
          <input id="bb-qc-stoploss" type="number" min="1" step="1" value="500" style="width:60px;padding:3px 5px;background:rgba(15,23,42,0.8);color:#fca5a5;border:1px solid rgba(239,68,68,0.4);border-radius:3px;font-weight:800;font-size:11px;text-align:right;">
        </label>
        <button id="bb-btn-qc-apply" title="Aplica os valores ao bot" style="padding:4px 8px;background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;border:none;border-radius:3px;font-weight:800;cursor:pointer;font-size:10px;">✅ APLICAR</button>
        <button id="bb-btn-qc-suggest" title="Sugere valores proporcionais à banca atual (SW=20% banca, SL=30% banca)" style="padding:4px 8px;background:linear-gradient(135deg,#a855f7,#7c3aed);color:#fff;border:none;border-radius:3px;font-weight:800;cursor:pointer;font-size:10px;">💡 SUGERIR</button>
        <span id="bb-qc-status" style="margin-left:auto;color:#94a3b8;font-size:9px;font-style:italic;">aguardando…</span>
      </div>
      <!-- BARRA DE AÇÕES RÁPIDAS — atalhos pros 3 controles principais no topo -->
      <div id="bb-quick-actions-bar" style="display:flex;gap:6px;align-items:stretch;padding:6px 8px;background:linear-gradient(135deg, rgba(15,52,96,0.7), rgba(20,30,60,0.7));border-bottom:1px solid rgba(99,102,241,0.3);">
        <button id="bb-btn-quick-start" title="Liga o robô (mesmo que ▶ Iniciar)" style="flex:1;padding:8px 6px;background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;border:none;border-radius:6px;font-weight:800;font-size:11px;cursor:pointer;letter-spacing:0.3px;box-shadow:0 2px 6px rgba(22,163,74,0.4);">▶ INICIAR</button>
        <button id="bb-btn-quick-spots" title="Ir para Player / Tie / Banker (clique manual)" style="flex:1;padding:8px 6px;background:linear-gradient(135deg,#0284c7,#0369a1);color:#fff;border:none;border-radius:6px;font-weight:800;font-size:11px;cursor:pointer;letter-spacing:0.3px;box-shadow:0 2px 6px rgba(2,132,199,0.4);">🎰 SPOTS</button>
        <button id="bb-btn-quick-history" title="Ir para histórico de rodadas" style="flex:1;padding:8px 6px;background:linear-gradient(135deg,#9333ea,#7e22ce);color:#fff;border:none;border-radius:6px;font-weight:800;font-size:11px;cursor:pointer;letter-spacing:0.3px;box-shadow:0 2px 6px rgba(147,51,234,0.4);">📊 HISTÓRICO</button>
      </div>
      <!-- PRD item 6: PARAR GLOBAL — trava TODAS próximas decisões instantaneamente
           Atalho: Ctrl+Shift+K -->
      <div id="bb-parar-bar" style="display:flex;gap:8px;align-items:center;padding:8px 10px;background:rgba(220,38,38,0.12);border-bottom:2px solid rgba(220,38,38,0.4);">
        <span id="bb-parar-status" style="flex:1;color:#fca5a5;font-weight:800;font-size:11px;letter-spacing:0.5px;">🟢 OPERANDO — robô ativo</span>
        <button id="bb-btn-parar-global" style="padding:8px 16px;background:linear-gradient(135deg,#dc2626,#7f1d1d);color:#fff;border:none;border-radius:6px;font-weight:900;cursor:pointer;font-size:13px;box-shadow:0 3px 10px rgba(220,38,38,0.5);" title="Trava TUDO (atalho Ctrl+Shift+K)">🛑 PARAR (Ctrl+Shift+K)</button>
      </div>
      <!-- Barra de status do AUTO-START (Diego, 17/05): visivel no overlay
           porque mudancas que so saem em console nao contam como entregues. -->
      <div id="bb-autostart-bar" style="display:flex;gap:8px;align-items:center;padding:6px 10px;background:rgba(99,102,241,0.10);border-bottom:1px solid rgba(99,102,241,0.3);font-size:11px;">
        <span id="bb-autostart-icon" style="font-size:14px;">⏳</span>
        <span id="bb-autostart-label" style="flex:1;color:#c7d2fe;font-weight:700;letter-spacing:0.3px;">Auto-start: inicializando…</span>
        <span id="bb-autostart-hint" style="color:#94a3b8;font-size:9px;">v19-one-page</span>
      </div>
      <!-- Barra OPERACIONAL: calibracao + hit-rate de click + status WMSG -->
      <div id="bb-ops-bar" style="display:flex;gap:6px;align-items:center;padding:6px 10px;background:rgba(15,23,42,0.6);border-bottom:1px solid rgba(99,102,241,0.2);font-size:10px;flex-wrap:wrap;">
        <span id="bb-cal-badge" title="Status da calibracao da mesa" style="padding:3px 8px;background:rgba(251,191,36,0.15);border:1px solid rgba(251,191,36,0.4);border-radius:4px;color:#fbbf24;font-weight:700;">🎯 CAL: sem dado</span>
        <span id="bb-hit-badge" title="Taxa de sucesso dos cliques (saldo decrementa)" style="padding:3px 8px;background:rgba(148,163,184,0.15);border:1px solid rgba(148,163,184,0.4);border-radius:4px;color:#94a3b8;font-weight:700;">🎲 CLICKS: 0/0</span>
        <span id="bb-wmsg-badge" title="Ultimas 4 cores e match WMSG" style="flex:1;padding:3px 8px;background:rgba(99,102,241,0.15);border:1px solid rgba(99,102,241,0.4);border-radius:4px;color:#c7d2fe;font-weight:700;text-align:center;">📊 WMSG: aguardando 4+ cores</span>
        <button id="bb-btn-cal-now" title="Calibrar mesa agora (BBCalibrator.tudo())" style="padding:3px 8px;background:linear-gradient(135deg,#0ea5e9,#0284c7);color:#fff;border:none;border-radius:4px;font-weight:800;cursor:pointer;font-size:10px;">🎯 CAL</button>
        <button id="bb-btn-modo-teste" title="Alterna modo OBSERVACAO: bot decide mas nao clica" style="padding:3px 8px;background:linear-gradient(135deg,#475569,#334155);color:#fff;border:none;border-radius:4px;font-weight:800;cursor:pointer;font-size:10px;">🧪 OBSERVAR</button>
      </div>
      <!-- Barra SAFETY: P/L sessao, stop win, stop loss, banca (Diego, 18/05) -->
      <div id="bb-safety-bar" style="display:flex;gap:6px;align-items:center;padding:6px 10px;background:rgba(15,23,42,0.5);border-bottom:1px solid rgba(34,197,94,0.2);font-size:10px;flex-wrap:wrap;">
        <span id="bb-banca-badge" title="Banca atual" style="padding:3px 8px;background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.4);border-radius:4px;color:#86efac;font-weight:700;">💰 BANCA: R$ ?</span>
        <span id="bb-pl-badge" title="Lucro/Prejuizo da sessao" style="padding:3px 8px;background:rgba(148,163,184,0.12);border:1px solid rgba(148,163,184,0.4);border-radius:4px;color:#94a3b8;font-weight:700;">📈 P/L: R$ 0,00</span>
        <span id="bb-stopwin-badge" title="Stop Win: para sessao ao atingir esse lucro" style="padding:3px 8px;background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.4);border-radius:4px;color:#86efac;font-weight:700;">🎯 STOP WIN: R$ ?</span>
        <span id="bb-stoploss-badge" title="Stop Loss: para sessao ao atingir essa perda" style="padding:3px 8px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.4);border-radius:4px;color:#fca5a5;font-weight:700;">🛡 STOP LOSS: R$ ?</span>
        <span id="bb-origem-badge" title="Origem da ultima decisao — robo so aposta com 'wmsg'" style="flex:1;padding:3px 8px;background:rgba(99,102,241,0.12);border:1px solid rgba(99,102,241,0.4);border-radius:4px;color:#c7d2fe;font-weight:700;text-align:center;">🔒 ORIGEM: aguardando</span>
      </div>
      <!-- Banner MODO OBSERVACAO — destaque quando modoTeste=true (Diego, 18/05) -->
      <div id="bb-obs-banner" style="display:none;padding:8px 10px;background:linear-gradient(135deg,rgba(168,85,247,0.25),rgba(124,58,237,0.25));border-bottom:2px solid rgba(168,85,247,0.6);font-size:12px;color:#e9d5ff;font-weight:800;text-align:center;letter-spacing:0.5px;">
        🧪 MODO OBSERVAÇÃO ATIVO — robô decide e mostra tudo, mas NÃO clica (sem aposta real)
      </div>
      <div class="bb-confirm-bar">
        <div class="bb-countdown-wrap">
          <button class="bb-btn-confirm" id="bb-btn-confirm" disabled>⏳ AGUARDANDO INDICAÇÃO</button>
          <div class="bb-countdown-bar" id="bb-countdown-bar"></div>
        </div>
        <button class="bb-btn-cancel" id="bb-btn-cancel" hidden title="Cancela esta decisão (atalho ESC ou Ctrl+Shift+C)">❌ CANCELAR (ESC)</button>
      </div>
      <div class="bb-body bb-body-layout" id="bb-body">
        <!-- COLUNA ESQUERDA: Status e Decisão -->
        <div class="bb-col-left">
          <!-- PADRÃO DETECTADO + ENTRADA SUGERIDA (DESTAQUE) -->
          <div class="bb-section bb-decision-panel" id="bb-decision-section">
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px;">
            <div style="background:rgba(15,52,96,0.6); border:1px solid rgba(0,212,255,0.3); border-radius:8px; padding:8px;">
              <div class="bb-label" style="font-size:9px; color:#888;">Padrão Detectado</div>
              <div class="bb-value bb-pattern-name" id="bb-padrao" style="font-size:13px; color:#90caf9; margin-top:2px;">—</div>
              <div id="bb-confidence-bar-mini" style="width:100%; height:4px; background:#1e293b; border-radius:2px; margin-top:4px; overflow:hidden;">
                <div id="bb-confidence-bar" style="width:0%; height:100%; background:linear-gradient(90deg,#3b82f6,#10b981); transition:width 0.5s;"></div>
              </div>
              <div id="bb-confianca" style="font-size:9px; color:#94a3b8; text-align:right; margin-top:2px;">0%</div>
            </div>
            <div style="background:rgba(233,69,96,0.15); border:1px solid rgba(233,69,96,0.3); border-radius:8px; padding:8px;">
              <div class="bb-label" style="font-size:9px; color:#888;">Entrada Sugerida</div>
              <div class="bb-entry-display" id="bb-entrada" style="margin-top:2px;">
                <span class="bb-entry-color" id="bb-entrada-cor" style="font-size:24px; font-weight:800;">—</span>
              </div>
              <div class="bb-entry-gale" id="bb-entrada-gale" style="font-size:8px; color:#94a3b8; margin-top:3px; text-align:center;">—</div>
            </div>
          </div>
        </div>

        <!-- ABAS CONTEXTUAIS: Consensus, Conviction, Health, Graph Preview, Breakpoints -->
        <div class="bb-section bb-contextual-tabs" id="bb-contextual-tabs-section" style="padding:0; border-radius:8px; overflow:hidden;">
          <div class="bb-tabs-header" style="display:flex; gap:0; background:#1e293b; border-bottom:1px solid #334; border-radius:8px 8px 0 0;">
            <button class="bb-tab-btn bb-tab-active" data-tab="consensus" style="flex:1; padding:8px; font-size:10px; background:rgba(59,130,246,0.2); border:none; color:#90caf9; cursor:pointer; border-bottom:2px solid #60a5fa;">Consenso</button>
            <button class="bb-tab-btn" data-tab="conviction" style="flex:1; padding:8px; font-size:10px; background:transparent; border:none; color:#94a3b8; cursor:pointer; border-bottom:2px solid transparent;">Convicção</button>
            <button class="bb-tab-btn" data-tab="health" style="flex:1; padding:8px; font-size:10px; background:transparent; border:none; color:#94a3b8; cursor:pointer; border-bottom:2px solid transparent;">Saúde</button>
            <button class="bb-tab-btn" data-tab="graph" style="flex:1; padding:8px; font-size:10px; background:transparent; border:none; color:#94a3b8; cursor:pointer; border-bottom:2px solid transparent;">Grafo</button>
            <button class="bb-tab-btn" data-tab="breakpoints" style="flex:1; padding:8px; font-size:10px; background:transparent; border:none; color:#94a3b8; cursor:pointer; border-bottom:2px solid transparent;">Pausas</button>
          </div>

          <!-- TAB: CONSENSO -->
          <div class="bb-tab-content bb-tab-active" id="bb-tab-consensus" style="padding:10px 12px; background:rgba(15,30,50,0.6); display:block;">
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; font-size:9px;">
              <div style="background:rgba(59,130,246,0.15); padding:8px; border-radius:4px; border-left:3px solid #60a5fa;">
                <div style="color:#94a3b8;">Sinal Dominante</div>
                <div id="bb-consensus-signal" style="color:#60a5fa; font-weight:bold; margin-top:2px; font-size:11px;">—</div>
              </div>
              <div style="background:rgba(16,185,129,0.15); padding:8px; border-radius:4px; border-left:3px solid #10b981;">
                <div style="color:#94a3b8;">Acordo</div>
                <div id="bb-consensus-agreement" style="color:#10b981; font-weight:bold; margin-top:2px; font-size:11px;">—%</div>
              </div>
              <div style="background:rgba(245,158,11,0.15); padding:8px; border-radius:4px; border-left:3px solid #f59e0b; grid-column:1/-1;">
                <div style="color:#94a3b8;">Status do Consenso</div>
                <div id="bb-consensus-strength" style="color:#f59e0b; font-weight:bold; margin-top:2px; font-size:10px;">—</div>
              </div>
            </div>
          </div>

          <!-- TAB: CONVICÇÃO -->
          <div class="bb-tab-content" id="bb-tab-conviction" style="padding:10px 12px; background:rgba(15,30,50,0.6); display:none;">
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; font-size:9px;">
              <div style="background:rgba(168,85,247,0.15); padding:8px; border-radius:4px; border-left:3px solid #a855f7;">
                <div style="color:#94a3b8;">Nível</div>
                <div id="bb-conviction-level" style="color:#a855f7; font-weight:bold; margin-top:2px; font-size:11px;">—</div>
              </div>
              <div style="background:rgba(236,72,153,0.15); padding:8px; border-radius:4px; border-left:3px solid #ec4899;">
                <div style="color:#94a3b8;">Score</div>
                <div id="bb-conviction-score" style="color:#ec4899; font-weight:bold; margin-top:2px; font-size:11px;">—</div>
              </div>
              <div style="background:rgba(59,130,246,0.15); padding:8px; border-radius:4px; border-left:3px solid #3b82f6; grid-column:1/-1;">
                <div style="color:#94a3b8;">Recomendação</div>
                <div id="bb-conviction-recommendation" style="color:#3b82f6; font-weight:bold; margin-top:2px; font-size:9px;">—</div>
              </div>
            </div>
          </div>

          <!-- TAB: SAÚDE DO CONTEXTO -->
          <div class="bb-tab-content" id="bb-tab-health" style="padding:10px 12px; background:rgba(15,30,50,0.6); display:none;">
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; font-size:8px;">
              <div style="background:rgba(34,197,94,0.15); padding:6px; border-radius:3px;">
                <div style="color:#94a3b8;">Estabilidade</div>
                <div id="bb-health-stability" style="color:#22c55e; font-weight:bold;">—%</div>
              </div>
              <div style="background:rgba(239,68,68,0.15); padding:6px; border-radius:3px;">
                <div style="color:#94a3b8;">Volatilidade</div>
                <div id="bb-health-volatility" style="color:#ef4444; font-weight:bold;">—%</div>
              </div>
              <div style="background:rgba(249,115,22,0.15); padding:6px; border-radius:3px;">
                <div style="color:#94a3b8;">Entropia</div>
                <div id="bb-health-entropy" style="color:#f97316; font-weight:bold;">—%</div>
              </div>
              <div style="background:rgba(59,130,246,0.15); padding:6px; border-radius:3px;">
                <div style="color:#94a3b8;">Ruído</div>
                <div id="bb-health-noise" style="color:#3b82f6; font-weight:bold;">—%</div>
              </div>
              <div style="background:rgba(168,85,247,0.15); padding:6px; border-radius:3px; grid-column:1/-1;">
                <div style="color:#94a3b8;">Status</div>
                <div id="bb-health-status" style="color:#a855f7; font-weight:bold; font-size:9px;">—</div>
              </div>
            </div>
          </div>

          <!-- TAB: GRAFO DE DECISÃO -->
          <div class="bb-tab-content" id="bb-tab-graph" style="padding:10px 12px; background:rgba(15,30,50,0.6); display:none;">
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; font-size:9px;">
              <div style="background:rgba(59,130,246,0.15); padding:8px; border-radius:4px;">
                <div style="color:#94a3b8;">Nós Ativos</div>
                <div id="bb-graph-active-nodes" style="color:#60a5fa; font-weight:bold; margin-top:2px;">—</div>
              </div>
              <div style="background:rgba(34,197,94,0.15); padding:8px; border-radius:4px;">
                <div style="color:#94a3b8;">Caminho</div>
                <div id="bb-graph-causal-path" style="color:#22c55e; font-weight:bold; margin-top:2px; font-size:8px;">—</div>
              </div>
              <div style="background:rgba(245,158,11,0.15); padding:8px; border-radius:4px; grid-column:1/-1;">
                <div style="color:#94a3b8;">Status do Grafo</div>
                <div id="bb-graph-status" style="color:#f59e0b; font-weight:bold; margin-top:2px; font-size:9px;">—</div>
              </div>
            </div>
          </div>

          <!-- TAB: PONTOS DE PAUSA -->
          <div class="bb-tab-content" id="bb-tab-breakpoints" style="padding:10px 12px; background:rgba(15,30,50,0.6); display:none;">
            <div style="font-size:9px; color:#94a3b8;">
              <div style="padding:6px; background:rgba(239,68,68,0.15); border-radius:4px; margin-bottom:6px;">
                <span style="color:#ef4444; font-weight:bold;">Pausas Ativas:</span>
                <div id="bb-breakpoints-list" style="margin-top:3px; color:#cbd5e1;">—</div>
              </div>
            </div>
          </div>
        </div>

        <!-- HISTÓRICO COMPLETO (Tabuleiro) -->
        <div class="bb-section bb-history-board" id="bb-history-section" style="padding:8px 12px;">
          <div class="bb-label" style="font-size:9px; margin-bottom:6px; color:#888;">Histórico de Apostas</div>
          <div class="bb-tabuleiro" id="bb-tabuleiro"></div>
        </div>

        <!-- TEMPERATURA + SALDO RÁPIDO -->
        <div class="bb-section" id="bb-quick-info-section" style="display:grid; grid-template-columns:1fr 1fr; gap:8px; padding:8px 12px;">
          <div>
            <div class="bb-label" style="font-size:9px;">Temperatura</div>
            <div class="bb-value" id="bb-temperature" style="font-size:12px; margin-top:2px; font-weight:600;">—</div>
          </div>
          <div>
            <div class="bb-label" style="font-size:9px;">Saldo Real</div>
            <div class="bb-value bb-green" id="bb-saldo-real" style="font-size:12px; margin-top:2px; font-weight:600;">—</div>
          </div>
        </div>

        <!-- STATUS BOT & INFRAESTRUTURA (COMPACTO) -->
        <div class="bb-section bb-infra-compact" id="bb-infra-compact-section" style="display:grid; grid-template-columns:1fr 1fr; gap:8px; padding:8px 12px;">
          <div>
            <div class="bb-label" style="font-size:9px;">Status Bot</div>
            <div class="bb-status" id="bb-status" style="gap:6px; margin-top:4px;">
              <span class="bb-dot bb-dot-off" id="bb-dot"></span>
              <span id="bb-status-text" class="bb-small" style="font-size:11px;">Inativo</span>
            </div>
          </div>
          <div>
            <div class="bb-label" style="font-size:9px;">Jogo & WebSocket</div>
            <div style="margin-top:4px; font-size:10px;">
              <span class="bb-dot bb-dot-off" id="bb-iframe-dot"></span><span id="bb-iframe-text" style="margin-left:3px;">Iframe</span>
              <span class="bb-dot bb-dot-off" id="bb-ws-dot" style="margin-left:6px;"></span><span id="bb-ws-text" style="margin-left:3px;">WS</span>
            </div>
          </div>
        </div>
        </div><!-- FIM COLUNA ESQUERDA -->

        <!-- COLUNA DIREITA: Controles de Aposta (2x largura) -->
        <div class="bb-col-right">
        <!-- BANCADAS (PLAYER / TIE / BANKER) -->
        <div class="bb-section bb-bancadas-section" id="bb-bancadas-section" style="padding:10px 8px;">
          <div class="bb-bancadas-container">
            <button id="bb-btn-click-player" class="bb-bancada bb-bancada-player" title="Player">
              <div class="bb-bancada-label">PLAYER</div>
              <div class="bb-bancada-percentage" id="bb-percent-player">0%</div>
            </button>
            <button id="bb-btn-click-tie" class="bb-bancada bb-bancada-tie" title="Tie">
              <div class="bb-bancada-label">TIE</div>
              <div class="bb-bancada-percentage" id="bb-percent-tie">0%</div>
            </button>
            <button id="bb-btn-click-banker" class="bb-bancada bb-bancada-banker" title="Banker">
              <div class="bb-bancada-label">BANKER</div>
              <div class="bb-bancada-percentage" id="bb-percent-banker">0%</div>
            </button>
          </div>
        </div>

        <!-- APOSTAS ACUMULADAS -->
        <div class="bb-section" id="bb-apostas-pendentes-section" style="padding:8px 12px; background:rgba(20,20,30,0.6); border-top:1px solid #334; border-bottom:1px solid #334;">
          <div class="bb-label" style="font-size:9px; margin-bottom:6px; color:#94a3b8;">Apostas Pendentes</div>
          <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px; font-size:10px;">
            <div style="background:rgba(2,132,199,0.15); padding:6px; border-radius:4px; border:1px solid rgba(2,132,199,0.3); text-align:center;">
              <div style="color:#0284c7; font-weight:bold;" id="bb-aposta-player">R$ 0</div>
              <div style="color:#888; font-size:8px;">Player</div>
            </div>
            <div style="background:rgba(245,158,11,0.15); padding:6px; border-radius:4px; border:1px solid rgba(245,158,11,0.3); text-align:center;">
              <div style="color:#f59e0b; font-weight:bold;" id="bb-aposta-tie">R$ 0</div>
              <div style="color:#888; font-size:8px;">Tie</div>
            </div>
            <div style="background:rgba(220,38,38,0.15); padding:6px; border-radius:4px; border:1px solid rgba(220,38,38,0.3); text-align:center;">
              <div style="color:#dc2626; font-weight:bold;" id="bb-aposta-banker">R$ 0</div>
              <div style="color:#888; font-size:8px;">Banker</div>
            </div>
          </div>
          <button id="bb-btn-limpar-apostas" style="width:100%; margin-top:8px; padding:4px; font-size:9px; background:#334; color:#94a3b8; border:1px solid #555; border-radius:4px; cursor:pointer;">🗑️ Limpar Apostas</button>
        </div>

        <!-- SELETOR DE FICHA -->
        <div class="bb-section" id="bb-chip-section" style="padding:10px 12px;">
          <div class="bb-label" style="font-size:10px; margin-bottom:8px; color:#94a3b8;">Escolher Ficha</div>
          <div class="bb-chip-grid" id="bb-chip-selectors">
            <button class="bb-chip bb-chip-active" data-val="5" title="R$ 5"><div style="position:absolute;inset:4px;border-radius:50%;border:1px solid rgba(91,156,255,0.7);pointer-events:none;z-index:1;"></div><div style="position:absolute;inset:8px;border-radius:50%;border:1px solid rgba(15,30,79,0.6);pointer-events:none;z-index:2;"></div><span style="position:relative;z-index:10;">5</span></button>
            <button class="bb-chip" data-val="10" title="R$ 10"><div style="position:absolute;inset:4px;border-radius:50%;border:1px solid rgba(52,211,153,0.7);pointer-events:none;z-index:1;"></div><div style="position:absolute;inset:8px;border-radius:50%;border:1px solid rgba(4,120,87,0.6);pointer-events:none;z-index:2;"></div><span style="position:relative;z-index:10;">10</span></button>
            <button class="bb-chip" data-val="25" title="R$ 25"><div style="position:absolute;inset:4px;border-radius:50%;border:1px solid rgba(192,132,252,0.7);pointer-events:none;z-index:1;"></div><div style="position:absolute;inset:8px;border-radius:50%;border:1px solid rgba(91,33,182,0.6);pointer-events:none;z-index:2;"></div><span style="position:relative;z-index:10;">25</span></button>
            <button class="bb-chip" data-val="125" title="R$ 125"><div style="position:absolute;inset:4px;border-radius:50%;border:1px solid rgba(251,191,36,0.7);pointer-events:none;z-index:1;"></div><div style="position:absolute;inset:8px;border-radius:50%;border:1px solid rgba(146,64,14,0.6);pointer-events:none;z-index:2;"></div><span style="position:relative;z-index:10;">125</span></button>
            <button class="bb-chip" data-val="500" title="R$ 500"><div style="position:absolute;inset:4px;border-radius:50%;border:1px solid rgba(248,113,113,0.7);pointer-events:none;z-index:1;"></div><div style="position:absolute;inset:8px;border-radius:50%;border:1px solid rgba(153,27,27,0.6);pointer-events:none;z-index:2;"></div><span style="position:relative;z-index:10;">500</span></button>
            <button class="bb-chip" data-val="2500" title="R$ 2.500"><div style="position:absolute;inset:4px;border-radius:50%;border:1px solid rgba(167,139,250,0.7);pointer-events:none;z-index:1;"></div><div style="position:absolute;inset:8px;border-radius:50%;border:1px solid rgba(63,15,130,0.6);pointer-events:none;z-index:2;"></div><span style="position:relative;z-index:10;">2.5K</span></button>
            <button class="bb-chip" data-val="5000" title="R$ 5.000"><div style="position:absolute;inset:4px;border-radius:50%;border:1px solid rgba(247,213,122,0.7);pointer-events:none;z-index:1;"></div><div style="position:absolute;inset:8px;border-radius:50%;border:1px solid rgba(143,71,7,0.6);pointer-events:none;z-index:2;"></div><span style="position:relative;z-index:10;">5K</span></button>
            <button class="bb-chip" data-val="10000" title="R$ 10.000"><div style="position:absolute;inset:4px;border-radius:50%;border:1px solid rgba(251,146,60,0.7);pointer-events:none;z-index:1;"></div><div style="position:absolute;inset:8px;border-radius:50%;border:1px solid rgba(154,52,18,0.6);pointer-events:none;z-index:2;"></div><span style="position:relative;z-index:10;">10K</span></button>
            <button class="bb-chip" data-val="12000" title="R$ 12.000"><div style="position:absolute;inset:4px;border-radius:50%;border:1px solid rgba(251,191,36,0.7);pointer-events:none;z-index:1;"></div><div style="position:absolute;inset:8px;border-radius:50%;border:1px solid rgba(146,64,14,0.6);pointer-events:none;z-index:2;"></div><span style="position:relative;z-index:10;">12K</span></button>
          </div>
        </div>
        <!-- CONTROLES PRINCIPAIS -->
        <div class="bb-section bb-controls" id="bb-controls-section" style="padding:8px 12px;">
          <button id="bb-btn-start" class="bb-btn bb-btn-green" style="padding:8px; font-size:11px;">▶ Iniciar</button>
          <button id="bb-btn-pause" class="bb-btn bb-btn-yellow" style="display:none; padding:8px; font-size:11px;">⏸ Pausar</button>
          <button id="bb-btn-stop" class="bb-btn bb-btn-red" style="display:none; padding:8px; font-size:11px;">⏹ Parar</button>
        </div>
        </div><!-- FIM COLUNA DIREITA -->
      </div><!-- FIM BODY LAYOUT -->
    `;
    return div;
  }

  /**
   * Ativa/Desativa o indicador de Hardware Soberano.
   */
  function setHardwareStatus(isActive) {
    const el = document.getElementById('bb-hardware-status');
    if (el) {
      el.style.display = isActive ? 'inline-block' : 'none';
    }
  }

  /**
   * Torna o overlay arrastável.
   */
  function tornarArrastavel(element) {
    const header = element.querySelector('#bb-header');
    let isDragging = false;
    let offsetX, offsetY;

    header.addEventListener('mousedown', (e) => {
      if (header.dataset.pinned === 'true') return;
      if (e.target.tagName === 'BUTTON') return;
      isDragging = true;
      offsetX = e.clientX - element.getBoundingClientRect().left;
      offsetY = e.clientY - element.getBoundingClientRect().top;
      element.style.transition = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      element.style.left = (e.clientX - offsetX) + 'px';
      element.style.top = (e.clientY - offsetY) + 'px';
      element.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
      element.style.transition = '';
    });
  }

  /**
   * Permite que as seções (módulos) do overlay sejam ordenadas via Drag and Drop.
   */
  function tornarModulosReordenaveis() {
    const body = document.getElementById('bb-body');
    if (!body) return;

    let draggedItem = null;

    const sections = Array.from(body.querySelectorAll('.bb-section'));
    sections.forEach(section => {
      section.draggable = true;
      section.style.cursor = 'grab';
      section.style.position = 'relative';

      // Ícone visual de drag "⋮⋮"
      const handle = document.createElement('div');
      handle.innerHTML = '⋮⋮';
      handle.style.position = 'absolute';
      handle.style.top = '8px';
      handle.style.right = '10px';
      handle.style.color = '#475569';
      handle.style.fontSize = '14px';
      handle.style.lineHeight = '1';
      handle.style.display = 'flex';
      handle.style.letterSpacing = '-1px';
      handle.style.userSelect = 'none';
      handle.style.pointerEvents = 'none';
      section.appendChild(handle);

      // Feedback ao arrastar
      section.addEventListener('dragstart', function(e) {
        draggedItem = this;
        setTimeout(() => this.style.opacity = '0.4', 0);
        e.dataTransfer.effectAllowed = 'move';
      });

      section.addEventListener('dragend', function() {
        setTimeout(() => {
          this.style.opacity = '1';
          draggedItem = null;
          sections.forEach(s => s.style.borderTop = '');
          sections.forEach(s => s.style.borderBottom = '');
        }, 0);
      });

      section.addEventListener('dragover', function(e) {
        e.preventDefault(); 
        if (this === draggedItem) return;
        
        const rect = this.getBoundingClientRect();
        const y = e.clientY - rect.top;
        if (y < rect.height / 2) {
          this.style.borderTop = '2px dashed #94a3b8';
          this.style.borderBottom = '';
        } else {
          this.style.borderBottom = '2px dashed #94a3b8';
          this.style.borderTop = '';
        }
      });

      section.addEventListener('dragleave', function() {
        this.style.borderTop = '';
        this.style.borderBottom = '';
      });

      section.addEventListener('drop', function(e) {
        e.preventDefault();
        this.style.borderTop = '';
        this.style.borderBottom = '';
        if (this === draggedItem) return;

        const rect = this.getBoundingClientRect();
        const y = e.clientY - rect.top;
        if (y < rect.height / 2) {
          body.insertBefore(draggedItem, this);
        } else {
          body.insertBefore(draggedItem, this.nextSibling);
        }

        // Salvar a nova ordem
        salvarOrdemModulos();
      });
    });
  }

  function salvarOrdemModulos() {
    const body = document.getElementById('bb-body');
    if (!body) return;
    const ids = Array.from(body.querySelectorAll('.bb-section')).map(el => el.id).filter(id => id);
    try {
      localStorage.setItem('bb_layout_order', JSON.stringify(ids));
    } catch (e) {}
  }

  function restaurarOrdemModulos() {
    try {
      const saved = localStorage.getItem('bb_layout_order');
      if (!saved) return;
      const ids = JSON.parse(saved);
      const body = document.getElementById('bb-body');
      if (!body) return;

      ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) body.appendChild(el); // Move o bloco para o fim na ordem extraída
      });
    } catch (e) {}
  }

  let customSequence = [];

  function atualizarVisorSequencia() {
    const display = document.getElementById('bb-strat-sequence');
    if (!display) return;
    if (customSequence.length === 0) {
      display.innerHTML = '<span style="color:#475569">...</span>';
      return;
    }
    const htmlMap = {
      'player': '<span style="color:#4fc3f7">B</span>',
      'banker': '<span style="color:#ef9a9a">R</span>',
      'tie': '<span style="color:#a5d6a7">T</span>'
    };
    display.innerHTML = customSequence.map(c => htmlMap[c]).join(' ');
  }

  function carregarConfiguracoesAplicadas() {
    try {
      const saved = localStorage.getItem('bb_user_config');
      if (saved) {
        const c = JSON.parse(saved);
        const modeSel = document.getElementById('bb-cfg-mode');
        const stakeInput = document.getElementById('bb-cfg-stake');
        const galesSel = document.getElementById('bb-cfg-gales');
        const empateSel = document.getElementById('bb-cfg-empate');
        const winInput = document.getElementById('bb-cfg-stopwin');
        const lossInput = document.getElementById('bb-cfg-stoploss');
        
        if (modeSel && c.modo) modeSel.value = c.modo;
        if (stakeInput && c.stake) stakeInput.value = c.stake;
        if (galesSel && c.gales !== undefined) galesSel.value = c.gales;
        if (empateSel && c.empate !== undefined) empateSel.value = c.empate;
        if (winInput && c.stopWin) winInput.value = c.stopWin;
        if (lossInput && c.stopLoss) lossInput.value = c.stopLoss;

        aplicarConfigAoMotor(c);
      }
    } catch(e) {}
  }

  function aplicarConfigAoMotor(c) {
    if (typeof CONFIG === 'undefined') return;
    CONFIG.modoDeUso = c.modo || 'semi';
    CONFIG.stakeBase = Number(c.stake) || 5;
    CONFIG.maxGales = Number(c.gales) || 0;
    CONFIG.protegerEmpateGlobal = c.empate == "1";
    CONFIG.stopWin = Number(c.stopWin) || 1000;
    CONFIG.stopLoss = Number(c.stopLoss) || 100;
    addLog(`Configs Aplicadas: ${c.modo.toUpperCase()} | G${c.gales} | R$${c.stake}`, 'info');
  }

  /**
   * Troca entre abas contextuais.
   */
  function alternarAba(tabName) {
    const buttons = document.querySelectorAll('.bb-tab-btn');
    const contents = document.querySelectorAll('.bb-tab-content');

    buttons.forEach(btn => {
      if (btn.dataset.tab === tabName) {
        btn.classList.add('bb-tab-active');
        btn.style.background = 'rgba(59,130,246,0.2)';
        btn.style.borderBottomColor = '#60a5fa';
        btn.style.color = '#90caf9';
      } else {
        btn.classList.remove('bb-tab-active');
        btn.style.background = 'transparent';
        btn.style.borderBottomColor = 'transparent';
        btn.style.color = '#94a3b8';
      }
    });

    contents.forEach(content => {
      if (content.id === `bb-tab-${tabName}`) {
        content.classList.add('bb-tab-active');
        content.style.display = 'block';
      } else {
        content.classList.remove('bb-tab-active');
        content.style.display = 'none';
      }
    });
  }

  /**
   * Atualiza dados da aba Consenso.
   */
  function atualizarAbaConsensus() {
    if (typeof ConsensusEngine === 'undefined') return;

    const consensusStats = ConsensusEngine.getConsensusStats?.() || {};
    const ultimoConsensus = consensusStats.ultimoConsensus || {};

    const signalEl = document.getElementById('bb-consensus-signal');
    const agreementEl = document.getElementById('bb-consensus-agreement');
    const strengthEl = document.getElementById('bb-consensus-strength');

    if (signalEl) signalEl.textContent = ultimoConsensus.dominantSignal || '—';
    if (agreementEl) agreementEl.textContent = `${Math.round(ultimoConsensus.agreementScore || 0)}%`;

    if (strengthEl) {
      const strength = ultimoConsensus.consensusStrength || 'WEAK';
      const corForte = strength === 'STRONG' ? '#10b981' : (strength === 'MODERATE' ? '#f59e0b' : '#ef4444');
      strengthEl.textContent = strength;
      strengthEl.style.color = corForte;
    }
  }

  /**
   * Atualiza dados da aba Convicção.
   */
  function atualizarAbaConviction() {
    if (typeof ConvictionEngine === 'undefined') return;

    const conviction = ConvictionEngine.getLastConvictionRecord?.() || {};
    const levelEl = document.getElementById('bb-conviction-level');
    const scoreEl = document.getElementById('bb-conviction-score');
    const recEl = document.getElementById('bb-conviction-recommendation');

    if (levelEl) {
      const level = conviction.executionReadiness || 'BLOCKED';
      const corLevel = level === 'READY' ? '#22c55e' : (level === 'CAUTION' ? '#f59e0b' : (level === 'HESITANT' ? '#ec4899' : '#ef4444'));
      levelEl.textContent = level;
      levelEl.style.color = corLevel;
    }

    if (scoreEl) {
      scoreEl.textContent = `${Math.round(conviction.conviction || 0)}%`;
    }

    if (recEl) {
      recEl.textContent = conviction.recommendation || '—';
    }
  }

  /**
   * Atualiza dados da aba Saúde.
   */
  function atualizarAbaSaude() {
    if (typeof ContextHealthEngine === 'undefined') return;

    const healthStats = ContextHealthEngine.getHealthStats?.() || {};

    const stabilityEl = document.getElementById('bb-health-stability');
    const volatilityEl = document.getElementById('bb-health-volatility');
    const entropyEl = document.getElementById('bb-health-entropy');
    const noiseEl = document.getElementById('bb-health-noise');
    const statusEl = document.getElementById('bb-health-status');

    if (stabilityEl) stabilityEl.textContent = `${healthStats.avgStability || 0}%`;
    if (volatilityEl) volatilityEl.textContent = `${healthStats.avgVolatility || 0}%`;
    if (entropyEl) entropyEl.textContent = `${healthStats.avgEntropy || 0}%`;
    if (noiseEl) noiseEl.textContent = `${50}%`;

    if (statusEl) {
      const status = healthStats.criticalRounds > 0 ? 'CRÍTICO' : (healthStats.warningRounds > 0 ? 'AVISO' : 'OK');
      const corStatus = status === 'CRÍTICO' ? '#ef4444' : (status === 'AVISO' ? '#f59e0b' : '#22c55e');
      statusEl.textContent = status;
      statusEl.style.color = corStatus;
    }
  }

  /**
   * Atualiza dados da aba Grafo.
   */
  function atualizarAbaGrafo() {
    if (typeof DecisionGraphEngine === 'undefined') return;

    const graphs = DecisionGraphEngine.getRecentGraphs?.(1) || [];
    const grafo = graphs[0];

    if (!grafo) {
      document.getElementById('bb-graph-active-nodes').textContent = '—';
      document.getElementById('bb-graph-causal-path').textContent = '—';
      document.getElementById('bb-graph-status').textContent = 'Sem grafo';
      return;
    }

    const nodesEl = document.getElementById('bb-graph-active-nodes');
    const pathEl = document.getElementById('bb-graph-causal-path');
    const statusEl = document.getElementById('bb-graph-status');

    const activeNodes = grafo.nodes.filter(n => n.status !== 'skipped').length;
    if (nodesEl) nodesEl.textContent = `${activeNodes}/${grafo.nodes.length}`;

    if (pathEl) {
      const path = DecisionGraphEngine.getCausalPath?.(grafo.id) || [];
      const pathStr = path.slice(0, 3).join(' → ');
      pathEl.textContent = pathStr || '—';
    }

    if (statusEl) {
      const failedCount = grafo.nodes.filter(n => n.status === 'failed').length;
      const warningCount = grafo.nodes.filter(n => n.status === 'warning').length;
      const status = failedCount > 0 ? 'ERRO' : (warningCount > 0 ? 'AVISO' : 'OK');
      const corStatus = status === 'ERRO' ? '#ef4444' : (status === 'AVISO' ? '#f59e0b' : '#22c55e');
      statusEl.textContent = status;
      statusEl.style.color = corStatus;
    }
  }

  /**
   * Atualiza dados da aba Pausas.
   */
  function atualizarAbaBreakpoints() {
    const breakpointsEl = document.getElementById('bb-breakpoints-list');
    if (!breakpointsEl) return;

    // Placeholder - será expandido com BreakpointEngine
    breakpointsEl.textContent = '(Sistema de pausas em desenvolvimento)';
  }

  /**
   * Vincula eventos dos botões.
   */
  function vincularEventos() {
    // Tab Switching
    const tabBtns = document.querySelectorAll('.bb-tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tabName = btn.dataset.tab;
        alternarAba(tabName);
        atualizarAbaConsensus();
        atualizarAbaConviction();
        atualizarAbaSaude();
        atualizarAbaGrafo();
        atualizarAbaBreakpoints();
      });
    });

    // Pin Control
    const pinBtn = document.getElementById('bb-btn-pin');
    let isPinned = false;
    if (pinBtn) {
      pinBtn.addEventListener('click', () => {
        isPinned = !isPinned;
        pinBtn.style.color = isPinned ? '#00e676' : '#aaa';
        const header = document.getElementById('bb-header');
        if (header) {
          header.style.cursor = isPinned ? 'default' : 'move';
          header.dataset.pinned = isPinned ? 'true' : 'false';
        }
      });
    }

    // Save Config Control
    const saveCfgBtn = document.getElementById('bb-btn-save-config');
    if (saveCfgBtn) {
      saveCfgBtn.addEventListener('click', () => {
        const c = {
          modo: document.getElementById('bb-cfg-mode').value,
          stake: document.getElementById('bb-cfg-stake').value,
          gales: document.getElementById('bb-cfg-gales').value,
          empate: document.getElementById('bb-cfg-empate').value,
          stopWin: document.getElementById('bb-cfg-stopwin').value,
          stopLoss: document.getElementById('bb-cfg-stoploss').value
        };
        try {
          localStorage.setItem('bb_user_config', JSON.stringify(c));
          aplicarConfigAoMotor(c);
          addLog('Configurações salvas e aplicadas!', 'success');
        } catch(e) {}
      });
    }

    // Reset Layout
    const resetBtn = document.getElementById('bb-btn-reset-layout');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        localStorage.removeItem('bb_layout_order');
        addLog('Layout resetado. Atualize a página.', 'info');
        window.location.reload();
      });
    }

    // Criador de Padrão
    document.querySelectorAll('.bb-strat-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const color = e.currentTarget.getAttribute('data-color');
        if (customSequence.length < 10) {
           customSequence.push(color);
           atualizarVisorSequencia();
        }
      });
    });

    const stratClearBtn = document.getElementById('bb-strat-clear');
    if (stratClearBtn) {
      stratClearBtn.addEventListener('click', () => {
        customSequence = [];
        atualizarVisorSequencia();
      });
    }

    const stratApplyBtn = document.getElementById('bb-strat-apply');
    if (stratApplyBtn) {
      stratApplyBtn.addEventListener('click', () => {
        if (customSequence.length === 0) return;
        const targetEl = document.getElementById('bb-strat-target');
        const targetColor = targetEl.value;
        const confText = document.getElementById('bb-custom-status');

        const novaEstrategia = {
          nome: "Pattern Customizado User",
          source: "user",
          sequenceBase: [...customSequence],
          entradaEsperada: targetColor,
          protecaoEmpate: true,
          limiteGale: 2,
          obrigatorioAguardar: false,
          prioridade: 100 // Altíssima prioridade se ativa
        };

        // Injeta globalmente caso haja um interceptor
        window.BB_CUSTOM_STRATEGY = novaEstrategia;
        if (confText) {
           confText.textContent = 'Ativo (Injetado)';
           confText.style.color = '#00e676';
        }
        addLog(`Padrão Custom [${customSequence.join('-')}] -> ${targetColor} ativado!`, 'success');
      });
    }

    const minimizeBtn = document.getElementById('bb-btn-minimize');
    if (minimizeBtn) {
      minimizeBtn.addEventListener('click', () => {
        const body = document.getElementById('bb-body');
        isMinimizado = !isMinimizado;
        body.style.display = isMinimizado ? 'none' : 'block';
        minimizeBtn.textContent = isMinimizado ? '+' : '−';
      });
    } else {
      console.warn('[OverlayBindSkipped] bb-btn-minimize não encontrado');
    }

    const closeBtn = document.getElementById('bb-btn-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        if (container) container.style.display = 'none';
      });
    } else {
      console.warn('[OverlayBindSkipped] bb-btn-close não encontrado');
    }

    // ═══════════ PRD: Calibração + Parar Global + Atalhos ═══════════
    // PRD item 4: botão 🎯 CAL — chama BBCalibrator.tudo() para ensinar coords reais.
    // BBCalibrator.tudo() está no MAIN world (calibrator-main.js), mas este handler
    // roda no ISOLATED world do content script → não vê window.BBCalibrator do MAIN.
    //
    // Fix: injetar um <script> inline na página, que executa no MAIN world e
    // chama BBCalibrator.tudo() lá. Comunicação de volta via postMessage / log.
    const calibrateBtn = document.getElementById('bb-btn-calibrate');
    if (calibrateBtn) {
      calibrateBtn.addEventListener('click', () => {
        addLog('🎯 Calibração iniciada — siga as instruções do console (F12) e clique nos alvos', 'info');
        console.log('[CAL] 🎯 Injetando script no MAIN world para chamar BBCalibrator.tudo()...');
        try {
          // Injeta um script inline que roda no MAIN world (page context).
          // No MAIN world ele tem acesso a window.BBCalibrator.tudo().
          const script = document.createElement('script');
          script.textContent = `
            (async () => {
              try {
                if (typeof window.BBCalibrator === 'undefined' || typeof window.BBCalibrator.tudo !== 'function') {
                  console.error('[CAL] window.BBCalibrator.tudo() NÃO existe no MAIN world.');
                  return;
                }
                console.log('[CAL] ▶ chamando BBCalibrator.tudo() — siga as instruções abaixo');
                const r = await window.BBCalibrator.tudo();
                console.log('[CAL] ✅ Calibração concluída:', r);
                // Sinaliza pra o isolated world via postMessage
                window.postMessage({ source: 'bb-cal-result', ok: true, data: r }, '*');
              } catch (e) {
                console.error('[CAL] erro:', e);
                window.postMessage({ source: 'bb-cal-result', ok: false, error: String(e?.message || e) }, '*');
              }
            })();
          `;
          (document.head || document.documentElement).appendChild(script);
          script.remove();
        } catch (e) {
          addLog(`❌ Falha ao injetar script de calibração: ${e?.message || e}`, 'error');
          console.warn('[CAL] erro injeção:', e);
        }
      });
      // Escuta a resposta vinda do MAIN world via postMessage
      window.addEventListener('message', (ev) => {
        if (ev.data?.source === 'bb-cal-result') {
          if (ev.data.ok) {
            addLog('✅ Calibração concluída — coords salvas em localStorage', 'success');
          } else {
            addLog(`❌ Calibração falhou: ${ev.data.error || '?'}`, 'error');
          }
        }
      });
    }

    // PRD item 6: botão 🛑 PARAR GLOBAL + atalhos (Ctrl+Shift+K) ⏯️
    function refreshParadaUI() {
      const btn = document.getElementById('bb-btn-parar-global');
      const status = document.getElementById('bb-parar-status');
      const bar = document.getElementById('bb-parar-bar');
      if (!btn || !status || !bar) return;
      if (CONFIG.paradaGlobal === true) {
        btn.textContent = '▶ RETOMAR (Ctrl+Shift+K)';
        btn.style.background = 'linear-gradient(135deg,#16a34a,#15803d)';
        btn.style.boxShadow = '0 3px 10px rgba(22,163,74,0.6)';
        status.textContent = '🛑 PARADO — nenhum clique vai disparar';
        status.style.color = '#fde68a';
        bar.style.background = 'rgba(251,191,36,0.18)';
        bar.style.borderBottom = '2px solid rgba(251,191,36,0.5)';
      } else {
        btn.textContent = '🛑 PARAR (Ctrl+Shift+K)';
        btn.style.background = 'linear-gradient(135deg,#dc2626,#7f1d1d)';
        btn.style.boxShadow = '0 3px 10px rgba(220,38,38,0.5)';
        status.textContent = '🟢 OPERANDO — robô ativo';
        status.style.color = '#fca5a5';
        bar.style.background = 'rgba(220,38,38,0.12)';
        bar.style.borderBottom = '2px solid rgba(220,38,38,0.4)';
      }
    }
    // Expõe pra dentro do _dispararExecucaoDecisao usar quando saldo anômalo dispara parada
    try { window.__refreshParadaUI = refreshParadaUI; } catch (_) {}
    function toggleParadaGlobal(origem) {
      CONFIG.paradaGlobal = !CONFIG.paradaGlobal;
      const status = CONFIG.paradaGlobal ? '🛑 PARADO' : '▶ RETOMADO';
      console.log(`%c[PARAR-GLOBAL] ${status} via ${origem}`,
        `color:${CONFIG.paradaGlobal ? '#fbbf24' : '#22c55e'};font-size:16px;font-weight:900`);
      addLog(`${status} via ${origem}`, CONFIG.paradaGlobal ? 'warn' : 'success');
      refreshParadaUI();
      // Ao parar, descarta decisão em curso (countdown ativo)
      if (CONFIG.paradaGlobal === true) {
        try { cancelarCountdown(); } catch (_) {}
        if (decisaoArmada && !decisaoArmada.executando) {
          limparDecisaoArmada('PARAR GLOBAL acionado');
        }
      }
    }
    const pararBtn = document.getElementById('bb-btn-parar-global');
    if (pararBtn) pararBtn.addEventListener('click', () => toggleParadaGlobal('botão'));
    refreshParadaUI();

    // PRD item 3 + 6: atalhos de teclado globais
    //   ESC ou Ctrl+Shift+C → CANCELAR decisão corrente
    //   Ctrl+Shift+K        → PARAR GLOBAL (toggle)
    function cancelarDecisaoCorrente(origem) {
      if (!decisaoArmada) return;
      try { cancelarCountdown(); } catch (_) {}
      limparDecisaoArmada(`❌ Cancelado pelo operador (${origem})`);
      console.log(`%c[HITL] ❌ Decisão cancelada via ${origem}`, 'color:#fbbf24;font-weight:bold');
      addLog(`❌ Cancelado pelo operador (${origem})`, 'warn');
    }
    window.addEventListener('keydown', (ev) => {
      // Ctrl+Shift+K → PARAR GLOBAL
      if (ev.ctrlKey && ev.shiftKey && (ev.code === 'KeyK' || ev.key === 'K' || ev.key === 'k')) {
        ev.preventDefault();
        ev.stopPropagation();
        toggleParadaGlobal('Ctrl+Shift+K');
        return;
      }
      // Ctrl+Shift+C → CANCELAR decisão corrente
      if (ev.ctrlKey && ev.shiftKey && (ev.code === 'KeyC' || ev.key === 'C' || ev.key === 'c')) {
        ev.preventDefault();
        ev.stopPropagation();
        cancelarDecisaoCorrente('Ctrl+Shift+C');
        return;
      }
      // ESC → CANCELAR decisão corrente (apenas se há decisão armada — não engole ESC global)
      if (ev.code === 'Escape' && decisaoArmada && !ev.repeat) {
        ev.preventDefault();
        ev.stopPropagation();
        cancelarDecisaoCorrente('ESC');
      }
    }, true);
    console.log('[Claudinho] Atalhos ativos: ESC ou Ctrl+Shift+C = cancelar | Ctrl+Shift+K = parar global');

    // ═══════════ BARRA DE AÇÕES RÁPIDAS (▶ INICIAR | 🎰 SPOTS | 📊 HISTÓRICO) ═══════════
    // Pequena helper pra dar feedback visual quando rolar pra uma seção.
    function destacarSecao(id) {
      const el = document.getElementById(id);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // flash de borda pra mostrar onde caiu o foco
      const corOriginal = el.style.boxShadow;
      el.style.transition = 'box-shadow 0.4s ease';
      el.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.7), 0 0 24px rgba(99,102,241,0.5)';
      setTimeout(() => { el.style.boxShadow = corOriginal || ''; }, 1200);
    }
    // ▶ INICIAR — chama iniciarBot() direto (replicando o handler do bb-btn-start)
    // Antes delegava via realBtn.click() — funcionava em teoria, falhava na prática.
    // Direto é menos camada e mais previsível.
    const quickStartBtn = document.getElementById('bb-btn-quick-start');
    if (quickStartBtn) {
      quickStartBtn.addEventListener('click', () => {
        const mode = quickStartBtn.dataset.mode || 'start';
        console.log(`[QUICK-START] 🟢 botão clicado | mode=${mode} | modoPassivo=${CONFIG.modoPassivo} | DecisionEngine.isAtivo=${typeof DecisionEngine !== 'undefined' ? DecisionEngine.getState?.()?.isAtivo : '?'}`);
        // MODO REINICIAR — bot ja esta rodando, faz para+inicia limpo
        if (mode === 'restart') {
          try {
            reiniciarBot();
          } catch (e) {
            console.error('[QUICK-START] Erro ao reiniciar:', e);
            addLog(`❌ Erro ao reiniciar: ${e?.message || e}`, 'error');
          }
          return;
        }
        // MODO INICIAR — bot parado, vai ligar
        // Modo passivo bloqueia (mesmo guard do botão original)
        if (CONFIG.modoPassivo) {
          addLog('⚠ Modo passivo — jogo não detectado ainda. Espere o iframe Evolution carregar.', 'error');
          console.warn('[QUICK-START] ABORT: modoPassivo=true');
          return;
        }
        // Chamada direta — sem delegação via .click()
        try {
          iniciarBot();
          addLog('▶ Bot iniciado via barra rápida', 'success');
        } catch (e) {
          console.error('[QUICK-START] Erro ao iniciar:', e);
          addLog(`❌ Erro ao iniciar: ${e?.message || e}`, 'error');
        }
      });
    }
    // 🎰 SPOTS — rola pra seção das bancadas (Player/Tie/Banker)
    const quickSpotsBtn = document.getElementById('bb-btn-quick-spots');
    if (quickSpotsBtn) {
      quickSpotsBtn.addEventListener('click', () => destacarSecao('bb-bancadas-section'));
    }
    // 📊 HISTÓRICO — rola pra seção do tabuleiro
    const quickHistoryBtn = document.getElementById('bb-btn-quick-history');
    if (quickHistoryBtn) {
      quickHistoryBtn.addEventListener('click', () => destacarSecao('bb-history-section'));
    }

    const startBtn = document.getElementById('bb-btn-start');
    if (startBtn) {
      startBtn.addEventListener('click', () => {
        if (CONFIG.modoPassivo) {
          addLog('Modo passivo — jogo não detectado', 'error');
          return;
        }
        iniciarBot();
      });
    } else {
      console.warn('[OverlayBindSkipped] bb-btn-start não encontrado');
    }

    const pauseBtn = document.getElementById('bb-btn-pause');
    if (pauseBtn) {
      pauseBtn.addEventListener('click', () => {
        pausarBot();
      });
    } else {
      console.warn('[OverlayBindSkipped] bb-btn-pause não encontrado');
    }

    const stopBtn = document.getElementById('bb-btn-stop');
    if (stopBtn) {
      stopBtn.addEventListener('click', () => {
        pararBot();
      });
    } else {
      console.warn('[OverlayBindSkipped] bb-btn-stop não encontrado');
    }

    // Função para atualizar exibição de apostas acumuladas
    function atualizarExibicaoApostas() {
      const player = document.getElementById('bb-aposta-player');
      const tie = document.getElementById('bb-aposta-tie');
      const banker = document.getElementById('bb-aposta-banker');

      if (player) player.textContent = `R$ ${apostasAcumuladas.player}`;
      if (tie) tie.textContent = `R$ ${apostasAcumuladas.tie}`;
      if (banker) banker.textContent = `R$ ${apostasAcumuladas.banker}`;
    }

    // Botões de clique calibrado (acumula apostas)
    ['player', 'banker', 'tie'].forEach(alvo => {
      const btn = document.getElementById(`bb-btn-click-${alvo}`);
      if (!btn) return;
      btn.addEventListener('click', () => {
        let selectedChip = 5;
        document.querySelectorAll('.bb-chip').forEach(b => {
          if (b.classList.contains('active')) {
            selectedChip = parseInt(b.getAttribute('data-val'), 10);
          }
        });

        apostasAcumuladas[alvo] += selectedChip;
        atualizarExibicaoApostas();

        const labels = { player: 'PLAYER', banker: 'BANKER', tie: 'TIE' };
        addLog(`✅ +R$ ${selectedChip} em ${labels[alvo]} (Total: R$ ${apostasAcumuladas[alvo]})`, 'info');
      });
    });

    // Botão para limpar apostas acumuladas
    const limparBtn = document.getElementById('bb-btn-limpar-apostas');
    if (limparBtn) {
      limparBtn.addEventListener('click', () => {
        apostasAcumuladas = { player: 0, banker: 0, tie: 0 };
        atualizarExibicaoApostas();
        addLog('🗑️ Apostas acumuladas limpas', 'warning');
      });
    }

    // Fichas
    document.querySelectorAll('.bb-chip').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.bb-chip').forEach(b => b.classList.remove('active', 'bb-chip-active'));
        const target = e.currentTarget;
        target.classList.add('active', 'bb-chip-active');
      });
    });

    // Botão CANCELAR — aborta a decisão armada
    const cancelBtn = document.getElementById('bb-btn-cancel');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        if (decisaoArmada) {
          limparDecisaoArmada('❌ Entrada cancelada pelo operador');
          addLog('Operador cancelou a indicação', 'warn');
        }
      });
    }

    // Botão de confirmação de aposta (envia todas as apostas acumuladas)
    const confirmBtn = document.getElementById('bb-btn-confirm');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        // Decisão armada + countdown ativo → operador confirmou ANTES do timer
        if (countdownTimer !== null && decisaoArmada) {
          addLog('✅ Confirmado pelo operador (antes do countdown)', 'success');
          cancelarCountdown();
          _dispararExecucaoDecisao('confirmacao-manual');
          return;
        }

        const temApostas = apostasAcumuladas.player > 0 || apostasAcumuladas.banker > 0 || apostasAcumuladas.tie > 0;

        if (!temApostas) {
          addLog('⚠️ Nenhuma aposta acumulada', 'warning');
          return;
        }

        const total = apostasAcumuladas.player + apostasAcumuladas.banker + apostasAcumuladas.tie;
        addLog(`📤 Enviando apostas: Player R$${apostasAcumuladas.player} + Tie R$${apostasAcumuladas.tie} + Banker R$${apostasAcumuladas.banker} = R$${total}`, 'info');

        if (typeof window.BB_CONFIRM_MULTIPLE === 'function') {
          window.BB_CONFIRM_MULTIPLE(apostasAcumuladas);
        } else if (typeof window.BB_CONFIRM === 'function') {
          window.BB_CONFIRM();
        } else {
          addLog('✅ Confirmação de apostas múltiplas acionada', 'success');
        }

        apostasAcumuladas = { player: 0, banker: 0, tie: 0 };
        atualizarExibicaoApostas();
      });
    }
  }

  function escapeHtml(value) {
    return String(value ?? '—')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function getOrigemLabel(origem) {
    if (origem === 'will-default') return 'Will';
    if (origem === 'user') return 'Usuário';
    return origem || 'Sistema';
  }

  function getHistoricoCores(historico) {
    return Array.isArray(historico)
      ? historico.slice(-12).map((item) => item?.cor).filter(Boolean)
      : [];
  }

  function formatCurrency(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '—';
    return `R$ ${numeric.toFixed(2)}`;
  }

  function getObservabilitySnapshot() {
    if (typeof ObservabilityEngine === 'undefined' || !ObservabilityEngine.getSnapshot) return null;
    try {
      return ObservabilityEngine.getSnapshot();
    } catch (error) {
      Logger.warn('Falha ao obter snapshot de observabilidade:', error?.message || error);
      return null;
    }
  }

  function getTemperatureLabel(temperatura) {
    if (temperatura === 'hot') return '🟢 HOT / pode ir';
    if (temperatura === 'warm') return '🟡 Atenção / cautela';
    if (temperatura === 'cold') return '🔴 Não vá';
    if (temperatura === 'verde') return '🟢 HOT / pode ir';
    if (temperatura === 'amarelo') return '🟡 Atenção / cautela';
    if (temperatura === 'vermelho') return '🔴 Não vá';
    return '—';
  }

  function mapCanonicalTemperature(temperatura) {
    if (temperatura === 'verde') return 'hot';
    if (temperatura === 'amarelo') return 'warm';
    if (temperatura === 'vermelho') return 'cold';
    return temperatura || null;
  }

  function getDecisionModel(decisao) {
    return decisao?.decisionModel || decisao?.analytics?.decision?.canonical || null;
  }

  function getDecisionRoundKey(novos, historico) {
    const ultimo = (Array.isArray(novos) && novos.length > 0)
      ? novos[novos.length - 1]
      : (Array.isArray(historico) && historico.length > 0 ? historico[historico.length - 1] : null);

    if (ultimo?.signature) return ultimo.signature;
    return `${CONFIG.roundIdAtual || 'sem-round'}:${ultimo?.rodada || Collector.getRodadaAtual() || 0}`;
  }

  function validarCorrespondenciaEstrategia(strategy, history) {
    if (!strategy || !Array.isArray(history) || history.length === 0) return false;

    const matcherType = strategy.matcherType || 'exact-sequence';
    const normalizedEntry = BBStrategyUtils.normalizeCor(strategy.entradaEsperada || strategy.acao);

    // Se é um padrão dinâmico da biblioteca interna (sem sequenceBase fixa), 
    // confiamos na detecção já realizada pelo PatternEngine.
    if (!strategy.sequenceBase && strategy.nome) {
      return true;
    }

    if (matcherType === 'dominant-last-4') {
      const ultimas = history.slice(-4).filter((cor) => cor !== 'empate');
      return ultimas.length >= 3 && ultimas.filter((cor) => cor === normalizedEntry).length >= 3;
    }

    const sequence = BBStrategyUtils.normalizeSequenceBase(strategy.sequenceBase);
    if (!sequence.length) return true; // Confiamos no motor se não houver sequência definida
    if (history.length < sequence.length) return false;

    const ultimas = history.slice(-sequence.length);
    return sequence.every((cor, index) => ultimas[index] === cor);
  }

  function validarDecisao(decisao, historico) {
    const strategy = decisao?.padrao || null;
    const history = getHistoricoCores(historico);
    const erros = [];

    if (!strategy) {
      erros.push('Decisão sem estratégia/padrão vinculado.');
      return { ok: false, erros };
    }

    if (!validarCorrespondenciaEstrategia(strategy, history)) {
      erros.push('Estratégia não bate com o histórico atual.');
    }

    // FIX v2.3.1: padrões dinâmicos usam `acao` e não definem `entradaEsperada`.
    // Normalizar de ambas as fontes; só gerar erro se a entrada está definida E diverge.
    const entradaEsperada = BBStrategyUtils.normalizeCor(strategy.entradaEsperada || strategy.acao);
    const entradaDecisao  = BBStrategyUtils.normalizeCor(decisao.cor);
    if (entradaEsperada && entradaDecisao && entradaEsperada !== entradaDecisao) {
      erros.push('Entrada sugerida não condiz com a regra da estratégia.');
    }

    const galePermitido = Number.isFinite(Number(strategy.limiteGale)) ? Number(strategy.limiteGale) : 0;
    const galeDecisao = Number.isFinite(Number(decisao.maxGalesPermitido)) ? Number(decisao.maxGalesPermitido) : 0;
    if (galeDecisao > galePermitido) {
      erros.push(`Gale excede o limite da estratégia (${galeDecisao} > ${galePermitido}).`);
    }

    // FIX v2.3.1: só validar proteção de empate se a estratégia define EXPLICITAMENTE um boolean.
    // Padrões sem `usarProtecaoEmpate` definido não devem gerar erro de divergência.
    if (typeof strategy.usarProtecaoEmpate === 'boolean' && decisao.cor !== 'empate') {
      if (Boolean(decisao.protecaoEmpate) !== Boolean(strategy.usarProtecaoEmpate)) {
        erros.push('Proteção de empate divergente da regra da estratégia.');
      }
    }

    return {
      ok: erros.length === 0,
      erros,
      history
    };
  }

  function registrarDecisionTelemetry(decisao, historico, roundKey, validacao = null) {
    const stats = typeof DecisionEngine !== 'undefined' ? DecisionEngine.getEstatisticas() : {};
    const model = getDecisionModel(decisao);
    const evento = {
      timestamp: Date.now(),
      roundId: CONFIG.roundIdAtual || roundKey || null,
      history: getHistoricoCores(historico),
      estrategiaDetectada: decisao?.padrao?.nome || null,
      origem: decisao?.source || decisao?.padrao?.source || null,
      sequenciaReconhecida: decisao?.recognizedSequence || decisao?.padrao?.recognizedSequence || decisao?.padrao?.sequenceBase || null,
      entradaSugerida: decisao?.cor || null,
      patternDetected: model?.padraoDetectado?.nome || null,
      targetColor: model?.corAlvo || null,
      matrixConfirmations: Number.isFinite(Number(model?.matrixConfirmations)) ? Number(model.matrixConfirmations) : null,
      confirmedAnalysis: typeof model?.analiseConfirmada === 'boolean' ? model.analiseConfirmada : null,
      confirmationStrength: model?.forcaConfirmacao || null,
      tableContext: model?.contextoMesa || null,
      operationalRisk: model?.riscoOperacional || null,
      gale: Number.isFinite(Number(decisao?.maxGalesPermitido)) ? Number(decisao.maxGalesPermitido) : 0,
      protecaoEmpate: decisao?.protecaoEmpate === true,
      estadoRodada: CONFIG.estadoRodadaAtual || null,
      statusRobo: stats?.isAtivo ? (stats?.isPausado ? 'pausado' : 'ativo') : 'inativo',
      saldo: Number.isFinite(Number(CONFIG.saldoReal)) ? Number(CONFIG.saldoReal) : null,
      confidenceIndex: Number(model?.indiceDeConfianca ?? decisao?.analytics?.decision?.confidenceIndex ?? decisao?.analytics?.recommendation?.score ?? 0),
      temperaturaEntrada: model?.temperaturaDaEntrada || decisao?.analytics?.decision?.temperatura || decisao?.analytics?.recommendation?.temperatura || null,
      recomendacaoOperacional: model?.recomendacaoOperacional || decisao?.analytics?.decision?.recomendacao || decisao?.analytics?.recommendation?.texto || null,
      decisionStatus: model?.decisaoFinal || null,
      reasons: Array.isArray(model?.justificativas) ? model.justificativas : [],
      confirmacoesSecundarias: Array.isArray(model?.confirmacoesSecundarias) ? model.confirmacoesSecundarias : [],
      stakeSugerida: Number(decisao?.analytics?.decision?.stakeSugerida?.valor ?? decisao?.analytics?.recommendation?.stakeSugerida?.valor ?? 0),
      mesaClassificacao: model?.contextoMesa || decisao?.analytics?.context?.mesaClassificacao || null,
      tipoEntrada: CONFIG.modoTeste ? 'simulada' : 'automatica',
      entradaExecutada: null,
      totalEntradas: Number(stats?.totalEntradas || 0),
      entradasAutomaticas: Number(stats?.entradasAutomaticas || 0),
      entradasManuais: Number(stats?.entradasManuais || 0),
      wins: Number(stats?.wins ?? stats?.vitorias ?? 0),
      losses: Number(stats?.losses ?? stats?.derrotas ?? 0),
      ties: Number(stats?.ties ?? 0),
      abortosExecucao: Number(stats?.abortosExecucao || 0),
      taxaAcerto: stats?.taxaAcerto ?? '0.0',
      inconsistencias: Array.isArray(validacao?.erros) ? validacao.erros : []
    };

    if (typeof BBTelemetry !== 'undefined' && BBTelemetry.push) {
      return BBTelemetry.push(evento);
    }

    if (window.BB_TELEMETRY?.push) {
      window.BB_TELEMETRY.push(evento);
      return evento;
    }

    return evento;
  }

  function registrarExecucaoRealTelemetry(decisao, executionMeta, statusExecucao, entry = null) {
    const stats = typeof DecisionEngine !== 'undefined' ? DecisionEngine.getEstatisticas() : {};
    const evento = {
      timestamp: Date.now(),
      roundId: entry?.roundId || CONFIG.roundIdAtual || null,
      history: Collector.getCoresRecentes(12),
      estrategiaDetectada: entry?.estrategia || decisao?.padrao?.nome || null,
      origem: entry?.origem || decisao?.source || decisao?.padrao?.source || null,
      sequenciaReconhecida: entry?.sequenciaReconhecida || decisao?.recognizedSequence || decisao?.padrao?.recognizedSequence || decisao?.padrao?.sequenceBase || null,
      entradaSugerida: decisao?.cor || null,
      entradaExecutada: entry?.entradaExecutada || decisao?.cor || null,
      tipoEntrada: entry?.tipoEntrada || 'automatica',
      gale: Number.isFinite(Number(entry?.gale)) ? Number(entry.gale) : (Number.isFinite(Number(decisao?.maxGalesPermitido)) ? Number(decisao.maxGalesPermitido) : 0),
      protecaoEmpate: entry?.protecaoEmpate === true || decisao?.protecaoEmpate === true,
      estadoRodada: CONFIG.estadoRodadaAtual || null,
      statusRobo: stats?.isAtivo ? (stats?.isPausado ? 'pausado' : 'ativo') : 'inativo',
      saldo: Number.isFinite(Number(CONFIG.saldoReal)) ? Number(CONFIG.saldoReal) : null,
      stake: Number.isFinite(Number(entry?.stake)) ? Number(entry.stake) : (Number.isFinite(Number(decisao?.stake)) ? Number(decisao.stake) : null),
      alvoAposta: BBStrategyUtils.getEntryLabel(entry?.entradaExecutada || decisao?.cor || ''),
      clickTimestamp: executionMeta?.clickTimestamp || Date.now(),
      statusExecucao: statusExecucao || executionMeta?.statusExecucao || null,
      resultadoRodada: null,
      statusFinal: entry?.statusFinal || null,
      totalEntradas: Number(stats?.totalEntradas || 0),
      entradasAutomaticas: Number(stats?.entradasAutomaticas || 0),
      entradasManuais: Number(stats?.entradasManuais || 0),
      wins: Number(stats?.wins ?? stats?.vitorias ?? 0),
      losses: Number(stats?.losses ?? stats?.derrotas ?? 0),
      ties: Number(stats?.ties ?? 0),
      abortosExecucao: Number(stats?.abortosExecucao || 0),
      taxaAcerto: stats?.taxaAcerto ?? '0.0',
      targetVisualConfirmado: executionMeta?.targetVisualConfirmado ?? null,
      targetVisualCor: executionMeta?.targetVisualCor || null,
      targetVisualTexto: executionMeta?.targetVisualTexto || null,
      targetSelector: executionMeta?.targetSelector || null,
      inconsistencias: executionMeta?.targetVisualConfirmado === false ? ['Alvo visual divergente'] : []
    };

    return typeof BBTelemetry !== 'undefined' && BBTelemetry.push
      ? BBTelemetry.push(evento)
      : evento;
  }

  function registrarResultadoExecucaoTelemetry(entry, resultado) {
    if (!entry || !resultado) return null;

    const stats = typeof DecisionEngine !== 'undefined' ? DecisionEngine.getEstatisticas() : {};
    const resultadoRodada = `${resultado.vencedor || resultado.cor || '—'} ${resultado.playerScore ?? '?'}x${resultado.bankerScore ?? '?'}`;
    const evento = {
      timestamp: Date.now(),
      roundId: entry.roundId || resultado.roundId || resultado.gameId || CONFIG.roundIdAtual || null,
      history: Collector.getCoresRecentes(12),
      estrategiaDetectada: entry.estrategia || null,
      origem: entry.origem || null,
      sequenciaReconhecida: entry.sequenciaReconhecida || null,
      entradaSugerida: entry.entradaSugerida || null,
      entradaExecutada: entry.entradaExecutada || null,
      tipoEntrada: entry.tipoEntrada || null,
      gale: Number.isFinite(Number(entry.gale)) ? Number(entry.gale) : 0,
      protecaoEmpate: entry.protecaoEmpate === true,
      estadoRodada: CONFIG.estadoRodadaAtual || null,
      statusRobo: stats?.isAtivo ? (stats?.isPausado ? 'pausado' : 'ativo') : 'inativo',
      saldo: Number.isFinite(Number(CONFIG.saldoReal)) ? Number(CONFIG.saldoReal) : null,
      stake: Number.isFinite(Number(entry.stake)) ? Number(entry.stake) : null,
      alvoAposta: BBStrategyUtils.getEntryLabel(entry.entradaExecutada || ''),
      clickTimestamp: entry.timestampEntrada || null,
      statusExecucao: 'resultado-confirmado',
      resultadoRodada,
      statusFinal: entry.statusFinal || null,
      totalEntradas: Number(stats?.totalEntradas || 0),
      entradasAutomaticas: Number(stats?.entradasAutomaticas || 0),
      entradasManuais: Number(stats?.entradasManuais || 0),
      wins: Number(stats?.wins ?? stats?.vitorias ?? 0),
      losses: Number(stats?.losses ?? stats?.derrotas ?? 0),
      ties: Number(stats?.ties ?? 0),
      abortosExecucao: Number(stats?.abortosExecucao || 0),
      taxaAcerto: stats?.taxaAcerto ?? '0.0',
      targetVisualConfirmado: null,
      targetVisualCor: null,
      targetVisualTexto: null,
      targetSelector: null,
      inconsistencias: []
    };

    return typeof BBTelemetry !== 'undefined' && BBTelemetry.push
      ? BBTelemetry.push(evento)
      : evento;
  }

  function criarResumoEntrada(entry) {
    if (!entry) return 'Nenhuma executada';

    const tipo = entry.tipoEntrada === 'manual' ? 'Manual' : 'Automática';
    const entrada = BBStrategyUtils.getEntryLabel(entry.entradaExecutada || entry.entradaSugerida || '');
    const status = entry.statusFinal && entry.statusFinal !== 'pendente'
      ? entry.statusFinal.toUpperCase()
      : (entry.statusInicial === 'abortada' ? 'ABORTADA' : 'EXECUTADA');
    return `${tipo} • ${entrada} • ${status}`;
  }

  function atualizarEntradaExecutada(entry) {
    const el = document.getElementById('bb-entry-executed');
    if (!el) return;

    const texto = criarResumoEntrada(entry);
    if (ultimoResumoEntradaKey === texto) return;
    ultimoResumoEntradaKey = texto;
    el.textContent = texto;

    if (entry?.statusFinal === 'win') {
      el.className = 'bb-value bb-small bb-green';
    } else if (entry?.statusFinal === 'loss' || entry?.statusFinal === 'abortada') {
      el.className = 'bb-value bb-small bb-red';
    } else if (entry?.statusFinal === 'tie') {
      el.className = 'bb-value bb-small bb-yellow';
    } else {
      el.className = 'bb-value bb-small';
    }
  }

  function limparDecisaoArmada(motivo = null) {
    cancelarCountdown();
    _resetarBotaoUI();
    if (!decisaoArmada) return;
    decisaoArmada = null;
    if (motivo) {
      addLog(motivo, 'warn');
    }
  }

  function armarDecisao(decisao, roundKey, rodadaOperador) {
    decisaoArmada = {
      decisao,
      roundKey,
      rodadaOperador,
      armedAt: Date.now(),
      executando: false,
      lastBlockReason: null
    };
    const label = BBStrategyUtils.getEntryLabel(decisao.cor);
    _armarBotaoUI(label);
    addLog(`Decisão armada: ${label}`, 'info');
    console.log(`[COUNTDOWN-DEBUG] armarDecisao OK | cor=${decisao.cor} | estado=${CONFIG.estadoRodadaAtual} | chamando tentarExecutar direto`);
    tentarExecutarDecisaoArmada('armarDecisao');
  }

  // ─── Estado UI do botão (armar / resetar) ───────────────────────────────────

  function _armarBotaoUI(label) {
    const btn = document.getElementById('bb-btn-confirm');
    const cancel = document.getElementById('bb-btn-cancel');
    if (btn) {
      btn.disabled = false;
      btn.classList.add('armed');
      btn.textContent = `✅ CONFIRMAR ${label.toUpperCase()}`;
    }
    if (cancel) cancel.hidden = false;
  }

  function _resetarBotaoUI() {
    const btn = document.getElementById('bb-btn-confirm');
    const cancel = document.getElementById('bb-btn-cancel');
    const bar = document.getElementById('bb-countdown-bar');
    if (btn) {
      btn.disabled = true;
      btn.classList.remove('armed');
      btn.style.background = '';
      btn.textContent = '⏳ AGUARDANDO INDICAÇÃO';
    }
    if (cancel) cancel.hidden = true;
    if (bar) {
      bar.style.width = '0%';
      bar.style.display = 'none';
    }
  }

  // ─── Countdown ───────────────────────────────────────────────────────────────

  function _atualizarBotaoCountdown() {
    const btn = document.getElementById('bb-btn-confirm');
    const bar = document.getElementById('bb-countdown-bar');
    if (!btn) return;

    if (countdownSecondsLeft > 0) {
      const label = decisaoArmada ? BBStrategyUtils.getEntryLabel(decisaoArmada.decisao.cor).toUpperCase() : '';
      btn.textContent = `✅ CONFIRMAR ${label} (${countdownSecondsLeft}s)`;
      if (bar) {
        bar.style.width = `${(countdownSecondsLeft / COUNTDOWN_SEGUNDOS) * 100}%`;
        bar.style.display = 'block';
      }
    }
  }

  function iniciarCountdown(onExecutar) {
    cancelarCountdown();
    countdownSecondsLeft = COUNTDOWN_SEGUNDOS;
    const btnDbg = document.getElementById('bb-btn-confirm');
    console.log(`[Countdown] iniciarCountdown | btn=${!!btnDbg} | segundos=${countdownSecondsLeft}`);
    _atualizarBotaoCountdown();

    // REGRA: countdown só é interrompido pelo OPERADOR clicando em CANCELAR.
    // Mudança de estado da rodada NÃO cancela mais — quem decide se a mesa
    // aceita o clique é a casa (via DOM bypass no Executor).
    countdownTimer = setInterval(() => {
      countdownSecondsLeft--;
      _atualizarBotaoCountdown();
      console.log(`[Countdown] tick | segundos=${countdownSecondsLeft} | estado=${CONFIG.estadoRodadaAtual}`);
      if (countdownSecondsLeft <= 0) {
        console.log(`[Countdown] ⏰ ZERO — chamando onExecutar()`);
        cancelarCountdown();
        onExecutar();
      }
    }, 1000);
  }

  function cancelarCountdown() {
    if (countdownTimer !== null) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    countdownSecondsLeft = 0;
  }

  // ─── Execução efetiva (chamada pelo countdown ao chegar em 0) ─────────────────

  function _dispararExecucaoDecisao(contexto) {
    console.log(`[EXEC-DEBUG] _dispararExecucaoDecisao chamado | contexto=${contexto} | decisaoArmada=${!!decisaoArmada} | estado=${CONFIG.estadoRodadaAtual} | paradaGlobal=${CONFIG.paradaGlobal}`);
    if (!decisaoArmada) { console.log('[EXEC-DEBUG] ABORT _disparar: sem decisaoArmada'); return; }
    // PRD item 6: PARAR GLOBAL — bloqueia TODAS as decisões automaticamente.
    // Descarta a decisão atual SEM contar como abortada (limpa para próxima rodada).
    if (CONFIG.paradaGlobal === true) {
      console.log(`%c[PARAR-GLOBAL] 🛑 Decisão descartada (${decisaoArmada?.decisao?.cor || '?'} R$${decisaoArmada?.decisao?.stake || 0})`, 'color:#fbbf24;font-weight:bold');
      addLog(`🛑 PARAR GLOBAL ativo — decisão descartada`, 'warn');
      limparDecisaoArmada('PARAR GLOBAL ativo');
      return;
    }
    // PRD item 8: anomalia de saldo (0, 2969 zumbi etc) — trava clique.
    const saldoAtual = Number(CONFIG.saldoReal);
    const anomalos = Array.isArray(CONFIG.saldosAnomalos) ? CONFIG.saldosAnomalos : [];
    if (Number.isFinite(saldoAtual) && anomalos.includes(saldoAtual)) {
      console.warn(`[SAFETY] ⚠️ Saldo anômalo R$${saldoAtual} — bloqueando clique e ativando PARAR GLOBAL`);
      addLog(`⚠️ Saldo anômalo R$${saldoAtual} (lista de zumbis) — clique bloqueado, PARAR GLOBAL acionado`, 'error');
      CONFIG.paradaGlobal = true;
      if (typeof window.__refreshParadaUI === 'function') try { window.__refreshParadaUI(); } catch (_) {}
      limparDecisaoArmada(`Saldo anômalo R$${saldoAtual}`);
      return;
    }
    // PRD item 8a: saldo abaixo do mínimo operacional (default R$1) → conta vazia/expirada
    const saldoMin = Number(CONFIG.saldoMinimoOperacao) || 1;
    if (Number.isFinite(saldoAtual) && saldoAtual > 0 && saldoAtual < saldoMin) {
      console.warn(`[SAFETY] 💸 Saldo R$${saldoAtual.toFixed(2)} < mínimo R$${saldoMin} — conta vazia. Bloqueando.`);
      addLog(`💸 Saldo R$ ${saldoAtual.toFixed(2)} insuficiente (recarregue a conta) — clique bloqueado, PARAR GLOBAL acionado`, 'error');
      CONFIG.paradaGlobal = true;
      if (typeof window.__refreshParadaUI === 'function') try { window.__refreshParadaUI(); } catch (_) {}
      limparDecisaoArmada(`Saldo R$ ${saldoAtual.toFixed(2)} insuficiente`);
      return;
    }
    // PRD item 8a: saldo < stake da decisão → clique seria recusado pela casa
    const stakeAtual = Number(decisaoArmada?.decisao?.stake) || 0;
    if (Number.isFinite(saldoAtual) && saldoAtual > 0 && stakeAtual > 0 && saldoAtual < stakeAtual) {
      console.warn(`[SAFETY] 💸 Saldo R$${saldoAtual.toFixed(2)} < stake R$${stakeAtual} — clique inviável`);
      addLog(`💸 Saldo R$ ${saldoAtual.toFixed(2)} < aposta R$ ${stakeAtual} — clique cancelado (recarregue ou abaixe stake)`, 'error');
      limparDecisaoArmada(`Saldo insuficiente para aposta de R$${stakeAtual}`);
      return;
    }
    // Não aborta por estado — quem decide se aceita é a casa (via DOM bypass no Executor).
    if (CONFIG.estadoRodadaAtual !== 'apostando') {
      console.log(`[EXEC-DEBUG] aviso: estado=${CONFIG.estadoRodadaAtual} (esperado: apostando). Prosseguindo — Executor vai decidir via DOM.`);
    }

    decisaoArmada.executando = true;
    decisaoArmada.lastBlockReason = null;
    const { decisao, rodadaOperador } = decisaoArmada;
    const roundIdAtual = CONFIG.roundIdAtual || null;

    const btn = document.getElementById('bb-btn-confirm');
    if (btn) { btn.style.background = 'linear-gradient(135deg, #2563eb, #1d4ed8)'; }

    addLog(`Executando aposta automática: ${BBStrategyUtils.getEntryLabel(decisao.cor)}`, 'warn');
    console.log(`[AutoClick] Stake R$${decisao.stake || 0} → ${BBStrategyUtils.getEntryLabel(decisao.cor)} → executando (${contexto})`);
    console.log(`[EXEC-DEBUG] chamando Executor.executarAposta(cor=${decisao.cor}, stake=${decisao.stake})`);

    Executor.executarAposta(decisao).then((ok) => {
      console.log(`[EXEC-DEBUG] Executor.executarAposta retornou ok=${ok} | status=${Executor.getLastExecutionMeta?.()?.statusExecucao}`);
      const executionMeta = Executor.getLastExecutionMeta?.() || null;
      if (btn) { btn.style.background = ok ? 'linear-gradient(135deg, #16a34a, #15803d)' : 'linear-gradient(135deg, #dc2626, #b91c1c)'; }

      if (typeof ObservabilityEngine !== 'undefined' && ObservabilityEngine.atualizarTempoReal) {
        ObservabilityEngine.atualizarTempoReal({
          estadoRodada: CONFIG.estadoRodadaAtual || null,
          mesaConfirmadaAberta: executionMeta?.statusExecucao
            ? executionMeta.statusExecucao !== 'mesa-nao-confirmada-aberta'
            : false,
          targetVisualConfirmado: executionMeta?.targetVisualConfirmado === true
        });
      }

      if (!ok) {
        const motivo = executionMeta?.statusExecucao === 'alvo-divergente'
          ? 'Execução bloqueada: alvo divergente'
          : `Execução bloqueada: ${executionMeta?.statusExecucao || 'falha-desconhecida'}`;
        const abortEntry = DecisionEngine.registrarExecucaoAbortada({
          roundId: CONFIG.roundIdAtual || roundIdAtual || null,
          rodada: rodadaOperador || Collector.getRodadaAtual() + 1,
          estrategia: decisao?.padrao?.nome || null,
          strategyId: decisao?.padrao?.strategyId || decisao?.padrao?.id || null,
          origem: decisao?.source || decisao?.padrao?.source || null,
          sequenciaReconhecida: decisao?.recognizedSequence || decisao?.padrao?.recognizedSequence || decisao?.padrao?.sequenceBase || null,
          entradaSugerida: decisao?.cor || null,
          entradaExecutada: decisao?.cor || null,
          gale: Number.isFinite(Number(decisao?.maxGalesPermitido)) ? Number(decisao.maxGalesPermitido) : 0,
          protecaoEmpate: decisao?.protecaoEmpate === true,
          valorProtecao: decisao?.valorProtecao || 0,
          stake: decisao?.stake || 0,
          statusExecucao: executionMeta?.statusExecucao || 'abortada',
          targetVisualConfirmado: executionMeta?.targetVisualConfirmado ?? null,
          targetVisualCor: executionMeta?.targetVisualCor || null,
          targetVisualTexto: executionMeta?.targetVisualTexto || null,
          targetSelector: executionMeta?.targetSelector || null
        });
        if (typeof ObservabilityEngine !== 'undefined' && ObservabilityEngine.registrarEntrada) {
          ObservabilityEngine.registrarEntrada(abortEntry, {
            history: Collector.getCoresRecentes(12),
            rodadaNumero: rodadaOperador || Collector.getRodadaAtual() + 1
          });
        }
        registrarExecucaoRealTelemetry(decisao, executionMeta, executionMeta?.statusExecucao || 'abortada', abortEntry);
        atualizarEntradaExecutada(abortEntry);
        addLog(motivo, 'error');
        decisaoArmada = null;
        _resetarBotaoUI();
        return;
      }

      const entry = DecisionEngine.getUltimaAposta();
      if (typeof ObservabilityEngine !== 'undefined' && ObservabilityEngine.registrarEntrada) {
        ObservabilityEngine.registrarEntrada(entry, {
          history: Collector.getCoresRecentes(12),
          rodadaNumero: rodadaOperador || Collector.getRodadaAtual() + 1
        });
      }
      registrarExecucaoRealTelemetry(decisao, executionMeta, executionMeta?.statusExecucao || 'executada', entry);
      atualizarEntradaExecutada(entry);
      addLog('Alvo confirmado', executionMeta?.targetVisualConfirmado === false ? 'error' : 'success');
      addLog('Clique realizado', 'success');
      addLog(`Rodada ${rodadaOperador}: ${decisao.padrao.nome} | ${BBStrategyUtils.getEntryLabel(decisao.cor)} | G${decisao.maxGalesPermitido} | Executado`, 'success');
      decisaoArmada = null;
      _resetarBotaoUI();
    }).catch((error) => {
      Logger.error('Erro ao executar decisão armada:', error?.message || error);
      if (btn) {
        btn.style.background = 'linear-gradient(135deg, #dc2626, #b91c1c)';
        setTimeout(() => { btn.style.background = ''; }, 2000);
      }
      const abortEntry = DecisionEngine.registrarExecucaoAbortada({
        roundId: CONFIG.roundIdAtual || roundIdAtual || null,
        rodada: rodadaOperador || Collector.getRodadaAtual() + 1,
        estrategia: decisao?.padrao?.nome || null,
        origem: decisao?.source || decisao?.padrao?.source || null,
        sequenciaReconhecida: decisao?.recognizedSequence || decisao?.padrao?.recognizedSequence || decisao?.padrao?.sequenceBase || null,
        entradaSugerida: decisao?.cor || null,
        entradaExecutada: decisao?.cor || null,
        gale: Number.isFinite(Number(decisao?.maxGalesPermitido)) ? Number(decisao.maxGalesPermitido) : 0,
        protecaoEmpate: decisao?.protecaoEmpate === true,
        valorProtecao: decisao?.valorProtecao || 0,
        stake: decisao?.stake || 0,
        statusExecucao: 'erro-execucao'
      });
      if (typeof ObservabilityEngine !== 'undefined' && ObservabilityEngine.registrarEntrada) {
        ObservabilityEngine.registrarEntrada(abortEntry, {
          history: Collector.getCoresRecentes(12),
          rodadaNumero: rodadaOperador || Collector.getRodadaAtual() + 1
        });
      }
      registrarExecucaoRealTelemetry(decisao, { statusExecucao: 'erro-execucao' }, 'erro-execucao', abortEntry);
      atualizarEntradaExecutada(abortEntry);
      addLog('Execução bloqueada: erro de execução', 'error');
      decisaoArmada = null;
      _resetarBotaoUI();
    });
  }

  function registrarBloqueioExecucao(reason) {
    if (!decisaoArmada) return false;
    if (decisaoArmada.lastBlockReason === reason) return false;
    decisaoArmada.lastBlockReason = reason;
    addLog(`Execução bloqueada: ${reason}`, 'warn');
    return false;
  }

  function registrarEntradaManual(entry) {
    if (!entry) return;
    limparDecisaoArmada('Entrada manual detectada — execução automática cancelada nesta rodada');
    atualizarEntradaExecutada(entry);
    addLog(`Entrada manual registrada: ${BBStrategyUtils.getEntryLabel(entry.entradaExecutada)} | R$${Number(entry.stake || 0).toFixed(2)}`, 'info');

    if (typeof BBTelemetry !== 'undefined' && BBTelemetry.push) {
      const stats = typeof DecisionEngine !== 'undefined' ? DecisionEngine.getEstatisticas() : {};
      BBTelemetry.push({
        timestamp: entry.timestampEntrada || Date.now(),
        roundId: entry.roundId || CONFIG.roundIdAtual || null,
        history: Collector.getCoresRecentes(12),
        estrategiaDetectada: entry.estrategia || null,
        origem: entry.origem || null,
        sequenciaReconhecida: entry.sequenciaReconhecida || null,
        entradaSugerida: entry.entradaSugerida || null,
        entradaExecutada: entry.entradaExecutada || null,
        tipoEntrada: 'manual',
        gale: Number(entry.gale || 0),
        protecaoEmpate: entry.protecaoEmpate === true,
        estadoRodada: CONFIG.estadoRodadaAtual || null,
        statusRobo: stats?.isAtivo ? (stats?.isPausado ? 'pausado' : 'ativo') : 'inativo',
        saldo: Number.isFinite(Number(CONFIG.saldoReal)) ? Number(CONFIG.saldoReal) : null,
        stake: Number(entry.stake || 0),
        alvoAposta: BBStrategyUtils.getEntryLabel(entry.entradaExecutada || ''),
        statusExecucao: entry.statusExecucao || 'manual-registrada',
        statusFinal: entry.statusFinal || 'pendente',
        totalEntradas: Number(stats?.totalEntradas || 0),
        entradasAutomaticas: Number(stats?.entradasAutomaticas || 0),
        entradasManuais: Number(stats?.entradasManuais || 0),
        wins: Number(stats?.wins ?? stats?.vitorias ?? 0),
        losses: Number(stats?.losses ?? stats?.derrotas ?? 0),
        ties: Number(stats?.ties ?? 0),
        abortosExecucao: Number(stats?.abortosExecucao || 0),
        taxaAcerto: stats?.taxaAcerto ?? '0.0',
        targetVisualTexto: entry.targetVisualTexto || null,
        targetSelector: entry.targetSelector || null,
        inconsistencias: []
      });
    }
  }

  function tentarExecutarDecisaoArmada(contexto = 'runtime') {
    console.log(`[COUNTDOWN-DEBUG] Tentando iniciar | contexto=${contexto} | decisao=${!!decisaoArmada} | estado=${CONFIG.estadoRodadaAtual} | timer=${countdownTimer !== null} | executando=${decisaoArmada?.executando}`);
    if (!decisaoArmada) { console.log('[COUNTDOWN-DEBUG] ABORT: sem decisaoArmada'); return false; }
    if (countdownTimer !== null) { console.log('[COUNTDOWN-DEBUG] ABORT: countdown já ativo'); return false; }
    if (CONFIG.estadoRodadaAtual !== 'apostando') { console.log(`[COUNTDOWN-DEBUG] ABORT: estado != apostando (${CONFIG.estadoRodadaAtual})`); return registrarBloqueioExecucao(`estado atual = ${CONFIG.estadoRodadaAtual || 'desconhecido'}`); }
    if (Executor.isExecutando && Executor.isExecutando()) { console.log('[COUNTDOWN-DEBUG] ABORT: executor ocupado'); return registrarBloqueioExecucao('executor já está em execução'); }

    const roundIdAtual = CONFIG.roundIdAtual || null;
    if (roundIdAtual && typeof DecisionEngine !== 'undefined' && DecisionEngine.hasTentativaParaRound(roundIdAtual)) {
      limparDecisaoArmada('Execução bloqueada: rodada já possui tentativa registrada');
      return false;
    }

    const label = BBStrategyUtils.getEntryLabel(decisaoArmada.decisao.cor);
    console.log(`[COUNTDOWN-DEBUG] PASSOU TODOS OS GUARDS — chamando iniciarCountdown(${label})`);
    console.log(`[Countdown] INICIANDO countdown para ${label}`);
    addLog(`[AutoClick] Stake R$${decisaoArmada.decisao.stake || 0} → ${label} → Confirmando em ${COUNTDOWN_SEGUNDOS}s...`, 'info');
    iniciarCountdown(() => _dispararExecucaoDecisao(contexto));
    return true;
  }

  function logDecisionConsole(decisao) {
    const model = getDecisionModel(decisao);
    console.log('[DECISION]');
    console.log('- estrategia:', decisao?.padrao?.nome || '—');
    console.log('- origem:', getOrigemLabel(decisao?.source || decisao?.padrao?.source));
    console.log('- sequencia:', decisao?.recognizedSequence || decisao?.padrao?.recognizedSequence || decisao?.padrao?.sequenceBase || '—');
    console.log('- entrada:', decisao?.cor || '—');
    console.log('- gale:', Number.isFinite(Number(decisao?.maxGalesPermitido)) ? Number(decisao.maxGalesPermitido) : 0);
    console.log('- protecao:', decisao?.protecaoEmpate ? 'sim' : 'não');
    console.log('- estado:', CONFIG.estadoRodadaAtual || '—');
    console.log('- confirmacoes:', Number(model?.matrixConfirmations || 0));
    console.log('- contexto:', model?.contextoMesa || '—');
    console.log('- risco:', model?.riscoOperacional || '—');
    console.log('- recomendacao:', model?.recomendacaoOperacional || '—');
    console.log('- decisaoFinal:', model?.decisaoFinal || '—');
  }

  function logDecisionErrors(decisao, erros) {
    if (!Array.isArray(erros) || erros.length === 0) return;

    console.error('[ERROR_DECISION]');
    console.error('- estrategia:', decisao?.padrao?.nome || '—');
    erros.forEach((erro) => console.error('-', erro));
  }

  function aplicarModoDebug() {
    const section = document.getElementById('bb-debug-section');
    const content = document.getElementById('bb-debug-content');
    if (!section || !content) return;

    if (CONFIG.modoDebug) {
      section.style.display = 'block';
      if (!content.innerHTML.trim() || content.innerHTML.includes('desativado')) {
        content.innerHTML = 'Aguardando decisão monitorada...';
      }
      return;
    }

    section.style.display = 'none';
    content.innerHTML = 'Modo debug desativado.';
    ultimoDebugKey = null;
  }

  function atualizarDebug(decisao, validacao) {
    const content = document.getElementById('bb-debug-content');
    if (!content) return;

    aplicarModoDebug();
    if (!CONFIG.modoDebug || !decisao?.padrao) return;

    const origem = getOrigemLabel(decisao.source || decisao.padrao.source);
    const sequencia = decisao.recognizedSequence || decisao.padrao.recognizedSequence || decisao.padrao.sequenceBase || '—';
    const entrada = BBStrategyUtils.getEntryLabel(decisao.cor || '');
    const statusValidacao = validacao?.ok ? 'OK' : 'ERRO';
    const model = getDecisionModel(decisao);
    const debugKey = [
      decisao.padrao.nome,
      origem,
      sequencia,
      entrada,
      statusValidacao,
      model?.contextoMesa || '—',
      model?.recomendacaoOperacional || '—',
      (validacao?.erros || []).join('|')
    ].join('::');

    if (ultimoDebugKey === debugKey) return;
    ultimoDebugKey = debugKey;

    const errosHtml = validacao?.ok
      ? '<div style="color:#69f0ae;">Validação: OK</div>'
      : `<div style="color:#ff8a80;">Validação: ${escapeHtml(validacao.erros.join(' | '))}</div>`;

    content.innerHTML = `
      <div><strong>${escapeHtml(decisao.padrao.nome)}</strong></div>
      <div>Origem: ${escapeHtml(origem)}</div>
      <div>Sequência: ${escapeHtml(sequencia)}</div>
      <div>Decisão: ${escapeHtml(entrada)}</div>
      <div>Confirmações: ${Number(model?.matrixConfirmations || 0)} • ${escapeHtml(model?.forcaConfirmacao || '—')}</div>
      <div>Mesa: ${escapeHtml(model?.contextoMesa || '—')}</div>
      <div>Risco: ${escapeHtml(model?.riscoOperacional || '—')}</div>
      <div>Recomendação: ${escapeHtml(model?.recomendacaoOperacional || '—')}</div>
      <div>Decisão final: ${escapeHtml(model?.decisaoFinal || '—')}</div>
      <div>Justificativa: ${escapeHtml((model?.justificativas || []).slice(0, 2).join(' • ') || '—')}</div>
      ${errosHtml}
    `;
  }

  function atualizarObservabilidade(snapshot = null) {
    const data = snapshot || getObservabilitySnapshot();
    if (!data?.session) return;

    const session = data.session;
    const live = session.live || {};
    const topStrategy = Array.isArray(session.strategyMetrics) ? session.strategyMetrics[0] : null;
    const operator = session.operatorProfile || {};

    const bankStartEl = document.getElementById('bb-session-bank-start');
    const balanceNowEl = document.getElementById('bb-session-balance-now');
    const sessionPlEl = document.getElementById('bb-session-pl');
    const temperatureEl = document.getElementById('bb-temperature');
    const recommendationEl = document.getElementById('bb-recommendation');
    const stakeSuggestedEl = document.getElementById('bb-suggested-stake');
    const strategyMetricsEl = document.getElementById('bb-strategy-metrics');
    const operatorMetricsEl = document.getElementById('bb-operator-metrics');

    if (bankStartEl) {
      bankStartEl.textContent = formatCurrency(session.bancaInicialSessao);
    }

    if (balanceNowEl) {
      balanceNowEl.textContent = formatCurrency(session.saldoAtual);
      balanceNowEl.className = `bb-value ${Number(session.lucroPrejuizoSessao || 0) >= 0 ? 'bb-green' : 'bb-red'}`;
    }

    if (sessionPlEl) {
      const pl = Number(session.lucroPrejuizoSessao || 0);
      sessionPlEl.textContent = `P/L da sessão: ${pl >= 0 ? '+' : ''}${formatCurrency(pl).replace('R$ ', 'R$ ')}`;
      sessionPlEl.className = `bb-value bb-small ${pl >= 0 ? 'bb-green' : 'bb-red'}`;
    }

    if (temperatureEl) {
      temperatureEl.textContent = getTemperatureLabel(live.ultimaTemperatura);
      if (live.ultimaTemperatura === 'hot') temperatureEl.className = 'bb-value bb-green';
      else if (live.ultimaTemperatura === 'warm') temperatureEl.className = 'bb-value bb-yellow';
      else if (live.ultimaTemperatura === 'cold') temperatureEl.className = 'bb-value bb-red';
      else temperatureEl.className = 'bb-value';
    }

    if (recommendationEl) {
      recommendationEl.textContent = `Recomendação: ${live.ultimaSugestaoOperacional || '—'} • Score ${Number(live.ultimaConfianca || 0).toFixed(1)}`;
    }

    if (stakeSuggestedEl) {
      const stake = live.ultimaStakeSugerida?.valor;
      const motivo = live.ultimaStakeSugerida?.motivo || 'Sem contexto suficiente.';
      stakeSuggestedEl.textContent = `Stake sugerida: ${formatCurrency(stake)} • ${motivo}`;
    }

    if (strategyMetricsEl) {
      if (!topStrategy) {
        strategyMetricsEl.textContent = 'Sem dados suficientes.';
      } else {
        strategyMetricsEl.textContent =
          `${topStrategy.nome} • ${topStrategy.disparou} disparos • ${topStrategy.taxaAcerto}% acerto • robustez ${topStrategy.scoreRobustez}`;
      }
    }

    if (operatorMetricsEl) {
      const labels = Array.isArray(operator.labels) && operator.labels.length ? operator.labels.join(', ') : 'em observação';
      operatorMetricsEl.textContent =
        `Perfil: ${labels} • adesão ${operator.taxaAdesaoAoRobo ?? 0}% • segue ${operator.taxaWinQuandoSegue ?? 0}% • contra ${operator.taxaWinQuandoVaiContra ?? 0}%`;
    }
  }

  /**
   * AUTO-START — chama iniciarBot() automaticamente assim que o overlay carrega,
   * exceto se o Will parou manualmente na sessao anterior (flag bb-paradoManual=true
   * persistida em chrome.storage.local).
   *
   * Poll: tenta a cada 1s ate (a) modoPassivo virar false (WS detectou mesa)
   * e DecisionEngine ainda nao estar rodando. Para de tentar depois de 60s
   * (60 tentativas) para nao ficar polling pra sempre se algo deu errado.
   */
  /**
   * Atualiza badge de calibracao no overlay (Diego, 17/05).
   * Estado pode ser: 'ok', 'stale', 'missing', 'running'.
   */
  function setCalBadge(state, info) {
    const el = document.getElementById('bb-cal-badge');
    if (!el) return;
    const presets = {
      ok:      { txt: `🎯 CAL: ✅ ${info || ''}`.trim(), bg: 'rgba(34,197,94,0.15)', border: 'rgba(34,197,94,0.5)', color: '#86efac' },
      stale:   { txt: `🎯 CAL: ⚠️ recalibrar`,            bg: 'rgba(251,191,36,0.2)', border: 'rgba(251,191,36,0.6)', color: '#fbbf24' },
      missing: { txt: `🎯 CAL: ❌ sem calibracao`,         bg: 'rgba(239,68,68,0.18)', border: 'rgba(239,68,68,0.6)', color: '#fca5a5' },
      running: { txt: `🎯 CAL: 🔄 calibrando…`,            bg: 'rgba(14,165,233,0.18)', border: 'rgba(14,165,233,0.5)', color: '#7dd3fc' }
    };
    const p = presets[state] || presets.missing;
    el.textContent = p.txt;
    el.style.background = p.bg;
    el.style.borderColor = p.border;
    el.style.color = p.color;
  }

  /**
   * Atualiza badge de hit-rate dos cliques.
   * Lê BetConfirmationTracker.taxa() — taxa < 50% nas ultimas 10 = alerta.
   */
  function refreshHitRateBadge() {
    const el = document.getElementById('bb-hit-badge');
    if (!el || typeof BetConfirmationTracker === 'undefined') return;
    try {
      const t = BetConfirmationTracker.taxa();
      const total = t.total || 0;
      const ok = t.confirmadas || 0;
      const pct = total > 0 ? Math.round(100 * ok / total) : 0;
      el.textContent = `🎲 CLICKS: ${ok}/${total} (${pct}%)`;
      if (total === 0) {
        el.style.background = 'rgba(148,163,184,0.15)';
        el.style.borderColor = 'rgba(148,163,184,0.4)';
        el.style.color = '#94a3b8';
      } else if (pct >= 80) {
        el.style.background = 'rgba(34,197,94,0.15)';
        el.style.borderColor = 'rgba(34,197,94,0.5)';
        el.style.color = '#86efac';
      } else if (pct >= 50) {
        el.style.background = 'rgba(251,191,36,0.15)';
        el.style.borderColor = 'rgba(251,191,36,0.5)';
        el.style.color = '#fbbf24';
      } else {
        el.style.background = 'rgba(239,68,68,0.18)';
        el.style.borderColor = 'rgba(239,68,68,0.6)';
        el.style.color = '#fca5a5';
      }
    } catch (_) {}
  }

  /**
   * Atualiza badge de status do WMSG: mostra ultimas 4 cores e match (se houver).
   * Diego (17/05) quer saber por que "agora nao esta detectando nenhum padrao" —
   * isso explicita pra ele se eh falta de match (esperado) ou bug.
   */
  function refreshWmsgBadge() {
    const el = document.getElementById('bb-wmsg-badge');
    if (!el) return;
    try {
      const cores = typeof Collector !== 'undefined' && Collector.getCoresRecentes
        ? (Collector.getCoresRecentes(4) || [])
        : [];
      if (cores.length < 4) {
        el.textContent = `📊 WMSG: aguardando 4+ cores (tem ${cores.length})`;
        el.style.color = '#94a3b8';
        return;
      }
      const ultimas = cores.slice(-4);
      const seq = ultimas.map(c => c === 'azul' ? 'A' : c === 'vermelho' ? 'V' : 'E').join('-');
      const detected = typeof PatternEngine !== 'undefined' && PatternEngine.getLastDetectedStrategies
        ? (PatternEngine.getLastDetectedStrategies() || [])
        : [];
      if (detected.length > 0) {
        const top = detected[0];
        el.textContent = `📊 WMSG: ${seq} → ${top.nome} (${top.acao}, ${top.confianca}%)`;
        el.style.color = '#86efac';
      } else {
        el.textContent = `📊 WMSG: ${seq} → 🕓 nenhum dos 18 bateu`;
        el.style.color = '#fde68a';
      }
    } catch (e) {
      el.textContent = `📊 WMSG: erro (${e?.message || e})`;
      el.style.color = '#fca5a5';
    }
  }

  // Auto-calibracao apos 3 BET-CONFIRM ❌ seguidos (Diego, 17/05).
  let _falhasSeguidas = 0;
  let _autoCalEmCurso = false;
  function registrarFalhaClick() {
    _falhasSeguidas += 1;
    refreshHitRateBadge();
    if (_falhasSeguidas >= 3 && !_autoCalEmCurso) {
      _autoCalEmCurso = true;
      addLog(`🎯 ${_falhasSeguidas} apostas seguidas nao entraram — disparando recalibracao automatica`, 'warn');
      setCalBadge('running');
      dispararCalibracao().finally(() => {
        _autoCalEmCurso = false;
        _falhasSeguidas = 0;
      });
    }
  }
  function registrarSucessoClick() {
    _falhasSeguidas = 0;
    refreshHitRateBadge();
  }

  /**
   * Dispara BBCalibrator.tudo() via console MAIN world (ponte ja existe).
   * Atualiza badge antes/depois.
   */
  async function dispararCalibracao() {
    // Passa saldoMax pro BBCalibrator filtrar fichas (Diego, 17/05).
    // Com R$37 so calibra chip5/10/25; pula chip125+ porque sem saldo
    // nao tem como clicar na ficha pra registrar coord.
    const saldoMax = Number.isFinite(Number(CONFIG.saldoReal)) ? Number(CONFIG.saldoReal) : null;
    setCalBadge('running');
    addLog(`🎯 Calibrando mesa (saldo R$ ${saldoMax != null ? saldoMax.toFixed(2) : '?'}) — fichas filtradas pelo saldo`, 'info');
    try {
      const result = await new Promise((resolve, reject) => {
        const reqId = `cal-${Date.now()}`;
        const onResp = (ev) => {
          if (ev?.data?.kind === 'BBCAL_RUN_RESP' && ev.data.reqId === reqId) {
            window.removeEventListener('message', onResp);
            resolve(ev.data.result);
          }
        };
        window.addEventListener('message', onResp);
        window.postMessage({ kind: 'BBCAL_RUN_REQ', reqId, saldoMax }, '*');
        // Timeout maior — calibracao pode levar 1+ min (cada ficha precisa de click manual)
        setTimeout(() => {
          window.removeEventListener('message', onResp);
          reject(new Error('timeout calibracao 5min'));
        }, 300000);
      });
      if (result && result.ok) {
        const fichas = (result.chipsCalibraveis || []).join(',');
        const pulados = (result.chipsPulados || []).length;
        const info = `${new Date().toLocaleTimeString('pt-BR').slice(0,5)} fichas:[${fichas}]${pulados>0?` (${pulados} sem saldo)`:''}`;
        setCalBadge('ok', info);
        addLog(`✅ Calibrado: fichas R$${fichas || '?'}${pulados>0?` — ${pulados} fichas puladas (saldo insuficiente)`:''}`, 'success');
        try { chrome.storage.local.set({ 'bb-cal-ts': Date.now() }); } catch (_) {}
      } else {
        setCalBadge('missing');
        const reason = result?.reason || 'sem detalhes';
        if (reason === 'saldo-insuficiente') {
          addLog(`⚠ Saldo R$ ${saldoMax?.toFixed(2) || '?'} insuficiente — minimo R$5 pra calibrar ate a menor ficha. Deposite e tente de novo.`, 'warn');
        } else if (reason === 'cancelado-pelo-usuario') {
          addLog('⚠ Calibracao cancelada (ESC numa ficha obrigatoria).', 'warn');
        } else {
          addLog(`⚠ Calibracao falhou: ${reason}. Use BBCalibrator.tudo({saldoMax: ${saldoMax}}) no console.`, 'warn');
        }
      }
    } catch (e) {
      setCalBadge('missing');
      addLog(`❌ Calibracao deu erro: ${e?.message || e}. Tente no console: await BBCalibrator.tudo({saldoMax: ${saldoMax}})`, 'error');
    }
  }

  /**
   * Sugere stake/protecao/stop win/stop loss proporcionais a banca (Diego, 18/05).
   * Banca pequena ou grande precisam de valores diferentes — fixo nao funciona.
   * Regras:
   *   - stake = max(1, banca * 0.5%)   (ex: R$15 -> R$1 / R$100 -> R$1 / R$1000 -> R$5)
   *     mas respeita stakeInicial minimo da mesa (R$5 BetBoom Bac Bo Mini)
   *   - protecao = stake * 0.5         (50% do stake no empate)
   *   - stopWin = banca * 20%
   *   - stopLoss = banca * 30%         (perdoa mais perda pra ter mais espaco)
   */
  function sugerirValoresPorBanca() {
    const banca = Number(CONFIG.saldoReal || 0);
    if (!Number.isFinite(banca) || banca <= 0) {
      return { stake: 5, prot: 0, sw: 1000, sl: 500, motivo: 'sem-banca' };
    }
    const stakeMinMesa = 5; // BetBoom Bac Bo Mini = R$5
    const stakeBruto = Math.max(stakeMinMesa, Math.ceil(banca * 0.005));
    // Arredondar pra cima ate proxima ficha calibravel comum (5, 10, 25)
    const stake = stakeBruto <= 5 ? 5 : stakeBruto <= 10 ? 10 : stakeBruto <= 25 ? 25 : Math.ceil(stakeBruto / 25) * 25;
    const prot = Math.max(0, Math.floor(stake * 0.5));
    const sw = Math.max(stake, Math.ceil(banca * 0.20));
    const sl = Math.max(stake * 2, Math.ceil(banca * 0.30));
    return { stake, prot, sw, sl, motivo: `banca R$ ${banca.toFixed(2)}` };
  }

  /**
   * Le os 4 inputs do topo e aplica em CONFIG + persiste em chrome.storage.
   * Diego (18/05): controles tem que liberar/bloquear o robo na hora.
   */
  function aplicarQuickConfig() {
    const stake = Number(document.getElementById('bb-qc-stake')?.value || CONFIG.stakeInicial);
    // PROT agora eh um select com valores 0..12000. 0 = desprotegido.
    const protValor = Number(document.getElementById('bb-qc-protvalor')?.value || 0);
    const protOn = protValor > 0;
    const sw = Number(document.getElementById('bb-qc-stopwin')?.value || CONFIG.stopWin);
    const sl = Number(document.getElementById('bb-qc-stoploss')?.value || CONFIG.stopLoss);

    if (!Number.isFinite(stake) || stake < 1) {
      setQuickConfigStatus('❌ stake invalido (>=1)', '#fca5a5');
      return false;
    }
    if (!Number.isFinite(sw) || sw < 1) {
      setQuickConfigStatus('❌ stop win invalido (>=1)', '#fca5a5');
      return false;
    }
    if (!Number.isFinite(sl) || sl < 1) {
      setQuickConfigStatus('❌ stop loss invalido (>=1)', '#fca5a5');
      return false;
    }

    CONFIG.stakeInicial = stake;
    CONFIG.protegerEmpate = protOn;
    CONFIG.valorProtecaoEmpate = protValor;
    CONFIG.stopWin = sw;
    CONFIG.stopLoss = sl;

    // Persiste em chrome.storage pra sobreviver a reload
    try {
      chrome.storage.local.get('config', (data) => {
        const c = data?.config || {};
        c.stakeInicial = stake;
        c.protegerEmpate = protOn;
        c.valorProtecaoEmpate = protValor;
        c.stopWin = sw;
        c.stopLoss = sl;
        chrome.storage.local.set({ config: c });
      });
    } catch (_) {}

    // Reset stops no DecisionEngine pra contar a partir de agora
    try {
      if (typeof DecisionEngine !== 'undefined' && DecisionEngine.getState) {
        const st = DecisionEngine.getState();
        if (st && st.motivoParada && (st.motivoParada.includes('Stop Win') || st.motivoParada.includes('Stop Loss'))) {
          st.motivoParada = null;
          addLog('🔄 Stop anterior limpo — novos limites aplicados', 'info');
        }
      }
    } catch (_) {}

    const protLabel = protOn ? `R$${protValor}` : 'DESPROTEGIDO';
    setQuickConfigStatus(`✅ aplicado: stake R$${stake} prot ${protLabel} SW R$${sw} SL R$${sl}`, '#86efac');
    addLog(`💵 Quick Config aplicado: stake=R$${stake} prot=${protLabel} SW=R$${sw} SL=R$${sl}`, 'success');
    refreshSafetyBadges();
    return true;
  }

  function setQuickConfigStatus(texto, cor) {
    const el = document.getElementById('bb-qc-status');
    if (el) { el.textContent = texto; el.style.color = cor || '#94a3b8'; }
  }

  /**
   * Preenche os inputs com valores SUGERIDOS pela banca atual (nao aplica ainda).
   * Diego (18/05): "sugerir banca de R$15 com stop win de R$1000 nao faz sentido".
   */
  // Fichas oficiais BetBoom para snap dos selects.
  const FICHAS_BB = [5, 10, 25, 125, 500, 2500, 5000, 12000];

  // Arredonda pra ficha mais proxima (pra baixo) — selects so aceitam valores listados.
  function snapFicha(valor) {
    const v = Number(valor);
    if (!Number.isFinite(v) || v < 5) return 5;
    let candidato = FICHAS_BB[0];
    for (const f of FICHAS_BB) if (f <= v) candidato = f;
    return candidato;
  }

  function preencherSugestao() {
    const sug = sugerirValoresPorBanca();
    const stakeEl = document.getElementById('bb-qc-stake');
    const protValEl = document.getElementById('bb-qc-protvalor');
    const swEl = document.getElementById('bb-qc-stopwin');
    const slEl = document.getElementById('bb-qc-stoploss');
    if (stakeEl) stakeEl.value = String(snapFicha(sug.stake));
    if (protValEl) protValEl.value = String(sug.prot > 0 ? snapFicha(sug.prot) : 0);
    if (swEl) swEl.value = sug.sw;
    if (slEl) slEl.value = sug.sl;
    setQuickConfigStatus(`💡 sugerido (${sug.motivo}). Clique ✅ APLICAR pra confirmar.`, '#c084fc');
  }

  // Detecta mudanca brusca da banca (3x ou +) e sugere reajustar.
  let _ultimaBancaSugerida = null;
  function detectarBancaIncoerente() {
    const banca = Number(CONFIG.saldoReal || 0);
    if (banca <= 0) return;
    const sw = Number(CONFIG.stopWin || 0);
    // Se stop win > 50% da banca OU < 5% da banca = desproporcional
    const ratio = sw / banca;
    if ((ratio > 0.5 || ratio < 0.05) && _ultimaBancaSugerida !== Math.floor(banca)) {
      _ultimaBancaSugerida = Math.floor(banca);
      setQuickConfigStatus(`⚠ STOP WIN R$${sw} desproporcional pra banca R$${banca.toFixed(2)}. Clique 💡 SUGERIR.`, '#fbbf24');
    }
  }

  /**
   * Carrega valores salvos do chrome.storage e preenche os inputs.
   */
  function carregarQuickConfig() {
    try {
      chrome.storage.local.get('config', (data) => {
        const c = data?.config || {};
        const stake = c.stakeInicial != null ? c.stakeInicial : CONFIG.stakeInicial;
        const protVal = c.protegerEmpate === true ? (c.valorProtecaoEmpate || 0) : 0;
        const sw = c.stopWin || CONFIG.stopWin;
        const sl = c.stopLoss || CONFIG.stopLoss;
        const stakeEl = document.getElementById('bb-qc-stake');
        const protValEl = document.getElementById('bb-qc-protvalor');
        const swEl = document.getElementById('bb-qc-stopwin');
        const slEl = document.getElementById('bb-qc-stoploss');
        // Snap pra ficha listada nos selects
        if (stakeEl) stakeEl.value = String(snapFicha(stake));
        if (protValEl) protValEl.value = String(protVal > 0 ? snapFicha(protVal) : 0);
        if (swEl) swEl.value = sw;
        if (slEl) slEl.value = sl;
        setQuickConfigStatus('valores carregados', '#94a3b8');
      });
    } catch (_) {}
  }

  /**
   * Atualiza badges de SAFETY (banca, P/L, stop win, stop loss) — Diego (18/05):
   * "respeitar stop win e stop loss" + tudo visivel no overlay.
   * Le DecisionEngine state + CONFIG.
   */
  function refreshSafetyBadges() {
    try {
      const state = typeof DecisionEngine !== 'undefined' && DecisionEngine.getState
        ? DecisionEngine.getState() : {};
      const banca = Number(state.bancaAtual || CONFIG.saldoReal || 0);
      const pl = Number(state.lucroSessao || 0);
      const sw = Number(CONFIG.stopWin || 0);
      const sl = Number(CONFIG.stopLoss || 0);

      const bancaEl = document.getElementById('bb-banca-badge');
      if (bancaEl) bancaEl.textContent = `💰 BANCA: R$ ${banca.toFixed(2)}`;

      const plEl = document.getElementById('bb-pl-badge');
      if (plEl) {
        const sinal = pl >= 0 ? '+' : '';
        plEl.textContent = `📈 P/L: ${sinal}R$ ${pl.toFixed(2)}`;
        if (pl > 0) {
          plEl.style.background = 'rgba(34,197,94,0.15)';
          plEl.style.borderColor = 'rgba(34,197,94,0.5)';
          plEl.style.color = '#86efac';
        } else if (pl < 0) {
          plEl.style.background = 'rgba(239,68,68,0.15)';
          plEl.style.borderColor = 'rgba(239,68,68,0.5)';
          plEl.style.color = '#fca5a5';
        }
      }

      const swEl = document.getElementById('bb-stopwin-badge');
      if (swEl) {
        const restante = sw - pl;
        const atingiu = pl >= sw;
        swEl.textContent = atingiu
          ? `🎯 STOP WIN: ✅ ATINGIDO R$ ${sw}`
          : `🎯 STOP WIN: R$ ${sw} (falta R$ ${Math.max(0, restante).toFixed(2)})`;
        if (atingiu) {
          swEl.style.background = 'rgba(34,197,94,0.3)';
          swEl.style.color = '#22c55e';
        }
      }

      const slEl = document.getElementById('bb-stoploss-badge');
      if (slEl) {
        const perdaAtual = pl < 0 ? Math.abs(pl) : 0;
        const margem = sl - perdaAtual;
        const atingiu = perdaAtual >= sl;
        slEl.textContent = atingiu
          ? `🛡 STOP LOSS: ✅ ATINGIDO R$ ${sl}`
          : `🛡 STOP LOSS: R$ ${sl} (margem R$ ${margem.toFixed(2)})`;
        if (atingiu) {
          slEl.style.background = 'rgba(239,68,68,0.35)';
          slEl.style.color = '#dc2626';
          slEl.style.fontWeight = '900';
        }
      }
    } catch (_) {}
  }

  /**
   * Sincroniza UI do MODO OBSERVACAO (Diego, 18/05).
   * Acionado por: botao manual, auto-detect saldo < stake minimo, carga inicial.
   */
  function setModoObservacaoUI(on) {
    CONFIG.modoTeste = !!on;
    try { chrome.storage.local.set({ 'bb-modo-teste': !!on }); } catch (_) {}
    const banner = document.getElementById('bb-obs-banner');
    if (banner) banner.style.display = on ? 'block' : 'none';
    const btn = document.getElementById('bb-btn-modo-teste');
    if (btn) {
      if (on) {
        btn.textContent = '🎯 APOSTAR';
        btn.title = 'Desliga MODO OBSERVACAO — robo volta a clicar de verdade';
        btn.style.background = 'linear-gradient(135deg,#a855f7,#7c3aed)';
      } else {
        btn.textContent = '🧪 OBSERVAR';
        btn.title = 'Liga MODO OBSERVACAO — bot decide mas nao clica';
        btn.style.background = 'linear-gradient(135deg,#475569,#334155)';
      }
    }
    if (on) addLog('🧪 MODO OBSERVAÇÃO ATIVO — bot decide mas nao clica', 'warn');
    else addLog('🎯 Modo APOSTAR — bot volta a clicar de verdade', 'success');
  }

  // Auto-detect: saldo < stake minimo -> liga modoTeste automaticamente
  let _modoTesteAutoSetado = false;
  function autoDetectarSaldoInsuficiente() {
    const saldo = Number(CONFIG.saldoReal);
    const stakeMin = Number(CONFIG.stakeInicial || 5);
    if (!Number.isFinite(saldo)) return;
    if (saldo < stakeMin && !CONFIG.modoTeste && !_modoTesteAutoSetado) {
      _modoTesteAutoSetado = true;
      addLog(`💸 Saldo R$ ${saldo.toFixed(2)} < stake minimo R$ ${stakeMin} — ligando MODO OBSERVACAO automatico`, 'warn');
      setModoObservacaoUI(true);
    }
  }

  function setAutoStartUI(icon, label, color) {
    const iconEl = document.getElementById('bb-autostart-icon');
    const labelEl = document.getElementById('bb-autostart-label');
    if (iconEl) iconEl.textContent = icon;
    if (labelEl) {
      labelEl.textContent = label;
      if (color) labelEl.style.color = color;
    }
  }

  /**
   * Sincroniza botões INICIAR (barra rápida + seção) com estado real do bot.
   * Diego (17/05): "se esta iniciado, porque eu deveria ver o iniciar
   * disponivel?" — botões refletem estado: ativo = desabilitado/cinza.
   */
  function setBotControlsUI(isAtivo) {
    const quickStart = document.getElementById('bb-btn-quick-start');
    if (quickStart) {
      if (isAtivo) {
        // Diego (17/05): botao virou REINICIAR — acao util em vez de cinza inerte.
        // Para + reinicia (sem setar flag de parada manual, diferente de PARAR).
        quickStart.textContent = '🔄 REINICIAR';
        quickStart.dataset.mode = 'restart';
        quickStart.disabled = false;
        quickStart.style.background = 'linear-gradient(135deg,#f59e0b,#d97706)';
        quickStart.style.boxShadow = '0 2px 6px rgba(245,158,11,0.4)';
        quickStart.style.cursor = 'pointer';
        quickStart.style.opacity = '1';
        quickStart.title = 'Reinicia o robô (para + inicia de novo, sem desligar auto-start).';
      } else {
        quickStart.textContent = '▶ INICIAR';
        quickStart.dataset.mode = 'start';
        quickStart.disabled = false;
        quickStart.style.background = 'linear-gradient(135deg,#16a34a,#15803d)';
        quickStart.style.boxShadow = '0 2px 6px rgba(22,163,74,0.4)';
        quickStart.style.cursor = 'pointer';
        quickStart.style.opacity = '1';
        quickStart.title = 'Liga o robô (mesmo que ▶ Iniciar)';
      }
    }
    const startBtn = document.getElementById('bb-btn-start');
    if (startBtn) {
      startBtn.disabled = isAtivo;
      startBtn.style.opacity = isAtivo ? '0.5' : '1';
      startBtn.style.cursor = isAtivo ? 'not-allowed' : 'pointer';
    }
  }

  /**
   * Reinicia o bot — para + inicia de novo, sem mexer na flag de parada manual.
   * Util quando Will quer "comecar limpo" mid-sessao sem desligar o auto-start.
   */
  function reiniciarBot() {
    addLog('🔄 Reiniciando bot…', 'info');
    setAutoStartUI('🔄', 'Bot REINICIANDO…', '#fbbf24');
    try {
      // Para componentes internos sem setar bb-paradoManual=true
      if (typeof DecisionEngine !== 'undefined' && DecisionEngine.parar) DecisionEngine.parar();
      if (typeof Collector !== 'undefined' && Collector.parar) Collector.parar();
      if (updateInterval) { clearInterval(updateInterval); updateInterval = null; }
    } catch (e) {
      console.warn('[REINICIAR] erro ao parar:', e?.message || e);
    }
    // Pequeno delay pra estado interno assentar antes do start
    setTimeout(() => {
      try {
        iniciarBot();
        addLog('✅ Bot reiniciado.', 'success');
      } catch (e) {
        console.error('[REINICIAR] erro ao iniciar:', e);
        addLog(`❌ Reiniciar falhou: ${e?.message || e}`, 'error');
        setAutoStartUI('❌', `Reiniciar falhou: ${e?.message || e}`, '#f87171');
      }
    }, 250);
  }

  function tentarAutoStart() {
    let tentativas = 0;
    const MAX_TENTATIVAS = 60;

    chrome.storage.local.get('bb-paradoManual', (data) => {
      if (data && data['bb-paradoManual'] === true) {
        console.log('[AUTO-START] desligado — Will parou manualmente. Clique ▶ Iniciar pra reativar.');
        addLog('🟡 Auto-start desligado (parou manualmente). Use ▶ Iniciar.', 'info');
        setAutoStartUI('🟡', 'Auto-start DESLIGADO — Will parou manualmente. Clique ▶ INICIAR.', '#fbbf24');
        return;
      }

      setAutoStartUI('⏳', 'Auto-start: aguardando mesa carregar (WS)…', '#c7d2fe');

      const interval = setInterval(() => {
        tentativas++;
        if (tentativas > MAX_TENTATIVAS) {
          clearInterval(interval);
          console.warn('[AUTO-START] desistiu apos 60s — modoPassivo nunca virou false');
          addLog('⚠️ Auto-start desistiu — clique ▶ Iniciar manualmente', 'warn');
          setAutoStartUI('⚠️', 'Auto-start DESISTIU após 60s. Clique ▶ INICIAR manualmente.', '#f87171');
          return;
        }
        // Ja rodando?
        try {
          const state = typeof DecisionEngine !== 'undefined' ? DecisionEngine.getState?.() : null;
          if (state?.isAtivo) {
            clearInterval(interval);
            console.log('[AUTO-START] DecisionEngine ja esta ativo — nada a fazer');
            setAutoStartUI('🟢', 'Auto-start: bot JÁ RODANDO (DecisionEngine ativo).', '#86efac');
            setBotControlsUI(true);
            return;
          }
        } catch (_) {}
        // Mesa detectada?
        if (CONFIG.modoPassivo) {
          if (tentativas % 5 === 0) {
            setAutoStartUI('⏳', `Auto-start: aguardando WS evo-game… (${tentativas}/60s)`, '#c7d2fe');
          }
          return; // ainda esperando WS evo-game
        }
        // Tudo certo — inicia
        clearInterval(interval);
        try {
          console.log(`[AUTO-START] 🟢 disparando iniciarBot() automaticamente (tentativa ${tentativas})`);
          addLog('▶ Auto-start: bot iniciado automaticamente', 'success');
          setAutoStartUI('🟢', `Auto-start ATIVO — bot iniciado automaticamente (em ${tentativas}s).`, '#86efac');
          iniciarBot();
        } catch (e) {
          console.error('[AUTO-START] Erro:', e);
          addLog(`❌ Auto-start falhou: ${e?.message || e}`, 'error');
          setAutoStartUI('❌', `Auto-start FALHOU: ${e?.message || e}`, '#f87171');
        }
      }, 1000);
    });
  }

  /**
   * Inicia o bot.
   */
  function iniciarBot() {
    // Limpa flag de parada manual — proximos reloads/aberturas voltam ao auto-start.
    try { chrome.storage.local.set({ 'bb-paradoManual': false }); } catch (_) {}
    setAutoStartUI('🟢', 'Bot ATIVO — auto-start religado para próximos reloads.', '#86efac');
    setBotControlsUI(true);
    chrome.storage.local.get('config', (data) => {
      if (data.config) {
        BBConfigUtils.applyPersistedConfig(CONFIG, data.config);
      }

      // Usar o saldo real lido do WS como banca inicial. Fallback para bancaInicial se saldo ainda não chegou.
      const bancaParaIniciar = Number.isFinite(Number(CONFIG.saldoReal)) && Number(CONFIG.saldoReal) > 0
        ? Number(CONFIG.saldoReal)
        : CONFIG.bancaInicial;
      Collector.iniciar({ usarDOM: false });
      DecisionEngine.iniciar(bancaParaIniciar);
      if (typeof ObservabilityEngine !== 'undefined' && ObservabilityEngine.iniciarSessao) {
        ObservabilityEngine.iniciarSessao({
          saldoInicial: Number.isFinite(Number(CONFIG.saldoReal)) ? Number(CONFIG.saldoReal) : null
        });
      }
      aplicarModoDebug();

      // Registrar callback para novos resultados
      // ⚡ SINCRONIZAÇÃO ZERO LATENCY (WS TRIGGER)
    if (typeof EventBus !== 'undefined') {
      addLog('Sincronização WS Ativa', 'success');
      EventBus.on('bb:BACBO_BETTING_OPEN', (payload) => {
        Logger.info('[WS] Gatilho de abertura de mesa recebido');
        Overlay.atualizarRaciocinio('⚡ Gatilho detectado via WebSocket!', 'warn');
        // Se houver uma decisão armada e o estado da mesa permitir, dispara agora!
        if (decisaoArmada && !decisaoArmada.executando) {
          addLog('Gatilho WS: Execução Instantânea', 'warn');
          tentarExecutarDecisaoArmada('ws-trigger');
        }
      });
    }

    Collector.onNovoResultado(async (novos, historico) => {
        const ultimoResultado = novos[novos.length - 1];

        console.log(`[HistoryLifecycle] CALLBACK onNovoResultado | historico.length=${historico.length} | roundId=${ultimoResultado?.roundId}`);

        const entradaResolvida = DecisionEngine.registrarResultadoConfirmado(ultimoResultado);

        // ─── INTEGRIDADE: realHistory vem como parâmetro para assessIntegrity() abaixo ───
        // atualizarRealHistory / atualizarRenderedHistory não existem na API atual.
        // renderedHistory é lido do DOM via HistoryRenderer.getRenderedHistory() abaixo.

        if (typeof ObservabilityEngine !== 'undefined' && ObservabilityEngine.registrarResultado) {
          ObservabilityEngine.registrarResultado(ultimoResultado, {
            entry: entradaResolvida,
            history: getHistoricoCores(historico),
            roundId: ultimoResultado?.roundId || ultimoResultado?.gameId || CONFIG.roundIdAtual || null,
            rodadaNumero: ultimoResultado?.rodada || Collector.getRodadaAtual()
          });
        }
        if (entradaResolvida) {
          registrarResultadoExecucaoTelemetry(entradaResolvida, ultimoResultado);
          atualizarEntradaExecutada(entradaResolvida);
          const _labelIndicada = BBStrategyUtils.getEntryLabel(entradaResolvida.entradaSugerida || entradaResolvida.entradaExecutada);
          const _labelMesa     = BBStrategyUtils.getEntryLabel(entradaResolvida.resultadoRodada || ultimoResultado?.cor);
          const _icone = entradaResolvida.statusFinal === 'win' ? '✅' : (entradaResolvida.statusFinal === 'loss' ? '❌' : '⚠️');
          addLog(
            `R.${entradaResolvida.roundId || ultimoResultado.roundId || '—'} | Indicada: ${_labelIndicada} | Mesa: ${_labelMesa} | ${_icone} ${entradaResolvida.statusFinal.toUpperCase()}`,
            entradaResolvida.statusFinal === 'win' ? 'success' : (entradaResolvida.statusFinal === 'loss' ? 'error' : 'warn')
          );
        }

        // Integridade é observabilidade — não gate. assessIntegrity é chamado em atualizarUI (após render).
        atualizarUI();

        // Guard antecipado: evita chamar decidir() duas vezes para o mesmo round.
        // Usa ultimoResultado.roundId (mesmo para ambos os callbacks bacbo.road do mesmo round)
        // em vez de getDecisionRoundKey (que retorna signatures diferentes por callback).
        const currentRoundId = ultimoResultado?.roundId || ultimoResultado?.gameId || null;
        if (currentRoundId && ultimaDecisaoRoundKey === currentRoundId) {
          return;
        }
        ultimaDecisaoRoundKey = currentRoundId || getDecisionRoundKey(novos, historico);

        // Analisar e decidir
        const cores = Collector.getCoresRecentes(20);
        // decidir() é async — precisa de await para receber o objeto resolvido
        // (sem await, decisao vira Promise e decisao.deveApostar === undefined)
        const decisao = await DecisionEngine.decidir(cores);

        // ═══════════ REGRA EMPATE → AZUL (Diego, 16/05) ═══════════
        // Observação empírica do operador: toda vez que o decisor sugere EMPATE,
        // a rodada sai AZUL (player). Em vez de bloquear, invertemos a sugestão
        // antes de armar. Não mexe em patterns.js / decision.js (mantém os 18
        // padrões intactos), só sobrescreve a `cor` final no caminho operacional.
        // Reversível: setar CONFIG.empateInverteParaAzul = false desliga em runtime.
        if (decisao && decisao.cor === 'empate' && CONFIG.empateInverteParaAzul !== false) {
          const padraoNome = decisao.padrao?.nome || '?';
          console.log(`%c[EMPATE→AZUL] ${padraoNome} sugeriu EMPATE — invertendo pra AZUL (regra empírica)`, 'color:#fbbf24;font-weight:bold');
          addLog(`🔄 ${padraoNome}: EMPATE → AZUL (regra observada)`, 'warn');
          decisao.corOriginal = 'empate';
          decisao.cor = 'azul';
          // Sincroniza com `padrao.acao` pra observability/telemetry verem o mesmo
          if (decisao.padrao) {
            decisao.padrao.acao_original_empate = decisao.padrao.acao;
            decisao.padrao.acao = 'azul';
          }
          // Proteção empate não faz sentido quando a aposta JÁ É no empate revertido
          decisao.protecaoEmpate = false;
          decisao.valorProtecao = 0;
        }
        // ═════════════════════════════════════════════════════════════════

        // ═══════ REGRA INVERSÃO POR FAIXAS DE CONVICÇÃO (Diego, 16-17/05) ═══════
        // Observações empíricas:
        //   - 56% costuma INVERTER → faixa [50,60]
        //   - 74% costuma INVERTER → faixa [70,78]
        //   - 69% NÃO inverte (acerta) → fora das faixas (protegido)
        //   - ≥80% NÃO inverte → fora das faixas
        // CONFIG.inverterConvictionFaixas é uma lista de [min,max] inclusivos.
        // Se conviction cair em QUALQUER faixa, inverte azul↔vermelho.
        // Reversível: CONFIG.inverterFaixaConviction = false desliga.
        if (decisao && CONFIG.inverterFaixaConviction !== false) {
          const conv = Number(decisao.convictionScore);
          const faixas = Array.isArray(CONFIG.inverterConvictionFaixas)
            ? CONFIG.inverterConvictionFaixas
            : [[50, 60], [70, 78]];
          const corPodeInverter = decisao.cor === 'azul' || decisao.cor === 'vermelho';
          // Encontra a faixa em que cai (se houver)
          const faixaMatch = faixas.find(([min, max]) => conv >= min && conv <= max);
          if (Number.isFinite(conv) && faixaMatch && corPodeInverter) {
            const padraoNome = decisao.padrao?.nome || '?';
            const original = decisao.cor;
            const invertida = original === 'azul' ? 'vermelho' : 'azul';
            console.log(`%c[INV-CONV ${conv}%] ${padraoNome}: ${original.toUpperCase()} → ${invertida.toUpperCase()} (faixa ${faixaMatch[0]}-${faixaMatch[1]}%)`, 'color:#f97316;font-weight:bold');
            addLog(`🔄 ${padraoNome} conv ${conv}%: ${original} → ${invertida} (faixa ${faixaMatch[0]}-${faixaMatch[1]}%)`, 'warn');
            decisao.corOriginalFaixa = original;
            decisao.cor = invertida;
            if (decisao.padrao) {
              decisao.padrao.acao_original_faixa = decisao.padrao.acao;
              decisao.padrao.acao = invertida;
            }
          }
        }
        // ═════════════════════════════════════════════════════════════════

        // Atualizar padrão detectado e entrada sugerida no overlay
        if (decisao.padrao) {
          decisao.padrao.decisionModel = decisao.decisionModel || null;
          atualizarPadrao(decisao.padrao);
          atualizarEntradaSugerida(decisao);
          const raciocinio = decisao.explicacaoNatural
            ? `${decisao.padrao.nome}: ${decisao.explicacaoNatural}${decisao.autoExecute ? ' · AUTODRIVE' : ' · HITL'}`
            : `${decisao.padrao.nome} detectado com ${decisao.confianca}% de confiança.`;
          Overlay.atualizarRaciocinio(raciocinio, 'success');
          Overlay.atualizarConfianca(decisao.confianca);
        } else {
          // Modo estrito WMSG (Diego, 17/05): se nenhum dos 18 WMSG bater,
          // mostra explicitamente "Aguardando padrao" e limpa qualquer
          // sugestao anterior, pra Will saber que o robo NAO tem indicacao.
          const padraoEl = document.getElementById('bb-padrao');
          if (padraoEl) padraoEl.textContent = '🕓 Aguardando padrão WMSG';
          const corEl = document.getElementById('bb-entrada-cor');
          if (corEl) { corEl.textContent = '—'; corEl.className = 'bb-entry-color'; }
          const galeEl = document.getElementById('bb-entrada-gale');
          if (galeEl) galeEl.textContent = '';
          const confEl = document.getElementById('bb-confianca');
          if (confEl) confEl.textContent = '';
          Overlay.atualizarRaciocinio('🕓 Aguardando algum dos 18 padrões WMSG bater no histórico…', 'info');
          Overlay.atualizarConfianca(0);
        }

        if (decisao.padrao) {
          const roundKey = ultimaDecisaoRoundKey;
          const validacao = validarDecisao(decisao, historico);
          const rodadaOperador = Collector.getRodadaAtual();
          const analytics = typeof ObservabilityEngine !== 'undefined' && ObservabilityEngine.registrarDecisao
            ? ObservabilityEngine.registrarDecisao(decisao, {
              roundId: roundKey || CONFIG.roundIdAtual || null,
              roundKey,
              rodadaNumero: rodadaOperador,
              history: getHistoricoCores(historico),
              detectedStrategies: typeof PatternEngine !== 'undefined' && PatternEngine.getLastDetectedStrategies
                ? PatternEngine.getLastDetectedStrategies()
                : []
            })
            : null;

          if (analytics?.decision) {
            decisao.analytics = analytics;
          }

          registrarDecisionTelemetry(decisao, historico, roundKey, validacao);
          logDecisionConsole(decisao);
          atualizarDebug(decisao, validacao);

          if (!validacao.ok) {
            logDecisionErrors(decisao, validacao.erros);
            addLog(`ERROR_DECISION: ${validacao.erros[0]}`, 'warn');
          }

          console.log(`[BB-FLOW] deveApostar=${decisao.deveApostar} | modoTeste=${CONFIG.modoTeste} | estado=${CONFIG.estadoRodadaAtual} | cor=${decisao.cor} | source=${decisao.source || decisao.padrao?.source || '?'}`);

          // GUARD ORIGEM (Diego, 18/05): "validar que so entra quando detectado
          // padroes do Will". Source tem que comecar com 'wmsg' (wmsg, wmsg-line,
          // wmsg-diag). Qualquer outra origem -> NAO arma, NAO clica.
          const origemRaw = (decisao.source || decisao.padrao?.source || '').toLowerCase();
          const origemEhWmsg = origemRaw.startsWith('wmsg');
          const origemBadge = document.getElementById('bb-origem-badge');
          if (origemBadge) {
            if (origemEhWmsg) {
              origemBadge.textContent = `🔒 ORIGEM: ✅ ${origemRaw}`;
              origemBadge.style.background = 'rgba(34,197,94,0.15)';
              origemBadge.style.borderColor = 'rgba(34,197,94,0.5)';
              origemBadge.style.color = '#86efac';
            } else {
              origemBadge.textContent = `🔒 ORIGEM: 🚫 ${origemRaw || 'sem-padrao'} (bloqueado)`;
              origemBadge.style.background = 'rgba(239,68,68,0.18)';
              origemBadge.style.borderColor = 'rgba(239,68,68,0.5)';
              origemBadge.style.color = '#fca5a5';
            }
          }

          if (decisao.deveApostar) {
            if (!origemEhWmsg) {
              // Bloqueio cirurgico — decisao real existe mas nao eh WMSG
              addLog(`🚫 Decisao BLOQUEADA: source="${origemRaw}" nao eh WMSG (so 18 padroes oficiais entram)`, 'warn');
              console.warn(`[GUARD-ORIGEM] decisao bloqueada — source=${origemRaw}, esperado wmsg*`);
              if (typeof TelemetryStream !== 'undefined') TelemetryStream.push({
                type: 'guard_origem_bloqueado', source: origemRaw, cor: decisao.cor, padrao: decisao.padrao?.nome,
              });
              return;
            }
            if (typeof TelemetryStream !== 'undefined') TelemetryStream.push({
              type: 'decisao_tomada', cor: decisao.cor, source: origemRaw, padrao: decisao.padrao?.nome,
              stake: decisao.stake, conviction: decisao.convictionScore, gale: decisao.maxGalesPermitido,
              modoTeste: CONFIG.modoTeste,
            });
            addLog(`Rodada ${rodadaOperador}: ${decisao.padrao.nome} | ${BBStrategyUtils.getEntryLabel(decisao.cor)} | G${decisao.maxGalesPermitido} | ${CONFIG.modoTeste ? 'Simulado' : 'Aguardando clique'}`, 'info');
            if (CONFIG.modoTeste) {
              addLog(`Modo teste: ${decisao.padrao.nome} → ${decisao.cor} | G${decisao.maxGalesPermitido}`, 'warn');
            } else {
              if (!validacao.ok) {
                addLog('Validação debug com inconsistência leve — execução automática permitida', 'warn');
              }
              console.log(`[BB-FLOW] CHAMANDO armarDecisao + tentarExecutar`);
              armarDecisao(decisao, roundKey, rodadaOperador);
              tentarExecutarDecisaoArmada('pos-resultado');
            }
          } else if (decisao.decisionModel) {
            addLog(
              `Rodada ${rodadaOperador}: ${decisao.padrao.nome} | ${decisao.decisionModel.recomendacaoOperacional || 'nao-va'} | ${decisao.decisionModel.justificativas?.[0] || 'sem justificativa'}`,
              'warn'
            );
          }
        }

        atualizarUI();
      });

      // Atualizar UI
      document.getElementById('bb-btn-start').style.display = 'none';
      document.getElementById('bb-btn-pause').style.display = 'inline-block';
      document.getElementById('bb-btn-stop').style.display = 'inline-block';
      atualizarStatus(true);
      addLog('Bot iniciado! Estratégia Will ativa.', 'success');
      if (CONFIG.modoTeste) {
        addLog('Modo teste ativo — sem executar cliques reais', 'warn');
      }

      // Logar padrões ativos
      PatternEngine.logPadroesAtivos();

      atualizarUI();

      // Iniciar atualização periódica da UI
      console.log('[HistoryLifecycle] setInterval(atualizarUI, 2000) iniciado');
      updateInterval = setInterval(atualizarUI, 2000);
    });
  }

  /**
   * Pausa o bot.
   */
  function pausarBot() {
    const state = DecisionEngine.getState();
    if (state.isPausado) {
      DecisionEngine.retomar();
      document.getElementById('bb-btn-pause').textContent = '⏸ Pausar';
      addLog('Bot retomado', 'info');
    } else {
      DecisionEngine.pausar();
      document.getElementById('bb-btn-pause').textContent = '▶ Retomar';
      addLog('Bot pausado', 'warn');
    }
    atualizarUI();
  }

  /**
   * Para o bot.
   */
  function pararBot() {
    // Marca que foi parada MANUAL — desliga auto-start ate Will clicar Iniciar de novo.
    try { chrome.storage.local.set({ 'bb-paradoManual': true }); } catch (_) {}
    setAutoStartUI('🟡', 'Bot PARADO manualmente — auto-start desligado nos próximos reloads.', '#fbbf24');
    setBotControlsUI(false);
    DecisionEngine.parar();
    Collector.parar();

    if (updateInterval) {
      clearInterval(updateInterval);
      updateInterval = null;
    }

    document.getElementById('bb-btn-start').style.display = 'inline-block';
    document.getElementById('bb-btn-pause').style.display = 'none';
    document.getElementById('bb-btn-stop').style.display = 'none';
    atualizarStatus(false);
    addLog('Bot parado', 'warn');
    if (typeof ObservabilityEngine !== 'undefined' && ObservabilityEngine.encerrarSessao) {
      ObservabilityEngine.encerrarSessao('parado-pelo-operador');
    }

    // Limpar padrão e entrada
    const padraoEl = document.getElementById('bb-padrao');
    if (padraoEl) padraoEl.textContent = '—';
    const confEl = document.getElementById('bb-confianca');
    if (confEl) confEl.textContent = '';
    const corEl = document.getElementById('bb-entrada-cor');
    if (corEl) { corEl.textContent = '—'; corEl.className = 'bb-entry-color'; }
    const galeEl = document.getElementById('bb-entrada-gale');
    if (galeEl) galeEl.textContent = '';
    ultimaDecisaoRoundKey = null;
    ultimoDebugKey = null;
    ultimoResumoEntradaKey = null;
    decisaoArmada = null;
    aplicarModoDebug();

    atualizarUI();
  }

  /**
   * Testa a detecção de elementos.
   */
  function testarDeteccao() {
    const resultado = Executor.testarDeteccao();
    const el = document.getElementById('bb-detection-result');

    let html = '<div style="margin-top:4px;">';
    html += `<div>${resultado.historicoContainer ? '✅' : '❌'} Histórico</div>`;
    html += `<div>${resultado.btnVermelho ? '✅' : '❌'} Btn Vermelho</div>`;
    html += `<div>${resultado.btnAzul ? '✅' : '❌'} Btn Azul</div>`;
    html += `<div>${resultado.btnEmpate ? '✅' : '❌'} Btn Empate</div>`;
    html += `<div>${resultado.inputStake ? '✅' : '❌'} Input Stake</div>`;
    html += `<div>${resultado.timer ? '✅' : '❌'} Timer</div>`;
    html += `<div style="margin-top:4px;font-weight:bold;">${resultado.pronto ? '✅ PRONTO' : '⚠️ Ajuste os seletores'}</div>`;
    html += '</div>';

    el.innerHTML = html;
    addLog('Detecção testada', 'info');
  }

  /**
   * Atualiza o status visual do bot.
   */
  function atualizarStatus(ativo) {
    const dot = document.getElementById('bb-dot');
    const text = document.getElementById('bb-status-text');

    if (!dot || !text) return;

    if (CONFIG.modoPassivo) {
      dot.className = 'bb-dot bb-dot-passive';
      text.textContent = 'Modo Passivo';
      return;
    }

    if (ativo) {
      const state = DecisionEngine.getState();
      if (state.isPausado) {
        dot.className = 'bb-dot bb-dot-pause';
        text.textContent = 'Pausado';
      } else {
        dot.className = 'bb-dot bb-dot-on';
        text.textContent = 'Ativo';
      }
    } else {
      dot.className = 'bb-dot bb-dot-off';
      text.textContent = 'Inativo';
    }
  }

  function atualizarStatusOperador() {
    const el = document.getElementById('bb-operator-status');
    if (!el) return;

    const partes = [];
    partes.push(operatorState.conectado ? 'Conectado' : 'Desconectado');
    partes.push(operatorState.lendoJogo ? 'Lendo jogo' : 'Esperando leitura');
    partes.push(operatorState.prontoParaOperar ? 'Pronto para operar' : 'Aguardando janela');

    const texto = partes.join(' • ');
    if (ultimoOperadorKey === texto) return;
    ultimoOperadorKey = texto;

    el.textContent = texto;
    el.className = `bb-value bb-small ${operatorState.prontoParaOperar ? 'bb-green' : (operatorState.conectado ? 'bb-yellow' : '')}`;
  }

  /**
   * Atualiza toda a UI do overlay.
   */
  function atualizarUI() {
    const historicoCheck = Collector.getHistorico ? Collector.getHistorico() : [];
    console.log(`[HistoryLifecycle] atualizarUI START | historicoCompleto.length=${historicoCheck.length}`);

    const stats = DecisionEngine.getEstatisticas();

    // Iluminar botão com entrada sugerida e atualizar percentuais
    const entradaSugerida = stats.ultimaDecisao?.cor || null;
    const btnPlayer = document.getElementById('bb-btn-click-player');
    const btnBanker = document.getElementById('bb-btn-click-banker');
    const btnTie = document.getElementById('bb-btn-click-tie');

    // Obter percentuais (assumindo que DecisionEngine retorna isso)
    const percentuais = stats.percentuaisSugestao || { azul: 0, vermelho: 0, empate: 0 };
    const percentPlayer = Math.round((percentuais.azul || 0) * 100) || 0;
    const percentBanker = Math.round((percentuais.vermelho || 0) * 100) || 0;
    const percentTie = Math.round((percentuais.empate || 0) * 100) || 0;

    // Atualizar percentuais nas bancadas
    const percPlayerEl = document.getElementById('bb-percent-player');
    const percBankerEl = document.getElementById('bb-percent-banker');
    const percTieEl = document.getElementById('bb-percent-tie');

    if (percPlayerEl) percPlayerEl.textContent = `${percentPlayer}%`;
    if (percBankerEl) percBankerEl.textContent = `${percentBanker}%`;
    if (percTieEl) percTieEl.textContent = `${percentTie}%`;

    [btnPlayer, btnBanker, btnTie].forEach(btn => {
      if (btn) btn.classList.remove('bb-suggested');
    });

    if (entradaSugerida === 'azul' && btnPlayer) btnPlayer.classList.add('bb-suggested');
    else if (entradaSugerida === 'vermelho' && btnBanker) btnBanker.classList.add('bb-suggested');
    else if (entradaSugerida === 'empate' && btnTie) btnTie.classList.add('bb-suggested');

    // Banca
    const bancaEl = document.getElementById('bb-banca');
    if (bancaEl) bancaEl.textContent = `R$ ${stats.bancaAtual.toFixed(2)}`;

    // Lucro
    const lucroEl = document.getElementById('bb-lucro');
    if (lucroEl) {
      lucroEl.textContent = `R$ ${stats.lucroSessao.toFixed(2)}`;
      lucroEl.className = `bb-value ${stats.lucroSessao >= 0 ? 'bb-green' : 'bb-red'}`;
    }

    // Gale
    const galeEl = document.getElementById('bb-gale');
    if (galeEl) galeEl.textContent = `${stats.galeAtual}/${CONFIG.maxGales}`;

    // Wins/Losses
    const winsEl = document.getElementById('bb-wins');
    if (winsEl) winsEl.textContent = stats.wins ?? stats.vitorias;
    const lossesEl = document.getElementById('bb-losses');
    if (lossesEl) lossesEl.textContent = stats.losses ?? stats.derrotas;
    const taxaEl = document.getElementById('bb-taxa');
    if (taxaEl) taxaEl.textContent = `${stats.taxaAcerto}%`;

    atualizarEntradaExecutada(stats.ultimaEntradaResolvida || stats.ultimaEntradaOperacional);

    // Status
    atualizarStatus(stats.isAtivo);
    atualizarStatusOperador();
    atualizarObservabilidade();

    // Motivo de parada
    if (stats.motivoParada && !stats.isAtivo) {
      const acaoEl = document.getElementById('bb-acao');
      if (acaoEl) acaoEl.textContent = stats.motivoParada;
    }

    // Tabuleiro histórico — grid fixo 156 slots (6×26), fonte única: Collector.getHistorico()
    const historicoCompleto = Collector.getHistorico ? Collector.getHistorico() : [];

    // ─── RENDER DO HISTÓRICO — VIEW ONLY ───────────────────────────────────────
    // OBRIGATÓRIO: render ANTES de assessIntegrity — senão vê DOM vazio → INVALID → bloqueia cliques.
    const tabuleiro = document.getElementById('bb-tabuleiro');
    if (tabuleiro) {
      if (typeof HistoryRenderer !== 'undefined') {
        HistoryRenderer.renderHistoryGrid(tabuleiro, historicoCompleto);
      } else {
        console.error('[HistoryRenderDebug] 🚨 HistoryRenderer não disponível');
        tabuleiro.innerHTML = '<div class="bb-tabuleiro-vazio">⚠️ HistoryRenderer ausente</div>';
      }
    } else {
      console.warn('[HistoryRenderDebug] #bb-tabuleiro não encontrado no DOM');
    }

    // VALIDAÇÃO DE INTEGRIDADE — sempre após render para que renderedNow reflita o estado atual
    if (typeof HistoryIntegrity !== 'undefined' && typeof HistoryRenderer !== 'undefined') {
      const _tabEl = document.getElementById('bb-tabuleiro');
      const renderedNow = _tabEl ? HistoryRenderer.getRenderedHistory(_tabEl) : [];
      const integrity = HistoryIntegrity.assessIntegrity(historicoCompleto, renderedNow);
      HistoryIntegrity.showIntegrityAlert(integrity);
      if (HistoryIntegrity.isBlocking()) {
        Logger.warn(`[HistoryIntegrity] OPERAÇÕES BLOQUEADAS: status=${integrity.status} | score=${integrity.score}`);
      }
    }

    // Ultimo Resultado com Transaction ID
    const txnEl = document.getElementById('bb-last-result');
    if (txnEl) {
      const runId = CONFIG.roundIdAtual || '-';
      const roundNum = Collector.getRodadaAtual?.() || '-';
      const ultimaCor = historicoCompleto.length > 0 ? historicoCompleto[historicoCompleto.length - 1].cor : 'AGUARDANDO';
      const outputTxt = ultimaCor ? ultimaCor.toUpperCase() : 'AGUARDANDO';
      txnEl.textContent = `Rod: ${roundNum} [Tx: ${runId}] -> ${outputTxt}`;
    }

    // Semáforo e Motivos
    if (typeof DecisionEngine !== 'undefined' && DecisionEngine.getSemaforoInfo) {
      const coresRecentes = Collector.getCoresRecentes ? Collector.getCoresRecentes(20) : [];
      const melhorPadrao = typeof PatternEngine !== 'undefined' && PatternEngine.melhorPadrao
        ? PatternEngine.melhorPadrao(coresRecentes)
        : null;
      const semaforo = DecisionEngine.getSemaforoInfo(coresRecentes, melhorPadrao);
      
      const semaforoStatus = document.getElementById('bb-semaforo-status');
      if (semaforoStatus) {
        semaforoStatus.textContent = semaforo.status;
        semaforoStatus.style.color = semaforo.corHTML;
      }
      
      const semaforoMotivo = document.getElementById('bb-semaforo-motivo');
      if (semaforoMotivo) {
        semaforoMotivo.innerHTML = semaforo.motivos.length > 0
          ? semaforo.motivos.join('<br>')
          : 'Nenhum motivo registrado.';
      }
    }

    // INTEGRIDADE DO HISTÓRICO é gerenciada por HistoryIntegrity.js
    // O módulo cuida de alertas, bloqueios e validação contínua

    // Atualizar abas contextuais
    atualizarAbaConsensus();
    atualizarAbaConviction();
    atualizarAbaSaude();
    atualizarAbaGrafo();
    atualizarAbaBreakpoints();

    // Badges operacionais (cal + hit-rate + WMSG): refresh em todo ciclo de UI.
    try { refreshHitRateBadge(); } catch (_) {}
    try { refreshWmsgBadge(); } catch (_) {}
    try { refreshSafetyBadges(); } catch (_) {}
    try { autoDetectarSaldoInsuficiente(); } catch (_) {}
    try { detectarBancaIncoerente(); } catch (_) {}
  }

  /**
   * Atualiza o padrão exibido no overlay.
   */
  function atualizarPadrao(padrao) {
    const el = document.getElementById('bb-padrao');
    const confEl = document.getElementById('bb-confianca');
    const model = padrao?.decisionModel || null;
    if (el && padrao) {
      el.textContent = padrao.nome;
      el.className = 'bb-value bb-pattern-name bb-pattern-active';
    }
    if (confEl && padrao) {
      const origem = padrao.source === 'will-default' ? 'Will' : (padrao.source === 'user' ? 'Usuário' : 'Sistema');
      const seq = padrao.recognizedSequence || padrao.sequenceBase || '—';
      const protecao = padrao.usarProtecaoEmpate === false ? 'Sem proteção' : 'Com proteção';
      const gale = `Gale ${Number.isFinite(Number(padrao.maxGalesPermitido)) ? Number(padrao.maxGalesPermitido) : (padrao.comGale ? 1 : 0)}`;
      const contexto = model?.contextoMesa ? ` • mesa ${model.contextoMesa}` : '';
      const recomendacao = model?.recomendacaoOperacional ? ` • ${model.recomendacaoOperacional}` : '';
      confEl.textContent = `${origem} • ${seq} • ${gale} • ${protecao}${contexto}${recomendacao}`;
    }
  }

  /**
   * Atualiza a entrada sugerida no overlay.
   */
  function atualizarEntradaSugerida(decisao) {
    const corEl = document.getElementById('bb-entrada-cor');
    const galeEl = document.getElementById('bb-entrada-gale');
    const model = getDecisionModel(decisao);

    if (corEl && decisao) {
      const cor = decisao.cor || decisao.padrao?.acao;
      if (cor === 'vermelho') {
        corEl.textContent = '🔴 VERMELHO / BANKER';
        corEl.className = 'bb-entry-color bb-entry-red';
      } else if (cor === 'azul') {
        corEl.textContent = '🔵 AZUL / PLAYER';
        corEl.className = 'bb-entry-color bb-entry-blue';
      } else if (cor === 'empate') {
        corEl.textContent = '🟢 EMPATE';
        corEl.className = 'bb-entry-color bb-entry-green';
      } else {
        corEl.textContent = '—';
        corEl.className = 'bb-entry-color';
      }
    }

    if (galeEl && decisao && decisao.padrao) {
      const gale = Number.isFinite(Number(decisao.maxGalesPermitido)) ? Number(decisao.maxGalesPermitido) : (decisao.padrao.comGale ? 1 : 0);
      const protecao = decisao.protecaoEmpate ? 'com proteção' : 'sem proteção';
      const contexto = model?.contextoMesa ? ` • mesa ${model.contextoMesa}` : '';
      galeEl.textContent = `(até G${gale} • ${protecao}${contexto})`;
    }
  }

  /**
   * Atualiza o status do iframe no overlay.
   */
  function atualizarStatusIframeUI(detectado) {
    const dot = document.getElementById('bb-iframe-dot');
    const text = document.getElementById('bb-iframe-text');

    if (!dot || !text) return;

    if (detectado) {
      dot.className = 'bb-dot bb-dot-on';
      text.textContent = 'Jogo carregado';
    } else {
      dot.className = 'bb-dot bb-dot-off';
      text.textContent = 'Jogo não detectado';
    }
  }

  /**
   * Adiciona uma entrada ao log.
   */
  function addLog(msg, type = 'info') {
    const logEl = document.getElementById('bb-log');
    if (!logEl) return;

    const logKey = `${type}:${msg}`;
    if (ultimoLogKey === logKey) {
      return;
    }
    ultimoLogKey = logKey;

    // PRD item 7: persistência simples em localStorage (rolling 200 entries).
    // Will consegue ver depois via `BBLog.exportar()` ou JSON.parse(localStorage.bb_claudinho_log)
    try {
      const KEY = 'bb_claudinho_log';
      const log = JSON.parse(localStorage.getItem(KEY) || '[]');
      log.unshift({ ts: Date.now(), type, msg });
      if (log.length > 200) log.length = 200;
      localStorage.setItem(KEY, JSON.stringify(log));
    } catch (_) { /* localStorage cheio ou bloqueado — segue só com UI */ }

    const time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const classe = type === 'error' ? 'bb-log-error' :
      type === 'success' ? 'bb-log-success' :
        type === 'warn' ? 'bb-log-warn' : 'bb-log-info';

    const entry = document.createElement('div');
    entry.className = `bb-log-entry ${classe}`;
    entry.textContent = `[${time}] ${msg}`;

    logEl.insertBefore(entry, logEl.firstChild);

    while (logEl.children.length > 50) {
      logEl.removeChild(logEl.lastChild);
    }

    // Atualizar última ação
    const acaoEl = document.getElementById('bb-acao');
    if (acaoEl) acaoEl.textContent = msg;
  }

  // --- API Pública ---
  return {
    // Expostos para TelemetryStreamer (comandos remotos via servidor):
    dispararCalibracao,
    pararBot,
    iniciarBot,
    setModoObservacaoUI,
    aplicarQuickConfig,
    inicializar() {
      const existente = document.getElementById('bb-auto-overlay');
      if (existente) existente.remove();

      console.log('[HistoryLifecycle] OVERLAY INICIALIZAR START | historicoCompleto.length=' + (Collector.getHistorico ? Collector.getHistorico().length : '?'));

      container = criarHTML();
      document.body.appendChild(container);
      tornarArrastavel(container);
      tornarModulosReordenaveis();
      restaurarOrdemModulos();
      carregarConfiguracoesAplicadas();
      vincularEventos();

      Logger.info('Overlay v2 inicializado.');
      // AUTO-START (Diego, 17/05): inicia automaticamente em todo carregamento/reload
      // do overlay, EXCETO quando Will parou manualmente (flag bb-paradoManual=true
      // persistida em chrome.storage.local). Resetada quando Will clica Iniciar manual.
      tentarAutoStart();

      // BADGES OPERACIONAIS (Diego, 17/05): calibracao + hit-rate + WMSG status.
      // Wire up:
      //  - Botao CAL dispara dispararCalibracao()
      //  - Evento bb-bet-confirmation atualiza hit-rate + dispara auto-cal apos 3 ❌
      //  - Bootstrap inicial dos badges (sem dados ainda)
      try {
        const calBtn = document.getElementById('bb-btn-cal-now');
        if (calBtn) {
          calBtn.addEventListener('click', () => {
            dispararCalibracao();
          });
        }
        // Estado inicial do badge cal: ler chrome.storage pra ver se ja foi calibrada
        chrome.storage.local.get('bb-cal-ts', (data) => {
          const ts = data && data['bb-cal-ts'];
          if (!ts) {
            setCalBadge('missing');
            // Auto-cal na primeira sessao (Diego, 17/05): se nunca calibrou, tenta sozinho
            // assim que WS de mesa estiver conectado.
            setTimeout(() => {
              if (!CONFIG.modoPassivo && !_autoCalEmCurso) {
                addLog('🎯 Primeira sessao sem calibracao — disparando automatica em 5s', 'info');
                setTimeout(() => dispararCalibracao(), 5000);
              }
            }, 8000);
          } else {
            const horasDesde = (Date.now() - ts) / (1000 * 60 * 60);
            if (horasDesde > 24) {
              setCalBadge('stale');
            } else {
              setCalBadge('ok', new Date(ts).toLocaleTimeString('pt-BR').slice(0,5));
            }
          }
        });
        window.addEventListener('bb-bet-confirmation', (ev) => {
          const veredito = ev?.detail?.veredito;
          if (veredito === 'CONFIRMADA') registrarSucessoClick();
          else if (veredito === 'NAO_ENTROU') registrarFalhaClick();
        });
        refreshHitRateBadge();
        refreshWmsgBadge();
        // MODO OBSERVACAO — botao + restaurar estado salvo (Diego, 18/05)
        const modoBtn = document.getElementById('bb-btn-modo-teste');
        if (modoBtn) {
          modoBtn.addEventListener('click', () => {
            setModoObservacaoUI(!CONFIG.modoTeste);
          });
        }
        chrome.storage.local.get('bb-modo-teste', (data) => {
          const salvo = data && data['bb-modo-teste'] === true;
          if (salvo || CONFIG.modoTeste) setModoObservacaoUI(true);
        });
        // QUICK CONFIG (Diego, 18/05): controles rapidos no topo
        carregarQuickConfig();
        const qcApply = document.getElementById('bb-btn-qc-apply');
        if (qcApply) qcApply.addEventListener('click', () => aplicarQuickConfig());
        const qcSuggest = document.getElementById('bb-btn-qc-suggest');
        if (qcSuggest) qcSuggest.addEventListener('click', () => preencherSugestao());
      } catch (e) {
        console.warn('[OPS-BADGES] falha no wireup:', e?.message || e);
      }
      ultimoSaldoKey = null;
      ultimoResultadoKey = null;
      ultimoEstadoKey = null;
      ultimoWsKey = null;
      ultimoLogKey = null;
      ultimoDebugKey = null;
      ultimaDecisaoRoundKey = null;
      ultimoOperadorKey = null;
      ultimoResumoEntradaKey = null;
      decisaoArmada = null;
      operatorState.conectado = false;
      operatorState.lendoJogo = false;
      operatorState.prontoParaOperar = false;
      aplicarModoDebug();
      atualizarStatusOperador();
      atualizarObservabilidade();
    },

    mostrar() {
      if (container) container.style.display = 'block';
    },

    esconder() {
      if (container) container.style.display = 'none';
    },

    addLog,

    mostrarResultadoClique(resultado) {
      const el = document.getElementById('bb-click-result');
      if (!el) return;
      const labels = { player: 'AZUL (Jogador)', banker: 'VERMELHO (Banca)', tie: 'EMPATE' };
      const label = labels[resultado.alvo] || resultado.alvo;
      if (resultado.ok) {
        el.textContent = `✅ Clicou em ${label} | ficha: ${resultado.chipValor || '?'}`;
        el.style.color = '#4caf50';
      } else {
        el.textContent = `❌ Falhou em ${label} — elemento não encontrado`;
        el.style.color = '#f44336';
      }
      // Também vai pro log principal
      this.addLog(resultado.ok ? `✅ ${label} clicado` : `❌ Falhou clicar ${label}`, resultado.ok ? 'success' : 'error');
    },
    atualizarUI,
    atualizarPadrao,
    atualizarEntradaSugerida,
    atualizarEntradaExecutada,
    atualizarObservabilidade,
    aplicarModoDebug,
    atualizarDebug,
    registrarEntradaManual,
    limparDecisaoArmada,

    /**
     * Aliases compatíveis com a API simplificada (versão Grok).
     * Não substituem o fluxo principal — apenas expõem entradas que outros
     * módulos/clientes possam usar para integrar com a Overlay sem conhecer
     * a API completa interna.
     */
    showSuggestion(decisao) {
      try {
        if (!decisao) return;
        const roundKey = decisao.roundKey || CONFIG.roundIdAtual || `manual-${Date.now()}`;
        const rodadaOp = decisao.rodadaOperador || (typeof Collector !== 'undefined' ? (Collector.getRodadaAtual?.() || 0) + 1 : 0);
        armarDecisao(decisao, roundKey, rodadaOp);
      } catch (e) {
        console.warn('[Overlay] showSuggestion falhou:', e?.message || e);
      }
    },
    hideSuggestion(motivo = null) {
      try {
        limparDecisaoArmada(motivo);
      } catch (e) {
        console.warn('[Overlay] hideSuggestion falhou:', e?.message || e);
      }
    },
    updateTabuleiro(historico) {
      try {
        // Delega para o HistoryRenderer (fonte de verdade do grid 156 slots).
        const tab = document.getElementById('bb-tabuleiro');
        if (tab && typeof HistoryRenderer !== 'undefined') {
          const hist = Array.isArray(historico) ? historico : (typeof Collector !== 'undefined' ? Collector.getHistorico?.() : []);
          HistoryRenderer.renderHistoryGrid(tab, hist || []);
        }
      } catch (e) {
        console.warn('[Overlay] updateTabuleiro falhou:', e?.message || e);
      }
    },

    atualizarStatusIframe(detectado) {
      atualizarStatusIframeUI(detectado);
    },

    atualizarSaldoReal(saldo) {
      const el = document.getElementById('bb-saldo-real');
      if (el && saldo !== null && saldo !== undefined) {
        const key = Number(saldo).toFixed(2);
        if (ultimoSaldoKey === key) return;
        ultimoSaldoKey = key;
        el.textContent = `R$ ${key}`;
        el.className = 'bb-value bb-green';
      }
    },

    atualizarUltimoResultado(resultado) {
      const el = document.getElementById('bb-last-result');
      if (!el) return;

      if (!resultado) {
        if (ultimoResultadoKey === 'empty') return;
        ultimoResultadoKey = 'empty';
        el.textContent = '—';
        el.className = 'bb-value';
        return;
      }

      const texto = `${resultado.vencedor} ${resultado.playerScore ?? '?'}x${resultado.bankerScore ?? '?'}`;
      if (ultimoResultadoKey === `${resultado.cor}:${texto}`) return;
      ultimoResultadoKey = `${resultado.cor}:${texto}`;
      el.textContent = texto;

      if (resultado.cor === 'vermelho') {
        el.className = 'bb-value bb-red';
      } else if (resultado.cor === 'azul') {
        el.className = 'bb-value bb-blue';
      } else if (resultado.cor === 'empate') {
        el.className = 'bb-value bb-green';
      } else {
        el.className = 'bb-value';
      }
    },

    atualizarEstadoRodada(estado) {
      console.log(`[DBG-Estado] atualizarEstadoRodada CHAMADA | estado=${JSON.stringify(estado)} | ultimoKey=${ultimoEstadoKey}`);
      if (!estado) return;

      const estadoObj = typeof estado === 'object' ? estado : { estado: estado };
      const label = estadoObj.estado || '—';
      const timer = estadoObj.timer;

      let text = label.charAt(0).toUpperCase() + label.slice(1);
      if (timer !== undefined && timer !== null) {
        text += ` (${timer}s)`;
      }

      const estadoMudou = ultimoEstadoKey !== text;
      if (estadoMudou) {
        ultimoEstadoKey = text;
      }

      // Atualizar DOM (opcional — elemento pode não existir)
      const el = document.getElementById('bb-round-state');
      if (el) {
        el.textContent = text;
        if (label === 'apostando') {
          el.className = 'bb-value bb-green';
        } else if (label === 'jogando') {
          el.className = 'bb-value bb-yellow';
        } else if (label === 'resultado') {
          el.className = 'bb-value bb-blue';
        } else if (label === 'fechado') {
          el.className = 'bb-value bb-red';
        } else {
          el.className = 'bb-value';
        }
      }

      console.log(`[DBG-Estado] estadoMudou=${estadoMudou} | label=${label} | text=${text}`);
      if (!estadoMudou) return;

      operatorState.prontoParaOperar = label === 'apostando' && operatorState.conectado && operatorState.lendoJogo;
      atualizarStatusOperador();

      console.log(`[DBG-Estado] PASSOU DO GUARD | label=${label} | chamando tentarExecutar=${label === 'apostando'}`);
      if (label === 'apostando') {
        tentarExecutarDecisaoArmada('mudanca-estado');
      }
    },

    atualizarStatusWS(payload) {
      const dot = document.getElementById('bb-ws-dot');
      const text = document.getElementById('bb-ws-text');
      const msgs = document.getElementById('bb-ws-msgs');

      if (!dot || !text) return;

      const channels = Array.isArray(payload.channels) ? payload.channels.filter(Boolean) : [];

      if (channels.length > 0) {
        dot.className = 'bb-dot bb-dot-on';
        text.textContent = channels.join(', ');
      } else if (payload.activeConnections > 0) {
        dot.className = 'bb-dot bb-dot-on';
        text.textContent = `${payload.activeConnections} conexão(ões) ativa(s)`;
      } else if (payload.totalConnections > 0) {
        dot.className = 'bb-dot bb-dot-pause';
        text.textContent = 'Conexões fechadas';
      } else {
        dot.className = 'bb-dot bb-dot-off';
        text.textContent = 'Sem conexões';
      }

      if (msgs) {
        const nextMsgs = `Total: ${payload.totalMessages} | Jogo: ${payload.gameMessages}`;
        const nextText = text.textContent;
        const nextKey = `${dot.className}|${nextText}|${nextMsgs}`;
        if (ultimoWsKey === nextKey) return;
        ultimoWsKey = nextKey;
        msgs.textContent = nextMsgs;
      }

      operatorState.conectado = channels.includes('evo-game') || payload.activeConnections > 0;
      operatorState.lendoJogo = Number(payload.totalMessages || 0) > 0;
      operatorState.prontoParaOperar = operatorState.conectado &&
        operatorState.lendoJogo &&
        CONFIG.estadoRodadaAtual === 'apostando';
      atualizarStatusOperador();
    },

    /**
     * Utilitário de Smoke Test solicitado pelo Diego.
     * Valida o ambiente e simula comportamento sem aposta real.
     */
    SmokeTest: {
      run() {
        console.log('%c🧬 [Smoke Test] Iniciando validação...', 'color: cyan; font-weight: bold;');
        const check = Executor.testarDeteccao ? Executor.testarDeteccao() : Executor.verificarElementos();
        
        console.table({
          'Botão Vermelho': check.btnVermelho ? '✅ Encontrado' : '❌ NÃO ENCONTRADO',
          'Botão Azul': check.btnAzul ? '✅ Encontrado' : '❌ NÃO ENCONTRADO',
          'Campo Stake': check.inputStake ? '✅ Encontrado' : '❌ NÃO ENCONTRADO',
          'Timer Mesa': check.timer ? '✅ Encontrado' : '❌ NÃO ENCONTRADO',
          'Container Histórico': check.historicoContainer ? '✅ Encontrado' : '❌ NÃO ENCONTRADO'
        });

        if (check.pronto || check.mesaAceitando) {
          console.log('%c✅ AMBIENTE VALIDADO: Robô pronto para operar.', 'color: green; font-weight: bold;');
        } else {
          console.warn('%c⚠️ AMBIENTE PARCIAL: Verifique se o jogo terminou de carregar.', 'color: orange;');
        }
        
        return check;
      }
    },

    /**
     * Atualiza o log de raciocínio da IA na interface.
     */
    atualizarRaciocinio(texto, tipo = 'info') {
      const el = document.getElementById('bb-ai-reasoning');
      if (!el) return;
      
      const cores = {
        info: '#cbd5e1',
        warn: '#fbbf24',
        success: '#34d399',
        error: '#f87171'
      };

      el.style.color = cores[tipo] || cores.info;
      el.textContent = texto;
      
      // Pequeno efeito de 'fade' no texto
      el.style.opacity = '0.5';
      setTimeout(() => el.style.opacity = '1', 50);
    },

    /**
     * Atualiza o termômetro de confiança.
     */
    atualizarConfianca(valor) {
      const bar = document.getElementById('bb-confidence-bar');
      const text = document.getElementById('bb-confianca');
      if (!bar || !text) return;

      const pct = Math.min(Math.max(valor, 0), 100);
      bar.style.width = `${pct}%`;
      text.textContent = `${pct}%`;

      // Cor da barra baseada na confiança
      if (pct > 80) bar.style.background = 'linear-gradient(90deg, #10b981, #34d399)';
      else if (pct > 50) bar.style.background = 'linear-gradient(90deg, #3b82f6, #60a5fa)';
      else bar.style.background = 'linear-gradient(90deg, #f59e0b, #fbbf24)';
    },

    setHardwareStatus(isActive) {
      setHardwareStatus(isActive);
    }
  };
})();

// PRD item 7: API simples para o Will exportar/limpar o log persistido.
// Disponível no console como BBLog.exportar() / BBLog.ler() / BBLog.limpar()
window.BBLog = (function () {
  const KEY = 'bb_claudinho_log';
  function ler() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); }
    catch (_) { return []; }
  }
  function limpar() {
    localStorage.removeItem(KEY);
    console.log('[BBLog] ✅ Histórico limpo');
  }
  function exportar() {
    const entries = ler();
    if (!entries.length) { console.log('[BBLog] (vazio)'); return null; }
    const linhas = entries.map((e) => {
      const d = new Date(e.ts);
      const hora = d.toLocaleString('pt-BR');
      return `[${hora}] [${e.type.toUpperCase()}] ${e.msg}`;
    }).join('\n');
    const blob = new Blob([linhas], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `claudinho-log-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
    console.log(`[BBLog] ✅ ${entries.length} entradas baixadas`);
    return entries.length;
  }
  return { ler, limpar, exportar };
})();
console.log('[Claudinho] BBLog.exportar() / BBLog.ler() / BBLog.limpar() disponíveis no console');
