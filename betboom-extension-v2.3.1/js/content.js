/**
 * BetBoom Auto Pattern — Content Script (MVP WS Evo/Bac Bo) v2.1
 *
 * Top frame:
 * - inicializa overlay
 * - recebe eventos WS locais e relayed
 * - parseia Bac Bo (estado, resultado confirmado, saldo)
 *
 * Subframe:
 * - bridge-only
 * - injeta o interceptor e reencaminha eventos para o frame 0 via background
 */

(function () {
  'use strict';

  if (globalThis.__betboomContentMvpBooted) {
    console.info('[BetBoom Auto] Boot duplicado ignorado neste frame.');
    return;
  }
  globalThis.__betboomContentMvpBooted = true;

  const IS_TOP_FRAME = window.top === window;
  const FRAME_TAG = IS_TOP_FRAME ? 'top' : 'subframe';
  const WS_SOURCE = 'betboom-ws-interceptor';
  const WS_CHANNELS = new Set(['betboom-platform', 'evo-game', 'evo-chat', 'evo-video', 'other']);
  const WS_DIRECTIONS = new Set(['open', 'close', 'sent', 'received']);
  const ALLOWED_RESULTS = new Set(['Player', 'Banker', 'Tie']);
  // [R6-SECURITY] Allowlist de origens legítimas para postMessage 'bb-click-result-hardware'.
  // Vetor de ataque: scripts de terceiros (ads, captcha, extensões) podem injetar postMessage
  // com {source: 'bb-click-result-hardware', x: N, y: M} e disparar CDP click em coords arbitrárias.
  // Mitigação: aceitar somente se event.source ∈ iframes filhos OU event.origin termina em
  // um dos hosts conhecidos da cadeia Evolution/Betboom.
  const HARDWARE_CLICK_ORIGIN_ALLOWLIST = [
    'evo-games.com',
    'billing-boom.com',
    'evolution.com',
    'evobetting.com',
    'egcvi.com'
  ];
  // Janela de dedup para mitigar replay (msgs idênticas em rápida sucessão).
  const HARDWARE_CLICK_DEDUP_WINDOW_MS = 100;
  const __bbHardwareClickDedup = { ts: 0, x: null, y: null };
  const NON_BLOCKING_RUNTIME_ERRORS = [
    /receiving end does not exist/i,
    /message port closed/i,
    /frame with id 0 was removed/i,
    /tab was closed/i,
    /the page keeping the extension port is moved into back\/forward cache/i,
    /extension context invalidated/i
  ];

  let overlayInicializado = false;
  let wsCapturando = false;
  let wsDadosRecebidos = false;
  let modoPassivo = true;
  let iframeDetectado = false;
  let interceptorToken = null;
  let runtimeRelayInvalidado = false;
  let runtimeRelayWarned = false;

  const runtimeNoiseLogged = new Set();

  const parserState = {
    currentGameId: null,
    currentStage: null,
    pendingResolvedGameId: null,
    lastRoadSignature: null,
    lastSyncedRoadLength: 0,  // quantos itens do road já foram enviados ao Collector
    lastSaldoReal: null,
    lastSaldoSource: null,
    lastStageKey: null,
    lastResultado: null,
    channelsAtivos: new Set(),
    totalMessages: 0,
    gameMessages: 0,
    totalConnections: 0,
    activeConnections: 0,
    // Wire-up RoundLifecycle: ultima decisao tomada (preenchida via DecisionEngine.getEstatisticas)
    lastDecisionPadraoId: null,
    lastDecisionConfianca: null
  };

  Logger.info(`Content script v2.1 carregado [${FRAME_TAG}]`, window.location.href);
  console.log(`[BetBoom Auto] [${FRAME_TAG}] Content script carregado:`, window.location.href);

  function aguardarDOM() {
    return new Promise((resolve) => {
      if (document.readyState === 'complete' || document.readyState === 'interactive') {
        resolve();
        return;
      }
      document.addEventListener('DOMContentLoaded', resolve, { once: true });
    });
  }

  function carregarConfig() {
    return new Promise((resolve) => {
      try {
        const keys = [
          BBStrategyUtils.STORAGE_KEYS.config,
          BBStrategyUtils.STORAGE_KEYS.strategyLibrary,
          BBStrategyUtils.STORAGE_KEYS.strategyLibraryBootstrapped,
          BBStrategyUtils.STORAGE_KEYS.strategyPreferences
        ];

        chrome.storage.local.get(keys, (data) => {
          if (data?.config) {
            BBConfigUtils.applyPersistedConfig(CONFIG, data.config);
          }

          const bootstrap = BBStrategyUtils.ensureBootstrapPayload(data);
          CONFIG.strategyLibrary = bootstrap.strategyLibrary;
          CONFIG.strategyPreferences = bootstrap.strategyPreferences;

          if (bootstrap.shouldBootstrap) {
            chrome.storage.local.set({
              [BBStrategyUtils.STORAGE_KEYS.strategyLibrary]: bootstrap.strategyLibrary,
              [BBStrategyUtils.STORAGE_KEYS.strategyLibraryBootstrapped]: true,
              [BBStrategyUtils.STORAGE_KEYS.strategyPreferences]: bootstrap.strategyPreferences
            });
          }

          if (typeof PatternEngine !== 'undefined' && PatternEngine.setStrategyLibrary) {
            PatternEngine.setStrategyLibrary(bootstrap.strategyLibrary);
          }

          resolve();
        });
      } catch (error) {
        Logger.warn('Falha ao carregar config do storage:', error?.message || error);
        resolve();
      }
    });
  }

  function injetarWebSocketInterceptor() {
    if (globalThis.__betboomInterceptorRequested) {
      return;
    }
    globalThis.__betboomInterceptorRequested = true;
    interceptorToken = `bb-int-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('js/injected.js');
      script.dataset.betboomInterceptor = FRAME_TAG;
      script.dataset.betboomInterceptorToken = interceptorToken;
      script.onload = function () {
        Logger.info(`Interceptor WS injetado [${FRAME_TAG}]`);
        this.remove();
      };
      script.onerror = function () {
        Logger.error(`Falha ao injetar interceptor WS [${FRAME_TAG}]`);
      };
      (document.head || document.documentElement).appendChild(script);
    } catch (error) {
      Logger.error(`Erro ao injetar interceptor [${FRAME_TAG}]`, error?.message || error);
    }
  }

  function toWindowEnvelope(event) {
    if (event.source !== window) return null;
    if (!event.data || event.data.source !== WS_SOURCE) return null;

    if (!interceptorToken || event.data.token !== interceptorToken) {
      return null;
    }

    const payload = event.data.payload || null;
    if (!isValidWindowEnvelope(payload)) {
      return null;
    }

    return payload;
  }

  function isValidWindowEnvelope(payload) {
    if (!payload || typeof payload !== 'object') return false;
    if (payload.kind !== 'bb_ws_raw') return false;
    if (!WS_CHANNELS.has(payload.channel || 'other')) return false;
    if (!WS_DIRECTIONS.has(payload.direction)) return false;
    if (typeof payload.socketUrl !== 'string') return false;
    if (payload.text !== null && typeof payload.text !== 'string') return false;
    if (payload.binaryLength !== null && !Number.isFinite(Number(payload.binaryLength))) return false;
    if (!Number.isFinite(Number(payload.timestamp))) return false;
    return true;
  }

  function safeQuerySelector(selector) {
    if (typeof selector !== 'string' || !selector.trim()) return null;

    try {
      return document.querySelector(selector);
    } catch (error) {
      Logger.warn('Seletor inválido ignorado:', selector, error?.message || error);
      return null;
    }
  }

  function hasElementForSelector(selector) {
    return Boolean(safeQuerySelector(selector));
  }

  function isNonBlockingRuntimeError(message) {
    if (!message) return false;
    return NON_BLOCKING_RUNTIME_ERRORS.some((pattern) => pattern.test(message));
  }

  function isRuntimeContextValid() {
    if (runtimeRelayInvalidado) return false;

    try {
      return typeof chrome !== 'undefined' &&
        !!chrome.runtime &&
        typeof chrome.runtime.sendMessage === 'function' &&
        typeof chrome.runtime.id === 'string' &&
        chrome.runtime.id.length > 0;
    } catch (_) {
      return false;
    }
  }

  function logRuntimeNoiseOnce(message) {
    const normalized = String(message || 'erro-runtime-desconhecido').trim().toLowerCase();
    if (runtimeNoiseLogged.has(normalized)) return;
    runtimeNoiseLogged.add(normalized);
    console.info('[BetBoom Auto] [service.worker] ruído não-bloqueante:', message);
  }

  function desativarRelaySubframe() {
    if (IS_TOP_FRAME) return;

    try {
      window.removeEventListener('message', tratarMensagemWindow);
    } catch (_) { }

    try {
      document.removeEventListener('click', tratarCliqueOperador, true);
    } catch (_) { }
  }

  function marcarRuntimeInvalidado(message, contexto = 'runtime') {
    runtimeRelayInvalidado = true;
    desativarRelaySubframe();

    if (runtimeRelayWarned) return;
    runtimeRelayWarned = true;

    const detail = message || 'Extension context invalidated';
    console.warn(`[BetBoom Auto] [${FRAME_TAG}] relay desativado (${contexto}): ${detail}`);
    Logger.warn(`Relay desativado [${FRAME_TAG}] (${contexto}): ${detail}`);
  }

  function readRuntimeLastErrorMessage() {
    try {
      return chrome.runtime?.lastError?.message || null;
    } catch (_) {
      return null;
    }
  }

  function safeRuntimeSendMessage(payload, contexto, onSuccess = null) {
    if (!isRuntimeContextValid()) {
      marcarRuntimeInvalidado('Extension context invalidated', contexto);
      return false;
    }

    try {
      chrome.runtime.sendMessage(payload, () => {
        const message = readRuntimeLastErrorMessage();
        if (message) {
          if (/extension context invalidated/i.test(message)) {
            marcarRuntimeInvalidado(message, contexto);
            return;
          }

          if (isNonBlockingRuntimeError(message)) {
            logRuntimeNoiseOnce(message);
            return;
          }

          Logger.warn(`Falha em ${contexto}:`, message);
          return;
        }

        if (typeof onSuccess === 'function') {
          onSuccess();
        }
      });

      return true;
    } catch (error) {
      const message = error?.message || String(error || 'Erro desconhecido');
      if (/extension context invalidated/i.test(message)) {
        marcarRuntimeInvalidado(message, contexto);
        return false;
      }

      Logger.warn(`Erro ao chamar runtime em ${contexto}:`, message);
      return false;
    }
  }

  function safeJsonParse(text) {
    if (typeof text !== 'string' || !text.trim()) return null;

    try {
      return JSON.parse(text);
    } catch (_) { }

    const trimmed = text.trim();
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const maybeJson = trimmed.slice(firstBrace, lastBrace + 1);
      try {
        return JSON.parse(maybeJson);
      } catch (_) { }
    }

    const firstBracket = trimmed.indexOf('[');
    const lastBracket = trimmed.lastIndexOf(']');
    if (firstBracket >= 0 && lastBracket > firstBracket) {
      const maybeArray = trimmed.slice(firstBracket, lastBracket + 1);
      try {
        return JSON.parse(maybeArray);
      } catch (_) { }
    }

    return null;
  }

  function splitSelectors(selectors) {
    return String(selectors || '')
      .split(',')
      .map((selector) => selector.trim())
      .filter(Boolean);
  }

  function closestBySelectors(target, selectors) {
    if (!target || !selectors) return null;
    for (const selector of splitSelectors(selectors)) {
      try {
        const match = target.closest(selector);
        if (match) return match;
      } catch (_) { }
    }
    return null;
  }

  function inferirCorBotao(target) {
    if (!target) return null;
    if (closestBySelectors(target, CONFIG.selectors.btnVermelho)) return 'vermelho';
    if (closestBySelectors(target, CONFIG.selectors.btnAzul)) return 'azul';
    if (closestBySelectors(target, CONFIG.selectors.btnEmpate)) return 'empate';

    const attrs = [
      target.className || '',
      target.textContent || '',
      target.getAttribute?.('data-color') || ''
    ].join(' ').toLowerCase();

    if (/(red|vermelho|banker)/.test(attrs)) return 'vermelho';
    if (/(blue|azul|player|black|preto)/.test(attrs)) return 'azul';
    if (/(green|tie|empate|white)/.test(attrs)) return 'empate';
    return null;
  }

  function lerStakeAtualOperador() {
    let field = null;
    for (const selector of splitSelectors(CONFIG.selectors.inputStake)) {
      try {
        field = document.querySelector(selector);
      } catch (_) {
        field = null;
      }
      if (field) break;
    }
    if (!field) return Number(CONFIG.stakeInicial || 0);

    const numeric = Number(String(field.value || field.textContent || '').replace(',', '.').replace(/[^\d.]/g, ''));
    return Number.isFinite(numeric) && numeric > 0 ? numeric : Number(CONFIG.stakeInicial || 0);
  }

  function buildSessionReportResponse(limit = 200) {
    const reportJson = typeof exportSession === 'function' ? exportSession(limit) : '{}';
    const reportMarkdown = typeof exportSessionMarkdown === 'function' ? exportSessionMarkdown(limit) : '# Sessão\n\nSem dados.';
    const parsed = safeJsonParse(reportJson);
    const totalEntradas = Number(parsed?.resumoOperacional?.totalEntradas || parsed?.metadados?.totalEntradas || 0);
    const totalRounds = Number(parsed?.observabilidade?.session?.counters?.totalRodadasObservadas || 0);
    const totalRecommendations = Number((parsed?.observabilidade?.recommendations || []).length || 0);
    const timestampLabel = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return {
      ok: true,
      hasData: totalEntradas > 0 || totalRounds > 0 || totalRecommendations > 0,
      filenameBase: `will-session-report-${timestampLabel}`,
      reportJson,
      reportMarkdown
    };
  }

  function mapearEstado(stage) {
    switch (stage) {
      case 'WaitingForBets':
        return 'apostando';
      case 'ClosingBets':
        return 'fechado';
      case 'AcceptingBets':
      case 'ButtonPressCheck':
      case 'FirstDie':
      case 'SecondDie':
      case 'ThirdDie':
      case 'FourthDie':
        return 'jogando';
      case 'Confirmation':
        return 'resultado';
      default:
        return stage ? String(stage) : 'aguardando';
    }
  }

  function normalizarTimer(nextStageIn) {
    if (typeof nextStageIn !== 'number' || Number.isNaN(nextStageIn)) return null;
    if (nextStageIn > 100) {
      return Math.max(0, Math.round(nextStageIn / 1000));
    }
    return Math.max(0, Math.round(nextStageIn));
  }

  function atualizarStatusWS() {
    CONFIG.canaisWSAtivos = Array.from(parserState.channelsAtivos);
    CONFIG.wsDadosRecebidos = wsDadosRecebidos === true;

    if (parserState.totalMessages % 50 === 0 && parserState.totalMessages > 0) {
      console.log(`[WS-HEALTH] Msgs: ${parserState.totalMessages} | Canais: ${CONFIG.canaisWSAtivos.join(', ')}`);
    }

    if (typeof ObservabilityEngine !== 'undefined' && ObservabilityEngine.atualizarTempoReal) {
      ObservabilityEngine.atualizarTempoReal({
        channels: CONFIG.canaisWSAtivos,
        totalMessages: parserState.totalMessages,
        wsDadosRecebidos,
        estadoRodada: CONFIG.estadoRodadaAtual || null
      });
    }

    if (!overlayInicializado || typeof Overlay === 'undefined') return;
    Overlay.atualizarStatusWS({
      totalConnections: parserState.totalConnections,
      activeConnections: parserState.activeConnections,
      totalMessages: parserState.totalMessages,
      gameMessages: parserState.gameMessages,
      channels: Array.from(parserState.channelsAtivos)
    });
  }

  function marcarCanalAtivo(channel, socketUrl) {
    if (!channel || channel === 'other') return;

    const sizeAntes = parserState.channelsAtivos.size;
    parserState.channelsAtivos.add(channel);
    if (parserState.channelsAtivos.size === sizeAntes) return;

    if (channel === 'evo-game') {
      iframeDetectado = true;
      modoPassivo = false;
      CONFIG.modoPassivo = false;
      if (overlayInicializado && typeof Overlay !== 'undefined') {
        Overlay.atualizarStatusIframe(true);
      }
    }

    console.log(`[BetBoom Auto] [ws] canal: ${channel}`, socketUrl || '');
    if (overlayInicializado && typeof Overlay !== 'undefined' && Overlay.addLog) {
      Overlay.addLog(`Canal WS ativo: ${channel}`, 'info');
    }

    atualizarStatusWS();
  }

  // Walker recursivo de balance — técnica adotada da extensão Will Dados Pro.
  // Percorre payload WS em qualquer profundidade procurando chaves cujo PATH
  // case /balance|wallet|saldo|cash/. Retorna primeiro número válido encontrado.
  // Profundidade limitada (8) e nodes limitados (1500) pra não estourar em
  // payloads grandes.
  function extrairBalanceRecursivo(payload) {
    if (!payload || typeof payload !== 'object') return null;
    const BALANCE_PATH_RE = /balance|wallet|saldo|cash/i;
    let found = null;
    let visited = 0;
    const MAX_VISITED = 1500;
    const MAX_DEPTH = 8;

    function walk(value, path, depth) {
      if (found != null || visited > MAX_VISITED || depth > MAX_DEPTH) return;
      visited += 1;
      if (value == null) return;
      if (typeof value === 'string' || typeof value === 'number') {
        if (BALANCE_PATH_RE.test(path)) {
          const n = Number(String(value).replace(/[^\d.-]/g, ''));
          if (Number.isFinite(n) && n >= 0) found = n;
        }
        return;
      }
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length && found == null; i++) {
          walk(value[i], `${path}[${i}]`, depth + 1);
        }
        return;
      }
      if (typeof value === 'object') {
        for (const k of Object.keys(value)) {
          if (found != null) break;
          walk(value[k], path ? `${path}.${k}` : k, depth + 1);
        }
      }
    }

    walk(payload, '', 0);
    return found;
  }

  function aplicarSaldoOficial(valor, source) {
    const saldo = Number(valor);
    if (!Number.isFinite(saldo) || saldo < 0) return;

    const mudouValor = parserState.lastSaldoReal !== saldo;
    const mudouFonte = parserState.lastSaldoSource !== source;

    parserState.lastSaldoReal = saldo;
    parserState.lastSaldoSource = source;
    CONFIG.saldoReal = saldo;
    CONFIG.fonteDoSaldo = source;
    wsDadosRecebidos = true;
    CONFIG.wsDadosRecebidos = true;
    if (source === 'evo-game' || iframeDetectado) {
      modoPassivo = false;
      CONFIG.modoPassivo = false;
    }

    if (overlayInicializado && typeof Overlay !== 'undefined') {
      Overlay.atualizarSaldoReal(saldo);
      Overlay.atualizarStatusIframe(Boolean(iframeDetectado));
    }

    if (mudouValor || mudouFonte) {
      console.log(`[BetBoom Auto] [saldo] ${source}: ${saldo.toFixed(2)}`);
      if (overlayInicializado && typeof Overlay !== 'undefined' && Overlay.addLog) {
        Overlay.addLog(`Saldo real (${source}): R$ ${saldo.toFixed(2)}`, 'success');
      }
    }

    if (typeof ObservabilityEngine !== 'undefined' && ObservabilityEngine.atualizarSaldo) {
      ObservabilityEngine.atualizarSaldo(saldo, { source });
    }
  }

  function atualizarEstadoRodada(game) {
    if (!game) return;

    parserState.currentGameId = game.id || parserState.currentGameId;
    parserState.currentStage = game.stage || parserState.currentStage;
    CONFIG.estadoRodadaAtual = mapearEstado(game.stage);
    CONFIG.roundIdAtual = game.id || parserState.currentGameId || null;
    CONFIG.wsDadosRecebidos = true;
    CONFIG.canaisWSAtivos = Array.from(parserState.channelsAtivos);

    if (game.stage === 'Confirmation' && game.id) {
      parserState.pendingResolvedGameId = game.id;
    }

    const estadoMapeado = mapearEstado(game.stage);
    const timer = normalizarTimer(game.nextStageIn);
    const stageKey = `${game.id || 'sem-game'}:${game.stage || 'sem-stage'}`;

    wsDadosRecebidos = true;
    modoPassivo = false;
    CONFIG.modoPassivo = false;

    if (parserState.lastStageKey !== stageKey) {
      parserState.lastStageKey = stageKey;
      console.log(`[BetBoom Auto] [parser] estado: ${estadoMapeado} (${game.stage || 'desconhecido'})`);
      if (overlayInicializado && typeof Overlay !== 'undefined' && Overlay.addLog) {
        Overlay.addLog(`Estado da rodada: ${estadoMapeado}`, 'info');
      }
    }

    if (overlayInicializado && typeof Overlay !== 'undefined') {
      Overlay.atualizarEstadoRodada({
        estado: estadoMapeado,
        raw: game.stage || null,
        timer
      });
      Overlay.atualizarStatusIframe(true);
    }

    // Wire-up RoundLifecycle: refletir transicoes de fase a partir do parser.
    // Defensivo: se RoundLifecycle nao estiver disponivel, fluxo legado continua.
    try {
      if (typeof RoundLifecycle !== 'undefined') {
        const roundId = CONFIG.roundIdAtual || parserState.currentGameId || null;
        if (roundId && estadoMapeado) {
          // SÓ chama start() em APOSTANDO (início real de rodada).
          // Estados pós-encerramento (FourthDie/Confirmation/AcceptingBets após end)
          // não devem reabrir rodada — gerava spam "start_em_rodada_fechada".
          const cur = RoundLifecycle.getCurrentRound?.();
          const precisaIniciar = (!cur || cur.roundId !== roundId)
            && estadoMapeado === 'apostando';
          if (precisaIniciar) {
            RoundLifecycle.start(roundId, { raw: game.stage || null, timer, autoStart: true });
          }
          // Só transita se a rodada existe e está aberta (não chama em fechada)
          if (estadoMapeado !== 'apostando' && cur && cur.roundId === roundId) {
            RoundLifecycle.transition(roundId, estadoMapeado, { raw: game.stage || null, timer });
          }
        }
      }
    } catch (lifecycleErr) {
      // Nunca quebrar o fluxo legado por erro no Lifecycle
      Logger.warn('RoundLifecycle (atualizarEstadoRodada) falhou:', lifecycleErr?.message || lifecycleErr);
    }

    if (typeof ObservabilityEngine !== 'undefined' && ObservabilityEngine.atualizarTempoReal) {
      ObservabilityEngine.atualizarTempoReal({
        channels: Array.from(parserState.channelsAtivos),
        totalMessages: parserState.totalMessages,
        wsDadosRecebidos,
        estadoRodada: CONFIG.estadoRodadaAtual || null
      });
    }
  }

  function winnerParaCor(winner) {
    if (winner === 'Player') return 'azul';
    if (winner === 'Banker') return 'vermelho';
    if (winner === 'Tie') return 'empate';
    return null;
  }

  function processarResultadoConfirmado(history) {
    if (!Array.isArray(history) || history.length === 0) return;

    const ultimo = history[history.length - 1];
    if (!ultimo || !ALLOWED_RESULTS.has(ultimo.winner)) return;

    const signature = `${history.length}:${ultimo.winner}:${ultimo.playerScore}:${ultimo.bankerScore}`;
    if (parserState.lastRoadSignature === signature) return;
    parserState.lastRoadSignature = signature;

    wsDadosRecebidos = true;
    modoPassivo = false;
    CONFIG.modoPassivo = false;

    // Sincronizar apenas itens NOVOS — não reenvia o que já foi processado.
    // Isso evita que item[N-1] do road anterior chegue sem gameId no próximo road
    // e gere uma entrada duplicada com signature "auto:" diferente da "gid:" já armazenada.
    let adicionadosBulk = 0;
    if (typeof Collector !== 'undefined' && Collector.sincronizarRoad) {
      const lastSynced = parserState.lastSyncedRoadLength || 0;
      const roadNormalizado = history.map((item, i) => ({
        cor: winnerParaCor(item.winner),
        vencedor: item.winner,
        playerScore: Number(item.playerScore),
        bankerScore: Number(item.bankerScore),
        gameId: (i === history.length - 1)
          ? (parserState.pendingResolvedGameId || parserState.currentGameId || null)
          : null,
        confirmedBy: 'bacbo.road',
        timestamp: i * 1000
      }));

      const novosItens = roadNormalizado.slice(lastSynced);
      if (novosItens.length > 0) {
        const ret = Collector.sincronizarRoad(novosItens);
        adicionadosBulk = typeof ret === 'number' ? ret : novosItens.length;
        parserState.lastSyncedRoadLength = history.length;
      }
    }

    const resultado = {
      cor: winnerParaCor(ultimo.winner),
      vencedor: ultimo.winner,
      playerScore: Number(ultimo.playerScore),
      bankerScore: Number(ultimo.bankerScore),
      gameId: parserState.pendingResolvedGameId || parserState.currentGameId || null,
      confirmedBy: 'bacbo.road',
      signature,
      timestamp: Date.now()
    };

    // Garantia defensiva (BUG-FIX R1-IMPL-B): se sincronizarRoad não adicionou nada
    // (dedup interno bloqueou ou bulk caiu fora) MAS a signature do road parser
    // mudou — este é um novo round confirmado. Forçamos o caminho single-confirm,
    // que tem seu próprio dedup por gameId/signature em Collector (não duplica) e
    // dispara o callback onNovoResultado, garantindo que o pipeline decisor rode
    // a cada novo round.
    if (adicionadosBulk === 0 && typeof Collector !== 'undefined' && Collector.adicionarResultadoConfirmado) {
      console.log('[COLLECTOR-WIRE] fallback single-confirm: bulk não adicionou itens, forçando adicionarResultadoConfirmado');
      Collector.adicionarResultadoConfirmado(resultado);
    }

    parserState.lastResultado = resultado;
    parserState.pendingResolvedGameId = null;
    CONFIG.ultimoResultadoConfirmado = resultado;

    console.log(`[BetBoom Auto] [resultado] confirmado: ${resultado.vencedor} ${resultado.playerScore}x${resultado.bankerScore} | road total=${history.length}`);

    // Wire-up HistoryStore: cada confirmacao gera 1 addRound, independente
    // do estado interno do Collector (assinaturasConfirmadas, lastSyncedRoadLength etc).
    // Preserva API existente — apenas conecta o que estava desconectado.
    try {
      if (typeof HistoryStore !== 'undefined' && HistoryStore.addRound) {
        const _hsRoundId = resultado.gameId || resultado.roundId || null;
        const _hsVencedor = resultado.vencedor || null;
        const _hsCorMap = { 'azul': 'blue', 'vermelho': 'red', 'empate': 'green' };
        const _hsColor = _hsCorMap[resultado.cor] || null;
        const _hsSignature = (typeof HistoryStore !== 'undefined' && HistoryStore.generateSignature)
          ? HistoryStore.generateSignature({
              gameId: _hsRoundId,
              vencedor: _hsVencedor,
              playerScore: resultado.playerScore,
              bankerScore: resultado.bankerScore,
              occurrence: 0
            })
          : (_hsRoundId
              ? `gid:${_hsRoundId}:${_hsVencedor}`
              : (resultado.signature || `auto:${_hsVencedor}:${resultado.playerScore}:${resultado.bankerScore}:0`));
        const _hsRes = HistoryStore.addRound({
          roundId:     _hsRoundId,
          result:      (_hsVencedor || '').toLowerCase() || null,
          color:       _hsColor,
          timestamp:   Number(resultado.timestamp) || Date.now(),
          source:      'websocket',
          confidence:  1.0,
          signature:   _hsSignature,
          playerScore: resultado.playerScore,
          bankerScore: resultado.bankerScore,
          raw:         resultado
        });
        if (_hsRes && _hsRes.added) {
          console.log(`[HistoryStore-WIRE] addRound novo round confirmado: ${_hsRoundId || _hsSignature}`);
        }
      }
    } catch (hsErr) {
      Logger.warn('HistoryStore.addRound (wire-up) falhou:', hsErr?.message || hsErr);
    }

    if (overlayInicializado && typeof Overlay !== 'undefined') {
      Overlay.atualizarUltimoResultado(resultado);
      Overlay.atualizarUI();
      if (Overlay.addLog) {
        Overlay.addLog(`Rodada ${Collector.getRodadaAtual()}: ${resultado.vencedor} ${resultado.playerScore}x${resultado.bankerScore}`, 'success');
      }
    }

    // Wire-up RoundLifecycle: encerrar a rodada confirmada.
    // Fonte autoritativa para padraoId/confianca = DecisionEngine.getEstatisticas
    // (campos adicionados em state.ultimaDecisao). Mantemos fallback para
    // parserState.lastDecisionPadraoId/Confianca (caso o overlay tenha hookado).
    try {
      if (typeof RoundLifecycle !== 'undefined') {
        const roundIdParaEncerrar = resultado.gameId || resultado.roundId || null;
        if (roundIdParaEncerrar) {
          let padraoId = parserState.lastDecisionPadraoId || null;
          let confianca = parserState.lastDecisionConfianca != null
            ? parserState.lastDecisionConfianca
            : null;
          if (typeof DecisionEngine !== 'undefined' && DecisionEngine.getEstatisticas) {
            try {
              const ultima = DecisionEngine.getEstatisticas()?.ultimaDecisao || null;
              if (ultima) {
                if (!padraoId) {
                  padraoId = ultima.padraoId || ultima.strategyId || ultima.nome || null;
                }
                if (confianca == null && ultima.confianca != null) {
                  confianca = ultima.confianca;
                }
              }
            } catch (_) { /* noop */ }
          }
          RoundLifecycle.end(roundIdParaEncerrar, {
            outcome: (resultado.vencedor || '').toString().toLowerCase() || 'unknown',
            cor: resultado.cor,
            padraoId,
            confiancaNominal: confianca,
            playerScore: resultado.playerScore,
            bankerScore: resultado.bankerScore
          });
        }
      }
    } catch (lifecycleErr) {
      Logger.warn('RoundLifecycle.end falhou:', lifecycleErr?.message || lifecycleErr);
    }
  }

  function processarPayloadJogo(payload) {
    if (!payload || typeof payload !== 'object') return;

    // R99-FECHAMENTO: balance NÃO é mais lido aqui. O walker recursivo em
    // processarEnvelopeWS já varre o payload inteiro antes deste handler.
    // Fonte única: CONFIG.saldoReal = walker output.
    if (payload.type === 'balanceUpdated') {
      return; // walker já aplicou; não duplicar.
    }

    if (payload.type === 'bacbo.playerState') {
      const game = payload?.args?.game;
      if (game) {
        atualizarEstadoRodada(game);

        // --- EXTRAÇÃO DOS DADOS (PULMÃO/VISÃO) ---
        if (game.dice) {
          const p1 = game.dice.player?.[0] || 0;
          const p2 = game.dice.player?.[1] || 0;
          const b1 = game.dice.banker?.[0] || 0;
          const b2 = game.dice.banker?.[1] || 0;

          if (p1 || p2 || b1 || b2) {
            const pSum = p1 + p2;
            const bSum = b1 + b2;
            const winner = pSum > bSum ? 'PLAYER' : (bSum > pSum ? 'BANKER' : 'EMPATE');

            console.log(`%c[DADOS] P(${p1}+${p2}=${pSum}) vs B(${b1}+${b2}=${bSum}) | Vencedor: ${winner}`, 'color:cyan;font-weight:bold');
            if (overlayInicializado && typeof Overlay !== 'undefined' && Overlay.addLog) {
              Overlay.addLog(`Resultado: ${winner} (${pSum}x${bSum})`, 'success');
            }
          }
        }
      }
      return;
    }

    if (payload.type === 'bacbo.road') {
      processarResultadoConfirmado(payload?.args?.history);
    }
  }

  function processarPayloadPlataforma(payload) {
    if (!payload || typeof payload !== 'object') return;

    // R99-FECHAMENTO: balance da plataforma NÃO é mais lido aqui.
    // O walker recursivo (processarEnvelopeWS:894) já capturou. Fonte única.
    // Mantemos a função vazia para preservar pontos de extensão futuros.
  }

  function processarEnvelopeWS(envelope) {
    if (!envelope || envelope.kind !== 'bb_ws_raw') return;

    wsCapturando = true;

    if (envelope.direction === 'open') {
      parserState.totalConnections += 1;
      parserState.activeConnections += 1;
      marcarCanalAtivo(envelope.channel, envelope.socketUrl);
      atualizarStatusWS();
      return;
    }

    if (envelope.direction === 'close') {
      parserState.activeConnections = Math.max(0, parserState.activeConnections - 1);
      atualizarStatusWS();
      return;
    }

    if (envelope.direction !== 'received') return;

    parserState.totalMessages += 1;
    if (envelope.channel === 'evo-game') {
      parserState.gameMessages += 1;
    }

    marcarCanalAtivo(envelope.channel, envelope.socketUrl);
    atualizarStatusWS();

    if (!envelope.text) return;

    const payload = safeJsonParse(envelope.text);
    if (!payload) return;

    // R99-FECHAMENTO: walker recursivo de balance é a FONTE ÚNICA de saldo.
    // Qualquer payload WS (qualquer canal, qualquer profundidade) que tenha
    // chave casando /balance|wallet|saldo|cash/ atualiza CONFIG.saldoReal
    // imediatamente. Source = canal de origem (evo-game | betboom-platform).
    // Os handlers específicos NÃO leem mais balance — só esta linha aplica.
    try {
      const balance = extrairBalanceRecursivo(payload);
      if (balance != null && Number.isFinite(balance)) {
        aplicarSaldoOficial(balance, envelope.channel || 'walker');
      }
    } catch (_) {}

    if (envelope.channel === 'evo-game') {
      processarPayloadJogo(payload);
      return;
    }

    if (envelope.channel === 'betboom-platform') {
      processarPayloadPlataforma(payload);
    }
  }

  function registrarEntradaManualOperador(payload) {
    if (!IS_TOP_FRAME || !payload?.cor || typeof DecisionEngine === 'undefined') return;
    if (CONFIG.estadoRodadaAtual !== 'apostando') return;

    const state = DecisionEngine.getState?.() || {};
    if (!state.isAtivo || state.isPausado) return;

    const roundId = CONFIG.roundIdAtual || payload.roundId || null;
    if (!roundId) return;
    if (DecisionEngine.hasEntradaExecutadaParaRound?.(roundId)) return;

    const ultimaDecisao = DecisionEngine.getEstatisticas?.()?.ultimaDecisao || null;
    const entry = DecisionEngine.registrarEntradaManual({
      roundId,
      rodada: Collector.getRodadaAtual() + 1,
      estrategia: ultimaDecisao?.nome || 'Entrada manual do operador',
      strategyId: ultimaDecisao?.strategyId || null,
      origem: ultimaDecisao?.source || 'user',
      sequenciaReconhecida: ultimaDecisao?.recognizedSequence || null,
      entradaSugerida: ultimaDecisao?.cor || payload.cor,
      entradaExecutada: payload.cor,
      gale: Number.isFinite(Number(ultimaDecisao?.maxGalesPermitido)) ? Number(ultimaDecisao.maxGalesPermitido) : Number(CONFIG.maxGales || 0),
      protecaoEmpate: Boolean(ultimaDecisao?.usarProtecaoEmpate ?? CONFIG.protegerEmpate),
      valorProtecao: Boolean(ultimaDecisao?.usarProtecaoEmpate ?? CONFIG.protegerEmpate) ? Number(CONFIG.valorProtecaoEmpate || 0) : 0,
      stake: Number.isFinite(Number(payload.stake)) ? Number(payload.stake) : Number(CONFIG.stakeInicial || 0),
      timestampEntrada: payload.timestampEntrada || Date.now(),
      statusExecucao: 'manual-registrada',
      targetVisualTexto: payload.targetText || null,
      targetSelector: payload.targetSelector || null
    });

    if (!entry) return;

    if (overlayInicializado && typeof Overlay !== 'undefined' && Overlay.registrarEntradaManual) {
      Overlay.registrarEntradaManual(entry);
      Overlay.atualizarUI();
    } else if (typeof BBTelemetry !== 'undefined' && BBTelemetry.push) {
      BBTelemetry.push({
        timestamp: entry.timestampEntrada || Date.now(),
        roundId: entry.roundId || null,
        history: Collector.getCoresRecentes(12),
        estrategiaDetectada: entry.estrategia || null,
        origem: entry.origem || null,
        sequenciaReconhecida: entry.sequenciaReconhecida || null,
        entradaSugerida: entry.entradaSugerida || null,
        entradaExecutada: entry.entradaExecutada || null,
        tipoEntrada: 'manual',
        gale: Number(entry.gale || 0),
        protecaoEmpate: entry.protecaoEmpate === true,
        estadoRodada: CONFIG.estadoRodadaAtual || null,
        saldo: Number.isFinite(Number(CONFIG.saldoReal)) ? Number(CONFIG.saldoReal) : null,
        stake: Number(entry.stake || 0),
        alvoAposta: BBStrategyUtils.getEntryLabel(entry.entradaExecutada || ''),
        statusExecucao: 'manual-registrada'
      });
    }

    if (typeof ObservabilityEngine !== 'undefined' && ObservabilityEngine.registrarEntrada) {
      ObservabilityEngine.registrarEntrada(entry, {
        history: Collector.getCoresRecentes(12),
        rodadaNumero: Collector.getRodadaAtual() + 1
      });
    }
  }

  function tratarCliqueOperador(event) {
    if (!event?.isTrusted) return;
    const target = event.target;
    if (!target || target.closest?.('#bb-auto-overlay')) return;

    const cor = inferirCorBotao(target);
    if (!cor) return;

    const payload = {
      kind: 'bb_operator_entry',
      cor,
      stake: lerStakeAtualOperador(),
      timestampEntrada: Date.now(),
      targetText: String(target.textContent || '').trim().slice(0, 80),
      targetSelector: target?.tagName ? target.tagName.toLowerCase() : null
    };

    if (IS_TOP_FRAME) {
      registrarEntradaManualOperador(payload);
      return;
    }

    if (runtimeRelayInvalidado) return;

    safeRuntimeSendMessage({
      type: 'BB_RELAY_OPERATOR_EVENT',
      event: payload
    }, 'relay clique manual do subframe');
  }

  // Seletores candidatos para cada alvo de aposta.
  // Ordem: mais específico → mais genérico. Seletores NOVOS foram ADICIONADOS
  // (legacy preservado) para suportar variações observadas no DOM atual da Evolution:
  // data-role/data-element/data-bet-type, aria-label PT/EN, classes parciais.
  const CLICK_CANDIDATES = {
    player: [
      // PRIMEIRO: seletor REAL da Evolution (descoberto em outra extensão que funciona)
      '[data-bet="player"]',
      // Legacy (mantidos por compatibilidade)
      '[data-betia-id="bet-player"]',
      '[data-automation-id="betting-grid-item-player"]',
      '[data-role="player-bet-spot"]',
      '[class*="betspot--player"]',
      '[class*="wc-bet-spot--player"]',
      // Novos: data-* variantes
      '[data-role="bet-spot-player"]',
      '[data-role*="player"][data-role*="spot"]',
      '[data-element="player"]',
      '[data-bet-type="player"]',
      // Aria-label (PT/EN)
      '[aria-label*="Player" i]',
      '[aria-label*="Jogador" i]',
      '[aria-label*="Azul" i]',
      // Classes parciais (web components / CSS modules)
      '[class*="BetSpot"][class*="player" i]',
      '[class*="player"][class*="bet"]',
      '[class*="spot"][class*="player" i]',
      'button[class*="Player"]',
      '[role="button"][aria-label*="Player" i]'
    ],
    banker: [
      // PRIMEIRO: seletor REAL da Evolution
      '[data-bet="banker"]',
      '[data-betia-id="bet-banker"]',
      '[data-automation-id="betting-grid-item-banker"]',
      '[data-role="banker-bet-spot"]',
      '[class*="betspot--banker"]',
      '[class*="wc-bet-spot--banker"]',
      '[data-role="bet-spot-banker"]',
      '[data-role*="banker"][data-role*="spot"]',
      '[data-element="banker"]',
      '[data-bet-type="banker"]',
      '[aria-label*="Banker" i]',
      '[aria-label*="Banca" i]',
      '[aria-label*="Vermelho" i]',
      '[class*="BetSpot"][class*="banker" i]',
      '[class*="banker"][class*="bet"]',
      '[class*="spot"][class*="banker" i]',
      'button[class*="Banker"]',
      '[role="button"][aria-label*="Banker" i]'
    ],
    tie: [
      // PRIMEIRO: seletor REAL da Evolution
      '[data-bet="tie"]',
      '[data-betia-id="bet-tie"]',
      '[data-automation-id="betting-grid-item-tie"]',
      '[data-role="tie-bet-spot"]',
      '[class*="betspot--tie"]',
      '[class*="wc-bet-spot--tie"]',
      '[data-role="bet-spot-tie"]',
      '[data-role*="tie"][data-role*="spot"]',
      '[data-element="tie"]',
      '[data-bet-type="tie"]',
      '[aria-label*="Tie" i]',
      '[aria-label*="Empate" i]',
      '[class*="BetSpot"][class*="tie" i]',
      '[class*="tie"][class*="bet"]',
      '[class*="spot"][class*="tie" i]',
      'button[class*="Tie"]',
      '[role="button"][aria-label*="Tie" i]'
    ],
    chip: [
      '[data-betia-id^="chip-"]',
      '[data-automation-id^="chip-"]',
      '[class*="chip"]:not([class*="container"])',
      '[data-role*="chip"]',
      'button[class*="chip"]',
      'div[class*="chip"]',
      '[data-testid*="chip"]',
      '[aria-label*="chip"]',
      '.chip',
      '.Chip',
      '[class*="Chip"]',
      '[class*="betting-chip"]',
      '[class*="wc-chip"]',
      'button[data-value]',
      'div[data-chip-value]'
    ],
    confirm: [
      // Legacy
      '[data-betia-id="bet-confirm"]',
      '[data-automation-id="bet-button-confirm"]',
      '[class*="button--confirm"]',
      '[class*="wc-confirm-button"]',
      '[data-role="confirm-button"]',
      'button.confirm-bet-button',
      '.confirm-button button',
      // Novos
      '[data-role*="confirm"]',
      '[aria-label*="Confirm" i]',
      '[aria-label*="Confirmar" i]',
      '[class*="confirm" i][class*="button" i]',
      'button[class*="confirm" i]'
    ]
  };

  // Heurística para escolher o melhor candidato entre múltiplos matches do mesmo seletor.
  // - Prefere elementos com área visível razoável (>= 1500px², típico de spot de aposta)
  // - Prefere elementos clicáveis (button, role=button, ou onclick/tabindex)
  // - Desconsidera elementos zerados ou ocultos
  function pickBestCandidate(nodeList) {
    let melhor = null;
    let melhorScore = -1;
    for (const el of nodeList) {
      try {
        const rect = el.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) continue;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity || '1') < 0.05) continue;
        const area = rect.width * rect.height;
        const isClickable = (
          el.tagName === 'BUTTON' ||
          el.getAttribute('role') === 'button' ||
          el.hasAttribute('onclick') ||
          el.tabIndex >= 0
        );
        const score = area + (isClickable ? 5000 : 0);
        if (score > melhorScore) {
          melhorScore = score;
          melhor = el;
        }
      } catch (_) { }
    }
    return melhor;
  }

  // Coleta documento atual + iframes filhos same-origin RECURSIVAMENTE.
  // Evolution às vezes aninha o canvas/spots em iframe interno (billing-boom
  // → evo-games → app). Recursão limitada (depth 4) evita loop infinito.
  function coletarDocsRecursivo(rootDoc = document, depth = 0, maxDepth = 4) {
    const docs = [rootDoc];
    if (depth >= maxDepth) return docs;
    try {
      rootDoc.querySelectorAll('iframe').forEach((iframe) => {
        try {
          if (iframe.contentDocument) {
            const sub = coletarDocsRecursivo(iframe.contentDocument, depth + 1, maxDepth);
            sub.forEach((d) => { if (!docs.includes(d)) docs.push(d); });
          }
        } catch (_) { /* cross-origin, ignora */ }
      });
    } catch (_) {}
    return docs;
  }

  function encontrarElemento(lista) {
    const docs = coletarDocsRecursivo();
    for (const sel of lista) {
      for (const doc of docs) {
        try {
          const nodes = doc.querySelectorAll(sel);
          if (!nodes.length) continue;
          const el = nodes.length === 1 ? nodes[0] : pickBestCandidate(nodes);
          if (el && el.getBoundingClientRect().width > 0) {
            // Log explícito para data-bet (seletor canônico Evolution)
            if (sel.startsWith('[data-bet=')) {
              console.log(`[BB-CLICK] ✅ Encontrado via ${sel} (${docs.length} docs varridos)`);
            }
            return { el, sel };
          }
        } catch (_) { }
      }
    }
    return null;
  }

  // ============================================================
  // FALLBACK DE COORDENADAS HEURÍSTICAS — CANVAS-AWARE
  // ============================================================
  // Quando ChipDetector e spot-finder DOM falham (ex: Evolution Mini é canvas),
  // ainda podemos clicar via CDP usando coordenadas calculadas a partir do
  // canvas principal do iframe. Layout padrão Evolution Bac Bo:
  //   - canvas grande no topo com a mesa
  //   - PLAYER esquerda, BANKER direita, TIE área central superior
  //   - Fichas em barra horizontal na parte inferior
  function calcularCoordsHeuristicas(alvo, chipValue) {
    // 1. Procura canvas no DOM normal + Shadow DOM (Evolution esconde em shadowRoot).
    function coletarCanvasesDeep(root = document) {
      const out = [];
      try {
        root.querySelectorAll('canvas').forEach((c) => out.push(c));
      } catch (_) {}
      try {
        const all = root.querySelectorAll ? root.querySelectorAll('*') : [];
        for (const el of all) {
          if (el.shadowRoot) {
            coletarCanvasesDeep(el.shadowRoot).forEach((c) => out.push(c));
          }
        }
      } catch (_) {}
      return out;
    }
    const canvases = coletarCanvasesDeep().filter((c) => {
      const r = c.getBoundingClientRect();
      return r.width > 200 && r.height > 200;
    });
    let ref = canvases.sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return (rb.width * rb.height) - (ra.width * ra.height);
    })[0];
    let refRect = ref ? ref.getBoundingClientRect() : null;
    const canvasFound = !!ref && refRect && refRect.width >= 200 && refRect.height >= 200;

    if (!canvasFound) {
      // 2. Sem canvas detectável: Evolution Mini renderiza mesa em letterbox 4:3
      // centralizada dentro do iframe landscape. Calcula o canvas hipotético
      // (proporção 4:3) com letterbox preto nas laterais.
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const targetRatio = 4 / 3; // canvas Bac Bo
      const iframeRatio = vw / vh;
      let canvasW, canvasH, marginLeft, marginTop;
      if (iframeRatio > targetRatio) {
        // iframe mais largo que canvas: letterbox lateral
        canvasH = vh;
        canvasW = vh * targetRatio;
        marginLeft = (vw - canvasW) / 2;
        marginTop = 0;
      } else {
        // iframe mais alto que canvas: letterbox cima/baixo
        canvasW = vw;
        canvasH = vw / targetRatio;
        marginLeft = 0;
        marginTop = (vh - canvasH) / 2;
      }
      refRect = { left: marginLeft, top: marginTop, width: canvasW, height: canvasH };
      console.log(`[BB-CLICK] 📐 letterbox 4:3 assumido — canvas hipotético: ${Math.round(canvasW)}x${Math.round(canvasH)} @ (${Math.round(marginLeft)},${Math.round(marginTop)}) dentro iframe ${vw}x${vh}`);
    }

    const x0 = refRect.left;
    const y0 = refRect.top;
    const w = refRect.width;
    const h = refRect.height;

    // Frações relativas — Bac Bo Evolution Mini layout REAL:
    // - Spots JOGADOR (Player) / EMPATE (Tie) / BANCA (Banker) ficam alinhados
    //   horizontalmente em ~78% da altura (logo abaixo dos copinhos e botões grandes)
    // - PLAYER fica à esquerda, EMPATE no centro, BANKER à direita
    const SPOT_FRACTIONS = {
      player: { x: 0.22, y: 0.78 },  // JOGADOR / azul (esquerda)
      tie:    { x: 0.50, y: 0.78 },  // EMPATE / verde (centro, mesma linha)
      banker: { x: 0.78, y: 0.78 }   // BANCA / vermelho (direita)
    };
    // Barra de fichas inferior — y=0.94, 9 fichas distribuídas de x=0.16 a x=0.78
    // Layout do print do user: R$5, 10, 25, 125, 500, 2.5K, 6K, 10K, 12K
    const CHIP_INDEX = { 5: 0, 10: 1, 25: 2, 125: 3, 500: 4, 2500: 5, 6000: 6, 10000: 7, 12000: 8 };

    const spotFrac = SPOT_FRACTIONS[alvo];
    if (!spotFrac) return null;

    const stake = Number(chipValue);
    const idx = Number.isFinite(stake) && CHIP_INDEX[stake] != null ? CHIP_INDEX[stake] : 0;
    const chipX = 0.16 + (idx * (0.62 / 8));
    const chipFrac = { x: chipX, y: 0.94 };

    return {
      chip: { x: x0 + chipFrac.x * w, y: y0 + chipFrac.y * h },
      spot: { x: x0 + spotFrac.x * w, y: y0 + spotFrac.y * h },
      refRect: { left: x0, top: y0, width: w, height: h, canvas: canvasFound, mode: canvasFound ? 'canvas' : 'letterbox-4x3' }
    };
  }

  // Envia coords (relativas ao iframe atual) ao top frame, que vai recursivamente
  // somar offsets e disparar BB_EXECUTE_HARDWARE_CLICK no background.
  function dispararCDPClick(coords, alvoLabel) {
    if (!coords) return;
    try {
      window.parent.postMessage({
        source: 'bb-click-result-hardware',
        alvo: alvoLabel,
        ok: true,
        x: coords.x,
        y: coords.y,
        ts: Date.now(),
        viaHeuristic: true
      }, '*');
      console.log(`[BB-CLICK] 📡 CDP relay enviado: ${alvoLabel} @ (${Math.round(coords.x)}, ${Math.round(coords.y)})`);
    } catch (e) {
      console.warn('[BB-CLICK] Falha relay CDP:', e);
    }
  }

  function encontrarElementoFallback(tipo = 'chip') {
    if (tipo !== 'chip') return null;

    const allButtons = Array.from(document.querySelectorAll('button, div[role="button"], [onclick]'));

    for (const el of allButtons) {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const text = (el.textContent || '').trim();

      if (rect.width === 0 || rect.height === 0) continue;
      if (style.display === 'none' || style.visibility === 'hidden') continue;

      const isLikelyChip = (
        (rect.width >= 30 && rect.width <= 150 && rect.height >= 30 && rect.height <= 150) ||
        /\d+/.test(text) ||
        el.className.includes('chip') ||
        el.className.includes('bet') ||
        el.id?.includes('chip') ||
        el.getAttribute('data-value')
      );

      if (isLikelyChip) {
        return { el, sel: `[fallback-chip: ${text || 'sem-label'}]` };
      }
    }

    return null;
  }

  function executarCliqueReal(el) {
    if (!el) return false;
    try {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;

      // Diagnóstico de visibilidade
      const style = window.getComputedStyle(el);
      const isVisible = rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      
      console.log(`[BB-CLICK] [target] ${el.tagName}#${el.id}.${el.className.split(' ').join('.')} | visible=${isVisible} | pos=${x.toFixed(0)},${y.toFixed(0)}`);

      if (!isVisible) {
        console.warn('[BB-CLICK] Alvo invisível, clique pode falhar.');
      }

      const pointerOpts = { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true };
      const mouseOpts = { bubbles: true, cancelable: true, clientX: x, clientY: y };

      const dispatch = (type) => {
        let ev;
        if (type.startsWith('pointer') && typeof window.PointerEvent !== 'undefined') {
          ev = new PointerEvent(type, pointerOpts);
        } else {
          ev = new MouseEvent(type, mouseOpts);
        }
        return el.dispatchEvent(ev);
      };

      // Sequência completa de interação
      const sequence = [
        'pointerover', 'mouseover', 
        'pointerdown', 'mousedown', 
        'pointerup', 'mouseup', 
        'click'
      ];

      sequence.forEach(dispatch);

      // Clique nativo como fallback final
      el.click();
      
      return { ok: true, x, y };
    } catch (e) {
      console.warn('[BB-CLICK] Erro ao executar clique:', e);
      return { ok: false };
    }
  }

  async function executarComandoClique(alvo, chipValue = null) {
    console.log(`[BB-CLICK] Iniciando comando: alvo=${alvo}, valor solicitado=${chipValue}`);

    // 1. Encontrar e clicar na ficha (usa ChipDetector robusto)
    let chip = null;
    // Mapeia PT-BR ↔ EN (decisor usa azul/vermelho/empate, DOM usa player/banker/tie)
    const PT_TO_EN = { 'azul': 'player', 'vermelho': 'banker', 'empate': 'tie' };
    const targets = ['player', 'banker', 'tie'];
    const alvoLower = String(alvo || '').toLowerCase();
    const alvoTraduzido = PT_TO_EN[alvoLower] || alvoLower;
    if (!targets.includes(alvoTraduzido)) {
      console.error(`[BB-CLICK] 🚨 Alvo inválido: "${alvo}" — abortando para não clicar no lado errado`);
      window.top.postMessage({ source: 'bb-click-result', alvo, ok: false, seletor: null, motivo: `alvo-invalido:${alvo}` }, '*');
      return;
    }
    const normalizedAlvo = alvoTraduzido;

    // R99.2: SHORTCUT — se já tem CAL salvo recebido do top, pula direto pra CDP.
    // Em mesa canvas-only, ChipDetector e DOM bridge sempre vão falhar; gastar
    // 1+ segundo tentando antes de cair pra CAL é só atraso. O top já mandou
    // os coords reais — usa imediatamente.
    const calShortcut = window.__bbFallbackCoords;
    if (calShortcut && calShortcut.chip && calShortcut.spot) {
      console.log(`[BB-CLICK] ⚡ SHORTCUT CAL: pulando ChipDetector/DOM (canvas-only assumido) — chip=(${Math.round(calShortcut.chip.x)},${Math.round(calShortcut.chip.y)}) spot=(${Math.round(calShortcut.spot.x)},${Math.round(calShortcut.spot.y)})`);
      dispararCDPClick(calShortcut.chip, `chip-${chipValue || '5'}`);
      setTimeout(() => dispararCDPClick(calShortcut.spot, normalizedAlvo), 400);
      if (calShortcut.confirmar && Number.isFinite(calShortcut.confirmar.x)) {
        setTimeout(() => dispararCDPClick(calShortcut.confirmar, 'confirmar'), 800);
      }
      window.__bbFallbackCoords = null;
      // Mesmo no shortcut, comunica resultado pro top loggar
      window.top.postMessage({
        source: 'bb-click-result',
        alvo: normalizedAlvo,
        ok: true,
        seletor: 'CAL-SHORTCUT',
        texto: 'via calibração inline',
        chipSel: 'CAL',
        chipValor: chipValue,
        ts: Date.now()
      }, '*');
      return;
    }

    if (chipValue && typeof ChipDetector !== 'undefined') {
      // Usar novo detector com retry
      chip = await ChipDetector.encontrarComRetry(chipValue, 4, 150);
      if (chip) {
        console.log(`[BB-CLICK] ✅ Ficha encontrada via ChipDetector: ${chip.sel}`);
      }
    }

    // Fallback para versão antiga se ChipDetector não está disponível
    if (!chip && chipValue) {
      const valStr = String(chipValue).replace(/[^\d]/g, '');
      const evoSpecificSelectors = [
        `[data-betia-id="chip-${valStr}"]`,
        `[data-automation-id="chip-${valStr}"]`,
        `[data-value="${valStr}"]`
      ];

      for (const sel of evoSpecificSelectors) {
        const el = document.querySelector(sel);
        if (el && el.getBoundingClientRect().width > 0) {
          chip = { el, sel };
          console.log(`[BB-CLICK] Ficha encontrada (fallback legacy): ${sel}`);
          break;
        }
      }
    }

    // Último fallback: visual
    if (!chip) {
      if (typeof ChipDetector !== 'undefined') {
        chip = ChipDetector.encontrarFallback();
      } else {
        chip = encontrarElementoFallback('chip');
      }
      if (chip) console.log(`[BB-CLICK] Usando fallback visual: ${chip.sel}`);
    }

    let chipSel = null;
    let chipValorEncontrado = null;
    if (chip) {
      chipValorEncontrado = chip.el.textContent?.trim() || chip.el.getAttribute('data-value') || '?';
      chipSel = chip.sel;
      executarCliqueReal(chip.el);
      console.log(`[BB-CLICK] ✅ Ficha clicada: ${chipValorEncontrado}`);
    } else {
      console.warn('[BB-CLICK] ❌ Nenhuma ficha encontrada para clicar! Diagnóstico:');
      if (typeof ChipDetector !== 'undefined') {
        ChipDetector.diagnosticar();
      }
    }

    // 2. Delay maior e clicar no spot (Evolution às vezes é lenta para registrar a ficha)
    setTimeout(() => {
      const candidatos = CLICK_CANDIDATES[normalizedAlvo] || CLICK_CANDIDATES.player;
      const found = encontrarElemento(candidatos);

      const resultado = {
        source: 'bb-click-result',
        alvo: normalizedAlvo,
        ok: false,
        seletor: null,
        texto: null,
        chipSel,
        chipValor: chipValorEncontrado,
        ts: Date.now()
      };

      if (found) {
        const clique = executarCliqueReal(found.el);
        resultado.ok = clique.ok;
        resultado.x = clique.x;
        resultado.y = clique.y;
        resultado.seletor = found.sel;
        resultado.texto = found.el.textContent?.trim()?.slice(0, 40) || null;

        // 3. Clique automático de confirmação (se disponível)
        if (resultado.ok) {
          setTimeout(() => {
            const confirmBtn = encontrarElemento(CLICK_CANDIDATES.confirm);
            if (confirmBtn) {
              const confirmClique = executarCliqueReal(confirmBtn.el);
              // Também enviamos coordenadas da confirmação para o hardware click
              window.top.postMessage({ ...resultado, source: 'bb-click-result-hardware', x: confirmClique.x, y: confirmClique.y, isConfirm: true }, '*');
              console.log(`[BB-CLICK] ✅ Confirmação clicada: ${confirmBtn.sel}`);
            } else {
              console.warn('[BB-CLICK] ⚠️ Botão de confirmação não encontrado após clique principal.');
            }
          }, 450); // Aumentado para 450ms
        }
      }

      // Responder para o frame pai
      window.top.postMessage(resultado, '*');
      console.log(`%c[BB-CLICK] ${resultado.ok ? '✅' : '❌'} ${normalizedAlvo} | seletor: ${resultado.seletor || 'NÃO ENCONTRADO'}`, 'color:cyan;font-weight:bold');

      // === FALLBACK HEURÍSTICO CDP — DESATIVADO POR DEFAULT ===
      // ATENÇÃO: o mapa CHIP_INDEX hardcoded assume layout de mesa específico.
      // Em mesas live-high do BetBoom, a primeira ficha (idx=0) pode ser R$5000
      // ao invés de R$5 — risco de apostar 1000x o valor desejado.
      // Para reativar, o operador precisa:
      //   1) Calibrar via BBCalibrator.tudo() (coordenadas reais da SUA mesa)
      //   2) Ou explicitamente setar CONFIG.permitirFallbackHeuristico = true
      // R99: PRIORIDADE de fallback quando DOM falhou:
      //   1) Coords calibradas recebidas do top (window.__bbFallbackCoords)
      //   2) Heurística (só se CONFIG.permitirFallbackHeuristico=true)
      //   3) Avisar e desistir
      if (!chip || !found) {
        const calFb = window.__bbFallbackCoords;
        const permitirHeur = (typeof CONFIG !== 'undefined' && CONFIG.permitirFallbackHeuristico === true);

        if (calFb && calFb.chip && calFb.spot) {
          console.log(`[BB-CLICK] 🎯 CALIBRADO (fallback do top): chip=(${Math.round(calFb.chip.x)},${Math.round(calFb.chip.y)}) spot=(${Math.round(calFb.spot.x)},${Math.round(calFb.spot.y)})`);
          if (!chip) dispararCDPClick(calFb.chip, `chip-${chipValue || '5'}`);
          if (!found) setTimeout(() => dispararCDPClick(calFb.spot, normalizedAlvo), 350);
          window.__bbFallbackCoords = null;
        } else if (permitirHeur) {
          const coords = calcularCoordsHeuristicas(normalizedAlvo, chipValue);
          if (coords) {
            console.log(`[BB-CLICK] 🎯 FALLBACK HEURÍSTICO: ${normalizedAlvo} stake=${chipValue}`);
            if (!chip) dispararCDPClick(coords.chip, `chip-${chipValue || '5'}`);
            if (!found) setTimeout(() => dispararCDPClick(coords.spot, normalizedAlvo), 350);
          } else {
            console.warn('[BB-CLICK] Heurística não disponível (sem canvas/viewport útil)');
          }
        } else {
          console.warn(`[BB-CLICK] 🛑 SEM CLIQUE: DOM falhou, sem cal salva, heurística desativada. Use 🎯 CAL no overlay.`);
        }
      }
    }, 100); // Delay inicial para garantir que o frame processou o sinal
  }

  /**
   * [R6-SECURITY] Valida se um postMessage 'bb-click-result-hardware' veio de fonte legítima.
   * Aceita se:
   *   (a) event.source é o contentWindow de um <iframe> filho direto deste documento, OU
   *   (b) event.origin termina em algum host da HARDWARE_CLICK_ORIGIN_ALLOWLIST.
   * Também aplica dedup por (x,y) dentro de HARDWARE_CLICK_DEDUP_WINDOW_MS para mitigar replay.
   * Retorna true se a mensagem é confiável; false caso contrário (com log de rejeição).
   */
  function isHardwareClickEventTrusted(event) {
    const origin = event?.origin || '';
    const source = event?.source || null;
    let sourceIsChildIframe = false;
    try {
      const iframes = Array.from(document.querySelectorAll('iframe'));
      sourceIsChildIframe = iframes.some((f) => f.contentWindow === source);
    } catch (_) {
      sourceIsChildIframe = false;
    }

    // R6.1: origin === 'null' (sandbox iframe sem allow-same-origin) é caso
    // legítimo no Evolution. Aceitamos quando source É iframe filho direto.
    let originAllowed = false;
    const isSandboxNull = (origin === 'null' || origin === '');
    if (typeof origin === 'string' && origin && !isSandboxNull) {
      try {
        const host = new URL(origin).hostname || '';
        originAllowed = HARDWARE_CLICK_ORIGIN_ALLOWLIST.some(
          (dom) => host === dom || host.endsWith('.' + dom)
        );
      } catch (_) {
        originAllowed = false;
      }
    }

    // Sandbox/null: só aceita se source é iframe filho legítimo
    if (isSandboxNull && sourceIsChildIframe) originAllowed = true;

    if (!sourceIsChildIframe && !originAllowed) {
      const sourceLabel = source === window ? 'self' : (source ? 'foreign-window' : 'null');
      console.warn(
        `[BB-SECURITY] ❌ postMessage 'bb-click-result-hardware' rejeitado | origin=${origin || '<empty>'} source=${sourceLabel}`
      );
      return false;
    }

    // Dedup: ignora msgs idênticas (mesmo x,y) chegando em <HARDWARE_CLICK_DEDUP_WINDOW_MS.
    const x = event?.data?.x;
    const y = event?.data?.y;
    if (typeof x === 'number' && typeof y === 'number') {
      const now = Date.now();
      if (
        __bbHardwareClickDedup.x === x &&
        __bbHardwareClickDedup.y === y &&
        (now - __bbHardwareClickDedup.ts) < HARDWARE_CLICK_DEDUP_WINDOW_MS
      ) {
        console.warn(
          `[BB-SECURITY] ❌ postMessage 'bb-click-result-hardware' rejeitado | origin=${origin || '<empty>'} source=dedup-replay`
        );
        return false;
      }
      __bbHardwareClickDedup.ts = now;
      __bbHardwareClickDedup.x = x;
      __bbHardwareClickDedup.y = y;
    }

    return true;
  }

  async function tratarMensagemWindow(event) {
    // Comando de clique vindo do frame pai → executar no iframe.
    // R99: aceita fallbackCoords (coords calibradas) que o top passa pra
    // o subframe usar caso DOM falhe.
    if (!IS_TOP_FRAME && event.data?.source === 'bb-click-cmd') {
      if (event.data.fallbackCoords) {
        window.__bbFallbackCoords = event.data.fallbackCoords;
      }
      await executarComandoClique(event.data.alvo || 'player', event.data.valor || null);
      return;
    }

    // Repasse recursivo do hardware click: subframes intermediários (billing-boom envolvendo
    // evo-games) somam o offset do iframe filho ANTES de repassar pro parent.
    // Cada frame na cadeia tem acesso ao DOM dos próprios filhos (mesmo cross-origin),
    // então essa acumulação consegue chegar até o top com coordenadas absolutas corretas.
    if (!IS_TOP_FRAME && event.data?.source === 'bb-click-result-hardware') {
      // [R6-SECURITY] Mesmo no relay subframe→parent, só repassamos se o emissor for legítimo.
      // Aqui o filtro é mais relaxado: como vamos repassar (não disparar CDP), basta que a
      // mensagem venha de um iframe filho desta janela OU de origem da allowlist.
      if (!isHardwareClickEventTrusted(event)) {
        return;
      }
      try {
        const iframes = Array.from(document.querySelectorAll('iframe'));
        const childFrame = iframes.find((f) => f.contentWindow === event.source);
        const adjusted = { ...event.data };
        if (childFrame && typeof adjusted.x === 'number' && typeof adjusted.y === 'number') {
          const r = childFrame.getBoundingClientRect();
          adjusted.x = adjusted.x + r.left;
          adjusted.y = adjusted.y + r.top;
        }
        window.parent.postMessage(adjusted, '*');
      } catch (_) {
        try { window.parent.postMessage(event.data, '*'); } catch (_) {}
      }
      return;
    }

    // Resultado de clique vindo do iframe → repassar para o overlay E disparar hardware click
    if (IS_TOP_FRAME && (event.data?.source === 'bb-click-result' || event.data?.source === 'bb-click-result-hardware')) {
      // [R6-SECURITY] No top frame, antes de QUALQUER processamento de 'bb-click-result-hardware'
      // (especialmente o disparo CDP em enviarCoordenadaSoberana), validar origem+source.
      // 'bb-click-result' (sem hardware) não dispara CDP, mas o bloco abaixo trata ambos
      // — aplicamos o guard somente quando a variante 'hardware' está presente.
      if (event.data?.source === 'bb-click-result-hardware' && !isHardwareClickEventTrusted(event)) {
        return;
      }
      const r = event.data;
      
      // 1. Log no Overlay
      if (r.source === 'bb-click-result') {
        const label = r.alvo === 'player' ? 'AZUL (Jogador)' : (r.alvo === 'banker' ? 'VERMELHO (Banca)' : 'EMPATE');
        const msg = r.ok
          ? `✅ Operando: ${label} | ${r.seletor}`
          : `❌ Falhou em ${label} — tentando CDP heurístico`;
        if (overlayInicializado && typeof Overlay !== 'undefined' && Overlay.addLog) {
          Overlay.addLog(msg, r.ok ? 'success' : 'warn');
        }
      } else if (r.source === 'bb-click-result-hardware' && r.viaHeuristic) {
        // CDP heurístico — informar o operador
        if (overlayInicializado && typeof Overlay !== 'undefined' && Overlay.addLog) {
          Overlay.addLog(`🎯 CDP heurístico → ${r.alvo}`, 'info');
        }
      }

      // 2. DISPARO DE HARDWARE SOBERANO (Chrome Debugger API)
      if (r.ok && typeof r.x === 'number' && typeof r.y === 'number') {
        // Lógica de Geometria Recursiva: Somar offsets de todos os pais até o topo
        enviarCoordenadaSoberana(r, event.source);
      }
      return;
    }

    // R99.2: detector canvas-only enviado pelo subframe ao carregar.
    // Top guarda o ÚLTIMO veredito (check mais tardio é mais confiável,
    // dá tempo do canvas renderizar) e expõe via CONFIG pra overlay ler.
    if (IS_TOP_FRAME && event.data?.source === 'bb-canvas-detection') {
      try {
        const det = event.data;
        if (typeof CONFIG !== 'undefined') {
          // Considera canvas-only só se TODOS os checks bateram (mais conservador)
          // Mas atualiza o último estado sempre.
          CONFIG._canvasDetection = CONFIG._canvasDetection || { checks: [] };
          CONFIG._canvasDetection.checks.push({
            t: det.ts, delay: det.delay,
            canvasOnly: det.canvasOnly,
            forced: det.forced === true,
            reason: det.reason,
            dom: det.domClicaveis, canvas: det.canvasCount
          });
          // R99.3: se veio FORCED (ChipDetector estourou falhas), trava em true direto.
          // Caso contrário, usa a regra original: 2 checks tardios (delay >= 8000) batendo.
          let veredito;
          if (det.forced === true && det.canvasOnly === true) {
            veredito = true;
            console.warn(`[CANVAS-DETECT@top] 🚨 FORCED canvas-only (reason=${det.reason || 'unknown'}).`);
          } else {
            const tardios = CONFIG._canvasDetection.checks.filter(c => c.delay >= 8000);
            veredito = tardios.length > 0 && tardios.every(c => c.canvasOnly === true);
          }
          // Sticky: uma vez canvas-only, não volta a false (evita banner piscando).
          if (CONFIG.canvasOnlyDetected === true) veredito = true;
          CONFIG.canvasOnlyDetected = veredito;
          // Verifica se calibração existe
          let temCal = false;
          try {
            const raw = localStorage.getItem('BB_INLINE_COORDS_v1');
            const cal = raw ? JSON.parse(raw) : null;
            temCal = !!(cal && cal.player && cal.banker && cal.tie && cal.chip5);
          } catch (_) {}
          CONFIG.calibracaoExiste = temCal;
          console.log(`[CANVAS-DETECT@top] check delay=${det.delay}ms canvas=${det.canvasCount} dom=${det.domClicaveis} → veredito=${veredito} temCal=${temCal}`);

          // Notifica overlay (se ele tem método)
          if (typeof Overlay !== 'undefined' && Overlay.atualizarStatusMesa) {
            try {
              Overlay.atualizarStatusMesa({
                canvasOnly: veredito,
                temCalibracao: temCal,
                ultimoCheckMs: det.delay
              });
            } catch (e) {
              console.warn('[CANVAS-DETECT@top] Overlay.atualizarStatusMesa falhou:', e?.message);
            }
          }
        }
      } catch (e) {
        console.warn('[CANVAS-DETECT@top] erro processando:', e?.message);
      }
      return;
    }

    /**
     * Envia a coordenada para o topo de forma recursiva.
     * Se estiver num iframe, manda o offset local + r.x/y para o pai.
     * O pai somará o próprio offset e mandará para o avô, até chegar no Top Frame.
     */
    function enviarCoordenadaSoberana(r, sourceWindow) {
      if (IS_TOP_FRAME) {
        // Já estamos no topo! Descobrir qual iframe enviou para pegar o offset
        const iframes = Array.from(document.querySelectorAll('iframe'));
        const sourceFrame = iframes.find(f => f.contentWindow === sourceWindow);
        
        if (sourceFrame) {
          const frameRect = sourceFrame.getBoundingClientRect();
          const globalX = frameRect.left + r.x;
          const globalY = frameRect.top + r.y;

          chrome.runtime.sendMessage({
            type: 'BB_EXECUTE_HARDWARE_CLICK',
            x: globalX,
            y: globalY
          }, (response) => {
            if (response?.ok) {
              console.log(`%c[BB-HARDWARE] ✅ Clique SOBERANO executado: ${globalX.toFixed(0)},${globalY.toFixed(0)}`, 'color:#00ff00; font-weight:bold;');
              if (overlayInicializado && typeof Overlay !== 'undefined' && Overlay.setHardwareStatus) {
                Overlay.setHardwareStatus(true);
              }
            } else {
              console.warn('[BB-HARDWARE] ❌ Falha no clique de hardware:', response?.error);
            }
          });
        }
      } else {
        // No subframe: passamos o resultado para cima (window.parent)
        // O pai vai receber isso no 'tratarMensagemWindow' e vai cair no CASE do IS_TOP_FRAME (ou repassar)
        window.parent.postMessage({
          ...r,
          source: 'bb-click-result-hardware'
        }, '*');
      }
    }

    const envelope = toWindowEnvelope(event);
    if (!envelope) return;

    if (IS_TOP_FRAME) {
      processarEnvelopeWS(envelope);
      return;
    }

    if (runtimeRelayInvalidado) return;

    safeRuntimeSendMessage({
      type: 'BB_RELAY_WS_EVENT',
      envelope
    }, 'relay evento WS do subframe');
  }

  function registrarListenersRuntime() {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg?.type === 'BB_TOP_FRAME_WS_EVENT' && IS_TOP_FRAME) {
        processarEnvelopeWS(msg.envelope);
        sendResponse?.({ ok: true });
        return false;
      }

      if (msg?.type === 'BB_TOP_FRAME_OPERATOR_EVENT' && IS_TOP_FRAME) {
        registrarEntradaManualOperador(msg.event);
        sendResponse?.({ ok: true });
        return false;
      }

      if (!IS_TOP_FRAME) {
        return false;
      }

      switch (msg?.type) {
        case 'GET_STATUS':
          sendResponse({
            decision: typeof DecisionEngine !== 'undefined' ? DecisionEngine.getEstatisticas() : null,
            collector: typeof Collector !== 'undefined' ? Collector.getEstatisticas() : null,
            strategyStatus: typeof PatternEngine !== 'undefined' && PatternEngine.getStrategyStatus
              ? PatternEngine.getStrategyStatus()
              : null,
            config: CONFIG,
            iframeDetectado,
            modoPassivo,
            wsCapturando,
            wsDadosRecebidos,
            saldoReal: CONFIG.saldoReal || null,
            fonteDoSaldo: CONFIG.fonteDoSaldo || 'nenhuma',
            channels: Array.from(parserState.channelsAtivos),
            observability: typeof ObservabilityEngine !== 'undefined' && ObservabilityEngine.getSnapshot
              ? ObservabilityEngine.getSnapshot()
              : null
          });
          return true;

        case 'UPDATE_CONFIG': {
          const configAtualizada = BBConfigUtils.mergePersistedConfig(msg.config || {});
          BBConfigUtils.applyPersistedConfig(CONFIG, configAtualizada);
          chrome.storage.local.set({ config: configAtualizada });
          if (overlayInicializado && typeof Overlay !== 'undefined' && Overlay.aplicarModoDebug) {
            Overlay.aplicarModoDebug();
          }
          if (overlayInicializado && typeof Overlay !== 'undefined' && Overlay.addLog) {
            Overlay.addLog('Configurações atualizadas', 'info');
          }
          sendResponse({ ok: true });
          return true;
        }

        case 'UPDATE_STRATEGIES':
          CONFIG.strategyLibrary = BBStrategyUtils.ensureStrategyLibrary(msg.strategies || []);
          CONFIG.strategyPreferences = {
            ...(CONFIG.strategyPreferences || {}),
            ...(msg.preferences || {})
          };

          if (typeof PatternEngine !== 'undefined' && PatternEngine.setStrategyLibrary) {
            PatternEngine.setStrategyLibrary(CONFIG.strategyLibrary);
          }

          if (overlayInicializado && typeof Overlay !== 'undefined' && Overlay.addLog) {
            Overlay.addLog(`Estratégias atualizadas: ${CONFIG.strategyLibrary.filter(s => s.active).length} ativa(s)`, 'info');
          }

          sendResponse({ ok: true });
          return true;

        case 'START':
          document.getElementById('bb-btn-start')?.click();
          sendResponse({ ok: true });
          return true;

        case 'PAUSE':
          document.getElementById('bb-btn-pause')?.click();
          sendResponse({ ok: true });
          return true;

        case 'STOP':
          document.getElementById('bb-btn-stop')?.click();
          sendResponse({ ok: true });
          return true;

        case 'TEST_DETECTION':
          const strategyStatus = typeof PatternEngine !== 'undefined' && PatternEngine.getStrategyStatus
            ? PatternEngine.getStrategyStatus()
            : null;
          sendResponse({
            historicoContainer: Boolean(typeof Collector !== 'undefined' && Collector.isContainerEncontrado && Collector.isContainerEncontrado()),
            btnVermelho: hasElementForSelector(CONFIG.selectors.btnVermelho),
            btnAzul: hasElementForSelector(CONFIG.selectors.btnAzul),
            btnEmpate: hasElementForSelector(CONFIG.selectors.btnEmpate),
            inputStake: hasElementForSelector(CONFIG.selectors.inputStake),
            timer: hasElementForSelector(CONFIG.selectors.timer),
            pronto: parserState.channelsAtivos.has('evo-game'),
            strategiesAtivas: strategyStatus?.ativas || 0,
            iframeDetectado,
            modoPassivo,
            wsCapturando,
            wsDadosRecebidos,
            saldoReal: CONFIG.saldoReal || null
          });
          return true;

        case 'SHOW_OVERLAY':
          Overlay.mostrar();
          sendResponse({ ok: true });
          return true;

        case 'HIDE_OVERLAY':
          Overlay.esconder();
          sendResponse({ ok: true });
          return true;

        case 'EXPORT_SESSION_REPORT':
          sendResponse(buildSessionReportResponse(msg.limit || 200));
          return true;

        default:
          return false;
      }
    });
  }

  function sincronizarOverlayInicial() {
    if (!overlayInicializado || typeof Overlay === 'undefined') return;

    Overlay.atualizarStatusIframe(iframeDetectado);
    atualizarStatusWS();

    if (parserState.lastSaldoReal !== null) {
      Overlay.atualizarSaldoReal(parserState.lastSaldoReal);
    }

    if (parserState.lastResultado) {
      Overlay.atualizarUltimoResultado(parserState.lastResultado);
    }

    if (parserState.currentStage) {
      Overlay.atualizarEstadoRodada({
        estado: mapearEstado(parserState.currentStage),
        raw: parserState.currentStage,
        timer: null
      });
    }
  }

  async function inicializarTopFrame() {
    Logger.info('Iniciando inicialização do Top Frame...');

    // 1. Aguardar DOM com limite de tempo
    try {
      await Promise.race([
        aguardarDOM(),
        new Promise(resolve => setTimeout(resolve, 3000)) // Timeout de 3s para o DOM
      ]);
    } catch (e) {
      Logger.warn('Aviso: aguardarDOM demorou demais ou falhou. Prosseguindo...');
    }

    // 2. Carregar Configurações e Observabilidade com resiliência
    const initProcess = async () => {
      try {
        await carregarConfig();
        if (typeof ObservabilityEngine !== 'undefined' && ObservabilityEngine.bootstrap) {
          await ObservabilityEngine.bootstrap();
          ObservabilityEngine.atualizarTempoReal({
            channels: Array.from(parserState.channelsAtivos),
            totalMessages: parserState.totalMessages,
            wsDadosRecebidos,
            estadoRodada: CONFIG.estadoRodadaAtual || null
          });
        }
      } catch (e) {
        Logger.error('Falha em dependências secundárias (config/obs):', e?.message || e);
      }
    };

    // Rodamos a carga de config em paralelo com um timeout, mas NÃO bloqueamos o Overlay
    Promise.race([
      initProcess(),
      new Promise(resolve => setTimeout(resolve, 4000)) // Timeout de 4s para configs
    ]).finally(() => {
      Logger.info('Processo de inicialização de dependências concluído ou expirado.');
      
      // 3. Inicializar Overlay (Prioridade Máxima)
      if (typeof Overlay !== 'undefined' && !overlayInicializado) {
        try {
          Overlay.inicializar();
          overlayInicializado = true;
          CONFIG.overlayReady = true;

          if (Overlay.aplicarModoDebug) Overlay.aplicarModoDebug();
          Overlay.addLog('🧬 J.A.R.V.I.S. Ativo — Monitorando mesa', 'success');

          if (Array.isArray(CONFIG.strategyLibrary) && CONFIG.strategyLibrary.length > 0) {
            const ativas = CONFIG.strategyLibrary.filter((s) => s.active !== false).length;
            Overlay.addLog(`Estratégias: ${ativas} ativa(s)`, 'info');
          }

          sincronizarOverlayInicial();

          // -----------------------------------------------------------------
          // Wire-up dos modulos novos (RoundLifecycle, PlanExecutor, ReplayEngine,
          // CalibrationLoop + 5 Adapters). Tudo defensivo: se algum modulo nao
          // tiver carregado, o fluxo legado continua intacto.
          // -----------------------------------------------------------------
          try {
            // Configurar RoundLifecycle com EventStore
            if (typeof RoundLifecycle !== 'undefined' && typeof EventStore !== 'undefined') {
              RoundLifecycle.configure({ eventStore: EventStore });
            }

            // Attach Lifecycle no PlanExecutor
            if (typeof PlanExecutor !== 'undefined' && typeof LifecycleGate !== 'undefined') {
              if (typeof RoundLifecycle !== 'undefined') {
                LifecycleGate.attach(RoundLifecycle);
              }
              PlanExecutor.attachLifecycle(LifecycleGate);
              if (typeof EventStore !== 'undefined') {
                PlanExecutor.attachEventStore(EventStore);
              }
            }

            // Attach no ReplayEngine
            if (typeof ReplayEngine !== 'undefined' && typeof EventStore !== 'undefined') {
              ReplayEngine.attachEventStore(EventStore);
              if (typeof LifecycleReplayProjector !== 'undefined') {
                LifecycleReplayProjector.attach(EventStore);
              }
            }

            // Attach no CalibrationLoop
            if (typeof CalibrationLoop !== 'undefined') {
              if (typeof EventStore !== 'undefined') {
                CalibrationLoop.attachEventStore(EventStore);
              }
              if (typeof RoundLifecycle !== 'undefined') {
                CalibrationLoop.attachLifecycle(RoundLifecycle);
              }
            }

            // Ligar adapters de calibracao
            if (typeof CalibrationLifecycleAdapter !== 'undefined'
                && typeof RoundLifecycle !== 'undefined'
                && typeof CalibrationLoop !== 'undefined') {
              CalibrationLifecycleAdapter.attach({
                lifecycle: RoundLifecycle,
                calibration: CalibrationLoop,
                planExecutor: typeof PlanExecutor !== 'undefined' ? PlanExecutor : null
              });
              CalibrationLifecycleAdapter.start();
            }
            if (typeof CalibrationPlanAdapter !== 'undefined'
                && typeof PlanExecutor !== 'undefined'
                && typeof CalibrationLoop !== 'undefined') {
              CalibrationPlanAdapter.attach({
                planExecutor: PlanExecutor,
                calibration: CalibrationLoop
              });
              CalibrationPlanAdapter.start();
            }
            if (typeof CalibrationReplayAdapter !== 'undefined'
                && typeof ReplayEngine !== 'undefined'
                && typeof CalibrationLoop !== 'undefined') {
              CalibrationReplayAdapter.attach({
                replayEngine: ReplayEngine,
                calibration: CalibrationLoop
              });
              CalibrationReplayAdapter.start();
            }

            console.log('[BetBoom Auto] Wire-up dos modulos novos concluido');
          } catch (wireErr) {
            console.warn('[BetBoom Auto] Wire-up dos modulos novos falhou (fluxo legado continua):', wireErr?.message || wireErr);
            Logger.warn('Wire-up modulos novos falhou:', wireErr?.message || wireErr);
          }
        } catch (error) {
          console.error('[BetBoom Auto] Erro fatal ao renderizar Overlay:', error);
          Logger.error('Erro ao renderizar Overlay:', error?.message || error);
        }
      } else {
        Logger.warn('Overlay não encontrado ou já inicializado.');
      }
    });

    Logger.info('Fluxo de inicialização disparado.');
  }

  function inicializarSubframe() {
    Logger.info('Subframe em modo bridge-only.');
    console.log('[BetBoom Auto] [subframe] bridge-only ativo');
    // O subframe já escuta comandos via tratarMensagemWindow (registrado acima)
    // Expor BB_CLICK_CMD globalmente para teste via console
    window.BB_CLICK = async (alvo = 'player') => executarComandoClique(alvo);
    console.log('[BetBoom Auto] [subframe] BB_CLICK("player"/"banker"/"tie") disponível');

    // R99.1: expõe testarSeletores TAMBÉM no subframe para diagnóstico do iframe Evolution.
    // Quando o operador roda no console com o iframe focado, vê o DOM real do jogo.
    window.testarSeletores = construirTestarSeletores();
    console.log('[BetBoom Auto] [subframe] testarSeletores() disponível no console deste iframe');

    // R99.2: detector canvas-only AO CARREGAR (não ao clicar).
    // Roda 3 vezes: 3s, 8s, 15s — Evolution Mini é lenta pra renderizar.
    // Resultado é enviado pro top via postMessage; overlay vai mostrar banner crítico.
    const CHECKS_MS = [3000, 8000, 15000];
    CHECKS_MS.forEach((delay) => {
      setTimeout(() => {
        try {
          const docs = coletarDocsRecursivo();
          let domClicaveis = 0;
          let canvasCount = 0;
          for (const d of docs) {
            try {
              domClicaveis += d.querySelectorAll('[data-bet], [data-betia-id^="bet-"], [data-role*="bet-spot"]').length;
              canvasCount += d.querySelectorAll('canvas').length;
            } catch (_) {}
          }
          const canvasOnly = (domClicaveis === 0 && canvasCount > 0);
          console.log(`[CANVAS-CHECK@${delay/1000}s] DOM clicáveis=${domClicaveis} canvas=${canvasCount} → canvasOnly=${canvasOnly}`);
          // Sempre reporta; top decide se mostra banner com base no último estado.
          try {
            window.top.postMessage({
              source: 'bb-canvas-detection',
              canvasOnly,
              domClicaveis,
              canvasCount,
              delay,
              ts: Date.now(),
              urlSubframe: location.href
            }, '*');
          } catch (_) {}
        } catch (e) {
          console.warn('[CANVAS-CHECK] falhou:', e?.message);
        }
      }, delay);
    });
  }

  // R99.1: extraído pra função reutilizável (top + subframe).
  function construirTestarSeletores() {
    return function () {
      console.group('[testarSeletores] varredura completa');
      const docs = coletarDocsRecursivo();
      console.log(`Docs varridos (top + iframes filhos): ${docs.length}`);
      const seletores = [
        '[data-bet="player"]',
        '[data-bet="banker"]',
        '[data-bet="tie"]',
        '[data-bet]',
        '[data-betia-id^="bet-"]',
        '[data-automation-id^="betting-grid-item-"]',
        '[data-role*="bet-spot"]',
        '[aria-label*="Player" i]',
        '[aria-label*="Banker" i]',
        '[class*="chip" i]',
        '[role="button"]',
        'canvas'
      ];
      const out = {};
      let totalElementosClicaveis = 0;
      let canvasCount = 0;
      seletores.forEach((sel) => {
        let count = 0;
        let firstSample = null;
        for (const doc of docs) {
          try {
            const nodes = doc.querySelectorAll(sel);
            count += nodes.length;
            if (!firstSample && nodes.length) {
              const el = nodes[0];
              const r = el.getBoundingClientRect();
              firstSample = {
                tag: el.tagName,
                cls: (el.className || '').toString().slice(0, 60),
                size: `${Math.round(r.width)}x${Math.round(r.height)}`,
                pos: `${Math.round(r.left)},${Math.round(r.top)}`
              };
            }
          } catch (_) {}
        }
        if (sel === 'canvas') canvasCount = count;
        else if (sel !== '[role="button"]') totalElementosClicaveis += count;
        out[sel] = { count, firstSample };
      });
      console.table(out);

      // Veredicto R99.1
      if (totalElementosClicaveis === 0 && canvasCount > 0) {
        console.warn('%c⚠️  VEREDICTO: mesa CANVAS-ONLY (zero seletores DOM). ' +
          'Clique via [data-bet] NÃO funciona aqui. Use 🎯 CAL no overlay ou troque pra mesa Bac Bo (não Mini).',
          'background:#7f1d1d;color:#fff;padding:4px 8px;font-weight:bold');
      } else if (totalElementosClicaveis > 0) {
        console.log('%c✅ VEREDICTO: DOM tem seletores clicáveis. Bridge deve funcionar.',
          'background:#14532d;color:#fff;padding:4px 8px;font-weight:bold');
      } else {
        console.warn('%c⚠️  VEREDICTO: zero DOM E zero canvas. Frame errado?',
          'background:#78350f;color:#fff;padding:4px 8px;font-weight:bold');
      }
      console.groupEnd();
      return out;
    };
  }

  window.addEventListener('message', tratarMensagemWindow);
  document.addEventListener('click', tratarCliqueOperador, true);
  registrarListenersRuntime();
  injetarWebSocketInterceptor();

  if (IS_TOP_FRAME) {
    inicializarTopFrame().catch((error) => {
      Logger.error('Erro na inicialização do top frame:', error?.message || error);
      console.error('[BetBoom Auto] Erro na inicialização do top frame:', error);
    });

    // ============================================================
    // CDP DIRETO NO TOP FRAME — sem precisar do relay subframe
    // ============================================================
    // Top frame tem acesso ao iframe.getBoundingClientRect() do iframe Evolution
    // (mesmo cross-origin). Isso dá o tamanho VISUAL REAL no viewport top, em
    // vez do innerWidth interno reportado pelo subframe (que pode estar scaled).
    // Conclusão: clica no PIXEL CERTO da tela, não em coords distorcidas.
    function calcularCoordsTopFrame(alvo, chipValue) {
      const iframes = Array.from(document.querySelectorAll('iframe'));
      const evoFrame = iframes.find((f) =>
        f.src && (f.src.includes('evo-games.com') || f.src.includes('billing-boom.com'))
      );
      if (!evoFrame) return null;
      const rect = evoFrame.getBoundingClientRect();
      if (rect.width < 100 || rect.height < 100) return null;

      // Layout Bac Bo Evolution Mini — atenção: TEM 2 linhas separadas!
      //   Linha 1 (y ~0.50-0.65): texto grande "PLAYER" / "BANKER" + odds
      //                            INFORMATIVO, NÃO clicável.
      //   Linha 2 (y ~0.75-0.85): spots reais "JOGADOR" / "EMPATE" / "BANCA"
      //                            CLICÁVEIS (área de aposta).
      // Frações antigas y=0.64 caíam na linha 1 (texto) — Evolution ignorava.
      // Agora y=0.80 cai na linha 2 (área de aposta real).
      const SPOT_FRAC = {
        player: { x: 0.28, y: 0.80 },  // JOGADOR (azul, aposta)
        tie:    { x: 0.50, y: 0.80 },  // EMPATE (verde centro, aposta)
        banker: { x: 0.72, y: 0.80 }   // BANCA (vermelho, aposta)
      };
      const CHIP_INDEX = { 5: 0, 10: 1, 25: 2, 125: 3, 500: 4, 2500: 5, 6000: 6, 10000: 7, 12000: 8 };
      const sf = SPOT_FRAC[alvo];
      if (!sf) return null;
      const stake = Number(chipValue);
      const idx = Number.isFinite(stake) && CHIP_INDEX[stake] != null ? CHIP_INDEX[stake] : 0;
      const chipX = 0.18 + (idx * (0.60 / 8));
      return {
        chip: { x: rect.left + chipX * rect.width, y: rect.top + 0.92 * rect.height },
        spot: { x: rect.left + sf.x * rect.width, y: rect.top + sf.y * rect.height },
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
      };
    }

    // Marker visual do clique do robô — anel pulsante + etiqueta "🤖 ROBÔ"
    // pra diferenciar de cliques humanos. Auto-some em 1.5s.
    function mostrarMarcadorRobo(x, y, label) {
      try {
        if (!document.getElementById('bb-robot-marker-style')) {
          const style = document.createElement('style');
          style.id = 'bb-robot-marker-style';
          style.textContent = `
            @keyframes bbRoboPulse {
              0% { transform: translate(-50%, -50%) scale(0.3); opacity: 1; }
              60% { transform: translate(-50%, -50%) scale(1.6); opacity: 0.8; }
              100% { transform: translate(-50%, -50%) scale(2.4); opacity: 0; }
            }
            @keyframes bbRoboLabelFade {
              0% { opacity: 0; transform: translate(-50%, -150%) scale(0.7); }
              25% { opacity: 1; transform: translate(-50%, -200%) scale(1); }
              100% { opacity: 0; transform: translate(-50%, -250%) scale(1); }
            }
          `;
          document.head.appendChild(style);
        }
        const ring = document.createElement('div');
        ring.style.cssText = `
          position: fixed;
          left: ${x}px;
          top: ${y}px;
          width: 36px;
          height: 36px;
          border: 3px solid #06b6d4;
          border-radius: 50%;
          background: rgba(6, 182, 212, 0.25);
          box-shadow: 0 0 24px rgba(6, 182, 212, 0.9), inset 0 0 12px rgba(255, 255, 255, 0.4);
          pointer-events: none;
          z-index: 2147483646;
          animation: bbRoboPulse 1.4s ease-out forwards;
        `;
        const tag = document.createElement('div');
        tag.style.cssText = `
          position: fixed;
          left: ${x}px;
          top: ${y}px;
          padding: 4px 10px;
          background: #06b6d4;
          color: #fff;
          font: 700 11px -apple-system, Segoe UI, sans-serif;
          border-radius: 6px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.6);
          pointer-events: none;
          z-index: 2147483647;
          white-space: nowrap;
          animation: bbRoboLabelFade 1.5s ease-out forwards;
        `;
        tag.textContent = `🤖 ROBÔ → ${label}`;
        document.body.appendChild(ring);
        document.body.appendChild(tag);
        setTimeout(() => { ring.remove(); tag.remove(); }, 1600);
      } catch (_) {}
    }

    function dispararCDPDireto(x, y, label) {
      // Mostra o marker AO MESMO TEMPO do CDP — operador vê exatamente
      // onde o robô vai clicar (diferenciado do mouse humano).
      mostrarMarcadorRobo(x, y, label);
      try {
        chrome.runtime.sendMessage(
          { type: 'BB_EXECUTE_HARDWARE_CLICK', x: Math.round(x), y: Math.round(y) },
          (resp) => {
            const ok = !!(resp && resp.ok);
            console.log(`[BB-TOP-DIRECT] ${ok ? '✅' : '❌'} ${label} @ (${Math.round(x)}, ${Math.round(y)})`);
          }
        );
      } catch (e) {
        console.warn('[BB-TOP-DIRECT] falha:', e?.message);
      }
    }

    // Expor função global para disparar clique no iframe da Evolution.
    // ORDEM (R99): 1) Bridge DOM real → 2) Calibrado salvo → 3) CDP heurístico.
    // DOM via [data-bet=...] tem que ser o caminho default. CDP só pra canvas-only.
    window.BB_CLICK = function (alvo = 'player', valor = null) {
      const PT_TO_EN = { 'azul': 'player', 'vermelho': 'banker', 'empate': 'tie' };
      const alvoEN = PT_TO_EN[String(alvo).toLowerCase()] || String(alvo).toLowerCase();

      // Lê coords calibradas (se houver) pra passar pro subframe como fallback
      let calCoords = null;
      try {
        const calRaw = localStorage.getItem('BB_INLINE_COORDS_v1');
        if (calRaw) {
          const cal = JSON.parse(calRaw);
          const chipKey = `chip${valor || 5}`;
          const chipPos = cal[chipKey] || cal.chip5;
          const spotPos = cal[alvoEN];
          if (chipPos && spotPos && Number.isFinite(chipPos.x) && Number.isFinite(spotPos.x)) {
            calCoords = { chip: chipPos, spot: spotPos, confirmar: cal.confirmar || null };
          }
        }
      } catch (_) {}

      // 1) BRIDGE DOM (caminho PRINCIPAL) — subframe tenta [data-bet=...] primeiro,
      //    cai pra CDP heurístico internamente se DOM falhar.
      const iframes = Array.from(document.querySelectorAll('iframe'));
      const evoFrame = iframes.find(f =>
        f.src && (f.src.includes('evo-games.com') || f.src.includes('billing-boom.com'))
      );
      if (evoFrame && evoFrame.contentWindow) {
        console.log(`[BB_CLICK] 🌉 BRIDGE DOM (caminho principal): ${alvo} | valor: ${valor}`);
        evoFrame.contentWindow.postMessage({
          source: 'bb-click-cmd',
          alvo,
          valor,
          fallbackCoords: calCoords  // subframe usa se DOM falhar
        }, '*');
        return;
      }

      // 2) CALIBRADO — usado quando iframe Evolution NÃO foi encontrado
      if (calCoords) {
        console.log(`[BB_CLICK] 🎯 CALIBRATED fallback (iframe ausente)`);
        dispararCDPDireto(calCoords.chip.x, calCoords.chip.y, `chip-${valor || 5}`);
        setTimeout(() => dispararCDPDireto(calCoords.spot.x, calCoords.spot.y, alvoEN), 400);
        if (calCoords.confirmar && Number.isFinite(calCoords.confirmar.x)) {
          setTimeout(() => dispararCDPDireto(calCoords.confirmar.x, calCoords.confirmar.y, 'confirmar'), 800);
        }
        return;
      }

      // 3) TOP-DIRECT CDP heurístico (último recurso)
      const coords = calcularCoordsTopFrame(alvoEN, valor);
      if (coords) {
        console.log(`[BB_CLICK] 🎯 TOP-DIRECT mode (último recurso) | iframe rect: ${Math.round(coords.rect.left)},${Math.round(coords.rect.top)} ${Math.round(coords.rect.width)}x${Math.round(coords.rect.height)}`);
        dispararCDPDireto(coords.chip.x, coords.chip.y, `chip-${valor || '5'}`);
        setTimeout(() => dispararCDPDireto(coords.spot.x, coords.spot.y, alvoEN), 400);
        return;
      }

      console.error('[BB_CLICK] ❌ Nenhum caminho de clique disponível (sem iframe, sem cal, sem coords).');
      if (overlayInicializado && typeof Overlay !== 'undefined' && Overlay.addLog) {
        Overlay.addLog('❌ Nenhum caminho de clique disponível', 'error');
      }
    };
    console.log('[BetBoom Auto] BB_CLICK("player"/"banker"/"tie") disponível no console');

    // R99/R99.1: helper de diagnóstico. Rode no console (top OU iframe) pra ver
    // se a Evolution está expondo [data-bet=*] como esperado.
    window.testarSeletores = construirTestarSeletores();
    console.log('[BetBoom Auto] testarSeletores() disponível no console (top)');
  } else {
    inicializarSubframe();
  }
})();
