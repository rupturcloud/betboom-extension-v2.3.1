/**
 * calibration-replay-adapter.js
 * ---------------------------------------------------------------------------
 * CalibrationReplayAdapter — Liga ReplayEngine -> CalibrationLoop (modo replay).
 *
 * Responsabilidade:
 *   Intercepta os eventos `replay_started` e `replay_completed` emitidos pelo
 *   `ReplayEngine.subscribeReplayEvents(cb)` e chama, respectivamente,
 *   `CalibrationLoop.enterReplayMode(roundId)` / `exitReplayMode()`.
 *
 *   Isso garante que enquanto um replay esta rodando, qualquer
 *   `registrarResultado(...)` que cair no CalibrationLoop sera tratado como
 *   simulacao (nao polui as estatisticas reais). Tambem garante que se um
 *   replay terminar com erro, a janela seja fechada e o CalibrationLoop
 *   volte ao modo live.
 *
 * Por que aqui?
 *   - ReplayEngine nao precisa saber existir CalibrationLoop.
 *   - CalibrationLoop expoe enter/exitReplayMode; precisa de algo confiavel
 *     que abra/feche a janela sob qualquer caminho de termino do replay.
 *
 * Convencoes:
 *   - Padrao IIFE.
 *   - Resiliente: sem attach, start/stop sao no-op. Logs com prefixo
 *     `[CalibrationReplayAdapter]`.
 *   - Nao importa modulos do projeto.
 *
 * Garantias:
 *   - Janela aberta sem fechar e considerada um vazamento; um watchdog
 *     opcional (timeout configuravel via setReplayWatchdogMs) forca o
 *     exitReplayMode apos N ms para limitar dano.
 * ---------------------------------------------------------------------------
 */

const CalibrationReplayAdapter = (() => {
  'use strict';

  const PREFIX = '[CalibrationReplayAdapter]';

  // Watchdog default: 60s. Se um replay nao emitir replay_completed em
  // ate esse tempo, forca exit para evitar contaminacao prolongada.
  const DEFAULT_WATCHDOG_MS = 60_000;

  let replayEngine = null;
  let calibration = null;
  let started = false;

  let unsubscribeReplay = null;
  let watchdogTimer = null;
  let watchdogMs = DEFAULT_WATCHDOG_MS;
  let replayAtivo = null; // roundId atual em replay (ou null)

  // ===========================================================================
  // Helpers
  // ===========================================================================

  function log(...args) { try { console.log(PREFIX, ...args); } catch (_) {} }
  function warn(...args) { try { console.warn(PREFIX, ...args); } catch (_) {} }

  function podeAttachado() {
    return !!(replayEngine && calibration);
  }

  function classificar(evento) {
    if (!evento || typeof evento !== 'object') return null;
    // Aceitamos varios formatos: { type:'replay_started' } ou
    // { event:'replay_started' } ou tipo top-level no payload.
    return (
      evento.type ||
      evento.event ||
      evento.tipo ||
      (evento.payload && (evento.payload.type || evento.payload.tipo)) ||
      null
    );
  }

  function extrairRoundId(evento) {
    if (!evento) return null;
    return (
      evento.roundId ||
      (evento.payload && evento.payload.roundId) ||
      null
    );
  }

  function entrarReplay(roundId) {
    if (!calibration || typeof calibration.enterReplayMode !== 'function') return;
    try {
      calibration.enterReplayMode(roundId);
      replayAtivo = roundId || true;
      armarWatchdog();
      log('enterReplayMode OK', roundId);
    } catch (err) {
      warn('enterReplayMode falhou:', err && err.message);
    }
  }

  function sairReplay(motivo) {
    if (!replayAtivo) return;
    if (calibration && typeof calibration.exitReplayMode === 'function') {
      try {
        calibration.exitReplayMode();
        log('exitReplayMode OK', motivo || '');
      } catch (err) {
        warn('exitReplayMode falhou:', err && err.message);
      }
    }
    desarmarWatchdog();
    replayAtivo = null;
  }

  function armarWatchdog() {
    desarmarWatchdog();
    if (!Number.isFinite(watchdogMs) || watchdogMs <= 0) return;
    watchdogTimer = setTimeout(() => {
      warn('watchdog disparou; forcando exitReplayMode');
      sairReplay('watchdog');
    }, watchdogMs);
  }

  function desarmarWatchdog() {
    if (watchdogTimer) {
      try { clearTimeout(watchdogTimer); } catch (_) { /* noop */ }
      watchdogTimer = null;
    }
  }

  function handleReplayEvent(evento) {
    if (!podeAttachado()) return;
    const tipo = classificar(evento);
    if (!tipo) return;
    if (tipo === 'replay_started') {
      const roundId = extrairRoundId(evento);
      entrarReplay(roundId);
    } else if (tipo === 'replay_completed' || tipo === 'replay_finished') {
      sairReplay('completed');
    } else if (tipo === 'replay_error' || tipo === 'replay_aborted') {
      sairReplay(tipo);
    }
  }

  // ===========================================================================
  // API publica
  // ===========================================================================

  return {
    /**
     * Conecta dependencias.
     * @param {object} deps
     * @param {object} deps.replayEngine — ReplayEngine
     * @param {object} deps.calibration  — CalibrationLoop
     */
    attach(deps) {
      if (!deps || typeof deps !== 'object') {
        warn('attach() sem deps; ignorando.');
        return;
      }
      replayEngine = deps.replayEngine || null;
      calibration = deps.calibration || null;
      log('attach OK', { replayEngine: !!replayEngine, calibration: !!calibration });
    },

    detach() {
      this.stop();
      replayEngine = null;
      calibration = null;
      log('detach OK');
    },

    /**
     * Ajusta o watchdog (ms). Use 0 ou negativo para desabilitar.
     * @param {number} ms
     */
    setReplayWatchdogMs(ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms)) return;
      watchdogMs = ms;
      log('watchdogMs ajustado para', ms);
    },

    /**
     * Inicia a escuta dos eventos de replay. Idempotente.
     */
    start() {
      if (started) return;
      if (!podeAttachado()) {
        warn('start() sem attach completo; no-op.');
        return;
      }
      if (typeof replayEngine.subscribeReplayEvents !== 'function') {
        warn('replayEngine.subscribeReplayEvents ausente; no-op.');
        return;
      }
      try {
        unsubscribeReplay = replayEngine.subscribeReplayEvents(handleReplayEvent);
      } catch (err) {
        warn('subscribeReplayEvents falhou:', err && err.message);
        unsubscribeReplay = null;
        return;
      }
      started = true;
      log('start OK');
    },

    /**
     * Desliga a escuta e fecha qualquer janela aberta.
     */
    stop() {
      if (!started) return;
      if (typeof unsubscribeReplay === 'function') {
        try { unsubscribeReplay(); } catch (_) { /* noop */ }
      }
      unsubscribeReplay = null;
      // Defensivo: se algum replay estiver em curso, fechamos para evitar
      // que o CalibrationLoop fique preso em modo replay.
      if (replayAtivo) sairReplay('stop');
      started = false;
      log('stop OK');
    },

    _debug() {
      return {
        attached: { replayEngine: !!replayEngine, calibration: !!calibration },
        started,
        replayAtivo,
        watchdogMs,
        watchdogArmado: !!watchdogTimer
      };
    }
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CalibrationReplayAdapter;
}

/* ---------------------------------------------------------------------------
 * Exemplo de uso (referencia):
 *
 *   CalibrationReplayAdapter.attach({
 *     replayEngine: ReplayEngine,
 *     calibration: CalibrationLoop
 *   });
 *   CalibrationReplayAdapter.setReplayWatchdogMs(45_000);
 *   CalibrationReplayAdapter.start();
 *
 *   // A partir daqui, qualquer replayRound() do ReplayEngine
 *   // automaticamente coloca o CalibrationLoop em replay mode e
 *   // o tira ao terminar — sem que ReplayEngine e CalibrationLoop
 *   // se enxerguem diretamente.
 *
 *   CalibrationReplayAdapter.stop();
 * ------------------------------------------------------------------------- */
