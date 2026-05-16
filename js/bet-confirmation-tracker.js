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

  function armar(decisao, opts = {}) {
    const stake = Number(decisao?.stake) || 0;
    const cor = decisao?.cor || '?';
    const roundId = decisao?.roundId || (typeof CONFIG !== 'undefined' ? CONFIG.roundIdAtual : null) || null;
    const windowMs = Number(opts.windowMs) || 4000;
    const saldoAntes = lerSaldo();
    const tArmado = Date.now();

    if (saldoAntes === null) {
      console.warn(`${PREFIX} sem saldo de referencia (CONFIG.saldoReal indefinido) — pulando rastreamento`);
      return null;
    }

    const item = {
      tArmado,
      roundId,
      cor,
      stake,
      saldoAntes,
      saldoEsperado: +(saldoAntes - stake).toFixed(2),
      vencido: false,
      veredito: null
    };
    pendentes.push(item);

    console.log(`${PREFIX} ⏱  Aguardando ${windowMs}ms para confirmar — cor=${cor} stake=R$${stake.toFixed(2)} saldoAntes=R$${saldoAntes.toFixed(2)} esperado=R$${item.saldoEsperado.toFixed(2)}`);

    setTimeout(() => fechar(item), windowMs);
    return item;
  }

  function fechar(item) {
    if (item.vencido) return;
    item.vencido = true;
    item.tFechado = Date.now();
    item.saldoDepois = lerSaldo();

    if (item.saldoDepois === null) {
      item.veredito = 'INDEFINIDO';
      item.delta = null;
      console.warn(`${PREFIX} ⚠️  Saldo indisponivel apos janela. cor=${item.cor} stake=R$${item.stake.toFixed(2)}`);
    } else {
      item.delta = +(item.saldoAntes - item.saldoDepois).toFixed(2);
      const diffEsperado = Math.abs(item.delta - item.stake);
      if (diffEsperado <= TOLERANCE) {
        item.veredito = 'CONFIRMADA';
        console.log(`${PREFIX} ✅ APOSTA CONFIRMADA — cor=${item.cor} stake=R$${item.stake.toFixed(2)} | saldo: R$${item.saldoAntes.toFixed(2)} → R$${item.saldoDepois.toFixed(2)} (delta=-R$${item.delta.toFixed(2)})`);
      } else if (item.delta > TOLERANCE) {
        item.veredito = 'PARCIAL';
        console.warn(`${PREFIX} ⚠️  APOSTA PARCIAL — saldo caiu R$${item.delta.toFixed(2)} mas stake era R$${item.stake.toFixed(2)} (diff=R$${diffEsperado.toFixed(2)})`);
      } else {
        item.veredito = 'NAO_ENTROU';
        console.warn(`${PREFIX} ❌ APOSTA NAO ENTROU — cor=${item.cor} stake=R$${item.stake.toFixed(2)} | saldo inalterado (R$${item.saldoAntes.toFixed(2)})`);
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
      veredito: item.veredito
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
