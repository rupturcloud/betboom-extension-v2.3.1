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

  const SLOTS_PADRAO = [
    { id: 'chip5',     label: 'Ficha de R$ 5 (ou a menor disponivel)' },
    { id: 'chip25',    label: 'Ficha de R$ 25 (opcional - ESC pula)' },
    { id: 'chip100',   label: 'Ficha de R$ 100 (opcional - ESC pula)' },
    { id: 'player',    label: 'Spot AZUL / PLAYER' },
    { id: 'banker',    label: 'Spot VERMELHO / BANKER' },
    { id: 'tie',       label: 'Spot VERDE / TIE (opcional - ESC pula)' },
    { id: 'confirmar', label: 'Botao CONFIRMAR APOSTA (ESC se nao tiver)' }
  ];

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

  async function tudo() {
    console.log(`${PREFIX} 🎯 calibracao guiada — abra a mesa do Bac Bo`);
    banner('🎯 CALIBRACAO INICIADA', '#9333ea');
    await new Promise((r) => setTimeout(r, 1200));
    for (const slot of SLOTS_PADRAO) {
      await capturar(slot.id);
      await new Promise((r) => setTimeout(r, 300));
    }
    banner('✅ CALIBRACAO COMPLETA', '#16a34a');
    setTimeout(hideBanner, 3500);
    console.log(`${PREFIX} ✅ feito.`, ler().coords);
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
    return !!(c && (c.chip5 || c.chip25) && c.player && c.banker);
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

    const ordemFichas = stake >= 100 ? ['chip100', 'chip25', 'chip5']
                      : stake >= 25  ? ['chip25', 'chip5', 'chip100']
                      : ['chip5', 'chip25', 'chip100'];
    const fichaId = ordemFichas.find((id) => obter(id));
    if (!fichaId) {
      console.warn(`${PREFIX} sem ficha calibrada. Rode BBCalibrator.tudo()`);
      return { ok: false, motivo: 'sem-ficha-calibrada' };
    }

    const spotId = (cor === 'azul' || cor === 'player' || cor === 'A') ? 'player'
                 : (cor === 'vermelho' || cor === 'banker' || cor === 'V') ? 'banker'
                 : (cor === 'empate' || cor === 'tie' || cor === 'E') ? 'tie'
                 : null;
    if (!spotId || !obter(spotId)) {
      console.warn(`${PREFIX} spot "${cor}" nao calibrado`);
      return { ok: false, motivo: `sem-spot-${cor}` };
    }

    console.log(`${PREFIX} 🎲 ${fichaId} → ${spotId}${clicarConfirmar ? ' → confirmar' : ''}`);
    const r1 = await clicarHardware(fichaId);
    await new Promise((r) => setTimeout(r, chipDelayMs));
    const r2 = await clicarHardware(spotId);
    let r3 = true;
    if (clicarConfirmar && obter('confirmar')) {
      await new Promise((r) => setTimeout(r, spotDelayMs));
      r3 = await clicarHardware('confirmar');
    }
    const ok = r1 && r2 && r3;
    console.log(`${PREFIX} ${ok ? '✅' : '❌'} encerrado — chip=${r1} spot=${r2} confirm=${r3}`);
    return { ok, fichaId, spotId, etapas: { chip: r1, spot: r2, confirmar: r3 } };
  }

  window.BBCalibrator = {
    tudo, capturar, obter, exportar, limpar, temCalibracao,
    clicarHardware, executarAposta, SLOTS_PADRAO
  };

  console.log(`${PREFIX} ✅ MAIN WORLD carregado — BBCalibrator disponivel no console`);
})();
