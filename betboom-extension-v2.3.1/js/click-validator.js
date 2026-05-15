/**
 * BetBoom Click Validator
 * ========================
 * PROPÓSITO: Diagnóstico e validação de cliques reais.
 * Roda dentro do iframe da Evolution e mapeia/clica nos botões reais.
 *
 * USO VIA CONSOLE (cole na aba BetBoom):
 *   window.BBClickValidator.mapear()
 *   window.BBClickValidator.clicarAzul()
 *   window.BBClickValidator.clicarVermelho()
 *   window.BBClickValidator.clicarEmpate()
 *   window.BBClickValidator.removerAposta()
 */

(function () {
  // --- Seletores candidatos baseados na Evolution Gaming (Bac Bo) ---
  const CANDIDATES = {
    // Player = Azul no Bac Bo
    player: [
      '[data-role="player-bet-spot"]',
      '[class*="player"][class*="bet"]',
      '[class*="BetSpot"][class*="player"]',
      '[class*="betspot--player"]',
      '[class*="bet-spot-player"]',
      'button[class*="Player"]',
      '[class*="wc-bet-spot--player"]',
      '[class*="spot"][class*="player"]',
      '[data-element="player"]',
    ],
    // Banker = Vermelho no Bac Bo
    banker: [
      '[data-role="banker-bet-spot"]',
      '[class*="banker"][class*="bet"]',
      '[class*="BetSpot"][class*="banker"]',
      '[class*="betspot--banker"]',
      '[class*="bet-spot-banker"]',
      'button[class*="Banker"]',
      '[class*="wc-bet-spot--banker"]',
      '[class*="spot"][class*="banker"]',
      '[data-element="banker"]',
    ],
    // Tie = Empate
    tie: [
      '[data-role="tie-bet-spot"]',
      '[class*="tie"][class*="bet"]',
      '[class*="BetSpot"][class*="tie"]',
      '[class*="betspot--tie"]',
      '[class*="bet-spot-tie"]',
      'button[class*="Tie"]',
      '[class*="wc-bet-spot--tie"]',
      '[class*="spot"][class*="tie"]',
      '[data-element="tie"]',
    ],
    // Fichas (chips)
    chips: [
      '[class*="chip"]:not([class*="container"])',
      '[data-role*="chip"]',
      '[class*="Chip"]:not([class*="Tray"])',
      '[class*="token"]',
    ],
    // Botão de limpar/desfazer aposta
    undo: [
      '[data-role="undo"]',
      '[class*="undo"]',
      '[class*="clear"][class*="bet"]',
      'button[class*="Undo"]',
      '[aria-label*="undo" i]',
      '[aria-label*="clear" i]',
      '[aria-label*="remov" i]',
    ],
    // Timer
    timer: [
      '[class*="timer" i]',
      '[class*="countdown" i]',
      '[data-role="timer"]',
    ],
  };

  function encontrar(lista) {
    for (const sel of lista) {
      try {
        const el = document.querySelector(sel);
        if (el) return { el, sel };
      } catch (_) {}
    }
    return null;
  }

  function clicarReal(el) {
    if (!el) return false;
    try {
      el.scrollIntoView({ block: 'center' });
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y };
      el.dispatchEvent(new MouseEvent('mouseover', opts));
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.dispatchEvent(new MouseEvent('click', opts));
      el.click();
      return true;
    } catch (e) {
      console.error('[BBValidator] Erro no clique:', e.message);
      return false;
    }
  }

  function log(msg, ok) {
    const icon = ok ? '✅' : '❌';
    console.log(`[BBValidator] ${icon} ${msg}`);
    // Tentar notificar o overlay via postMessage
    try {
      window.top.postMessage(
        { source: 'bb-click-validator', msg, ok },
        '*'
      );
    } catch (_) {}
  }

  const BBClickValidator = {
    /** Mapeia todos os elementos e reporta o que foi encontrado */
    mapear() {
      console.group('[BBValidator] 🗺️ Mapa Completo da Mesa');
      const resultado = {};
      for (const [nome, lista] of Object.entries(CANDIDATES)) {
        const found = encontrar(lista);
        resultado[nome] = found
          ? { seletor: found.sel, texto: found.el.textContent?.trim().slice(0, 40) }
          : null;
        log(`${nome.padEnd(10)} → ${found ? found.sel : 'NÃO ENCONTRADO'}`, !!found);
      }
      console.groupEnd();

      // Também listar todos os botões visíveis na página
      const botoes = Array.from(document.querySelectorAll('button, [role="button"]'));
      console.log('[BBValidator] Botões visíveis na página:', botoes.length);
      botoes.slice(0, 20).forEach(b =>
        console.log('  >', b.className.slice(0, 60), '|', b.textContent?.trim().slice(0, 30))
      );

      return resultado;
    },

    /** Clica no spot do Player (Azul) */
    clicarAzul() {
      const found = encontrar(CANDIDATES.player);
      const ok = clicarReal(found?.el);
      log(`Clique AZUL (Player): ${found?.sel || 'não encontrado'}`, ok && !!found);
      return ok;
    },

    /** Clica no spot do Banker (Vermelho) */
    clicarVermelho() {
      const found = encontrar(CANDIDATES.banker);
      const ok = clicarReal(found?.el);
      log(`Clique VERMELHO (Banker): ${found?.sel || 'não encontrado'}`, ok && !!found);
      return ok;
    },

    /** Clica no spot do Tie (Empate) */
    clicarEmpate() {
      const found = encontrar(CANDIDATES.tie);
      const ok = clicarReal(found?.el);
      log(`Clique EMPATE (Tie): ${found?.sel || 'não encontrado'}`, ok && !!found);
      return ok;
    },

    /** Seleciona a primeira ficha disponível */
    selecionarFicha(index = 0) {
      const chips = document.querySelectorAll(
        CANDIDATES.chips.join(', ')
      );
      const chip = chips[index];
      const ok = clicarReal(chip);
      log(`Ficha [${index}]: ${chip?.className?.slice(0, 40) || 'não encontrada'}`, ok && !!chip);
      return ok;
    },

    /** Remove/desfaz a última aposta */
    removerAposta() {
      const found = encontrar(CANDIDATES.undo);
      const ok = clicarReal(found?.el);
      log(`Remover aposta: ${found?.sel || 'não encontrado'}`, ok && !!found);
      return ok;
    },

    /** Lê o timer atual */
    lerTimer() {
      const found = encontrar(CANDIDATES.timer);
      const texto = found?.el?.textContent?.trim() || 'não encontrado';
      log(`Timer: "${texto}"`, !!found);
      return texto;
    },

    /** Executa sequência completa de teste */
    async testeCompleto() {
      console.group('[BBValidator] 🚀 TESTE COMPLETO');
      this.mapear();
      await new Promise(r => setTimeout(r, 500));

      log('--- TESTE 1: Clicar Azul (Player) ---', true);
      this.clicarAzul();
      await new Promise(r => setTimeout(r, 1000));

      log('--- TESTE 2: Remover aposta ---', true);
      this.removerAposta();
      await new Promise(r => setTimeout(r, 500));

      log('--- TESTE 3: Clicar Vermelho (Banker) ---', true);
      this.clicarVermelho();
      await new Promise(r => setTimeout(r, 1000));

      log('--- TESTE 4: Remover aposta ---', true);
      this.removerAposta();
      await new Promise(r => setTimeout(r, 500));

      log('--- TESTE 5: Clicar Empate (Tie) ---', true);
      this.clicarEmpate();
      await new Promise(r => setTimeout(r, 1000));

      log('--- TESTE 6: Remover aposta ---', true);
      this.removerAposta();

      log('Timer atual: ' + this.lerTimer(), true);
      console.groupEnd();
    }
  };

  // Expor globalmente
  window.BBClickValidator = BBClickValidator;
  console.log('[BBValidator] ✅ Carregado. Use: BBClickValidator.mapear() / .testeCompleto()');
})();
