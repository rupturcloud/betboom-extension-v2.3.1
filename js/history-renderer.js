/**
 * HistoryRenderer — Renderização do histórico real em grid fixo 156 slots
 *
 * REGRA ABSOLUTA: 1 rodada = 1 bolinha.
 * GRID FIXO: 6 linhas × 26 colunas = 156 slots.
 *
 * Layout de preenchimento: coluna por coluna, de cima para baixo.
 * Slots sem dados ficam vazios (classe 'empty').
 * A janela mostra sempre as últimas 156 rodadas do realHistory.
 *
 * DOM gerado:
 *   <div class="bb-history-slot empty" data-row="1" data-col="1"></div>
 *   <div class="bb-history-slot filled" data-row="2" data-col="1">
 *     <div class="bb-ball bb-ball-blue" data-result="player"></div>
 *   </div>
 */

const HistoryRenderer = (() => {
  const ROWS = 6;
  const COLS = 26;
  const TOTAL_SLOTS = ROWS * COLS; // 156

  const COLOR_MAP = {
    blue:  { cssClass: 'bb-ball-blue',  result: 'player', label: 'Player' },
    red:   { cssClass: 'bb-ball-red',   result: 'banker', label: 'Banker' },
    green: { cssClass: 'bb-ball-green', result: 'tie',    label: 'Empate' }
  };

  // Estado interno
  let lastRenderedSignature = null;  // hash do último render para evitar re-render desnecessário
  let lastRenderedHistory = [];      // cópia do windowHistory do último render

  // ─── Utilitários ────────────────────────────────────────────────────────────

  /**
   * Mapeia qualquer string de cor para 'blue' | 'red' | 'green' | null
   */
  function normalizeColor(color) {
    if (!color) return null;
    const c = String(color).toLowerCase().trim();
    if (c === 'blue'  || c === 'player' || c === 'azul')     return 'blue';
    if (c === 'red'   || c === 'banker' || c === 'vermelho')  return 'red';
    if (c === 'green' || c === 'tie'    || c === 'empate')    return 'green';
    console.warn('[HistoryRenderer] Cor desconhecida para render:', color);
    return null;
  }

  /**
   * Gera hash simples do array windowHistory para detecção de mudança
   */
  function hashWindowHistory(windowHistory) {
    return windowHistory.map(r => `${r.signature || r.roundId || '?'}:${r.color || r.cor}`).join('|');
  }

  // ─── Render de slot individual ──────────────────────────────────────────────

  /**
   * renderSlot({ row, col, round })
   * row: 1-6, col: 1-26
   * round: objeto normalizado do realHistory, ou null para slot vazio
   * Retorna o elemento DOM do slot.
   */
  function renderSlot({ row, col, round }) {
    const slot = document.createElement('div');
    slot.className = round ? 'bb-history-slot filled' : 'bb-history-slot empty';
    slot.dataset.row = row;
    slot.dataset.col = col;

    if (round) {
      const normalizedColor = normalizeColor(round.color || round.cor);
      if (normalizedColor) {
        const colorInfo = COLOR_MAP[normalizedColor];
        const ball = document.createElement('div');
        ball.className = `bb-ball ${colorInfo.cssClass}`;
        ball.dataset.result = colorInfo.result;
        ball.title = `${colorInfo.label} — ${round.roundId || round.signature || 'sem ID'} (col ${col}, linha ${row})`;

        // Atributos de diagnóstico
        if (round.signature) ball.dataset.signature = round.signature;
        if (round.roundId)   ball.dataset.roundId   = round.roundId;
        if (round.index != null) ball.dataset.index = round.index;

        slot.appendChild(ball);
      } else {
        // Cor inválida — slot fica vazio mas marcado como erro
        slot.classList.add('error');
        slot.dataset.errorColor = round.color || round.cor || 'null';
        console.warn(`[HistoryRenderer] Slot col=${col} row=${row}: cor inválida "${round.color || round.cor}" — slot renderizado vazio`);
      }
    }

    return slot;
  }

  // ─── Render do grid completo ─────────────────────────────────────────────────

  /**
   * renderHistoryGrid(container, realHistory)
   *
   * Implementa o algoritmo exato da spec:
   *   windowHistory = realHistory.slice(-TOTAL_SLOTS)
   *   offset = TOTAL_SLOTS - windowHistory.length
   *   for slot 0..155:
   *     historyIndex = slot - offset
   *     round = historyIndex >= 0 ? windowHistory[historyIndex] : null
   *     row = (slot % ROWS) + 1    → 1-6
   *     col = floor(slot / ROWS) + 1 → 1-26
   */
  function renderHistoryGrid(container, realHistory) {
    if (!container) {
      console.error('[HistoryRenderer] Container inválido ou ausente');
      return { success: false, reason: 'no_container', renderedBalls: 0, emptySlots: TOTAL_SLOTS };
    }

    if (!Array.isArray(realHistory)) {
      console.error('[HistoryRenderer] realHistory não é array:', typeof realHistory);
      return { success: false, reason: 'not_array', renderedBalls: 0, emptySlots: TOTAL_SLOTS };
    }

    // Janela de 156 rounds
    const windowHistory = realHistory.slice(-TOTAL_SLOTS);
    const newHash = hashWindowHistory(windowHistory);

    // Skip se não mudou nada
    if (newHash === lastRenderedSignature) {
      console.log('[HistoryRenderer] Grid sem mudanças — render pulado (hash idêntico)');
      return {
        success: true,
        reason: 'no_changes',
        renderedBalls: windowHistory.length,
        emptySlots: TOTAL_SLOTS - windowHistory.length,
        skipped: true
      };
    }

    lastRenderedSignature = newHash;
    lastRenderedHistory = windowHistory.slice();

    // Limpar container e aplicar grid CSS
    container.innerHTML = '';
    container.className = 'bb-history-grid';
    container.style.cssText = [
      'display: grid',
      `grid-template-rows: repeat(${ROWS}, 1fr)`,
      `grid-template-columns: repeat(${COLS}, 1fr)`,
      'grid-auto-flow: column',
      'gap: 2px',
      'padding: 8px',
      'background: rgba(0,0,0,0.3)',
      'border-radius: 6px',
      'overflow-x: auto'
    ].join(';');

    let renderedBalls = 0;
    let emptySlots = 0;
    let errorSlots = 0;
    const fragment = document.createDocumentFragment();

    // Sem offset: oldest em col 1 row 1, slots vazios à DIREITA — igual à banca
    for (let slot = 0; slot < TOTAL_SLOTS; slot++) {
      const round = slot < windowHistory.length ? windowHistory[slot] : null;
      const row = (slot % ROWS) + 1;
      const col = Math.floor(slot / ROWS) + 1;

      const slotEl = renderSlot({ row, col, round });

      if (round) {
        if (slotEl.classList.contains('error')) {
          errorSlots++;
        } else {
          renderedBalls++;
        }
      } else {
        emptySlots++;
      }

      fragment.appendChild(slotEl);
    }

    container.appendChild(fragment);

    // Validação pós-render
    const validation = validateAfterRender(container, windowHistory);

    logHistoryRenderDebug({
      realTotal: realHistory.length,
      windowSize: windowHistory.length,
      totalSlots: TOTAL_SLOTS,
      renderedBalls,
      emptySlots,
      errorSlots,
      validationPassed: validation.passed
    });

    if (!validation.passed) {
      console.error('[HistoryRenderer] FALHA NA VALIDAÇÃO PÓS-RENDER:', validation);
    }

    return {
      success: validation.passed,
      reason: validation.passed ? 'rendered_ok' : 'validation_failed',
      renderedBalls,
      emptySlots,
      errorSlots,
      totalSlots: TOTAL_SLOTS,
      windowSize: windowHistory.length,
      realTotal: realHistory.length,
      validation
    };
  }

  // ─── Validação pós-render ────────────────────────────────────────────────────

  /**
   * validateAfterRender(container, windowHistory)
   * Conta slots no DOM e valida contra windowHistory.length
   * Regra: filled slots = windowHistory.length (sem erros de cor)
   *        total slots = TOTAL_SLOTS
   */
  function validateAfterRender(container, windowHistory) {
    if (!container) return { passed: false, reason: 'no_container' };

    const domSlots   = container.querySelectorAll('.bb-history-slot');
    const domFilled  = container.querySelectorAll('.bb-history-slot.filled');
    const domEmpty   = container.querySelectorAll('.bb-history-slot.empty');
    const domErrors  = container.querySelectorAll('.bb-history-slot.error');
    const domBalls   = container.querySelectorAll('.bb-ball');

    const expectedTotal  = TOTAL_SLOTS;
    const expectedFilled = windowHistory.filter(r => normalizeColor(r.color) !== null).length;
    const expectedEmpty  = TOTAL_SLOTS - windowHistory.length;

    const totalOk  = domSlots.length  === expectedTotal;
    const filledOk = domFilled.length === expectedFilled;
    const ballsOk  = domBalls.length  === expectedFilled;
    const passed   = totalOk && filledOk && ballsOk && domErrors.length === 0;

    console.log(`[HistoryRenderer] Validação pós-render:`, {
      domSlots:      domSlots.length,
      expectedTotal,
      domFilled:     domFilled.length,
      expectedFilled,
      domBalls:      domBalls.length,
      domEmpty:      domEmpty.length,
      expectedEmpty,
      errors:        domErrors.length,
      passed
    });

    return {
      passed,
      domSlots:      domSlots.length,
      domFilled:     domFilled.length,
      domEmpty:      domEmpty.length,
      domBalls:      domBalls.length,
      domErrors:     domErrors.length,
      expectedTotal,
      expectedFilled,
      expectedEmpty
    };
  }

  // ─── Debug ──────────────────────────────────────────────────────────────────

  /**
   * logHistoryRenderDebug(stats)
   * Log estruturado com prefixo [HistoryRender] conforme spec
   */
  function logHistoryRenderDebug(stats) {
    const { realTotal, windowSize, totalSlots, renderedBalls, emptySlots, errorSlots, validationPassed } = stats;
    console.log(
      `[HistoryRender] realTotal=${realTotal} | janela=${windowSize}/${totalSlots} | bolinhas=${renderedBalls} | vazios=${emptySlots} | erros=${errorSlots} | validação=${validationPassed ? 'OK' : 'FALHOU'}`
    );
  }

  // ─── Rendered History para comparação ────────────────────────────────────────

  /**
   * Retorna renderedHistory no formato da spec:
   * { sourceSignature, renderedIndex, row, col, color, visible }
   * Lê diretamente do DOM do container passado.
   */
  function getRenderedHistory(container) {
    if (!container) return [];

    const slots = container.querySelectorAll('.bb-history-slot.filled');
    const result = [];
    let renderedIndex = 0;

    for (const slot of slots) {
      const row   = Number(slot.dataset.row);
      const col   = Number(slot.dataset.col);
      const ball  = slot.querySelector('.bb-ball');
      if (!ball) continue;

      const resultAttr = ball.dataset.result;
      const color = resultAttr === 'player' ? 'blue' : resultAttr === 'banker' ? 'red' : resultAttr === 'tie' ? 'green' : null;

      result.push({
        sourceSignature: ball.dataset.signature || null,
        renderedIndex,
        row,
        col,
        color,
        visible: slot.offsetParent !== null
      });
      renderedIndex++;
    }

    return result;
  }

  // ─── API Pública ──────────────────────────────────────────────────────────────

  function forceRender(container, realHistory) {
    lastRenderedSignature = null; // zera o hash para forçar re-render
    return renderHistoryGrid(container, realHistory);
  }

  return {
    renderHistoryGrid,
    forceRender,
    renderSlot,
    validateAfterRender,
    logHistoryRenderDebug,
    getRenderedHistory,
    normalizeColor,
    ROWS,
    COLS,
    TOTAL_SLOTS,
    COLOR_MAP
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = HistoryRenderer;
}
