/**
 * BBCalibrator — parte MAIN WORLD (acessivel no console)
 *
 * Roda no contexto da pagina (nao do isolated world da extensao),
 * por isso o user consegue chamar `await BBCalibrator.tudo()` direto
 * no DevTools console.
 *
 * Toda chamada de hardware (clique via chrome.debugger) eh delegada
 * ao bridge no isolated world (calibrator-bridge.js) via window.postMessage.
 */

(function () {
  'use strict';

  if (window.BBCalibrator) return; // ja carregado

  const STORAGE_KEY = 'BB_CALIBRATED_COORDS_v1';
  const BRIDGE_REQ = 'BB_CALIBRATOR_BRIDGE_REQ';
  const BRIDGE_RES = 'BB_CALIBRATOR_BRIDGE_RES';
  const PREFIX = '[BBCalibrator]';

  // Lista oficial de fichas da barra BetBoom (Bac Bo Mini), em ordem da UI.
  // Diego (17/05): calibrar so as fichas com valor <= saldo atual, senao
  // Will fica clicando em ficha que nao consegue usar.
  const CHIPS_BETBOOM = [5, 10, 25, 125, 500, 2500, 6000, 10000, 12000];

  const SPOTS_FIXOS = [
    { id: 'player',    label: 'Spot AZUL / PLAYER',                    required: true  },
    { id: 'banker',    label: 'Spot VERMELHO / BANKER',                required: true  },
    { id: 'tie',       label: 'Spot VERDE / TIE (opcional - ESC pula)', required: false },
    { id: 'confirmar', label: 'Botao CONFIRMAR APOSTA (ESC se nao tiver)', required: false }
  ];

  /**
   * Monta lista de slots respeitando saldo: so inclui fichas <= saldoMax.
   * Diego (17/05): com R$37, so calibra chip5, chip10, chip25; pula chip125+
   * porque Will nao tem como clicar essas fichas (sem saldo).
   */
  function montarSlots(saldoMax) {
    const saldo = Number(saldoMax);
    const limite = Number.isFinite(saldo) && saldo > 0 ? saldo : Infinity;
    const chipsCalibraveis = CHIPS_BETBOOM.filter((v) => v <= limite);
    const chipSlots = chipsCalibraveis.map((v) => ({
      id: `chip${v}`,
      label: `Ficha de R$ ${v}`,
      required: v === chipsCalibraveis[0] // pelo menos a menor eh obrigatoria
    }));
    const chipsPulados = CHIPS_BETBOOM.filter((v) => v > limite);
    return { slots: [...chipSlots, ...SPOTS_FIXOS], chipsPulados, chipsCalibraveis };
  }

  // Mantido para compatibilidade com codigo legado que importa SLOTS_PADRAO.
  // Default: todas as fichas (saldoMax=Infinity).
  const SLOTS_PADRAO = montarSlots(Infinity).slots;

  function ler() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : { coords: {}, atualizadoEm: null };
    } catch (_) {
      return { coords: {}, atualizadoEm: null };
    }
  }

  function salvar(data) {
    data.atualizadoEm = new Date().toISOString();
    data.url = window.location.href;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function flash(x, y) {
    try {
      const dot = document.createElement('div');
      dot.style.cssText = `position:fixed;z-index:2147483647;pointer-events:none;left:${x-16}px;top:${y-16}px;width:32px;height:32px;border-radius:50%;background:rgba(34,197,94,0.4);border:3px solid #22c55e;box-shadow:0 0 24px rgba(34,197,94,0.9);animation:bbCalibPulse 0.8s ease-out forwards`;
      if (!document.getElementById('bb-calib-style')) {
        const s = document.createElement('style');
        s.id = 'bb-calib-style';
        s.textContent = '@keyframes bbCalibPulse{0%{transform:scale(0.4);opacity:1}100%{transform:scale(2.2);opacity:0}}';
        document.head.appendChild(s);
      }
      document.body.appendChild(dot);
      setTimeout(() => dot.remove(), 850);
    } catch (_) {}
  }

  function banner(texto, cor = '#1d4ed8') {
    let el = document.getElementById('bb-calib-banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'bb-calib-banner';
      el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483646;padding:14px 20px;font:600 16px/1.4 -apple-system,Segoe UI,sans-serif;color:#fff;text-align:center;box-shadow:0 4px 16px rgba(0,0,0,0.3);pointer-events:none';
      document.body.appendChild(el);
    }
    el.style.background = cor;
    el.textContent = texto;
  }

  function hideBanner() {
    const el = document.getElementById('bb-calib-banner');
    if (el) el.remove();
  }

  function capturarUmClique(label, timeoutMs = 30000) {
    return new Promise((resolve) => {
      banner(`👉 Clique em: ${label} — ESC pula`, '#1d4ed8');
      let resolved = false;
      const cleanup = () => {
        document.removeEventListener('click', onClick, true);
        document.removeEventListener('keydown', onKey, true);
        hideBanner();
      };
      const onClick = (ev) => {
        if (resolved) return;
        resolved = true;
        ev.preventDefault();
        ev.stopPropagation();
        ev.stopImmediatePropagation();
        const x = ev.clientX, y = ev.clientY;
        flash(x, y);
        cleanup();
        resolve({ x, y });
      };
      const onKey = (ev) => {
        if (resolved) return;
        if (ev.key === 'Escape') { resolved = true; cleanup(); resolve(null); }
      };
      document.addEventListener('click', onClick, true);
      document.addEventListener('keydown', onKey, true);
      setTimeout(() => { if (!resolved) { resolved = true; cleanup(); resolve(null); } }, timeoutMs);
    });
  }

  async function capturar(slotId, labelOverride) {
    const slot = SLOTS_PADRAO.find((s) => s.id === slotId);
    const label = labelOverride || (slot ? slot.label : slotId);
    console.log(`${PREFIX} aguardando clique para "${slotId}" — ${label}`);
    const ponto = await capturarUmClique(label);
    if (!ponto) { console.warn(`${PREFIX} cancelado: ${slotId}`); return null; }
    const data = ler();
    data.coords[slotId] = { x: ponto.x, y: ponto.y };
    salvar(data);
    console.log(`${PREFIX} ✅ "${slotId}" salvo em (${ponto.x}, ${ponto.y})`);
    return data.coords[slotId];
  }

  async function tudo(opts = {}) {
    const saldoMax = opts.saldoMax;
    const { slots, chipsPulados, chipsCalibraveis } = montarSlots(saldoMax);
    const saldoLabel = Number.isFinite(Number(saldoMax)) && Number(saldoMax) > 0
      ? `R$ ${Number(saldoMax).toFixed(2)}`
      : 'sem limite';

    console.log(`${PREFIX} 🎯 calibracao guiada — saldo=${saldoLabel} | fichas a calibrar: ${chipsCalibraveis.join(', ')} | puladas: ${chipsPulados.join(', ')}`);
    banner(`🎯 CALIBRACAO (saldo ${saldoLabel}) — ${chipsCalibraveis.length} fichas + spots`, '#9333ea');
    await new Promise((r) => setTimeout(r, 1500));

    if (chipsCalibraveis.length === 0) {
      banner('⚠ Saldo insuficiente pra calibrar ate a menor ficha (R$5)', '#dc2626');
      setTimeout(hideBanner, 4000);
      return { ok: false, reason: 'saldo-insuficiente', chipsCalibraveis: [], chipsPulados };
    }

    let cancelado = false;
    for (const slot of slots) {
      const r = await capturar(slot.id);
      if (!r && slot.required) {
        // Usuario apertou ESC numa ficha obrigatoria — aborta
        banner(`⚠ Calibracao abortada em "${slot.id}"`, '#dc2626');
        cancelado = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 300));
    }

    if (cancelado) {
      setTimeout(hideBanner, 3000);
      return { ok: false, reason: 'cancelado-pelo-usuario', chipsCalibraveis, chipsPulados };
    }

    banner(`✅ CALIBRADO — ${chipsCalibraveis.length} fichas (${chipsPulados.length} puladas por saldo)`, '#16a34a');
    setTimeout(hideBanner, 3500);
    console.log(`${PREFIX} ✅ feito.`, ler().coords);
    return { ok: true, chipsCalibraveis, chipsPulados, coords: ler().coords };
  }

  function exportar() {
    const data = ler();
    console.group(`${PREFIX} 📋 coords`);
    console.log('atualizado:', data.atualizadoEm);
    console.log('url:', data.url);
    console.table(data.coords);
    console.groupEnd();
    return data;
  }

  function limpar() {
    localStorage.removeItem(STORAGE_KEY);
    console.log(`${PREFIX} 🗑 calibracao apagada`);
  }

  function obter(slotId) {
    return ler().coords[slotId] || null;
  }

  function temCalibracao() {
    const c = ler().coords;
    if (!c || !c.player || !c.banker) return false;
    // Qualquer ficha calibrada serve como prova
    return CHIPS_BETBOOM.some((v) => c[`chip${v}`]);
  }

  /**
   * Retorna lista de valores de fichas que ja foram calibradas.
   * Util pra Decision Engine saber quais stakes sao executaveis.
   */
  function fichasCalibradas() {
    const c = ler().coords;
    if (!c) return [];
    return CHIPS_BETBOOM.filter((v) => c[`chip${v}`]);
  }

  /**
   * Compoe um stake a partir de fichas calibradas (Diego, 17/05).
   * BetBoom nao tem ficha de R$50 — pra apostar R$50 precisa clicar
   * 2x na ficha R$25 (ou outra combinacao). Esta funcao retorna a
   * sequencia greedy (maior ficha primeiro) que soma exatamente o stake.
   *
   * @param {number} stake - valor desejado
   * @param {number[]} fichas - fichas disponiveis (default = calibradas)
   * @param {object} opts - { maxClicks: 30 } pra evitar disparar 200 cliques
   * @returns {{ok, sequencia, total, faltam, parcial, motivo}}
   *   - ok=true: sequencia soma exato
   *   - ok=false: nao conseguiu (saldo+fichas nao compoem). total=valor real
   *     que compoe (arredondado pra baixo), parcial=sequencia parcial,
   *     faltam=quanto sobrou sem compor.
   */
  function composeStake(stake, fichas, opts = {}) {
    const maxClicks = opts.maxClicks || 30;
    // Diego (17/05): se opts.somenteFicha=N, usa SO essa ficha N vezes.
    // Default em runtime vem de CONFIG.fichaPreferida (se exposto via ponte).
    const somenteFicha = opts.somenteFicha;

    if (!Number.isFinite(stake) || stake <= 0) {
      return { ok: false, sequencia: [], total: 0, faltam: 0, motivo: 'stake-invalido' };
    }

    const calibradas = fichas && fichas.length ? fichas : fichasCalibradas();
    if (calibradas.length === 0) {
      return { ok: false, sequencia: [], total: 0, faltam: stake, motivo: 'sem-fichas-calibradas' };
    }

    // Caminho FICHA UNICA (Diego, 17/05): preferida calibrada? clica so ela.
    if (Number.isFinite(somenteFicha) && somenteFicha > 0) {
      if (!calibradas.includes(somenteFicha)) {
        // Fallback: usa a menor calibrada se a preferida nao foi calibrada
        const menor = Math.min(...calibradas);
        return composeStake(stake, fichas, { ...opts, somenteFicha: menor, _fallbackDe: somenteFicha });
      }
      const ficha = somenteFicha;
      const nClicks = Math.min(Math.floor(stake / ficha), maxClicks);
      const sequencia = Array(nClicks).fill(ficha);
      const total = nClicks * ficha;
      const faltam = stake - total;
      if (nClicks >= maxClicks && faltam > 0) {
        return { ok: false, sequencia, total, faltam, motivo: `excedeu-${maxClicks}-cliques`, fichaUsada: ficha };
      }
      if (faltam > 0) {
        return { ok: false, sequencia, total, faltam, motivo: 'stake-nao-multiplo-da-ficha-preferida', fichaUsada: ficha };
      }
      return { ok: true, sequencia, total, faltam: 0, fichaUsada: ficha };
    }

    // Caminho GREEDY (compatibilidade): maior ficha primeiro, mistura.
    const lista = calibradas
      .filter((v) => Number.isFinite(v) && v > 0)
      .sort((a, b) => b - a);
    const sequencia = [];
    let restante = Number(stake);
    for (const ficha of lista) {
      while (restante >= ficha && sequencia.length < maxClicks) {
        sequencia.push(ficha);
        restante -= ficha;
      }
      if (sequencia.length >= maxClicks) break;
    }
    const total = sequencia.reduce((a, b) => a + b, 0);
    if (restante > 0 && sequencia.length < maxClicks) {
      return { ok: false, sequencia, total, faltam: restante, motivo: 'stake-nao-multiplo' };
    }
    if (sequencia.length >= maxClicks && restante > 0) {
      return { ok: false, sequencia, total, faltam: restante, motivo: `excedeu-${maxClicks}-cliques` };
    }
    return { ok: true, sequencia, total, faltam: 0 };
  }

  /**
   * Bridge: posta mensagem ao isolated world, que chama chrome.runtime → background → chrome.debugger.
   */
  function clicarHardware(slotId) {
    return new Promise((resolve) => {
      const c = obter(slotId);
      if (!c) { console.warn(`${PREFIX} sem coords pra "${slotId}"`); resolve(false); return; }
      const reqId = `bbc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const onResp = (ev) => {
        if (ev.source !== window) return;
        if (ev.data?.__type !== BRIDGE_RES || ev.data?.reqId !== reqId) return;
        window.removeEventListener('message', onResp);
        resolve(!!ev.data.ok);
      };
      window.addEventListener('message', onResp);
      window.postMessage({ __type: BRIDGE_REQ, reqId, x: c.x, y: c.y, label: slotId }, '*');
      setTimeout(() => { window.removeEventListener('message', onResp); resolve(false); }, 5000);
    });
  }

  async function executarAposta(cor, stake = 5, opts = {}) {
    const chipDelayMs = opts.chipDelayMs || 350;
    const spotDelayMs = opts.spotDelayMs || 250;
    const clicarConfirmar = opts.clicarConfirmar !== false;
    // Diego (17/05): por padrao usa CONFIG.fichaPreferida = 5
    // (uma ficha so, clica varias vezes). opts.somenteFicha sobrescreve.
    const somenteFicha = opts.somenteFicha != null ? opts.somenteFicha : 5;

    // Diego (17/05): BetBoom nao tem todas as denominacoes (ex: nao tem R$50).
    // Composicao usa a ficha preferida (default R$5) clicada N vezes.
    const compose = composeStake(stake, null, { somenteFicha });
    if (compose.sequencia.length === 0) {
      console.warn(`${PREFIX} sem ficha calibrada. Rode BBCalibrator.tudo()`);
      return { ok: false, motivo: compose.motivo || 'sem-ficha-calibrada' };
    }
    if (!compose.ok) {
      console.warn(`${PREFIX} ⚠ stake R$${stake} nao compoe exato com fichas calibradas (${fichasCalibradas().join(',')}). Apostando R$${compose.total} (faltam R$${compose.faltam}). Motivo: ${compose.motivo}`);
    }
    // Mantemos fichaId pro log/compat (1ª ficha da sequencia).
    const fichaId = `chip${compose.sequencia[0]}`;

    const spotId = (cor === 'azul' || cor === 'player' || cor === 'A') ? 'player'
                 : (cor === 'vermelho' || cor === 'banker' || cor === 'V') ? 'banker'
                 : (cor === 'empate' || cor === 'tie' || cor === 'E') ? 'tie'
                 : null;
    if (!spotId || !obter(spotId)) {
      console.warn(`${PREFIX} spot "${cor}" nao calibrado`);
      return { ok: false, motivo: `sem-spot-${cor}` };
    }

    // Diego (17/05): COMPOSICAO — clica ficha + spot, ficha + spot, etc.
    // Para apostar R$50 com fichas [5,10,25]: clica chip25→player, chip25→player.
    // Cada par chip+spot soma o valor da ficha no slot.
    console.log(`${PREFIX} 🎲 stake R$${stake} = [${compose.sequencia.join('+')}] → ${spotId}${clicarConfirmar ? ' → confirmar' : ''}`);
    const etapas = [];
    let todasOk = true;
    for (let i = 0; i < compose.sequencia.length; i++) {
      const ficha = compose.sequencia[i];
      const idAtual = `chip${ficha}`;
      const rChip = await clicarHardware(idAtual);
      await new Promise((r) => setTimeout(r, chipDelayMs));
      const rSpot = await clicarHardware(spotId);
      etapas.push({ idx: i + 1, ficha, chip: rChip, spot: rSpot });
      if (!rChip || !rSpot) {
        todasOk = false;
        console.warn(`${PREFIX} ⚠ falha no par ${i + 1}/${compose.sequencia.length}: chip=${rChip} spot=${rSpot}`);
        // Continua mesmo com falha — algumas plataformas aceitam parcial
      }
      // Delay entre pares pra nao spammar
      if (i < compose.sequencia.length - 1) {
        await new Promise((r) => setTimeout(r, spotDelayMs));
      }
    }
    let r3 = true;
    if (clicarConfirmar && obter('confirmar')) {
      await new Promise((r) => setTimeout(r, spotDelayMs));
      r3 = await clicarHardware('confirmar');
    }
    const ok = todasOk && r3;
    const totalReal = compose.sequencia.reduce((a, b) => a + b, 0);
    console.log(`${PREFIX} ${ok ? '✅' : '❌'} encerrado — ${compose.sequencia.length} pares (R$${totalReal}) confirm=${r3}`);
    return { ok, fichaId, spotId, sequencia: compose.sequencia, totalReal, faltam: compose.faltam, etapas, confirmar: r3 };
  }

  window.BBCalibrator = {
    tudo, capturar, obter, exportar, limpar, temCalibracao, fichasCalibradas,
    composeStake, clicarHardware, executarAposta, SLOTS_PADRAO, CHIPS_BETBOOM
  };

  // Ponte ISOLATED -> MAIN para botao 🎯 CAL e auto-calibracao (Diego, 17/05).
  // Aceita {kind:'BBCAL_RUN_REQ', reqId, saldoMax} — filtra fichas pelo saldo.
  window.addEventListener('message', async (ev) => {
    if (ev?.source !== window) return;
    if (ev?.data?.kind !== 'BBCAL_RUN_REQ') return;
    const reqId = ev.data.reqId;
    const saldoMax = ev.data.saldoMax;
    try {
      const result = await tudo({ saldoMax });
      window.postMessage({ kind: 'BBCAL_RUN_RESP', reqId, result }, '*');
    } catch (e) {
      window.postMessage({ kind: 'BBCAL_RUN_RESP', reqId, result: { ok: false, reason: e?.message || String(e) } }, '*');
    }
  });

  console.log(`${PREFIX} ✅ MAIN WORLD carregado — BBCalibrator disponivel no console`);
})();
