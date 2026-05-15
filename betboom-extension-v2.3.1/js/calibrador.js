/**
 * CALIBRADOR DE SELETORES — BetBoom Bac Bo (Evolution)
 * Cole no console DO IFRAME da Evolution (não da página pai)
 * Resultado: seletores exatos de cada elemento para o config.js
 */
(function () {
  const out = { fichas: [], jogador: null, empate: null, banca: null, timer: null, undo: null };

  function best(el) {
    if (!el) return null;
    // Prioridade: data-role > id > className parcial
    if (el.getAttribute('data-role')) return `[data-role="${el.getAttribute('data-role')}"]`;
    if (el.id) return `#${el.id}`;
    // Pegar a classe mais específica (sem estados dinâmicos)
    const cls = [...el.classList]
      .filter(c => !/active|selected|hover|focus|disabled/i.test(c))
      .slice(0, 2)
      .join('.');
    return cls ? `.${cls}` : el.tagName.toLowerCase();
  }

  // --- Fichas ---
  const chipSelectors = [
    '[class*="chip"i]', '[data-role*="chip"]', '[class*="Chip"]', '[class*="token"i]'
  ];
  for (const sel of chipSelectors) {
    try {
      const els = [...document.querySelectorAll(sel)]
        .filter(e => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().width < 100);
      if (els.length) {
        out.fichas = els.map(e => ({
          valor: e.textContent?.trim(),
          seletor: best(e),
          classe: e.className.slice(0, 60)
        }));
        break;
      }
    } catch (_) {}
  }

  // --- Spots de aposta ---
  // Tentar por texto visível: JOGADOR, EMPATE, BANCA, PLAYER, BANKER, TIE
  const allEls = [...document.querySelectorAll('*')].filter(e => {
    const r = e.getBoundingClientRect();
    return r.width > 50 && r.width < 400 && r.height > 30;
  });

  for (const el of allEls) {
    const txt = el.textContent?.trim().toUpperCase();
    const cls = el.className?.toLowerCase() || '';
    if (!out.jogador && (txt === 'JOGADOR' || txt === 'PLAYER' || /player.*spot|spot.*player|betspot.*player/i.test(cls))) {
      out.jogador = { texto: el.textContent?.trim(), seletor: best(el), classe: el.className.slice(0, 60) };
    }
    if (!out.empate && (txt === 'EMPATE' || txt === 'TIE' || /tie.*spot|spot.*tie|betspot.*tie/i.test(cls))) {
      out.empate = { texto: el.textContent?.trim(), seletor: best(el), classe: el.className.slice(0, 60) };
    }
    if (!out.banca && (txt === 'BANCA' || txt === 'BANKER' || /banker.*spot|spot.*banker|betspot.*banker/i.test(cls))) {
      out.banca = { texto: el.textContent?.trim(), seletor: best(el), classe: el.className.slice(0, 60) };
    }
  }

  // --- Timer ---
  for (const sel of ['[class*="timer"i]', '[class*="countdown"i]', '[class*="Clock"i]', 'svg text', '[class*="seconds"]']) {
    try {
      const el = document.querySelector(sel);
      if (el && el.getBoundingClientRect().width > 0) {
        out.timer = { texto: el.textContent?.trim(), seletor: best(el), classe: el.className.slice?.(0, 60) };
        break;
      }
    } catch (_) {}
  }

  // --- Undo / Limpar ---
  for (const sel of ['[data-role="undo"]', '[class*="undo"i]', '[aria-label*="undo"i]', '[aria-label*="clear"i]']) {
    try {
      const el = document.querySelector(sel);
      if (el) { out.undo = { seletor: best(el), classe: el.className.slice(0, 60) }; break; }
    } catch (_) {}
  }

  // --- RESULTADO FINAL ---
  console.log('%c╔══ CALIBRAÇÃO COMPLETA ══╗', 'color:#0ff;font-size:14px;font-weight:bold');
  console.log('%cFICHAS:', 'color:#ff0', out.fichas);
  console.log('%cJOGADOR:', 'color:#4af', out.jogador);
  console.log('%cEMPATE:', 'color:#fa0', out.empate);
  console.log('%cBANCA:', 'color:#f44', out.banca);
  console.log('%cTIMER:', 'color:#8f8', out.timer);
  console.log('%cUNDO:', 'color:#aaa', out.undo);
  console.log('%c╚════════════════════════╝', 'color:#0ff;font-size:14px;font-weight:bold');

  // Também listar botões brutos para inspeção
  console.log('\n%c🔍 TODOS os botões visíveis:', 'color:cyan');
  [...document.querySelectorAll('button, [role="button"], [class*="spot"i], [class*="bet-area"i]')]
    .filter(e => e.getBoundingClientRect().width > 0)
    .forEach(e => console.log(
      `  txt="${e.textContent?.trim().slice(0,20)}" cls="${e.className.slice(0,70)}"`
    ));

  return out;
})();
