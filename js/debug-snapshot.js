/*
 * BBDebug — snapshot global para diagnosticar por que o robo NAO clica.
 *
 * Uso no console do Bac Bo:
 *   BBDebug.snapshot()         -> imprime estado completo
 *   BBDebug.guards()           -> roda os 6 guards de execucao e mostra qual bloqueia
 *   BBDebug.watch(intervalMs)  -> imprime snapshot a cada N ms (default 2000)
 *   BBDebug.unwatch()          -> para o watch
 *   BBDebug.history()          -> ultimos 50 snapshots
 *
 * Adicionado em 2026-05-17 para investigar bug "robo nao clica" reportado pelo Will.
 * Apenas LEITURA — nao altera comportamento da extensao.
 */
(function () {
  'use strict';

  const PREFIX = '[BBDebug]';
  const history = [];
  const MAX_HISTORY = 50;
  let watchTimer = null;

  function safe(fn, fallback = null) {
    try { return fn(); } catch (_) { return fallback; }
  }

  function snapshot() {
    const snap = {
      ts: new Date().toISOString(),
      estadoRodadaAtual: safe(() => CONFIG?.estadoRodadaAtual, '?'),
      roundIdAtual: safe(() => CONFIG?.roundIdAtual, '?'),
      saldoReal: safe(() => CONFIG?.saldoReal, '?'),
      fonteDoSaldo: safe(() => CONFIG?.fonteDoSaldo, '?'),
      paradaGlobal: safe(() => CONFIG?.paradaGlobal, '?'),
      permitirFallbackHeuristico: safe(() => CONFIG?.permitirFallbackHeuristico, '?'),
      stakeInicial: safe(() => CONFIG?.stakeInicial, '?'),
      stakeCapMultiplier: safe(() => CONFIG?.stakeCapMultiplier, '?'),
      maxGales: safe(() => CONFIG?.maxGales, '?'),

      wsCapturando: safe(() => window.wsCapturando, '?'),
      wsDadosRecebidos: safe(() => window.wsDadosRecebidos, '?'),

      decisaoArmada: safe(() => !!window.decisaoArmada || null, '?'),
      decisaoArmadaCor: safe(() => window.decisaoArmada?.decisao?.cor, null),
      decisaoArmadaExecutando: safe(() => window.decisaoArmada?.executando, null),

      executorOcupado: safe(() => Executor?.isExecutando?.(), '?'),
      executorLastMeta: safe(() => Executor?.getLastExecutionMeta?.()?.statusExecucao, null),

      collectorRodadaAtual: safe(() => Collector?.getRodadaAtual?.(), '?'),
      collectorHistTamanho: safe(() => Collector?.getHistorico?.()?.length, '?'),

      decisionEstats: safe(() => DecisionEngine?.getEstatisticas?.(), null),
      tentativaJaRegistradaNaRodada: safe(() => {
        const rid = CONFIG?.roundIdAtual;
        return rid ? DecisionEngine?.hasTentativaParaRound?.(rid) : null;
      }, '?'),

      betConfirmTaxa: safe(() => BetConfirmationTracker?.taxa?.(), null),

      iframeDetectado: safe(() => window.iframeDetectado, '?'),
      modoPassivo: safe(() => window.modoPassivo, '?'),
    };

    history.push(snap);
    if (history.length > MAX_HISTORY) history.shift();

    console.group(`${PREFIX} snapshot @ ${snap.ts}`);
    console.table({
      estado: snap.estadoRodadaAtual,
      saldo: snap.saldoReal,
      roundId: snap.roundIdAtual,
      armada: snap.decisaoArmada,
      cor: snap.decisaoArmadaCor,
      executorOcupado: snap.executorOcupado,
      tentativaJaFeita: snap.tentativaJaRegistradaNaRodada,
      paradaGlobal: snap.paradaGlobal,
      ws: `${snap.wsCapturando}/${snap.wsDadosRecebidos}`,
    });
    console.log('FULL:', snap);
    console.groupEnd();
    return snap;
  }

  function guards() {
    const s = snapshot();
    const checks = [
      ['1. decisaoArmada existe', s.decisaoArmada === true, 'nada foi armado pelo DecisionEngine'],
      ['2. countdown nao ativo', true, '(verificar manualmente — countdownTimer privado)'],
      ['3. estadoRodadaAtual === "apostando"', s.estadoRodadaAtual === 'apostando',
        `estado atual = "${s.estadoRodadaAtual}" — parser de estado pode estar errado`],
      ['4. executor nao ocupado', s.executorOcupado !== true, 'executor ja esta executando'],
      ['5. sem tentativa nessa rodada', s.tentativaJaRegistradaNaRodada !== true,
        'rodada ja possui tentativa registrada — duplicate guard'],
      ['6. saldo >= stake', s.saldoReal !== null && s.saldoReal !== '?' && s.stakeInicial &&
        Number(s.saldoReal) >= Number(s.stakeInicial),
        `saldo=${s.saldoReal} stakeInicial=${s.stakeInicial} — GET_GAME_DATA bug?`],
      ['7. parada global desligada', s.paradaGlobal !== true, 'PARAR GLOBAL acionado'],
      ['8. WS recebendo dados', s.wsCapturando === true && s.wsDadosRecebidos === true,
        'WebSocket nao esta capturando — injected.js falhou?'],
      ['9. historico tem dados', Number(s.collectorHistTamanho) > 0,
        'collector sem historico — patterns vai dar miss'],
      ['10. fallback heuristico ON (Bac Bo Mini canvas-only)', s.permitirFallbackHeuristico === true,
        'sem fallback NAO clica em canvas-only — ver config.js:11'],
    ];

    console.group(`${PREFIX} guards check`);
    checks.forEach(([name, ok, hint]) => {
      const icon = ok ? '✅' : '❌';
      const msg = `${icon} ${name}`;
      if (ok) console.log(`%c${msg}`, 'color:#16a34a');
      else console.warn(`%c${msg}`, 'color:#dc2626;font-weight:bold', `→ ${hint}`);
    });
    console.groupEnd();
    return checks;
  }

  function watch(intervalMs = 2000) {
    if (watchTimer !== null) clearInterval(watchTimer);
    watchTimer = setInterval(snapshot, intervalMs);
    console.log(`${PREFIX} watch ON (${intervalMs}ms). Pra parar: BBDebug.unwatch()`);
  }

  function unwatch() {
    if (watchTimer !== null) { clearInterval(watchTimer); watchTimer = null; }
    console.log(`${PREFIX} watch OFF`);
  }

  window.BBDebug = {
    snapshot,
    guards,
    watch,
    unwatch,
    history: () => history.slice(),
    clear: () => { history.length = 0; console.log(`${PREFIX} historico limpo`); },
  };

  console.log(`${PREFIX} ✅ carregado — use BBDebug.guards() pra ver qual guard bloqueia o click`);
})();
