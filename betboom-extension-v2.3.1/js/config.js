/**
 * BetBoom Auto Pattern — Configuração Global v2
 * Padrões validados contra a transcrição do Will.
 */

const CONFIG = {
  // --- Stake ---
  stakeInicial: 5,          // Valor MÍNIMO REAL da mesa BetBoom (R$5 - R$25.000)
  stakeMax: 25,             // Limite seguro para fase de calibragem
  stakeCapMultiplier: 1,    // 🛑 SAFETY: cap absoluto = stakeInicial × 1 = R$5. Quando confiar mais, subir para 2/5/10.
  permitirFallbackHeuristico: true,  // ✅ REATIVADO: robô clica via coords heurísticas Bac Bo Evolution Mini. Cap R$5 protege contra ficha errada.

  // --- Gale (Martingale) ---
  maxGales: 2,              // Quantidade máxima de gales (0 = sem gale)
  galeMultiplier: 2,        // Multiplicador do gale

  // --- Proteção ---
  protegerEmpate: false,    // DESATIVADO na calibragem (saldo baixo)
  valorProtecaoEmpate: 5,   // Mínimo R$5 quando ativado

  // --- Stop Win / Stop Loss ---
  stopWin: 1000,            // Meta de lucro para parar
  stopLoss: 500,            // Limite de perda para parar
  trailingStop: 0,          // Trailing stop em R$ (0 = desativado). Quando lucro recua N reais a partir do pico, para.

  // --- Autodrive / HITL bifurcação ---
  autoExecuteThreshold: 85,    // Conviction >= 85% executa sem aguardar countdown HITL
  hitlCountdownSeconds: 5,     // Tempo do countdown HITL quando conviction < threshold

  // --- Banca ---
  bancaInicial: 1000,       // Valor inicial da banca

  // --- Padrões ativos (Estratégia Will) ---
  padroesAtivos: {
    xadrez: true,               // 1. Xadrez (alternância A-B-A-B)
    reversao: true,             // 2. Reversão (3+ iguais → oposto, até G1)
    posEmpate: true,            // 3. Pós-Empate (jogar na cor anterior ao empate)
    diagonal: true,             // 4. Diagonal (visual no gráfico)
    casadinho: true,            // 5. Casadinho (empates lado a lado)
    linhaDevedora: true,        // 6. Linha Devedora ("deve" pagar)
    quebrapadrao: true,         // 7. Quebra de Padrão (seguir a quebra)
    sequenciaDe2: true,         // 8. Sequência de 2 (AA-BB → próximo par)
    sequenciaDe3: true,         // 9. Sequência de 3 (3 iguais → oposto, até G1)
    ponta: true,                // 10. Ponta / Quadrante (4 últimas casas)
    xadrezSemGale: true,        // 11. Xadrez sem Gale (alternância curta)
    pingPong: true,             // 12. Ping-Pong (alternância longa 6+)
    xadrezDuplo: true,          // 13. Xadrez Duplo (2-2-2)
    tendencia: true,            // 14. Tendência Dominante (70%+ de uma cor)
    correcaoEmpate: true,       // 15. Correção Após Empate
    espelho: true,              // 16. Espelho Entre Linhas
    canalHorizontal: true,      // 17. Canal Horizontal
    reversaoDiagonal: true      // 18. Reversão Diagonal
  },

  // --- Seletores DOM (adaptáveis ao site) ---
  selectors: {
    // Histórico de resultados (bolinhas/cards)
    historicoContainer: '[data-automation-id="road-map"], [data-testid="history"], .game__history',
    historicoItem: '[data-automation-id^="road-map-item"], .history-item',
    
    // Cores dos resultados
    corVermelha: '[data-automation-id*="banker"], .red',
    corAzul: '[data-automation-id*="player"], .blue',
    corEmpate: '[data-automation-id*="tie"], .green',

    // Botões de aposta
    btnVermelho: '[data-automation-id="betting-grid-item-banker"]',
    btnAzul: '[data-automation-id="betting-grid-item-player"]',
    btnEmpate: '[data-automation-id="betting-grid-item-tie"]',

    // Campo de valor da aposta (Fichas)
    inputStake: '[data-automation-id^="chip-"]',

    // Botão confirmar aposta (Evolution Bac Bo)
    // Ordem de prioridade: confirm > place-bet > apply → nunca usar undo-button para confirmar
    btnConfirmar: '[data-automation-id="confirm-button"], [data-automation-id="place-bet-button"], [data-automation-id="apply-button"], [class*="confirm"][class*="btn"], button[class*="Confirm"], [aria-label*="confirm" i], [aria-label*="confirmar" i], [class*="betConfirm"], [class*="bet-confirm"]',

    // Timer / countdown
    timer: '[data-automation-id="timer-text"], .timer',

    // Status da rodada
    statusRodada: '[data-automation-id="game-status-text"], .round-status'
  },

  // --- Iframe / Evolution ---
  iframe: {
    // Seletores para encontrar o iframe do jogo Evolution
    seletores: [
      'iframe[src*="evo-games"]',
      'iframe[src*="evolution"]',
      'iframe[src*="bac-bo"]',
      'iframe[src*="bacbo"]',
      'iframe[src*="game"]',
      'iframe.game-iframe',
      'iframe[class*="game"]',
      'iframe[id*="game"]'
    ],
    // Tempo máximo de espera pelo iframe (ms)
    timeoutCarregamento: 30000,
    // Intervalo de verificação do iframe (ms)
    intervaloVerificacao: 1000
  },

  // --- Intervalos ---
  intervaloVerificacao: 2000,   // ms entre verificações do DOM
  intervaloEntreApostas: 1500,  // ms entre ações de aposta
  delayAleatorio: { min: 300, max: 800 }, // Randomização para anti-bot

  modoPassivo: false,           // DESATIVADO: OPERAÇÃO ATIVA OBRIGATÓRIA
  modoTeste: false,             // DESATIVADO: CLIQUE REAL OBRIGATÓRIO
  modoDebug: true,              // Ativado apenas para monitoramento de métricas
  ignorarConfirmacaoVisual: true, // NOVO: Permite clique via ID mesmo se o texto do botão não for lido (Aumenta assertividade)

  // --- Estratégias ---
  strategyLibrary: [],
  strategyPreferences: {
    selectedStrategyId: null
  },

  // --- Logging ---
  logEnabled: true,
  logLevel: 'info', // 'debug', 'info', 'warn', 'error'

  // --- Estado operacional transitório ---
  estadoRodadaAtual: null,
  roundIdAtual: null,
  saldoReal: null,
  fonteDoSaldo: null,
  wsDadosRecebidos: false,
  canaisWSAtivos: [],
  overlayReady: false,
  ultimoResultadoConfirmado: null
};

// Utilitário de log
const Logger = {
  _log(level, ...args) {
    if (!CONFIG.logEnabled) return;
    const levels = ['debug', 'info', 'warn', 'error'];
    if (levels.indexOf(level) >= levels.indexOf(CONFIG.logLevel)) {
      const timestamp = new Date().toLocaleTimeString('pt-BR');
      console[level](`[BetBoom Auto ${timestamp}]`, ...args);
    }
  },
  debug(...args) { this._log('debug', ...args); },
  info(...args) { this._log('info', ...args); },
  warn(...args) { this._log('warn', ...args); },
  error(...args) { this._log('error', ...args); }
};

const BBStrategyUtils = (() => {
  const STORAGE_KEYS = {
    config: 'config',
    strategyLibrary: 'strategyLibrary',
    strategyLibraryBootstrapped: 'strategyLibraryBootstrapped',
    strategyPreferences: 'strategyPreferences'
  };

  const DEFAULT_PREFERENCES = {
    selectedStrategyId: 'will-2-para-azul'
  };

  const COLORS = ['vermelho', 'azul', 'empate'];

  const ENTRY_LABELS = {
    vermelho: 'Vermelho / Banker',
    azul: 'Azul / Player',
    empate: 'Empate'
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeCor(value) {
    if (!value && value !== 0) return null;
    const token = String(value).toLowerCase().trim();

    if (['v', 'vermelho', 'red', 'banker', 'b'].includes(token)) return 'vermelho';
    if (['a', 'azul', 'blue', 'player', 'p'].includes(token)) return 'azul';
    if (['e', 'empate', 'tie', 'draw', 'green'].includes(token)) return 'empate';
    return null;
  }

  function normalizeSequenceBase(sequenceBase) {
    if (Array.isArray(sequenceBase)) {
      return sequenceBase.map(normalizeCor).filter(Boolean);
    }

    if (typeof sequenceBase !== 'string') return [];

    return sequenceBase
      .split(/[,\u2192>/|\-\s]+/)
      .map(normalizeCor)
      .filter(Boolean);
  }

  function sequenceToLabel(sequenceBase) {
    const sequence = Array.isArray(sequenceBase) ? sequenceBase : normalizeSequenceBase(sequenceBase);
    if (!sequence.length) {
      return typeof sequenceBase === 'string' ? sequenceBase : '—';
    }

    return sequence
      .map((cor) => cor.charAt(0).toUpperCase() + cor.slice(1))
      .join(' → ');
  }

  function getEntryLabel(cor) {
    return ENTRY_LABELS[cor] || cor || '—';
  }

  function createWillDefaultStrategies() {
    return [
      {
        id: 'will-2-para-azul',
        nome: '2 para Azul',
        source: 'will-default',
        editable: true,
        removable: true,
        active: true,
        matcherType: 'exact-sequence',
        sequenceBase: 'vermelho, vermelho',
        entradaEsperada: 'azul',
        limiteGale: 1,
        usarProtecaoEmpate: true,
        observacao: 'Preset inicial do Will: após dois vermelhos, procurar azul.',
        mappedPatternKey: 'custom-sequence',
        confidence: 82
      },
      {
        id: 'will-ponta-azul',
        nome: 'Ponta para Azul',
        source: 'will-default',
        editable: true,
        removable: true,
        active: true,
        matcherType: 'dominant-last-4',
        sequenceBase: '3 azuis nas últimas 4',
        entradaEsperada: 'azul',
        limiteGale: 1,
        usarProtecaoEmpate: true,
        observacao: 'Leitura de ponta com dominância azul.',
        mappedPatternKey: 'ponta',
        confidence: 76
      },
      {
        id: 'will-ponta-vermelho',
        nome: 'Ponta para Vermelho',
        source: 'will-default',
        editable: true,
        removable: true,
        active: true,
        matcherType: 'dominant-last-4',
        sequenceBase: '3 vermelhos nas últimas 4',
        entradaEsperada: 'vermelho',
        limiteGale: 1,
        usarProtecaoEmpate: true,
        observacao: 'Leitura de ponta com dominância vermelha.',
        mappedPatternKey: 'ponta',
        confidence: 76
      },
      {
        id: 'will-2-para-vermelho',
        nome: '2 para Vermelho',
        source: 'will-default',
        editable: true,
        removable: true,
        active: true,
        matcherType: 'exact-sequence',
        sequenceBase: 'azul, azul',
        entradaEsperada: 'vermelho',
        limiteGale: 1,
        usarProtecaoEmpate: true,
        observacao: 'Preset inicial do Will: após dois azuis, procurar vermelho.',
        mappedPatternKey: 'custom-sequence',
        confidence: 82
      },
      {
        id: 'will-quadrante-vermelho',
        nome: 'Quadrante para Vermelho',
        source: 'will-default',
        editable: true,
        removable: true,
        active: true,
        matcherType: 'dominant-last-4',
        sequenceBase: '3 vermelhos nas últimas 4',
        entradaEsperada: 'vermelho',
        limiteGale: 1,
        usarProtecaoEmpate: true,
        observacao: 'Quadrante vermelho mapeado sobre a leitura de ponta.',
        mappedPatternKey: 'ponta',
        confidence: 74
      },
      {
        id: 'will-quadrante-azul',
        nome: 'Quadrante para Azul',
        source: 'will-default',
        editable: true,
        removable: true,
        active: true,
        matcherType: 'dominant-last-4',
        sequenceBase: '3 azuis nas últimas 4',
        entradaEsperada: 'azul',
        limiteGale: 1,
        usarProtecaoEmpate: true,
        observacao: 'Quadrante azul mapeado sobre a leitura de ponta.',
        mappedPatternKey: 'ponta',
        confidence: 74
      },
      {
        id: 'will-xadrez-vermelho',
        nome: 'Xadrez para Vermelho',
        source: 'will-default',
        editable: true,
        removable: true,
        active: true,
        matcherType: 'alternating-sequence',
        sequenceBase: 'azul, vermelho, azul',
        entradaEsperada: 'vermelho',
        limiteGale: 1,
        usarProtecaoEmpate: true,
        observacao: 'Alternância curta apontando vermelho.',
        mappedPatternKey: 'xadrez',
        confidence: 80
      },
      {
        id: 'will-xadrez-azul',
        nome: 'Xadrez para Azul',
        source: 'will-default',
        editable: true,
        removable: true,
        active: true,
        matcherType: 'alternating-sequence',
        sequenceBase: 'vermelho, azul, vermelho',
        entradaEsperada: 'azul',
        limiteGale: 1,
        usarProtecaoEmpate: true,
        observacao: 'Alternância curta apontando azul.',
        mappedPatternKey: 'xadrez',
        confidence: 80
      },
      {
        id: 'will-reversao-3-vermelho',
        nome: 'Reversão (3 Azuis → Vermelho)',
        source: 'will-default',
        editable: true,
        removable: true,
        active: true,
        matcherType: 'exact-sequence',
        sequenceBase: 'azul, azul, azul',
        entradaEsperada: 'vermelho',
        limiteGale: 1,
        usarProtecaoEmpate: true,
        observacao: 'Reversão de tendência curta.',
        confidence: 85
      },
      {
        id: 'will-reversao-3-azul',
        nome: 'Reversão (3 Vermelhos → Azul)',
        source: 'will-default',
        editable: true,
        removable: true,
        active: true,
        matcherType: 'exact-sequence',
        sequenceBase: 'vermelho, vermelho, vermelho',
        entradaEsperada: 'azul',
        limiteGale: 1,
        usarProtecaoEmpate: true,
        observacao: 'Reversão de tendência curta.',
        confidence: 85
      },
      {
        id: 'will-casadinho',
        nome: 'Casadinho (Empate Duplo)',
        source: 'will-default',
        editable: true,
        removable: true,
        active: true,
        matcherType: 'exact-sequence',
        sequenceBase: 'empate, empate',
        entradaEsperada: 'azul', // Placeholder, logic treats this specially in engine if needed, but Will usually repeats last color
        limiteGale: 1,
        usarProtecaoEmpate: false,
        observacao: 'Dois empates seguidos.',
        confidence: 90
      }
    ];
  }

  function ensureStrategyShape(strategy, index = 0) {
    const entradaEsperada = normalizeCor(strategy?.entradaEsperada) || 'azul';
    const normalized = {
      id: strategy?.id || `strategy-${Date.now()}-${index}`,
      nome: strategy?.nome || `Estratégia ${index + 1}`,
      source: strategy?.source || 'user',
      editable: strategy?.editable !== false,
      removable: strategy?.removable !== false,
      active: strategy?.active !== false,
      matcherType: strategy?.matcherType || 'exact-sequence',
      sequenceBase: Array.isArray(strategy?.sequenceBase)
        ? sequenceToLabel(strategy.sequenceBase)
        : (strategy?.sequenceBase || ''),
      entradaEsperada,
      limiteGale: Number.isFinite(Number(strategy?.limiteGale)) ? Number(strategy.limiteGale) : 1,
      usarProtecaoEmpate: strategy?.usarProtecaoEmpate !== false,
      observacao: strategy?.observacao || '',
      mappedPatternKey: strategy?.mappedPatternKey || null,
      confidence: Number.isFinite(Number(strategy?.confidence)) ? Number(strategy.confidence) : 75
    };

    return normalized;
  }

  function ensureStrategyLibrary(list) {
    if (!Array.isArray(list)) return [];
    return list.map((item, index) => ensureStrategyShape(item, index));
  }

  function createUserStrategyDraft() {
    return ensureStrategyShape({
      id: `user-${Date.now()}`,
      nome: 'Nova estratégia',
      source: 'user',
      editable: true,
      removable: true,
      active: true,
      matcherType: 'exact-sequence',
      sequenceBase: '',
      entradaEsperada: 'azul',
      limiteGale: 1,
      usarProtecaoEmpate: true,
      observacao: ''
    });
  }

  function ensureBootstrapPayload(rawData = {}) {
    const shouldBootstrap = !Array.isArray(rawData[STORAGE_KEYS.strategyLibrary]) ||
      rawData[STORAGE_KEYS.strategyLibrary].length === 0 ||
      rawData[STORAGE_KEYS.strategyLibraryBootstrapped] !== true;

    const strategyLibrary = shouldBootstrap
      ? createWillDefaultStrategies()
      : ensureStrategyLibrary(rawData[STORAGE_KEYS.strategyLibrary]);

    const selectedStrategyId = rawData?.[STORAGE_KEYS.strategyPreferences]?.selectedStrategyId ||
      strategyLibrary[0]?.id ||
      DEFAULT_PREFERENCES.selectedStrategyId;

    return {
      shouldBootstrap,
      strategyLibrary,
      strategyPreferences: {
        ...DEFAULT_PREFERENCES,
        ...(rawData[STORAGE_KEYS.strategyPreferences] || {}),
        selectedStrategyId
      }
    };
  }

  return {
    STORAGE_KEYS,
    COLORS,
    DEFAULT_PREFERENCES,
    clone,
    normalizeCor,
    normalizeSequenceBase,
    sequenceToLabel,
    getEntryLabel,
    createWillDefaultStrategies,
    ensureStrategyShape,
    ensureStrategyLibrary,
    createUserStrategyDraft,
    ensureBootstrapPayload
  };
})();

globalThis.BBStrategyUtils = BBStrategyUtils;

const BBConfigUtils = (() => {
  const DEFAULT_CONFIG_SNAPSHOT = JSON.parse(JSON.stringify(CONFIG));
  const PERSISTED_KEYS = [
    'stakeInicial',
    'stakeMax',
    'maxGales',
    'galeMultiplier',
    'protegerEmpate',
    'valorProtecaoEmpate',
    'stopWin',
    'stopLoss',
    'bancaInicial',
    'padroesAtivos',
    'selectors',
    'iframe',
    'intervaloVerificacao',
    'intervaloEntreApostas',
    'delayAleatorio',
    'modoPassivo',
    'modoTeste',
    'modoDebug',
    'logEnabled',
    'logLevel'
  ];

  function clone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function isPlainObject(value) {
    return Object.prototype.toString.call(value) === '[object Object]';
  }

  function pick(source = {}, keys = []) {
    return keys.reduce((acc, key) => {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        acc[key] = clone(source[key]);
      }
      return acc;
    }, {});
  }

  function deepMerge(baseValue, overrideValue) {
    if (Array.isArray(baseValue)) {
      return Array.isArray(overrideValue) ? clone(overrideValue) : clone(baseValue);
    }

    if (isPlainObject(baseValue)) {
      const overrideObject = isPlainObject(overrideValue) ? overrideValue : {};
      const merged = {};
      const keys = new Set([
        ...Object.keys(baseValue),
        ...Object.keys(overrideObject)
      ]);

      keys.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(overrideObject, key)) {
          merged[key] = deepMerge(baseValue[key], overrideObject[key]);
          return;
        }

        merged[key] = clone(baseValue[key]);
      });

      return merged;
    }

    if (overrideValue === undefined) {
      return clone(baseValue);
    }

    return clone(overrideValue);
  }

  const PERSISTED_DEFAULTS = pick(DEFAULT_CONFIG_SNAPSHOT, PERSISTED_KEYS);

  function getPersistedDefaults() {
    return clone(PERSISTED_DEFAULTS);
  }

  function mergePersistedConfig(rawConfig = {}) {
    return deepMerge(PERSISTED_DEFAULTS, isPlainObject(rawConfig) ? rawConfig : {});
  }

  function mergePersistedPatch(currentConfig = {}, patch = {}) {
    return deepMerge(
      mergePersistedConfig(currentConfig),
      isPlainObject(patch) ? patch : {}
    );
  }

  function applyPersistedConfig(targetConfig, rawConfig = {}) {
    if (!isPlainObject(targetConfig)) return null;
    Object.assign(targetConfig, mergePersistedConfig(rawConfig));
    return targetConfig;
  }

  function applyRuntimePatch(targetConfig, patch = {}) {
    if (!isPlainObject(targetConfig)) return null;
    Object.assign(targetConfig, deepMerge(targetConfig, isPlainObject(patch) ? patch : {}));
    return targetConfig;
  }

  return {
    PERSISTED_KEYS,
    getPersistedDefaults,
    mergePersistedConfig,
    mergePersistedPatch,
    applyPersistedConfig,
    applyRuntimePatch
  };
})();

globalThis.BBConfigUtils = BBConfigUtils;

const BBTelemetry = (() => {
  const root = typeof window !== 'undefined' ? window : globalThis;

  if (!root.BB_TELEMETRY || !Array.isArray(root.BB_TELEMETRY)) {
    root.BB_TELEMETRY = [];
  }

  const telemetryArray = root.BB_TELEMETRY;
  const nativePush = Array.prototype.push;

  function sanitizeEvent(event = {}) {
    return {
      timestamp: event.timestamp || Date.now(),
      roundId: event.roundId ?? null,
      history: Array.isArray(event.history) ? [...event.history] : [],
      estrategiaDetectada: event.estrategiaDetectada || null,
      origem: event.origem || null,
      sequenciaReconhecida: event.sequenciaReconhecida || null,
      entradaSugerida: event.entradaSugerida || null,
      gale: event.gale ?? 0,
      protecaoEmpate: event.protecaoEmpate === true,
      estadoRodada: event.estadoRodada || null,
      statusRobo: event.statusRobo || null,
      saldo: typeof event.saldo === 'number' ? event.saldo : null,
      patternDetected: event.patternDetected || null,
      targetColor: event.targetColor || null,
      matrixConfirmations: Number.isFinite(Number(event.matrixConfirmations)) ? Number(event.matrixConfirmations) : null,
      confirmedAnalysis: typeof event.confirmedAnalysis === 'boolean' ? event.confirmedAnalysis : null,
      confirmationStrength: event.confirmationStrength || null,
      tableContext: event.tableContext || null,
      operationalRisk: event.operationalRisk || null,
      confidenceIndex: Number.isFinite(Number(event.confidenceIndex)) ? Number(event.confidenceIndex) : null,
      temperaturaEntrada: event.temperaturaEntrada || null,
      recomendacaoOperacional: event.recomendacaoOperacional || null,
      decisionStatus: event.decisionStatus || null,
      reasons: Array.isArray(event.reasons) ? [...event.reasons] : [],
      confirmacoesSecundarias: Array.isArray(event.confirmacoesSecundarias) ? [...event.confirmacoesSecundarias] : [],
      stakeSugerida: Number.isFinite(Number(event.stakeSugerida)) ? Number(event.stakeSugerida) : null,
      mesaClassificacao: event.mesaClassificacao || null,
      stake: typeof event.stake === 'number' ? event.stake : null,
      alvoAposta: event.alvoAposta || null,
      tipoEntrada: event.tipoEntrada || null,
      entradaExecutada: event.entradaExecutada || null,
      clickTimestamp: event.clickTimestamp || null,
      statusExecucao: event.statusExecucao || null,
      resultadoRodada: event.resultadoRodada || null,
      statusFinal: event.statusFinal || null,
      totalEntradas: Number.isFinite(Number(event.totalEntradas)) ? Number(event.totalEntradas) : null,
      entradasAutomaticas: Number.isFinite(Number(event.entradasAutomaticas)) ? Number(event.entradasAutomaticas) : null,
      entradasManuais: Number.isFinite(Number(event.entradasManuais)) ? Number(event.entradasManuais) : null,
      wins: Number.isFinite(Number(event.wins)) ? Number(event.wins) : null,
      losses: Number.isFinite(Number(event.losses)) ? Number(event.losses) : null,
      ties: Number.isFinite(Number(event.ties)) ? Number(event.ties) : null,
      abortosExecucao: Number.isFinite(Number(event.abortosExecucao)) ? Number(event.abortosExecucao) : null,
      taxaAcerto: event.taxaAcerto ?? null,
      targetVisualConfirmado: typeof event.targetVisualConfirmado === 'boolean' ? event.targetVisualConfirmado : null,
      targetVisualCor: event.targetVisualCor || null,
      targetVisualTexto: event.targetVisualTexto || null,
      targetSelector: event.targetSelector || null,
      inconsistencias: Array.isArray(event.inconsistencias) ? [...event.inconsistencias] : []
    };
  }

  function getDecisionStats() {
    try {
      return root.DecisionEngine?.getEstatisticas?.() || {};
    } catch (_) {
      return {};
    }
  }

  function getEntradasOperacionais(limit = null) {
    try {
      return root.DecisionEngine?.getEntradasOperacionais?.(limit) || [];
    } catch (_) {
      return [];
    }
  }

  function getHistoricoObservado() {
    try {
      return root.Collector?.getHistorico?.() || [];
    } catch (_) {
      return [];
    }
  }

  function getStatusRobo(stats = {}) {
    if (CONFIG.modoPassivo) return 'modo-passivo';
    if (stats.isAtivo === false) return 'inativo';
    if (stats.isPausado === true) return 'pausado';
    if (CONFIG.estadoRodadaAtual === 'apostando') return 'pronto-para-operar';
    if (CONFIG.estadoRodadaAtual) return `lendo-${CONFIG.estadoRodadaAtual}`;
    return 'lendo-jogo';
  }

  function formatTimestampForFilename(timestamp = Date.now()) {
    const date = new Date(timestamp);
    const pad = (value) => String(value).padStart(2, '0');
    return [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate())
    ].join('') + '-' + [
      pad(date.getHours()),
      pad(date.getMinutes()),
      pad(date.getSeconds())
    ].join('');
  }

  function buildOperationalSummary() {
    const stats = getDecisionStats();
    return {
      totalEntradas: Number(stats.totalEntradas || 0),
      entradasAutomaticas: Number(stats.entradasAutomaticas || 0),
      entradasManuais: Number(stats.entradasManuais || 0),
      wins: Number(stats.wins ?? stats.vitorias ?? 0),
      losses: Number(stats.losses ?? stats.derrotas ?? 0),
      ties: Number(stats.ties ?? 0),
      taxaAcerto: stats.taxaAcerto ?? '0.0',
      abortosExecucao: Number(stats.abortosExecucao || 0),
      inconsistenciasDetectadas: telemetryArray.filter((event) => Array.isArray(event.inconsistencias) && event.inconsistencias.length > 0).length
    };
  }

  function buildRoundSummary(entry) {
    const observabilityRound = root.ObservabilityEngine?.getSnapshot?.()?.session?.rounds?.find((round) => round.roundId === entry.roundId) || null;
    return {
      roundId: entry.roundId || null,
      estrategia: entry.estrategia || null,
      origem: entry.origem || null,
      sequenciaReconhecida: entry.sequenciaReconhecida || null,
      entradaSugerida: entry.entradaSugerida || null,
      entradaExecutada: entry.entradaExecutada || null,
      tipoEntrada: entry.tipoEntrada || null,
      gale: Number(entry.gale || 0),
      protecaoEmpate: entry.protecaoEmpate === true,
      stake: Number(entry.stake || 0),
      execucao: entry.statusExecucao || entry.statusInicial || null,
      resultado: entry.resultadoLabel || entry.resultadoRodada || null,
      statusFinal: entry.statusFinal || null,
      temperatura: observabilityRound?.recommendation?.temperatura || null,
      recomendacao: observabilityRound?.recommendation?.texto || null,
      contextoMesa: observabilityRound?.decision?.canonical?.tableContext || null,
      riscoOperacional: observabilityRound?.decision?.canonical?.operationalRisk || null,
      confirmacoes: observabilityRound?.decision?.canonical?.matrixConfirmations ?? null,
      statusDecisao: observabilityRound?.decision?.canonical?.decisionStatus || null,
      justificativa: observabilityRound?.decision?.canonical?.reasons?.[0] || null,
      stakeSugerida: observabilityRound?.decision?.stakeSugerida?.valor ?? null,
      timestamp: entry.timestampEntrada || null
    };
  }

  function buildSessionReportData(limit = 200) {
    const size = Number.isFinite(Number(limit)) ? Number(limit) : 200;
    const stats = getDecisionStats();
    const summary = buildOperationalSummary();
    const entries = getEntradasOperacionais(size);
    const historico = getHistoricoObservado();
    const observability = root.ObservabilityEngine?.getSnapshot?.() || null;
    const eventosImportantes = telemetryArray
      .filter((event) =>
        (Array.isArray(event.inconsistencias) && event.inconsistencias.length > 0) ||
        String(event.statusExecucao || '').includes('abort') ||
        event.targetVisualConfirmado === false
      )
      .slice(-size)
      .map((event) => sanitizeEvent(event));

    return {
      metadados: {
        exportadoEm: new Date().toISOString(),
        modoTeste: CONFIG.modoTeste === true,
        modoDebug: CONFIG.modoDebug === true,
        statusAtualRobo: getStatusRobo(stats),
        estadoRodada: CONFIG.estadoRodadaAtual || null,
        totalRodadasObservadas: Number(root.Collector?.getRodadaAtual?.() || historico.length || 0),
        totalEntradas: summary.totalEntradas
      },
      resumoOperacional: summary,
      observabilidade: observability,
      detalhePorRodada: entries.map((entry) => ({
        roundId: entry.roundId || null,
        estrategia: entry.estrategia || null,
        origem: entry.origem || null,
        sequenciaReconhecida: entry.sequenciaReconhecida || null,
        entradaSugerida: entry.entradaSugerida || null,
        entradaExecutada: entry.entradaExecutada || null,
        tipoEntrada: entry.tipoEntrada || null,
        stake: Number(entry.stake || 0),
        gale: Number(entry.gale || 0),
        protecaoEmpate: entry.protecaoEmpate === true,
        statusExecucao: entry.statusExecucao || null,
        resultadoRodada: entry.resultadoLabel || entry.resultadoRodada || null,
        statusFinal: entry.statusFinal || null,
        contextoMesa: observability?.session?.rounds?.find((round) => round.roundId === entry.roundId)?.decision?.canonical?.tableContext || null,
        riscoOperacional: observability?.session?.rounds?.find((round) => round.roundId === entry.roundId)?.decision?.canonical?.operationalRisk || null,
        confirmacoes: observability?.session?.rounds?.find((round) => round.roundId === entry.roundId)?.decision?.canonical?.matrixConfirmations ?? null,
        justificativa: observability?.session?.rounds?.find((round) => round.roundId === entry.roundId)?.decision?.canonical?.reasons?.[0] || null,
        timestamp: entry.timestampEntrada || null
      })),
      rodadasObservadas: Array.isArray(observability?.session?.rounds)
        ? observability.session.rounds.map((round) => ({
          roundId: round.roundId || null,
          classificacao: round.classification || null,
          estrategia: round.decision?.estrategia || null,
          entradaPlanejada: round.decision?.entradaSugerida || null,
          entradaExecutada: round.entry?.entradaExecutada || null,
          tipoEntrada: round.entry?.tipoEntrada || null,
          resultado: round.result?.vencedor || round.result?.cor || null,
          statusFinal: round.entry?.statusFinal || null,
          confirmacoes: round.decision?.canonical?.matrixConfirmations ?? null,
          riscoOperacional: round.decision?.canonical?.operationalRisk || null,
          temperatura: round.recommendation?.temperatura || null,
          recomendacao: round.recommendation?.texto || null,
          mesaClassificacao: round.context?.mesaClassificacao || null,
          timestamp: round.updatedAt || round.createdAt || null
        }))
        : [],
      eventosImportantes,
      telemetriaRecente: telemetryArray.slice(-Math.min(size, 100)).map((event) => sanitizeEvent(event))
    };
  }

  function buildSessionMarkdown(limit = 200) {
    const report = buildSessionReportData(limit);
    const lines = [];
    lines.push('# Relatório da sessão');
    lines.push('');
    lines.push(`- Exportado em: ${report.metadados.exportadoEm}`);
    lines.push(`- Modo teste: ${report.metadados.modoTeste ? 'ON' : 'OFF'}`);
    lines.push(`- Modo debug: ${report.metadados.modoDebug ? 'ON' : 'OFF'}`);
    lines.push(`- Status atual do robô: ${report.metadados.statusAtualRobo}`);
    lines.push(`- Estado da rodada: ${report.metadados.estadoRodada || '—'}`);
    lines.push(`- Total de rodadas observadas: ${report.metadados.totalRodadasObservadas}`);
    lines.push(`- Total de entradas: ${report.metadados.totalEntradas}`);
    lines.push('');
    lines.push('## Resumo operacional');
    lines.push('');
    lines.push(`- Entradas automáticas: ${report.resumoOperacional.entradasAutomaticas}`);
    lines.push(`- Entradas manuais: ${report.resumoOperacional.entradasManuais}`);
    lines.push(`- Wins: ${report.resumoOperacional.wins}`);
    lines.push(`- Losses: ${report.resumoOperacional.losses}`);
    lines.push(`- Ties: ${report.resumoOperacional.ties}`);
    lines.push(`- Taxa de acerto: ${report.resumoOperacional.taxaAcerto}%`);
    lines.push(`- Abortos de execução: ${report.resumoOperacional.abortosExecucao}`);
    lines.push(`- Inconsistências detectadas: ${report.resumoOperacional.inconsistenciasDetectadas}`);
    lines.push('');

    if (report.observabilidade?.session) {
      lines.push('## Observabilidade da sessão');
      lines.push('');
      lines.push(`- Banca inicial da sessão: ${report.observabilidade.session.bancaInicialSessao != null ? `R$ ${Number(report.observabilidade.session.bancaInicialSessao).toFixed(2)}` : '—'}`);
      lines.push(`- Saldo atual: ${report.observabilidade.session.saldoAtual != null ? `R$ ${Number(report.observabilidade.session.saldoAtual).toFixed(2)}` : '—'}`);
      lines.push(`- Lucro/prejuízo: ${report.observabilidade.session.lucroPrejuizoSessao != null ? `R$ ${Number(report.observabilidade.session.lucroPrejuizoSessao).toFixed(2)}` : '—'}`);
      lines.push(`- Temperatura atual: ${report.observabilidade.session.live?.ultimaTemperatura || '—'}`);
      lines.push(`- Recomendação operacional: ${report.observabilidade.session.live?.ultimaSugestaoOperacional || '—'}`);
      lines.push(`- Stake sugerida: ${report.observabilidade.session.live?.ultimaStakeSugerida?.valor != null ? `R$ ${Number(report.observabilidade.session.live.ultimaStakeSugerida.valor).toFixed(2)}` : '—'}`);
      lines.push('');

      if (Array.isArray(report.observabilidade.session.strategyMetrics) && report.observabilidade.session.strategyMetrics.length) {
        lines.push('### Estratégias na sessão');
        lines.push('');
        report.observabilidade.session.strategyMetrics.slice(0, 5).forEach((metric) => {
          lines.push(`- ${metric.nome}: ${metric.disparou} disparos | ${metric.taxaAcerto}% acerto | robustez ${metric.scoreRobustez}`);
        });
        lines.push('');
      }

      if (report.observabilidade.operatorProfile) {
        const profile = report.observabilidade.operatorProfile;
        lines.push('### Perfil do operador');
        lines.push('');
        lines.push(`- Labels: ${(profile.labels || []).join(', ') || '—'}`);
        lines.push(`- Adesão ao robô: ${profile.taxaAdesaoAoRobo ?? 0}%`);
        lines.push(`- Win seguindo o robô: ${profile.taxaWinQuandoSegue ?? 0}%`);
        lines.push(`- Win indo contra: ${profile.taxaWinQuandoVaiContra ?? 0}%`);
        lines.push(`- Frequência de no-trade: ${profile.frequenciaNoTrade ?? 0}%`);
        lines.push('');
      }

      if (Array.isArray(report.observabilidade.recommendations) && report.observabilidade.recommendations.length) {
        lines.push('### Recomendações geradas');
        lines.push('');
        report.observabilidade.recommendations.slice(0, 5).forEach((item) => {
          lines.push(`- ${item.titulo}: ${item.evidencia}`);
        });
        lines.push('');
      }

      if (report.observabilidade.windows) {
        lines.push('### Janelas');
        lines.push('');
        ['24h', '7d', '30d'].forEach((windowKey) => {
          const bucket = report.observabilidade.windows?.[windowKey];
          if (!bucket) return;
          lines.push(`- ${windowKey}: ${bucket.totalRodadas} rodadas | ${bucket.totalEntradas} entradas | mesa favorável ${bucket.contextos?.favoravel ?? 0} | mesa ruim ${bucket.contextos?.ruim ?? 0}`);
        });
        lines.push('');
      }
    }

    lines.push('## Detalhe por rodada');
    lines.push('');

    if (!report.detalhePorRodada.length) {
      lines.push('- Sem entradas registradas.');
    } else {
      report.detalhePorRodada.forEach((entry) => {
        const _icone = entry.statusFinal === 'win' ? '✅' : (entry.statusFinal === 'loss' ? '❌' : '⚠️');
        const _indicada = ENTRY_LABELS[entry.entradaSugerida || entry.entradaExecutada] || entry.entradaSugerida || entry.entradaExecutada || '—';
        const _mesa     = ENTRY_LABELS[entry.resultadoRodada] || entry.resultadoRodada || '—';
        const _status   = entry.statusFinal ? `${_icone} ${entry.statusFinal.toUpperCase()}` : '—';
        lines.push(`### Rodada ${entry.roundId || '—'}`);
        lines.push(`> **Indicada:** ${_indicada} | **Mesa:** ${_mesa} | **Resultado:** ${_status}`);
        lines.push('');
        lines.push(`- Estratégia: ${entry.estrategia || '—'}`);
        lines.push(`- Origem: ${entry.origem || '—'}`);
        lines.push(`- Sequência: ${entry.sequenciaReconhecida || '—'}`);
        lines.push(`- Entrada sugerida: ${entry.entradaSugerida || '—'}`);
        lines.push(`- Entrada executada: ${entry.entradaExecutada || '—'}`);
        lines.push(`- Tipo: ${entry.tipoEntrada || '—'}`);
        lines.push(`- Stake: ${entry.stake}`);
        lines.push(`- Gale: ${entry.gale}`);
        lines.push(`- Proteção de empate: ${entry.protecaoEmpate ? 'Sim' : 'Não'}`);
        lines.push(`- Status de execução: ${entry.statusExecucao || '—'}`);
        lines.push(`- Resultado da rodada: ${entry.resultadoRodada || '—'}`);
        lines.push(`- Status final: ${entry.statusFinal || '—'}`);
        lines.push(`- Mesa: ${entry.contextoMesa || '—'} • risco ${entry.riscoOperacional || '—'} • confirmações ${entry.confirmacoes ?? '—'}`);
        lines.push(`- Justificativa: ${entry.justificativa || '—'}`);
        lines.push(`- Timestamp: ${entry.timestamp ? new Date(entry.timestamp).toISOString() : '—'}`);
        lines.push('');
      });
    }

    if (report.eventosImportantes.length) {
      lines.push('## Eventos importantes');
      lines.push('');
      report.eventosImportantes.forEach((event) => {
        lines.push(`- [${new Date(event.timestamp).toISOString()}] ${event.statusExecucao || 'evento'} | rodada ${event.roundId || '—'} | ${event.inconsistencias.join(' | ') || event.resultadoRodada || 'sem detalhe'}`);
      });
      lines.push('');
    }

    return lines.join('\n');
  }

  function push(event) {
    const sanitized = sanitizeEvent(event);
    nativePush.call(telemetryArray, sanitized);
    return sanitized;
  }

  function exportTelemetry(limit = 50) {
    const size = Number.isFinite(Number(limit)) ? Number(limit) : 50;
    return JSON.stringify(telemetryArray.slice(-size), null, 2);
  }

  function exportTelemetrySummary(limit = 20) {
    const size = Number.isFinite(Number(limit)) ? Number(limit) : 20;
    const observability = root.ObservabilityEngine?.getSnapshot?.() || null;
    const entradas = getEntradasOperacionais(size);

    if (entradas.length > 0) {
      return JSON.stringify(entradas.map((entry) => buildRoundSummary(entry)).slice(-size), null, 2);
    }

    if (Array.isArray(observability?.session?.rounds) && observability.session.rounds.length > 0) {
      const rounds = observability.session.rounds.slice(-size).map((round) => ({
        roundId: round.roundId || null,
        estrategia: round.decision?.estrategia || null,
        entrada: round.entry?.entradaExecutada || round.decision?.entradaSugerida || null,
        tipoEntrada: round.entry?.tipoEntrada || null,
        gale: round.entry?.gale ?? round.decision?.gale ?? null,
        execucao: round.entry?.statusExecucao || round.classification || null,
        resultado: round.result?.vencedor || round.result?.cor || null,
        statusFinal: round.entry?.statusFinal || null,
        contextoMesa: round.decision?.canonical?.tableContext || null,
        riscoOperacional: round.decision?.canonical?.operationalRisk || null,
        confirmacoes: round.decision?.canonical?.matrixConfirmations ?? null,
        statusDecisao: round.decision?.canonical?.decisionStatus || null,
        justificativa: round.decision?.canonical?.reasons?.[0] || null,
        temperatura: round.recommendation?.temperatura || null,
        recomendacao: round.recommendation?.texto || null,
        stakeSugerida: round.decision?.stakeSugerida?.valor ?? null,
        timestamp: round.updatedAt || round.createdAt || Date.now()
      }));
      return JSON.stringify(rounds, null, 2);
    }

    const summaries = [];
    const byRound = new Map();
    telemetryArray.forEach((event, index) => {
      const key = event.roundId || `sem-round-${index}`;
      if (!byRound.has(key)) {
        byRound.set(key, {
          roundId: key,
          estrategia: null,
          entrada: null,
          tipoEntrada: null,
          gale: null,
          execucao: null,
          resultado: null,
          statusFinal: null,
          timestamp: event.timestamp || Date.now()
        });
      }
      const summary = byRound.get(key);
      summary.timestamp = event.timestamp || summary.timestamp;
      summary.estrategia = event.estrategiaDetectada || summary.estrategia;
      summary.entrada = event.entradaExecutada || event.alvoAposta || event.entradaSugerida || summary.entrada;
      summary.tipoEntrada = event.tipoEntrada || summary.tipoEntrada;
      summary.gale = event.gale ?? summary.gale;
      summary.execucao = event.statusExecucao || summary.execucao;
      summary.resultado = event.resultadoRodada || summary.resultado;
      summary.statusFinal = event.statusFinal || summary.statusFinal;
    });
    byRound.forEach((summary) => summaries.push(summary));
    return JSON.stringify(summaries.slice(-size), null, 2);
  }

  function exportSession(limit = 100) {
    return JSON.stringify(buildSessionReportData(limit), null, 2);
  }

  if (!telemetryArray.__bbPatchedPush) {
    Object.defineProperty(telemetryArray, '__bbPatchedPush', {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false
    });

    telemetryArray.push = function(...events) {
      let length = telemetryArray.length;
      events.forEach((event) => {
        const sanitized = sanitizeEvent(event);
        length = nativePush.call(telemetryArray, sanitized);
      });
      return length;
    };
  }

  root.exportTelemetry = exportTelemetry;
  root.exportTelemetrySummary = exportTelemetrySummary;
  root.exportSession = exportSession;
  root.exportSessionMarkdown = buildSessionMarkdown;

  return {
    push,
    exportTelemetry,
    exportTelemetrySummary,
    exportSession,
    buildSessionReportData,
    buildSessionMarkdown,
    getAll() {
      return [...telemetryArray];
    }
  };
})();

globalThis.BBTelemetry = BBTelemetry;
