/**
 * BetBoom Auto Pattern — Pattern Engine v2
 * Padrões validados contra a transcrição do Will (vídeo original).
 *
 * Padrões fiéis ao Will:
 *  1. Xadrez (alternância A-B-A-B, análise em cima e embaixo)
 *  2. Reversão (3+ iguais → oposto, até G1)
 *  3. Pós-Empate (jogar na cor que antecedeu o empate)
 *  4. Diagonal (padrão visual no gráfico, posições alternadas)
 *  5. Casadinho (empates lado a lado ou na diagonal)
 *  6. Linha Devedora (cor ausente há muito tempo "deve" pagar)
 *  7. Quebra de Padrão (se quebrou em cima, joga contrário embaixo)
 *  8. Sequência de 2 (dois azuis puxa dois vermelhos puxa dois azuis)
 *  9. Sequência de 3 (três iguais → oposto, até G1)
 * 10. Ponta/Quadrante (análise das 4 últimas casas)
 * 11. Xadrez sem Gale (xadrez que não confirma em ambas linhas)
 * 12. Ping-Pong (alternância longa 6+)
 * 13. Xadrez Duplo (pares 2-2-2)
 * 14. Tendência Dominante (70%+ de uma cor)
 * 15. Correção Após Empate (pós-empate → cor dominante)
 * 16. Espelho Entre Linhas (bloco espelha anterior)
 * 17. Canal Horizontal (mesma cor domina faixa)
 * 18. Reversão Diagonal (diagonal que inverte)
 *
 * Cada padrão retorna:
 *   { nome, acao: 'vermelho'|'azul'|'empate'|null, confianca: 0-100, comGale: boolean }
 */

const PatternEngine = (() => {
  let strategyLibrary = [];
  let lastDetectedStrategies = [];

  // ─── UTILITÁRIOS ───

  function contarSequenciaFinal(cores) {
    if (cores.length === 0) return { cor: null, count: 0 };
    const ultima = cores[cores.length - 1];
    let count = 0;
    for (let i = cores.length - 1; i >= 0; i--) {
      if (cores[i] === ultima) count++;
      else break;
    }
    return { cor: ultima, count };
  }

  function corOposta(cor) {
    if (cor === 'vermelho') return 'azul';
    if (cor === 'azul') return 'vermelho';
    return null;
  }

  function isAlternancia(cores, n, ignoreEmpate = true) {
    let filtradas = cores;
    if (ignoreEmpate) {
      filtradas = cores.filter((c) => c !== 'empate');
    }
    
    if (filtradas.length < n) return false;
    const ultimas = filtradas.slice(-n);
    
    for (let i = 1; i < ultimas.length; i++) {
      if (ultimas[i] === ultimas[i - 1]) return false;
    }
    return true;
  }

  function getActiveStrategies() {
    return strategyLibrary.filter((strategy) => strategy && strategy.active !== false);
  }

  function montarResultadoEstrategia(strategy, recognizedSequence, confidence) {
    return {
      nome: strategy.nome,
      acao: strategy.entradaEsperada,
      confianca: confidence || strategy.confidence || 75,
      comGale: Number(strategy.limiteGale || 0) > 0,
      strategyId: strategy.id,
      source: strategy.source || 'user',
      strategy: strategy,
      recognizedSequence,
      maxGalesPermitido: Number(strategy.limiteGale || 0),
      usarProtecaoEmpate: strategy.usarProtecaoEmpate !== false,
      observacao: strategy.observacao || '',
      matcherType: strategy.matcherType
    };
  }

  function detectarPorSequenciaExata(strategy, cores) {
    const sequence = BBStrategyUtils.normalizeSequenceBase(strategy.sequenceBase);
    if (!sequence.length || cores.length < sequence.length) return null;

    const ultimas = cores.slice(-sequence.length);
    const match = sequence.every((cor, index) => ultimas[index] === cor);
    if (!match) return null;

    return montarResultadoEstrategia(
      strategy,
      BBStrategyUtils.sequenceToLabel(ultimas),
      strategy.confidence || 82
    );
  }

  function detectarPorDominanciaUltimas4(strategy, cores) {
    if (cores.length < 4) return null;

    const alvo = BBStrategyUtils.normalizeCor(strategy.entradaEsperada);
    const ultimas = cores.slice(-4).filter((cor) => cor !== 'empate');
    if (ultimas.length < 3) return null;

    const count = ultimas.filter((cor) => cor === alvo).length;
    if (count < 3) return null;

    return montarResultadoEstrategia(
      strategy,
      BBStrategyUtils.sequenceToLabel(ultimas),
      strategy.confidence || 76
    );
  }

  function detectarEstrategia(strategy, cores) {
    if (!strategy || !strategy.active) return null;

    switch (strategy.matcherType) {
      case 'dominant-last-4':
        return detectarPorDominanciaUltimas4(strategy, cores);
      case 'alternating-sequence':
      case 'exact-sequence':
      default:
        return detectarPorSequenciaExata(strategy, cores);
    }
  }

  function analisarStrategies(cores) {
    const activeStrategies = getActiveStrategies();
    if (!activeStrategies.length) return [];

    const detectadas = activeStrategies
      .map((strategy) => detectarEstrategia(strategy, cores))
      .filter(Boolean)
      .sort((a, b) => b.confianca - a.confianca);

    lastDetectedStrategies = detectadas;
    return detectadas;
  }


  // =====================================================
  // 18 PADRÕES WMSG (Will Dados Pro — Sequências Exatas)
  // Fonte: will-18-padroes.html
  // Cada padrão busca por sequência exata em últimas 4 casas (ou alinhadas à direita)
  // =====================================================
  const WMSG_PATTERNS = [
    { id: "WMSG-001", type: 'streak',   seq: ['azul','azul','azul','vermelho'], enter: 'vermelho', desc: "3 azuis e 1 vermelho. Entrar contra a quebra: FORA." },
    { id: "WMSG-002", type: 'streak',   seq: ['vermelho','vermelho','vermelho','azul'], enter: 'azul', desc: "3 vermelhos e 1 azul. Entrar contra a quebra: CASA." },
    { id: "WMSG-003", type: 'zigzag',   seq: ['azul','vermelho','azul','vermelho'], enter: 'azul', desc: "Zigue-zague terminando em V. Segue o ciclo: CASA." },
    { id: "WMSG-004", type: 'zigzag',   seq: ['vermelho','azul','vermelho','azul'], enter: 'vermelho', desc: "Zigue-zague terminando em A. Segue o ciclo: FORA." },
    { id: "WMSG-005", type: 'mirror',   seq: ['azul','azul','vermelho','vermelho'], enter: 'azul', desc: "Espelho: 2 azuis e 2 vermelhos. Vira: CASA." },
    { id: "WMSG-006", type: 'mirror',   seq: ['vermelho','vermelho','azul','azul'], enter: 'vermelho', desc: "Espelho: 2 vermelhos e 2 azuis. Vira: FORA." },
    { id: "WMSG-007", type: 'break',    seq: ['azul','azul','vermelho','azul'], enter: 'vermelho', desc: "AABA — quebra com vermelho no meio. Entrar FORA." },
    { id: "WMSG-008", type: 'break',    seq: ['vermelho','vermelho','azul','vermelho'], enter: 'azul', desc: "VVAV — quebra com azul no meio. Entrar CASA." },
    { id: "WMSG-009", type: 'sandwich', seq: ['azul','vermelho','vermelho','azul'], enter: 'vermelho', desc: "AVVA — sanduiche, retorno: FORA." },
    { id: "WMSG-010", type: 'sandwich', seq: ['vermelho','azul','azul','vermelho'], enter: 'azul', desc: "VAAV — sanduiche, retorno: CASA." },
    { id: "WMSG-011", type: 'streak',   seq: ['azul','vermelho','vermelho','vermelho'], enter: 'azul', desc: "Apos 3 V seguidos, contra-corrente: CASA." },
    { id: "WMSG-012", type: 'streak',   seq: ['vermelho','azul','azul','azul'], enter: 'vermelho', desc: "Apos 3 A seguidos, contra-corrente: FORA." },
    { id: "WMSG-013", type: 'tie',      seq: ['empate','azul','azul','azul'], enter: 'vermelho', desc: "Empate inicial + 3 azuis. Apos empate, virar: FORA." },
    { id: "WMSG-014", type: 'tie',      seq: ['empate','vermelho','vermelho','vermelho'], enter: 'azul', desc: "Empate inicial + 3 vermelhos. Apos empate, virar: CASA." },
    { id: "WMSG-015", type: 'tie',      seq: ['azul','empate','azul','azul'], enter: 'vermelho', desc: "Empate no meio entre azuis. Quebra: FORA." },
    { id: "WMSG-016", type: 'tie',      seq: ['vermelho','empate','vermelho','vermelho'], enter: 'azul', desc: "Empate no meio entre vermelhos. Quebra: CASA." },
    { id: "WMSG-017", type: 'tie',      seq: ['azul','azul','empate','azul'], enter: 'vermelho', desc: "Tres azuis com empate no penultimo. Quebra: FORA." },
    { id: "WMSG-018", type: 'tie',      seq: ['vermelho','vermelho','empate','vermelho'], enter: 'azul', desc: "Tres vermelhos com empate no penultimo. Quebra: CASA." }
  ];


  function wmsg_MatchExactSequence(cores) {
    if (cores.length < 4) return null;

    const ultimas4 = cores.slice(-4);

    for (const padrao of WMSG_PATTERNS) {
      // Comparar sequência exata
      if (ultimas4.every((cor, i) => cor === padrao.seq[i])) {
        return {
          nome: padrao.id,
          acao: padrao.enter,
          confianca: 85,
          comGale: false,
          source: 'wmsg',
          patternId: padrao.id,
          desc: padrao.desc,
          matchType: 'sequential',
          patternType: padrao.type || 'wmsg'
        };
      }
    }
    return null;
  }

  function wmsg_ConvertToGrid(historico) {
    const LINHAS = 6;
    const grid = [];

    // Reorganiza histórico linear em grid 2D (6 linhas × N colunas)
    // historico é [{ cor, rodada }, ...]
    const porRodada = new Map();
    for (const item of historico) {
      const rod = item.rodada || 0;
      if (!porRodada.has(rod)) porRodada.set(rod, []);
      porRodada.get(rod).push(item.cor);
    }

    // Construir grid onde cada coluna é uma rodada
    const rodadas = Array.from(porRodada.keys()).sort((a, b) => a - b);
    for (const rod of rodadas) {
      const coresRodada = porRodada.get(rod) || [];
      for (let linha = 0; linha < LINHAS; linha++) {
        if (!grid[linha]) grid[linha] = [];
        grid[linha].push(coresRodada[linha] || 'desconhecido');
      }
    }

    return { grid, porRodada };
  }

  function wmsg_MatchLine(historico) {
    if (historico.length < 4) return null;

    const { grid } = wmsg_ConvertToGrid(historico);
    if (grid.length === 0) return null;

    // Verificar cada linha (6 linhas possíveis)
    for (let linha = 0; linha < grid.length; linha++) {
      const seqLinha = grid[linha];
      if (seqLinha.length < 4) continue;

      const ultimas4 = seqLinha.slice(-4);

      for (const padrao of WMSG_PATTERNS) {
        if (ultimas4.every((cor, i) => cor === padrao.seq[i])) {
          return {
            nome: `${padrao.id} (Linha ${linha + 1})`,
            acao: padrao.enter,
            confianca: 82,
            comGale: false,
            source: 'wmsg-line',
            patternId: padrao.id,
            desc: `${padrao.desc} (detectado em linha ${linha + 1})`,
            matchType: 'linha',
            linha
          };
        }
      }
    }
    return null;
  }

  function wmsg_MatchDiagonal(historico) {
    if (historico.length < 6) return null;

    const { grid } = wmsg_ConvertToGrid(historico);
    if (grid.length < 4) return null;

    const cols = grid[0]?.length || 0;
    if (cols < 4) return null;

    // Varrer diagonais (↘ e ↙)
    // Diagonal ↘: (linha i, coluna j), (linha i+1, coluna j+1), etc.
    for (let startCol = 0; startCol <= cols - 4; startCol++) {
      for (let startLinha = 0; startLinha <= grid.length - 4; startLinha++) {
        const diagonal = [];
        for (let offset = 0; offset < 4; offset++) {
          const l = startLinha + offset;
          const c = startCol + offset;
          if (l < grid.length && c < cols) {
            diagonal.push(grid[l][c]);
          }
        }

        if (diagonal.length === 4) {
          for (const padrao of WMSG_PATTERNS) {
            if (diagonal.every((cor, i) => cor === padrao.seq[i])) {
              return {
                nome: `${padrao.id} (Diagonal ↘)`,
                acao: padrao.enter,
                confianca: 79,
                comGale: false,
                source: 'wmsg-diag',
                patternId: padrao.id,
                desc: `${padrao.desc} (detectado em diagonal)`,
                matchType: 'diagonal',
                diag: { startLinha, startCol, dir: 'down-right' }
              };
            }
          }
        }
      }
    }

    // Diagonal ↙: (linha i, coluna j), (linha i+1, coluna j-1), etc.
    for (let startCol = 3; startCol < cols; startCol++) {
      for (let startLinha = 0; startLinha <= grid.length - 4; startLinha++) {
        const diagonal = [];
        for (let offset = 0; offset < 4; offset++) {
          const l = startLinha + offset;
          const c = startCol - offset;
          if (l < grid.length && c >= 0) {
            diagonal.push(grid[l][c]);
          }
        }

        if (diagonal.length === 4) {
          for (const padrao of WMSG_PATTERNS) {
            if (diagonal.every((cor, i) => cor === padrao.seq[i])) {
              return {
                nome: `${padrao.id} (Diagonal ↙)`,
                acao: padrao.enter,
                confianca: 79,
                comGale: false,
                source: 'wmsg-diag',
                patternId: padrao.id,
                desc: `${padrao.desc} (detectado em diagonal)`,
                matchType: 'diagonal',
                diag: { startLinha, startCol, dir: 'down-left' }
              };
            }
          }
        }
      }
    }

    return null;
  }

  // Wrapper para WMSG — testa sequencial, linha, diagonal
  function wmsg_AllMethods(cores) {
    const historicoCompleto = Collector?.getHistorico?.() || [];

    // Prioridade: sequencial > linha > diagonal
    const seq = wmsg_MatchExactSequence(cores);
    if (seq) return seq;

    const linha = wmsg_MatchLine(historicoCompleto);
    if (linha) return linha;

    const diag = wmsg_MatchDiagonal(historicoCompleto);
    if (diag) return diag;

    return null;
  }

  // =====================================================
  // LISTA DE PADRÕES ATIVOS — apenas os 18 WMSG do Will Dados Pro.
  // Diego removeu (17/05) os 14 WILL-XXX extras e os 18 padroes genericos
  // (padrao01-18) porque disparavam em quase toda rodada (probabilidade ~100%
  // combinada), gerando indicacao constante quando deveria mostrar
  // "Aguardando padrao". Agora se nenhum WMSG bater -> array vazio.
  // =====================================================
  const todosPadroes = [
    wmsg_AllMethods  // 18 padroes WMSG (sequencial + linha + diagonal)
  ];

  // --- API Pública ---
  return {
    /**
     * Analisa as cores e retorna todos os padrões detectados.
     * Loga no console os padrões ativos.
     */
    analisar(cores) {
      if (!cores || cores.length < 2) return [];

      const detectados = [];

      // 1. Casadinho Especial — máxima prioridade (2 empates consecutivos)
      if (cores.length >= 3 && cores[cores.length - 1] === 'empate' && cores[cores.length - 2] === 'empate') {
        const corAnterior = cores.slice(0, -2).reverse().find(c => c !== 'empate');
        if (corAnterior) {
          detectados.push({
            nome: 'Casadinho (Will Original)',
            acao: corAnterior,
            confianca: 92,
            comGale: true
          });
        }
      }

      // 2. Estratégias da Biblioteca (só uma vez — com o histórico completo)
      //    Removida a análise duplicada "Sem empates" que inflava sinais artificialmente.
      const strategiesDetectadas = analisarStrategies(cores);
      for (const s of strategiesDetectadas) {
        if (!detectados.find(d => d.nome === s.nome)) {
          detectados.push(s);
        }
      }

      // 3. Padrões Nativos (Hardcoded "Will Style") — com o histórico completo
      for (const fn of todosPadroes) {
        try {
          const resultado = fn(cores);
          if (resultado && resultado.acao) {
            if (!detectados.find(d => d.nome === resultado.nome)) {
              detectados.push(resultado);
            }
          }
        } catch (e) {
          Logger.error(`Erro no padrão: ${e.message}`);
        }
      }

      // 4. Ordenar por confiança (maior primeiro)
      detectados.sort((a, b) => b.confianca - a.confianca);

      // 5. Deduplicar por ação: manter apenas o padrão de maior confiança por ação
      //    EXCETO: manter sinais de ações diferentes (vermelho, azul, empate) todos visíveis
      const vistosPorAcao = new Map();
      const unicos = detectados.filter(d => {
        if (!d.acao) return false;
        if (vistosPorAcao.has(d.acao)) return false;
        vistosPorAcao.set(d.acao, true);
        return true;
      });

      if (unicos.length > 0) {
        console.log('[BetBoom Auto] Padrões detectados:', unicos.map(d => `${d.nome} → ${d.acao} (${d.confianca}%)`));
      }

      Logger.debug(`Padrões detectados: ${unicos.length}`, unicos.map(d => d.nome));
      lastDetectedStrategies = unicos;
      return unicos;
    },

    /**
     * Retorna o melhor padrão (maior confiança).
     */
    melhorPadrao(cores) {
      const detectados = this.analisar(cores);
      return detectados.length > 0 ? detectados[0] : null;
    },

    /**
     * Retorna a lista de nomes de todos os padrões disponíveis.
     */
    listarPadroes() {
      if (getActiveStrategies().length > 0) {
        return getActiveStrategies().map((strategy) => strategy.nome);
      }
      const wmsgNames = WMSG_PATTERNS.map(p => `${p.id}`);
      return [
        ...wmsgNames,
        '1. Xadrez',
        '2. Reversão (até G1)',
        '3. Pós-Empate',
        '4. Diagonal',
        '5. Casadinho',
        '6. Linha Devedora',
        '7. Quebra de Padrão',
        '8. Sequência de 2',
        '9. Sequência de 3 (até G1)',
        '10. Ponta / Quadrante',
        '11. Xadrez sem Gale',
        '12. Ping-Pong',
        '13. Xadrez Duplo (2-2-2)',
        '14. Tendência Dominante',
        '15. Correção Após Empate',
        '16. Espelho',
        '17. Canal Horizontal',
        '18. Reversão Diagonal'
      ];
    },

    /**
     * Loga no console todos os padrões ativos (WMSG + Dinâmicos + Nativos 2025).
     */
    logPadroesAtivos() {
      const dynamicStrats = getActiveStrategies();
      const natives = [];
      const nomesNativos = {
        xadrez: 'Xadrez',
        reversao: 'Reversão (até G1)',
        posEmpate: 'Pós-Empate',
        diagonal: 'Diagonal',
        casadinho: 'Casadinho',
        linhaDevedora: 'Linha Devedora',
        quebrapadrao: 'Quebra de Padrão',
        sequenciaDe2: 'Sequência de 2',
        sequenciaDe3: 'Sequência de 3 (até G1)',
        ponta: 'Ponta / Quadrante',
        xadrezSemGale: 'Xadrez sem Gale',
        pingPong: 'Ping-Pong',
        xadrezDuplo: 'Xadrez Duplo (2-2-2)',
        tendencia: 'Tendência Dominante',
        correcaoEmpate: 'Correção Após Empate',
        espelho: 'Espelho',
        canalHorizontal: 'Canal Horizontal',
        reversaoDiagonal: 'Reversão Diagonal'
      };

      for (const [key, nome] of Object.entries(nomesNativos)) {
        if (CONFIG.padroesAtivos[key]) natives.push(nome);
      }

      console.log('[BetBoom Auto] === INTELIGÊNCIA ATIVA (Will Dados Pro) ===');

      console.log(`[BetBoom Auto]  - Padrões WMSG (Will Sequências Exatas): ${WMSG_PATTERNS.length} padrões`);
      WMSG_PATTERNS.forEach((p, i) => console.log(`[BetBoom Auto]    ${i + 1}. ${p.id} → ${p.enter}`));

      console.log(`[BetBoom Auto]  - Padrões WILL Extras (streaks longos, complexos, empate duplo): ${WILL_EXTRA_PATTERNS.length} padrões`);
      WILL_EXTRA_PATTERNS.forEach((p, i) => console.log(`[BetBoom Auto]    ${i + 1}. ${p.id} (tam=${p.seq.length}) → ${p.enter}`));

      if (dynamicStrats.length > 0) {
        console.log('[BetBoom Auto]  - Bibliotecas Dinâmicas:');
        dynamicStrats.forEach((s, i) => console.log(`[BetBoom Auto]    ${i + 1}. ${s.nome} (${s.source})`));
      }

      console.log('[BetBoom Auto]  - Padrões Nativos (Hardcoded):');
      natives.forEach((nome, i) => console.log(`[BetBoom Auto]    ${i + 1}. ${nome}`));

      const totalPadroes = WMSG_PATTERNS.length + WILL_EXTRA_PATTERNS.length + dynamicStrats.length + natives.length;
      console.log(`[BetBoom Auto] Total: ${totalPadroes} estratégias operacionais.`);
      return [
        ...WMSG_PATTERNS.map(p => p.id),
        ...WILL_EXTRA_PATTERNS.map(p => p.id),
        ...dynamicStrats.map(s => s.nome),
        ...natives
      ];
    },

    setStrategyLibrary(list) {
      strategyLibrary = BBStrategyUtils.ensureStrategyLibrary(list);
      CONFIG.strategyLibrary = strategyLibrary;
      return strategyLibrary;
    },

    getStrategyLibrary() {
      return [...strategyLibrary];
    },

    getStrategyStatus() {
      return {
        total: strategyLibrary.length,
        ativas: getActiveStrategies().length,
        ultimaCorresp: lastDetectedStrategies[0] || null,
        estrategias: strategyLibrary.map((strategy) => ({
          id: strategy.id,
          nome: strategy.nome,
          source: strategy.source,
          active: strategy.active
        }))
      };
    },

    getLastDetectedStrategies() {
      return lastDetectedStrategies.map((item) => ({
        ...item,
        strategy: item.strategy ? { ...item.strategy } : item.strategy
      }));
    },

    /**
     * Quantidade total de padrões (WMSG + WILL extras + Nativos).
     */
    totalPadroes: WMSG_PATTERNS.length + WILL_EXTRA_PATTERNS.length + todosPadroes.length,

    /**
     * Retorna lista de padrões WILL Extras (streaks longos, complexos, empate duplo).
     */
    getWILLExtraPatterns() {
      return WILL_EXTRA_PATTERNS.map(p => ({ ...p, seq: [...p.seq] }));
    },

    /**
     * Retorna lista de padrões WMSG oficiais.
     */
    getWMSGPatterns() {
      return WMSG_PATTERNS.map(p => ({
        id: p.id,
        sequence: p.seq,
        enter: p.enter,
        description: p.desc
      }));
    }
  };
})();
