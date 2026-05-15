// realizarAposta.js
// Automação de cliques. Por segurança, o content.js chama isto apenas quando shadowMode=false.
(function () {
  'use strict';

  // Fichas (chips) padrão da Evolution Gaming no Bac Bo (em ordem decrescente para decomposição gulosa)
  const BAC_BO_CHIPS = [12000, 10000, 5000, 2500, 500, 125, 25, 10, 5];

  // Calcula chip de proteção como ~10% da stake (rounded para chip inteiro)
  function calcularChipProtecao(stake) {
    const percentual10 = stake * 0.10;
    const chipMaisProximo = BAC_BO_CHIPS.find(chip => chip <= percentual10) || 5;
    return chipMaisProximo;
  }
  
  /**
   * Pausa a execução de uma thread async.
   * @param {number} ms - Milissegundos a pausar
   */
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  
  // --- Sistema Visual do Robô ---
  let robotCursor = null;

  function initRobotVisuals() {
    if (robotCursor || !document.body) return;
    robotCursor = document.createElement('div');
    robotCursor.id = 'wdp-robot-cursor';
    robotCursor.style.cssText = `
      position: fixed;
      z-index: 2147483647;
      pointer-events: none;
      display: flex;
      align-items: flex-start;
      transition: all 0.2s cubic-bezier(0.23, 1, 0.32, 1);
      opacity: 0;
      transform: translate(-2px, -2px);
    `;
    robotCursor.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="#ef4444" stroke="white" stroke-width="1.5" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));">
        <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/>
      </svg>
      <div style="
        background: #ef4444;
        color: white;
        font-family: 'Inter', sans-serif, system-ui;
        font-size: 11px;
        font-weight: 800;
        padding: 2px 8px;
        border-radius: 10px;
        margin-left: -2px;
        margin-top: 14px;
        box-shadow: 0 4px 12px rgba(239, 68, 68, 0.4);
        border: 1px solid rgba(255, 255, 255, 0.2);
        white-space: nowrap;
      ">Robô</div>
    `;
    document.body.appendChild(robotCursor);
  }

  function criarRastro(x, y) {
    const trail = document.createElement('div');
    trail.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      width: 4px;
      height: 4px;
      background: rgba(239, 68, 68, 0.6);
      border-radius: 50%;
      pointer-events: none;
      z-index: 2147483646;
      transition: all 0.5s ease-out;
    `;
    document.body.appendChild(trail);
    setTimeout(() => {
      trail.style.transform = 'scale(0)';
      trail.style.opacity = '0';
      setTimeout(() => trail.remove(), 500);
    }, 50);
  }

  function efeitoClique(x, y) {
    const ripple = document.createElement('div');
    ripple.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      width: 10px;
      height: 10px;
      margin-left: -5px;
      margin-top: -5px;
      border: 3px solid #ef4444;
      border-radius: 50%;
      pointer-events: none;
      z-index: 2147483647;
      transition: all 0.4s ease-out;
    `;
    document.body.appendChild(ripple);
    requestAnimationFrame(() => {
      ripple.style.width = '60px';
      ripple.style.height = '60px';
      ripple.style.marginLeft = '-30px';
      ripple.style.marginTop = '-30px';
      ripple.style.opacity = '0';
      ripple.style.borderWidth = '1px';
    });
    setTimeout(() => ripple.remove(), 400);
  }

  function moverRobo(x, y) {
    initRobotVisuals();
    if (!robotCursor) return;
    robotCursor.style.opacity = '1';
    robotCursor.style.left = x + 'px';
    robotCursor.style.top = y + 'px';
    criarRastro(x, y);
  }

  /**
   * Gera um valor randômico (jitter) para simular tempo de reação humano e variação natural.
   * Ajuda contra anti-bots.
   */
  const jitter = (min = 250, max = 750) => min + Math.random() * (max - min);

  /**
   * Verifica se o elemento do DOM está visível em tela (possui dimensões).
   */
  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  }

  /**
   * Executa um clique humanizado, englobando eventos pointer, mouse down e up com delays realistas.
   * 
   * @param {Element} el - Elemento DOM alvo do clique.
   */
  async function humanClick(el) {
    if (!el) return false;
     try { window.focus(); el.focus(); } catch (_) {}
     el.scrollIntoView({ block: 'center', inline: 'center' });
     
     // Obtém a coordenada do centro absoluto do elemento na tela atual
     const rect = el.getBoundingClientRect();
     const x = Math.round(rect.left + rect.width / 2);
     const y = Math.round(rect.top + rect.height / 2);

     // Move o robô visualmente até o alvo
     moverRobo(x, y);
     await sleep(jitter(150, 300));
     
     const optsBase = { 
        bubbles: true, cancelable: true, view: window, 
        clientX: x, clientY: y, screenX: window.screenX + x, screenY: window.screenY + y,
        pointerId: 1, pointerType: 'mouse', isPrimary: true
     };
     
     // Simula movimentação do mouse e clique
     el.dispatchEvent(new PointerEvent('pointermove', optsBase));
     el.dispatchEvent(new MouseEvent('mousemove', optsBase));
     await sleep(jitter(20, 70));
     
     const optsDown = { ...optsBase, button: 0, buttons: 1 };
     efeitoClique(x, y); // Feedback visual de clique
     el.dispatchEvent(new PointerEvent('pointerdown', optsDown));
     el.dispatchEvent(new MouseEvent('mousedown', optsDown));
     await sleep(jitter(60, 150));
     
     const optsUp = { ...optsBase, button: 0, buttons: 0 };
     el.dispatchEvent(new PointerEvent('pointerup', optsUp));
     el.dispatchEvent(new MouseEvent('mouseup', optsUp));
     el.dispatchEvent(new MouseEvent('click', optsBase));
     
     // Pequena pausa após o clique antes de sumir ou ir para o próximo
     await sleep(jitter(100, 200));
     
     return true;
   }

  /**
   * Obtém todo texto associado a um elemento para realizar parsing de heurística (buscando labels, aria, data).
   */
  function textOf(el) {
    return `${el.textContent || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${el.getAttribute('data-value') || ''} ${el.getAttribute('data-amount') || ''}`.trim();
  }

  /**
   * Remove formatação de dinheiro/caracteres especiais, mantendo apenas números.
   */
  function normalizarNumeroTexto(text) {
    return String(text || '').replace(/\s/g, '').replace(/[R$.,]/g, '');
  }

  /**
   * Procura o elemento HTML da ficha (chip) com o valor exato no painel de apostas.
   * Utiliza RegExp para isolar o número (evita clicar no 500 se quer o 5).
   * 
   * @param {number} valor - O valor do chip buscado.
   * @returns {Element|undefined} Elemento DOM correspondente à ficha ou undefined.
   */
  function encontrarChip(valor) {
    const normalizedStake = String(Math.round(Number(valor)));
    const selectors = [
      `[data-value="${normalizedStake}"]`,
      `[data-amount="${normalizedStake}"]`,
      `[aria-label*="${normalizedStake}"]`,
      `[data-role="chip"]`,
      `[class*="chip" i]`,
      `button[value="${normalizedStake}"]`,
      `button`,
      `div[role="button"]`,
      `[role="button"]`
    ];

    const candidatos = [];
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((el) => {
        if (!candidatos.includes(el) && isVisible(el)) candidatos.push(el);
      });
    }

    // Busca exata para evitar pegar a Div Container de todos os chips (que teria "5 10 25 100")
    return candidatos.find((el) => {
      const rawText = `${el.textContent || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('data-value') || ''} ${el.className || ''}`.toLowerCase();
      // Precisamos que o número 5 esteja isolado de outros números (ex: não queremos 50, nem 15)
      const numberRegex = new RegExp(`(?:^|[^0-9])0*${normalizedStake}(?:[^0-9]|$)`);
      
      const attrs = normalizarNumeroTexto(`${el.getAttribute('data-value') || ''} ${el.getAttribute('data-amount') || ''} ${el.getAttribute('value') || ''}`);
      if (attrs === normalizedStake) return true;
      
      // Checar se ele é o container de muitos chips (tem muitos filhos que também são chips)
      const filhos = el.querySelectorAll('[class*="chip" i], button');
      if (filhos.length > 2) return false;

      return numberRegex.test(rawText) && (/chip|coin|token|bet/i.test(rawText));
    });
  }

  /**
   * Decompõe um valor monetário em fichas permitidas na mesa do Bac Bo.
   * Exemplo: R$ 35 se torna [25, 10].
   * 
   * @param {number} stake - Valor total da aposta.
   * @returns {number[]} Lista de valores das fichas a serem clicadas sequencialmente.
   */
  function decomporStake(stake) {
    let restante = Math.round(Number(stake));
    if (!Number.isFinite(restante) || restante < 5) return [];
    const chips = [];
    for (const chip of BAC_BO_CHIPS) {
      while (restante >= chip) {
        chips.push(chip);
        restante -= chip;
      }
    }
    return restante === 0 ? chips : [];
  }

  async function encontrarComRetry(fnBusca, retries = 6, ms = 500) {
    let el = null;
    let tentativas = retries;
    while (tentativas > 0 && !el) {
      el = fnBusca();
      if (!el) {
        tentativas--;
        if (tentativas > 0) await sleep(ms);
      }
    }
    return el;
  }

  async function selecionarChip(stake) {
    const valor = Math.round(Number(stake));
    if (!Number.isFinite(valor) || valor < 5) {
      console.error(`[REALIZAR-APOSTA] ✗ Valor inválido: R$ ${valor} (mínimo R$ 5)`);
      return { ok: false, motivo: `Valor mínimo de chip é R$ 5` };
    }

    console.log(`[REALIZAR-APOSTA] Procurando chip exato de R$ ${valor}...`);
    const exato = await encontrarComRetry(() => encontrarChip(valor), 6, 500);
    if (exato) {
      console.log(`[REALIZAR-APOSTA] ✓ Chip exato R$ ${valor} encontrado, clicando...`);
      await humanClick(exato);
      await sleep(jitter(250, 550));
      return { ok: true, motivo: `Chip R$ ${valor} selecionado`, chips: [valor] };
    }

    console.log(`[REALIZAR-APOSTA] Chip exato não encontrado, tentando compor R$ ${valor}...`);
    const composicao = decomporStake(valor);
    if (!composicao.length) {
      console.error(`[REALIZAR-APOSTA] ✗ Não foi possível compor R$ ${valor} com chips disponíveis`);
      return { ok: false, motivo: `Não foi possível compor R$ ${valor} com chips Bac Bo` };
    }

    console.log(`[REALIZAR-APOSTA] Composição: [${composicao.join(' + ')}]`);
    const clicados = [];
    const infoAlvos = [];
    for (const chip of composicao) {
      console.log(`[REALIZAR-APOSTA] Procurando chip de R$ ${chip}...`);
      const el = await encontrarComRetry(() => encontrarChip(chip), 4, 400);
      if (!el) {
        console.error(`[REALIZAR-APOSTA] ✗ Chip R$ ${chip} não encontrado`);
        return { ok: false, motivo: `Chip R$ ${chip} não encontrado na UI para compor R$ ${valor} após aguardar`, chips: clicados };
      }
      console.log(`[REALIZAR-APOSTA] ✓ Chip R$ ${chip} encontrado, clicando...`);
      await humanClick(el);
      clicados.push(chip);
      infoAlvos.push(`<${el.tagName.toLowerCase()} class="${el.className || ''}">`);
      await sleep(jitter(220, 480));
    }
    console.log(`[REALIZAR-APOSTA] ✓ Chips selecionados: [${clicados.join(' + ')}]`);
    return { ok: true, motivo: `Chips [${infoAlvos.join(', ')}]`, chips: clicados };
  }

  // Encontra elementos de aposta com estratégia 3-níveis:
  // 1. Busca exata por data-bet="player"|"banker"|"tie" (mais confiável)
  // 2. Heurística com scoring em todos os elementos visíveis (fallback)
  // 3. Traversal de iframes se os anteriores falharem
  // Retorna array de candidatos ordenados por score descente
  function candidatosArea(acao) {
    const isP = acao === 'P';
    const nomeBet = isP ? 'player' : acao === 'B' ? 'banker' : 'tie';
    const terms = isP
      ? ['player', 'jogador', 'azul', 'blue']
      : acao === 'B'
        ? ['banker', 'banca', 'vermelho', 'red']
        : ['tie', 'empate', 'amarelo', 'yellow', 'gold'];

    const all = [];
    const docs = [document];

    // Procurar em iframes também
    try {
      document.querySelectorAll('iframe').forEach((iframe) => {
        try {
          if (iframe.contentDocument) docs.push(iframe.contentDocument);
        } catch (_) {}
      });
    } catch (_) {}

    // Estratégia 1: Procurar por data-bet exato
    for (const doc of docs) {
      try {
        doc.querySelectorAll(`[data-bet="${nomeBet}"]`).forEach((el) => {
          if (!all.includes(el) && isVisible(el)) all.push(el);
        });
      } catch (_) {}
    }

    // Se encontrou com data-bet, retorna já
    if (all.length > 0) {
      console.log(`[REALIZAR-APOSTA] Encontrou ${all.length} elementos com data-bet="${nomeBet}"`);
      return all.map((el) => ({ el, score: 1000, strategy: 'data-bet' }));
    }

    // Estratégia 2: Procurar por padrões de classe e conteúdo
    const allCandidatos = [];
    for (const doc of docs) {
      try {
        doc.querySelectorAll('button, [role="button"], div[onclick], [class*="bet" i], [class*="area" i]').forEach((el) => {
          if (!allCandidatos.includes(el) && isVisible(el)) allCandidatos.push(el);
        });
      } catch (_) {}
    }

    return allCandidatos
      .map((el) => {
        const className = (el.className && typeof el.className === 'string' ? el.className : el.getAttribute('class') || '');
        const id = el.id || '';
        const aria = el.getAttribute('aria-label') || '';
        const dataBet = el.getAttribute('data-bet') || '';
        const title = el.getAttribute('title') || '';
        const dataTestId = el.getAttribute('data-testid') || '';
        const fullText = `${textOf(el)} ${className} ${id} ${aria} ${title} ${dataBet} ${dataTestId}`.toLowerCase();

        let score = 0;

        // Bonus por data-bet específico
        if (dataBet === nomeBet) score += 1000;

        // Bonus por contém termo exato com word boundary
        for (const term of terms) {
          const regex = new RegExp(`\\b${term}\\b`, 'i');
          if (regex.test(fullText)) score += 300;
        }

        // Bonus por estar em classe com "bet", "area", "spot", "zone"
        if (/bet|area|spot|zone|button/i.test(className)) score += 150;

        // Penalidade por ser histórico/painel
        if (/history|road|score|trend|statistic|bead|nav|panel|chip|overlay|board/i.test(fullText)) score -= 1000;

        // Penalidade por ser muito grande (provável container)
        const rect = el.getBoundingClientRect();
        if (rect.width * rect.height > window.innerWidth * window.innerHeight * 0.3) score -= 300;

        return { el, score, strategy: 'heuristic' };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Clica na área de aposta específica da mesa (Player, Banker ou Tie).
   * Possui sistema de tentativas caso a área demore a ser renderizada.
   *
   * @param {string} acao - 'P' (Player), 'B' (Banker) ou 'T' (Tie).
   * @returns {Promise<Object>} Retorna o status do clique.
   */
  async function clicarNaArea(acao) {
    const nomeAcao = acao === 'P' ? 'PLAYER' : acao === 'B' ? 'BANKER' : 'TIE';
    console.log(`[REALIZAR-APOSTA] Procurando área de ${nomeAcao}...`);

    let areasObj = [];
    let tentativas = 8; // Tenta achar a área por até 4 segundos (8 * 500ms)
    let tentativaAtual = 0;

    while (tentativas > 0 && !areasObj.length) {
      tentativaAtual++;
      areasObj = candidatosArea(acao);
      if (!areasObj.length) {
        tentativas--;
        if (tentativas > 0) {
          console.log(`[REALIZAR-APOSTA] Tentativa ${tentativaAtual}: não encontrou área de ${nomeAcao}, aguardando...`);
          await sleep(500);
        }
      }
    }

    if (!areasObj.length) {
      console.error(`[REALIZAR-APOSTA] ✗ Área ${nomeAcao} não encontrada após ${tentativaAtual} tentativas`);
      return { ok: false, motivo: `Área ${nomeAcao} não encontrada na UI após aguardar` };
    }

    console.log(`[REALIZAR-APOSTA] ✓ Encontrou ${areasObj.length} candidatos para ${nomeAcao}`);

    // Ordenar por score
    areasObj.sort((a, b) => b.score - a.score);

    let alvo = null;
    let motivoFalha = null;

    // Tentar clicar no melhor candidato
    for (let i = 0; i < Math.min(areasObj.length, 3); i++) {
      const candidato = areasObj[i];
      const el = candidato.el;

      if (!isVisible(el)) {
        motivoFalha = `Candidato ${i + 1} não visível`;
        continue;
      }

      const rect = el.getBoundingClientRect();
      const tamanhoOk = rect.width > 10 && rect.height > 10;
      if (!tamanhoOk) {
        motivoFalha = `Candidato ${i + 1} muito pequeno (${rect.width}x${rect.height})`;
        continue;
      }

      alvo = el;
      break;
    }

    if (!alvo) {
      console.error(`[REALIZAR-APOSTA] ✗ Nenhum candidato válido: ${motivoFalha}`);
      return { ok: false, motivo: `Nenhum candidato válido para ${nomeAcao}: ${motivoFalha}` };
    }

    // Executar clique
    console.log(`[REALIZAR-APOSTA] Clicando em ${nomeAcao}...`);
    await humanClick(alvo);
    await sleep(jitter(300, 700));

    const detalhesAlvo = `<${alvo.tagName.toLowerCase()} class="${alvo.className || ''}" id="${alvo.id || ''}">`;
    console.log(`[REALIZAR-APOSTA] ✓ Clique em ${nomeAcao} executado [${detalhesAlvo}]`);
    return { ok: true, motivo: `Clique em ${nomeAcao} [${detalhesAlvo}]` };
  }

  // FUNÇÃO PRINCIPAL: Realiza uma aposta completa com proteção automática
  // Fluxo: 1) Seleciona chip do valor 2) Clica na área (P/B/T) 3) Adiciona proteção de R$ 5 no empate (automática)
  // Exemplo: realizarAposta('P', 100) → R$ 100 PLAYER + R$ 5 EMPATE (obrigatório)
  async function realizarAposta(acao, stake, options = {}) {
    const nomeAcao = acao === 'P' ? 'PLAYER' : acao === 'B' ? 'BANKER' : 'TIE';

    if (!['P', 'B', 'T'].includes(acao)) {
      console.error('[REALIZAR-APOSTA] Ação inválida:', acao);
      return { ok: false, motivo: 'Ação inválida' };
    }

    console.log(`\n[REALIZAR-APOSTA] ═══════════════════════════════════`);
    console.log(`[REALIZAR-APOSTA] Iniciando aposta: ${nomeAcao} R$ ${stake}`);
    console.log(`[REALIZAR-APOSTA] (com proteção automática de empate)`);
    console.log(`[REALIZAR-APOSTA] ═══════════════════════════════════\n`);

    await sleep(jitter(400, 900));

    // Etapa 1: Selecionar chip
    console.log(`[REALIZAR-APOSTA] Etapa 1: Selecionando chip de R$ ${stake}...`);
    const chip = await selecionarChip(stake);
    if (!chip.ok) {
      console.error(`[REALIZAR-APOSTA] ✗ Falha ao selecionar chip: ${chip.motivo}`);
      return chip;
    }
    console.log(`[REALIZAR-APOSTA] ✓ Chip selecionado: ${chip.motivo}`);

    // Etapa 2: Clicar na área
    console.log(`[REALIZAR-APOSTA] Etapa 2: Clicando na área de ${nomeAcao}...`);
    const area = await clicarNaArea(acao);
    if (!area.ok) {
      console.error(`[REALIZAR-APOSTA] ✗ Falha ao clicar: ${area.motivo}`);
      return area;
    }
    console.log(`[REALIZAR-APOSTA] ✓ Área clicada: ${area.motivo}`);

    // Etapa 3: PROTEÇÃO AUTOMÁTICA DE EMPATE (OBRIGATÓRIA)
    // Se não for aposta em empate, adiciona proteção automática (~10% da stake como chip inteiro)
    if (acao !== 'T') {
      const valorProtecao = calcularChipProtecao(stake);
      console.log(`[REALIZAR-APOSTA] Etapa 3: Adicionando PROTEÇÃO AUTOMÁTICA de empate R$ ${valorProtecao} (~10% de R$ ${stake})...`);
      await sleep(jitter(150, 350));

      const chipTie = await selecionarChip(valorProtecao);
      if (chipTie.ok) {
        console.log(`[REALIZAR-APOSTA] Chip de proteção selecionado, clicando no Empate...`);
        const areaTie = await clicarNaArea('T');
        if (areaTie.ok) {
          console.log(`[REALIZAR-APOSTA] ✓ PROTEÇÃO AUTOMÁTICA adicionada: R$ ${valorProtecao} em EMPATE`);
        } else {
          console.warn(`[REALIZAR-APOSTA] ⚠ Falha ao clicar no Empate, mas aposta principal foi realizada`);
        }
      } else {
        console.warn(`[REALIZAR-APOSTA] ⚠ Falha ao selecionar chip de proteção, mas aposta principal foi realizada`);
      }
    } else {
      console.log(`[REALIZAR-APOSTA] Etapa 3: Aposta é em EMPATE, proteção não necessária`);
    }

    console.log(`[REALIZAR-APOSTA] ═══════════════════════════════════`);
    console.log(`[REALIZAR-APOSTA] ✓ APOSTA COMPLETA: ${nomeAcao} R$ ${stake} + PROTEÇÃO`);
    console.log(`[REALIZAR-APOSTA] ═══════════════════════════════════\n`);
    return { ok: true, motivo: `Aposta ${acao} enviada: ${chip.motivo} -> ${area.motivo}` };
  }

  // ── Sistema de Keep-Alive (mantém sessão viva) ─────────────────────────────

  const KEEP_ALIVE_INTERVAL = 4 * 60 * 1000; // 4 minutos
  let keepAliveInterval = null;
  let keepAliveAttempts = 0;

  function encontrarPontoNeutro() {
    const candidatos = [
      document.querySelector('[class*="close"][aria-label]'),
      document.querySelector('[class*="close"]'),
      document.querySelector('[class*="dismiss"]'),
      document.querySelector('[role="button"][aria-label*="fechar"]'),
      document.querySelector('[role="button"][aria-label*="close"]'),
      document.querySelector('button[title*="close" i]'),
      document.querySelector('button[title*="fechar" i]'),
      document.querySelector('[class*="menu"]'),
      document.querySelector('[class*="icon-close"]'),
      document.querySelector('.modal-close'),
      document.querySelector('.popup-close'),
      document.body
    ];

    return candidatos.find(el =>
      el && el.offsetParent !== null && isVisible(el)
    );
  }

  function executarKeepAlive() {
    try {
      const spot = encontrarPontoNeutro();
      if (spot) {
        keepAliveAttempts++;
        console.log(`[WDP KEEP-ALIVE] Tentativa #${keepAliveAttempts} em ${new Date().toLocaleTimeString()}`);

        spot.dispatchEvent(new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: Math.random() * 10,
          clientY: Math.random() * 10
        }));

        console.log(`[WDP KEEP-ALIVE] ✓ Clique executado (${spot.tagName} ${spot.className})`);
      } else {
        console.warn('[WDP KEEP-ALIVE] ✗ Nenhum ponto neutro encontrado');
      }
    } catch (e) {
      console.error('[WDP KEEP-ALIVE] Erro:', e.message);
    }
  }

  function iniciarKeepAlive() {
    if (keepAliveInterval) {
      console.log('[WDP KEEP-ALIVE] Já iniciado');
      return;
    }

    console.log(`[WDP KEEP-ALIVE] Iniciando (intervalo: ${KEEP_ALIVE_INTERVAL / 1000 / 60} min)`);
    keepAliveInterval = setInterval(executarKeepAlive, KEEP_ALIVE_INTERVAL);
  }

  function pararKeepAlive() {
    if (keepAliveInterval) {
      clearInterval(keepAliveInterval);
      keepAliveInterval = null;
      console.log('[WDP KEEP-ALIVE] Parado');
    }
  }

  // Iniciar keep-alive apenas se estamos em um contexto de jogo (Evolution Gaming)
  // COMENTADO: Aguardando testes antes de ativar automaticamente
  // Descomente a linha abaixo para ativar:
  /*
  if (document.location.href.includes('evolutiongaming') ||
      document.location.href.includes('evo-games') ||
      document.location.href.includes('betboom')) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', iniciarKeepAlive);
    } else {
      iniciarKeepAlive();
    }
  }
  */

  globalThis.WillDadosAposta = {
    realizarAposta,
    selecionarChip,
    clicarNaArea,
    humanClick,
    decomporStake,
    encontrarChip,
    // Controle de keep-alive
    iniciarKeepAlive,
    pararKeepAlive
  };
})();
