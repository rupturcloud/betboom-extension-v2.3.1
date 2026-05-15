/**
 * BetBoom Auto Pattern — Collector
 * Captura resultados da mesa via DOM scraping e MutationObserver.
 * 
 * Resultados são armazenados como array de objetos:
 *   { cor: 'vermelho'|'azul'|'empate', timestamp: Date, rodada: number }
 */

const Collector = (() => {
  // Estado interno
  let historico = [];
  let observer = null;
  let rodadaAtual = 0;
  let isCollecting = false;
  let onNovoResultadoCallback = null;
  let usarDOM = false;
  const assinaturasConfirmadas = new Set();
  let ultimaLeituraDom = [];
  let domProcessTimer = null;
  const invalidSelectorsWarned = new Set();
  let _canonicalSigLogged = false;

  // R5 — uso da fonte única de signature exposta pelo HistoryStore (agente A).
  // Mantemos fallback inline defensivo caso HistoryStore ainda não tenha carregado.
  function _gerarSignatureCanonica(payload, fallback) {
    if (typeof HistoryStore !== 'undefined' && typeof HistoryStore.generateSignature === 'function') {
      const sig = HistoryStore.generateSignature(payload);
      if (!_canonicalSigLogged) {
        _canonicalSigLogged = true;
        console.log(`[Collector-SIG] usando canonical signature: ${sig}`);
      }
      return sig;
    }
    return fallback();
  }

  function splitSelectors(selectors) {
    return String(selectors || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function safeQuerySelector(selector, root = document) {
    if (typeof selector !== 'string' || !selector.trim()) return null;

    try {
      return root.querySelector(selector);
    } catch (error) {
      const key = selector.trim();
      if (!invalidSelectorsWarned.has(key)) {
        invalidSelectorsWarned.add(key);
        Logger.warn(`Collector ignorou seletor inválido: ${key}`, error?.message || error);
      }
      return null;
    }
  }

  function safeQuerySelectorAll(selector, root = document) {
    if (typeof selector !== 'string' || !selector.trim()) return [];

    try {
      return Array.from(root.querySelectorAll(selector));
    } catch (error) {
      const key = selector.trim();
      if (!invalidSelectorsWarned.has(key)) {
        invalidSelectorsWarned.add(key);
        Logger.warn(`Collector ignorou seletor inválido: ${key}`, error?.message || error);
      }
      return [];
    }
  }

  function isHostLocalSeguro() {
    const host = String(window.location.hostname || '').toLowerCase();
    return host === 'localhost' || host === '127.0.0.1';
  }

  function cloneResultados(list) {
    return Array.isArray(list) ? list.map((item) => ({ ...item })) : [];
  }

  function sameColorSequence(left, right) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (left.length !== right.length) return false;
    return left.every((item, index) => item === right[index]);
  }

  function calcularMaiorSobreposicao(anterior, atual) {
    const max = Math.min(anterior.length, atual.length);
    for (let size = max; size > 0; size -= 1) {
      let matches = true;
      for (let i = 0; i < size; i += 1) {
        if (anterior[anterior.length - size + i] !== atual[i]) {
          matches = false;
          break;
        }
      }
      if (matches) return size;
    }
    return 0;
  }

  function agendarProcessamentoDOM(delay = 60) {
    if (domProcessTimer) return;

    domProcessTimer = setTimeout(() => {
      domProcessTimer = null;
      if (isCollecting && usarDOM) {
        processarMudanca();
      }
    }, delay);
  }

  /**
   * Detecta a cor de um elemento DOM do histórico.
   */
  function detectarCor(element) {
    if (!element) return null;

    const classes = (element.className || '').toLowerCase();
    const dataColor = (element.getAttribute('data-color') || '').toLowerCase();
    const bgColor = window.getComputedStyle(element).backgroundColor;
    const text = (element.textContent || '').toLowerCase().trim();

    // Verificar por classe ou data-attribute
    if (dataColor.includes('red') || dataColor.includes('vermelho')) return 'vermelho';
    if (dataColor.includes('blue') || dataColor.includes('black') || dataColor.includes('azul') || dataColor.includes('preto')) return 'azul';
    if (dataColor.includes('green') || dataColor.includes('white') || dataColor.includes('tie') || dataColor.includes('empate')) return 'empate';

    // Verificar por classes CSS
    if (classes.includes('red') || classes.includes('vermelho')) return 'vermelho';
    if (classes.includes('blue') || classes.includes('black') || classes.includes('azul') || classes.includes('preto')) return 'azul';
    if (classes.includes('green') || classes.includes('white') || classes.includes('tie') || classes.includes('empate')) return 'empate';

    // Verificar por cor de fundo computada (RGB)
    if (bgColor) {
      const rgb = bgColor.match(/\d+/g);
      if (rgb && rgb.length >= 3) {
        const [r, g, b] = rgb.map(Number);
        if (r > 180 && g < 80 && b < 80) return 'vermelho';
        if (b > 180 && r < 80 && g < 80) return 'azul';
        if (r < 80 && g < 80 && b < 80) return 'azul'; // preto = azul
        if (g > 150 && r < 100 && b < 100) return 'empate';
        if (r > 200 && g > 200 && b > 200) return 'empate'; // branco = empate
      }
    }

    // Verificar por texto
    if (text === 'v' || text === 'r' || text.includes('verm') || text.includes('red')) return 'vermelho';
    if (text === 'a' || text === 'p' || text === 'b' || text.includes('azul') || text.includes('blue') || text.includes('pret') || text.includes('black')) return 'azul';
    if (text === 'e' || text === 'w' || text === 't' || text.includes('empat') || text.includes('tie') || text.includes('bran') || text.includes('green')) return 'empate';

    // Verificar por número (em jogos Double, números pares/ímpares podem indicar cor)
    const num = parseInt(text);
    if (!isNaN(num)) {
      if (num === 0) return 'empate';
      if (num >= 1 && num <= 7) return 'vermelho';
      if (num >= 8 && num <= 14) return 'azul';
    }

    return null;
  }

  /**
   * Tenta encontrar o container de histórico usando múltiplos seletores.
   */
  function encontrarContainerHistorico() {
    const seletores = splitSelectors(CONFIG.selectors.historicoContainer);
    for (const sel of seletores) {
      const el = safeQuerySelector(sel);
      if (el) return el;
    }

    if (!isHostLocalSeguro()) {
      return null;
    }

    // Fallback: procurar por containers com muitos filhos coloridos
    const candidates = document.querySelectorAll('div, ul, ol, section');
    let bestCandidate = null;
    let bestScore = 0;

    for (const el of candidates) {
      if (el.offsetParent === null) continue;
      const children = el.children;
      if (children.length < 5 || children.length > 120) continue;

      const sampleSize = Math.min(children.length, 12);
      let colorCount = 0;
      const uniqueColors = new Set();
      for (let i = 0; i < sampleSize; i++) {
        const cor = detectarCor(children[i]);
        if (cor) {
          colorCount++;
          uniqueColors.add(cor);
        }
      }

      const score = colorCount + uniqueColors.size;
      if (colorCount >= 4 && uniqueColors.size >= 2 && score > bestScore) {
        bestCandidate = el;
        bestScore = score;
      }
    }

    if (bestCandidate) {
      Logger.info('Container de histórico encontrado via fallback local:', bestCandidate);
    }

    return bestCandidate;
  }

  /**
   * Extrai todos os resultados visíveis do DOM.
   */
  function extrairResultadosDOM() {
    const container = encontrarContainerHistorico();
    if (!container) {
      Logger.warn('Container de histórico não encontrado.');
      return [];
    }

    const seletoresItem = splitSelectors(CONFIG.selectors.historicoItem);
    let items = [];

    for (const sel of seletoresItem) {
      items = safeQuerySelectorAll(sel, container);
      if (items.length > 0) break;
    }

    // Fallback: usar filhos diretos
    if (items.length === 0) {
      items = container.children;
    }

    const resultados = [];
    for (const item of items) {
      const cor = detectarCor(item);
      if (cor) {
        resultados.push({
          cor: cor,
          timestamp: new Date(),
          rodada: rodadaAtual
        });
      }
    }

    Logger.debug(`Extraídos ${resultados.length} resultados do DOM.`);
    return resultados;
  }

  /**
   * Compara histórico atual com novo para detectar novos resultados.
   * Corrigido: overlap=0 agora reconhece como reset de mesa (não descarta tudo).
   */
  function detectarNovosResultados(novosResultados) {
    if (!Array.isArray(novosResultados) || novosResultados.length === 0) {
      return [];
    }

    if (ultimaLeituraDom.length === 0) {
      ultimaLeituraDom = cloneResultados(novosResultados);
      return novosResultados;
    }

    const anterior = ultimaLeituraDom.map((item) => item.cor);
    const atual = novosResultados.map((item) => item.cor);

    if (sameColorSequence(anterior, atual)) {
      return [];
    }

    const overlap = calcularMaiorSobreposicao(anterior, atual);
    ultimaLeituraDom = cloneResultados(novosResultados);

    if (overlap === 0) {
      // Mesa reiniciou ou seletor capturou seção diferente:
      // Verificar se o novo tamanho é MAIOR que o anterior (indica novos resultados no final)
      if (atual.length > anterior.length) {
        // Assumir que os primeiros "anterior.length" itens são os mesmos e só o(s) novo(s) diferem
        const possiveisNovos = novosResultados.slice(anterior.length);
        if (possiveisNovos.length > 0) {
          Logger.info(`Collector DOM: overlap=0 mas tamanho cresceu. Adicionando ${possiveisNovos.length} novo(s).`);
          return possiveisNovos;
        }
      }
      // Se o tamanho for igual ou menor, é provável reset completo de mesa
      Logger.warn('Collector DOM detectou reset de mesa (overlap=0). Ressincronizando histórico.');
      return [];
    }

    return novosResultados.slice(overlap);
  }

  /**
   * Inicia o MutationObserver para detectar mudanças no DOM.
   */
  function iniciarObservador() {
    const container = encontrarContainerHistorico();
    if (!container) {
      Logger.warn('Não foi possível iniciar o observador — container não encontrado.');
      return false;
    }

    observer = new MutationObserver((mutations) => {
      let houveMudanca = false;
      for (const mutation of mutations) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          houveMudanca = true;
          break;
        }
        if (mutation.type === 'attributes') {
          houveMudanca = true;
          break;
        }
      }

      if (houveMudanca) {
        agendarProcessamentoDOM();
      }
    });

    observer.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'data-color', 'style']
    });

    Logger.info('MutationObserver iniciado com sucesso.');
    return true;
  }

  /**
   * Processa uma mudança detectada no DOM.
   */
  function processarMudanca() {
    const novosResultados = extrairResultadosDOM();
    const novos = detectarNovosResultados(novosResultados);

    if (novos.length > 0) {
      for (const resultado of novos) {
        rodadaAtual++;
        resultado.rodada = rodadaAtual;
        resultado.timestamp = new Date();

        // APENAS HISTÓRICO REAL - perspectiva é derivada em módulo separado
        // NÃO gerar cores sintéticas que substituem a verdade operacional

        historico.push(resultado);
        Logger.info(`Novo resultado: ${resultado.cor} (rodada ${resultado.rodada})`);
      }

      // Limitar tamanho do histórico (manter últimos 200)
      if (historico.length > 200) {
        historico = historico.slice(-200);
      }

      // Callback para notificar outros módulos
      if (onNovoResultadoCallback) {
        onNovoResultadoCallback(novos, historico);
      }
    }
  }

  /**
   * Polling como fallback caso o MutationObserver não funcione.
   * Parado automaticamente quando WS assume como fonte primária.
   */
  let pollingInterval = null;
  let _wsComoFontePrimaria = false;

  function pararPollingDOM() {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
      Logger.info('Polling DOM parado — WS assumiu como fonte primária.');
    }
  }

  function iniciarPolling() {
    if (pollingInterval) return;
    if (_wsComoFontePrimaria) {
      Logger.info('Polling DOM ignorado — WS já é fonte primária.');
      return;
    }
    pollingInterval = setInterval(() => {
      if (isCollecting && usarDOM && !_wsComoFontePrimaria) {
        processarMudanca();
      }
    }, CONFIG.intervaloVerificacao);
    Logger.info('Polling DOM iniciado como fallback.');
  }

  // --- API Pública ---
  return {
    /**
     * Inicia a coleta de resultados.
     */
    iniciar(options = {}) {
      isCollecting = true;
      usarDOM = options.usarDOM === true;

      if (usarDOM) {
        // Coletar resultados iniciais
        const resultadosIniciais = extrairResultadosDOM();
        if (resultadosIniciais.length > 0) {
          historico = resultadosIniciais.map((r, i) => ({
            ...r,
            rodada: i + 1
          }));
          rodadaAtual = historico.length;
          ultimaLeituraDom = cloneResultados(resultadosIniciais);
          Logger.info(`Carregados ${historico.length} resultados iniciais.`);
        }

        // Tentar MutationObserver
        const observerOk = iniciarObservador();

        // Sempre iniciar polling como backup
        iniciarPolling();

        Logger.info('Collector iniciado com DOM + polling.');
        return observerOk;
      }

      Logger.info('Collector iniciado em modo WS-only.');
      return true;
    },

    /**
     * Para a coleta.
     */
    parar() {
      isCollecting = false;
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      if (domProcessTimer) {
        clearTimeout(domProcessTimer);
        domProcessTimer = null;
      }
      if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
      }
      usarDOM = false;
      Logger.info('Collector parado.');
    },

    /**
     * Retorna o histórico completo.
     */
    getHistorico() {
      return [...historico];
    },

    /**
     * Retorna os últimos N resultados.
     */
    getUltimos(n) {
      return historico.slice(-n);
    },

    /**
     * Retorna apenas as cores dos últimos N resultados.
     */
    getCoresRecentes(n) {
      return historico.slice(-n).map(r => r.cor);
    },

    /**
     * Retorna a rodada atual.
     */
    getRodadaAtual() {
      return rodadaAtual;
    },

    /**
     * Registra callback para novos resultados.
     */
    onNovoResultado(callback) {
      onNovoResultadoCallback = callback;
    },

    /**
     * Gera 6 cores baseado no resultado da rodada.
     * Cada linha representa uma perspectiva/análise diferente.
     */
    gerarCoresParaRodada(corResultado) {
      if (corResultado === 'azul') {
        return ['azul', 'vermelho', 'empate', 'azul', 'vermelho', 'empate'];
      }
      if (corResultado === 'vermelho') {
        return ['vermelho', 'azul', 'empate', 'vermelho', 'azul', 'empate'];
      }
      if (corResultado === 'empate') {
        return ['empate', 'empate', 'empate', 'empate', 'empate', 'empate'];
      }
      return ['desconhecido', 'desconhecido', 'desconhecido', 'desconhecido', 'desconhecido', 'desconhecido'];
    },

    /**
     * Limpa o histórico.
     */
    limpar() {
      historico = [];
      rodadaAtual = 0;
      assinaturasConfirmadas.clear();
      ultimaLeituraDom = [];
      if (domProcessTimer) {
        clearTimeout(domProcessTimer);
        domProcessTimer = null;
      }
    },

    /**
     * Adiciona resultado confirmado do jogo via bacbo.road.
     */
    adicionarResultadoConfirmado(resultado) {
      if (!resultado || !resultado.cor) return;

      if (resultado.gameId) {
        const existente = historico.find((item) => item.roundId === resultado.gameId);
        if (existente) {
          if (existente.signature) assinaturasConfirmadas.add(existente.signature);
          return existente;
        }
      }

      // Fix B: signature estável — nunca usa rodadaAtual (muda entre payloads da mesma rodada)
      const gameIdPart = resultado.gameId || null;
      const tsPart = resultado.timestamp ? Math.floor(resultado.timestamp / 1000) : null;
      // Signature canônica via HistoryStore (single source of truth).
      // Defensivo: se HistoryStore não carregou, mantém fallback inline.
      const signature = resultado.signature || (
        (typeof HistoryStore !== 'undefined' && HistoryStore.generateSignature
          && HistoryStore.generateSignature({
              gameId: gameIdPart,
              vencedor: resultado.vencedor || resultado.cor,
              playerScore: resultado.playerScore,
              bankerScore: resultado.bankerScore,
              occurrence: tsPart || 0
            }))
        || (gameIdPart
          ? `gid:${gameIdPart}:${resultado.vencedor || resultado.cor}`
          : `auto:${resultado.vencedor || resultado.cor}:${resultado.playerScore || '?'}:${resultado.bankerScore || '?'}:${tsPart || 'unk'}`)
      );

      // Fix A: deduplicação por Set (janela de 300 entradas, FIFO)
      if (assinaturasConfirmadas.has(signature)) {
        console.log(`[CollectorDedup] Duplicata detectada e ignorada — signature: ${signature}`);
        return;
      }
      assinaturasConfirmadas.add(signature);
      if (assinaturasConfirmadas.size > 300) {
        assinaturasConfirmadas.delete(assinaturasConfirmadas.values().next().value);
      }

      rodadaAtual++;

      // APENAS HISTÓRICO REAL - cores sintéticas não devem substituir a verdade operacional
      const COR_PARA_COLOR = { 'azul': 'blue', 'vermelho': 'red', 'empate': 'green', 'blue': 'blue', 'red': 'red', 'green': 'green', 'player': 'blue', 'banker': 'red', 'tie': 'green' };
      const novoResultado = {
        cor: resultado.cor,
        // cores array removido - apenas cor real é renderizada
        color: COR_PARA_COLOR[resultado.cor] || COR_PARA_COLOR[resultado.vencedor] || null,
        timestamp: new Date(resultado.timestamp || Date.now()),
        rodada: rodadaAtual,
        roundId: resultado.gameId || null,
        fonte: 'websocket',
        vencedor: resultado.vencedor || null,
        playerScore: resultado.playerScore || null,
        bankerScore: resultado.bankerScore || null,
        confirmedBy: resultado.confirmedBy || 'bacbo.road',
        signature
      };

      historico.push(novoResultado);

      // Alimentar HistoryStore (Truth Layer)
      if (typeof HistoryStore !== 'undefined') {
        HistoryStore.addRound({
          roundId:     novoResultado.roundId,
          result:      novoResultado.vencedor?.toLowerCase() || null,
          color:       novoResultado.color,
          timestamp:   novoResultado.timestamp instanceof Date
                         ? novoResultado.timestamp.getTime()
                         : Number(novoResultado.timestamp) || Date.now(),
          source:      novoResultado.fonte || 'websocket',
          confidence:  1.0,
          signature:   novoResultado.signature,
          playerScore: novoResultado.playerScore,
          bankerScore: novoResultado.bankerScore,
          raw:         novoResultado
        });
      }

      Logger.info(`[WS] Resultado confirmado: ${novoResultado.cor} (rodada ${novoResultado.rodada})`);

      // Limitar tamanho do histórico
      if (historico.length > 200) {
        historico = historico.slice(-200);
      }

      // Callback para notificar outros módulos
      if (onNovoResultadoCallback) {
        console.log(`[COLLECTOR-WIRE] novo round disparou onNovoResultado: 1 (single-confirm | total=${historico.length})`);
        onNovoResultadoCallback([novoResultado], historico);
      } else {
        console.log(`[COLLECTOR-WIRE] novo round confirmado mas callback ausente (single-confirm | total=${historico.length})`);
      }

      return novoResultado;
    },

    adicionarResultadoWS(resultado) {
      // WS confirmado: parar polling DOM para evitar duplicatas
      if (!_wsComoFontePrimaria) {
        _wsComoFontePrimaria = true;
        pararPollingDOM();
      }
      this.adicionarResultadoConfirmado(resultado);
    },

    /**
     * Sincroniza o histórico completo do road (bacbo.road).
     * Processa TODOS os itens do array — não apenas o último.
     * Dispara o callback UMA única vez ao final para não sobrecarregar o overlay.
     */
    sincronizarRoad(allResults) {
      if (!Array.isArray(allResults) || allResults.length === 0) return;

      if (!_wsComoFontePrimaria) {
        _wsComoFontePrimaria = true;
        pararPollingDOM();
      }

      const COR_PARA_COLOR = { 'azul': 'blue', 'vermelho': 'red', 'empate': 'green', 'blue': 'blue', 'red': 'red', 'green': 'green', 'player': 'blue', 'banker': 'red', 'tie': 'green' };

      let adicionados = 0;
      const _savedCallback = onNovoResultadoCallback;

      // Silenciar callback individual durante a carga em lote
      onNovoResultadoCallback = null;

      // Contador de ocorrência por conteúdo: estável quando o road encolhe (drops do início)
      const _contentCount = {};

      for (let i = 0; i < allResults.length; i++) {
        const item = allResults[i];
        if (!item) continue;

        const cor = item.cor || (() => {
          if (item.winner === 'Player') return 'azul';
          if (item.winner === 'Banker') return 'vermelho';
          if (item.winner === 'Tie') return 'empate';
          return null;
        })();
        if (!cor) continue;

        const gameIdPart = item.gameId || null;
        const vencedor = item.vencedor || item.winner || null;
        // Usar contador por conteúdo — estável independente do tamanho do road
        const _baseKey = `${vencedor || cor}:${item.playerScore || '?'}:${item.bankerScore || '?'}`;
        const _occ = _contentCount[_baseKey] || 0;
        _contentCount[_baseKey] = _occ + 1;
        // Signature canônica via HistoryStore (single source of truth)
        const signature = item.signature || (
          (typeof HistoryStore !== 'undefined' && HistoryStore.generateSignature
            && HistoryStore.generateSignature({
                gameId: gameIdPart,
                vencedor: vencedor || cor,
                playerScore: item.playerScore,
                bankerScore: item.bankerScore,
                occurrence: _occ
              }))
          || (gameIdPart
            ? `gid:${gameIdPart}:${vencedor || cor}`
            : `auto:${_baseKey}:${_occ}`)
        );

        if (assinaturasConfirmadas.has(signature)) continue;
        assinaturasConfirmadas.add(signature);
        if (assinaturasConfirmadas.size > 300) {
          assinaturasConfirmadas.delete(assinaturasConfirmadas.values().next().value);
        }

        rodadaAtual++;
        const novoResultado = {
          cor,
          color: COR_PARA_COLOR[cor] || null,
          timestamp: new Date(Number(item.timestamp) || Date.now()),
          rodada: rodadaAtual,
          roundId: gameIdPart,
          fonte: 'websocket',
          vencedor,
          playerScore: item.playerScore || null,
          bankerScore: item.bankerScore || null,
          confirmedBy: item.confirmedBy || 'bacbo.road',
          signature
        };

        historico.push(novoResultado);

        if (typeof HistoryStore !== 'undefined') {
          HistoryStore.addRound({
            roundId:     novoResultado.roundId,
            result:      vencedor?.toLowerCase() || null,
            color:       novoResultado.color,
            timestamp:   novoResultado.timestamp.getTime(),
            source:      'websocket',
            confidence:  1.0,
            signature:   novoResultado.signature,
            playerScore: novoResultado.playerScore,
            bankerScore: novoResultado.bankerScore,
            raw:         novoResultado
          });
        }

        adicionados++;
      }

      // Limitar tamanho
      if (historico.length > 200) historico = historico.slice(-200);

      // Restaurar callback e disparar UMA vez com o histórico completo
      onNovoResultadoCallback = _savedCallback;

      if (adicionados > 0 && onNovoResultadoCallback) {
        const ultimos = historico.slice(-adicionados);
        console.log(`[COLLECTOR-WIRE] novo round disparou onNovoResultado: ${adicionados} (bulk | total=${historico.length})`);
        onNovoResultadoCallback(ultimos, historico);
      } else if (adicionados > 0) {
        console.log(`[COLLECTOR-WIRE] ${adicionados} novos rounds mas callback ausente (bulk | total=${historico.length})`);
      } else {
        console.log(`[COLLECTOR-WIRE] sincronizarRoad sem novos itens (callback NÃO disparado) — recebidos=${allResults.length}, total=${historico.length}`);
      }

      console.log(`[CollectorRoad] sincronizarRoad: ${allResults.length} recebidos, ${adicionados} adicionados, total=${historico.length}`);
      return adicionados;
    },

    /**
     * Reseta a flag de fonte primária (ex: ao reiniciar a sessão).
     */
    resetarFontePrimaria() {
      _wsComoFontePrimaria = false;
    },

    /**
     * Verifica se o container de histórico foi encontrado.
     */
    isContainerEncontrado() {
      return encontrarContainerHistorico() !== null;
    },

    /**
     * Força uma leitura manual do DOM.
     */
    forcarLeitura() {
      processarMudanca();
      return historico;
    },

    /**
     * Retorna estatísticas do histórico.
     */
    getEstatisticas() {
      const total = historico.length;
      const vermelhos = historico.filter(r => r.cor === 'vermelho').length;
      const azuis = historico.filter(r => r.cor === 'azul').length;
      const empates = historico.filter(r => r.cor === 'empate').length;
      return {
        total,
        vermelhos,
        azuis,
        empates,
        pctVermelho: total ? ((vermelhos / total) * 100).toFixed(1) : 0,
        pctAzul: total ? ((azuis / total) * 100).toFixed(1) : 0,
        pctEmpate: total ? ((empates / total) * 100).toFixed(1) : 0
      };
    }
  };
})();
