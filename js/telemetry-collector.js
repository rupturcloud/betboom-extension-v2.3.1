/**
 * BetBoom Auto Pattern — Telemetry & Reverse-Engineering Collector v1.0
 *
 * Integrado à extensão. Coleta automaticamente:
 *  • Evolution variant + DOM markers
 *  • Selector effectiveness (registra sucesso/falha por seletor)
 *  • Performance metrics (click latency, WS response, render)
 *  • Decision paths (histórico de decisões + resultado)
 *  • State transitions (rodada, saldo, resultados)
 *  • Edge cases (timeouts, UI bloqueado, cascatas)
 *
 * Roda em background — agrupa eventos em buckets e emite DELTA_UPDATE.
 * Sem intervenção do operador — Shadow mode por padrão.
 *
 * API pública:
 *   TelemetryCollector.start()           — inicia coleta contínua
 *   TelemetryCollector.stop()            — para coleta
 *   TelemetryCollector.getReport()       — snapshot atual
 *   TelemetryCollector.exportReport()    — export JSON completo
 *   TelemetryCollector.clearBuffer()     — zera buffer
 *   TelemetryCollector.trackEvent(t, d)  — log manual
 *   TelemetryCollector.trackSelector(s, ok) — registra uso de seletor
 */

const TelemetryCollector = (() => {
  const PREFIX = '[Telemetry]';
  const VERSION = '1.0.0';
  const REPORT_KEY = 'bb_telemetry_report';
  const EVENTS_KEY = 'bb_telemetry_events';
  const FLUSH_INTERVAL_MS = 30_000;   // grava snapshot a cada 30s
  const MAX_EVENTS = 500;             // ring buffer
  const MAX_LATENCIES = 200;

  let started = false;
  let startTime = null;
  let flushTimer = null;
  let stateWatchTimer = null;

  // ———————————————————————————————————————————————
  //  DATA STORES
  // ———————————————————————————————————————————————
  const events = [];          // ring-buffer de eventos
  const selectorStats = {};   // { selector: { hits, misses, lastSeen, type } }
  const latencies = {
    click: [],
    wsResponse: [],
    render: [],
    decisionCycle: []
  };
  const decisionLog = [];     // { decision, result, duration, route }
  const stateTransitions = []; // { before, after, changes, timestamp }
  const edgeCases = [];        // casos anômalos detectados
  let lastState = null;

  // ———————————————————————————————————————————————
  //  1. CORE: track event
  // ———————————————————————————————————————————————
  function trackEvent(type, data = {}) {
    const ev = {
      ts: Date.now(),
      type,
      data
    };
    events.push(ev);
    if (events.length > MAX_EVENTS) events.shift();
    return ev;
  }

  // ———————————————————————————————————————————————
  //  2. SELECTOR STATS
  // ———————————————————————————————————————————————
  function trackSelector(selector, ok, type = 'unknown') {
    if (!selector) return;
    if (!selectorStats[selector]) {
      selectorStats[selector] = { hits: 0, misses: 0, lastSeen: 0, type };
    }
    const s = selectorStats[selector];
    if (ok) s.hits += 1; else s.misses += 1;
    s.lastSeen = Date.now();
    s.type = type;
  }

  // ———————————————————————————————————————————————
  //  3. LATENCY
  // ———————————————————————————————————————————————
  function trackLatency(kind, ms) {
    if (!latencies[kind]) latencies[kind] = [];
    latencies[kind].push({ ms, ts: Date.now() });
    if (latencies[kind].length > MAX_LATENCIES) latencies[kind].shift();
  }

  function latencyStats(kind) {
    const arr = (latencies[kind] || []).map(x => x.ms).sort((a, b) => a - b);
    if (!arr.length) return null;
    const avg = arr.reduce((s, v) => s + v, 0) / arr.length;
    const p50 = arr[Math.floor(arr.length * 0.5)];
    const p95 = arr[Math.floor(arr.length * 0.95)];
    return {
      samples: arr.length,
      avg: +avg.toFixed(1),
      p50: +p50.toFixed(1),
      p95: +p95.toFixed(1),
      min: arr[0],
      max: arr[arr.length - 1]
    };
  }

  // ———————————————————————————————————————————————
  //  4. DECISION LOG
  // ———————————————————————————————————————————————
  function trackDecision({ decision, result, route, duration }) {
    decisionLog.push({
      ts: Date.now(),
      decision: decision?.padrao?.nome || decision?.cor || 'unknown',
      result: result?.ok ? 'executed' : 'blocked',
      reason: result?.reason,
      route,
      duration
    });
    if (decisionLog.length > MAX_EVENTS) decisionLog.shift();
  }

  // ———————————————————————————————————————————————
  //  5. EVOLUTION PROFILE
  // ———————————————————————————————————————————————
  function captureEvolutionProfile() {
    const profile = {
      ts: Date.now(),
      variant: 'unknown',
      markers: {}
    };
    try {
      if (typeof EvolutionDetector !== 'undefined' && EvolutionDetector.getProfile) {
        const p = EvolutionDetector.getProfile();
        if (p) Object.assign(profile, p);
      }
      // Fallback manual
      if (document.querySelector('[data-automation-id="bet-spot-player"]')) {
        profile.markers.miniSignature = true;
      }
      if (document.querySelector('[class*="betting-grid-item"]')) {
        profile.markers.fullSignature = true;
      }
      profile.viewport = { w: window.innerWidth, h: window.innerHeight };
      profile.readyState = document.readyState;
    } catch (e) {
      profile.error = e.message;
    }
    return profile;
  }

  // ———————————————————————————————————————————————
  //  6. STATE TRANSITIONS (watcher)
  // ———————————————————————————————————————————————
  function captureStateSnapshot() {
    if (typeof Collector === 'undefined') return null;
    try {
      return {
        ts: Date.now(),
        rodada: Collector.getRodadaAtual?.() ?? null,
        estado: Collector.getEstado?.() ?? null,
        saldo: Collector.getSaldo?.() ?? null,
        ultimoResultado: Collector.getUltimoResultado?.() ?? null
      };
    } catch {
      return null;
    }
  }

  function watchStateTransitions() {
    const snap = captureStateSnapshot();
    if (!snap) return;
    if (lastState) {
      const changes = [];
      if (lastState.rodada !== snap.rodada)
        changes.push(`rodada: ${lastState.rodada} → ${snap.rodada}`);
      if (lastState.estado !== snap.estado)
        changes.push(`estado: ${lastState.estado} → ${snap.estado}`);
      if (lastState.saldo !== snap.saldo)
        changes.push(`saldo: ${lastState.saldo} → ${snap.saldo}`);
      if (changes.length) {
        stateTransitions.push({ ts: snap.ts, changes, before: lastState, after: snap });
        if (stateTransitions.length > MAX_EVENTS) stateTransitions.shift();
        trackEvent('state_transition', { changes });
      }
    }
    lastState = snap;
  }

  // ———————————————————————————————————————————————
  //  7. EDGE CASE DETECTION
  // ———————————————————————————————————————————————
  function detectEdgeCases() {
    const ec = [];
    try {
      // a) WebSocket ↔ DOM mismatch
      if (typeof ValidationCrossCheck !== 'undefined') {
        const v = ValidationCrossCheck.validate();
        if (v && !v.isValid) {
          v.issues.forEach(issue => ec.push({
            ts: Date.now(),
            kind: 'validation-issue',
            severity: issue.severity,
            type: issue.type,
            msg: issue.msg
          }));
        }
      }
      // b) Circuit breaker aberto
      if (typeof InfraGuardrails !== 'undefined') {
        const h = InfraGuardrails.getHealthStatus?.();
        if (h && h.circuitState === 'open') {
          ec.push({
            ts: Date.now(),
            kind: 'circuit-open',
            blockRate: h.blockRate
          });
        }
        if (h && parseFloat(h.blockRate) > 70) {
          ec.push({
            ts: Date.now(),
            kind: 'high-block-rate',
            blockRate: h.blockRate,
            topBlockers: h.topBlockers
          });
        }
      }
    } catch (e) {
      ec.push({ ts: Date.now(), kind: 'detector-error', error: e.message });
    }
    ec.forEach(e => edgeCases.push(e));
    if (edgeCases.length > MAX_EVENTS) {
      edgeCases.splice(0, edgeCases.length - MAX_EVENTS);
    }
    return ec;
  }

  // ———————————————————————————————————————————————
  //  8. HOOKS — monkey-patch nos módulos existentes
  // ———————————————————————————————————————————————
  function installHooks() {
    // Hook: Executor.executarAposta → mede click latency
    try {
      if (typeof Executor !== 'undefined' && Executor.executarAposta && !Executor.__telemetryHooked) {
        const original = Executor.executarAposta.bind(Executor);
        Executor.executarAposta = async function (decisao) {
          const t0 = performance.now();
          const result = await original(decisao);
          const dt = performance.now() - t0;
          trackLatency('click', dt);
          trackDecision({ decision: decisao, result: { ok: result }, duration: dt });
          trackEvent('execution', { ok: !!result, ms: +dt.toFixed(1) });
          return result;
        };
        Executor.__telemetryHooked = true;
        console.log(`${PREFIX} ✅ Hook em Executor.executarAposta`);
      }
    } catch (e) { /* noop */ }

    // Hook: InfraGuardrails.executeWithGuardrails → mede full cycle
    try {
      if (typeof InfraGuardrails !== 'undefined' && InfraGuardrails.executeWithGuardrails && !InfraGuardrails.__telemetryHooked) {
        const original = InfraGuardrails.executeWithGuardrails.bind(InfraGuardrails);
        InfraGuardrails.executeWithGuardrails = async function (decisao) {
          const t0 = performance.now();
          const res = await original(decisao);
          const dt = performance.now() - t0;
          trackLatency('decisionCycle', dt);
          trackEvent('guardrails_cycle', {
            ok: res?.ok,
            reason: res?.reason,
            attempts: res?.attempts,
            ms: +dt.toFixed(1)
          });
          return res;
        };
        InfraGuardrails.__telemetryHooked = true;
        console.log(`${PREFIX} ✅ Hook em InfraGuardrails.executeWithGuardrails`);
      }
    } catch (e) { /* noop */ }

    // Hook: EvolutionDetector.registerWorkingSelector
    try {
      if (typeof EvolutionDetector !== 'undefined' && EvolutionDetector.registerWorkingSelector && !EvolutionDetector.__telemetryHooked) {
        const original = EvolutionDetector.registerWorkingSelector.bind(EvolutionDetector);
        EvolutionDetector.registerWorkingSelector = function (selector, type) {
          trackSelector(selector, true, type);
          return original(selector, type);
        };
        EvolutionDetector.__telemetryHooked = true;
        console.log(`${PREFIX} ✅ Hook em EvolutionDetector.registerWorkingSelector`);
      }
    } catch (e) { /* noop */ }
  }

  // ———————————————————————————————————————————————
  //  9. REPORT GENERATION
  // ———————————————————————————————————————————————
  function buildReport() {
    const health = (typeof InfraGuardrails !== 'undefined' && InfraGuardrails.getHealthStatus)
      ? InfraGuardrails.getHealthStatus() : null;

    const adaptive = (typeof AdaptiveFlowEngine !== 'undefined' && AdaptiveFlowEngine.getResilienceMetrics)
      ? AdaptiveFlowEngine.getResilienceMetrics() : null;

    const learnedRoutes = (typeof AdaptiveFlowEngine !== 'undefined' && AdaptiveFlowEngine.getLearnedRoutes)
      ? AdaptiveFlowEngine.getLearnedRoutes() : null;

    // Top selectors by effectiveness
    const topSelectors = Object.entries(selectorStats)
      .map(([sel, s]) => ({
        selector: sel,
        type: s.type,
        hits: s.hits,
        misses: s.misses,
        successRate: s.hits + s.misses > 0
          ? ((s.hits / (s.hits + s.misses)) * 100).toFixed(1) + '%'
          : 'n/a'
      }))
      .sort((a, b) => b.hits - a.hits)
      .slice(0, 20);

    return {
      version: VERSION,
      startedAt: startTime ? new Date(startTime).toISOString() : null,
      generatedAt: new Date().toISOString(),
      durationMs: startTime ? Date.now() - startTime : 0,
      evolution: captureEvolutionProfile(),
      health,
      adaptive,
      learnedRoutes,
      latency: {
        click: latencyStats('click'),
        wsResponse: latencyStats('wsResponse'),
        render: latencyStats('render'),
        decisionCycle: latencyStats('decisionCycle')
      },
      topSelectors,
      decisionLog: decisionLog.slice(-50),
      stateTransitions: stateTransitions.slice(-30),
      edgeCases: edgeCases.slice(-50),
      eventsTotal: events.length,
      recentEvents: events.slice(-30)
    };
  }

  function flushToStorage() {
    try {
      const report = buildReport();
      localStorage.setItem(REPORT_KEY, JSON.stringify(report));
      // mini-log de status
      const h = report.health;
      console.log(
        `${PREFIX} 📊 flush | events=${events.length} | ` +
        `decisions=${decisionLog.length} | ` +
        `edgeCases=${edgeCases.length} | ` +
        `block=${h?.blockRate ?? 'n/a'} | ` +
        `exec=${h?.executionRate ?? 'n/a'}`
      );
      // emite para background (DELTA_UPDATE)
      try {
        chrome?.runtime?.sendMessage?.({
          type: 'TELEMETRY_FLUSH',
          payload: {
            ts: Date.now(),
            health: h,
            edgeCaseCount: edgeCases.length,
            events: events.length
          }
        });
      } catch { /* ignore */ }
    } catch (e) {
      console.warn(`${PREFIX} Falha no flush:`, e.message);
    }
  }

  // ———————————————————————————————————————————————
  //  10. PUBLIC API
  // ———————————————————————————————————————————————
  return {
    start() {
      if (started) return;
      started = true;
      startTime = Date.now();
      console.log(`${PREFIX} 🚀 Iniciado (v${VERSION})`);

      // instala hooks (pode falhar se módulos ainda não carregados → retry)
      installHooks();
      setTimeout(installHooks, 1_000);
      setTimeout(installHooks, 5_000);

      // watcher de state transitions (1s)
      stateWatchTimer = setInterval(() => {
        try {
          watchStateTransitions();
          detectEdgeCases();
        } catch { /* noop */ }
      }, 1_000);

      // flush periódico
      flushTimer = setInterval(flushToStorage, FLUSH_INTERVAL_MS);

      // primeiro flush rápido
      setTimeout(flushToStorage, 5_000);

      trackEvent('telemetry_started', { version: VERSION });
    },

    stop() {
      started = false;
      if (flushTimer) clearInterval(flushTimer);
      if (stateWatchTimer) clearInterval(stateWatchTimer);
      flushTimer = stateWatchTimer = null;
      flushToStorage();
      console.log(`${PREFIX} 🛑 Parado`);
    },

    getReport: buildReport,

    exportReport() {
      const report = buildReport();
      const json = JSON.stringify(report, null, 2);
      console.log(`${PREFIX} 📤 Relatório (${json.length} chars):`);
      console.log(json);
      return report;
    },

    clearBuffer() {
      events.length = 0;
      decisionLog.length = 0;
      stateTransitions.length = 0;
      edgeCases.length = 0;
      Object.keys(selectorStats).forEach(k => delete selectorStats[k]);
      Object.keys(latencies).forEach(k => { latencies[k] = []; });
      lastState = null;
      console.log(`${PREFIX} 🧹 Buffer limpo`);
    },

    trackEvent,
    trackSelector,
    trackLatency,
    trackDecision,

    // introspecção rápida via console
    debug() {
      const r = buildReport();
      console.table({
        uptime_s: ((Date.now() - startTime) / 1000).toFixed(0),
        events: events.length,
        decisions: decisionLog.length,
        transitions: stateTransitions.length,
        edgeCases: edgeCases.length,
        selectors: Object.keys(selectorStats).length,
        blockRate: r.health?.blockRate ?? 'n/a',
        executionRate: r.health?.executionRate ?? 'n/a',
        circuit: r.health?.circuitState ?? 'n/a'
      });
      return r;
    }
  };
})();

// Auto-start se flag presente (default: ON)
try {
  const AUTO_START = localStorage.getItem('bb_telemetry_autostart');
  if (AUTO_START === null || AUTO_START === 'true') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => TelemetryCollector.start());
    } else {
      TelemetryCollector.start();
    }
  }
} catch {
  // em contexto sem localStorage, start incondicional
  TelemetryCollector.start();
}

// Atalhos globais para console
try {
  window.BB_TELEMETRY = TelemetryCollector;
  window.BB_REPORT = () => TelemetryCollector.exportReport();
  window.BB_DEBUG = () => TelemetryCollector.debug();
} catch { /* noop */ }
