/**
 * Breakpoint Engine (Phase 3)
 * Pausa execução em pontos críticos para inspeção e análise
 * 15 tipos de breakpoints + condições customizáveis + single-step
 */

const BreakpointEngine = (() => {
  const breakpoints = new Map(); // tipo → {enabled, condition, hits}
  const breakpointHitlog = []; // histórico de acionamentos
  const pauseState = {
    paused: false,
    pausedAt: null,
    breakpointType: null,
    context: null,
    resumeCallback: null
  };

  // ═══ 1. BREAKPOINT TYPES ═══
  // 15 tipos de breakpoints para decisão e execução

  const BREAKPOINT_TYPES = {
    // Detecção de Padrão
    PATTERN_DETECTED: 'pattern_detected',           // #1: Padrão encontrado
    PATTERN_NOT_DETECTED: 'pattern_not_detected',   // #2: Nenhum padrão
    PATTERN_LOW_CONFIDENCE: 'pattern_low_confidence', // #3: Confiança baixa

    // Consenso
    CONSENSUS_RESOLVED: 'consensus_resolved',       // #4: Consenso alcançado
    CONSENSUS_WEAK: 'consensus_weak',               // #5: Consenso fraco (<70%)
    CONSENSUS_DIVERGENT: 'consensus_divergent',     // #6: Padrões divergentes

    // Conviction
    CONVICTION_CALCULATED: 'conviction_calculated', // #7: Conviction calculada
    CONVICTION_HIGH: 'conviction_high',             // #8: Conviction alta (>=80)
    CONVICTION_LOW: 'conviction_low',               // #9: Conviction baixa (<65)

    // Contexto e Validação
    CONTEXT_HEALTH_CHECK: 'context_health_check',   // #10: Saúde do contexto
    CONTEXT_UNSTABLE: 'context_unstable',           // #11: Contexto instável

    // Detecção Operacional
    OPERATIONAL_CANDIDATE_FOUND: 'operational_candidate_found', // #12: Candidato válido
    OPERATIONAL_CANDIDATE_INVALID: 'operational_candidate_invalid', // #13: Nenhum candidato

    // Execução
    BEFORE_SHADOW_CLICK: 'before_shadow_click',     // #14: Antes de shadow click
    DECISION_READY_EXECUTE: 'decision_ready_execute' // #15: Pronto para executar
  };

  // ═══ 2. BREAKPOINT REGISTRATION ═══
  // Registrar e configurar breakpoints

  function registerBreakpoint(type, options = {}) {
    if (!Object.values(BREAKPOINT_TYPES).includes(type)) {
      console.warn(`[BreakpointEngine] Tipo inválido: ${type}`);
      return false;
    }

    breakpoints.set(type, {
      type,
      enabled: options.enabled !== false, // default: true
      condition: options.condition || null, // função customizada
      description: options.description || '',
      hitCount: 0,
      lastHit: null
    });

    return true;
  }

  function enableBreakpoint(type) {
    const bp = breakpoints.get(type);
    if (bp) {
      bp.enabled = true;
      return true;
    }
    return false;
  }

  function disableBreakpoint(type) {
    const bp = breakpoints.get(type);
    if (bp) {
      bp.enabled = false;
      return true;
    }
    return false;
  }

  function setBreakpointCondition(type, conditionFn) {
    const bp = breakpoints.get(type);
    if (bp) {
      bp.condition = conditionFn;
      return true;
    }
    return false;
  }

  function getAllBreakpoints() {
    return Array.from(breakpoints.values()).map(bp => ({
      type: bp.type,
      enabled: bp.enabled,
      hasCondition: !!bp.condition,
      hitCount: bp.hitCount,
      lastHit: bp.lastHit ? new Date(bp.lastHit).toISOString() : null
    }));
  }

  // ═══ 3. BREAKPOINT EVALUATION ═══
  // Avaliar se um breakpoint deve disparar

  function shouldBreakAt(type, context = {}) {
    const bp = breakpoints.get(type);

    if (!bp || !bp.enabled) {
      return false;
    }

    // Se tem condição customizada, avaliar
    if (bp.condition) {
      try {
        const shouldBreak = bp.condition(context);
        if (!shouldBreak) return false;
      } catch (e) {
        console.error(`[BreakpointEngine] Erro na condição de ${type}:`, e.message);
        return false;
      }
    }

    return true;
  }

  function recordBreakpointHit(type, context) {
    const bp = breakpoints.get(type);
    if (bp) {
      bp.hitCount++;
      bp.lastHit = Date.now();
    }

    breakpointHitlog.push({
      type,
      timestamp: Date.now(),
      context: JSON.parse(JSON.stringify(context)) // deep copy
    });

    // Manter últimos 500 hits
    if (breakpointHitlog.length > 500) {
      breakpointHitlog.shift();
    }
  }

  // ═══ 4. PAUSE & RESUME ═══
  // Pausar execução e permitir inspeção

  function breakAt(type, context = {}) {
    if (!shouldBreakAt(type, context)) {
      return false; // Breakpoint não disparou
    }

    recordBreakpointHit(type, context);

    pauseState.paused = true;
    pauseState.pausedAt = Date.now();
    pauseState.breakpointType = type;
    pauseState.context = context;

    // Log estruturado
    const logEntry = {
      timestamp: new Date().toISOString(),
      breakpointType: type,
      contextKeys: Object.keys(context)
    };

    console.log(`[BREAKPOINT] ${type}`, logEntry);

    // Aguardar resumo
    return new Promise((resolve) => {
      pauseState.resumeCallback = resolve;

      // Injetar pause no console
      console.log(`[PAUSED AT BREAKPOINT: ${type}]`);
      console.log(`[Type: resume() no console para continuar]`);
      console.log(`[Context:`, context);
    });
  }

  function resume() {
    if (!pauseState.paused) {
      console.warn('[BreakpointEngine] Nenhuma pausa ativa');
      return false;
    }

    const callback = pauseState.resumeCallback;
    pauseState.paused = false;
    pauseState.pausedAt = null;
    pauseState.breakpointType = null;
    pauseState.resumeCallback = null;

    if (callback) {
      callback();
    }

    return true;
  }

  function isPaused() {
    return pauseState.paused;
  }

  function getPauseContext() {
    return pauseState.paused ? pauseState.context : null;
  }

  function getPauseState() {
    return {
      paused: pauseState.paused,
      pausedAt: pauseState.pausedAt ? new Date(pauseState.pausedAt).toISOString() : null,
      breakpointType: pauseState.breakpointType,
      contextKeys: pauseState.context ? Object.keys(pauseState.context) : []
    };
  }

  // ═══ 5. SINGLE-STEP MODE ═══
  // Avanço manual de breakpoint em breakpoint

  let singleStepMode = false;

  function enableSingleStep() {
    singleStepMode = true;
    // Auto-enable todos os breakpoints
    breakpoints.forEach(bp => bp.enabled = true);
    console.log('[BreakpointEngine] Single-step mode ATIVADO');
  }

  function disableSingleStep() {
    singleStepMode = false;
    console.log('[BreakpointEngine] Single-step mode DESATIVADO');
  }

  function isSingleStepMode() {
    return singleStepMode;
  }

  function nextStep() {
    if (!pauseState.paused) {
      console.warn('[BreakpointEngine] Não está pausado, use enableSingleStep()');
      return false;
    }
    return resume();
  }

  // ═══ 6. CONTEXT INSPECTION ═══
  // Inspecionar contexto no ponto de parada

  function inspectPauseContext() {
    if (!pauseState.paused) {
      return null;
    }

    return {
      breakpointType: pauseState.breakpointType,
      pausedAt: new Date(pauseState.pausedAt).toISOString(),
      context: pauseState.context
    };
  }

  function queryContext(path) {
    if (!pauseState.paused) {
      return null;
    }

    // Suportar dot notation: "padrao.confianca" → context.padrao.confianca
    const keys = path.split('.');
    let value = pauseState.context;

    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
      } else {
        return null;
      }
    }

    return value;
  }

  // ═══ 7. BREAKPOINT STATISTICS ═══
  // Estatísticas de acionamentos

  function getBreakpointStats(type = null) {
    if (type) {
      const bp = breakpoints.get(type);
      return bp ? { type, hitCount: bp.hitCount, lastHit: bp.lastHit } : null;
    }

    const stats = {};
    breakpoints.forEach((bp, key) => {
      stats[key] = {
        enabled: bp.enabled,
        hitCount: bp.hitCount,
        lastHit: bp.lastHit ? new Date(bp.lastHit).toISOString() : null
      };
    });
    return stats;
  }

  function getBreakpointHitlog(limit = 50) {
    return breakpointHitlog.slice(-limit).map(entry => ({
      type: entry.type,
      timestamp: new Date(entry.timestamp).toISOString(),
      contextKeys: Object.keys(entry.context || {})
    }));
  }

  // ═══ 8. INITIALIZATION ═══
  // Inicializar todos os 15 breakpoints com descrições

  function initializeDefaultBreakpoints() {
    const descriptions = {
      [BREAKPOINT_TYPES.PATTERN_DETECTED]: 'Padrão visual foi detectado',
      [BREAKPOINT_TYPES.PATTERN_NOT_DETECTED]: 'Nenhum padrão detectado',
      [BREAKPOINT_TYPES.PATTERN_LOW_CONFIDENCE]: 'Padrão detectado mas com confiança baixa',
      [BREAKPOINT_TYPES.CONSENSUS_RESOLVED]: 'Consenso foi alcançado entre padrões',
      [BREAKPOINT_TYPES.CONSENSUS_WEAK]: 'Consenso fraco (<70%)',
      [BREAKPOINT_TYPES.CONSENSUS_DIVERGENT]: 'Padrões divergentes detectados',
      [BREAKPOINT_TYPES.CONVICTION_CALCULATED]: 'Conviction foi calculada',
      [BREAKPOINT_TYPES.CONVICTION_HIGH]: 'Conviction alta (>=80)',
      [BREAKPOINT_TYPES.CONVICTION_LOW]: 'Conviction baixa (<65)',
      [BREAKPOINT_TYPES.CONTEXT_HEALTH_CHECK]: 'Saúde do contexto foi avaliada',
      [BREAKPOINT_TYPES.CONTEXT_UNSTABLE]: 'Contexto se tornou instável',
      [BREAKPOINT_TYPES.OPERATIONAL_CANDIDATE_FOUND]: 'Candidato operacional válido foi encontrado',
      [BREAKPOINT_TYPES.OPERATIONAL_CANDIDATE_INVALID]: 'Nenhum candidato operacional válido',
      [BREAKPOINT_TYPES.BEFORE_SHADOW_CLICK]: 'Antes de executar shadow click',
      [BREAKPOINT_TYPES.DECISION_READY_EXECUTE]: 'Decisão pronta para executar'
    };

    Object.entries(BREAKPOINT_TYPES).forEach(([_key, type]) => {
      registerBreakpoint(type, {
        enabled: false, // default: disabled
        description: descriptions[type] || ''
      });
    });
  }

  // Inicializar na carga
  initializeDefaultBreakpoints();

  // ═══ 9. DEBUGGER INTEGRATION ═══
  // Integração com debugger do navegador

  function debuggerStop(type, context) {
    console.log(`[Breakpoint: ${type}]`, context);
    debugger; // Pausa no debugger se DevTools estiver aberto
  }

  // ═══ 10. EXPORT & UTILITIES ═══
  // Exportar configuração e histórico

  function exportBreakpointConfig() {
    const config = {};
    breakpoints.forEach((bp, type) => {
      config[type] = {
        enabled: bp.enabled,
        hasCondition: !!bp.condition,
        description: bp.description
      };
    });
    return {
      singleStepMode,
      breakpoints: config,
      hitlogSize: breakpointHitlog.length
    };
  }

  function resetBreakpointStats() {
    breakpoints.forEach(bp => {
      bp.hitCount = 0;
      bp.lastHit = null;
    });
    breakpointHitlog.length = 0;
  }

  return {
    // Tipos de breakpoint (constante)
    BREAKPOINT_TYPES,

    // Registro e configuração
    registerBreakpoint,
    enableBreakpoint,
    disableBreakpoint,
    setBreakpointCondition,
    getAllBreakpoints,

    // Avaliação
    shouldBreakAt,
    breakAt,

    // Pause/Resume
    resume,
    isPaused,
    getPauseContext,
    getPauseState,

    // Single-step
    enableSingleStep,
    disableSingleStep,
    isSingleStepMode,
    nextStep,

    // Inspeção
    inspectPauseContext,
    queryContext,

    // Estatísticas
    getBreakpointStats,
    getBreakpointHitlog,

    // Debugger
    debuggerStop,

    // Exportação
    exportBreakpointConfig,
    resetBreakpointStats
  };
})();

window.BreakpointEngine = BreakpointEngine;
