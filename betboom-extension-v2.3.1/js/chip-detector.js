/**
 * BetBoom Chip Detector v2.0
 * ===========================
 * Detecção robusta de fichas (baseada em chips-classic).
 * Roda em content script (iframe Evolution).
 *
 * Responsabilidades:
 * - Encontrar ficha pelo valor (exato ou aproximado)
 * - Validar visibilidade (dim, visibility, opacity)
 * - Retry com backoff exponencial
 * - Cache de fichas encontradas por rodada
 * - Logging detalhado para debug
 */

const ChipDetector = (() => {
  const PREFIX = '[ChipDetector]';

  let chipCache = {};
  let lastRoundId = null;

  // R99.3: contador de falhas consecutivas. Quando estourar o limite,
  // escala pro top frame como "canvas-only forçado" → banner aparece sozinho
  // e SHORTCUT CAL passa a ser obrigatório. Reseta a cada sucesso.
  let falhasConsecutivas = 0;
  let canvasOnlyJaEscalado = false;
  const LIMITE_FALHAS_CANVAS_ONLY = 3;

  function escalarCanvasOnly(motivo) {
    if (canvasOnlyJaEscalado) return;
    canvasOnlyJaEscalado = true;
    const payload = {
      source: 'bb-canvas-detection',
      canvasOnly: true,
      forced: true,
      reason: motivo,
      delay: 9999, // satisfaz filtro do top (delay >= 8000)
      ts: Date.now(),
      canvasCount: -1,
      domClicaveis: -1
    };
    try {
      // Envia pro top em qualquer caso (top filtra por IS_TOP_FRAME).
      window.top?.postMessage(payload, '*');
      // Também posta no próprio frame, caso este SEJA o top.
      window.postMessage(payload, '*');
      console.warn(`${PREFIX} 🚨 CANVAS-ONLY FORÇADO após ${falhasConsecutivas} falhas (motivo=${motivo}). Banner deve aparecer.`);
    } catch (e) {
      console.warn(`${PREFIX} falha ao escalar canvas-only:`, e?.message);
    }
  }

  function registrarSucesso() {
    if (falhasConsecutivas > 0) {
      console.log(`${PREFIX} ↩ resetando contador de falhas (era ${falhasConsecutivas}).`);
    }
    falhasConsecutivas = 0;
  }

  function registrarFalha() {
    falhasConsecutivas++;
    console.warn(`${PREFIX} contador de falhas consecutivas = ${falhasConsecutivas}/${LIMITE_FALHAS_CANVAS_ONLY}`);
    if (falhasConsecutivas >= LIMITE_FALHAS_CANVAS_ONLY) {
      escalarCanvasOnly('chip_detector_falhas_consecutivas');
    }
  }

  // Seletores em ordem de prioridade (Betia + Evolution Gaming + novos heurísticos)
  // IMPORTANTE: prioridade baixa = mais específico (preferido). Não remover seletores legacy.
  const CHIP_SELECTORS = [
    // ===== ESPECÍFICOS (Betia / Evolution Gaming legacy) =====
    (valor) => `[data-betia-id="chip-${valor}"]`,
    (valor) => `[data-automation-id="chip-${valor}"]`,
    // ===== Data attributes genéricos =====
    (valor) => `[data-chip-value="${valor}"]`,
    (valor) => `[data-value="${valor}"]`,
    (valor) => `[data-amount="${valor}"]`,
    (valor) => `[data-denomination="${valor}"]`,
    (valor) => `[data-role="chip-${valor}"]`,
    (valor) => `[data-role="chip"][data-value="${valor}"]`,
    // ===== Aria-label exato e variantes (R$5, $5, "5") =====
    (valor) => `[aria-label="${valor}"]`,
    (valor) => `[aria-label*="$${valor}"]`,
    (valor) => `[aria-label*="R$${valor}"]`,
    (valor) => `[aria-label*="R$ ${valor}"]`,
    (valor) => `[aria-label*="${valor}"]`,
    // ===== Buttons com value HTML =====
    (valor) => `button[value="${valor}"]`,
    // ===== Generic (sem valor específico) — varredura ampla, filtrada por regex de texto =====
    () => `[data-role="chip"]`,
    () => `[data-role*="chip"]`,
    () => `[class*="chip" i]`,
    () => `button[class*="chip" i]`,
    () => `[class*="Chip"]`,
    () => `[class*="Denomination"]`,
    () => `[class*="denomination"]`,
    () => `[class*="token"]`,
    () => `[class*="betting-chip"]`,
    () => `[class*="wc-chip"]`,
    () => `[aria-label*="chip" i]`,
    () => `[role="button"][class*="chip" i]`,
  ];

  /**
   * Normaliza texto de ficha para um número.
   * Suporta variações como "R$5", "R$ 2.5K", "2.5K", "6K", "10K", "1M".
   * Retorna número ou NaN.
   */
  function parseChipText(rawText) {
    if (!rawText) return NaN;
    const t = String(rawText).trim().toLowerCase();
    // Captura formas tipo "2.5k", "6k", "10k", "1m" (com possíveis prefixos R$/$/espaços).
    const m = t.match(/(?:r?\$\s*)?([0-9]+(?:[.,][0-9]+)?)\s*([km])?/i);
    if (!m) return NaN;
    let n = parseFloat(m[1].replace(',', '.'));
    if (!Number.isFinite(n)) return NaN;
    const unit = m[2] ? m[2].toLowerCase() : '';
    if (unit === 'k') n *= 1000;
    else if (unit === 'm') n *= 1000000;
    return n;
  }

  /**
   * Valida se um elemento é visível
   */
  function isVisible(el) {
    if (!el?.getBoundingClientRect) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;

    const style = window.getComputedStyle?.(el);
    if (!style) return false;

    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  /**
   * Extrai número do texto de um elemento
   */
  function extractValue(el) {
    const text = `${el.textContent || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('data-value') || ''} ${el.className || ''}`.toLowerCase();
    return text;
  }

  /**
   * Encontra ficha por valor com regex flexível.
   * Diferencia seletores que aceitam (valor) vs. seletores genéricos (sem argumento).
   */
  function encontrarFichaPorValor(valor) {
    const normalized = String(Math.round(Number(valor)));
    const valorNumerico = Number(valor);

    // Coletar todos os candidatos visíveis
    const candidatos = [];

    CHIP_SELECTORS.forEach((selectorFn, idx) => {
      // Detecta se a função espera argumento (length > 0)
      const esperaValor = selectorFn.length > 0;
      let sel;
      try {
        sel = esperaValor ? selectorFn(normalized) : selectorFn();
      } catch (_) { return; }
      try {
        // DOM normal + Shadow DOM
        const elements = [
          ...document.querySelectorAll(sel),
          ...querySelectorAllDeep(sel)
        ];
        elements.forEach((el) => {
          if (isVisible(el) && !candidatos.find(c => c.el === el)) {
            candidatos.push({ el, sel, priority: esperaValor ? idx : 100 + idx, esperaValor });
          }
        });
      } catch (_) {}
    });

    // 1) Filtrar candidatos por matching de número (regex flexível) sobre texto+aria.
    const numberRegex = new RegExp(`(?:^|[^0-9])0*${normalized}(?:[^0-9]|$)`);
    const matches = candidatos.filter((c) => {
      const text = extractValue(c.el);
      if (numberRegex.test(text)) return true;
      // 2) Tentar parsear texto interno como "2.5K" / "6K" / "R$ 25" e comparar com valor.
      const parsed = parseChipText(c.el.textContent || c.el.getAttribute('aria-label') || '');
      return Number.isFinite(parsed) && Math.abs(parsed - valorNumerico) < 0.5;
    });

    if (matches.length > 0) {
      // Ordenar por prioridade (seletores específicos primeiro)
      matches.sort((a, b) => a.priority - b.priority);
      const melhor = matches[0];
      return { el: melhor.el, sel: melhor.sel, valor: normalized };
    }

    return null;
  }

  /**
   * Varredura recursiva por Shadow DOM. Coleta elementos clicáveis dentro de
   * shadowRoots aninhados (Evolution Gaming usa Web Components).
   */
  function querySelectorAllDeep(selector, root = document) {
    const results = [];
    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      try {
        if (node.querySelectorAll) {
          node.querySelectorAll(selector).forEach((el) => results.push(el));
        }
      } catch (_) {}
      // descer em shadowRoots
      const all = node.querySelectorAll ? node.querySelectorAll('*') : [];
      for (const el of all) {
        if (el.shadowRoot) stack.push(el.shadowRoot);
      }
    }
    return results;
  }

  /**
   * Detecta se a UI é renderizada via Canvas (sem DOM clicável).
   * Retorna {isCanvas, canvasCount, clickableCount}.
   */
  function detectarCanvas() {
    const canvases = document.querySelectorAll('canvas');
    const clickables = document.querySelectorAll('button, [role="button"], [onclick]');
    const isCanvas = canvases.length > 0 && clickables.length < 5;
    return {
      isCanvas,
      canvasCount: canvases.length,
      clickableCount: clickables.length
    };
  }

  /**
   * Coleta TODAS as fichas-candidato no DOM e tenta inferir o valor numérico de cada uma.
   * Retorna lista ordenada por valor ascendente. Usada por encontrarMelhorFichaParaStake.
   */
  function coletarFichasComValor() {
    const seletoresVarredura = [
      '[data-role="chip"]',
      '[data-role*="chip"]',
      '[class*="chip" i]',
      '[class*="Chip"]',
      '[class*="Denomination" i]',
      '[class*="token"]',
      '[data-chip-value]',
      '[data-value]',
      '[data-amount]',
      '[data-denomination]',
      '[data-betia-id^="chip-"]',
      '[data-automation-id^="chip-"]',
      'button[aria-label]',
      '[role="button"][aria-label]',
    ];
    const vistos = new Set();
    const out = [];
    seletoresVarredura.forEach((sel) => {
      try {
        // Varre DOM normal + Shadow DOM (Web Components da Evolution)
        const elements = [
          ...document.querySelectorAll(sel),
          ...querySelectorAllDeep(sel)
        ];
        elements.forEach((el) => {
          if (vistos.has(el) || !isVisible(el)) return;
          vistos.add(el);
          // 1) tentar atributos diretos
          const direto = el.getAttribute('data-value') || el.getAttribute('data-chip-value') || el.getAttribute('data-amount') || el.getAttribute('data-denomination');
          let n = direto ? parseFloat(direto) : NaN;
          // 2) tentar parse de texto/aria-label
          if (!Number.isFinite(n)) {
            n = parseChipText(el.textContent || '');
          }
          if (!Number.isFinite(n)) {
            n = parseChipText(el.getAttribute('aria-label') || '');
          }
          if (Number.isFinite(n) && n > 0) {
            out.push({ el, sel, valor: n });
          }
        });
      } catch (_) {}
    });
    out.sort((a, b) => a.valor - b.valor);
    return out;
  }

  /**
   * Dado um stake desejado, escolhe a melhor ficha:
   * - prefere a de menor valor >= stake
   * - se nenhuma >= stake, retorna a maior disponível
   * - se DOM não tem ficha legível, retorna null
   */
  function encontrarMelhorFichaParaStake(stake) {
    const minStake = Math.max(Number(stake) || 1, 1);
    const fichas = coletarFichasComValor();
    if (!fichas.length) return null;
    const maiorOuIgual = fichas.find((c) => c.valor >= minStake);
    const escolhida = maiorOuIgual || fichas[fichas.length - 1];
    return { el: escolhida.el, sel: `[best-fit:${escolhida.valor}>=${minStake} via ${escolhida.sel}]`, valor: String(Math.round(escolhida.valor)) };
  }

  /**
   * Fallback visual: procura por dimensões típicas de ficha
   */
  function encontrarFichaFallback() {
    const allButtons = Array.from(document.querySelectorAll('button, div[role="button"], [onclick]'));

    for (const el of allButtons) {
      if (!isVisible(el)) continue;

      const rect = el.getBoundingClientRect();
      const text = extractValue(el);

      // Heurísticas de ficha
      const isDimensionallyLikeChip = (
        rect.width >= 30 && rect.width <= 150 &&
        rect.height >= 30 && rect.height <= 150
      );

      const hasChipClass = /chip|token|stake|bet/i.test(el.className);
      const hasChipAttr = /chip|value|stake/i.test(el.getAttribute('data-role') || '');
      const hasNumber = /\d+/.test(text);

      if (isDimensionallyLikeChip || hasChipClass || hasChipAttr || hasNumber) {
        return { el, sel: `[fallback-visual: ${text.slice(0, 20)}]`, valor: 'desconhecido' };
      }
    }

    return null;
  }

  /**
   * Encontra ficha com retry e backoff
   */
  async function encontrarComRetry(valor, maxRetries = 4, baseDelay = 150) {
    const startTime = Date.now();

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const resultado = encontrarFichaPorValor(valor);
      if (resultado) {
        const duration = Date.now() - startTime;
        console.log(`${PREFIX} ✅ Ficha encontrada (tentativa ${attempt}): R$${resultado.valor} via ${resultado.sel} (${duration}ms)`);

        // Registrar telemetria
        if (typeof TelemetryCollector !== 'undefined') {
          TelemetryCollector.recordDetectionLatency(valor, duration, true);
        }

        registrarSucesso();
        return resultado;
      }

      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt - 1);
        console.log(`${PREFIX} ⏳ Tentativa ${attempt} falhou, aguardando ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }

    // Penúltima tentativa: best-fit (menor ficha >= stake; regra do usuário: SEMPRE clicar algo)
    const bestFit = encontrarMelhorFichaParaStake(valor);
    if (bestFit) {
      const duration = Date.now() - startTime;
      console.log(`${PREFIX} ⚠️ Best-fit acionado após ${maxRetries} tentativas: ficha R$${bestFit.valor} para stake ${valor} via ${bestFit.sel} (${duration}ms)`);
      if (typeof TelemetryCollector !== 'undefined') {
        TelemetryCollector.recordDetectionLatency(valor, duration, true);
      }
      // Best-fit conta como sucesso parcial (achou algo clicável), reseta contador.
      registrarSucesso();
      return bestFit;
    }

    // Última tentativa: fallback visual heurístico
    const fallback = encontrarFichaFallback();
    const duration = Date.now() - startTime;

    if (fallback) {
      console.log(`${PREFIX} ⚠️ Usando fallback visual após ${maxRetries} tentativas + best-fit (${duration}ms)`);

      // Registrar telemetria com fallback
      if (typeof TelemetryCollector !== 'undefined') {
        TelemetryCollector.recordDetectionLatency(valor, duration, true);
      }

      // Fallback visual: NÃO reseta — é heurístico fraco, pode estar clicando lixo.
      // Também NÃO conta como falha total (achou algo). Mantém contador estável.
      return fallback;
    }

    console.warn(`${PREFIX} ❌ Ficha não encontrada após ${maxRetries} tentativas + best-fit + fallback (${duration}ms)`);
    // Diagnóstico verboso automático (ajuda o operador a iterar com seletor real)
    try { dumpDomCandidates(valor); } catch (_) {}

    // Registrar falha de detecção
    if (typeof TelemetryCollector !== 'undefined') {
      TelemetryCollector.recordDetectionLatency(valor, duration, false);
    }

    // R99.3: incrementa contador → eventualmente força canvas-only.
    registrarFalha();

    return null;
  }

  /**
   * Diagnóstico verboso: lista até 20 botões/role=button do DOM com atributos
   * relevantes (data-*, aria-*, classes, texto). Esse log permite ao operador
   * descobrir os seletores reais que a Evolution está usando AGORA.
   */
  function dumpDomCandidates(valorAlvo) {
    const elements = Array.from(document.querySelectorAll(
      'button, [role="button"], [data-role*="chip"], [class*="chip" i], [class*="Chip"], [aria-label]'
    ));
    const filtrados = elements.filter(isVisible).slice(0, 20);
    console.group(`${PREFIX} 🧪 DOM Dump (até 20 elementos clicáveis visíveis) — alvo=${valorAlvo}`);
    filtrados.forEach((el, i) => {
      const attrs = {};
      for (const a of el.attributes) {
        if (
          a.name.startsWith('data-') ||
          a.name.startsWith('aria-') ||
          a.name === 'class' ||
          a.name === 'role' ||
          a.name === 'value' ||
          a.name === 'id'
        ) {
          attrs[a.name] = String(a.value).slice(0, 80);
        }
      }
      const rect = el.getBoundingClientRect();
      console.log(`#${i} <${el.tagName.toLowerCase()}> "${(el.textContent || '').trim().slice(0, 30)}" [${Math.round(rect.width)}x${Math.round(rect.height)}]`, attrs);
    });
    // Também tentar listar fichas inferidas com valor
    const fichas = coletarFichasComValor();
    console.log(`${PREFIX} 🪙 Fichas inferidas (${fichas.length}):`, fichas.map(c => ({ valor: c.valor, sel: c.sel, texto: (c.el.textContent || '').trim().slice(0, 20) })));
    console.groupEnd();
  }

  /**
   * Limpar cache quando rodada muda (idempotência)
   */
  function onNovaRodada(roundId) {
    if (roundId !== lastRoundId) {
      lastRoundId = roundId;
      chipCache = {};
      console.log(`${PREFIX} Cache limpo para rodada ${roundId}`);
    }
  }

  // Public API
  return {
    /**
     * R99.3: estado do contador de falhas → canvas-only.
     */
    statusFalhas() {
      return {
        falhasConsecutivas,
        limite: LIMITE_FALHAS_CANVAS_ONLY,
        canvasOnlyJaEscalado,
      };
    },

    /**
     * R99.3: força escalação manual (debug — Diego no console).
     */
    forcarCanvasOnly(motivo = 'manual_debug') {
      canvasOnlyJaEscalado = false; // permite re-escalar
      escalarCanvasOnly(motivo);
    },

    /**
     * R99.3: reseta contador (debug / pós-calibração).
     */
    resetarFalhas() {
      falhasConsecutivas = 0;
      canvasOnlyJaEscalado = false;
      console.log(`${PREFIX} contador zerado.`);
    },

    /**
     * Encontra ficha para um valor (sincronous, sem retry)
     */
    encontrar(valor) {
      return encontrarFichaPorValor(valor);
    },

    /**
     * Encontra ficha com retry automático (asynchronous)
     */
    async encontrarComRetry(valor, maxRetries = 4, baseDelay = 150) {
      return encontrarComRetry(valor, maxRetries, baseDelay);
    },

    /**
     * Fallback visual quando nada funciona
     */
    encontrarFallback() {
      return encontrarFichaFallback();
    },

    /**
     * Best-fit explícito (escolhe menor ficha >= stake, ou maior disponível).
     * NUNCA bloqueia: garante que sempre tem algo para clicar se houver fichas
     * detectáveis no DOM. Regra firme do usuário.
     */
    encontrarMelhorFichaParaStake(stake) {
      return encontrarMelhorFichaParaStake(stake);
    },

    /**
     * Dump verboso do DOM (até 20 elementos clicáveis com atributos relevantes).
     * Use no console: ChipDetector.dumpDom() para iterar com seletor real.
     */
    dumpDom(valorAlvo = '?') {
      return dumpDomCandidates(valorAlvo);
    },

    /**
     * Detecta se a UI é canvas-only (impossível clicar via DOM).
     */
    detectarCanvas() {
      return detectarCanvas();
    },

    /**
     * Helper único: roda toda a triagem e copia relatório pro clipboard.
     * No console do iframe Evolution: ChipDetector.help()
     */
    async help() {
      const canvas = detectarCanvas();
      const fichas = coletarFichasComValor();
      const buttons = Array.from(document.querySelectorAll('button, [role="button"], [data-role*="chip"], [class*="chip" i], [aria-label]'))
        .filter(isVisible)
        .slice(0, 30)
        .map((el) => {
          const attrs = {};
          for (const a of el.attributes) {
            if (a.name.startsWith('data-') || a.name.startsWith('aria-') || a.name === 'class' || a.name === 'role' || a.name === 'value' || a.name === 'id') {
              attrs[a.name] = String(a.value).slice(0, 100);
            }
          }
          const rect = el.getBoundingClientRect();
          return {
            tag: el.tagName.toLowerCase(),
            text: (el.textContent || '').trim().slice(0, 50),
            size: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
            attrs
          };
        });

      const relatorio = {
        timestamp: new Date().toISOString(),
        url: window.location.href,
        canvas,
        fichasInferidas: fichas.map(f => ({ valor: f.valor, sel: f.sel, texto: (f.el.textContent || '').trim().slice(0, 30) })),
        elementosClicaveis: buttons
      };

      console.group('[ChipDetector] 🆘 HELP — Diagnóstico completo');
      if (canvas.isCanvas) {
        console.warn('⚠️ UI parece ser CANVAS-only. DOM não tem elementos clicáveis suficientes. Click via DOM provavelmente IMPOSSÍVEL — só com coordenadas pixel.');
      }
      console.log('Canvas:', canvas);
      console.log('Fichas inferidas:', relatorio.fichasInferidas);
      console.log('Elementos clicáveis (top 30):', relatorio.elementosClicaveis);
      console.groupEnd();

      try {
        await navigator.clipboard.writeText(JSON.stringify(relatorio, null, 2));
        console.log('[ChipDetector] 📋 Relatório copiado para clipboard. Cole na conversa.');
      } catch (_) {
        console.log('[ChipDetector] (clipboard bloqueado — copie manualmente do log)');
      }
      return relatorio;
    },

    /**
     * Notificar sobre mudança de rodada
     */
    onNovaRodada(roundId) {
      onNovaRodada(roundId);
    },

    /**
     * Validar visibilidade de elemento
     */
    isVisible(el) {
      return isVisible(el);
    },

    /**
     * Teste: listar todas as fichas encontradas
     */
    diagnosticar() {
      const resultado = {
        fichasExatas: {},
        fichasGenéricas: [],
        fallback: null,
        timestamp: new Date().toISOString()
      };

      // Procurar fichas exatas
      for (const valor of [5, 10, 25, 50, 100, 500]) {
        const chip = encontrarFichaPorValor(valor);
        if (chip) resultado.fichasExatas[valor] = chip.sel;
      }

      // Procurar fichas genéricas
      try {
        document.querySelectorAll('[data-role="chip"], [class*="chip" i]').forEach((el) => {
          if (isVisible(el)) {
            resultado.fichasGenéricas.push({
              texto: extractValue(el).slice(0, 40),
              seletor: `${el.tagName}.${el.className.split(' ').join('.')}`
            });
          }
        });
      } catch (_) {}

      resultado.fallback = encontrarFichaFallback();

      console.group(`${PREFIX} 🔍 Diagnóstico de Fichas`);
      console.log('Fichas exatas:', resultado.fichasExatas);
      console.log('Fichas genéricas:', resultado.fichasGenéricas);
      console.log('Fallback:', resultado.fallback);
      console.groupEnd();

      // Sempre acompanhar o dump verboso de DOM — ajuda o operador a iterar
      try { dumpDomCandidates('diagnostico'); } catch (_) {}

      return resultado;
    }
  };
})();

// Expor globalmente
if (typeof window !== 'undefined') {
  window.ChipDetector = ChipDetector;
  console.log('[ChipDetector] ✅ Módulo carregado');
}
