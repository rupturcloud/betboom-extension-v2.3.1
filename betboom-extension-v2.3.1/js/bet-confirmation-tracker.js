/**
 * BetConfirmationTracker
 *
 * Resolve a pergunta basica: "a aposta entrou de verdade?"
 *
 * Quando o Executor dispara um clique (via BB_CLICK ou BBCalibrator),
 * este modulo:
 *   1) Captura CONFIG.saldoReal ANTES da aposta
 *   2) Aguarda windowMs (default 4s) — tempo suficiente pra Evolution
 *      processar a aposta e o WebSocket de saldo atualizar.
 *   3) Compara CONFIG.saldoReal DEPOIS com o estimado (saldoAntes - stake).
 *   4) Loga claramente o veredito e arquiva no historico de confirmacoes.
 *
 * Tres possiveis veredictos por aposta:
 *   - ✅ CONFIRMADA: saldo caiu pelo valor esperado (com tolerancia de R$ 0.05)
 *   - ⚠️  PARCIAL:    saldo caiu, mas valor != stake (pode ser stake errado, taxa, etc)
 *   - ❌ NAO_ENTROU: saldo inalterado (cassino nao aceitou o clique)
 *
 * API publica:
 *   BetConfirmationTracker.armar(decisao, opts)
 *   BetConfirmationTracker.historico(limite)
 *   BetConfirmationTracker.getUltimaConfirmacao()
 *   BetConfirmationTracker.taxa()  → { confirmadas, naoEntraram, total, taxaSucesso }
 */

(function () {
  'use strict';

  const PREFIX = '[BET-CONFIRM]';
  const STORAGE_KEY = 'BB_BET_CONFIRMATIONS_v1';
  const TOLERANCE = 0.05; // R$ — diferenca aceita como "match exato"
  const HISTORICO_MAX = 200;

  let ultima = null;
  let pendentes = []; // apostas armadas aguardando janela vencer

  function lerSaldo() {
    try {
      if (typeof CONFIG !== 'undefined' && Number.isFinite(Number(CONFIG.saldoReal))) {
        return Number(CONFIG.saldoReal);
      }
    } catch (_) {}
    return null;
  }

  function lerHistorico() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (_) { return []; }
  }

  function salvarHistorico(arr) {
    try {
      const trimmed = arr.slice(-HISTORICO_MAX);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch (_) {}
  }

  // R6/Fix-2: cronograma de retries para o caso de o saldo demorar pra atualizar.
  // O parser BetBoom às vezes refletia o débito só em 5-7s, gerando NAO_ENTROU
  // falso positivo com a janela única de 4s. Agora checamos em 2s/4s/7s/10s:
  // assim que detectamos delta dentro da tolerância, fechamos CONFIRMADA.
  // Se 10s sem mudança → fecha FALHA (saldo inalterado).
  const RETRY_SCHEDULE_MS = [2000, 4000, 7000, 10000];

  function armar(decisao, opts = {}) {
    const stake = Number(decisao?.stake) || 0;
    const cor = decisao?.cor || '?';
    const roundId = decisao?.roundId || (typeof CONFIG !== 'undefined' ? CONFIG.roundIdAtual : null) || null;
    // Permite override; default = schedule exponencial novo.
    const schedule = Array.isArray(opts.schedule) && opts.schedule.length > 0
      ? opts.schedule.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)
      : RETRY_SCHEDULE_MS;
    const saldoAntes = lerSaldo();
    const tArmado = Date.now();

    if (saldoAntes === null) {
      console.warn(`${PREFIX} sem saldo de referencia (CONFIG.saldoReal indefinido) — pulando rastreamento`);
      return null;
    }

    // R6.1: rejeita armar se já tem aposta pendente (evita cross-attribution
    // entre 2 apostas concorrentes que leem saldo independente).
    if (pendentes.length > 0) {
      console.warn(`${PREFIX} 🛑 ARMAR REJEITADO — já existe ${pendentes.length} aposta(s) pendente(s). Cross-attribution risk.`);
      return null;
    }

    const item = {
      tArmado,
      roundId,
      cor,
      stake,
      saldoAntes,
      saldoEsperado: +(saldoAntes - stake).toFixed(2),
      schedule,
      tentativas: 0,
      vencido: false,
      veredito: null,
      timers: [] // R6.1: cleanup explicito quando fechar antes do tempo
    };
    pendentes.push(item);

    console.log(`${PREFIX} ⏱  Aguardando retries [${schedule.join('ms, ')}ms] para confirmar — cor=${cor} stake=R$${stake.toFixed(2)} saldoAntes=R$${saldoAntes.toFixed(2)} esperado=R$${item.saldoEsperado.toFixed(2)}`);

    // Agenda cada checagem. Quando fechar() roda, limpa todos os timers.
    schedule.forEach((delayMs, idx) => {
      const isFinal = idx === schedule.length - 1;
      const handle = setTimeout(() => verificar(item, delayMs, isFinal), delayMs);
      item.timers.push(handle);
    });
    return item;
  }

  function verificar(item, delayMs, isFinal) {
    if (item.vencido) return;
    item.tentativas += 1;
    const saldoAtual = lerSaldo();
    if (saldoAtual === null) {
      if (isFinal) fechar(item, saldoAtual, delayMs);
      return;
    }
    const deltaAtual = +(item.saldoAntes - saldoAtual).toFixed(2);
    const diffEsperado = Math.abs(deltaAtual - item.stake);
    // R6.1: APENAS match estrito (diff <= TOLERANCE) confirma. Removido o
    // branch "deltaAtual > TOLERANCE" solto que podia falso-positivar com
    // dust de bônus/cashback creditando R$0.20 e ser atribuído à aposta.
    if (diffEsperado <= TOLERANCE) {
      fechar(item, saldoAtual, delayMs);
      return;
    }
    if (isFinal) {
      fechar(item, saldoAtual, delayMs);
    }
  }

  function fechar(item, saldoDepoisOverride, tempoDetectadoMs) {
    if (item.vencido) return;
    item.vencido = true;
    // R6.1: limpa timers pendentes (evita callbacks zumbis ate 10s)
    if (Array.isArray(item.timers)) {
      item.timers.forEach((h) => { try { clearTimeout(h); } catch (_) {} });
      item.timers = [];
    }
    item.tFechado = Date.now();
    item.saldoDepois = (typeof saldoDepoisOverride !== 'undefined') ? saldoDepoisOverride : lerSaldo();
    const tempoMs = Number.isFinite(Number(tempoDetectadoMs))
      ? Number(tempoDetectadoMs)
      : (item.tFechado - item.tArmado);
    item.tempoDetectadoMs = tempoMs;
    const tempoSeg = (tempoMs / 1000).toFixed(1);

    if (item.saldoDepois === null) {
      item.veredito = 'INDEFINIDO';
      item.delta = null;
      console.warn(`${PREFIX} ⚠️  Saldo indisponivel apos janela. cor=${item.cor} stake=R$${item.stake.toFixed(2)} (tentativas=${item.tentativas})`);
    } else {
      item.delta = +(item.saldoAntes - item.saldoDepois).toFixed(2);
      const diffEsperado = Math.abs(item.delta - item.stake);
      if (diffEsperado <= TOLERANCE) {
        item.veredito = 'CONFIRMADA';
        console.log(`${PREFIX} ✅ APOSTA CONFIRMADA em ${tempoSeg}s — cor=${item.cor} stake=R$${item.stake.toFixed(2)} | saldo R$${item.saldoAntes.toFixed(2)} → R$${item.saldoDepois.toFixed(2)} (delta=-R$${item.delta.toFixed(2)}, tentativas=${item.tentativas})`);
      } else if (item.delta > TOLERANCE) {
        item.veredito = 'PARCIAL';
        console.warn(`${PREFIX} ⚠️  APOSTA PARCIAL em ${tempoSeg}s — saldo caiu R$${item.delta.toFixed(2)} mas stake era R$${item.stake.toFixed(2)} (diff=R$${diffEsperado.toFixed(2)})`);
      } else {
        item.veredito = 'NAO_ENTROU';
        console.warn(`${PREFIX} ❌ APOSTA NAO ENTROU após ${tempoSeg}s (${item.tentativas} tentativas) — cor=${item.cor} stake=R$${item.stake.toFixed(2)} | saldo inalterado (R$${item.saldoAntes.toFixed(2)})`);
      }
    }

    ultima = item;
    pendentes = pendentes.filter((p) => p !== item);

    const historico = lerHistorico();
    historico.push({
      t: item.tFechado,
      roundId: item.roundId,
      cor: item.cor,
      stake: item.stake,
      saldoAntes: item.saldoAntes,
      saldoDepois: item.saldoDepois,
      delta: item.delta,
      veredito: item.veredito,
      tempoDetectadoMs: item.tempoDetectadoMs || null,
      tentativas: item.tentativas || 0
    });
    salvarHistorico(historico);

    // Dispara evento sintetico para quem quiser ouvir
    try {
      window.dispatchEvent(new CustomEvent('bb-bet-confirmation', { detail: item }));
    } catch (_) {}
  }

  function historico(limite = 30) {
    const h = lerHistorico();
    return h.slice(-Math.max(1, Number(limite) || 30));
  }

  function getUltimaConfirmacao() {
    return ultima;
  }

  function taxa() {
    const h = lerHistorico();
    const total = h.length;
    if (total === 0) return { total: 0, confirmadas: 0, naoEntraram: 0, parciais: 0, indefinidas: 0, taxaSucesso: 0 };
    const confirmadas = h.filter((x) => x.veredito === 'CONFIRMADA').length;
    const naoEntraram = h.filter((x) => x.veredito === 'NAO_ENTROU').length;
    const parciais = h.filter((x) => x.veredito === 'PARCIAL').length;
    const indefinidas = h.filter((x) => x.veredito === 'INDEFINIDO').length;
    return {
      total,
      confirmadas,
      naoEntraram,
      parciais,
      indefinidas,
      taxaSucesso: +(100 * confirmadas / total).toFixed(1)
    };
  }

  function relatorio() {
    const t = taxa();
    const h = historico(10);
    console.group(`${PREFIX} 📊 Relatorio de Confirmacoes`);
    console.log('Taxa de sucesso:', t.taxaSucesso + '%');
    console.log('Totais:', t);
    console.table(h);
    console.groupEnd();
    return { taxa: t, ultimas: h };
  }

  function limpar() {
    localStorage.removeItem(STORAGE_KEY);
    pendentes = [];
    ultima = null;
    console.log(`${PREFIX} 🗑 historico limpo`);
  }

  window.BetConfirmationTracker = {
    armar,
    historico,
    getUltimaConfirmacao,
    taxa,
    relatorio,
    limpar
  };

  console.log(`${PREFIX} ✅ carregado. Use BetConfirmationTracker.relatorio() para ver historico.`);
})();
