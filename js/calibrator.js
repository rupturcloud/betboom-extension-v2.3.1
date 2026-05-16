/**
 * BBCalibrator - Bridge (ISOLATED WORLD)
 *
 * Escuta postMessage do calibrator-main.js (que roda no MAIN world)
 * e relaya pro background.js via chrome.runtime.sendMessage para que
 * o HardwareAutomationEngine execute o clique via chrome.debugger.
 *
 * Tambem expoe um espelho do BBCalibrator no isolated world para que
 * o Executor.executarAposta() consiga delegar quando ha calibracao,
 * sem precisar do main world.
 */

(function () {
  'use strict';

  const STORAGE_KEY = 'BB_CALIBRATED_COORDS_v1';
  const BRIDGE_REQ = 'BB_CALIBRATOR_BRIDGE_REQ';
  const BRIDGE_RES = 'BB_CALIBRATOR_BRIDGE_RES';
  const PREFIX = '[BBCalibrator-Bridge]';

  function ler() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : { coords: {}, atualizadoEm: null };
    } catch (_) {
      return { coords: {}, atualizadoEm: null };
    }
  }

  function obter(slotId) {
    return ler().coords[slotId] || null;
  }

  function temCalibracao() {
    const c = ler().coords;
    return !!(c && (c.chip5 || c.chip25) && c.player && c.banker);
  }

  // Listener: recebe requests do main world e relaya pro background
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.__type !== BRIDGE_REQ) return;
    const { reqId, x, y, label } = data;
    if (typeof chrome === 'undefined' || !chrome.runtime) {
      window.postMessage({ __type: BRIDGE_RES, reqId, ok: false, error: 'no-chrome-runtime' }, '*');
      return;
    }
    try {
      chrome.runtime.sendMessage(
        { type: 'BB_EXECUTE_HARDWARE_CLICK', x, y, label },
        (resp) => {
          const ok = !chrome.runtime.lastError && resp && resp.ok;
          window.postMessage({ __type: BRIDGE_RES, reqId, ok: !!ok, error: chrome.runtime.lastError?.message }, '*');
        }
      );
    } catch (e) {
      window.postMessage({ __type: BRIDGE_RES, reqId, ok: false, error: e.message }, '*');
    }
  });

  // Espelho no isolated world: Executor.executarAposta consulta isso.
  function clicarHardwareDireto(slotId) {
    return new Promise((resolve) => {
      const c = obter(slotId);
      if (!c) { resolve(false); return; }
      try {
        chrome.runtime.sendMessage(
          { type: 'BB_EXECUTE_HARDWARE_CLICK', x: c.x, y: c.y, label: slotId },
          (resp) => resolve(!chrome.runtime.lastError && resp && !!resp.ok)
        );
      } catch (_) { resolve(false); }
    });
  }

  async function executarAposta(cor, stake = 5, opts = {}) {
    const chipDelayMs = opts.chipDelayMs || 350;
    const spotDelayMs = opts.spotDelayMs || 250;
    const clicarConfirmar = opts.clicarConfirmar !== false;

    const ordem = stake >= 100 ? ['chip100','chip25','chip5']
                : stake >= 25  ? ['chip25','chip5','chip100']
                : ['chip5','chip25','chip100'];
    const fichaId = ordem.find((id) => obter(id));
    if (!fichaId) return { ok: false, motivo: 'sem-ficha' };

    const spotId = (cor === 'azul' || cor === 'player' || cor === 'A') ? 'player'
                 : (cor === 'vermelho' || cor === 'banker' || cor === 'V') ? 'banker'
                 : (cor === 'empate' || cor === 'tie' || cor === 'E') ? 'tie'
                 : null;
    if (!spotId || !obter(spotId)) return { ok: false, motivo: `sem-spot-${cor}` };

    console.log(`${PREFIX} 🎲 ${fichaId} → ${spotId}${clicarConfirmar ? ' → confirmar' : ''}`);
    const r1 = await clicarHardwareDireto(fichaId);
    await new Promise((r) => setTimeout(r, chipDelayMs));
    const r2 = await clicarHardwareDireto(spotId);
    let r3 = true;
    if (clicarConfirmar && obter('confirmar')) {
      await new Promise((r) => setTimeout(r, spotDelayMs));
      r3 = await clicarHardwareDireto('confirmar');
    }
    const ok = r1 && r2 && r3;
    console.log(`${PREFIX} ${ok ? '✅' : '❌'} chip=${r1} spot=${r2} confirm=${r3}`);
    return { ok, fichaId, spotId, etapas: { chip: r1, spot: r2, confirmar: r3 } };
  }

  window.BBCalibrator = {
    obter, temCalibracao, executarAposta,
    clicarHardware: clicarHardwareDireto
  };

  console.log(`${PREFIX} ✅ ISOLATED WORLD pronto — bridge ativo`);
})();
