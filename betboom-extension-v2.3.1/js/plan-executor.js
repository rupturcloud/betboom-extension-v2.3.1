/**
 * BetBoom Auto Pattern — Plan Executor (v2)
 *
 * Formaliza o "plano de execução" de uma aposta como objeto serializável,
 * com steps explícitos, fallbacks, retries e idempotência por planoId.
 *
 * Esta versão incorpora os fixes P0 + P1 da Rodada 4:
 *   - executionMode: 'live' | 'replay'
 *   - roundId autoritativo via LifecycleGate (injetado, opcional)
 *   - Persistência de eventos via EventStore (injetado, opcional)
 *   - seq monotônico anexado a cada evento emitido
 *   - Abort automático em round_end mid-flight
 *   - Cancelamento cooperativo via AbortSignal
 *   - Deadline derivado da fase (Lifecycle.getPhaseElapsedMs)
 *   - Idempotência por (roundId, hash decisao)
 *   - Snapshot final no EventStore (plan_finished)
 *   - Validação da decisão (rejeita stake<=0 / cor ausente)
 *   - Rehydrate a partir de snapshot
 *   - Pub/sub local de eventos
 *
 * Backward compat:
 *   - attachLifecycle() e attachEventStore() são OPCIONAIS.
 *   - Sem Lifecycle: usa decisao.roundId; sem EventStore: não persiste.
 *   - criarPlano(decisao) e executar(plano, executor) continuam funcionando
 *     sem nenhuma alteração do caller atual.
 *
 * =====================================================================
 * API Pública (delta v2)
 * =====================================================================
 *
 *   PlanExecutor.attachLifecycle(gate)
 *   PlanExecutor.attachEventStore(eventStore)
 *   PlanExecutor.criarPlano(decisao, { executionMode = 'live' } = {})
 *   PlanExecutor.executar(plano, executor, { executionMode = 'live', signal } = {})
 *   PlanExecutor.contextoCalibracao(planoId)
 *   PlanExecutor.listarPorRoundId(roundId)
 *   PlanExecutor.rehydrate(snapshot)
 *   PlanExecutor.subscribe(evento, cb) -> unsubscribe
 *
 *   (mantidos: status, cancelar, listar)
 *
 * =====================================================================
 * Eventos emitidos (EventStore.append + pub/sub local)
 * =====================================================================
 *   plan_created
 *   plan_started
 *   plan_step_started
 *   plan_step_done
 *   plan_step_failed
 *   plan_finished           (com snapshot do plano)
 *   plan_aborted_by_round_end
 *   plan_rejected
 *
 * =====================================================================
 * Estrutura do Step
 * =====================================================================
 * {
 *   id: 'step-1',
 *   ordem: 1,
 *   tipo: 'select_chip' | 'click_spot' | 'click_confirm' | 'wait_state' | 'protecao_empate',
 *   alvo: 'azul' | 'vermelho' | 'empate' | null,
 *   valor: 5 | null,
 *   timeoutMs: 2000,
 *   retryMax: 2,
 *   fallback: 'abort' | 'skip' | 'use_next',
 *   status: 'pending' | 'running' | 'done' | 'failed' | 'skipped',
 *   startedAt: null,
 *   finishedAt: null,
 *   attempts: 0,
 *   meta: {}
 * }
 */

const PlanExecutor = (() => {
  // ===================================================================
  // Estado interno
  // ===================================================================

  /** Mapa de planos vivos em memória: planoId -> plano */
  const planos = new Map();

  /** Mapa de execuções em andamento: planoId -> Promise */
  const execucoesEmAndamento = new Map();

  /** Contador monotônico para gerar ids únicos dentro da sessão */
  let seqCounter = 0;

  /** Adaptadores externos opcionais (graceful degradation) */
  let lifecycleGate = null;
  let eventStore = null;

  /** Função de unsubscribe do round_end, caso lifecycle esteja attached */
  let unsubscribeRoundEnd = null;

  /** Pub/sub local: evento -> Set<callback> */
  const localSubscribers = new Map();

  /** Janela mínima/máxima do deadline derivado da fase (ms) */
  const DEADLINE_MIN_MS = 3000;
  const DEADLINE_MAX_MS = 15000;

  // ===================================================================
  // Helpers privados
  // ===================================================================

  /**
   * Gera um id de plano único.
   * Formato: plan-<timestamp>-<seq>
   */
  function gerarPlanoId() {
    seqCounter += 1;
    return `plan-${Date.now()}-${seqCounter}`;
  }

  /**
   * Gera um id de step dentro do plano.
   */
  function gerarStepId(ordem) {
    return `step-${ordem}`;
  }

  /**
   * Faz um hash simples e estável da decisão (fingerprint para idempotência
   * por roundId). Não precisa ser criptográfico — só consistente.
   */
  function hashDecisao(dec) {
    const d = dec || {};
    const canon = [
      String(d.cor || ''),
      String(Number(d.stake) || 0),
      d.protecaoEmpate === true ? '1' : '0',
      String(Number(d.valorProtecao) || 0),
      String((d.padrao && (d.padrao.id || d.padrao.nome)) || '')
    ].join('|');
    // djb2
    let h = 5381;
    for (let i = 0; i < canon.length; i++) {
      h = ((h << 5) + h + canon.charCodeAt(i)) | 0;
    }
    return `h${(h >>> 0).toString(36)}`;
  }

  /**
   * Cria um step base com defaults seguros.
   */
  function criarStep({ ordem, tipo, alvo = null, valor = null, timeoutMs = 2000, retryMax = 2, fallback = 'abort' }) {
    return {
      id: gerarStepId(ordem),
      ordem,
      tipo,
      alvo,
      valor,
      timeoutMs,
      retryMax,
      fallback,
      status: 'pending',
      startedAt: null,
      finishedAt: null,
      attempts: 0,
      meta: {}
    };
  }

  /**
   * Monta a sequência canônica de steps para uma decisão de aposta Bac Bo.
   */
  function montarStepsCanonicos(decisao) {
    const steps = [];
    let ordem = 1;

    // 1. Selecionar ficha (chip)
    steps.push(criarStep({
      ordem: ordem++,
      tipo: 'select_chip',
      alvo: null,
      valor: Number(decisao.stake) > 0 ? Number(decisao.stake) : 5,
      timeoutMs: 1500,
      retryMax: 2,
      fallback: 'abort' // sem ficha não dá pra apostar
    }));

    // 2. Clicar no spot (cor)
    steps.push(criarStep({
      ordem: ordem++,
      tipo: 'click_spot',
      alvo: decisao.cor || null,
      valor: null,
      timeoutMs: 2000,
      retryMax: 2,
      fallback: 'abort'
    }));

    // 3. Proteção de empate (opcional)
    if (decisao.protecaoEmpate === true) {
      const valorProt = Number(decisao.valorProtecao) > 0
        ? Number(decisao.valorProtecao)
        : 1;
      steps.push(criarStep({
        ordem: ordem++,
        tipo: 'protecao_empate',
        alvo: 'empate',
        valor: valorProt,
        timeoutMs: 2000,
        retryMax: 1,
        fallback: 'skip' // se falhar protecao, segue aposta principal
      }));
    }

    // 4. Confirmar aposta
    steps.push(criarStep({
      ordem: ordem++,
      tipo: 'click_confirm',
      alvo: null,
      valor: null,
      timeoutMs: 2500,
      retryMax: 2,
      fallback: 'abort'
    }));

    return steps;
  }

  /**
   * Executa um step com timeout. Não trata retry — quem chama trata.
   * Em modo replay: pula timeout real e chama o executor diretamente.
   * Retorna sempre { ok: boolean, meta: any, erro?: string }.
   */
  async function rodarStepComTimeout(step, executor, opts) {
    const executionMode = (opts && opts.executionMode) || 'live';
    const signal = opts && opts.signal;

    // Modo replay: sem timeout real, só invoca o executor (que deve ser puro).
    if (executionMode === 'replay') {
      try {
        const res = await Promise.resolve(executor(step));
        if (res && typeof res === 'object') {
          return { ok: res.ok === true, meta: res.meta || {}, erro: res.erro };
        }
        return { ok: !!res, meta: {}, erro: res ? undefined : 'resposta-vazia' };
      } catch (err) {
        return { ok: false, meta: {}, erro: (err && err.message) || String(err) };
      }
    }

    const timeoutMs = Number(step.timeoutMs) > 0 ? step.timeoutMs : 2000;

    return new Promise((resolve) => {
      let resolved = false;

      const onAbort = () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        resolve({ ok: false, meta: {}, erro: 'aborted-by-signal' });
      };

      const timer = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        if (signal && typeof signal.removeEventListener === 'function') {
          try { signal.removeEventListener('abort', onAbort); } catch (_) {}
        }
        resolve({ ok: false, meta: {}, erro: `timeout-${timeoutMs}ms` });
      }, timeoutMs);

      if (signal && typeof signal.addEventListener === 'function') {
        if (signal.aborted) {
          onAbort();
          return;
        }
        try { signal.addEventListener('abort', onAbort, { once: true }); } catch (_) {}
      }

      Promise.resolve()
        .then(() => executor(step, { executionMode, signal }))
        .then((res) => {
          if (resolved) return;
          resolved = true;
          clearTimeout(timer);
          if (signal && typeof signal.removeEventListener === 'function') {
            try { signal.removeEventListener('abort', onAbort); } catch (_) {}
          }
          if (res && typeof res === 'object') {
            resolve({ ok: res.ok === true, meta: res.meta || {}, erro: res.erro });
          } else {
            resolve({ ok: !!res, meta: {}, erro: res ? undefined : 'resposta-vazia' });
          }
        })
        .catch((err) => {
          if (resolved) return;
          resolved = true;
          clearTimeout(timer);
          if (signal && typeof signal.removeEventListener === 'function') {
            try { signal.removeEventListener('abort', onAbort); } catch (_) {}
          }
          resolve({ ok: false, meta: {}, erro: (err && err.message) || String(err) });
        });
    });
  }

  /**
   * Loga com prefixo padrão. Usa console por padrão; se houver Logger global,
   * tenta usá-lo, mas sem depender (mantém isolamento).
   */
  function log(nivel, msg, extra) {
    const prefixo = '[PlanExecutor]';
    const full = `${prefixo} ${msg}`;
    try {
      if (typeof Logger !== 'undefined' && Logger && typeof Logger[nivel] === 'function') {
        if (extra !== undefined) Logger[nivel](full, extra);
        else Logger[nivel](full);
        return;
      }
    } catch (_) { /* fallback console */ }

    const fn = (typeof console !== 'undefined' && console[nivel]) ? console[nivel] : console.log;
    if (extra !== undefined) fn.call(console, full, extra);
    else fn.call(console, full);
  }

  /**
   * Retorna uma cópia (deep) serializável do plano.
   */
  function snapshotPlano(plano) {
    try {
      return JSON.parse(JSON.stringify(plano));
    } catch (_) {
      return null;
    }
  }

  /**
   * Recalcula o status final agregado do plano a partir dos steps.
   */
  function recomputarStatusFinal(plano) {
    if (plano.status === 'cancelled') return 'cancelled';
    if (plano.status === 'aborted_by_round_end') return 'aborted_by_round_end';

    const algumFalhouAbort = plano.steps.some(
      (s) => s.status === 'failed' && s.fallback === 'abort'
    );
    if (algumFalhouAbort) return 'failed';

    const todosTerminais = plano.steps.every(
      (s) => s.status === 'done' || s.status === 'skipped' || s.status === 'failed'
    );
    if (!todosTerminais) return plano.status;

    const algumDone = plano.steps.some((s) => s.status === 'done');
    return algumDone ? 'completed' : 'failed';
  }

  /**
   * Notifica subscribers locais de um evento (sem propagar exceções).
   */
  function notifyLocal(evento, payload) {
    const set = localSubscribers.get(evento);
    if (!set || set.size === 0) return;
    for (const cb of Array.from(set)) {
      try {
        cb({ type: evento, payload });
      } catch (err) {
        log('warn', `Subscriber local de '${evento}' lançou erro`, err);
      }
    }
  }

  /**
   * Persiste um evento no EventStore (se attached) e notifica subscribers
   * locais. Retorna { seq, persistedAt } quando persistido, ou null.
   *
   * Em modo replay: NÃO persiste, mas ainda notifica subscribers locais
   * (útil para UI/calibração que observa replays).
   */
  function emitirEvento(tipo, payload, opts) {
    const executionMode = (opts && opts.executionMode) || 'live';
    let metaPersist = null;

    if (executionMode === 'live' && eventStore && typeof eventStore.append === 'function') {
      try {
        const r = eventStore.append(tipo, payload);
        if (r && typeof r === 'object') {
          metaPersist = { seq: r.seq, persistedAt: r.persistedAt };
        }
      } catch (err) {
        log('warn', `Falha ao persistir evento '${tipo}' no EventStore`, err);
      }
    }

    const enriched = Object.assign({}, payload, metaPersist ? { seq: metaPersist.seq, persistedAt: metaPersist.persistedAt } : {});
    notifyLocal(tipo, enriched);
    return metaPersist;
  }

  /**
   * Resolve o roundId autoritativo. Em modo live, exige Lifecycle ou
   * decisao.roundId; sem nenhum dos dois, retorna null (caller decide
   * rejeitar). Em modo replay, aceita qualquer um.
   */
  function resolverRoundId(decisao, executionMode) {
    if (lifecycleGate && typeof lifecycleGate.getCurrentRoundId === 'function') {
      try {
        const r = lifecycleGate.getCurrentRoundId();
        if (r) return r;
      } catch (_) { /* ignora */ }
    }
    if (decisao && decisao.roundId) return decisao.roundId;
    return null;
  }

  /**
   * Calcula deadline a partir da fase corrente (se Lifecycle attached).
   * Retorna { deadline, janelaMs } onde janelaMs já está clamped.
   */
  function calcularDeadline(roundId, createdAt) {
    let janelaMs = DEADLINE_MAX_MS;
    if (lifecycleGate && typeof lifecycleGate.getPhaseElapsedMs === 'function' && roundId) {
      try {
        const elapsed = Number(lifecycleGate.getPhaseElapsedMs(roundId)) || 0;
        // Assume janela de apostas típica de ~15s; restante = max - elapsed
        const restante = DEADLINE_MAX_MS - elapsed;
        janelaMs = Math.max(DEADLINE_MIN_MS, Math.min(DEADLINE_MAX_MS, restante));
      } catch (_) {
        janelaMs = DEADLINE_MAX_MS;
      }
    }
    return { deadline: createdAt + janelaMs, janelaMs };
  }

  /**
   * Procura plano vivo com mesmo roundId + hash da decisão.
   * Vivo = ainda não em estado terminal.
   */
  function buscarPlanoVivoPorChave(roundId, hash) {
    if (!roundId || !hash) return null;
    for (const p of planos.values()) {
      if (p.roundId !== roundId) continue;
      if (p.decisaoHash !== hash) continue;
      if (p.status === 'completed' || p.status === 'failed' ||
          p.status === 'cancelled' || p.status === 'aborted_by_round_end') {
        continue;
      }
      return p;
    }
    return null;
  }

  /**
   * Aborta um plano por round_end. Marca steps pendentes/running como
   * skipped e emite plan_aborted_by_round_end.
   */
  function abortarPlanoPorRoundEnd(plano, roundIdQueEncerrou, executionMode) {
    if (!plano) return;
    const terminal = ['completed', 'failed', 'cancelled', 'aborted_by_round_end'];
    if (terminal.indexOf(plano.status) !== -1) return;

    log('warn', `Plano id=${plano.id} abortado por round_end (roundId=${roundIdQueEncerrou})`);
    plano.status = 'aborted_by_round_end';
    plano.finishedAt = plano.finishedAt || Date.now();
    for (const s of plano.steps) {
      if (s.status === 'pending' || s.status === 'running') {
        s.status = 'skipped';
        s.meta = s.meta || {};
        s.meta.motivoSkip = 'round-end-mid-flight';
      }
    }

    emitirEvento('plan_aborted_by_round_end', {
      planId: plano.id,
      roundId: plano.roundId,
      roundIdQueEncerrou,
      snapshot: snapshotPlano(plano)
    }, { executionMode });
  }

  // ===================================================================
  // API Pública
  // ===================================================================

  return {
    /**
     * Conecta um LifecycleGate (opcional). Quando attached:
     *   - resolverRoundId() usa gate.getCurrentRoundId() como autoridade
     *   - calcularDeadline() usa gate.getPhaseElapsedMs(roundId)
     *   - assina 'round_end' para abortar planos mid-flight
     *
     * Idempotente: chamar de novo substitui o gate e re-assina.
     */
    attachLifecycle(gate) {
      // Cancela assinatura anterior se houver
      if (typeof unsubscribeRoundEnd === 'function') {
        try { unsubscribeRoundEnd(); } catch (_) {}
        unsubscribeRoundEnd = null;
      }

      lifecycleGate = gate || null;

      if (lifecycleGate && typeof lifecycleGate.subscribe === 'function') {
        try {
          unsubscribeRoundEnd = lifecycleGate.subscribe('round_end', (evt) => {
            const roundIdQueEncerrou = (evt && (evt.roundId || (evt.payload && evt.payload.roundId))) || null;
            // Aborta todos os planos vivos desse roundId (defensivo).
            for (const p of planos.values()) {
              if (!roundIdQueEncerrou || p.roundId === roundIdQueEncerrou) {
                abortarPlanoPorRoundEnd(p, roundIdQueEncerrou, 'live');
              }
            }
          });
          log('info', 'LifecycleGate attached — escutando round_end');
        } catch (err) {
          log('warn', 'Falha ao assinar round_end no LifecycleGate', err);
        }
      } else {
        log('info', 'LifecycleGate destacado (null)');
      }
    },

    /**
     * Conecta um EventStore (opcional). Quando attached, eventos do
     * ciclo de vida do plano são persistidos via eventStore.append(type, payload)
     * e cada evento ganha um `seq` monotônico.
     */
    attachEventStore(store) {
      eventStore = store || null;
      log('info', store ? 'EventStore attached' : 'EventStore destacado (null)');
    },

    /**
     * Inscreve um callback em eventos locais (pub/sub interno).
     * Retorna função de unsubscribe.
     *
     * @param {string} evento - nome do evento (ex: 'plan_created')
     * @param {Function} cb - callback(envelope) onde envelope = { type, payload }
     */
    subscribe(evento, cb) {
      if (!evento || typeof cb !== 'function') {
        return () => {};
      }
      let set = localSubscribers.get(evento);
      if (!set) {
        set = new Set();
        localSubscribers.set(evento, set);
      }
      set.add(cb);
      return () => {
        const s = localSubscribers.get(evento);
        if (s) s.delete(cb);
      };
    },

    /**
     * Cria um plano a partir de uma decisão do DecisionEngine.
     *
     * Valida decisão (rejeita se cor faltar ou stake<=0).
     * Resolve roundId autoritativo (Lifecycle > decisao.roundId).
     * Aplica idempotência por (roundId, hash decisao).
     *
     * @param {Object} decisao - { cor, stake, protecaoEmpate, valorProtecao, padrao, roundId }
     * @param {Object} [opts] - { executionMode: 'live'|'replay' }
     * @returns {Object|null} snapshot do plano ou null se rejeitado
     */
    criarPlano(decisao, opts) {
      const dec = decisao || {};
      const executionMode = (opts && opts.executionMode === 'replay') ? 'replay' : 'live';

      // ---- Validação básica da decisão (P1.10) -------------------------
      const motivosRejeicao = [];
      if (!dec.cor) motivosRejeicao.push('cor-ausente');
      if (!(Number(dec.stake) > 0)) motivosRejeicao.push('stake-invalido');

      if (motivosRejeicao.length > 0) {
        log('warn', `criarPlano rejeitado motivos=${motivosRejeicao.join(',')}`);
        emitirEvento('plan_rejected', {
          motivos: motivosRejeicao,
          decisao: dec,
          executionMode
        }, { executionMode });
        return null;
      }

      // ---- Resolução de roundId autoritativo (P0.2) --------------------
      const roundId = resolverRoundId(dec, executionMode);
      if (!roundId && executionMode === 'live') {
        log('warn', 'criarPlano rejeitado — roundId ausente em modo live (sem Lifecycle e sem decisao.roundId)');
        emitirEvento('plan_rejected', {
          motivos: ['roundId-ausente'],
          decisao: dec,
          executionMode
        }, { executionMode });
        return null;
      }

      // ---- Idempotência por (roundId, hash decisao) (P1.8) -------------
      const hash = hashDecisao(dec);
      const existente = buscarPlanoVivoPorChave(roundId, hash);
      if (existente) {
        log('info', `criarPlano idempotente — plano já vivo id=${existente.id} roundId=${roundId} hash=${hash}`);
        return snapshotPlano(existente);
      }

      // ---- Construção do plano ----------------------------------------
      const id = gerarPlanoId();
      const createdAt = Date.now();
      const { deadline, janelaMs } = calcularDeadline(roundId, createdAt);

      const plano = {
        id,
        roundId,
        decisaoHash: hash,
        executionMode,
        decisaoOriginal: {
          cor: dec.cor || null,
          stake: Number(dec.stake) || 0,
          protecaoEmpate: dec.protecaoEmpate === true,
          valorProtecao: Number(dec.valorProtecao) || 0,
          padrao: dec.padrao || null
        },
        steps: montarStepsCanonicos(dec),
        status: 'created',
        createdAt,
        startedAt: null,
        finishedAt: null,
        deadline,
        janelaDeadlineMs: janelaMs,
        executadoEm: 0,
        eventos: [] // seq locais (espelho leve do que foi persistido)
      };

      planos.set(id, plano);

      const meta = emitirEvento('plan_created', {
        planId: id,
        roundId,
        executionMode,
        decisaoHash: hash,
        steps: plano.steps.length,
        cor: plano.decisaoOriginal.cor,
        stake: plano.decisaoOriginal.stake,
        deadline,
        janelaDeadlineMs: janelaMs
      }, { executionMode });
      if (meta) plano.eventos.push({ tipo: 'plan_created', seq: meta.seq });

      log('info', `Plano criado id=${id} roundId=${roundId} mode=${executionMode} steps=${plano.steps.length} cor=${plano.decisaoOriginal.cor} janelaMs=${janelaMs}`);
      return snapshotPlano(plano);
    },

    /**
     * Executa o plano passo a passo, respeitando timeout/retry/fallback.
     * Idempotente: chamadas subsequentes com plano já executado retornam
     * o último resultado sem reexecutar steps.
     *
     * @param {Object} plano - plano criado por criarPlano (ou snapshot)
     * @param {Function} executor - async (step, ctx) => { ok, meta }
     * @param {Object} [opts] - { executionMode, signal }
     */
    async executar(plano, executor, opts) {
      const optExecutionMode = opts && opts.executionMode === 'replay' ? 'replay' : null;
      const signal = opts && opts.signal;

      if (!plano || !plano.id) {
        log('warn', 'executar() recebeu plano inválido (sem id)');
        return { ok: false, executedSteps: [], failedSteps: [], planFinalStatus: 'invalid', planId: null };
      }

      let vivo = planos.get(plano.id);
      if (!vivo) {
        // Re-hidrata a partir do snapshot externo
        vivo = JSON.parse(JSON.stringify(plano));
        if (!Array.isArray(vivo.eventos)) vivo.eventos = [];
        planos.set(vivo.id, vivo);
      }

      // Modo de execução: prioriza opt > plano.executionMode > 'live'
      const executionMode = optExecutionMode || vivo.executionMode || 'live';

      // Idempotência: execução em andamento
      if (execucoesEmAndamento.has(vivo.id)) {
        log('info', `executar() reentrante para id=${vivo.id} — devolvendo execução em andamento`);
        return execucoesEmAndamento.get(vivo.id);
      }

      // Idempotência: estado terminal
      const terminais = ['completed', 'failed', 'cancelled', 'aborted_by_round_end'];
      if (terminais.indexOf(vivo.status) !== -1) {
        log('info', `executar() chamado para plano já finalizado id=${vivo.id} status=${vivo.status} — sem reexecução`);
        return {
          ok: vivo.status === 'completed',
          executedSteps: vivo.steps.filter((s) => s.status === 'done').map((s) => s.id),
          failedSteps: vivo.steps.filter((s) => s.status === 'failed').map((s) => s.id),
          planFinalStatus: vivo.status,
          planId: vivo.id
        };
      }

      if (typeof executor !== 'function') {
        log('warn', `executor inválido para plano id=${vivo.id} (esperado function)`);
        vivo.status = 'failed';
        return { ok: false, executedSteps: [], failedSteps: [], planFinalStatus: 'failed', planId: vivo.id };
      }

      // Verifica abort signal já disparado antes de começar
      if (signal && signal.aborted) {
        log('warn', `executar() abortado antes de iniciar por AbortSignal id=${vivo.id}`);
        vivo.status = 'cancelled';
        vivo.finishedAt = Date.now();
        for (const s of vivo.steps) {
          if (s.status === 'pending') {
            s.status = 'skipped';
            s.meta = s.meta || {};
            s.meta.motivoSkip = 'aborted-by-signal-pre-start';
          }
        }
        return {
          ok: false,
          executedSteps: [],
          failedSteps: [],
          planFinalStatus: 'cancelled',
          planId: vivo.id
        };
      }

      const promiseExec = (async () => {
        vivo.status = 'running';
        vivo.startedAt = Date.now();
        vivo.executadoEm += 1;

        const metaStarted = emitirEvento('plan_started', {
          planId: vivo.id,
          roundId: vivo.roundId,
          executionMode,
          startedAt: vivo.startedAt,
          attempt: vivo.executadoEm
        }, { executionMode });
        if (metaStarted) vivo.eventos.push({ tipo: 'plan_started', seq: metaStarted.seq });

        const executedSteps = [];
        const failedSteps = [];
        let abortado = false;

        for (let i = 0; i < vivo.steps.length; i++) {
          const step = vivo.steps[i];

          // Round_end mid-flight: marca aborted_by_round_end e para
          if (vivo.status === 'aborted_by_round_end') {
            if (step.status === 'pending') {
              step.status = 'skipped';
              step.meta = step.meta || {};
              step.meta.motivoSkip = 'round-end-mid-flight';
            }
            continue;
          }

          // Cancelamento explícito entre steps
          if (vivo.status === 'cancelled') {
            if (step.status === 'pending') {
              step.status = 'skipped';
              step.meta = step.meta || {};
              step.meta.motivoSkip = 'plano-cancelado';
            }
            continue;
          }

          // AbortSignal entre steps
          if (signal && signal.aborted) {
            log('warn', `Plano id=${vivo.id} abortado por signal antes do step ${step.id}`);
            vivo.status = 'cancelled';
            step.status = 'skipped';
            step.meta = step.meta || {};
            step.meta.motivoSkip = 'aborted-by-signal';
            abortado = true;
            break;
          }

          // Deadline global
          if (Date.now() > vivo.deadline) {
            log('warn', `Plano id=${vivo.id} atingiu deadline antes do step ${step.id}`);
            step.status = 'skipped';
            step.meta = step.meta || {};
            step.meta.motivoSkip = 'deadline-global';
            failedSteps.push(step.id);
            abortado = true;
            break;
          }

          // Step já 'done' por replay parcial
          if (step.status === 'done') {
            executedSteps.push(step.id);
            continue;
          }
          if (step.status === 'skipped' || step.status === 'failed') {
            continue;
          }

          step.status = 'running';
          step.startedAt = Date.now();

          const metaStepStart = emitirEvento('plan_step_started', {
            planId: vivo.id,
            roundId: vivo.roundId,
            stepId: step.id,
            ordem: step.ordem,
            tipo: step.tipo,
            alvo: step.alvo,
            valor: step.valor,
            executionMode
          }, { executionMode });
          if (metaStepStart) vivo.eventos.push({ tipo: 'plan_step_started', seq: metaStepStart.seq, stepId: step.id });

          let resultadoFinal = null;
          const tentativasMax = 1 + (Number(step.retryMax) || 0);

          for (let tentativa = 1; tentativa <= tentativasMax; tentativa++) {
            // BUG-FIX: reset de status='running' a cada tentativa (entre retries
            // o status podia ficar inconsistente em snapshots intermediários)
            step.status = 'running';
            step.attempts = tentativa;

            // Verifica abort entre tentativas (cooperativo)
            if (signal && signal.aborted) {
              resultadoFinal = { ok: false, meta: {}, erro: 'aborted-by-signal' };
              break;
            }
            if (vivo.status === 'aborted_by_round_end') {
              resultadoFinal = { ok: false, meta: {}, erro: 'aborted-by-round-end' };
              break;
            }

            log('debug', `Executando ${step.id} tipo=${step.tipo} tentativa=${tentativa}/${tentativasMax} mode=${executionMode}`);
            const r = await rodarStepComTimeout(step, executor, { executionMode, signal });
            resultadoFinal = r;
            if (r.ok) break;
          }

          step.finishedAt = Date.now();
          step.meta = Object.assign({}, step.meta, (resultadoFinal && resultadoFinal.meta) || {});
          if (resultadoFinal && resultadoFinal.erro) {
            step.meta.erro = resultadoFinal.erro;
          }

          if (resultadoFinal && resultadoFinal.ok) {
            step.status = 'done';
            executedSteps.push(step.id);

            const metaDone = emitirEvento('plan_step_done', {
              planId: vivo.id,
              roundId: vivo.roundId,
              stepId: step.id,
              ordem: step.ordem,
              tipo: step.tipo,
              attempts: step.attempts,
              durationMs: step.finishedAt - step.startedAt,
              executionMode
            }, { executionMode });
            if (metaDone) vivo.eventos.push({ tipo: 'plan_step_done', seq: metaDone.seq, stepId: step.id });
            continue;
          }

          // Step falhou em todas as tentativas — aplica fallback
          step.status = 'failed';
          failedSteps.push(step.id);

          const metaFailed = emitirEvento('plan_step_failed', {
            planId: vivo.id,
            roundId: vivo.roundId,
            stepId: step.id,
            ordem: step.ordem,
            tipo: step.tipo,
            attempts: step.attempts,
            erro: (resultadoFinal && resultadoFinal.erro) || 'desconhecido',
            fallback: step.fallback,
            executionMode
          }, { executionMode });
          if (metaFailed) vivo.eventos.push({ tipo: 'plan_step_failed', seq: metaFailed.seq, stepId: step.id });

          log('warn', `Step ${step.id} (${step.tipo}) falhou após ${step.attempts} tentativas; fallback=${step.fallback}`);

          if (step.fallback === 'abort') {
            abortado = true;
            // Marca steps restantes como skipped
            for (let j = i + 1; j < vivo.steps.length; j++) {
              if (vivo.steps[j].status === 'pending') {
                vivo.steps[j].status = 'skipped';
                vivo.steps[j].meta = vivo.steps[j].meta || {};
                vivo.steps[j].meta.motivoSkip = 'abortado-por-step-anterior';
              }
            }
            break;
          } else if (step.fallback === 'skip' || step.fallback === 'use_next') {
            continue;
          }
        }

        vivo.finishedAt = Date.now();
        vivo.status = recomputarStatusFinal(vivo);

        const sumario = {
          ok: vivo.status === 'completed',
          executedSteps,
          failedSteps,
          planFinalStatus: vivo.status,
          planId: vivo.id,
          roundId: vivo.roundId,
          abortado,
          executionMode
        };

        // Snapshot final no EventStore (P1.9)
        const metaFinished = emitirEvento('plan_finished', {
          planId: vivo.id,
          roundId: vivo.roundId,
          status: vivo.status,
          ok: sumario.ok,
          executedSteps,
          failedSteps,
          executionMode,
          snapshot: snapshotPlano(vivo)
        }, { executionMode });
        if (metaFinished) vivo.eventos.push({ tipo: 'plan_finished', seq: metaFinished.seq });

        log('info', `Plano id=${vivo.id} finalizado status=${vivo.status} ok=${sumario.ok} executed=${executedSteps.length} failed=${failedSteps.length} mode=${executionMode}`);
        return sumario;
      })();

      execucoesEmAndamento.set(vivo.id, promiseExec);
      try {
        const out = await promiseExec;
        return out;
      } finally {
        execucoesEmAndamento.delete(vivo.id);
      }
    },

    /**
     * Retorna o snapshot serializável do plano (ou null).
     * Idempotente — não altera estado.
     */
    status(planoId) {
      const p = planos.get(planoId);
      if (!p) return null;
      return snapshotPlano(p);
    },

    /**
     * Contexto enriquecido para calibração: snapshot + métricas
     * agregadas (durações, taxa de retry, motivos de skip).
     */
    contextoCalibracao(planoId) {
      const p = planos.get(planoId);
      if (!p) return null;

      const stepsMet = p.steps.map((s) => ({
        id: s.id,
        tipo: s.tipo,
        status: s.status,
        attempts: s.attempts,
        durationMs: (s.startedAt && s.finishedAt) ? (s.finishedAt - s.startedAt) : null,
        motivoSkip: (s.meta && s.meta.motivoSkip) || null,
        erro: (s.meta && s.meta.erro) || null
      }));

      const totalAttempts = stepsMet.reduce((acc, s) => acc + (s.attempts || 0), 0);
      const retries = stepsMet.reduce((acc, s) => acc + Math.max(0, (s.attempts || 0) - 1), 0);
      const totalDuration = (p.startedAt && p.finishedAt) ? (p.finishedAt - p.startedAt) : null;

      return {
        planId: p.id,
        roundId: p.roundId,
        executionMode: p.executionMode,
        status: p.status,
        decisaoHash: p.decisaoHash,
        createdAt: p.createdAt,
        startedAt: p.startedAt,
        finishedAt: p.finishedAt,
        deadline: p.deadline,
        janelaDeadlineMs: p.janelaDeadlineMs,
        totalDurationMs: totalDuration,
        totalAttempts,
        retries,
        steps: stepsMet,
        eventos: Array.isArray(p.eventos) ? p.eventos.slice() : []
      };
    },

    /**
     * Lista todos os planos cujo roundId == roundId pedido.
     * Útil para auditoria e replay determinístico.
     */
    listarPorRoundId(roundId) {
      if (!roundId) return [];
      const out = [];
      for (const p of planos.values()) {
        if (p.roundId === roundId) {
          const snap = snapshotPlano(p);
          if (snap) out.push(snap);
        }
      }
      return out;
    },

    /**
     * Rehidrata um plano a partir de um snapshot serializável.
     * Útil para replay (worker, devtools, calibração).
     * Se já houver plano vivo com mesmo id, faz merge não-destrutivo
     * (mantém eventos locais existentes).
     */
    rehydrate(snapshot) {
      if (!snapshot || !snapshot.id) {
        log('warn', 'rehydrate() recebeu snapshot inválido');
        return null;
      }
      try {
        const clone = JSON.parse(JSON.stringify(snapshot));
        if (!Array.isArray(clone.eventos)) clone.eventos = [];
        if (!Array.isArray(clone.steps)) clone.steps = [];
        // Default executionMode='replay' para rehydrate, salvo se snapshot diga ao contrário
        if (!clone.executionMode) clone.executionMode = 'replay';
        planos.set(clone.id, clone);
        log('info', `Plano rehidratado id=${clone.id} status=${clone.status} mode=${clone.executionMode}`);
        return snapshotPlano(clone);
      } catch (err) {
        log('warn', 'rehydrate() falhou ao clonar snapshot', err);
        return null;
      }
    },

    /**
     * Cancela um plano em execução (ou criado mas não iniciado).
     */
    cancelar(planoId) {
      const p = planos.get(planoId);
      if (!p) {
        log('warn', `cancelar() planoId desconhecido: ${planoId}`);
        return false;
      }
      const terminais = ['completed', 'failed', 'cancelled', 'aborted_by_round_end'];
      if (terminais.indexOf(p.status) !== -1) {
        log('info', `cancelar() plano id=${planoId} já em estado terminal: ${p.status}`);
        return false;
      }
      p.status = 'cancelled';
      p.finishedAt = p.finishedAt || Date.now();
      for (const s of p.steps) {
        if (s.status === 'pending') {
          s.status = 'skipped';
          s.meta = s.meta || {};
          s.meta.motivoSkip = 'plano-cancelado';
        }
      }
      log('info', `Plano id=${planoId} cancelado`);
      return true;
    },

    /**
     * Lista snapshots de todos os planos em memória (debug).
     */
    listar() {
      const out = [];
      for (const p of planos.values()) {
        const snap = snapshotPlano(p);
        if (snap) out.push(snap);
      }
      return out;
    }
  };
})();

// Suporte a Node para testes unitários (não interfere no Chrome Extension).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PlanExecutor;
}
