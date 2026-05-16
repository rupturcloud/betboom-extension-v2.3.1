/**
 * BetBoom Auto Pattern — Round Lifecycle (FSM + Event Sourcing)
 *
 * Modulo central que formaliza o ciclo de vida de uma rodada do Bac Bo:
 * inicio, fases, duracao, encerramento e telemetria. Hoje o estado da rodada
 * estava espalhado em `content.js` (parser -> mapearEstado) e cada modulo
 * lia por conta propria. Este modulo centraliza tudo via pub/sub.
 *
 * FSM canonico:
 *   OFF -> OBSERVING -> APOSTANDO -> FECHADO -> JOGANDO -> RESULTADO -> ENCERRADA -> OBSERVING
 *
 * Estados originais do parser do Bac Bo:
 *   - 'apostando'  : janela de apostas aberta  (WaitingForBets)
 *   - 'fechado'    : janela fechando           (ClosingBets)
 *   - 'jogando'    : dados rolando             (AcceptingBets, ButtonPressCheck,
 *                                               FirstDie, SecondDie, ThirdDie, FourthDie)
 *   - 'resultado'  : confirmacao do resultado  (Confirmation)
 *   - 'Resolved'   : rodada finalizada
 *
 * Modelo de estado:
 *   - state: 'idle' | 'active' | 'closed'   (status global da rodada)
 *   - phase: <nome FSM>                      (fase corrente dentro da rodada)
 *
 * API publica:
 *
 *   RoundLifecycle.configure({ eventStore, thresholds?, logLevel? })
 *     Configura dependencias externas (DI). EventStore opcional; se ausente,
 *     o modulo continua funcionando apenas com pub/sub interno.
 *
 *   RoundLifecycle.start(roundId, metadata?)
 *     Inicia uma nova rodada. Se a rodada ja existir com fase ativa, NAO reabre
 *     e emite anomalia `start_duplicado`.
 *
 *   RoundLifecycle.transition(roundId, novoEstado, metadata?)
 *     Transicao de fase. NAO cria rodada implicita: se roundId desconhecido,
 *     emite anomalia `transition_orfan` e retorna null.
 *
 *   RoundLifecycle.end(roundId, resultado?)
 *     Encerra rodada. NAO cria rodada implicita: se roundId desconhecido,
 *     emite anomalia `end_sobre_rodada_inexistente` e retorna null.
 *
 *   RoundLifecycle.forceClose(roundId, motivo)
 *     Forca o encerramento de uma rodada (closeReason: 'forced'). Emite
 *     `round_end` com flag forced=true.
 *
 *   RoundLifecycle.subscribe(evento, callback) -> unsubscribe()
 *     Inscreve-se em eventos. Eventos disponiveis:
 *       - 'lifecycle_event' : evento generico de transicao (com seq)
 *       - 'round_start'     : rodada iniciada
 *       - 'phase_change'    : mudanca de fase
 *       - 'round_end'       : rodada encerrada
 *       - 'round_anomaly'   : anomalia detectada
 *
 *   RoundLifecycle.getRoundStats(roundId)
 *   RoundLifecycle.getAggregateStats(n = 50)
 *   RoundLifecycle.getCurrentRound()       -> { roundId, phase, startedAt } | null
 *   RoundLifecycle.getPhaseElapsedMs(roundId)
 *   RoundLifecycle.getRecentRounds(n = 20)
 *
 * Requisitos:
 *   - Logs com prefixo [RoundLifecycle]
 *   - Nao chama DOM nem outros modulos do projeto (mantem isolado)
 *   - Tolerante a chamadas fora de ordem (sem criar rodada implicita)
 *   - Schema versionado nos payloads (v: 1)
 */

const RoundLifecycle = (() => {
  // ---------------------------------------------------------------------------
  // Constantes
  // ---------------------------------------------------------------------------

  // Versao de schema dos payloads emitidos (round_start/phase_change/round_end/anomaly)
  const SCHEMA_VERSION = 1;

  // Estados globais (state machine de mais alto nivel)
  const STATES = Object.freeze({
    IDLE: 'idle',
    ACTIVE: 'active',
    CLOSED: 'closed'
  });

  // Estados FSM canonicos (fases dentro de uma rodada)
  const ESTADOS = Object.freeze({
    OFF: 'OFF',
    OBSERVING: 'OBSERVING',
    APOSTANDO: 'APOSTANDO',
    FECHADO: 'FECHADO',
    JOGANDO: 'JOGANDO',
    RESULTADO: 'RESULTADO',
    ENCERRADA: 'ENCERRADA'
  });

  // Mapeamento de estados do parser -> estados FSM
  // Aceita tanto os normalizados (apostando/fechado/jogando/resultado) quanto
  // os brutos do provedor (WaitingForBets, Confirmation, Resolved, etc.).
  const MAPA_PARSER = Object.freeze({
    // normalizados
    apostando: ESTADOS.APOSTANDO,
    fechado: ESTADOS.FECHADO,
    jogando: ESTADOS.JOGANDO,
    resultado: ESTADOS.RESULTADO,
    // brutos
    WaitingForBets: ESTADOS.APOSTANDO,
    ClosingBets: ESTADOS.FECHADO,
    AcceptingBets: ESTADOS.JOGANDO,
    ButtonPressCheck: ESTADOS.JOGANDO,
    FirstDie: ESTADOS.JOGANDO,
    SecondDie: ESTADOS.JOGANDO,
    ThirdDie: ESTADOS.JOGANDO,
    FourthDie: ESTADOS.JOGANDO,
    Confirmation: ESTADOS.RESULTADO,
    Resolved: ESTADOS.ENCERRADA
  });

  // Fases consideradas "ativas" (rodada aberta, recebendo transicoes)
  const FASES_ATIVAS = Object.freeze([
    ESTADOS.APOSTANDO,
    ESTADOS.FECHADO,
    ESTADOS.JOGANDO,
    ESTADOS.RESULTADO
  ]);

  // Transicoes validas (origem -> destinos permitidos)
  const TRANSICOES_VALIDAS = Object.freeze({
    [ESTADOS.OFF]:       [ESTADOS.OBSERVING, ESTADOS.APOSTANDO],
    [ESTADOS.OBSERVING]: [ESTADOS.APOSTANDO, ESTADOS.JOGANDO, ESTADOS.RESULTADO],
    [ESTADOS.APOSTANDO]: [ESTADOS.FECHADO, ESTADOS.JOGANDO],
    [ESTADOS.FECHADO]:   [ESTADOS.JOGANDO],
    [ESTADOS.JOGANDO]:   [ESTADOS.RESULTADO],
    [ESTADOS.RESULTADO]: [ESTADOS.ENCERRADA, ESTADOS.OBSERVING],
    [ESTADOS.ENCERRADA]: [ESTADOS.OBSERVING, ESTADOS.APOSTANDO]
  });

  // Thresholds de anomalia (ms). Mutavel via configure().
  let THRESHOLDS = {
    apostandoMaxMs: 30_000,   // esperado ~12s
    jogandoMaxMs: 20_000,     // esperado ~10s
    semTransicaoMaxMs: 60_000 // sem transicao por mais de 60s
  };

  // Limite de rodadas mantidas em memoria (FIFO)
  const LIMITE_RODADAS = 200;

  // Intervalo de varredura para anomalia de "rodada parada"
  const INTERVALO_WATCHDOG_MS = 5_000;

  // Eventos suportados
  const EVENTOS = Object.freeze({
    LIFECYCLE_EVENT: 'lifecycle_event',
    ROUND_START: 'round_start',
    PHASE_CHANGE: 'phase_change',
    ROUND_END: 'round_end',
    ROUND_ANOMALY: 'round_anomaly'
  });

  // ---------------------------------------------------------------------------
  // Estado interno
  // ---------------------------------------------------------------------------

  // Map<roundId, Rodada>
  // Rodada = {
  //   roundId, state, phase, fases: [Fase], faseAtual, t0, t1, resultado,
  //   ultimaAtividade, anomalias, metadata, closeReason, forced
  // }
  // Fase = { nome, t0, t1, duracaoMs, metadata }
  const rodadas = new Map();

  // Fila de ordem de insercao para FIFO (roundId em ordem)
  const ordemInsercao = [];

  // roundId da rodada atualmente ativa (nao encerrada)
  let rodadaAtualId = null;

  // Pub/Sub: Map<evento, Set<callback>>
  const inscritos = new Map();
  Object.values(EVENTOS).forEach(ev => inscritos.set(ev, new Set()));

  // Handle do watchdog (setInterval)
  let watchdogHandle = null;

  // EventStore injetado via configure()
  let eventStore = null;

  // Nivel de log (info | warn | silent). Padrao info.
  let logLevel = 'info';

  // ---------------------------------------------------------------------------
  // Helpers privados
  // ---------------------------------------------------------------------------

  function log(...args) {
    if (logLevel === 'silent') return;
    if (typeof console !== 'undefined' && console.log) {
      console.log('[RoundLifecycle]', ...args);
    }
  }

  function warn(...args) {
    if (logLevel === 'silent') return;
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[RoundLifecycle]', ...args);
    }
  }

  function agora() {
    return Date.now();
  }

  /**
   * Mapeia estado bruto do parser para estado FSM canonico.
   * Retorna null se desconhecido.
   */
  function mapearEstado(estadoBruto) {
    if (estadoBruto == null) return null;
    return MAPA_PARSER[estadoBruto] || null;
  }

  /**
   * Verifica se uma transicao e valida no FSM.
   */
  function transicaoValida(estadoOrigem, estadoDestino) {
    if (!estadoOrigem) return true; // sem origem, qualquer destino e aceito
    if (estadoOrigem === estadoDestino) return true; // re-entrada na mesma fase e tolerada
    const destinosOk = TRANSICOES_VALIDAS[estadoOrigem] || [];
    return destinosOk.includes(estadoDestino);
  }

  /**
   * Persiste evento no EventStore (fire-and-forget). Falhas nao bloqueiam.
   */
  function persistirNoEventStore(type, payload) {
    if (!eventStore || typeof eventStore.append !== 'function') return null;
    try {
      const r = eventStore.append(type, payload);
      // Suporta retorno sincrono { seq, persistedAt } ou Promise dessas chaves.
      if (r && typeof r.then === 'function') {
        r.catch(err => warn('EventStore.append rejeitou:', err));
        return null;
      }
      return r || null;
    } catch (err) {
      warn('EventStore.append lancou excecao:', err);
      return null;
    }
  }

  /**
   * Emite um evento para todos os inscritos.
   * Erros em callbacks sao isolados (nao quebram a cadeia).
   */
  function emitir(evento, payload) {
    const setCbs = inscritos.get(evento);
    if (!setCbs || setCbs.size === 0) return;
    for (const cb of setCbs) {
      try {
        cb(payload);
      } catch (err) {
        warn(`Callback do evento "${evento}" lancou excecao:`, err);
      }
    }
  }

  /**
   * Emite evento + persiste no EventStore (se configurado), retornando seq.
   * Para eventos com payload versionado (v: 1).
   */
  function emitirEPersistir(evento, payload) {
    const persisted = persistirNoEventStore(evento, payload);
    const seq = persisted && typeof persisted.seq !== 'undefined' ? persisted.seq : null;
    const payloadFinal = seq != null ? { ...payload, seq } : payload;
    emitir(evento, payloadFinal);
    return { seq, payload: payloadFinal };
  }

  /**
   * Emite um lifecycle_event canonico (espelho de cada transicao) + persiste.
   */
  function emitirLifecycleEvent({ roundId, fromPhase, toPhase, kind, metadata }) {
    const payload = {
      v: SCHEMA_VERSION,
      roundId,
      fromPhase: fromPhase || null,
      toPhase: toPhase || null,
      ts: agora(),
      kind,
      metadata: metadata ? { ...metadata } : {}
    };
    return emitirEPersistir(EVENTOS.LIFECYCLE_EVENT, payload);
  }

  /**
   * Garante FIFO: se excedeu o limite, remove a rodada mais antiga.
   */
  function aplicarLimiteFIFO() {
    while (ordemInsercao.length > LIMITE_RODADAS) {
      const idRemovido = ordemInsercao.shift();
      rodadas.delete(idRemovido);
    }
  }

  /**
   * Cria estrutura interna de uma nova rodada.
   */
  function criarRodada(roundId, metadata) {
    const t = agora();
    const rodada = {
      roundId,
      state: STATES.IDLE,
      phase: ESTADOS.OBSERVING,
      fases: [],
      faseAtual: null,
      t0: t,
      t1: null,
      resultado: null,
      ultimaAtividade: t,
      anomalias: [],
      metadata: metadata ? { ...metadata } : {},
      closeReason: null,
      forced: false
    };
    rodadas.set(roundId, rodada);
    ordemInsercao.push(roundId);
    aplicarLimiteFIFO();
    return rodada;
  }

  /**
   * Finaliza a fase atual (caso exista) preenchendo t1 e duracaoMs.
   */
  function fecharFaseAtual(rodada, tFim) {
    if (!rodada.faseAtual) return;
    const fase = rodada.faseAtual;
    fase.t1 = tFim;
    fase.duracaoMs = tFim - fase.t0;
    rodada.fases.push(fase);
    rodada.faseAtual = null;
  }

  /**
   * Abre uma nova fase na rodada. NAO sobrescreve `state`: apenas atualiza `phase`.
   */
  function abrirFase(rodada, nome, metadata) {
    const t = agora();
    fecharFaseAtual(rodada, t);
    rodada.faseAtual = {
      nome,
      t0: t,
      t1: null,
      duracaoMs: null,
      metadata: metadata ? { ...metadata } : {}
    };
    rodada.phase = nome;
    // Se for fase ativa do jogo, marca state=active
    if (FASES_ATIVAS.includes(nome)) {
      rodada.state = STATES.ACTIVE;
    }
    rodada.ultimaAtividade = t;
  }

  /**
   * Registra anomalia na rodada e emite evento.
   */
  function registrarAnomalia(rodada, tipo, detalhes) {
    const ts = agora();
    const faseNoMomento = rodada && rodada.faseAtual
      ? rodada.faseAtual.nome
      : (rodada ? rodada.phase : null);
    const anomalia = {
      tipo,
      detalhes: detalhes || {},
      t: ts,
      faseNoMomento
    };
    if (rodada) {
      rodada.anomalias.push(anomalia);
    }
    warn(`Anomalia "${tipo}" na rodada ${rodada ? rodada.roundId : '<sem rodada>'}:`, anomalia);

    const payload = {
      v: SCHEMA_VERSION,
      roundId: rodada ? rodada.roundId : null,
      tipo,
      detalhes: detalhes || {},
      ts,
      faseNoMomento
    };
    emitirEPersistir(EVENTOS.ROUND_ANOMALY, payload);
  }

  /**
   * Checa se a fase atual ultrapassou seu threshold de duracao.
   */
  function checarAnomaliasDeFase(rodada) {
    if (!rodada.faseAtual) return;
    const agoraMs = agora();
    const duracao = agoraMs - rodada.faseAtual.t0;

    if (rodada.faseAtual.nome === ESTADOS.APOSTANDO && duracao > THRESHOLDS.apostandoMaxMs) {
      const jaTem = rodada.anomalias.some(a => a.tipo === 'fase_apostando_longa');
      if (!jaTem) {
        registrarAnomalia(rodada, 'fase_apostando_longa', { duracaoMs: duracao });
      }
    }

    if (rodada.faseAtual.nome === ESTADOS.JOGANDO && duracao > THRESHOLDS.jogandoMaxMs) {
      const jaTem = rodada.anomalias.some(a => a.tipo === 'fase_jogando_longa');
      if (!jaTem) {
        registrarAnomalia(rodada, 'fase_jogando_longa', { duracaoMs: duracao });
      }
    }
  }

  /**
   * Watchdog: roda periodicamente verificando rodada parada e anomalias de fase.
   */
  function watchdogTick() {
    if (!rodadaAtualId) {
      // Sem rodada ativa, para o watchdog (sob demanda).
      pararWatchdog();
      return;
    }
    const rodada = rodadas.get(rodadaAtualId);
    if (!rodada || rodada.state === STATES.CLOSED) {
      pararWatchdog();
      return;
    }

    const agoraMs = agora();
    const idleMs = agoraMs - rodada.ultimaAtividade;
    if (idleMs > THRESHOLDS.semTransicaoMaxMs) {
      const jaTem = rodada.anomalias.some(a => a.tipo === 'rodada_sem_transicao');
      if (!jaTem) {
        registrarAnomalia(rodada, 'rodada_sem_transicao', { idleMs });
      }
    }

    checarAnomaliasDeFase(rodada);
  }

  function iniciarWatchdog() {
    if (watchdogHandle != null) return;
    if (typeof setInterval !== 'function') return;
    watchdogHandle = setInterval(watchdogTick, INTERVALO_WATCHDOG_MS);
  }

  function pararWatchdog() {
    if (watchdogHandle == null) return;
    if (typeof clearInterval === 'function') {
      clearInterval(watchdogHandle);
    }
    watchdogHandle = null;
  }

  /**
   * Calcula stats agregadas (media) considerando rodadas encerradas.
   */
  function calcularMedia(valores) {
    if (!valores.length) return 0;
    const soma = valores.reduce((acc, v) => acc + v, 0);
    return Math.round(soma / valores.length);
  }

  /**
   * Soma a duracao de todas as fases de um nome especifico em uma rodada.
   */
  function somaDuracaoFase(rodada, nomeFase) {
    return rodada.fases
      .filter(f => f.nome === nomeFase)
      .reduce((acc, f) => acc + (f.duracaoMs || 0), 0);
  }

  /**
   * Retorna copia segura (sem expor referencias internas mutaveis).
   */
  function clonarRodada(rodada) {
    if (!rodada) return null;
    return {
      roundId: rodada.roundId,
      state: rodada.state,
      phase: rodada.phase,
      t0: rodada.t0,
      t1: rodada.t1,
      duracaoTotalMs: rodada.t1 ? rodada.t1 - rodada.t0 : null,
      fases: rodada.fases.map(f => ({ ...f, metadata: { ...(f.metadata || {}) } })),
      faseAtual: rodada.faseAtual
        ? { ...rodada.faseAtual, metadata: { ...(rodada.faseAtual.metadata || {}) } }
        : null,
      resultado: rodada.resultado,
      anomalias: rodada.anomalias.map(a => ({ ...a })),
      metadata: { ...(rodada.metadata || {}) },
      closeReason: rodada.closeReason,
      forced: !!rodada.forced
    };
  }

  /**
   * Monta payload de fases para o round_end (inclui fase aberta, se houver).
   */
  function montarFasesParaEncerramento(rodada) {
    const fases = rodada.fases.map(f => ({
      nome: f.nome,
      t0: f.t0,
      t1: f.t1,
      duracaoMs: f.duracaoMs
    }));
    return fases;
  }

  /**
   * Implementacao interna do encerramento (compartilhada por end() e forceClose()).
   */
  function encerrarRodada(rodada, { resultado, forced, closeReason }) {
    const t = agora();
    fecharFaseAtual(rodada, t);
    rodada.state = STATES.CLOSED;
    rodada.phase = ESTADOS.ENCERRADA;
    rodada.t1 = t;
    rodada.resultado = resultado != null ? resultado : rodada.resultado;
    rodada.ultimaAtividade = t;
    rodada.forced = !!forced;
    rodada.closeReason = closeReason || (forced ? 'forced' : 'natural');

    if (rodadaAtualId === rodada.roundId) {
      rodadaAtualId = null;
      pararWatchdog();
    }

    log(`Rodada encerrada: ${rodada.roundId} (duracao total: ${rodada.t1 - rodada.t0}ms, motivo: ${rodada.closeReason})`);

    // Lifecycle event canonico
    emitirLifecycleEvent({
      roundId: rodada.roundId,
      fromPhase: rodada.fases.length ? rodada.fases[rodada.fases.length - 1].nome : null,
      toPhase: ESTADOS.ENCERRADA,
      kind: 'round_end',
      metadata: { forced: !!forced, closeReason: rodada.closeReason }
    });

    // Evento round_end versionado
    const endPayload = {
      v: SCHEMA_VERSION,
      roundId: rodada.roundId,
      outcome: rodada.resultado,
      t0: rodada.t0,
      t1: rodada.t1,
      duracaoTotalMs: rodada.t1 - rodada.t0,
      fases: montarFasesParaEncerramento(rodada),
      anomalias: rodada.anomalias.map(a => ({ ...a })),
      forced: !!forced,
      closeReason: rodada.closeReason
    };
    return emitirEPersistir(EVENTOS.ROUND_END, endPayload);
  }

  // ---------------------------------------------------------------------------
  // API publica
  // ---------------------------------------------------------------------------

  return {
    // Expoe constantes para consumo externo (somente leitura)
    ESTADOS,
    STATES,
    EVENTOS,
    SCHEMA_VERSION,
    get THRESHOLDS() { return { ...THRESHOLDS }; },

    /**
     * Configura dependencias externas (DI). Backward compat: opcional.
     *
     * @param {Object} cfg
     * @param {Object} [cfg.eventStore] - { append(type, payload) -> {seq, persistedAt} }
     * @param {Object} [cfg.thresholds] - sobrescreve thresholds parcialmente
     * @param {string} [cfg.logLevel]   - 'info' | 'warn' | 'silent'
     */
    configure(cfg) {
      if (!cfg || typeof cfg !== 'object') {
        warn('configure() requer um objeto de configuracao.');
        return;
      }
      if (cfg.eventStore !== undefined) {
        if (cfg.eventStore === null) {
          eventStore = null;
        } else if (typeof cfg.eventStore.append === 'function') {
          eventStore = cfg.eventStore;
          log('EventStore conectado via configure().');
        } else {
          warn('configure({ eventStore }) ignorado: append() ausente.');
        }
      }
      if (cfg.thresholds && typeof cfg.thresholds === 'object') {
        THRESHOLDS = { ...THRESHOLDS, ...cfg.thresholds };
      }
      if (typeof cfg.logLevel === 'string') {
        logLevel = cfg.logLevel;
      }
    },

    /**
     * Inicia uma nova rodada.
     * - Se ja existir rodada anterior nao encerrada (com roundId diferente),
     *   essa rodada e encerrada implicitamente com closeReason='superseded'.
     * - Se a propria rodada ja existir e estiver em fase ativa, emite anomalia
     *   `start_duplicado` e NAO reabre.
     */
    start(roundId, metadata) {
      if (roundId == null || roundId === '') {
        warn('start() chamado sem roundId valido. Ignorando.');
        return null;
      }

      // Encerra rodada anterior se ainda estiver ativa (roundId diferente)
      if (rodadaAtualId && rodadaAtualId !== roundId) {
        const anterior = rodadas.get(rodadaAtualId);
        if (anterior && anterior.state !== STATES.CLOSED) {
          registrarAnomalia(anterior, 'encerrada_implicitamente_por_nova_rodada', {
            novaRoundId: roundId
          });
          encerrarRodada(anterior, {
            resultado: null,
            forced: false,
            closeReason: 'superseded'
          });
        }
      }

      let rodada = rodadas.get(roundId);
      if (rodada) {
        // Se ja existe e esta em fase ativa, NAO reabrir
        const faseCorrente = rodada.faseAtual ? rodada.faseAtual.nome : rodada.phase;
        const emFaseAtiva = rodada.state === STATES.ACTIVE
          || FASES_ATIVAS.includes(faseCorrente);
        if (emFaseAtiva && rodada.state !== STATES.CLOSED) {
          registrarAnomalia(rodada, 'start_duplicado', {
            faseCorrente,
            state: rodada.state
          });
          return clonarRodada(rodada);
        }
        // Se ja foi fechada, tambem nao reabre (evita reuso de id)
        if (rodada.state === STATES.CLOSED) {
          registrarAnomalia(rodada, 'start_em_rodada_fechada', {
            closeReason: rodada.closeReason
          });
          return clonarRodada(rodada);
        }
        // Caso state=idle: atualiza metadata e segue
        if (metadata) {
          rodada.metadata = { ...rodada.metadata, ...metadata };
        }
      } else {
        rodada = criarRodada(roundId, metadata);
      }

      // Por convencao, start coloca em APOSTANDO (inicio da janela de apostas)
      const faseAnterior = rodada.faseAtual ? rodada.faseAtual.nome : null;
      abrirFase(rodada, ESTADOS.APOSTANDO, metadata);
      rodadaAtualId = roundId;
      iniciarWatchdog();

      log(`Rodada iniciada: ${roundId}`);

      // Lifecycle event canonico
      emitirLifecycleEvent({
        roundId,
        fromPhase: faseAnterior,
        toPhase: ESTADOS.APOSTANDO,
        kind: 'round_start',
        metadata: rodada.metadata
      });

      // Evento round_start versionado
      emitirEPersistir(EVENTOS.ROUND_START, {
        v: SCHEMA_VERSION,
        roundId,
        t0: rodada.t0,
        metadata: { ...(rodada.metadata || {}) }
      });

      return clonarRodada(rodada);
    },

    /**
     * Registra transicao de fase. NAO cria rodada implicita:
     * se roundId desconhecido, emite anomalia `transition_orfan` e retorna null.
     */
    transition(roundId, novoEstado, metadata) {
      if (roundId == null || roundId === '') {
        warn('transition() chamado sem roundId valido. Ignorando.');
        return null;
      }

      const estadoCanonico = mapearEstado(novoEstado) || novoEstado;
      if (!Object.values(ESTADOS).includes(estadoCanonico)) {
        warn(`Estado desconhecido recebido em transition: "${novoEstado}". Ignorando.`);
        return null;
      }

      const rodada = rodadas.get(roundId);
      if (!rodada) {
        // P0: nao criar rodada implicita; emitir anomalia orfan
        registrarAnomalia(null, 'transition_orfan', {
          roundId,
          tentativaFase: estadoCanonico,
          estadoRecebido: novoEstado
        });
        return null;
      }

      // Se a rodada ja foi encerrada, ignora novas transicoes
      if (rodada.state === STATES.CLOSED) {
        warn(`transition() em rodada ja encerrada (${roundId}). Ignorando.`);
        return clonarRodada(rodada);
      }

      const estadoAnterior = rodada.faseAtual ? rodada.faseAtual.nome : rodada.phase;

      // Valida transicao (mas nao bloqueia: apenas registra anomalia)
      if (!transicaoValida(estadoAnterior, estadoCanonico)) {
        registrarAnomalia(rodada, 'transicao_invalida', {
          de: estadoAnterior,
          para: estadoCanonico
        });
      }

      // Se o estado de destino e ENCERRADA, delega para end()
      if (estadoCanonico === ESTADOS.ENCERRADA) {
        return this.end(roundId, metadata && metadata.resultado);
      }

      // Mesma fase: apenas atualiza atividade
      if (estadoAnterior === estadoCanonico) {
        rodada.ultimaAtividade = agora();
        return clonarRodada(rodada);
      }

      abrirFase(rodada, estadoCanonico, metadata);
      rodadaAtualId = roundId;
      iniciarWatchdog();

      log(`Rodada ${roundId}: ${estadoAnterior} -> ${estadoCanonico}`);

      // Lifecycle event canonico
      emitirLifecycleEvent({
        roundId,
        fromPhase: estadoAnterior,
        toPhase: estadoCanonico,
        kind: 'phase_change',
        metadata
      });

      // Evento phase_change versionado (mantido para compat com consumidores legados)
      emitirEPersistir(EVENTOS.PHASE_CHANGE, {
        v: SCHEMA_VERSION,
        roundId,
        de: estadoAnterior,
        para: estadoCanonico,
        t: rodada.faseAtual.t0,
        metadata: { ...(rodada.faseAtual.metadata || {}) }
      });

      return clonarRodada(rodada);
    },

    /**
     * Encerra a rodada com resultado final.
     * NAO cria rodada implicita: se roundId desconhecido, emite anomalia
     * `end_sobre_rodada_inexistente` e retorna null.
     */
    end(roundId, resultado) {
      if (roundId == null || roundId === '') {
        warn('end() chamado sem roundId valido. Ignorando.');
        return null;
      }

      const rodada = rodadas.get(roundId);
      if (!rodada) {
        // P0: nao cria rodada implicita; emite anomalia e retorna null
        registrarAnomalia(null, 'end_sobre_rodada_inexistente', {
          roundId,
          resultado: resultado != null ? resultado : null
        });
        return null;
      }

      if (rodada.state === STATES.CLOSED) {
        // ja encerrada — idempotente
        return clonarRodada(rodada);
      }

      encerrarRodada(rodada, {
        resultado,
        forced: false,
        closeReason: 'natural'
      });

      return clonarRodada(rodada);
    },

    /**
     * Forca o encerramento de uma rodada (closeReason='forced').
     * Util para casos de timeout/recuperacao externa.
     */
    forceClose(roundId, motivo) {
      if (roundId == null || roundId === '') {
        warn('forceClose() chamado sem roundId valido. Ignorando.');
        return null;
      }

      const rodada = rodadas.get(roundId);
      if (!rodada) {
        registrarAnomalia(null, 'forceclose_sobre_rodada_inexistente', {
          roundId,
          motivo: motivo || null
        });
        return null;
      }

      if (rodada.state === STATES.CLOSED) {
        return clonarRodada(rodada);
      }

      registrarAnomalia(rodada, 'rodada_forcada_a_encerrar', {
        motivo: motivo || null
      });

      encerrarRodada(rodada, {
        resultado: null,
        forced: true,
        closeReason: 'forced'
      });

      return clonarRodada(rodada);
    },

    /**
     * Inscreve callback em um evento. Retorna funcao para cancelar inscricao.
     */
    subscribe(evento, callback) {
      if (typeof callback !== 'function') {
        warn('subscribe() exige callback do tipo function.');
        return () => {};
      }
      if (!inscritos.has(evento)) {
        warn(`Evento desconhecido em subscribe: "${evento}". Eventos validos:`,
          Array.from(inscritos.keys()));
        return () => {};
      }
      const setCbs = inscritos.get(evento);
      setCbs.add(callback);
      return function unsubscribe() {
        setCbs.delete(callback);
      };
    },

    /**
     * Retorna estatisticas idempotentes de uma rodada especifica.
     */
    getRoundStats(roundId) {
      const rodada = rodadas.get(roundId);
      if (!rodada) return null;

      const fases = rodada.fases.map(f => ({
        nome: f.nome,
        t0: f.t0,
        t1: f.t1,
        duracaoMs: f.duracaoMs
      }));

      // Inclui fase atual ainda em andamento (se houver)
      if (rodada.faseAtual) {
        const tCorte = rodada.t1 || agora();
        fases.push({
          nome: rodada.faseAtual.nome,
          t0: rodada.faseAtual.t0,
          t1: rodada.faseAtual.t1 || tCorte,
          duracaoMs: (rodada.faseAtual.t1 || tCorte) - rodada.faseAtual.t0
        });
      }

      const t1 = rodada.t1 || agora();
      return {
        roundId: rodada.roundId,
        state: rodada.state,
        phase: rodada.phase,
        t0: rodada.t0,
        t1: rodada.t1,
        duracaoTotalMs: t1 - rodada.t0,
        fases,
        resultado: rodada.resultado,
        anomalias: rodada.anomalias.map(a => ({ ...a })),
        closeReason: rodada.closeReason,
        forced: !!rodada.forced
      };
    },

    /**
     * Retorna estatisticas agregadas das ultimas N rodadas encerradas.
     */
    getAggregateStats(n) {
      const limite = typeof n === 'number' && n > 0 ? n : 50;
      // Pega as ultimas rodadas encerradas (em ordem inversa de insercao)
      const encerradas = [];
      for (let i = ordemInsercao.length - 1; i >= 0 && encerradas.length < limite; i--) {
        const id = ordemInsercao[i];
        const r = rodadas.get(id);
        if (r && r.state === STATES.CLOSED) {
          encerradas.push(r);
        }
      }

      const duracoesTotais = encerradas
        .map(r => (r.t1 || 0) - r.t0)
        .filter(d => d > 0);
      const apostando = encerradas.map(r => somaDuracaoFase(r, ESTADOS.APOSTANDO)).filter(d => d > 0);
      const jogando = encerradas.map(r => somaDuracaoFase(r, ESTADOS.JOGANDO)).filter(d => d > 0);
      const resultadoFase = encerradas.map(r => somaDuracaoFase(r, ESTADOS.RESULTADO)).filter(d => d > 0);

      const totalAnomalias = encerradas.reduce((acc, r) => acc + r.anomalias.length, 0);
      const tiposAnomalias = {};
      encerradas.forEach(r => {
        r.anomalias.forEach(a => {
          tiposAnomalias[a.tipo] = (tiposAnomalias[a.tipo] || 0) + 1;
        });
      });

      return {
        amostra: encerradas.length,
        mediaDuracaoTotal: calcularMedia(duracoesTotais),
        mediaApostando: calcularMedia(apostando),
        mediaJogando: calcularMedia(jogando),
        mediaResultado: calcularMedia(resultadoFase),
        anomalias: {
          total: totalAnomalias,
          porTipo: tiposAnomalias
        }
      };
    },

    /**
     * Retorna a rodada atual ativa em shape compacto:
     * { roundId, phase, startedAt } | null.
     */
    getCurrentRound() {
      if (!rodadaAtualId) return null;
      const r = rodadas.get(rodadaAtualId);
      if (!r) return null;
      return {
        roundId: r.roundId,
        phase: r.faseAtual ? r.faseAtual.nome : r.phase,
        startedAt: r.t0
      };
    },

    /**
     * Retorna o tempo decorrido (ms) na fase atual da rodada, ou null
     * se a rodada nao existir ou nao houver fase aberta.
     */
    getPhaseElapsedMs(roundId) {
      const r = rodadas.get(roundId);
      if (!r || !r.faseAtual) return null;
      return agora() - r.faseAtual.t0;
    },

    /**
     * Lista as ultimas N rodadas (mais recentes primeiro).
     */
    getRecentRounds(n) {
      const limite = typeof n === 'number' && n > 0 ? n : 20;
      const out = [];
      for (let i = ordemInsercao.length - 1; i >= 0 && out.length < limite; i--) {
        const r = rodadas.get(ordemInsercao[i]);
        if (r) out.push(clonarRodada(r));
      }
      return out;
    }
  };
})();

/* -----------------------------------------------------------------------------
 * Exemplo de uso (referencia, nao executa):
 *
 * // (Opcional) Conectar EventStore via DI
 * RoundLifecycle.configure({
 *   eventStore: EventStore,
 *   thresholds: { apostandoMaxMs: 25_000 },
 *   logLevel: 'info'
 * });
 *
 * // Inscrever em eventos
 * RoundLifecycle.subscribe('lifecycle_event', e => {
 *   console.log('[lifecycle]', e.kind, e.fromPhase, '->', e.toPhase, 'seq=', e.seq);
 * });
 * RoundLifecycle.subscribe('round_start', e => console.log('Nova rodada:', e.roundId, e.t0));
 * RoundLifecycle.subscribe('phase_change', e => console.log(`Fase: ${e.de} -> ${e.para}`));
 * RoundLifecycle.subscribe('round_end', e => console.log('Encerrada:', e));
 * RoundLifecycle.subscribe('round_anomaly', e => console.warn('Anomalia:', e));
 *
 * // No parser do content.js, ao detectar nova rodada:
 * RoundLifecycle.start('round-123', { mesa: 'BacBo-01' });
 *
 * // A cada mudanca de estado mapeada:
 * RoundLifecycle.transition('round-123', 'fechado');
 * RoundLifecycle.transition('round-123', 'jogando');
 * RoundLifecycle.transition('round-123', 'resultado');
 *
 * // Ao confirmar resultado:
 * RoundLifecycle.end('round-123', { vencedor: 'red', placar: '7x5' });
 *
 * // Encerramento forcado (timeout, recuperacao externa):
 * RoundLifecycle.forceClose('round-123', 'timeout_externo');
 *
 * // Consultas:
 * RoundLifecycle.getRoundStats('round-123');
 * RoundLifecycle.getAggregateStats(50);
 * RoundLifecycle.getCurrentRound();        // { roundId, phase, startedAt }
 * RoundLifecycle.getPhaseElapsedMs('round-123');
 * RoundLifecycle.getRecentRounds(20);
 * -------------------------------------------------------------------------- */
