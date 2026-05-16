/**
 * BetBoom Auto Pattern — Execution Bot
 * Automação de cliques para realizar apostas na interface web.
 * Inclui randomização de comportamento para anti-bot.
 */

const Executor = (() => {
  let isExecutando = false;
  let lastExecutionMeta = null;

  /**
   * Delay aleatório para simular comportamento humano.
   * Faixa confirmada pelo Diego: 300ms a 800ms.
   */
  function delayAleatorio() {
    const min = 300;
    const max = 800;
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    Logger.debug(`Delay humano aplicado: ${delay}ms`);
    return new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Delay fixo.
   */
  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Encontra um elemento usando múltiplos seletores CSS.
   */
  function encontrarElemento(seletoresStr) {
    const seletores = seletoresStr.split(', ');
    for (const sel of seletores) {
      try {
        const el = document.querySelector(sel.trim());
        if (el && el.offsetParent !== null) { // Visível
          return el;
        }
      } catch (e) {
        // Seletor inválido, ignorar
      }
    }
    return null;
  }

  /**
   * Simula um clique humano com pequena variação de posição.
   */
  function clicarElemento(element) {
    if (!element) return false;

    try {
      // Scroll até o elemento se necessário
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Simular eventos de mouse completos
      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2 + (Math.random() * 4 - 2);
      const y = rect.top + rect.height / 2 + (Math.random() * 4 - 2);

      const eventOptions = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: x,
        clientY: y
      };

      element.dispatchEvent(new MouseEvent('mouseover', eventOptions));
      element.dispatchEvent(new MouseEvent('mousedown', eventOptions));
      element.dispatchEvent(new MouseEvent('mouseup', eventOptions));
      element.dispatchEvent(new MouseEvent('click', eventOptions));

      // Clique nativo como fallback (necessário para Evolution Gaming aceitar o evento)
      element.click();

      return true;
    } catch (e) {
      Logger.error('Erro ao clicar:', e.message);
      return false;
    }
  }

  /**
   * Seleciona a ficha (chip) pelo valor mais próximo disponível.
   * No Bac Bo da Evolution, apostas são feitas clicando em fichas, não em inputs.
   */
  function definirStake(valor) {
    // 1. Tentar encontrar ficha pelo data-automation-id exato (ex: chip-5, chip-25)
    const chipSeletoresExatos = [
      `[data-automation-id="chip-${valor}"]`,
      `[data-id="chip-${valor}"]`,
      `[data-value="${valor}"]`,
      `[data-chip-value="${valor}"]`
    ];

    for (const sel of chipSeletoresExatos) {
      try {
        const chip = document.querySelector(sel);
        if (chip && chip.offsetParent !== null) {
          clicarElemento(chip);
          Logger.debug(`Ficha exata selecionada: R$${valor} via "${sel}"`);
          return true;
        }
      } catch (_) {}
    }

    // 2. Buscar chip por texto (ex: "5", "R$5", "5.00")
    const chipCandidatos = Array.from(document.querySelectorAll(
      '[data-automation-id^="chip-"], [class*="chip"]:not([class*="container"]), [class*="Chip"]:not([class*="Tray"]), [data-role*="chip"], [class*="token"]'
    ));

    // Procurar ficha cujo texto ou valor corresponda ao stake
    const alvos = chipCandidatos
      .map(el => {
        const txt = (el.textContent || '').trim().replace(/[^0-9.]/g, '');
        const num = parseFloat(txt);
        return { el, num, diff: Math.abs(num - valor) };
      })
      .filter(c => !isNaN(c.num) && c.num > 0)
      .sort((a, b) => a.diff - b.diff);

    if (alvos.length > 0) {
      const melhor = alvos[0];
      clicarElemento(melhor.el);
      Logger.debug(`Ficha mais próxima selecionada: R$${melhor.num} (alvo R$${valor})`);
      return true;
    }

    // 3. Fallback: Se for um input real, setar valor via JS (modo legado)
    const input = encontrarElemento(CONFIG.selectors.inputStake);
    if (input && input.tagName === 'INPUT') {
      try {
        input.focus();
        input.value = '';
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, 'value'
        ).set;
        nativeInputValueSetter.call(input, valor.toString());
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
        Logger.debug(`Stake definido via input: R$${valor}`);
        return true;
      } catch (e) {
        Logger.error('Erro ao definir stake via input:', e.message);
      }
    }

    Logger.warn(`Nenhuma ficha encontrada para R$${valor}. Prosseguindo sem definir stake.`);
    return false;
  }

  /**
   * Seleciona o botão de aposta pela cor.
   * Utiliza o DynamicCalibrator (Auto-Healing) se o seletor padrão falhar.
   */
  function selecionarBotaoCor(cor) {
    const seletorPadrao = obterSeletorPorCor(cor);
    
    // Se o Calibrador Dinâmico estiver disponível, usa ele (Auto-Healing)
    if (typeof DynamicCalibrator !== 'undefined') {
      return DynamicCalibrator.resolve(cor, seletorPadrao);
    }
    
    // Fallback para comportamento original
    return encontrarElemento(seletorPadrao);
  }

  function obterSeletorPorCor(cor) {
    switch (cor) {
      case 'vermelho':
        return CONFIG.selectors.btnVermelho;
      case 'azul':
        return CONFIG.selectors.btnAzul;
      case 'empate':
        return CONFIG.selectors.btnEmpate;
      default:
        return null;
    }
  }

  function inferirCorDoBotao(element) {
    if (!element) return null;

    const classes = String(element.className || '').toLowerCase();
    const text = String(element.textContent || '').toLowerCase().trim();
    const dataColor = String(element.getAttribute('data-color') || '').toLowerCase();
    const attrs = [classes, text, dataColor].join(' ');

    if (/(red|vermelho|banker)/.test(attrs)) return 'vermelho';
    if (/(blue|azul|player|black|preto)/.test(attrs)) return 'azul';
    if (/(green|white|tie|empate)/.test(attrs)) return 'empate';
    return null;
  }

  /**
   * Verifica se a mesa está aceitando apostas (período de apostas aberto).
   */
  function mesaAceitandoApostas() {
    const timer = encontrarElemento(CONFIG.selectors.timer);
    if (timer) {
      const texto = timer.textContent.trim();
      // Se o timer mostra tempo > 0, está aceitando
      const numeros = texto.match(/\d+/);
      if (numeros && parseInt(numeros[0]) > 2) {
        return { ok: true, source: 'timer', timer: numeros[0] };
      }
      Logger.debug(`Timer detectado, mas valor insuficiente: ${texto}`);
    } else {
      Logger.debug('Timer não encontrado no DOM');
    }

    // Verificar se botões de aposta estão habilitados
    const btnVermelho = selecionarBotaoCor('vermelho');
    const btnAzul = selecionarBotaoCor('azul');

    if (btnVermelho && !btnVermelho.disabled) {
      Logger.debug('Mesa confirmada via botão Vermelho (não desabilitado)');
      return { ok: true, source: 'btn-vermelho' };
    }
    if (btnAzul && !btnAzul.disabled) {
      Logger.debug('Mesa confirmada via botão Azul (não desabilitado)');
      return { ok: true, source: 'btn-azul' };
    }

    const reason = !btnVermelho && !btnAzul ? 'botoes-ausentes' : 'botoes-desabilitados';
    return { ok: false, source: null, reason: `mesa-nao-confirmada-aberta (${reason})` };
  }

  // --- API Pública ---
  return {
    /**
     * Executa uma aposta completa.
     * @param {Object} decisao - Objeto retornado pelo DecisionEngine.decidir()
     * @returns {Promise<boolean>} - Se a aposta foi realizada com sucesso
     */
    async executarAposta(decisao) {
      console.log(`[EXEC-DEBUG] executarAposta INICIO | cor=${decisao?.cor} | stake=${decisao?.stake} | deveApostar=${decisao?.deveApostar} | isExecutando=${isExecutando} | modoTeste=${CONFIG.modoTeste} | estadoRodada=${CONFIG.estadoRodadaAtual}`);
      if (isExecutando) {
        console.log('[EXEC-DEBUG] ABORT: já está executando outra aposta');
        Logger.warn('Já existe uma aposta em execução.');
        return false;
      }

      if (!decisao || !decisao.deveApostar) {
        console.log(`[EXEC-DEBUG] ABORT: decisao=${!!decisao} | deveApostar=${decisao?.deveApostar}`);
        return false;
      }

      // 🛑 SAFETY CAP ABSOLUTO — impede aposta acidental >> stakeInicial.
      // Ex: gale exponencial ou ficha errada (idx=0 pode ser R$5000 em mesas live-high).
      // Limite default: 10x stakeInicial. Ajustável via CONFIG.stakeCapMultiplier.
      const stakeInicialSafe = Math.max(Number(CONFIG.stakeInicial) || 5, 1);
      const cap = stakeInicialSafe * (Number(CONFIG.stakeCapMultiplier) || 10);
      const stakeNum = Number(decisao.stake) || 0;
      if (stakeNum > cap) {
        console.error(`[EXEC-SAFETY] 🛑 APOSTA BLOQUEADA: stake R$${stakeNum} > cap R$${cap} (stakeInicial=R$${stakeInicialSafe} × ${CONFIG.stakeCapMultiplier || 10})`);
        Logger.error(`SAFETY CAP: aposta de R$${stakeNum} bloqueada (max permitido R$${cap}). Reset gale via DecisionEngine.resetGale() ou ajuste CONFIG.stakeCapMultiplier.`);
        lastExecutionMeta.statusExecucao = 'bloqueada-safety-cap';
        return false;
      }

      // ----------------------------------------------------------------------
      // TODO: integrar com PlanExecutor — manter fluxo legado por enquanto.
      //
      // O refactor para delegar o clique ao PlanExecutor (com criarPlano +
      // executar) e invasivo demais para fazer agora sem testes de regressao
      // do fluxo de clique. A integracao via Lifecycle (RoundLifecycle.start/
      // transition/end) ja cobre a parte de eventos persistidos no EventStore,
      // e os adapters de calibracao consomem dali.
      //
      // Quando for o momento, o esboco e:
      //   if (typeof PlanExecutor !== 'undefined'
      //       && typeof LifecycleGate !== 'undefined'
      //       && LifecycleGate.getCurrentRoundId()) {
      //     const plano = PlanExecutor.criarPlano(decisao, { executionMode: 'live' });
      //     if (plano) {
      //       const resultado = await PlanExecutor.executar(plano, async (step) => {
      //         // ... executar cada step (clique de chip, clique de cor, confirmar)
      //         // reaproveitando a logica atual.
      //       });
      //       return !!(resultado && resultado.ok);
      //     }
      //   }
      // ----------------------------------------------------------------------

      const executionStartTime = Date.now();
      const telemetryOp = typeof TelemetryCollector !== 'undefined'
        ? TelemetryCollector.startOperation('click_execution')
        : null;

      isExecutando = true;
      lastExecutionMeta = {
        statusExecucao: 'iniciada',
        stake: Number(decisao.stake || 0),
        alvoAposta: decisao.cor || null,
        roundId: CONFIG.roundIdAtual || null,
        targetSelector: obterSeletorPorCor(decisao.cor),
        targetVisualConfirmado: null,
        targetVisualCor: null,
        targetVisualTexto: null,
        clickTimestamp: null,
        protecaoEmpate: decisao.protecaoEmpate === true
      };

      try {
        if (CONFIG.modoTeste) {
          console.log('[EXEC-DEBUG] ABORT: modoTeste ativo');
          Logger.warn('Execução real bloqueada: modoTeste está ativo.');
          lastExecutionMeta.statusExecucao = 'bloqueada-modo-teste';
          isExecutando = false;
          return false;
        }

        if (CONFIG.estadoRodadaAtual !== 'apostando') {
          // Relaxamento: Se o timer estiver visível e > 2s, permitimos o clique mesmo se o WS não atualizou o estado
          const mesaStatus = mesaAceitandoApostas();
          if (mesaStatus.ok) {
            console.log(`[EXEC-DEBUG] estado bypass via DOM (${mesaStatus.source})`);
            Logger.info(`Estado bypass: WS diz ${CONFIG.estadoRodadaAtual}, mas DOM diz Aberto/Timer. Prosseguindo.`);
          } else {
            console.log(`[EXEC-DEBUG] ABORT: estado ${CONFIG.estadoRodadaAtual} + DOM ${mesaStatus.reason}`);
            Logger.warn(`Execução abortada: estado atual = ${CONFIG.estadoRodadaAtual || 'desconhecido'}. Motivo: ${mesaStatus.reason}`);
            lastExecutionMeta.statusExecucao = 'abortado-estado';
            isExecutando = false;
            return false;
          }
        }

        Logger.info(`Executando aposta automática: ${decisao.cor} | R$${decisao.stake}`);
        console.log(`[EXEC-DEBUG] passou todos guards, vai clicar | window.top===window=${window.top === window} | BB_CLICK=${typeof window.BB_CLICK} | BBCalibrator=${typeof window.BBCalibrator}`);

        // 🎯 PRIMEIRO FALLBACK: se operador calibrou coordenadas, usar HARDWARE_CLICK
        // (funciona mesmo se a Evolution for canvas-only ou tiver mudado seletores).
        if (window.top === window
            && typeof window.BBCalibrator !== 'undefined'
            && window.BBCalibrator.temCalibracao()) {
          console.log('[EXEC-DEBUG] 🎯 Usando BBCalibrator (coordenadas calibradas via Hardware Debugger)');
          Logger.info('Delegando execução para BBCalibrator (coordenadas calibradas)');
          // Arma rastreador de confirmacao ANTES do clique
          if (typeof window.BetConfirmationTracker !== 'undefined') {
            try { window.BetConfirmationTracker.armar({ cor: decisao.cor, stake: decisao.stake, roundId: CONFIG.roundIdAtual }); } catch (_) {}
          }
          try {
            const resCal = await window.BBCalibrator.executarAposta(decisao.cor, decisao.stake, { clicarConfirmar: true });
            lastExecutionMeta.statusExecucao = resCal.ok ? 'executado-calibracao' : 'falha-calibracao';
            lastExecutionMeta.roundId = CONFIG.roundIdAtual;
            lastExecutionMeta.calibratorDetail = resCal;
            isExecutando = false;
            return !!resCal.ok;
          } catch (e) {
            console.warn('[EXEC-DEBUG] BBCalibrator falhou, caindo para Bridge:', e?.message);
          }
        }

        // 🌉 BRIDGE JUMP: Se estiver no Top Frame e tivermos o comando de bridge
        if (window.top === window && typeof window.BB_CLICK === 'function') {
          console.log(`[EXEC-DEBUG] BRIDGE JUMP: chamando BB_CLICK("${decisao.cor}", ${decisao.stake})`);
          Logger.info('Delegando execução para Bridge (Iframe)');
          // Arma rastreador de confirmacao ANTES do clique
          if (typeof window.BetConfirmationTracker !== 'undefined') {
            try { window.BetConfirmationTracker.armar({ cor: decisao.cor, stake: decisao.stake, roundId: CONFIG.roundIdAtual }); } catch (_) {}
          }
          window.BB_CLICK(decisao.cor, decisao.stake);

          // No modo bridge, não conseguimos validar visualmente aqui no top frame
          // O resultado virá pelo postMessage e será logado pelo Overlay
          lastExecutionMeta.statusExecucao = 'delegado-bridge';
          lastExecutionMeta.roundId = CONFIG.roundIdAtual;
          isExecutando = false;
          return true;
        }
        console.log('[EXEC-DEBUG] sem Bridge — execução local no DOM');

        // 1. Verificar se a mesa aceita apostas
        const mesaStatus = mesaAceitandoApostas();
        if (!mesaStatus.ok) {
          Logger.warn('Execução bloqueada: mesa não confirmada como aberta');
          lastExecutionMeta.statusExecucao = 'mesa-nao-confirmada-aberta';
          isExecutando = false;
          return false;
        }

        // 2. Delay aleatório (anti-bot)
        await delayAleatorio();

        // 2.5. Validação inteligente de chip e alvo com Camada de Detecção Operacional
        const interactionLog = typeof InteractionIntelligence !== 'undefined'
          ? InteractionIntelligence.detectAndValidateClick(decisao.cor, decisao.stake, {
              confidenceThreshold: 70,
              shadowClick: true,
              useOperationalLayer: true  // Ativa detecção operacional determinística
            })
          : null;

        if (interactionLog) {
          Logger.info(`[Interaction Intelligence] ${JSON.stringify(interactionLog)}`);

          if (!interactionLog.canProceed) {
            Logger.error(`Execução bloqueada pela Interaction Intelligence: ${interactionLog.decisionReason.join('; ')}`);
            lastExecutionMeta.statusExecucao = 'bloqueada-ii';
            lastExecutionMeta.interactionLog = interactionLog;
            isExecutando = false;
            return false;
          }

          lastExecutionMeta.interactionLog = interactionLog;
        }

        // 3. Definir o valor do stake
        const stakeOk = definirStake(decisao.stake);
        if (!stakeOk) {
          Logger.error('Falha ao definir stake.');
          lastExecutionMeta.statusExecucao = 'falha-stake';
          isExecutando = false;
          return false;
        }

        await delay(200);

        // 4. Clicar no botão da cor
        const btnCor = selecionarBotaoCor(decisao.cor);
        if (!btnCor) {
          Logger.error(`Botão de ${decisao.cor} não encontrado.`);
          lastExecutionMeta.statusExecucao = 'falha-botao';
          isExecutando = false;
          return false;
        }

        const corVisual = inferirCorDoBotao(btnCor);
        lastExecutionMeta.targetVisualCor = corVisual;
        lastExecutionMeta.targetVisualTexto = String(btnCor.textContent || '').trim().slice(0, 80) || null;
        lastExecutionMeta.targetVisualConfirmado = corVisual ? corVisual === decisao.cor : null;

        if (!corVisual) {
          if (CONFIG.ignorarConfirmacaoVisual) {
            Logger.info(`Aviso: Alvo não confirmado visualmente, mas prosseguindo via ID (ignorarConfirmacaoVisual: true)`);
          } else {
            Logger.warn('Execução bloqueada: alvo não confirmado visualmente.');
            lastExecutionMeta.statusExecucao = 'alvo-nao-confirmado';
            isExecutando = false;
            return false;
          }
        }

        if (corVisual && corVisual !== decisao.cor) {
          Logger.error(`Divergência visual crítica no alvo! Decisão=${decisao.cor} botão=${corVisual}`);
          // Nunca clicamos se a cor detectada FOR DIFERENTE da desejada (segurança máxima)
          lastExecutionMeta.statusExecucao = 'alvo-divergente';
          isExecutando = false;
          return false;
        }

        Logger.info(`Alvo confirmado: ${decisao.cor} | confirmado=${lastExecutionMeta.targetVisualConfirmado === true ? 'sim' : (lastExecutionMeta.targetVisualConfirmado === false ? 'não' : 'parcial')}`);

        const clicouCor = clicarElemento(btnCor);
        if (!clicouCor) {
          Logger.error(`Falha ao clicar no botão ${decisao.cor}.`);
          lastExecutionMeta.statusExecucao = 'falha-clique';

          // Registrar erro na evidência
          if (typeof EvidenceEngine !== 'undefined') {
            EvidenceEngine.recordError('click_failed', `Falha ao clicar em ${decisao.cor}`, { stake: decisao.stake });
          }

          isExecutando = false;
          return false;
        }
        lastExecutionMeta.clickTimestamp = Date.now();
        lastExecutionMeta.statusExecucao = 'clique-principal-ok';

        // Registrar clique bem-sucedido na evidência
        if (typeof EvidenceEngine !== 'undefined') {
          const rect = btnCor.getBoundingClientRect();
          EvidenceEngine.recordClickExecuted(
            decisao.cor,
            decisao.stake,
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
            true
          );
        }

        Logger.info(`Clique realizado: ${decisao.cor} R$${decisao.stake} ✓`);

        // 5. Proteção de empate (se configurado)
        if (decisao.protecaoEmpate && decisao.valorProtecao > 0) {
          await delay(500);
          await delayAleatorio();

          // Definir valor da proteção
          definirStake(decisao.valorProtecao);
          await delay(200);

          // Clicar no botão de empate
          const btnEmpate = selecionarBotaoCor('empate');
          if (btnEmpate) {
            clicarElemento(btnEmpate);
            lastExecutionMeta.statusExecucao = 'protecao-empate-ok';
            Logger.info(`Proteção empate: R$${decisao.valorProtecao} ✓`);
          } else {
            Logger.warn('Botão de empate não encontrado para proteção.');
            lastExecutionMeta.statusExecucao = 'protecao-empate-parcial';
          }
        }

        // 6. Confirmar aposta (se necessário)
        await delay(300);
        const btnConfirmar = encontrarElemento(CONFIG.selectors.btnConfirmar);
        if (btnConfirmar) {
          await delayAleatorio();
          clicarElemento(btnConfirmar);
          lastExecutionMeta.statusExecucao = 'confirmada';
          Logger.info('Aposta confirmada ✓');
        }

        // 7. Registrar no Decision Engine
        DecisionEngine.registrarAposta(
          decisao.cor,
          decisao.stake,
          decisao.protecaoEmpate,
          decisao.valorProtecao || 0,
          Collector.getRodadaAtual(),
          {
            roundId: CONFIG.roundIdAtual || null,
            maxGalesPermitido: decisao.maxGalesPermitido,
            strategyId: decisao.padrao?.strategyId || null,
            strategyName: decisao.padrao?.nome || null,
            strategySource: decisao.source || decisao.padrao?.source || null,
            recognizedSequence: decisao.recognizedSequence || decisao.padrao?.recognizedSequence || '',
            targetVisualConfirmado: lastExecutionMeta.targetVisualConfirmado,
            targetVisualCor: lastExecutionMeta.targetVisualCor,
            targetVisualTexto: lastExecutionMeta.targetVisualTexto,
            targetSelector: lastExecutionMeta.targetSelector
          }
        );

        Logger.info(`Aposta executada com sucesso: ${decisao.padrao.nome} → ${decisao.cor}`);
        if (lastExecutionMeta.statusExecucao !== 'confirmada') {
          lastExecutionMeta.statusExecucao = 'executada';
        }

        // Registrar telemetria de sucesso
        if (telemetryOp && typeof TelemetryCollector !== 'undefined') {
          TelemetryCollector.endOperation(telemetryOp, true);
        }

        isExecutando = false;
        return true;

      } catch (e) {
        Logger.error('Erro na execução da aposta:', e.message);
        if (lastExecutionMeta) {
          lastExecutionMeta.statusExecucao = 'erro-execucao';
        }

        // Registrar telemetria de erro
        if (telemetryOp && typeof TelemetryCollector !== 'undefined') {
          TelemetryCollector.endOperation(telemetryOp, false, e.message);
        }

        isExecutando = false;
        return false;
      }
    },

    /**
     * Verifica se está executando uma aposta.
     */
    isExecutando() {
      return isExecutando;
    },

    getLastExecutionMeta() {
      return lastExecutionMeta ? { ...lastExecutionMeta } : null;
    },

    /**
     * Verifica se os elementos necessários estão presentes na página.
     */
    verificarElementos() {
      const resultado = {
        inputStake: !!encontrarElemento(CONFIG.selectors.inputStake),
        btnVermelho: !!encontrarElemento(CONFIG.selectors.btnVermelho),
        btnAzul: !!encontrarElemento(CONFIG.selectors.btnAzul),
        btnEmpate: !!encontrarElemento(CONFIG.selectors.btnEmpate),
        timer: !!encontrarElemento(CONFIG.selectors.timer),
        mesaAceitando: mesaAceitandoApostas().ok
      };

      Logger.debug('Verificação de elementos:', resultado);
      return resultado;
    },

    /**
     * Testa a detecção de elementos sem realizar aposta.
     */
    testarDeteccao() {
      const elementos = this.verificarElementos();
      const historicoOk = Collector.isContainerEncontrado();

      return {
        ...elementos,
        historicoContainer: historicoOk,
        pronto: elementos.btnVermelho && elementos.btnAzul && historicoOk
      };
    }
  };
})();
