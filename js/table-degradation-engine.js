/**
 * Table Degradation Engine
 * Monitora decaimento da acurácia de padrões ao longo do tempo
 * Detecta quando um padrão começa a falhar mais frequentemente
 */

const TableDegradationEngine = (() => {
  const patternAccuracy = new Map();
  const degradationAlerts = [];
  const windowSize = 30;

  function registrarResultadoPadrao(patternName, resultado) {
    if (!patternAccuracy.has(patternName)) {
      patternAccuracy.set(patternName, []);
    }

    const history = patternAccuracy.get(patternName);
    history.push({
      resultado: resultado === 'win' ? 1 : 0,
      timestamp: Date.now()
    });

    if (history.length > windowSize * 2) {
      history.shift();
    }
  }

  function calcularAcuraciaAtual(patternName) {
    const history = patternAccuracy.get(patternName);
    if (!history || history.length === 0) return 50;

    const recent = history.slice(-windowSize);
    const wins = recent.filter(r => r.resultado === 1).length;
    return Math.round((wins / recent.length) * 100);
  }

  function calcularTaxaDegradacao(patternName) {
    const history = patternAccuracy.get(patternName);
    if (!history || history.length < windowSize * 2) return 0;

    const oldPeriod = history.slice(0, windowSize);
    const newPeriod = history.slice(-windowSize);

    const oldAccuracy = (oldPeriod.filter(r => r.resultado === 1).length / oldPeriod.length) * 100;
    const newAccuracy = (newPeriod.filter(r => r.resultado === 1).length / newPeriod.length) * 100;

    return oldAccuracy - newAccuracy;
  }

  function detectarDegradacao(thresholdPercent = 15) {
    const degradacoes = [];

    patternAccuracy.forEach((history, patternName) => {
      if (history.length < windowSize * 2) return;

      const taxa = calcularTaxaDegradacao(patternName);
      if (taxa > thresholdPercent) {
        const acuraciaAtual = calcularAcuraciaAtual(patternName);
        const alerta = {
          patternName,
          degradacao: Math.round(taxa),
          acuraciaAtual,
          severidade: taxa > 25 ? 'CRÍTICA' : (taxa > 20 ? 'ALTA' : 'MÉDIA'),
          timestamp: Date.now(),
          ultimosResultados: history.slice(-10).map(r => r.resultado === 1 ? 'W' : 'L').join('')
        };

        degradacoes.push(alerta);
        degradationAlerts.push(alerta);
      }
    });

    if (degradationAlerts.length > 100) {
      degradationAlerts.shift();
    }

    return degradacoes;
  }

  function obterTrendPatrao(patternName, windowPreceding = 5) {
    const history = patternAccuracy.get(patternName);
    if (!history || history.length < 2) return null;

    const recent = history.slice(-windowPreceding);
    if (recent.length < 2) return null;

    const wins = recent.map(r => r.resultado).reduce((sum, v) => sum + v, 0);
    const trend = wins / recent.length > 0.5 ? 'MELHORANDO' : (wins / recent.length < 0.5 ? 'PIORANDO' : 'ESTÁVEL');

    return {
      patternName,
      trend,
      winRateRecente: Math.round((wins / recent.length) * 100),
      ultimosResultados: recent.map(r => r.resultado === 1 ? 'W' : 'L').join('')
    };
  }

  function calcularVelocidadeDegradacao(patternName) {
    const history = patternAccuracy.get(patternName);
    if (!history || history.length < 10) return 0;

    const recent = history.slice(-10);
    let degradacao = 0;

    for (let i = 1; i < recent.length; i++) {
      if (recent[i].resultado < recent[i - 1].resultado) {
        degradacao++;
      }
    }

    return (degradacao / recent.length) * 100;
  }

  function obterPadroesEmRisco(riskThreshold = 40) {
    const emRisco = [];

    patternAccuracy.forEach((history, patternName) => {
      const acuraciaAtual = calcularAcuraciaAtual(patternName);
      if (acuraciaAtual < riskThreshold) {
        emRisco.push({
          patternName,
          acuraciaAtual,
          velocidadeDegradacao: calcularVelocidadeDegradacao(patternName),
          ultimosResultados: history.slice(-5).map(r => r.resultado === 1 ? '✓' : '✗').join('')
        });
      }
    });

    return emRisco.sort((a, b) => a.acuraciaAtual - b.acuraciaAtual);
  }

  function resetarPadrao(patternName) {
    patternAccuracy.delete(patternName);
  }

  function getHistoricoAlertas(limit = 50) {
    return degradationAlerts.slice(-limit);
  }

  function gerarRelatioDegradacao() {
    const relatorio = {
      dataGeracao: new Date().toISOString(),
      totalPadroes: patternAccuracy.size,
      padroesDegradados: [],
      padroesSaudaveis: [],
      mediaGlobalAcuracia: 0
    };

    let somaAcuracia = 0;
    let countAcuracia = 0;

    patternAccuracy.forEach((history, patternName) => {
      const acuraciaAtual = calcularAcuraciaAtual(patternName);
      const taxa = calcularTaxaDegradacao(patternName);

      somaAcuracia += acuraciaAtual;
      countAcuracia++;

      if (taxa > 15) {
        relatorio.padroesDegradados.push({
          patternName,
          acuraciaAtual,
          degradacao: Math.round(taxa),
          velocity: Math.round(calcularVelocidadeDegradacao(patternName)),
          recomendacao: taxa > 25 ? 'DESATIVAR_URGENTE' : 'MONITORAR'
        });
      } else {
        relatorio.padroesSaudaveis.push({
          patternName,
          acuraciaAtual,
          status: 'OK'
        });
      }
    });

    relatorio.mediaGlobalAcuracia = countAcuracia > 0 ? Math.round(somaAcuracia / countAcuracia) : 0;
    return relatorio;
  }

  return {
    registrarResultadoPadrao,
    calcularAcuraciaAtual,
    calcularTaxaDegradacao,
    detectarDegradacao,
    obterTrendPatrao,
    calcularVelocidadeDegradacao,
    obterPadroesEmRisco,
    resetarPadrao,
    getHistoricoAlertas,
    gerarRelatioDegradacao
  };
})();

window.TableDegradationEngine = TableDegradationEngine;
