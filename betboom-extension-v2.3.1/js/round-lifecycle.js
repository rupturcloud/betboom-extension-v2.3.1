/**
 * BetBoom Auto Pattern — Round Lifecycle (Event Sourcing IDEMPOTENTE)
 *
 * FILOSOFIA (R99.5):
 *   A rodada SEMPRE existe (a banca rodou ela). O que pode variar é o
 *   REGISTRO da extensão sobre ela. Toda mensagem (start/transition/end)
 *   é um EVENTO que ENRIQUECE o registro — ninguém "cria" ou "destrói"
 *   rodadas. UPSERT idempotente: a mesma chamada N vezes = 1 vez.
 *
 *   Não importa a ordem de chegada dos eventos: o registro nasce no
 *   primeiro evento (qualquer um) e vai sendo preenchido pelos demais.
 *
 *   Fatos armazenados (são DADOS, não inferências):
 *     - t0Real          : timestamp do start observado (null = não vimos)
 *     - tFimReal        : timestamp do end observado (null = ainda rodando)
 *     - fasesObservadas : lista das fases que efetivamente vimos
 *
 *   Tudo o mais (completude da observação) é DERIVADO via
 *   `derivarObservacao(rodada)` — única fonte da verdade.
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
 *     R99.5: UPSERT idempotente. Marca t0Real. Sem ramo "existe vs não":
 *     pega ou cria o registro. Chamar N vezes = chamar 1.
 *
 *   RoundLifecycle.transition(roundId, novoEstado, metadata?)
 *     R99.5: UPSERT idempotente. Registra fase em fasesObservadas.
 *     Não pergunta se a rodada existe — ela sempre existe (vide filosofia).
 *
 *   RoundLifecycle.end(roundId, resultado?)
 *     R99.5: UPSERT idempotente. Marca tFimReal. Pode ser o PRIMEIRO
 *     evento da rodada (extensão entrou só pra ver o resultado) — segue
 *     funcionando. Histórico preservado independente da ordem.
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
 *   - Idempotente: chamadas repetidas ou fora de ordem não quebram nem
 *     duplicam estado. Banca é soberana, extensão é cronista subordinada.
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
   *
   * R99.5 — Campos de OBSERVAÇÃO REAL separados dos campos derivados:
   * - `t0Real`         : timestamp do start observado (null = não vimos início)
   * - `tFimReal`       : timestamp do end observado (null = não vimos fim)
   * - `fasesObservadas`: lista de fases que CHEGAMOS a presenciar
   *
   * Esses campos são FATOS. Tudo o mais (`state`, `phase`, flags de
   * observação parcial) é DERIVADO deles via `derivarObservacao()`.
   * Eventos chegam fora de ordem? Tudo bem — quem chega preenche o
   * que sabe, o registro vai sendo enriquecido. Idempotência total.
   */
  function criarRodada(roundId, metadata) {
    const t = agora();
    const rodada = {
      roundId,
      state: STATES.IDLE,
      phase: ESTADOS.OBSERVING,
      fases: [],
      faseAtual: null,
      t0: t,                  // timestamp da CRIAÇÃO do registro (primeiro evento)
      t0Real: null,           // R99.5: timestamp do start observado pela extensão
      t1: null,               // timestamp do encerramento do registro
      tFimReal: null,         // R99.5: timestamp do end observado pela extensão
      fasesObservadas: [],    // R99.5: nomes das fases que chegamos a ver
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
   * R99.5 — UPSERT idempotente da rodada.
   *
   * Por que existe: hoje o módulo perguntava "rodada existe?" antes de
   * cada evento. Errado. A rodada SEMPRE existe (a banca rodou ela). O
   * que pode faltar é o REGISTRO da extensão. Esta função garante que
   * o registro existe, sem importar qual evento chegou primeiro.
   *
   * Análogo a `INSERT ... ON CONFLICT DO NOTHING` em SQL: se o
   * registro já está lá, devolve; se não, cria do zero. Idempotente:
   * pode chamar N vezes pra mesma roundId sem efeito colateral.
   */
  function obterOuCriar(roundId, metadataInicial) {
    const existente = rodadas.get(roundId);
    if (existente) return existente;
    return criarRodada(roundId, metadataInicial || {});
  }

  // ---------------------------------------------------------------------------
  // R99.6 — Atomicidade real (snapshot + commit + rollback + invariantes)
  // ---------------------------------------------------------------------------

  /**
   * Tira um snapshot estrutural da rodada (deep clone dos campos mutáveis).
   * Usado pra rollback se uma transação falhar no meio.
   */
  function snapshotRodada(rodada) {
    if (!rodada) return null;
    return {
      state: rodada.state,
      phase: rodada.phase,
      t0: rodada.t0,
      t0Real: rodada.t0Real,
      t1: rodada.t1,
      tFimReal: rodada.tFimReal,
      fasesObservadas: [...rodada.fasesObservadas],
      fases: rodada.fases.map(f => ({ ...f, metadata: { ...(f.metadata || {}) } })),
      faseAtual: rodada.faseAtual
        ? { ...rodada.faseAtual, metadata: { ...(rodada.faseAtual.metadata || {}) } }
        : null,
      resultado: rodada.resultado,
      ultimaAtividade: rodada.ultimaAtividade,
      anomalias: rodada.anomalias.map(a => ({ ...a })),
      metadata: { ...(rodada.metadata || {}) },
      closeReason: rodada.closeReason,
      forced: rodada.forced
    };
  }

  /**
   * Restaura uma rodada a partir de um snapshot. Mutação in-place
   * pra preservar a identidade do objeto (outros módulos podem ter
   * referência via clone, mas o registro canônico é por roundId no Map).
   */
  function restaurarSnapshot(rodada, snap) {
    if (!rodada || !snap) return;
    rodada.state = snap.state;
    rodada.phase = snap.phase;
    rodada.t0 = snap.t0;
    rodada.t0Real = snap.t0Real;
    rodada.t1 = snap.t1;
    rodada.tFimReal = snap.tFimReal;
    rodada.fasesObservadas = [...snap.fasesObservadas];
    rodada.fases = snap.fases;
    rodada.faseAtual = snap.faseAtual;
    rodada.resultado = snap.resultado;
    rodada.ultimaAtividade = snap.ultimaAtividade;
    rodada.anomalias = snap.anomalias;
    rodada.metadata = snap.metadata;
    rodada.closeReason = snap.closeReason;
    rodada.forced = snap.forced;
  }

  /**
   * Invariantes da rodada — verificações que DEVEM valer pra qualquer
   * estado consistente. Se quebrar, retorna a lista de violações.
   *
   * NUNCA silenciar uma violação: significa bug. Atomicidade exige que
   * o estado final de cada transação satisfaça todas as invariantes.
   */
  function validarInvariantes(rodada) {
    const violacoes = [];
    if (!rodada) return ['rodada nula'];

    // I1: roundId presente e estável
    if (!rodada.roundId) violacoes.push('I1: roundId vazio');

    // I2: state válido
    if (!Object.values(STATES).includes(rodada.state)) {
      violacoes.push(`I2: state inválido (${rodada.state})`);
    }

    // I3: se CLOSED, t1 e closeReason obrigatórios
    if (rodada.state === STATES.CLOSED) {
      if (rodada.t1 == null) violacoes.push('I3: CLOSED sem t1');
      if (!rodada.closeReason) violacoes.push('I3: CLOSED sem closeReason');
    }

    // I4: t1 sempre depois de t0 (se ambos definidos)
    if (rodada.t1 != null && rodada.t1 < rodada.t0) {
      violacoes.push('I4: t1 < t0 (tempo viajando pra trás)');
    }

    // I5: tFimReal sempre depois de t0Real (se ambos definidos)
    if (rodada.tFimReal != null && rodada.t0Real != null && rodada.tFimReal < rodada.t0Real) {
      violacoes.push('I5: tFimReal < t0Real');
    }

    // I6: fases fechadas têm t1 e duracaoMs
    for (const f of rodada.fases) {
      if (f.t1 == null) violacoes.push(`I6: fase "${f.nome}" sem t1`);
      if (f.duracaoMs == null) violacoes.push(`I6: fase "${f.nome}" sem duracaoMs`);
    }

    // I7: fasesObservadas é subconjunto dos nomes em fases[] + faseAtual
    const nomesObservados = new Set([
      ...rodada.fases.map(f => f.nome),
      ...(rodada.faseAtual ? [rodada.faseAtual.nome] : [])
    ]);
    for (const nome of rodada.fasesObservadas) {
      if (!nomesObservados.has(nome)) {
        violacoes.push(`I7: fasesObservadas inclui "${nome}" mas não há fase com esse nome`);
      }
    }

    return violacoes;
  }

  /**
   * R99.6 — Executa uma mutação ATÔMICA na rodada.
   *
   * Padrão clássico de transação:
   *   1. SNAPSHOT (pra rollback)
   *   2. MUTATE via `mutacao(rodada)` (callback que altera in-place)
   *   3. VALIDATE invariantes
   *   4. Se invariantes OK → COMMIT (estado fica) e retorna sucesso
   *      Se invariantes falham → ROLLBACK (restaura snapshot) e loga
   *
   * Eventos NÃO são emitidos aqui — quem chamar `mutarAtomicamente`
   * deve emitir eventos só DEPOIS do retorno de sucesso (vide
   * `commitarEEmitir` abaixo).
   */
  function mutarAtomicamente(rodada, mutacao, contextoLog) {
    if (!rodada) {
      warn('mutarAtomicamente: rodada nula. Contexto:', contextoLog);
      return { ok: false, motivo: 'rodada-nula' };
    }
    const snap = snapshotRodada(rodada);
    try {
      mutacao(rodada);
    } catch (err) {
      restaurarSnapshot(rodada, snap);
      warn(`mutarAtomicamente: mutação lançou (${contextoLog}). Rollback aplicado:`, err?.message || err);
      return { ok: false, motivo: 'mutacao-lancou', erro: err };
    }
    const violacoes = validarInvariantes(rodada);
    if (violacoes.length > 0) {
      restaurarSnapshot(rodada, snap);
      warn(`mutarAtomicamente: invariantes violadas (${contextoLog}):`, violacoes);
      registrarAnomalia(rodada, 'invariantes_violadas_rollback', {
        contexto: contextoLog,
        violacoes
      });
      return { ok: false, motivo: 'invariantes-violadas', violacoes };
    }
    return { ok: true };
  }

  /**
   * R99.6 — Commit transacional: muta atomicamente E SÓ EMITE evento
   * se o commit deu certo. Garante que estado e evento estão alinhados.
   * Se a emissão do evento lançar, NÃO faz rollback do estado (o estado
   * já está válido por construção) mas registra anomalia separada.
   */
  function commitarEEmitir(rodada, mutacao, eventoFn, contextoLog) {
    const res = mutarAtomicamente(rodada, mutacao, contextoLog);
    if (!res.ok) return res;
    if (typeof eventoFn === 'function') {
      try {
        eventoFn();
      } catch (err) {
        warn(`commitarEEmitir: emissão de evento falhou (${contextoLog}):`, err?.message || err);
        registrarAnomalia(rodada, 'evento_falhou_pos_commit', {
          contexto: contextoLog,
          erro: err?.message || String(err)
        });
        // Estado FICA — invariantes batem; só a propagação falhou.
        return { ok: true, eventoFalhou: true };
      }
    }
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // R99.6 — Deduplicação de eventos da banca
  // ---------------------------------------------------------------------------

  // Set de chaves já processadas. FIFO com cap (não cresce indefinidamente).
  const eventosProcessados = new Set();
  const filaDedup = []; // ordem de inserção
  const LIMITE_DEDUP = 1000;

  function chaveDedup(tipo, roundId, marca) {
    return `${tipo}::${roundId}::${marca}`;
  }

  function jaProcessado(chave) {
    return eventosProcessados.has(chave);
  }

  function marcarProcessado(chave) {
    if (eventosProcessados.has(chave)) return;
    eventosProcessados.add(chave);
    filaDedup.push(chave);
    while (filaDedup.length > LIMITE_DEDUP) {
      const antigo = filaDedup.shift();
      eventosProcessados.delete(antigo);
    }
  }

  /**
   * R99.5 — Deriva flags de observação parcial a partir dos FATOS
   * (t0Real, tFimReal, fasesObservadas). Não é estado armazenado; é
   * query sobre o que efetivamente vimos. Garante que a verdade
   * sobre "completude da observação" está num lugar só.
   */
  function derivarObservacao(rodada) {
    if (!rodada) return null;
    const viuInicio = rodada.t0Real != null;
    const viuFim = rodada.tFimReal != null;
    const viuFases = rodada.fasesObservadas.length > 0;
    return {
      completa: viuInicio && viuFim,
      somenteResultado: !viuInicio && !viuFases && viuFim,
      aposInicio: !viuInicio && viuFases,
      emAndamento: viuInicio && !viuFim,
      viuInicio,
      viuFim,
      viuFases
    };
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
   * R99.5: inclui `observacao` derivada (completa/parcial/etc).
   */
  function clonarRodada(rodada) {
    if (!rodada) return null;
    return {
      roundId: rodada.roundId,
      state: rodada.state,
      phase: rodada.phase,
      t0: rodada.t0,
      t0Real: rodada.t0Real,        // R99.5: timestamp do start observado
      t1: rodada.t1,
      tFimReal: rodada.tFimReal,    // R99.5: timestamp do end observado
      fasesObservadas: [...rodada.fasesObservadas], // R99.5
      duracaoTotalMs: rodada.t1 ? rodada.t1 - rodada.t0 : null,
      fases: rodada.fases.map(f => ({ ...f, metadata: { ...(f.metadata || {}) } })),
      faseAtual: rodada.faseAtual
        ? { ...rodada.faseAtual, metadata: { ...(rodada.faseAtual.metadata || {}) } }
        : null,
      resultado: rodada.resultado,
      anomalias: rodada.anomalias.map(a => ({ ...a })),
      metadata: { ...(rodada.metadata || {}) },
      closeReason: rodada.closeReason,
      forced: !!rodada.forced,
      observacao: derivarObservacao(rodada)  // R99.5: derivado, não armazenado
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
   * R99.6 — Encerramento ATÔMICO: snapshot → mutação → invariantes →
   * commit (ou rollback). Eventos só saem se commit deu certo.
   * Compartilhado por end() e forceClose().
   * Retorna { ok: bool, motivo?, eventoFalhou? }.
   */
  function encerrarRodada(rodada, { resultado, forced, closeReason }) {
    const tipoContexto = forced ? 'forceClose' : 'end';
    const fasePreEncerramento = rodada.faseAtual
      ? rodada.faseAtual.nome
      : (rodada.fases.length ? rodada.fases[rodada.fases.length - 1].nome : null);

    return commitarEEmitir(
      rodada,
      (r) => {
        const t = agora();
        fecharFaseAtual(r, t);
        r.state = STATES.CLOSED;
        r.phase = ESTADOS.ENCERRADA;
        r.t1 = t;
        // Só marca tFimReal se ainda não foi marcado (caso end() encadeie).
        if (r.tFimReal == null) r.tFimReal = t;
        r.resultado = resultado != null ? resultado : r.resultado;
        r.ultimaAtividade = t;
        r.forced = !!forced;
        r.closeReason = closeReason || (forced ? 'forced' : 'natural');
      },
      () => {
        if (rodadaAtualId === rodada.roundId) {
          rodadaAtualId = null;
          pararWatchdog();
        }
        log(`Rodada encerrada: ${rodada.roundId} (duracao total: ${rodada.t1 - rodada.t0}ms, motivo: ${rodada.closeReason})`);

        emitirLifecycleEvent({
          roundId: rodada.roundId,
          fromPhase: fasePreEncerramento,
          toPhase: ESTADOS.ENCERRADA,
          kind: 'round_end',
          metadata: { forced: !!forced, closeReason: rodada.closeReason }
        });

        emitirEPersistir(EVENTOS.ROUND_END, {
          v: SCHEMA_VERSION,
          roundId: rodada.roundId,
          outcome: rodada.resultado,
          t0: rodada.t0,
          t0Real: rodada.t0Real,
          t1: rodada.t1,
          tFimReal: rodada.tFimReal,
          duracaoTotalMs: rodada.t1 - rodada.t0,
          fases: montarFasesParaEncerramento(rodada),
          fasesObservadas: [...rodada.fasesObservadas],
          observacao: derivarObservacao(rodada),
          anomalias: rodada.anomalias.map(a => ({ ...a })),
          forced: !!forced,
          closeReason: rodada.closeReason
        });
      },
      tipoContexto
    );
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
     * R99.6 — Registra que a extensão OBSERVOU o início da rodada.
     *
     * ATÔMICO via commitarEEmitir: snapshot → mutação → invariantes →
     * commit (ou rollback). Evento só sai se commit deu certo.
     * IDEMPOTENTE via dedupKey + obterOuCriar.
     */
    start(roundId, metadata) {
      if (roundId == null || roundId === '') {
        warn('start() chamado sem roundId valido. Ignorando.');
        return null;
      }

      // Dedup: mesmo (tipo, roundId, t0Real existente) = no-op.
      const chave = chaveDedup('start', roundId, 'unique');
      if (jaProcessado(chave)) return clonarRodada(rodadas.get(roundId));

      // Encerra rodada anterior se ainda estiver ativa (roundId diferente)
      if (rodadaAtualId && rodadaAtualId !== roundId) {
        const anterior = rodadas.get(rodadaAtualId);
        if (anterior && anterior.state !== STATES.CLOSED) {
          encerrarRodada(anterior, {
            resultado: null,
            forced: false,
            closeReason: 'superseded'
          });
        }
      }

      const rodada = obterOuCriar(roundId, metadata);

      // Idempotência forte: já encerrada ou já viu start → no-op.
      if (rodada.state === STATES.CLOSED) {
        marcarProcessado(chave);
        return clonarRodada(rodada);
      }
      if (rodada.t0Real != null) {
        if (metadata) rodada.metadata = { ...rodada.metadata, ...metadata };
        marcarProcessado(chave);
        return clonarRodada(rodada);
      }

      // Transação atômica: muta + valida invariantes + emite evento.
      const faseAnterior = rodada.faseAtual ? rodada.faseAtual.nome : null;
      const res = commitarEEmitir(
        rodada,
        (r) => {
          r.t0Real = agora();
          if (metadata) r.metadata = { ...r.metadata, ...metadata };
          abrirFase(r, ESTADOS.APOSTANDO, metadata);
          if (!r.fasesObservadas.includes(ESTADOS.APOSTANDO)) {
            r.fasesObservadas.push(ESTADOS.APOSTANDO);
          }
        },
        () => {
          rodadaAtualId = roundId;
          iniciarWatchdog();
          emitirLifecycleEvent({
            roundId,
            fromPhase: faseAnterior,
            toPhase: ESTADOS.APOSTANDO,
            kind: 'round_start',
            metadata: rodada.metadata
          });
          emitirEPersistir(EVENTOS.ROUND_START, {
            v: SCHEMA_VERSION,
            roundId,
            t0: rodada.t0,
            t0Real: rodada.t0Real,
            metadata: { ...(rodada.metadata || {}) }
          });
        },
        'start'
      );

      if (!res.ok) {
        warn(`start(${roundId}) abortado: ${res.motivo}`);
        return null;
      }
      marcarProcessado(chave);
      log(`Rodada iniciada: ${roundId}`);
      return clonarRodada(rodada);
    },

    /**
     * R99.6 — Registra transição de fase. Atômica + idempotente.
     * UPSERT: se a rodada ainda não existe na extensão, nasce aqui.
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

      const rodada = obterOuCriar(roundId, metadata);

      // Idempotência forte: já encerrada → no-op.
      if (rodada.state === STATES.CLOSED) {
        return clonarRodada(rodada);
      }

      const estadoAnterior = rodada.faseAtual ? rodada.faseAtual.nome : rodada.phase;

      // Se o estado de destino é ENCERRADA, delega para end().
      if (estadoCanonico === ESTADOS.ENCERRADA) {
        return this.end(roundId, metadata && metadata.resultado);
      }

      // Mesma fase: só atualiza atividade (idempotente, sem evento).
      if (estadoAnterior === estadoCanonico) {
        rodada.ultimaAtividade = agora();
        return clonarRodada(rodada);
      }

      // Dedup: (transition, roundId, estadoCanonico+contadorVisita).
      // Permite múltiplas visitas à mesma fase em rodadas diferentes, mas
      // bloqueia replay do mesmo evento dentro da mesma rodada.
      const marca = `${estadoAnterior}->${estadoCanonico}@${rodada.fases.length}`;
      const chave = chaveDedup('transition', roundId, marca);
      if (jaProcessado(chave)) return clonarRodada(rodada);

      // Anomalia só se houve transição vista E ela é inválida.
      if (estadoAnterior !== ESTADOS.OBSERVING
          && !transicaoValida(estadoAnterior, estadoCanonico)) {
        registrarAnomalia(rodada, 'transicao_invalida', {
          de: estadoAnterior,
          para: estadoCanonico
        });
      }

      const res = commitarEEmitir(
        rodada,
        (r) => {
          abrirFase(r, estadoCanonico, metadata);
          if (!r.fasesObservadas.includes(estadoCanonico)) {
            r.fasesObservadas.push(estadoCanonico);
          }
        },
        () => {
          rodadaAtualId = roundId;
          iniciarWatchdog();
          emitirLifecycleEvent({
            roundId,
            fromPhase: estadoAnterior,
            toPhase: estadoCanonico,
            kind: 'phase_change',
            metadata
          });
          emitirEPersistir(EVENTOS.PHASE_CHANGE, {
            v: SCHEMA_VERSION,
            roundId,
            de: estadoAnterior,
            para: estadoCanonico,
            t: rodada.faseAtual.t0,
            metadata: { ...(rodada.faseAtual.metadata || {}) }
          });
        },
        `transition(${estadoAnterior}->${estadoCanonico})`
      );

      if (!res.ok) {
        warn(`transition(${roundId}, ${estadoCanonico}) abortado: ${res.motivo}`);
        return null;
      }
      marcarProcessado(chave);
      log(`Rodada ${roundId}: ${estadoAnterior} -> ${estadoCanonico}`);
      return clonarRodada(rodada);
    },

    /**
     * R99.6 — Registra que a extensão OBSERVOU o fim da rodada.
     *
     * Atômica via commitarEEmitir + idempotente via dedupKey + obterOuCriar.
     * Pode ser o PRIMEIRO evento da rodada (entramos só pra ver o resultado).
     */
    end(roundId, resultado) {
      if (roundId == null || roundId === '') {
        warn('end() chamado sem roundId valido. Ignorando.');
        return null;
      }

      // Dedup: cada (end, roundId) é único — só processa uma vez.
      const chave = chaveDedup('end', roundId, 'unique');
      if (jaProcessado(chave)) return clonarRodada(rodadas.get(roundId));

      const rodada = obterOuCriar(roundId);

      // Idempotência forte: já encerrada → no-op.
      if (rodada.state === STATES.CLOSED) {
        marcarProcessado(chave);
        return clonarRodada(rodada);
      }

      // encerrarRodada já valida invariantes via commitarEEmitir.
      const res = encerrarRodada(rodada, {
        resultado,
        forced: false,
        closeReason: 'natural'
      });
      if (!res || res.ok === false) {
        warn(`end(${roundId}) abortado: ${res?.motivo || 'desconhecido'}`);
        return null;
      }
      marcarProcessado(chave);
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
     *
     * R99.5: usa `derivarObservacao()` — única fonte da verdade sobre
     * completude. Rodadas observadas parcialmente NÃO entram em médias
     * de duração (não temos dados confiáveis), mas seguem no histórico.
     */
    getAggregateStats(n) {
      const limite = typeof n === 'number' && n > 0 ? n : 50;
      const encerradas = [];
      const parciais = [];
      for (let i = ordemInsercao.length - 1; i >= 0 && encerradas.length < limite; i--) {
        const id = ordemInsercao[i];
        const r = rodadas.get(id);
        if (!r || r.state !== STATES.CLOSED) continue;
        const obs = derivarObservacao(r);
        if (!obs.completa) {
          parciais.push(r);
          continue;
        }
        encerradas.push(r);
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
        amostraParcial: parciais.length, // rodadas observadas só pelo fim — só pro histórico
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
