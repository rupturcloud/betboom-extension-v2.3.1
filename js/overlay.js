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
        <span class="bb-title">🎯 BetBoom Auto v2</span>
        <div class="bb-header-btns">
          <button id="bb-btn-pin" class="bb-btn-sm" title="Fixar/Desfixar Janela">📌</button>
          <button id="bb-btn-minimize" class="bb-btn-sm" title="Minimizar">−</button>
          <button id="bb-btn-close" class="bb-btn-sm" title="Fechar">×</button>
        </div>
      </div>
      <div class="bb-confirm-bar">
        <div class="bb-countdown-wrap">
          <button class="bb-btn-confirm" id="bb-btn-confirm" disabled>⏳ AGUARDANDO INDICAÇÃO</button>
          <div class="bb-countdown-bar" id="bb-countdown-bar"></div>
        </div>
        <button class="bb-btn-cancel" id="bb-btn-cancel" hidden>❌ CANCELAR</button>
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
    console.log(`[EXEC-DEBUG] _dispararExecucaoDecisao chamado | contexto=${contexto} | decisaoArmada=${!!decisaoArmada} | estado=${CONFIG.estadoRodadaAtual}`);
    if (!decisaoArmada) { console.log('[EXEC-DEBUG] ABORT _disparar: sem decisaoArmada'); return; }
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
   * Inicia o bot.
   */
  function iniciarBot() {
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
          Overlay.atualizarRaciocinio('Analisando padrões no histórico...', 'info');
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

          console.log(`[BB-FLOW] deveApostar=${decisao.deveApostar} | modoTeste=${CONFIG.modoTeste} | estado=${CONFIG.estadoRodadaAtual} | cor=${decisao.cor}`);
          if (decisao.deveApostar) {
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
