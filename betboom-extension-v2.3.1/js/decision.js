/**
 * BetBoom Auto Pattern — Decision Engine
 * Motor de decisão: avalia padrões, calcula stake, aplica martingale,
 * gerencia stop win/loss e decide se deve apostar.
 */

const DecisionEngine = (() => {
  function createInitialState() {
    return {
      bancaAtual: 0,
      lucroSessao: 0,
      galeAtual: 0,
      stakeAtual: 0,
      ultimaAposta: null,
      apostasRealizadas: 0,
      vitorias: 0,
      derrotas: 0,
      empatesGanhos: 0,
      ties: 0,
      abortosExecucao: 0,
      totalEntradas: 0,
      entradasAutomaticas: 0,
      entradasManuais: 0,
      sequenciaAtual: 0,
      ultimaDecisao: null,
      ultimaEntradaOperacional: null,
      ultimaEntradaResolvida: null,
      entradasOperacionais: [],
      isAtivo: false,
      isPausado: false,
      motivoParada: null
    };
  }

  let state = createInitialState();

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeCor(value) {
    if (typeof BBStrategyUtils !== 'undefined' && BBStrategyUtils.normalizeCor) {
      return BBStrategyUtils.normalizeCor(value);
    }
    return value || null;
  }

  function ensureRoundId(meta = {}) {
    return meta.roundId || CONFIG.roundIdAtual || `sem-round-${Date.now()}`;
  }

  function getEntryLabel(cor) {
    if (typeof BBStrategyUtils !== 'undefined' && BBStrategyUtils.getEntryLabel) {
      return BBStrategyUtils.getEntryLabel(cor);
    }
    return cor || '—';
  }

  function getDetectedStrategies() {
    if (typeof PatternEngine !== 'undefined' && PatternEngine.getLastDetectedStrategies) {
      return PatternEngine.getLastDetectedStrategies();
    }
    return [];
  }

  function getStrategyPerformance(pattern) {
    if (!pattern || typeof ObservabilityEngine === 'undefined' || !ObservabilityEngine.getSnapshot) {
      return null;
    }

    const metrics = ObservabilityEngine.getSnapshot()?.session?.strategyMetrics || [];
    return metrics.find((metric) => {
      if (!metric) return false;
      if (pattern.strategyId && metric.strategyId === pattern.strategyId) return true;
      return metric.nome === pattern.nome;
    }) || null;
  }

  function buildTechnicalRead() {
    return {
      channels: Array.isArray(CONFIG.canaisWSAtivos) ? [...CONFIG.canaisWSAtivos] : [],
      wsDadosRecebidos: CONFIG.wsDadosRecebidos === true,
      overlayReady: CONFIG.overlayReady === true,
      saldoDisponivel: Number.isFinite(Number(CONFIG.saldoReal)),
      resultadoConfirmadoDisponivel: Boolean(CONFIG.ultimoResultadoConfirmado),
      estadoRodada: CONFIG.estadoRodadaAtual || null
    };
  }

  function aplicarBloqueioOperacionalNoModelo(model, reason) {
    if (!model) return null;
    return {
      ...model,
      riscoOperacional: 'alto',
      recomendacaoOperacional: 'nao-va',
      decisaoFinal: 'abortada',
      justificativas: [...(Array.isArray(model.justificativas) ? model.justificativas : []), reason].slice(-8)
    };
  }

  function calcularStake() {
    // Regra: extensão NUNCA bloqueia por banca. Quem aceita ou recusa é a casa.
    // O stake reflete a estratégia (base + gale), independente do saldo real.
    let stake = CONFIG.stakeInicial;
    for (let i = 0; i < state.galeAtual; i++) {
      stake *= CONFIG.galeMultiplier;
    }
    stake = Math.min(stake, CONFIG.stakeMax);
    // 🛑 SAFETY CAP: nunca aposta mais que stakeInicial × stakeCapMultiplier.
    // Default 10 = teto absoluto de R$50 enquanto calibragem está em curso.
    const cap = Number(CONFIG.stakeCapMultiplier) > 0
      ? Number(CONFIG.stakeInicial) * Number(CONFIG.stakeCapMultiplier)
      : Infinity;
    stake = Math.min(stake, cap);
    // Garantia: stake mínimo 1 — nunca zero (impediria armar decisão).
    return Math.max(stake, 1);
  }

  function verificarStopWin() {
    if (state.lucroSessao >= CONFIG.stopWin) {
      state.motivoParada = `Stop Win atingido: R$${state.lucroSessao.toFixed(2)} >= R$${CONFIG.stopWin}`;
      return true;
    }
    return false;
  }

  function verificarStopLoss() {
    if (Math.abs(state.lucroSessao) >= CONFIG.stopLoss && state.lucroSessao < 0) {
      state.motivoParada = `Stop Loss atingido: R$${state.lucroSessao.toFixed(2)} <= -R$${CONFIG.stopLoss}`;
      return true;
    }
    return false;
  }

  function verificarTrailingStop() {
    const trail = Number(CONFIG.trailingStop) || 0;
    if (trail <= 0) return false;
    if (typeof state.picoLucro !== 'number') state.picoLucro = 0;
    if (state.lucroSessao > state.picoLucro) state.picoLucro = state.lucroSessao;
    const recuo = state.picoLucro - state.lucroSessao;
    if (state.picoLucro > 0 && recuo >= trail) {
      state.motivoParada = `Trailing Stop: pico R$${state.picoLucro.toFixed(2)} recuou R$${recuo.toFixed(2)} (limite R$${trail})`;
      return true;
    }
    return false;
  }

  function gerarExplicacaoNatural(padrao, f1ScoreResult, decisionModel) {
    const partes = [];
    if (padrao?.nome) partes.push(padrao.nome);
    if (padrao?.confianca != null) partes.push(`${Math.round(padrao.confianca)}%`);
    const f1 = Number(f1ScoreResult?.score);
    if (Number.isFinite(f1)) {
      if (f1 >= 70) partes.push('sinal forte');
      else if (f1 >= 50) partes.push('sinal moderado');
      else partes.push('sinal fraco');
    }
    const ctx = decisionModel?.contextoMesa;
    if (ctx && ctx !== 'neutra') partes.push(`contexto ${ctx}`);
    const risco = decisionModel?.riscoOperacional;
    if (risco === 'alto') partes.push('risco alto');
    return partes.join(' · ') || 'Padrão detectado';
  }

  function verificarBanca() {
    // Extensão NUNCA bloqueia por banca. Quem aceita ou recusa o clique é a casa.
    return false;
  }

  function deveParar() {
    return verificarStopWin() || verificarStopLoss() || verificarTrailingStop() || verificarBanca();
  }

  function trimEntradas() {
    if (state.entradasOperacionais.length > 500) {
      state.entradasOperacionais = state.entradasOperacionais.slice(-500);
    }
  }

  function findEntryIndexByRoundId(roundId, options = {}) {
    if (!roundId) return -1;

    const {
      includeAborted = true,
      onlyPending = false,
      onlyExecuted = false
    } = options;

    return state.entradasOperacionais.findIndex((entry) => {
      if (entry.roundId !== roundId) return false;
      if (!includeAborted && entry.statusFinal === 'abortada') return false;
      if (onlyPending && entry.statusFinal !== 'pendente') return false;
      if (onlyExecuted && entry.statusInicial !== 'executada') return false;
      return true;
    });
  }

  function hasTentativaParaRound(roundId) {
    return findEntryIndexByRoundId(roundId, { includeAborted: true }) >= 0;
  }

  function hasEntradaExecutadaParaRound(roundId) {
    return findEntryIndexByRoundId(roundId, { includeAborted: false, onlyExecuted: true }) >= 0;
  }

  function createEntry(meta = {}) {
    const timestampEntrada = meta.timestampEntrada || Date.now();
    const tipoEntrada = meta.tipoEntrada === 'manual' ? 'manual' : 'automatica';
    const entradaExecutada = normalizeCor(meta.entradaExecutada || meta.cor || meta.entradaSugerida) || null;
    const statusInicial = meta.statusInicial === 'abortada' ? 'abortada' : 'executada';
    const statusFinal = meta.statusFinal || (statusInicial === 'executada' ? 'pendente' : 'abortada');
    const gale = Number.isFinite(Number(meta.gale)) ? Number(meta.gale) : 0;
    const stake = Number.isFinite(Number(meta.stake ?? meta.valor)) ? Number(meta.stake ?? meta.valor) : 0;
    const valorProtecao = Number.isFinite(Number(meta.valorProtecao)) ? Number(meta.valorProtecao) : 0;

    return {
      id: meta.id || `entry-${timestampEntrada}-${Math.random().toString(16).slice(2, 8)}`,
      roundId: ensureRoundId(meta),
      rodada: meta.rodada ?? null,
      tipoEntrada,
      estrategia: meta.estrategia || meta.strategyName || null,
      strategyId: meta.strategyId || null,
      origem: meta.origem || meta.strategySource || null,
      sequenciaReconhecida: meta.sequenciaReconhecida || meta.recognizedSequence || null,
      entradaSugerida: normalizeCor(meta.entradaSugerida || entradaExecutada) || null,
      entradaExecutada,
      gale,
      protecaoEmpate: meta.protecaoEmpate === true,
      valorProtecao,
      stake,
      timestampEntrada,
      statusInicial,
      statusExecucao: meta.statusExecucao || statusFinal,
      statusFinal,
      resultadoRodada: meta.resultadoRodada || null,
      resultadoLabel: meta.resultadoLabel || null,
      targetVisualConfirmado: typeof meta.targetVisualConfirmado === 'boolean' ? meta.targetVisualConfirmado : null,
      targetVisualCor: meta.targetVisualCor || null,
      targetVisualTexto: meta.targetVisualTexto || null,
      targetSelector: meta.targetSelector || null,
      observacao: meta.observacao || null
    };
  }

  function registrarEntradaOperacional(meta = {}) {
    const roundId = ensureRoundId(meta);
    const statusInicial = meta.statusInicial === 'abortada' ? 'abortada' : 'executada';

    if (statusInicial === 'executada' && hasEntradaExecutadaParaRound(roundId)) {
      Logger.warn(`Entrada duplicada ignorada para a rodada ${roundId}`);
      return null;
    }

    if (statusInicial === 'abortada' && hasTentativaParaRound(roundId)) {
      Logger.warn(`Abortar duplicado ignorado para a rodada ${roundId}`);
      return null;
    }

    const entry = createEntry({ ...meta, roundId, statusInicial });
    state.entradasOperacionais.push(entry);
    trimEntradas();
    state.ultimaEntradaOperacional = entry;

    if (entry.statusInicial === 'executada') {
      state.totalEntradas = (state.totalEntradas || 0) + 1;
      state.apostasRealizadas = state.totalEntradas;
      if (entry.tipoEntrada === 'manual') {
        state.entradasManuais = (state.entradasManuais || 0) + 1;
      } else {
        state.entradasAutomaticas = (state.entradasAutomaticas || 0) + 1;
      }
      state.stakeAtual = entry.stake;
      state.ultimaAposta = entry;
    } else {
      state.abortosExecucao += 1;
    }

    return clone(entry);
  }

  function calcularLiquidacao(entry, resultadoCor) {
    // Validação crítica: resultado nulo/undefined não pode liquidar como win
    const corValida = normalizeCor(resultadoCor);
    if (!corValida) {
      Logger.warn(`calcularLiquidacao: resultadoCor inválido ("${resultadoCor}") — liquidação adiada.`);
      return null; // null = não liquidar ainda, aguardar resultado real
    }

    const custoPrincipal = Number(entry.stake || 0);
    const custoProtecao = entry.protecaoEmpate ? Number(entry.valorProtecao || 0) : 0;
    const custoTotal = custoPrincipal + custoProtecao;

    if (corValida === entry.entradaExecutada) {
      if (resultadoCor === 'empate') {
        return {
          lucro: (custoPrincipal * 14) - custoProtecao,
          statusFinal: 'tie'
        };
      }

      return {
        lucro: custoPrincipal - custoProtecao,
        statusFinal: 'win'
      };
    }

    if (corValida === 'empate') {
      if (entry.protecaoEmpate && custoProtecao > 0 && entry.entradaExecutada !== 'empate') {
        return {
          lucro: (custoProtecao * 14) - custoPrincipal,
          statusFinal: 'tie'
        };
      }

      return {
        lucro: -custoTotal,
        statusFinal: 'tie'
      };
    }

    return {
      lucro: -custoTotal,
      statusFinal: 'loss'
    };
  }

  function atualizarSequenciaEGale(entry, statusFinal) {
    if (statusFinal === 'win') {
      state.vitorias += 1;
      state.sequenciaAtual = Math.max(0, state.sequenciaAtual) + 1;
      state.galeAtual = 0;
      return;
    }

    if (statusFinal === 'loss') {
      state.derrotas += 1;
      state.sequenciaAtual = Math.min(0, state.sequenciaAtual) - 1;
      const maxGalesPermitido = Number.isFinite(Number(entry.gale)) ? Number(entry.gale) : CONFIG.maxGales;
      if (state.galeAtual < maxGalesPermitido) {
        state.galeAtual += 1;
        Logger.info(`LOSS! Aplicando Gale ${state.galeAtual}/${maxGalesPermitido}`);
      } else {
        state.galeAtual = 0;
        Logger.warn('LOSS! Gale máximo atingido. Resetando.');
      }
      return;
    }

    state.ties += 1;
    state.empatesGanhos = state.ties;
    state.sequenciaAtual = 0;
    state.galeAtual = 0;
  }

  function formatResultadoLabel(resultado = {}) {
    const vencedor = resultado.vencedor || resultado.resultadoRodada || resultado.cor || '—';
    const player = resultado.playerScore ?? '?';
    const banker = resultado.bankerScore ?? '?';
    return `${vencedor} ${player}x${banker}`;
  }

  return {
    iniciar(bancaInicial) {
      state = createInitialState();
      state.bancaAtual = bancaInicial || CONFIG.bancaInicial;
      state.stakeAtual = CONFIG.stakeInicial;
      state.totalEntradas = 0;
      state.entradasAutomaticas = 0;
      state.entradasManuais = 0;
      state.isAtivo = true;
      Logger.info(`Decision Engine iniciado. Banca: R$${state.bancaAtual.toFixed(2)}`);
    },

    async decidir(coresRecentes) {
      console.log(`[DECISOR-TRIGGER] decidir() invocado para rodada ${CONFIG.roundIdAtual || '—'}`);
      console.log(`[DECISOR-DEBUG] decidir() chamado | isAtivo=${state.isAtivo} | isPausado=${state.isPausado} | motivoParada=${state.motivoParada} | banca=R$${state.bancaAtual} | cores=${coresRecentes?.length || 0}`);
      if (!state.isAtivo || state.isPausado) {
        console.log(`[DECISOR-DEBUG] ABORT: sistema inativo/pausado (isAtivo=${state.isAtivo}, isPausado=${state.isPausado})`);
        return { deveApostar: false, motivo: state.motivoParada || 'Sistema inativo/pausado' };
      }

      if (deveParar()) {
        console.log(`[DECISOR-DEBUG] ABORT: deveParar() = true | motivo=${state.motivoParada}`);
        state.isAtivo = false;
        Logger.warn(`Parando: ${state.motivoParada}`);
        return { deveApostar: false, motivo: state.motivoParada };
      }

      const roundId = ensureRoundId();
      const grafo = typeof FSMIntegration !== 'undefined' ? FSMIntegration.criarGrafo(roundId, coresRecentes) : null;

      const melhorPadrao = PatternEngine.melhorPadrao(coresRecentes);
      if (!melhorPadrao) {
        console.log(`[DECISOR-DEBUG] ABORT: melhorPadrao=null (PatternEngine não retornou padrão)`);
        Logger.debug('Nenhum padrão detectado. Aguardando...');
        state.ultimaDecisao = null;
        if (grafo && typeof DecisionGraphEngine !== 'undefined') {
          DecisionGraphEngine.updateNode(grafo.id, 'PATTERN_MATCHED', {
            status: 'skipped',
            reason: 'Nenhum padrão detectado'
          });
        }
        return { deveApostar: false, motivo: 'Nenhum padrão detectado' };
      }
      console.log(`[DECISOR-DEBUG] melhorPadrao=${melhorPadrao.nome} → ${melhorPadrao.acao} (conf=${melhorPadrao.confianca}%)`);

      // R6.1: F1 gate PREVIEW (antes de IdempotencyLayer/EvidenceEngine).
      // Se gate vai abortar, não persistir suggestion_made — replays/métricas
      // sujavam. Calcula F1 cedo só pra checagem; cálculo final acontece igual abaixo.
      const f1MinPreview = Number(CONFIG.f1MinScore) || 0;
      if (f1MinPreview > 0 && typeof F1Scorer !== 'undefined') {
        const preview = F1Scorer.scoreDecision({
          estrategia: melhorPadrao.nome,
          strategyId: melhorPadrao.strategyId || null,
          confianca: melhorPadrao.confianca || 0,
          decisionModel: null
        });
        if (preview && Number(preview.score) < f1MinPreview) {
          console.log(`[DECISOR] gate F1 PREVIEW (${preview.score} < ${f1MinPreview}) — abortando antes de persistir sugestão`);
          Logger.warn(`Gate F1 (preview) ativo: ${preview.score} < ${f1MinPreview} → abortando rodada ${roundId}`);
          state.ultimaDecisao = null;
          return { deveApostar: false, motivo: `F1 score abaixo do mínimo: ${preview.score}` };
        }
      }

      // Registrar sugestão no IdempotencyLayer para este roundId
      if (typeof IdempotencyLayer !== 'undefined') {
        const idempResult = IdempotencyLayer.registerSuggestion(
          roundId,
          melhorPadrao.nome,
          melhorPadrao.confianca || 0,
          melhorPadrao.acao
        );
        if (!idempResult.ok && idempResult.motivo === 'sugestao-duplicada') {
          console.log(`[DECISOR-DEBUG] ABORT: sugestão duplicada para round ${roundId}`);
          Logger.warn(`Sugestão duplicada para rodada ${roundId}. Ignorando.`);
          return { deveApostar: false, motivo: 'Sugestão duplicada bloqueada', padrao: melhorPadrao };
        }
      }

      // Registrar sugestão na evidência
      if (typeof EvidenceEngine !== 'undefined') {
        EvidenceEngine.onNovaRodada(roundId);
        EvidenceEngine.recordSuggestion(melhorPadrao.nome, melhorPadrao.confianca || 0, melhorPadrao.acao);
      }

      const decisionModel = typeof CanonicalDecisionEngine !== 'undefined' && CanonicalDecisionEngine.build
        ? CanonicalDecisionEngine.build({
          roundId: CONFIG.roundIdAtual || null,
          history: coresRecentes,
          detectedPattern: melhorPadrao,
          detectedStrategies: getDetectedStrategies(),
          estadoRodada: CONFIG.estadoRodadaAtual || null,
          technicalRead: buildTechnicalRead(),
          strategyPerformance: getStrategyPerformance(melhorPadrao),
          secondaryGraph: CONFIG.secondaryGraphSnapshot || null
        })
        : null;

      if (decisionModel?.decisaoFinal === 'abortada') {
        Logger.warn(`Decisão canônica diria abortada: ${decisionModel.justificativas?.[0]} — extensão NÃO bloqueia, fluxo continua`);
      }

      // Guardrails do Semáforo Básico — apenas observa, não bloqueia
      const semaforo = this.getSemaforoInfo(coresRecentes, melhorPadrao);
      if (semaforo.score < 60) {
        Logger.warn(`Semáforo baixo (${semaforo.score}): ${semaforo.motivos[0]} — extensão NÃO bloqueia, fluxo continua`);
      }

      const stake = calcularStake();
      console.log(`[DECISOR-DEBUG] stake calculado=R$${stake}`);
      // Extensão NUNCA bloqueia por banca/stake. calcularStake já garante mínimo 1.
      // Se stake é 0 por algum motivo extremo, apenas loga warning e segue.
      if (stake <= 0) {
        Logger.warn(`Stake zero detectado (CONFIG.stakeInicial=${CONFIG.stakeInicial}) — extensão NÃO bloqueia, prosseguindo com 1.`);
      }

      // Calcular F1 Score para esta decisão
      let f1ScoreResult = null;
      if (typeof F1Scorer !== 'undefined') {
        const decisaoTemp = {
          estrategia: melhorPadrao.nome,
          strategyId: melhorPadrao.strategyId || null,
          confianca: melhorPadrao.confianca || 0,
          decisionModel
        };
        f1ScoreResult = F1Scorer.scoreDecision(decisaoTemp);
        Logger.info(`F1 Score: ${f1ScoreResult.score} (${f1ScoreResult.recomendacao}) | Motivos: ${f1ScoreResult.motivos.join(', ')}`);

        // F1 Score apenas observa, não bloqueia
        if (f1ScoreResult.score < 30) {
          Logger.warn(`F1 Score baixo (${f1ScoreResult.score}) — extensão NÃO bloqueia, fluxo continua`);
        }
      }

      // R6/Fix-3: gate F1 OPT-IN. Default CONFIG.f1MinScore=0 mantém o comportamento
      // histórico ("extensão NUNCA bloqueia"). Quando o operador eleva para, ex.,
      // 50, decisões com score abaixo desse piso passam a ser abortadas para
      // proteger a banca em rodadas com sinal fraco.
      const f1Min = Number(CONFIG.f1MinScore) || 0;
      if (f1Min > 0 && f1ScoreResult && Number(f1ScoreResult.score) < f1Min) {
        console.log(`[DECISOR] gate F1 (${f1ScoreResult.score} < ${f1Min}) — abortando`);
        Logger.warn(`Gate F1 ativo: score ${f1ScoreResult.score} < piso ${f1Min} → abortando rodada ${roundId}`);
        state.ultimaDecisao = null;
        return { deveApostar: false, motivo: `F1 score abaixo do mínimo: ${f1ScoreResult.score}` };
      }

      const maxGalesPermitido = Math.min(
        Number.isFinite(Number(melhorPadrao.maxGalesPermitido))
          ? Number(melhorPadrao.maxGalesPermitido)
          : CONFIG.maxGales,
        Number(CONFIG.maxGales || 0)
      );
      const protecaoEmpate = melhorPadrao.acao !== 'empate' &&
        ((typeof melhorPadrao.usarProtecaoEmpate === 'boolean'
          ? melhorPadrao.usarProtecaoEmpate
          : CONFIG.protegerEmpate));
      const valorProtecao = protecaoEmpate ? CONFIG.valorProtecaoEmpate : 0;

      Logger.info(
        `Decisão: ${melhorPadrao.nome} → ${melhorPadrao.acao} | ` +
        `Contexto=${decisionModel?.contextoMesa || 'neutra'} | ` +
        `Risco=${decisionModel?.riscoOperacional || 'medio'} | ` +
        `Recomendação=${decisionModel?.recomendacaoOperacional || 'cautela'} | ` +
        `Stake: R$${stake} | Origem: ${melhorPadrao.source || 'legacy'}`
      );

      if (grafo && typeof FSMIntegration !== 'undefined') {
        const fsmResult = await FSMIntegration.executarFluxoCompleto(roundId, coresRecentes);
        if (fsmResult && typeof ReplayEngine !== 'undefined') {
          ReplayEngine.registrarSnapshot(roundId, fsmResult, {
            padraoDetectado: melhorPadrao,
            contextualData: {
              stake,
              protecaoEmpate,
              maxGalesPermitido
            }
          }, {
            cor: melhorPadrao.acao,
            padrao: melhorPadrao.nome
          });
        }
      }

      // Identificadores canonicos para integracao com RoundLifecycle/PlanExecutor
      const padraoIdResolvido = melhorPadrao.strategyId
        || melhorPadrao.id
        || melhorPadrao.nome
        || null;
      const confiancaResolvida = (melhorPadrao.confianca != null)
        ? Number(melhorPadrao.confianca)
        : null;

      state.ultimaDecisao = {
        strategyId: melhorPadrao.strategyId || melhorPadrao.id || null,
        padraoId: padraoIdResolvido,
        confianca: confiancaResolvida,
        nome: melhorPadrao.nome,
        source: melhorPadrao.source || 'legacy',
        recognizedSequence: melhorPadrao.recognizedSequence || melhorPadrao.sequenceBase || '',
        cor: melhorPadrao.acao,
        maxGalesPermitido,
        usarProtecaoEmpate: protecaoEmpate,
        observacao: melhorPadrao.observacao || '',
        decisionModel,
        f1Score: f1ScoreResult?.score || null,
        f1ScoreResult: f1ScoreResult || null,
        fsmGrafo: grafo?.id || null
      };

      const explicacaoNatural = gerarExplicacaoNatural(melhorPadrao, f1ScoreResult, decisionModel);
      const convictionScore = Number.isFinite(Number(decisionModel?.convictionScore))
        ? Number(decisionModel.convictionScore)
        : (Number.isFinite(confiancaResolvida) ? confiancaResolvida : 0);
      const autoExecuteThreshold = Number(CONFIG.autoExecuteThreshold) || 85;
      const autoExecute = convictionScore >= autoExecuteThreshold;

      console.log(`[DECISOR-DEBUG] ✅ DECISÃO PRONTA: ${melhorPadrao.nome} → ${melhorPadrao.acao} | stake=R$${stake} | conviction=${convictionScore}% | autoExecute=${autoExecute} | ${explicacaoNatural}`);
      return {
        deveApostar: true, // Extensão NUNCA bloqueia — sempre arma. Quem decide aceitar/recusar é a casa.
        cor: melhorPadrao.acao,
        stake,
        protecaoEmpate,
        valorProtecao,
        maxGalesPermitido,
        recognizedSequence: melhorPadrao.recognizedSequence || '',
        source: melhorPadrao.source || 'legacy',
        observacao: melhorPadrao.observacao || '',
        padrao: melhorPadrao,
        // Identificadores canonicos para PlanExecutor / RoundLifecycle
        padraoId: padraoIdResolvido,
        confianca: confiancaResolvida,
        motivo: `Padrão: ${melhorPadrao.nome} (F1: ${f1ScoreResult?.score || 'N/A'})`,
        decisionModel,
        f1Score: f1ScoreResult?.score || null,
        f1ScoreResult: f1ScoreResult || null,
        fsmGrafo: grafo?.id || null,
        // Explicabilidade + HITL bifurcação
        explicacaoNatural,
        convictionScore,
        autoExecute
      };
    },

    registrarResultado(resultadoMesa) {
      return this.registrarResultadoConfirmado({
        cor: normalizeCor(resultadoMesa),
        roundId: state.ultimaAposta?.roundId || CONFIG.roundIdAtual || null
      });
    },

    registrarResultadoConfirmado(resultado) {
      const resultadoCor = normalizeCor(resultado?.cor || resultado?.resultadoRodada || resultado);
      if (!resultadoCor) return null;

      const roundId = resultado?.roundId || resultado?.gameId || state.ultimaAposta?.roundId || null;
      let index = findEntryIndexByRoundId(roundId, { includeAborted: false, onlyPending: true, onlyExecuted: true });
      if (index < 0) {
        index = state.entradasOperacionais.findIndex((entry) => entry.statusInicial === 'executada' && entry.statusFinal === 'pendente');
      }
      if (index < 0) return null;

      const entry = state.entradasOperacionais[index];
      const liquidacao = calcularLiquidacao(entry, resultadoCor);

      // Se liquidacao for null, resultadoCor era inválido — não registrar
      if (!liquidacao) {
        Logger.warn(`registrarResultadoConfirmado: liquidação nula para roundId=${roundId}. Ignorando.`);
        return null;
      }

      entry.resultadoRodada = resultadoCor;
      entry.resultadoLabel = formatResultadoLabel(resultado);
      entry.statusFinal = liquidacao.statusFinal;
      entry.statusExecucao = 'resultado-confirmado';
      entry.timestampResultado = Date.now();
      entry.playerScore = resultado?.playerScore ?? null;
      entry.bankerScore = resultado?.bankerScore ?? null;
      entry.vencedor = resultado?.vencedor || null;

      state.bancaAtual += liquidacao.lucro;
      state.lucroSessao += liquidacao.lucro;
      atualizarSequenciaEGale(entry, liquidacao.statusFinal);
      state.ultimaEntradaResolvida = clone(entry);

      if (typeof FSMIntegration !== 'undefined') {
        FSMIntegration.registrarResultado(entry.roundId, resultadoCor);
      }

      // Atualizar métricas de estratégia no F1Scorer
      if (typeof F1Scorer !== 'undefined' && entry.estrategia) {
        F1Scorer.updateStrategyResult(entry.strategyId, entry.estrategia, liquidacao.statusFinal);
      }

      if (typeof TableDegradationEngine !== 'undefined' && entry.estrategia) {
        TableDegradationEngine.registrarResultadoPadrao(entry.estrategia, liquidacao.statusFinal === 'win' ? 'win' : 'loss');
      }

      if (typeof PatternEntropyEngine !== 'undefined' && entry.estrategia) {
        PatternEntropyEngine.registrarPadraoDetectado(entry.estrategia);
      }

      if (state.ultimaAposta?.id === entry.id) {
        state.ultimaAposta = null;
      }

      // Registrar confirmação de resultado na evidência
      if (typeof EvidenceEngine !== 'undefined') {
        EvidenceEngine.recordConfirmation('result-confirmed', Date.now());
      }

      // Registrar resultado no event store
      if (typeof EventStore !== 'undefined') {
        EventStore.addEvent('result_confirmed', {
          roundId: entry.roundId,
          resultado: resultadoCor,
          statusFinal: entry.statusFinal,
          lucro: liquidacao.lucro,
          timestamp: Date.now()
        });
      }

      Logger.info(
        `Resultado conciliado: ${getEntryLabel(entry.entradaExecutada)} → ${entry.statusFinal.toUpperCase()} | ` +
        `Rodada ${entry.roundId} | Lucro: R$${liquidacao.lucro.toFixed(2)}`
      );
      Logger.info(`Banca: R$${state.bancaAtual.toFixed(2)} | Sessão: R$${state.lucroSessao.toFixed(2)}`);

      return clone(entry);
    },

    registrarAposta(cor, valor, protecaoEmpate, valorProtecao, rodada, meta = {}) {
      const roundId = meta.roundId || CONFIG.roundIdAtual || null;

      // Registrar clique no IdempotencyLayer
      if (typeof IdempotencyLayer !== 'undefined') {
        const clickResult = IdempotencyLayer.registerClick(roundId, cor, valor);
        if (!clickResult.ok) {
          Logger.warn(`Clique bloqueado para rodada ${roundId}: ${clickResult.motivo}`);
          return null;
        }
      }

      // Registrar clique na evidência
      if (typeof EvidenceEngine !== 'undefined') {
        EvidenceEngine.recordClickExecuted(cor, valor, 0, 0, true);
      }

      // Registrar evento no event store
      if (typeof EventStore !== 'undefined') {
        EventStore.addEvent('click_registered', {
          roundId,
          alvo: cor,
          stake: valor,
          protecaoEmpate,
          valorProtecao,
          timestamp: Date.now()
        });
      }

      const entry = registrarEntradaOperacional({
        roundId,
        rodada: rodada ?? null,
        tipoEntrada: meta.tipoEntrada || 'automatica',
        estrategia: meta.strategyName || meta.estrategia || null,
        strategyId: meta.strategyId || null,
        origem: meta.strategySource || meta.origem || null,
        sequenciaReconhecida: meta.recognizedSequence || meta.sequenciaReconhecida || '',
        entradaSugerida: meta.entradaSugerida || cor,
        entradaExecutada: cor,
        gale: Number.isFinite(Number(meta.maxGalesPermitido)) ? Number(meta.maxGalesPermitido) : CONFIG.maxGales,
        protecaoEmpate,
        valorProtecao,
        stake: valor,
        timestampEntrada: meta.timestampEntrada || Date.now(),
        statusExecucao: meta.statusExecucao || 'executada',
        targetVisualConfirmado: meta.targetVisualConfirmado,
        targetVisualCor: meta.targetVisualCor || null,
        targetVisualTexto: meta.targetVisualTexto || null,
        targetSelector: meta.targetSelector || null,
        observacao: meta.observacao || null
      });

      return entry;
    },

    registrarEntradaManual(meta = {}) {
      return registrarEntradaOperacional({
        ...meta,
        tipoEntrada: 'manual',
        statusExecucao: meta.statusExecucao || 'manual-registrada'
      });
    },

    registrarExecucaoAbortada(meta = {}) {
      return registrarEntradaOperacional({
        ...meta,
        tipoEntrada: meta.tipoEntrada || 'automatica',
        statusInicial: 'abortada',
        statusFinal: 'abortada',
        statusExecucao: meta.statusExecucao || 'abortada'
      });
    },

    pausar() {
      state.isPausado = true;
      Logger.info('Sistema pausado.');
    },

    retomar() {
      state.isPausado = false;
      state.motivoParada = null;
      Logger.info('Sistema retomado.');
    },

    parar() {
      state.isAtivo = false;
      state.motivoParada = 'Parado pelo usuário';
      Logger.info('Sistema parado pelo usuário.');
    },

    // ---------------------------------------------------------------------
    // Aliases compatíveis com API simplificada (versão Grok).
    // Apenas delegam — não introduzem bloqueio nem mudam comportamento.
    // ---------------------------------------------------------------------
    start(bancaInicial) {
      return this.iniciar(bancaInicial);
    },
    stop() {
      return this.parar();
    },
    async makeDecision(cores) {
      return this.decidir(cores);
    },
    setConfig(novoConfig) {
      try {
        if (novoConfig && typeof CONFIG !== 'undefined' && typeof CONFIG === 'object') {
          Object.assign(CONFIG, novoConfig);
          Logger.info('[DecisionEngine] setConfig aplicado:', Object.keys(novoConfig).join(', '));
        }
      } catch (e) {
        Logger.warn('[DecisionEngine] setConfig falhou:', e?.message || e);
      }
    },

    getState() {
      return clone(state);
    },

    getEstatisticas() {
      const totalResolvido = state.vitorias + state.derrotas;
      const taxaAcerto = totalResolvido > 0 ? ((state.vitorias / totalResolvido) * 100).toFixed(1) : '0.0';

      // Calcular percentuais de sugestão baseado na confiança da decisão
      const percentuaisSugestao = { azul: 0, vermelho: 0, empate: 0 };
      if (state.ultimaDecisao) {
        const confidence = state.ultimaDecisao.decisionModel?.indiceDeConfianca || 0;
        const cor = state.ultimaDecisao.cor;
        if (cor === 'azul') percentuaisSugestao.azul = confidence / 100;
        else if (cor === 'vermelho') percentuaisSugestao.vermelho = confidence / 100;
        else if (cor === 'empate') percentuaisSugestao.empate = confidence / 100;
      }

      return {
        bancaAtual: state.bancaAtual,
        lucroSessao: state.lucroSessao,
        apostasRealizadas: state.apostasRealizadas,
        vitorias: state.vitorias,
        derrotas: state.derrotas,
        empatesGanhos: state.empatesGanhos,
        ties: state.ties,
        totalEntradas: state.totalEntradas || 0,
        entradasAutomaticas: state.entradasAutomaticas || 0,
        entradasManuais: state.entradasManuais || 0,
        wins: state.vitorias,
        losses: state.derrotas,
        abortosExecucao: state.abortosExecucao || 0,
        taxaAcerto,
        sequenciaAtual: state.sequenciaAtual,
        galeAtual: state.galeAtual,
        ultimaDecisao: state.ultimaDecisao,
        percentuaisSugestao,
        ultimaEntradaOperacional: state.ultimaEntradaOperacional ? clone(state.ultimaEntradaOperacional) : null,
        ultimaEntradaResolvida: state.ultimaEntradaResolvida ? clone(state.ultimaEntradaResolvida) : null,
        entradasPendentes: state.entradasOperacionais.filter((entry) => entry.statusInicial === 'executada' && entry.statusFinal === 'pendente').length,
        isAtivo: state.isAtivo,
        isPausado: state.isPausado,
        motivoParada: state.motivoParada
      };
    },

    atualizarConfig(novaConfig) {
      BBConfigUtils.applyRuntimePatch(CONFIG, novaConfig);
      Logger.info('Configurações atualizadas:', novaConfig);
    },

    hasApostaPendente() {
      return state.ultimaAposta !== null && state.ultimaAposta.statusFinal === 'pendente';
    },

    hasEntradaExecutadaParaRound(roundId) {
      return hasEntradaExecutadaParaRound(roundId);
    },

    hasTentativaParaRound(roundId) {
      return hasTentativaParaRound(roundId);
    },

    getEntradaDaRodada(roundId) {
      const index = findEntryIndexByRoundId(roundId, { includeAborted: true });
      return index >= 0 ? clone(state.entradasOperacionais[index]) : null;
    },

    getUltimaAposta() {
      return state.ultimaAposta ? clone(state.ultimaAposta) : null;
    },

    getEntradasOperacionais(limit = null) {
      const list = clone(state.entradasOperacionais);
      if (Number.isFinite(Number(limit)) && Number(limit) > 0) {
        return list.slice(-Number(limit));
      }
      return list;
    },

    getSemaforoInfo(historyToUse, padraoDetectado) {
      const history = historyToUse || (typeof Collector !== 'undefined' ? Collector.getCoresRecentes(20) : []);
      const limpo = history.filter(c => c === 'azul' || c === 'vermelho');
      const ultimos10 = limpo.slice(0, 10);
      const ultimos5 = limpo.slice(0, 5);
      
      let score = 100;
      let motivos = [];

      // Empate nas ultimas 10
      const apenasEmpates = history.slice(0,10).filter(c => c === 'empate').length;
      if (apenasEmpates >= 3) {
        score -= 20;
        motivos.push('- Empate Alto (≥3 nas ultimas 10)');
      }

      // Alternancia alta nas ultimas 10 limpas
      let alternancias = 0;
      for (let i = 0; i < ultimos10.length - 1; i++) {
        if (ultimos10[i] !== ultimos10[i+1]) alternancias++;
      }
      const alternanciaRate = ultimos10.length > 1 ? alternancias / (ultimos10.length - 1) : 0;
      if (alternanciaRate > 0.7) {
        score -= 30;
        motivos.push('- Alternância Alta (>70%) / Mesa Instável');
      }

      // Quebra Recente (ex: vinha padrao e quebrou nos ultimos 3)
      // Heuristica basica: se a ponta (indice 0) mudou oq vinha no 1,2,3
      if (ultimos5.length >= 4) {
        if (ultimos5[1] === ultimos5[2] && ultimos5[1] === ultimos5[3] && ultimos5[0] !== ultimos5[1]) {
          score -= 20;
          motivos.push('- Quebra Recente Detectada');
        }
      }

      // Cooldown de Losses
      if (state.derrotas >= 2 && state.ultimaAposta && state.ultimaAposta.resultadoRodada !== state.ultimaAposta.entradaExecutada) {
        // heuristica simples, sem histórico completo de W/L por timestamp
         // motivos.push('- Cooldown Ativo (2+ losses)');
         // score -= 15;
      }

      // Tendencia Clara (ex: >60% de uma cor nos ultimos 10)
      const azuis = ultimos10.filter(c=>c==='azul').length;
      const vermelhos = ultimos10.filter(c=>c==='vermelho').length;
      if (azuis >= 6 || vermelhos >= 6) {
        score += 20;
        motivos.push('+ Tendência Clara Detectada');
      }

      // Padrao Forte
      if (padraoDetectado) {
        score += 20;
        motivos.push(`+ Padrão Detectado (${padraoDetectado.nome})`);
      } else {
        motivos.push('- Aguardando Padrão');
      }

      score = Math.min(100, Math.max(0, score));

      let status = 'TENEBRA';
      let corHTML = '#0f172a'; // blackish
      if (score >= 70) { status = '🟢 MESA BOA'; corHTML = '#00e676'; }
      else if (score >= 60) { status = '🟡 ATENÇÃO'; corHTML = '#ffd600'; }
      else if (score >= 40) { status = '🔴 BLOQUEADO'; corHTML = '#ff1744'; }
      else { status = '⚫ TENEBRA'; corHTML = '#888'; }

      if (score >= 70 && !padraoDetectado) {
        status = '🟡 AGUARDANDO PADRÃO';
        corHTML = '#ffd600';
      }

      return { score, status, corHTML, motivos };
    }
  };
})();
