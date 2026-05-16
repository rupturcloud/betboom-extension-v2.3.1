/**
 * Pattern Entropy Engine
 * Mede entropia dos padrões detectados
 * Alta entropia = comportamento impredizível, baixa entropia = padrão claro
 */

const PatternEntropyEngine = (() => {
  const patternSequences = [];
  const entropyHistory = [];
  const windowSize = 50;

  function registrarPadraoDetectado(patternName) {
    patternSequences.push({
      pattern: patternName,
      timestamp: Date.now()
    });

    if (patternSequences.length > windowSize * 2) {
      patternSequences.shift();
    }
  }

  function calcularEntropiaShannonPadrao(windowSize = 20) {
    if (patternSequences.length < 2) return 0;

    const recent = patternSequences.slice(-windowSize);
    const frequencies = {};

    recent.forEach(entry => {
      frequencies[entry.pattern] = (frequencies[entry.pattern] || 0) + 1;
    });

    let entropy = 0;
    const total = recent.length;

    Object.values(frequencies).forEach(freq => {
      const p = freq / total;
      if (p > 0) {
        entropy -= p * Math.log2(p);
      }
    });

    // Normalizar por número máximo de padrões possível
    const maxEntropy = Math.log2(Object.keys(frequencies).length || 1);
    const normalizedEntropy = maxEntropy > 0 ? (entropy / maxEntropy) * 100 : 0;

    return Math.round(normalizedEntropy);
  }

  function obterDistribuicaoPadroes(windowSize = 50) {
    const recent = patternSequences.slice(-windowSize);
    const frequencies = {};

    recent.forEach(entry => {
      frequencies[entry.pattern] = (frequencies[entry.pattern] || 0) + 1;
    });

    const distribuicao = Object.entries(frequencies).map(([pattern, count]) => ({
      pattern,
      count,
      percentage: Math.round((count / recent.length) * 100)
    })).sort((a, b) => b.count - a.count);

    return {
      total: recent.length,
      padroesDiferentes: distribuicao.length,
      distribuicao
    };
  }

  function calcularDominancia(windowSize = 50) {
    const dist = obterDistribuicaoPadroes(windowSize);

    if (dist.distribuicao.length === 0) return 0;

    const topPattern = dist.distribuicao[0];
    return topPattern.percentage;
  }

  function detectarPadroesAnomalos() {
    const dist = obterDistribuicaoPadroes(windowSize);
    const anomalos = [];

    // Um padrão que aparece apenas 1-2 vezes em 50 rodadas
    dist.distribuicao.forEach(item => {
      if (item.count <= 2 && dist.total >= 30) {
        anomalos.push({
          pattern: item.pattern,
          count: item.count,
          percentage: item.percentage,
          tipo: 'RARO'
        });
      }
    });

    // Padrão que domina 80%+ das vezes
    if (dist.distribuicao[0] && dist.distribuicao[0].percentage > 80) {
      anomalos.push({
        pattern: dist.distribuicao[0].pattern,
        percentage: dist.distribuicao[0].percentage,
        tipo: 'DOMINANTE'
      });
    }

    return anomalos;
  }

  function analisarTransicoesPadrao(windowSize = 30) {
    if (patternSequences.length < 2) return null;

    const recent = patternSequences.slice(-windowSize);
    const transicoes = {};
    let transicoesTotais = 0;

    for (let i = 1; i < recent.length; i++) {
      const key = `${recent[i - 1].pattern} → ${recent[i].pattern}`;
      transicoes[key] = (transicoes[key] || 0) + 1;
      transicoesTotais++;
    }

    const topTransicoes = Object.entries(transicoes)
      .map(([transicao, count]) => ({
        transicao,
        count,
        percentage: Math.round((count / transicoesTotais) * 100)
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      transicoesTotais,
      topTransicoes,
      padraoRepetitivo: topTransicoes[0]?.percentage > 40
    };
  }

  function calcularPrevisibilidade(windowSize = 30) {
    const transicoes = analisarTransicoesPadrao(windowSize);
    if (!transicoes) return 0;

    // Previsibilidade = quanto as top transições representam do total
    const previsibilidade = transicoes.topTransicoes
      .reduce((sum, t) => sum + t.percentage, 0) / Math.min(transicoes.topTransicoes.length, 5);

    return Math.round(previsibilidade);
  }

  function gerarRelatorioEntropia() {
    const entropia = calcularEntropiaShannonPadrao();
    const dominancia = calcularDominancia();
    const dist = obterDistribuicaoPadroes();
    const anomalos = detectarPadroesAnomalos();
    const previsibilidade = calcularPrevisibilidade();

    const relatorio = {
      timestamp: Date.now(),
      metricas: {
        entropiaNormalizada: entropia,
        dominanciaTopPadrao: dominancia,
        numeroPadroesDiferentes: dist.padroesDiferentes,
        previsibilidade
      },
      saude: {
        status: entropia > 70 ? 'CAÓTICA' : (entropia > 50 ? 'VARIÁVEL' : (entropia > 30 ? 'ESTRUTURADA' : 'REPETITIVA')),
        recomendacao: entropia > 70 ? 'Baixa confiabilidade, revisar padrões' : (dominancia > 80 ? 'Padrão muito dominante, diversificar' : 'OK'),
        alertas: anomalos.length > 0 ? anomalos : []
      },
      distribuicao: dist.distribuicao
    };

    entropyHistory.push(relatorio);
    if (entropyHistory.length > 100) entropyHistory.shift();

    return relatorio;
  }

  function monitorarMudancasEntropia(intervaloMs = 1000) {
    let ultimaEntropia = null;

    return setInterval(() => {
      const entropia = calcularEntropiaShannonPadrao();

      if (ultimaEntropia !== null) {
        const mudanca = entropia - ultimaEntropia;
        if (Math.abs(mudanca) > 10) {
          console.log(`[ENTROPY] Mudança detectada: ${ultimaEntropia}% → ${entropia}% (${mudanca > 0 ? '+' : ''}${mudanca}%)`);
        }
      }

      ultimaEntropia = entropia;
    }, intervaloMs);
  }

  function getHistoricoEntropia(limit = 50) {
    return entropyHistory.slice(-limit);
  }

  function resetarSequencias() {
    patternSequences.length = 0;
    entropyHistory.length = 0;
  }

  return {
    registrarPadraoDetectado,
    calcularEntropiaShannonPadrao,
    obterDistribuicaoPadroes,
    calcularDominancia,
    detectarPadroesAnomalos,
    analisarTransicoesPadrao,
    calcularPrevisibilidade,
    gerarRelatorioEntropia,
    monitorarMudancasEntropia,
    getHistoricoEntropia,
    resetarSequencias
  };
})();

window.PatternEntropyEngine = PatternEntropyEngine;
