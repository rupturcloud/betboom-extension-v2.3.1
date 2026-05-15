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
  // PADRÃO 1: XADREZ (Alternância — Will: "azul vermelho azul, qual a chance de descer azul")
  // Analisa 4 casas, se alternância, entra na continuação.
  // Will: entrada até G1 se confirma em cima E embaixo.
  // Se só confirma em uma linha → sem gale.
  // =====================================================
  function padrao01_Xadrez(cores) {
    if (!CONFIG.padroesAtivos.xadrez) return null;
    
    // Will: Xadrez 4 é o gatilho padrão
    if (isAlternancia(cores, 4, true)) {
      const filtradas = cores.filter(c => c !== 'empate');
      const ultima = filtradas[filtradas.length - 1];
      const proxima = corOposta(ultima);
      return {
        nome: 'Xadrez',
        acao: proxima,
        confianca: 72,
        comGale: true,
        recognizedSequence: BBStrategyUtils.sequenceToLabel(cores.slice(-6))
      };
    }
    return null;
  }

  // =====================================================
  // PADRÃO 2: REVERSÃO (Will: "quatro vermelho, ele entraria no azul")
  // Cobre 4+ iguais → oposto. Will usa até G1.
  // CORRIGIDO: Preenche o buraco entre Seq3 (exatamente 3) e o antigo Sniper (6+).
  //   4 iguais → Reversão Forte (confiança 72, G1)
  //   5 iguais → Reversão Muito Forte (confiança 80, G1)
  //   6+ iguais → Sniper (confiança 90+, G1)
  // =====================================================
  function padrao02_Reversao(cores) {
    if (!CONFIG.padroesAtivos.reversao) return null;
    if (cores.length < 4) return null;

    const filtradas = cores.filter(c => c !== 'empate');
    const seq = contarSequenciaFinal(filtradas);

    if (seq.count < 4 || seq.cor === 'empate') return null;

    if (seq.count >= 6) {
      return {
        nome: 'Sniper (Reversão 6+)',
        acao: corOposta(seq.cor),
        confianca: Math.min(90 + (seq.count - 6) * 2, 98),
        comGale: true
      };
    }

    if (seq.count === 5) {
      return {
        nome: 'Reversão Forte (5 iguais)',
        acao: corOposta(seq.cor),
        confianca: 80,
        comGale: true
      };
    }

    // seq.count === 4
    return {
      nome: 'Reversão (4 iguais)',
      acao: corOposta(seq.cor),
      confianca: 72,
      comGale: true
    };
  }

  // =====================================================
  // PADRÃO 3: PÓS-EMPATE (Will: "quando é um empate, você vai jogar para pegar do lado dele")
  // Após empate, jogar na cor que antecedeu o empate.
  // CORRIGIDO: Mutuamente exclusivo com Padrão 15 (Correção Após Empate).
  // Pós-Empate: quando último resultado é empate E não há dominância clara anterior.
  // Se houver dominância clara, o Padrão 15 assume.
  // =====================================================
  function padrao03_PosEmpate(cores) {
    if (!CONFIG.padroesAtivos.posEmpate) return null;
    if (cores.length < 3) return null;
    if (cores[cores.length - 1] !== 'empate') return null;

    const anteriores = cores.slice(0, -1).filter(c => c !== 'empate');
    if (anteriores.length < 1) return null;

    // Se Padrão 15 (Correção Após Empate) vai disparar com dominância clara, não duplicar
    if (anteriores.length >= 3) {
      const ultimas3 = anteriores.slice(-3);
      const v = ultimas3.filter(c => c === 'vermelho').length;
      const a = ultimas3.filter(c => c === 'azul').length;
      // Se dominância ≥ 3:0 ou 2:1 (clara), deixar para o Padrão 15
      if (v >= 2 || a >= 2) return null;
    }

    const corAnterior = anteriores[anteriores.length - 1];
    return {
      nome: 'Pós-Empate',
      acao: corAnterior,
      confianca: 58,
      comGale: true
    };
  }

  // =====================================================
  // PADRÃO 4: DIAGONAL (Will: "pagou uma diagonal quatro vezes, diagonal linda")
  // Posições alternadas formam mesma cor (visual no gráfico).
  // =====================================================
  function padrao04_Diagonal(cores) {
    if (!CONFIG.padroesAtivos.diagonal) return null;
    if (cores.length < 6) return null;

    const ultimas = cores.slice(-6);
    const pares = [ultimas[0], ultimas[2], ultimas[4]];
    const impares = [ultimas[1], ultimas[3], ultimas[5]];

    const paresSaoCor = pares.every(c => c === pares[0] && c !== 'empate');
    const imparesSaoCor = impares.every(c => c === impares[0] && c !== 'empate');

    if (paresSaoCor && imparesSaoCor && pares[0] !== impares[0]) {
      return {
        nome: 'Diagonal',
        acao: pares[0],
        confianca: 65,
        comGale: false
      };
    }
    return null;
  }

  // =====================================================
  // PADRÃO 5: CASADINHO (Will: "casadinho, um do lado do outro")
  // Empate recente → chance de outro empate (lado a lado ou diagonal).
  // Will: faz G1 no casadinho.
  // =====================================================
  function padrao05_Casadinho(cores) {
    if (!CONFIG.padroesAtivos.casadinho) return null;
    if (cores.length < 4) return null;

    const ultimas = cores.slice(-4);
    const empatesRecentes = ultimas.filter(c => c === 'empate').length;

    // Se houve empate nas últimas 3 rodadas (mas não na última), chance de casadinho
    if (empatesRecentes === 1 && ultimas[ultimas.length - 1] !== 'empate') {
      return {
        nome: 'Casadinho',
        acao: 'empate',
        confianca: 42,
        comGale: true // Will faz G1 no casadinho
      };
    }
    return null;
  }

  // =====================================================
  // PADRÃO 6: LINHA DEVEDORA (Will: "linha devedora, grande chance de pagar empate")
  // Cor ou empate ausente há muitas rodadas → "deve" pagar.
  // =====================================================
  function padrao06_LinhaDevedora(cores) {
    if (!CONFIG.padroesAtivos.linhaDevedora) return null;
    if (cores.length < 8) return null;

    const ultimas = cores.slice(-8);
    const vermelhos = ultimas.filter(c => c === 'vermelho').length;
    const azuis = ultimas.filter(c => c === 'azul').length;
    const empates = ultimas.filter(c => c === 'empate').length;

    // Will menciona especificamente empate como linha devedora
    if (empates === 0 && cores.length >= 12) {
      const ultimas12 = cores.slice(-12);
      const empates12 = ultimas12.filter(c => c === 'empate').length;
      if (empates12 === 0) {
        return {
          nome: 'Linha Devedora (Empate)',
          acao: 'empate',
          confianca: 45,
          comGale: false
        };
      }
    }

    if (vermelhos === 0) {
      return {
        nome: 'Linha Devedora (Vermelho)',
        acao: 'vermelho',
        confianca: 55,
        comGale: true
      };
    }
    if (azuis === 0) {
      return {
        nome: 'Linha Devedora (Azul)',
        acao: 'azul',
        confianca: 55,
        comGale: true
      };
    }
    return null;
  }

  // =====================================================
  // PADRÃO 7: QUEBRA DE PADRÃO (Will: "se aqui embaixo não bater o padrão,
  // vou jogar o contrário" / "quebrou em cima então arrisca ao contrário embaixo")
  // Se alternância quebrou, apostar na continuação da quebra.
  // =====================================================
  function padrao07_QuebraPadrao(cores) {
    if (!CONFIG.padroesAtivos.quebrapadrao) return null;
    if (cores.length < 5) return null;

    const ultimas = cores.slice(-5);
    // Se havia alternância nas 4 anteriores e a última quebrou
    if (isAlternancia(cores.slice(-5, -1), 4)) {
      const esperada = corOposta(ultimas[ultimas.length - 2]);
      const real = ultimas[ultimas.length - 1];
      if (real !== esperada && real !== 'empate') {
        return {
          nome: 'Quebra de Padrão',
          acao: real, // seguir a quebra
          confianca: 52,
          comGale: false // Will: sem gale na quebra
        };
      }
    }
    return null;
  }

  // =====================================================
  // PADRÃO 8: SEQUÊNCIA DE 2 (Will: "dois azul para puxar dois vermelhos
  // para puxar dois azul, posso fazer a jogada até o primeiro gale")
  // Pares alternados: AA-BB → próximo par.
  // =====================================================
  function padrao08_SequenciaDe2(cores) {
    if (!CONFIG.padroesAtivos.sequenciaDe2) return null;
    if (cores.length < 4) return null;

    const ultimas = cores.slice(-4);
    // Verificar padrão: AA-BB (dois iguais seguidos de dois iguais opostos)
    if (
      ultimas[0] === ultimas[1] &&
      ultimas[2] === ultimas[3] &&
      ultimas[0] !== ultimas[2] &&
      ultimas[0] !== 'empate' &&
      ultimas[2] !== 'empate'
    ) {
      return {
        nome: 'Sequência de 2',
        acao: ultimas[0], // volta para a primeira cor do par
        confianca: 63,
        comGale: true // Will: até G1
      };
    }
    return null;
  }

  // =====================================================
  // PADRÃO 9: SEQUÊNCIA DE 3 (Will: "três vermelho, ele vai entrar no azul")
  // Exatamente 3 iguais consecutivos (sem empates no meio) → oposto. Até G1.
  // CORRIGIDO: usa filtradas (sem empates) para consistência com Padrão 02.
  //            Não colide com Padrão 02 (que cobre 4+ filtradas).
  // =====================================================
  function padrao09_SequenciaDe3(cores) {
    if (!CONFIG.padroesAtivos.sequenciaDe3) return null;
    if (cores.length < 3) return null;

    const filtradas = cores.filter(c => c !== 'empate');
    if (filtradas.length < 3) return null;

    const seq = contarSequenciaFinal(filtradas);
    // Exatamente 3 (Padrão 02 cobre 4+, então não duplicar)
    if (seq.count === 3 && seq.cor !== 'empate') {
      return {
        nome: 'Sequência de 3',
        acao: corOposta(seq.cor),
        confianca: 65,
        comGale: true
      };
    }
    return null;
  }

  // =====================================================
  // PADRÃO 10: PONTA / QUADRANTE (Will: "conta aqui no final uma duas três quatro,
  // aí você conta daqui para frente")
  // Análise das últimas 4 casas para identificar tendência.
  // Se 3 de 4 são mesma cor → apostar nessa cor.
  // =====================================================
  function padrao10_Ponta(cores) {
    if (!CONFIG.padroesAtivos.ponta) return null;
    if (cores.length < 4) return null;

    const ultimas4 = cores.slice(-4).filter(c => c !== 'empate');
    if (ultimas4.length < 3) return null;

    const vermelhos = ultimas4.filter(c => c === 'vermelho').length;
    const azuis = ultimas4.filter(c => c === 'azul').length;

    // 3 de 4 (ou 3 de 3 sem empate) = tendência forte no quadrante
    if (vermelhos >= 3) {
      return {
        nome: 'Ponta (Vermelho)',
        acao: 'vermelho',
        confianca: 60,
        comGale: true // até G1
      };
    }
    if (azuis >= 3) {
      return {
        nome: 'Ponta (Azul)',
        acao: 'azul',
        confianca: 60,
        comGale: true
      };
    }
    return null;
  }

  // =====================================================
  // PADRÃO 11: XADREZ SEM GALE (Will: "seria uma entrada sem gale")
  // Xadrez que confirma em apenas uma linha (cima OU baixo, não ambas).
  // Entrada sem gale.
  // CORRIGIDO: filtra empates antes de verificar alternância (igual ao Padrão 01)
  //            evita colisão com Padrão 01 (que já cobre isAlternancia de 4+).
  // =====================================================
  function padrao11_XadrezSemGale(cores) {
    if (!CONFIG.padroesAtivos.xadrezSemGale) return null;
    if (cores.length < 3) return null;

    // Filtrar empates para análise de alternância
    const filtradas = cores.filter(c => c !== 'empate');
    if (filtradas.length < 3) return null;

    // Só dispara se for alternância de exatamente 3 (não 4+, para não duplicar com Xadrez)
    if (isAlternancia(filtradas, 3, false) && !isAlternancia(filtradas, 4, false)) {
      const ultima = filtradas[filtradas.length - 1];
      return {
        nome: 'Xadrez sem Gale',
        acao: corOposta(ultima),
        confianca: 48,
        comGale: false
      };
    }
    return null;
  }

  // =====================================================
  // PADRÃO 12: PING-PONG (Alternância longa 6+)
  // =====================================================
  function padrao12_PingPong(cores) {
    if (!CONFIG.padroesAtivos.pingPong) return null;
    if (cores.length < 6) return null;

    if (isAlternancia(cores, 6)) {
      const ultima = cores[cores.length - 1];
      return {
        nome: 'Ping-Pong',
        acao: corOposta(ultima),
        confianca: 75,
        comGale: false
      };
    }
    return null;
  }

  // =====================================================
  // PADRÃO 13: XADREZ DUPLO (Pares 2-2-2)
  // =====================================================
  function padrao13_XadrezDuplo(cores) {
    if (!CONFIG.padroesAtivos.xadrezDuplo) return null;
    if (cores.length < 6) return null;

    const ultimas = cores.slice(-6);
    if (
      ultimas[0] === ultimas[1] &&
      ultimas[2] === ultimas[3] &&
      ultimas[4] === ultimas[5] &&
      ultimas[0] !== ultimas[2] &&
      ultimas[2] !== ultimas[4] &&
      ultimas[0] !== 'empate' &&
      ultimas[2] !== 'empate'
    ) {
      const proxima = corOposta(ultimas[5]);
      return {
        nome: 'Xadrez Duplo (2-2-2)',
        acao: proxima,
        confianca: 62,
        comGale: true
      };
    }
    return null;
  }

  // =====================================================
  // PADRÃO 14: TENDÊNCIA DOMINANTE (70%+ de uma cor nas últimas 10)
  // =====================================================
  function padrao14_Tendencia(cores) {
    if (!CONFIG.padroesAtivos.tendencia) return null;
    if (cores.length < 10) return null;

    const ultimas = cores.slice(-10);
    const vermelhos = ultimas.filter(c => c === 'vermelho').length;
    const azuis = ultimas.filter(c => c === 'azul').length;

    if (vermelhos >= 7) {
      return {
        nome: 'Tendência (Vermelho)',
        acao: 'vermelho',
        confianca: 55,
        comGale: false
      };
    }
    if (azuis >= 7) {
      return {
        nome: 'Tendência (Azul)',
        acao: 'azul',
        confianca: 55,
        comGale: false
      };
    }
    return null;
  }

  // =====================================================
  // PADRÃO 15: CORREÇÃO APÓS EMPATE (pós-empate → cor dominante)
  // =====================================================
  function padrao15_CorrecaoEmpate(cores) {
    if (!CONFIG.padroesAtivos.correcaoEmpate) return null;
    if (cores.length < 5) return null;

    if (cores[cores.length - 1] === 'empate') {
      const anteriores = cores.slice(-6, -1).filter(c => c !== 'empate');
      if (anteriores.length >= 3) {
        const vermelhos = anteriores.filter(c => c === 'vermelho').length;
        const azuis = anteriores.filter(c => c === 'azul').length;
        const dominante = vermelhos > azuis ? 'vermelho' : 'azul';
        return {
          nome: 'Correção Após Empate',
          acao: dominante,
          confianca: 50,
          comGale: true
        };
      }
    }
    return null;
  }

  // =====================================================
  // PADRÃO 16: ESPELHO ENTRE LINHAS (bloco espelha anterior)
  // =====================================================
  function padrao16_Espelho(cores) {
    if (!CONFIG.padroesAtivos.espelho) return null;
    if (cores.length < 8) return null;

    const bloco1 = cores.slice(-8, -4);
    const bloco2 = cores.slice(-4);
    const espelho = [...bloco1].reverse();
    let match = 0;
    for (let i = 0; i < 4; i++) {
      if (bloco2[i] === espelho[i]) match++;
    }

    if (match >= 3) {
      const proxIdx = cores.length - 8;
      if (proxIdx >= 0 && cores[proxIdx] !== 'empate') {
        return {
          nome: 'Espelho',
          acao: cores[proxIdx],
          confianca: 50,
          comGale: false
        };
      }
    }
    return null;
  }

  // =====================================================
  // PADRÃO 17: CANAL HORIZONTAL (mesma cor domina faixa de 5)
  // =====================================================
  function padrao17_CanalHorizontal(cores) {
    if (!CONFIG.padroesAtivos.canalHorizontal) return null;
    if (cores.length < 5) return null;

    const ultimas = cores.slice(-5);
    const semEmpate = ultimas.filter(c => c !== 'empate');
    if (semEmpate.length >= 4) {
      const vermelhos = semEmpate.filter(c => c === 'vermelho').length;
      const azuis = semEmpate.filter(c => c === 'azul').length;

      if (vermelhos >= 4) {
        return {
          nome: 'Canal Horizontal (Vermelho)',
          acao: 'vermelho',
          confianca: 55,
          comGale: false
        };
      }
      if (azuis >= 4) {
        return {
          nome: 'Canal Horizontal (Azul)',
          acao: 'azul',
          confianca: 55,
          comGale: false
        };
      }
    }
    return null;
  }

  // =====================================================
  // PADRÃO 18: REVERSÃO DIAGONAL (Will: "diagonal de 3 puxa quebra")
  // Detecta padrão diagonal real no roadmap: posições intercaladas formam
  // uma tendência, e a última posição rompe a diagonal.
  // CORRIGIDO: não mais duplica Padrão 09 (3 iguais consecutivos).
  //            Foca em detectar quebra de alternância em posições pares/ímpares.
  // =====================================================
  function padrao18_ReversaoDiagonal(cores) {
    if (!CONFIG.padroesAtivos.reversaoDiagonal) return null;
    if (cores.length < 5) return null;

    const filtradas = cores.filter(c => c !== 'empate');
    if (filtradas.length < 5) return null;

    // Detectar diagonal: ABAB (alternância nas posições pares e ímpares)
    // e a última quebrou essa alternância — reverter.
    const ultimas = filtradas.slice(-5);
    // Posições pares (0,2,4) devem ser iguais, ímpares (1,3) opostas
    const p0 = ultimas[0], p2 = ultimas[2], p4 = ultimas[4];
    const p1 = ultimas[1], p3 = ultimas[3];

    const paresDiagonal = p0 === p2 && p2 !== p4 && p0 !== 'empate' && p4 !== 'empate';
    const imparesDiagonal = p1 === p3 && p1 !== 'empate';
    const altCerta = p0 !== p1 && p1 !== p2 && p2 !== p3;

    if (paresDiagonal && imparesDiagonal && altCerta) {
      // A diagonal quebrou no p4 — reverter em direção à diagonal original
      return {
        nome: 'Reversão Diagonal',
        acao: p0, // Retornar à cor dominante da diagonal
        confianca: 62,
        comGale: true,
        observacao: 'Diagonal visual quebrou — reversão para cor dominante'
      };
    }
    return null;
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

  // =====================================================
  // PADRÕES WILL EXTRAS — sequências de tamanho variável (3, 5, 7)
  // Conteúdo de negócio enviado por Diego/Will. Complementa os 18 WMSG.
  // =====================================================
  const WILL_EXTRA_PATTERNS = [
    // Streaks longos (5)
    { id: "WILL-001", type: 'streak',   seq: ['azul','azul','azul','azul','vermelho'], enter: 'vermelho', desc: "4 Azuis e 1 Vermelho. Continua a quebra: FORA." },
    { id: "WILL-002", type: 'streak',   seq: ['vermelho','vermelho','vermelho','vermelho','azul'], enter: 'azul', desc: "4 Vermelhos e 1 Azul. Continua a quebra: CASA." },
    // Streaks ultra-longos (7)
    { id: "WILL-003", type: 'streak',   seq: ['azul','azul','azul','azul','azul','azul','azul'], enter: 'vermelho', desc: "7 Azuis consecutivos. Reversao forte: FORA." },
    { id: "WILL-004", type: 'streak',   seq: ['vermelho','vermelho','vermelho','vermelho','vermelho','vermelho','vermelho'], enter: 'azul', desc: "7 Vermelhos consecutivos. Reversao forte: CASA." },
    // Padrões complexos (7)
    { id: "WILL-005", type: 'complex',  seq: ['azul','azul','vermelho','vermelho','azul','vermelho','vermelho'], enter: 'azul', desc: "AAVVAVV — sequencia complexa. Vira: CASA." },
    { id: "WILL-006", type: 'complex',  seq: ['vermelho','vermelho','azul','azul','vermelho','azul','azul'], enter: 'vermelho', desc: "VVAAVAA — sequencia complexa. Vira: FORA." },
    // Zigue-zague longo (5)
    { id: "WILL-007", type: 'zigzag',   seq: ['azul','vermelho','azul','vermelho','azul'], enter: 'azul', desc: "Zigue-Zague AVAVA. Segue ciclo: CASA." },
    { id: "WILL-008", type: 'zigzag',   seq: ['vermelho','azul','vermelho','azul','vermelho'], enter: 'vermelho', desc: "Zigue-Zague VAVAV. Segue ciclo: FORA." },
    // Pos empate duplo (3)
    { id: "WILL-009", type: 'tie',      seq: ['empate','empate','azul'], enter: 'vermelho', desc: "Dois empates seguidos de Azul. Vira: FORA." },
    { id: "WILL-010", type: 'tie',      seq: ['empate','empate','vermelho'], enter: 'azul', desc: "Dois empates seguidos de Vermelho. Vira: CASA." },
    // Empate intercalado (4)
    { id: "WILL-011", type: 'tie',      seq: ['empate','azul','empate','vermelho'], enter: 'azul', desc: "Empate-Azul-Empate-Vermelho. Reversao: CASA." },
    { id: "WILL-012", type: 'tie',      seq: ['empate','vermelho','empate','azul'], enter: 'vermelho', desc: "Empate-Vermelho-Empate-Azul. Reversao: FORA." },
    // Espelhos longos (5)
    { id: "WILL-013", type: 'mirror',   seq: ['azul','azul','azul','vermelho','vermelho'], enter: 'azul', desc: "3 Azuis + 2 Vermelhos. Vira: CASA." },
    { id: "WILL-014", type: 'mirror',   seq: ['vermelho','vermelho','vermelho','azul','azul'], enter: 'vermelho', desc: "3 Vermelhos + 2 Azuis. Vira: FORA." }
  ];

  /**
   * Matcher para padrões WILL extras — testa em ultimas N casas onde N é o tamanho do padrão.
   * Prioridade: padrões mais longos primeiro (mais específicos).
   */
  function will_MatchExtra(cores) {
    if (!cores || cores.length < 3) return null;

    // Ordena padrões por tamanho desc (mais específico primeiro)
    const padroesOrdenados = [...WILL_EXTRA_PATTERNS].sort((a, b) => b.seq.length - a.seq.length);

    for (const padrao of padroesOrdenados) {
      if (cores.length < padrao.seq.length) continue;

      const ultimas = cores.slice(-padrao.seq.length);
      if (ultimas.every((cor, i) => cor === padrao.seq[i])) {
        return {
          nome: padrao.id,
          acao: padrao.enter,
          confianca: 85,
          comGale: false,
          source: 'will-extra',
          patternId: padrao.id,
          strategyId: padrao.id,
          recognizedSequence: padrao.seq.join('-'),
          sequenceBase: padrao.seq,
          desc: padrao.desc,
          matchType: 'sequential-extra',
          tamanho: padrao.seq.length,
          patternType: padrao.type || 'extra'
        };
      }
    }

    return null;
  }

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
  // LISTA DE TODOS OS PADRÕES (ORDEM DE PRIORIDADE DO WILL)
  // =====================================================
  const todosPadroes = [
    will_MatchExtra,  // 14 padrões WILL extras (streaks 5/7, zig-zag 5, espelhos 5, empate duplo) — prioridade máxima por especificidade
    wmsg_AllMethods,  // 18 padrões WMSG (sequencial + linha + diagonal) — prioridade 1
    padrao01_Xadrez,
    padrao02_Reversao,
    padrao03_PosEmpate,
    padrao04_Diagonal,
    padrao05_Casadinho,
    padrao06_LinhaDevedora,
    padrao07_QuebraPadrao,
    padrao08_SequenciaDe2,
    padrao09_SequenciaDe3,
    padrao10_Ponta,
    padrao11_XadrezSemGale,
    padrao12_PingPong,
    padrao13_XadrezDuplo,
    padrao14_Tendencia,
    padrao15_CorrecaoEmpate,
    padrao16_Espelho,
    padrao17_CanalHorizontal,
    padrao18_ReversaoDiagonal
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
