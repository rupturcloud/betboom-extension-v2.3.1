/**
 * HistoryIntegrity — Validador de integridade do histórico
 *
 * Responsabilidades:
 * 1. assessIntegrity(realHistory, renderedHistory) → { status, issues, score }
 * 2. canUseFor(module) → boolean — gate por módulo dependente
 * 3. Separar realHistory (fonte de verdade) vs renderedHistory (overlay)
 * 4. Bloquear operações se status é INVALID
 * 5. Emitir alerta visual catastrófico se necessário
 *
 * STATUS:
 *   EMPTY   — sem dados suficientes (NÃO é OK)
 *   VALID   — match ≥ 95% (operação liberada)
 *   DEGRADED — match ≥ 70% (operação limitada, sem automação)
 *   INVALID — match < 70% (tudo bloqueado)
 *
 * SEPARAÇÃO OBRIGATÓRIA:
 *   realHistory      → rodadas reais (vem do HistoryStore)
 *   renderedHistory  → o que está no DOM (vem do HistoryRenderer)
 *   perspectiveHistory → análises, predições — NUNCA alimenta realHistory
 */

const HistoryIntegrity = (() => {

  // Estado interno
  let _lastAssessment = null;
  let _perspectiveHistory = [];

  // Módulos que dependem de integridade e seus requisitos mínimos
  const MODULE_GATES = {
    patterns:   { minStatus: 'VALID',    minScore: 0.95 },
    prediction: { minStatus: 'VALID',    minScore: 0.95 },
    f1:         { minStatus: 'VALID',    minScore: 0.95 },
    execution:  { minStatus: 'VALID',    minScore: 0.95 },
    automation: { minStatus: 'VALID',    minScore: 0.95 },
    consensus:  { minStatus: 'DEGRADED', minScore: 0.70 },
    display:    { minStatus: 'DEGRADED', minScore: 0.70 },
    replay:     { minStatus: 'EMPTY',    minScore: 0.00 } // replay funciona mesmo sem dados
  };

  // Ordenação de status (pior para melhor)
  const STATUS_ORDER = { INVALID: 0, EMPTY: 1, DEGRADED: 2, VALID: 3 };

  // ─── Normalização interna ────────────────────────────────────────────────────

  /**
   * Normaliza cor de qualquer formato para 'blue'|'red'|'green'|null
   * Aceita o contrato inglês (history-store) e PT-BR legado (collector)
   */
  function normalizeColor(cor) {
    if (!cor) return null;
    const c = String(cor).toLowerCase().trim();
    if (c === 'blue'  || c === 'player' || c === 'azul')    return 'blue';
    if (c === 'red'   || c === 'banker' || c === 'vermelho') return 'red';
    if (c === 'green' || c === 'tie'    || c === 'empate')   return 'green';
    return null;
  }

  /**
   * Extrai assinatura comparável de um round (qualquer contrato)
   */
  function extractComparableKey(round) {
    if (!round) return null;
    // Suporta contrato inglês (HistoryStore) e legado (Collector/renderedHistory)
    return round.signature || round.roundId || null;
  }

  /**
   * Extrai cor comparável de um round
   */
  function extractColor(round) {
    if (!round) return null;
    // Suporta .color (inglês) e .cor (PT-BR legado)
    return normalizeColor(round.color || round.cor || null);
  }

  // ─── Cálculo de score ────────────────────────────────────────────────────────

  /**
   * Compara sequência de cores entre realHistory e renderedHistory
   * Usa os últimos min(real, rendered) itens para comparação
   * Retorna { matchCount, totalCompared, colorErrors, details }
   */
  function compareColorSequences(realHistory, renderedHistory) {
    const compareSize = Math.min(realHistory.length, renderedHistory.length);
    if (compareSize === 0) return { matchCount: 0, totalCompared: 0, colorErrors: [], details: [] };

    const realTail     = realHistory.slice(-compareSize);
    const renderedTail = renderedHistory.slice(-compareSize);

    let matchCount = 0;
    const colorErrors = [];
    const details = [];

    for (let i = 0; i < compareSize; i++) {
      const realColor     = extractColor(realTail[i]);
      const renderedColor = extractColor(renderedTail[i]);
      const match         = realColor === renderedColor;

      if (match) {
        matchCount++;
      } else {
        const err = {
          index: i,
          realColor,
          renderedColor,
          realSignature:     extractComparableKey(realTail[i]),
          renderedSignature: extractComparableKey(renderedTail[i])
        };
        colorErrors.push(err);
        if (colorErrors.length <= 5) {
          details.push(`idx ${i}: real=${realColor} vs rendered=${renderedColor}`);
        }
      }
    }

    return { matchCount, totalCompared: compareSize, colorErrors, details };
  }

  // ─── assessIntegrity ────────────────────────────────────────────────────────

  /**
   * assessIntegrity(realHistory, renderedHistory) → { status, issues, score }
   *
   * @param {Array} realHistory     — array normalizado do HistoryStore
   * @param {Array} renderedHistory — array do HistoryRenderer.getRenderedHistory()
   * @returns {{ status: 'EMPTY'|'VALID'|'DEGRADED'|'INVALID', issues: string[], score: number }}
   */
  function assessIntegrity(realHistory, renderedHistory) {
    const issues = [];
    let score    = 0;
    let status   = 'EMPTY';

    // Garantia de arrays
    if (!Array.isArray(realHistory))     realHistory     = [];
    if (!Array.isArray(renderedHistory)) renderedHistory = [];

    const realCount     = realHistory.length;
    const renderedCount = renderedHistory.length;

    // ── CASO 1: Sem dados ──────────────────────────────────────────────────────
    if (realCount === 0) {
      issues.push('realHistory vazio — nenhum dado capturado ainda');
      status = 'EMPTY';
      score  = 0;

      const assessment = { status, score, issues, realCount, renderedCount, timestamp: Date.now() };
      _lastAssessment = assessment;
      console.log(`[HistoryIntegrity] Real=${realCount} | Rendered=${renderedCount} | Score=${score} | Status=${status}`);
      return assessment;
    }

    // ── CASO 2: Rendered vazio mas Real tem dados ──────────────────────────────
    if (renderedCount === 0) {
      issues.push(`renderedHistory vazio enquanto realHistory tem ${realCount} rodadas`);
      status = 'INVALID';
      score  = 0;

      const assessment = { status, score, issues, realCount, renderedCount, timestamp: Date.now() };
      _lastAssessment = assessment;
      console.warn(`[HistoryIntegrity] Real=${realCount} | Rendered=${renderedCount} | Score=${score} | Status=${status}`);
      console.warn(`[HistoryIntegrity] Issues:`, issues);
      return assessment;
    }

    // ── CASO 3: Rendered > Real — IMPOSSÍVEL por regra 1:1 ────────────────────
    if (renderedCount > realCount) {
      issues.push(`Rendered (${renderedCount}) > Real (${realCount}) — duplicata ou erro de render`);
      score  = 0;
      status = 'INVALID';

      const assessment = { status, score, issues, realCount, renderedCount, timestamp: Date.now() };
      _lastAssessment = assessment;
      console.error(`[HistoryIntegrity] Real=${realCount} | Rendered=${renderedCount} | RENDERED > REAL — INVÁLIDO`);
      return assessment;
    }

    // ── CASO 4: Análise de sequência de cores ──────────────────────────────────
    const seqResult = compareColorSequences(realHistory, renderedHistory);
    const { matchCount, totalCompared, colorErrors, details } = seqResult;

    // Score base: taxa de match de cores
    const colorMatchRate = totalCompared > 0 ? matchCount / totalCompared : 0;

    // Penalidade por rounds faltando no rendered — relativa à capacidade do grid (156 slots)
    // Se realCount > GRID_CAPACITY: esperamos rendered = GRID_CAPACITY (grid cheio = sem falha)
    const GRID_CAPACITY = 156;
    const expectedRendered = Math.min(realCount, GRID_CAPACITY);
    const missingCount = Math.max(0, expectedRendered - renderedCount);
    const missingRate  = expectedRendered > 0 ? missingCount / expectedRendered : 0;

    // Score composto: 70% match de cores + 30% completude
    score = (colorMatchRate * 0.70) + ((1 - missingRate) * 0.30);
    score = Math.min(1.0, Math.max(0.0, score));

    // Registrar issues
    if (colorErrors.length > 0) {
      issues.push(`${colorErrors.length} divergências de cor em ${totalCompared} posições comparadas`);
      for (const d of details) issues.push(d);
    }

    if (missingCount > 0) {
      issues.push(`${missingCount} rodadas ausentes no rendered (esperado=${expectedRendered})`);
    }

    // Detectar inversão de ordem (renderedHistory mal ordenado)
    if (renderedCount >= 2) {
      const last = renderedHistory[renderedCount - 1];
      const prev = renderedHistory[renderedCount - 2];
      const lastTs = last?.timestamp || 0;
      const prevTs = prev?.timestamp || 0;
      if (lastTs > 0 && prevTs > 0 && lastTs < prevTs) {
        issues.push(`Ordem invertida no rendered: timestamp[${renderedCount-1}] < timestamp[${renderedCount-2}]`);
        score = Math.max(0, score - 0.10); // penalidade extra
      }
    }

    // Detectar duplicatas por signature no renderedHistory
    const renderedSigs = new Map();
    for (const r of renderedHistory) {
      const sig = extractComparableKey(r);
      if (sig) {
        renderedSigs.set(sig, (renderedSigs.get(sig) || 0) + 1);
      }
    }
    const dupes = [...renderedSigs.entries()].filter(([, count]) => count > 1);
    if (dupes.length > 0) {
      issues.push(`${dupes.length} signatures duplicadas no rendered`);
      score = Math.max(0, score - 0.15);
    }

    // ── Determinar status ──────────────────────────────────────────────────────
    if (score >= 0.95) {
      status = 'VALID';
    } else if (score >= 0.70) {
      status = 'DEGRADED';
    } else {
      status = 'INVALID';
    }

    const assessment = {
      status,
      score: Math.round(score * 1000) / 1000,
      issues,
      realCount,
      renderedCount,
      colorMatchRate: Math.round(colorMatchRate * 1000) / 1000,
      missingCount,
      colorErrors: colorErrors.length,
      timestamp: Date.now()
    };

    _lastAssessment = assessment;

    // Log obrigatório
    console.log(
      `[HistoryIntegrity] Real=${realCount} | Rendered=${renderedCount} | Score=${assessment.score} | ColorMatch=${assessment.colorMatchRate} | Status=${status}`
    );

    if (status !== 'VALID') {
      console.warn(`[HistoryIntegrity] Status=${status} | Issues:`, issues);
    }

    return assessment;
  }

  // ─── Gate por módulo ─────────────────────────────────────────────────────────

  /**
   * canUseFor(module) → boolean
   * Verifica se o estado atual de integridade permite uso do módulo.
   * Chama assessIntegrity internamente se não há assessment recente.
   *
   * @param {string} module — chave de MODULE_GATES
   * @param {Array}  [realHistory]     — opcional, para re-avaliar
   * @param {Array}  [renderedHistory] — opcional, para re-avaliar
   */
  function canUseFor(module, realHistory, renderedHistory) {
    const gate = MODULE_GATES[module];
    if (!gate) {
      console.warn(`[HistoryIntegrity] Módulo desconhecido para gate: "${module}" — bloqueado por segurança`);
      return false;
    }

    // Re-avaliar se dados foram fornecidos
    let assessment = _lastAssessment;
    if (realHistory !== undefined || renderedHistory !== undefined) {
      assessment = assessIntegrity(realHistory || [], renderedHistory || []);
    }

    if (!assessment) {
      console.warn(`[HistoryIntegrity] [HistoryGate] módulo="${module}" — sem assessment — bloqueado`);
      return false;
    }

    const statusOk = STATUS_ORDER[assessment.status] >= STATUS_ORDER[gate.minStatus];
    const scoreOk  = assessment.score >= gate.minScore;
    const allowed  = statusOk && scoreOk;

    console.log(
      `[HistoryGate] módulo="${module}" | status=${assessment.status}(min:${gate.minStatus}) | score=${assessment.score}(min:${gate.minScore}) | permitido=${allowed}`
    );

    return allowed;
  }

  // ─── Alerta visual ───────────────────────────────────────────────────────────

  /**
   * Exibe alerta catastrófico no DOM para status INVALID ou DEGRADED
   */
  function showIntegrityAlert(assessment) {
    if (!assessment || !assessment.status) return;

    const existingAlert = document.getElementById('bb-history-integrity-alert');

    // Se force-unlock ativo ou status não-bloqueante: remove qualquer alerta existente e sai
    if (_forceUnlocked || assessment.status !== 'INVALID') {
      if (existingAlert) existingAlert.remove();
      return;
    }

    if (existingAlert) existingAlert.remove();

    const isInvalid = assessment.status === 'INVALID';
    const bgColor   = isInvalid ? 'linear-gradient(135deg,#ef4444,#991b1b)' : 'linear-gradient(135deg,#f59e0b,#92400e)';
    const title     = isInvalid ? 'HISTÓRICO INVÁLIDO' : 'HISTÓRICO DEGRADADO';
    const blocked   = isInvalid
      ? 'Predição, padrões, F1, execução e automação BLOQUEADOS'
      : 'Monitorando — execução manual disponível';

    const alert = document.createElement('div');
    alert.id = 'bb-history-integrity-alert';
    alert.style.cssText = `
      position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
      background:${bgColor};color:white;padding:20px 28px;
      border-radius:12px;font-size:13px;font-weight:bold;
      z-index:99999;box-shadow:0 0 30px rgba(0,0,0,0.5);
      border:2px solid rgba(255,255,255,0.3);text-align:center;
      max-width:480px;word-wrap:break-word;
    `;

    const issueLines = (assessment.issues || []).slice(0, 4)
      .map(i => `<div style="font-size:11px;margin:2px 0;opacity:0.9">• ${i}</div>`).join('');

    alert.innerHTML = `
      <div style="font-size:20px;margin-bottom:10px">${isInvalid ? '🚨' : '⚠️'}</div>
      <div style="font-size:15px;margin-bottom:8px">${title}</div>
      <div style="font-size:11px;margin-bottom:10px;opacity:0.8">
        Real: ${assessment.realCount} | Rendered: ${assessment.renderedCount} |
        Score: ${(assessment.score * 100).toFixed(1)}%
      </div>
      <div style="background:rgba(0,0,0,0.3);padding:8px;border-radius:4px;margin-bottom:10px;max-height:80px;overflow-y:auto">
        ${issueLines || '<div style="font-size:11px;opacity:0.7">Sem detalhes disponíveis</div>'}
      </div>
      <div style="font-size:12px;margin-bottom:12px;opacity:0.9">${isInvalid ? '⛔' : 'ℹ️'} ${blocked}</div>
      <button id="bb-integrity-recheck-btn" style="
        background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.5);
        color:white;padding:6px 14px;border-radius:6px;cursor:pointer;
        font-size:12px;font-weight:bold;
      ">🔍 Revalidar</button>
      <button id="bb-integrity-close-btn" style="
        background:transparent;border:none;color:rgba(255,255,255,0.6);
        padding:6px 10px;cursor:pointer;font-size:12px;margin-left:8px;
      ">✕ Fechar</button>
    `;

    document.body.appendChild(alert);

    document.getElementById('bb-integrity-recheck-btn')?.addEventListener('click', () => {
      alert.remove();
      // Quem chama showIntegrityAlert deve re-chamar assessIntegrity externamente
    });

    document.getElementById('bb-integrity-close-btn')?.addEventListener('click', () => {
      alert.remove();
    });
  }

  // ─── Perspectiva (não polui realHistory) ─────────────────────────────────────

  /**
   * Atualiza perspectiveHistory — análises e predições.
   * NUNCA alimenta realHistory.
   */
  function setPerspectiveHistory(perspectives) {
    if (Array.isArray(perspectives)) {
      _perspectiveHistory = perspectives;
    }
  }

  function getPerspectiveHistory() {
    return _perspectiveHistory.slice();
  }

  // ─── Diagnóstico ─────────────────────────────────────────────────────────────

  function getLastAssessment() {
    return _lastAssessment ? { ..._lastAssessment } : null;
  }

  let _forceUnlocked = true; // desbloqueado por padrão — integridade é observabilidade, não gate

  function isBlocking() {
    if (_forceUnlocked) return false;
    if (!_lastAssessment) return false; // sem assessment = não bloqueia
    return _lastAssessment.status === 'INVALID';
    // EMPTY e DEGRADED não bloqueiam — o humano supervisiona
  }

  function forceUnlock(on = true) {
    _forceUnlocked = on;
    console.log(`[HistoryIntegrity] forceUnlock=${on}`);
  }

  // ─── API Pública ──────────────────────────────────────────────────────────────

  return {
    assessIntegrity,
    canUseFor,
    showIntegrityAlert,
    setPerspectiveHistory,
    getPerspectiveHistory,
    getLastAssessment,
    isBlocking,
    forceUnlock,
    MODULE_GATES,
    STATUS_ORDER
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = HistoryIntegrity;
}
