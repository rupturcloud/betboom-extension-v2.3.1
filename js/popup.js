/**
 * BetBoom Auto Pattern — Popup Script v2.1
 * Gestão da biblioteca de estratégias do Will + estratégias do usuário.
 */

document.addEventListener('DOMContentLoaded', () => {
  const tabs = document.querySelectorAll('.tab');
  const tabContents = document.querySelectorAll('.tab-content');

  let strategyLibrary = [];
  let strategyPreferences = { ...BBStrategyUtils.DEFAULT_PREFERENCES };
  let selectedStrategyId = null;

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((item) => item.classList.remove('active'));
      tabContents.forEach((content) => content.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    });
  });

  function storageGet(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  }

  function storageSet(payload) {
    return new Promise((resolve) => chrome.storage.local.set(payload, resolve));
  }

  async function persistirConfigParcial(patch) {
    const existing = await storageGet([BBStrategyUtils.STORAGE_KEYS.config]);
    const config = BBConfigUtils.mergePersistedPatch(existing.config || {}, patch);
    await storageSet({ [BBStrategyUtils.STORAGE_KEYS.config]: config });
    return config;
  }

  async function ensureStrategyBootstrap() {
    const keys = [
      BBStrategyUtils.STORAGE_KEYS.strategyLibrary,
      BBStrategyUtils.STORAGE_KEYS.strategyLibraryBootstrapped,
      BBStrategyUtils.STORAGE_KEYS.strategyPreferences
    ];

    const data = await storageGet(keys);
    const bootstrap = BBStrategyUtils.ensureBootstrapPayload(data);
    if (bootstrap.shouldBootstrap) {
      await storageSet({
        [BBStrategyUtils.STORAGE_KEYS.strategyLibrary]: bootstrap.strategyLibrary,
        [BBStrategyUtils.STORAGE_KEYS.strategyLibraryBootstrapped]: true,
        [BBStrategyUtils.STORAGE_KEYS.strategyPreferences]: bootstrap.strategyPreferences
      });
    }

    strategyLibrary = BBStrategyUtils.ensureStrategyLibrary(bootstrap.strategyLibrary);
    strategyPreferences = bootstrap.strategyPreferences;
    selectedStrategyId = strategyPreferences.selectedStrategyId || strategyLibrary[0]?.id || null;
  }

  async function atualizarBancaInicial() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;

      // Pede o saldo atual ao content script
      chrome.tabs.sendMessage(tab.id, { type: 'GET_GAME_DATA' }, (response) => {
        if (response && response.balance) {
          // Extrai valor numérico do formato "R$ X.XXX,XX"
          const valor = parseFloat(response.balance.replace(/[^\d,.-]/g, '').replace(',', '.'));
          if (!isNaN(valor) && valor > 0) {
            const el = document.getElementById('cfg-bancaInicial');
            if (el) {
              el.textContent = response.balance;
              // Atualiza a CONFIG também
              persistirConfigParcial({ bancaInicial: valor });
            }
          }
        }
      });
    } catch (err) {
      console.log('[Popup] Erro ao atualizar banca:', err.message);
    }
  }

  async function carregarConfig() {
    const data = await storageGet([
      BBStrategyUtils.STORAGE_KEYS.config,
      BBStrategyUtils.STORAGE_KEYS.strategyLibrary,
      BBStrategyUtils.STORAGE_KEYS.strategyPreferences
    ]);

    const cfg = BBConfigUtils.mergePersistedConfig(data.config || {});

    setVal('cfg-stakeInicial', cfg.stakeInicial);
    setVal('cfg-stakeMax', cfg.stakeMax);
    setVal('cfg-maxGales', cfg.maxGales);
    setVal('cfg-galeMultiplier', cfg.galeMultiplier);
    setVal('cfg-stopWin', cfg.stopWin);
    setVal('cfg-stopLoss', cfg.stopLoss);

    // Banca inicial: carrega automaticamente do saldo real
    atualizarBancaInicial();

    setVal('cfg-valorProtecaoEmpate', cfg.valorProtecaoEmpate);
    setChecked('cfg-protegerEmpate', cfg.protegerEmpate !== false);
    setChecked('cfg-modoTeste', cfg.modoTeste !== false);
    setChecked('cfg-modoDebug', cfg.modoDebug === true);

    const selectors = cfg.selectors || {};
    setVal('sel-historicoContainer', selectors.historicoContainer || '');
    setVal('sel-historicoItem', selectors.historicoItem || '');
    setVal('sel-btnVermelho', selectors.btnVermelho || '');
    setVal('sel-btnAzul', selectors.btnAzul || '');
    setVal('sel-btnEmpate', selectors.btnEmpate || '');
    setVal('sel-inputStake', selectors.inputStake || '');

    strategyLibrary = BBStrategyUtils.ensureStrategyLibrary(data.strategyLibrary || strategyLibrary);
    strategyPreferences = {
      ...BBStrategyUtils.DEFAULT_PREFERENCES,
      ...(data.strategyPreferences || strategyPreferences)
    };
    selectedStrategyId = strategyPreferences.selectedStrategyId || strategyLibrary[0]?.id || null;

    renderStrategyLibrary();
  }

  function renderStrategyLibrary() {
    const select = document.getElementById('strategy-list');
    if (!select) return;

    select.innerHTML = '';
    strategyLibrary.forEach((strategy) => {
      const option = document.createElement('option');
      const sourceLabel = strategy.source === 'will-default' ? 'Will' : 'Usuário';
      const statusLabel = strategy.active ? 'ativa' : 'inativa';
      option.value = strategy.id;
      option.textContent = `${strategy.nome} • ${sourceLabel} • ${statusLabel}`;
      select.appendChild(option);
    });

    const summary = document.getElementById('strategy-summary-text');
    if (summary) {
      const ativas = strategyLibrary.filter((strategy) => strategy.active).length;
      summary.innerHTML = `
        <div>Total: <strong>${strategyLibrary.length}</strong></div>
        <div>Ativas: <strong>${ativas}</strong></div>
        <div>Default Will: <strong>${strategyLibrary.filter((strategy) => strategy.source === 'will-default').length}</strong></div>
      `;
    }

    if (selectedStrategyId && strategyLibrary.some((strategy) => strategy.id === selectedStrategyId)) {
      select.value = selectedStrategyId;
      preencherFormularioStrategy(selectedStrategyId);
    } else if (strategyLibrary[0]) {
      selectedStrategyId = strategyLibrary[0].id;
      select.value = selectedStrategyId;
      preencherFormularioStrategy(selectedStrategyId);
    } else {
      preencherFormularioStrategy(null);
    }
  }

  function preencherFormularioStrategy(strategyId) {
    const strategy = strategyLibrary.find((item) => item.id === strategyId);
    if (!strategy) {
      const draft = BBStrategyUtils.createUserStrategyDraft();
      selectedStrategyId = draft.id;
      setVal('strat-name', draft.nome);
      setVal('strat-source', draft.source);
      setVal('strat-matcherType', draft.matcherType);
      setChecked('strat-active', draft.active);
      setVal('strat-sequenceBase', draft.sequenceBase);
      setVal('strat-entry', draft.entradaEsperada);
      setVal('strat-galeLimit', draft.limiteGale);
      setChecked('strat-tieProtection', draft.usarProtecaoEmpate);
      document.getElementById('strat-note').value = draft.observacao || '';
      return;
    }

    selectedStrategyId = strategy.id;
    setVal('strat-name', strategy.nome);
    setVal('strat-source', strategy.source);
    setVal('strat-matcherType', strategy.matcherType);
    setChecked('strat-active', strategy.active !== false);
    setVal('strat-sequenceBase', strategy.sequenceBase || '');
    setVal('strat-entry', strategy.entradaEsperada || 'azul');
    setVal('strat-galeLimit', strategy.limiteGale ?? 1);
    setChecked('strat-tieProtection', strategy.usarProtecaoEmpate !== false);
    document.getElementById('strat-note').value = strategy.observacao || '';
  }

  function lerFormularioStrategy() {
    const strategyAtual = strategyLibrary.find((item) => item.id === selectedStrategyId);
    const source = getVal('strat-source') || strategyAtual?.source || 'user';

    return BBStrategyUtils.ensureStrategyShape({
      id: strategyAtual?.id || selectedStrategyId || `user-${Date.now()}`,
      nome: getVal('strat-name') || 'Estratégia sem nome',
      source,
      editable: true,
      removable: true,
      active: getChecked('strat-active'),
      matcherType: getVal('strat-matcherType') || 'exact-sequence',
      sequenceBase: getVal('strat-sequenceBase') || '',
      entradaEsperada: getVal('strat-entry') || 'azul',
      limiteGale: getNum('strat-galeLimit'),
      usarProtecaoEmpate: getChecked('strat-tieProtection'),
      observacao: document.getElementById('strat-note').value.trim(),
      mappedPatternKey: strategyAtual?.mappedPatternKey || null,
      confidence: strategyAtual?.confidence || 75
    });
  }

  async function persistirStrategies() {
    strategyPreferences.selectedStrategyId = selectedStrategyId;

    await storageSet({
      [BBStrategyUtils.STORAGE_KEYS.strategyLibrary]: strategyLibrary,
      [BBStrategyUtils.STORAGE_KEYS.strategyLibraryBootstrapped]: true,
      [BBStrategyUtils.STORAGE_KEYS.strategyPreferences]: strategyPreferences
    });

    sendToContent({
      type: 'UPDATE_STRATEGIES',
      strategies: strategyLibrary,
      preferences: strategyPreferences
    });
  }

  document.getElementById('strategy-list').addEventListener('change', (event) => {
    preencherFormularioStrategy(event.target.value);
  });

  document.getElementById('btn-strategy-new').addEventListener('click', () => {
    const draft = BBStrategyUtils.createUserStrategyDraft();
    selectedStrategyId = draft.id;
    preencherFormularioStrategy(null);
    setVal('strat-source', 'user');
    showNotification('Nova estratégia pronta para cadastro.', 'success');
  });

  document.getElementById('btn-strategy-duplicate').addEventListener('click', async () => {
    const current = strategyLibrary.find((item) => item.id === selectedStrategyId);
    if (!current) return;

    const duplicated = BBStrategyUtils.ensureStrategyShape({
      ...BBStrategyUtils.clone(current),
      id: `user-${Date.now()}`,
      nome: `${current.nome} (cópia)`,
      source: 'user',
      editable: true,
      removable: true
    });

    strategyLibrary.push(duplicated);
    selectedStrategyId = duplicated.id;
    await persistirStrategies();
    renderStrategyLibrary();
    showNotification('Estratégia duplicada para edição.', 'success');
  });

  document.getElementById('btn-strategy-remove').addEventListener('click', async () => {
    const current = strategyLibrary.find((item) => item.id === selectedStrategyId);
    if (!current) return;

    strategyLibrary = strategyLibrary.filter((item) => item.id !== selectedStrategyId);
    selectedStrategyId = strategyLibrary[0]?.id || null;
    await persistirStrategies();
    renderStrategyLibrary();
    showNotification(`Estratégia removida: ${current.nome}`, 'success');
  });

  document.getElementById('btn-strategy-save').addEventListener('click', async () => {
    const strategy = lerFormularioStrategy();
    const index = strategyLibrary.findIndex((item) => item.id === strategy.id);

    if (index >= 0) {
      strategyLibrary[index] = strategy;
    } else {
      strategyLibrary.push(strategy);
    }

    selectedStrategyId = strategy.id;
    await persistirStrategies();
    renderStrategyLibrary();
    showNotification('Estratégia salva com sucesso!', 'success');
  });

  document.getElementById('btn-save-config').addEventListener('click', async () => {
    const config = await persistirConfigParcial({
      stakeInicial: getNum('cfg-stakeInicial'),
      stakeMax: getNum('cfg-stakeMax'),
      maxGales: getNum('cfg-maxGales'),
      galeMultiplier: getNum('cfg-galeMultiplier'),
      stopWin: getNum('cfg-stopWin'),
      stopLoss: getNum('cfg-stopLoss'),
      // bancaInicial é sincronizada automaticamente, não é editável manualmente
      protegerEmpate: getChecked('cfg-protegerEmpate'),
      modoTeste: getChecked('cfg-modoTeste'),
      modoDebug: getChecked('cfg-modoDebug'),
      valorProtecaoEmpate: getNum('cfg-valorProtecaoEmpate')
    });
    showNotification('Configurações salvas!', 'success');
    sendToContent({ type: 'UPDATE_CONFIG', config });
  });

  document.getElementById('btn-save-selectors').addEventListener('click', async () => {
    const selectors = {
      historicoContainer: getVal('sel-historicoContainer'),
      historicoItem: getVal('sel-historicoItem'),
      btnVermelho: getVal('sel-btnVermelho'),
      btnAzul: getVal('sel-btnAzul'),
      btnEmpate: getVal('sel-btnEmpate'),
      inputStake: getVal('sel-inputStake')
    };

    const validacao = validarSeletoresAntesDeSalvar(selectors);
    if (!validacao.ok) {
      showNotification(validacao.erro, 'error');
      return;
    }

    const config = await persistirConfigParcial({ selectors });
    showNotification('Seletores salvos!', 'success');
    sendToContent({ type: 'UPDATE_CONFIG', config });
  });

  document.getElementById('btn-start').addEventListener('click', () => {
    sendToContent({ type: 'START' }, (res) => {
      if (res && res.ok) showNotification('Bot iniciado! Estratégias prontas.', 'success');
      else if (res && res.error) showNotification(`Erro: ${res.error}`, 'error');
    });
  });

  document.getElementById('btn-pause').addEventListener('click', () => {
    sendToContent({ type: 'PAUSE' }, (res) => {
      if (res && res.ok) showNotification('Bot pausado/retomado', 'success');
    });
  });

  document.getElementById('btn-stop').addEventListener('click', () => {
    sendToContent({ type: 'STOP' }, (res) => {
      if (res && res.ok) showNotification('Bot parado', 'success');
    });
  });

  document.getElementById('btn-test').addEventListener('click', () => {
    sendToContent({ type: 'TEST_DETECTION' }, (res) => {
      const el = document.getElementById('test-result');
      if (!res) {
        el.innerHTML = '<div style="color:#ff5252;">Não conectado ao site BetBoom</div>';
        return;
      }

      if (res.error) {
        el.innerHTML = `<div style="color:#ff5252;">${res.error}</div>`;
        return;
      }

      let html = '';
      html += `<div>${res.iframeDetectado ? '✅' : '⚠️'} Iframe do jogo: ${res.iframeDetectado ? 'Detectado' : 'Aguardando'}</div>`;
      html += `<div>${res.modoPassivo ? '⚠️ Modo Passivo' : '✅ Modo Ativo'}</div>`;
      html += `<div>${res.wsCapturando ? '✅' : '⚠️'} Captura WS</div>`;
      html += `<div>Estratégias ativas: ${res.strategiesAtivas ?? 0}</div>`;
      html += `<div>${res.saldoReal !== null ? '✅' : '⚠️'} Saldo real: ${res.saldoReal !== null ? `R$ ${Number(res.saldoReal).toFixed(2)}` : '—'}</div>`;
      html += `<div style="margin-top:6px;font-weight:bold;">${res.pronto ? '✅ PRONTO PARA TESTE DO WILL' : '⚠️ Aguardando conexão evo-game / DOM mínimo'}</div>`;
      el.innerHTML = html;
    });
  });

  function atualizarRuntimeStrategy(status) {
    const target = document.getElementById('runtime-strategy-info');
    if (!target) return;

    const ultima = status?.decision?.ultimaDecisao || status?.strategyStatus?.ultimaCorresp || null;
    const ativas = status?.strategyStatus?.ativas ?? 0;
    if (!ultima) {
      target.innerHTML = `Estratégias ativas: ${ativas}<br>Sem correspondência ainda. Aguarde uma sequência.`;
      return;
    }

    const origem = ultima.source === 'will-default' ? 'Will' : (ultima.source === 'user' ? 'Usuário' : 'Sistema');
    const sequencia = ultima.recognizedSequence || '—';
    const entrada = BBStrategyUtils.getEntryLabel(ultima.cor || ultima.acao || '');
    const gale = Number.isFinite(Number(ultima.maxGalesPermitido)) ? Number(ultima.maxGalesPermitido) : 0;
    const protecao = ultima.usarProtecaoEmpate === false ? 'Não' : 'Sim';
    const canonical = ultima.decisionModel || null;

    target.innerHTML = `
      <div>Estratégias ativas: ${ativas}</div>
      <div><strong>${ultima.nome || 'Estratégia ativa'}</strong></div>
      <div>Origem: ${origem}</div>
      <div>Sequência reconhecida: ${sequencia}</div>
      <div>Entrada sugerida: ${entrada}</div>
      <div>Gale permitido: ${gale}</div>
      <div>Proteção de empate: ${protecao}</div>
      <div>Confirmações: ${Number(canonical?.matrixConfirmations || 0)} • ${canonical?.forcaConfirmacao || '—'}</div>
      <div>Mesa: ${canonical?.contextoMesa || '—'} • Risco: ${canonical?.riscoOperacional || '—'}</div>
      <div>Recomendação: ${canonical?.recomendacaoOperacional || '—'}</div>
      <div>Justificativa: ${(canonical?.justificativas || []).slice(0, 1).join('') || '—'}</div>
    `;
  }

  function atualizarStatusOperador(status) {
    const target = document.getElementById('operator-status-info');
    if (!target) return;

    const conectado = Array.isArray(status?.channels) && status.channels.includes('evo-game');
    const lendoJogo = status?.wsDadosRecebidos === true;
    const pronto = conectado && lendoJogo && status?.config?.estadoRodadaAtual === 'apostando';

    target.innerHTML = `
      <div>${conectado ? '✅ Conectado' : '⚠️ Sem conexão do jogo'}</div>
      <div>${lendoJogo ? '✅ Lendo jogo' : '⚠️ Aguardando leitura'}</div>
      <div>${pronto ? '✅ Pronto para operar' : '⏳ Aguardando janela de entrada'}</div>
    `;
  }

  function atualizarResumoSessao(status) {
    const target = document.getElementById('session-summary-info');
    if (!target) return;

    const d = status?.decision || {};
    target.innerHTML = `
      <div>Total de entradas: <strong>${d.totalEntradas ?? 0}</strong></div>
      <div>Automáticas: <strong>${d.entradasAutomaticas ?? 0}</strong> • Manuais: <strong>${d.entradasManuais ?? 0}</strong></div>
      <div>Wins: <strong>${d.wins ?? d.vitorias ?? 0}</strong> • Losses: <strong>${d.losses ?? d.derrotas ?? 0}</strong> • Ties: <strong>${d.ties ?? 0}</strong></div>
      <div>Abortos: <strong>${d.abortosExecucao ?? 0}</strong> • Taxa: <strong>${d.taxaAcerto ?? '0.0'}%</strong></div>
      <div>Última entrada: <strong>${BBStrategyUtils.getEntryLabel(d.ultimaEntradaResolvida?.entradaExecutada || d.ultimaEntradaOperacional?.entradaExecutada || '')}</strong> (${d.ultimaEntradaResolvida?.statusFinal || d.ultimaEntradaOperacional?.statusFinal || d.ultimaEntradaOperacional?.statusInicial || '—'})</div>
    `;
  }

  function formatCurrency(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '—';
    return `R$ ${numeric.toFixed(2)}`;
  }

  function getTemperaturaLabel(value) {
    if (value === 'hot') return 'HOT / pode ir';
    if (value === 'warm') return 'Atenção / cautela';
    if (value === 'cold') return 'Não vá';
    return '—';
  }

  function atualizarObservabilidade(status) {
    const observability = status?.observability;
    const intelligenceTarget = document.getElementById('session-intelligence-info');
    const operatorTarget = document.getElementById('operator-profile-info');
    const windowTarget = document.getElementById('window-analytics-info');
    const recommendationsTarget = document.getElementById('recommendations-info');

    if (!intelligenceTarget || !operatorTarget || !windowTarget || !recommendationsTarget) return;

    if (!observability?.session) {
      intelligenceTarget.innerHTML = 'Aguardando leitura operacional...';
      operatorTarget.innerHTML = 'Sem entradas suficientes para análise.';
      windowTarget.innerHTML = 'Aguardando consolidação de janelas.';
      recommendationsTarget.innerHTML = 'Sem recomendações ainda.';
      return;
    }

    const session = observability.session;
    const live = session.live || {};
    const topStrategy = Array.isArray(session.strategyMetrics) ? session.strategyMetrics[0] : null;
    const operator = observability.operatorProfile || {};
    const recs = Array.isArray(observability.recommendations) ? observability.recommendations : [];
    const win24 = observability.windows?.['24h'];
    const win7 = observability.windows?.['7d'];
    const ultimaRodadaCanonica = Array.isArray(session.rounds)
      ? [...session.rounds].reverse().find((round) => round?.decision?.canonical)
      : null;
    const canonical = ultimaRodadaCanonica?.decision?.canonical || null;

    intelligenceTarget.innerHTML = `
      <div>Banca inicial: <strong>${formatCurrency(session.bancaInicialSessao)}</strong></div>
      <div>Saldo atual: <strong>${formatCurrency(session.saldoAtual)}</strong></div>
      <div>P/L sessão: <strong>${formatCurrency(session.lucroPrejuizoSessao)}</strong></div>
      <div>Temperatura: <strong>${getTemperaturaLabel(live.ultimaTemperatura)}</strong></div>
      <div>Recomendação: <strong>${live.ultimaSugestaoOperacional || '—'}</strong></div>
      <div>Stake sugerida: <strong>${formatCurrency(live.ultimaStakeSugerida?.valor)}</strong></div>
      <div>Top estratégia: <strong>${topStrategy ? `${topStrategy.nome} (${topStrategy.taxaAcerto}% • robustez ${topStrategy.scoreRobustez})` : '—'}</strong></div>
      <div>Padrão canônico: <strong>${canonical?.patternDetected || '—'}</strong></div>
      <div>Confirmações: <strong>${Number(canonical?.matrixConfirmations || 0)}</strong> • Mesa: <strong>${canonical?.tableContext || '—'}</strong></div>
      <div>Risco: <strong>${canonical?.operationalRisk || '—'}</strong> • Status: <strong>${canonical?.decisionStatus || '—'}</strong></div>
      <div>Motivo: <strong>${(canonical?.reasons || []).slice(0, 1).join('') || '—'}</strong></div>
    `;

    const labels = Array.isArray(operator.labels) && operator.labels.length ? operator.labels.join(', ') : '—';
    operatorTarget.innerHTML = `
      <div>Perfil: <strong>${labels}</strong></div>
      <div>Adesão ao robô: <strong>${operator.taxaAdesaoAoRobo ?? 0}%</strong></div>
      <div>Win seguindo: <strong>${operator.taxaWinQuandoSegue ?? 0}%</strong></div>
      <div>Win indo contra: <strong>${operator.taxaWinQuandoVaiContra ?? 0}%</strong></div>
      <div>No-trade: <strong>${operator.frequenciaNoTrade ?? 0}%</strong></div>
    `;

    windowTarget.innerHTML = `
      <div>24h: <strong>${win24?.totalRodadas ?? 0}</strong> rodadas • <strong>${win24?.totalEntradas ?? 0}</strong> entradas</div>
      <div>7 dias: <strong>${win7?.totalRodadas ?? 0}</strong> rodadas • <strong>${win7?.totalEntradas ?? 0}</strong> entradas</div>
      <div>Mesa favorável 24h: <strong>${win24?.contextos?.favoravel ?? 0}</strong></div>
      <div>Mesa ruim 24h: <strong>${win24?.contextos?.ruim ?? 0}</strong></div>
    `;

    if (!recs.length) {
      recommendationsTarget.innerHTML = 'Sem recomendações ainda.';
    } else {
      recommendationsTarget.innerHTML = recs.slice(0, 3)
        .map((rec) => `<div><strong>${rec.titulo}</strong><br>${rec.evidencia}</div>`)
        .join('<br>');
    }
  }

  function baixarArquivo(filename, content, mime = 'text/plain;charset=utf-8') {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function aplicarStatusDesconectado(mensagem = 'Sem conexão com a página') {
    document.getElementById('popup-dot').className = 'dot';
    document.getElementById('popup-status').textContent = 'Desconectado';
    document.getElementById('popup-banca').textContent = '—';
    document.getElementById('stat-wins').textContent = '0';
    document.getElementById('stat-losses').textContent = '0';
    document.getElementById('stat-taxa').textContent = '0.0%';

    const lucroEl = document.getElementById('stat-lucro');
    lucroEl.textContent = '—';
    lucroEl.style.color = '#888';

    const runtime = document.getElementById('runtime-strategy-info');
    if (runtime) runtime.innerHTML = mensagem;

    const operador = document.getElementById('operator-status-info');
    if (operador) operador.innerHTML = mensagem;

    const resumo = document.getElementById('session-summary-info');
    if (resumo) resumo.innerHTML = 'Sem dados da sessão.';

    const inteligencia = document.getElementById('session-intelligence-info');
    if (inteligencia) inteligencia.innerHTML = mensagem;

    const perfil = document.getElementById('operator-profile-info');
    if (perfil) perfil.innerHTML = 'Sem dados suficientes.';

    const janelas = document.getElementById('window-analytics-info');
    if (janelas) janelas.innerHTML = 'Sem janelas consolidadas.';

    const recomendacoes = document.getElementById('recommendations-info');
    if (recomendacoes) recomendacoes.innerHTML = 'Sem recomendações ainda.';
  }

  function atualizarStatus() {
    sendToContent({ type: 'GET_STATUS' }, (res) => {
      if (!res || res.error || !res.decision) {
        aplicarStatusDesconectado(res?.error || 'Sem resposta válida do content script');
        return;
      }

      const d = res.decision;
      const passivo = res.config?.modoPassivo === true;

      if (passivo) {
        document.getElementById('popup-dot').className = 'dot paused';
        document.getElementById('popup-status').textContent = 'Modo Passivo';
      } else {
        document.getElementById('popup-dot').className = d.isAtivo ? (d.isPausado ? 'dot paused' : 'dot active') : 'dot';
        document.getElementById('popup-status').textContent = d.isAtivo ? (d.isPausado ? 'Pausado' : 'Ativo') : 'Inativo';
      }

      document.getElementById('popup-banca').textContent = `R$ ${Number(d.bancaAtual || 0).toFixed(2)}`;
      document.getElementById('stat-wins').textContent = d.wins ?? d.vitorias ?? 0;
      document.getElementById('stat-losses').textContent = d.losses ?? d.derrotas ?? 0;
      document.getElementById('stat-taxa').textContent = `${d.taxaAcerto}%`;

      const lucroEl = document.getElementById('stat-lucro');
      lucroEl.textContent = `R$${Number(d.lucroSessao || 0).toFixed(0)}`;
      lucroEl.style.color = Number(d.lucroSessao || 0) >= 0 ? '#00e676' : '#ff5252';

      atualizarRuntimeStrategy(res);
      atualizarStatusOperador(res);
      atualizarResumoSessao(res);
      atualizarObservabilidade(res);
    });
  }

  function sendToContent(msg, callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) {
        callback?.(null);
        return;
      }

      chrome.tabs.sendMessage(tabs[0].id, msg, (response) => {
        if (chrome.runtime.lastError) {
          callback?.({
            ok: false,
            error: chrome.runtime.lastError.message || 'Falha de comunicação com a página'
          });
          return;
        }

        callback?.(response);
      });
    });
  }

  function setVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
  }

  function getVal(id) {
    const el = document.getElementById(id);
    return el ? el.value : '';
  }

  function getNum(id) {
    return parseFloat(getVal(id)) || 0;
  }

  function setChecked(id, val) {
    const el = document.getElementById(id);
    if (el) el.checked = val;
  }

  function getChecked(id) {
    const el = document.getElementById(id);
    return el ? el.checked : false;
  }

  function validarSintaxeSeletor(selector) {
    if (typeof selector !== 'string' || !selector.trim()) {
      return { ok: false, erro: 'seletor vazio' };
    }

    try {
      document.createDocumentFragment().querySelector(selector);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        erro: error?.message || 'sintaxe inválida'
      };
    }
  }

  function validarSeletoresAntesDeSalvar(selectors) {
    const invalidos = Object.entries(selectors || {})
      .map(([campo, seletor]) => ({ campo, resultado: validarSintaxeSeletor(seletor) }))
      .filter((item) => item.resultado.ok !== true);

    if (!invalidos.length) {
      return { ok: true };
    }

    return {
      ok: false,
      erro: `Seletor inválido em ${invalidos[0].campo}: ${invalidos[0].resultado.erro}`
    };
  }

  function showNotification(msg, type) {
    const el = document.getElementById('notification');
    el.textContent = msg;
    el.className = `notification ${type}`;
    setTimeout(() => { el.className = 'notification'; }, 3000);
  }

  document.getElementById('btn-export-session').addEventListener('click', () => {
    sendToContent({ type: 'EXPORT_SESSION_REPORT', limit: 300 }, (res) => {
      if (!res || res.ok !== true) {
        showNotification('Falha ao gerar o relatório da sessão', 'error');
        return;
      }

      if (!res.hasData) {
        showNotification('Sessão ainda sem dados para exportar', 'error');
        return;
      }

      baixarArquivo(`${res.filenameBase}.json`, res.reportJson, 'application/json;charset=utf-8');
      baixarArquivo(`${res.filenameBase}.md`, res.reportMarkdown, 'text/markdown;charset=utf-8');
      showNotification('Relatório exportado com sucesso', 'success');
    });
  });

  (async () => {
    await ensureStrategyBootstrap();
    await carregarConfig();
    atualizarStatus();
    atualizarBancaInicial();

    setInterval(atualizarStatus, 3000);
    setInterval(atualizarBancaInicial, 3000);
  })();
});
