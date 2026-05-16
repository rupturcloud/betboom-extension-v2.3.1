/**
 * calibration-loop.js
 * ---------------------------------------------------------------------------
 * Loop de Calibracao Bayesiano (BetBoom Auto Pattern) - v2 (P0+P1)
 *
 * Objetivo:
 *   Aprender, com base no historico real de WIN/LOSS, a diferenca entre a
 *   "confianca nominal" declarada por cada padrao (ex.: WMSG-007 = 85%) e a
 *   "confianca real" observada na pratica.
 *
 * Persistencia:
 *   - SSoT: EventStore (`calibration_sample`)
 *   - Cache rapido: localStorage `bb_calibration_data` (snapshot periodico)
 *
 * Multi-tab:
 *   - Leader election via BroadcastChannel('calib-v1') com heartbeat 2s e
 *     takeover 5s. Apenas o lider grava em EventStore/localStorage.
 *   - Fallback read-only se BroadcastChannel indisponivel.
 *
 * Replay/Import:
 *   - Aceita `source: 'live' | 'replay' | 'import'`. Apenas `'live'` afeta
 *     estatistica em memoria. Replay/import sao logados e ignorados.
 *
 * Snapshot congelado:
 *   - Buffer LRU de 500 ultimos snapshots por (padraoId, roundId) para auditoria.
 *
 * P1:
 *   - Status do padrao: cold (n<30) / warming (30..100) / stable (>100)
 *   - Janela deslizante EWMA (default 200)
 *   - Detecao de drift: |conf_real - conf_nominal| > 0.15 por 5 rounds
 *   - Snapshot periodico em localStorage (50 amostras ou 60s)
 *   - Pub/sub interno separado do BroadcastChannel
 *
 * Padrao do projeto: IIFE + API publica via return.
 * Modulo isolado: nao depende e nao toca em DOM.
 * ---------------------------------------------------------------------------
 */

const CalibrationLoop = (() => {
  'use strict';

  // ==========================================================================
  // Constantes
  // ==========================================================================

  /** Chave de storage (cache de snapshot rapido). */
  const STORAGE_KEY = 'bb_calibration_data';

  /** Versao do schema persistido. */
  const SCHEMA_VERSION = 2;

  /** Versao do modelo (invalida cache quando muda). */
  const VERSAO_MODELO = 'v2-ewma-200';

  /** Limite do historico individual por padrao (FIFO / janela deslizante). */
  const MAX_HISTORICO_POR_PADRAO = 200;

  /** Faixas (bins) de confianca - max=100.0001 para incluir 100 no ultimo bin. */
  const FAIXAS_CONFIANCA = [
    { label: '0-30%',   min: 0,   max: 30  },
    { label: '30-50%',  min: 30,  max: 50  },
    { label: '50-70%',  min: 50,  max: 70  },
    { label: '70-80%',  min: 70,  max: 80  },
    { label: '80-90%',  min: 80,  max: 90  },
    { label: '90-100%', min: 90,  max: 100.0001 }
  ];

  /** Tolerancia para considerar um padrao "calibrado" (em pontos percentuais). */
  const TOLERANCIA_CALIBRACAO_PP = 10;

  /** Tamanho amostral minimo para confiar 100% na evidencia empirica. */
  const N_CONFIANCA_TOTAL = 50;

  /** Abaixo deste N, ignora a evidencia e usa a confianca nominal. */
  const N_CONFIANCA_ZERO = 10;

  /** Threshold default para padroes "doentes". */
  const TAXA_ACERTO_DESLIGAR = 0.30;

  /** P1 - Status thresholds. */
  const STATUS_COLD_MAX = 30;     // n < 30
  const STATUS_WARMING_MAX = 100; // 30 <= n <= 100 ; n > 100 = stable

  /** P1 - Drift detection. */
  const DRIFT_THRESHOLD = 0.15;   // 15 pp
  const DRIFT_CONSECUTIVE_ROUNDS = 5;

  /** P1 - Snapshot LRU. */
  const SNAPSHOT_LRU_SIZE = 500;

  /** P1 - Snapshot periodico em localStorage. */
  const SNAPSHOT_EVERY_N_SAMPLES = 50;
  const SNAPSHOT_EVERY_MS = 60_000;

  /** Leader election (BroadcastChannel). */
  const BC_CHANNEL_NAME = 'calib-v1';
  const HEARTBEAT_INTERVAL_MS = 2_000;
  const LEADER_TAKEOVER_MS = 5_000;

  /** Prefixo de log padronizado. */
  const LOG_PREFIX = '[CalibrationLoop]';

  // ==========================================================================
  // Helpers privados
  // ==========================================================================

  const log = (...args) => { try { console.log(LOG_PREFIX, ...args); } catch (_) {} };
  const warn = (...args) => { try { console.warn(LOG_PREFIX, ...args); } catch (_) {} };

  /** Gera tabId estavel para esta instancia. */
  const TAB_ID = (() => {
    try {
      return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    } catch (_) {
      return `tab-${Math.random()}`;
    }
  })();

  /** Estrutura inicial vazia. */
  const estruturaVazia = () => ({
    version: SCHEMA_VERSION,
    versaoModelo: VERSAO_MODELO,
    startedAt: Date.now(),
    padroes: {}
  });

  /** Carrega snapshot do localStorage (cache de cold-start). */
  const carregar = () => {
    try {
      const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem(STORAGE_KEY) : null;
      if (!raw) return estruturaVazia();
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return estruturaVazia();
      if (parsed.version !== SCHEMA_VERSION) {
        warn('Versao de schema divergente - recriando.', parsed.version, '!=', SCHEMA_VERSION);
        return estruturaVazia();
      }
      if (parsed.versaoModelo && parsed.versaoModelo !== VERSAO_MODELO) {
        warn('Versao de modelo divergente - invalidando cache.', parsed.versaoModelo, '!=', VERSAO_MODELO);
        return estruturaVazia();
      }
      if (!parsed.padroes || typeof parsed.padroes !== 'object') parsed.padroes = {};
      return parsed;
    } catch (e) {
      warn('Falha ao carregar storage, usando estrutura vazia.', e);
      return estruturaVazia();
    }
  };

  /** Salva snapshot rapido no localStorage (apenas lider). */
  const salvar = (data) => {
    try {
      if (typeof localStorage === 'undefined') return false;
      if (!isLeader()) return false; // somente lider grava
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      warn('Falha ao salvar storage.', e);
      return false;
    }
  };

  /** Garante slot do padrao. */
  const garantirSlot = (state, nomePadrao) => {
    if (!state.padroes[nomePadrao]) {
      state.padroes[nomePadrao] = {
        total: 0,
        wins: 0,
        losses: 0,
        ties: 0,
        confiancaNominalMedia: 0,
        historicoCompleto: [],
        // P1: drift tracking
        driftStreak: 0,
        ultimaAmostraTs: 0
      };
    }
    // Backward compat (carregamento antigo pode nao ter campos novos).
    const slot = state.padroes[nomePadrao];
    if (typeof slot.driftStreak !== 'number') slot.driftStreak = 0;
    if (typeof slot.ultimaAmostraTs !== 'number') slot.ultimaAmostraTs = 0;
    return slot;
  };

  const clampConfianca = (c) => {
    const n = Number(c);
    if (!Number.isFinite(n)) return 0;
    if (n < 0) return 0;
    if (n > 100) return 100;
    return n;
  };

  const calcularTaxaAcerto = (wins, losses) => {
    const decisivos = wins + losses;
    if (decisivos <= 0) return null;
    return wins / decisivos;
  };

  const atualizarMediaNominal = (mediaAtual, totalAntes, novoValor) => {
    if (totalAntes <= 0) return novoValor;
    return ((mediaAtual * totalAntes) + novoValor) / (totalAntes + 1);
  };

  const lerp = (a, b, t) => a + (b - a) * t;

  const pesoEvidencia = (total) => {
    if (total <= N_CONFIANCA_ZERO) return 0;
    if (total >= N_CONFIANCA_TOTAL) return 1;
    return (total - N_CONFIANCA_ZERO) / (N_CONFIANCA_TOTAL - N_CONFIANCA_ZERO);
  };

  /**
   * Encontra a faixa (bin) que contem uma confianca.
   * UNIFICADO: sempre usa `c < f.max`, com ultimo bin tendo max=100.0001
   * para incluir confianca == 100. Bug critico do limite 100 corrigido.
   */
  const faixaDe = (confianca) => {
    const c = clampConfianca(confianca);
    for (const f of FAIXAS_CONFIANCA) {
      if (c >= f.min && c < f.max) return f.label;
    }
    return FAIXAS_CONFIANCA[FAIXAS_CONFIANCA.length - 1].label;
  };

  /** P1 - status do padrao baseado em n amostras. */
  const statusDoPadrao = (n) => {
    if (n < STATUS_COLD_MAX) return 'cold';
    if (n <= STATUS_WARMING_MAX) return 'warming';
    return 'stable';
  };

  /** Janela deslizante (FIFO) — mantem somente MAX_HISTORICO_POR_PADRAO amostras. */
  const aplicarFifo = (slot) => {
    if (slot.historicoCompleto.length > MAX_HISTORICO_POR_PADRAO) {
      const excess = slot.historicoCompleto.length - MAX_HISTORICO_POR_PADRAO;
      slot.historicoCompleto.splice(0, excess);
    }
  };

  /** Recalcula agregados (wins, losses, ties, confiancaNominalMedia) sobre a JANELA. */
  const recalcularAgregadosJanela = (slot) => {
    let wins = 0, losses = 0, ties = 0, somaConf = 0, n = 0;
    for (const e of slot.historicoCompleto) {
      if (e.resultado === 'win') wins++;
      else if (e.resultado === 'loss') losses++;
      else if (e.resultado === 'tie') ties++;
      somaConf += clampConfianca(e.confianca);
      n++;
    }
    slot.wins = wins;
    slot.losses = losses;
    slot.ties = ties;
    slot.total = n;
    slot.confiancaNominalMedia = n > 0 ? somaConf / n : 0;
  };

  const calcularBinsDoPadrao = (slot) => {
    const bins = FAIXAS_CONFIANCA.map(f => ({
      faixa: f.label,
      total: 0, wins: 0, losses: 0, ties: 0,
      taxaAcerto: null, calibrada: null
    }));

    for (const entry of slot.historicoCompleto) {
      const c = clampConfianca(entry.confianca);
      const idx = FAIXAS_CONFIANCA.findIndex(f => c >= f.min && c < f.max);
      const bin = bins[idx >= 0 ? idx : bins.length - 1];
      bin.total += 1;
      if (entry.resultado === 'win') bin.wins += 1;
      else if (entry.resultado === 'loss') bin.losses += 1;
      else if (entry.resultado === 'tie') bin.ties += 1;
    }

    for (let i = 0; i < bins.length; i++) {
      const bin = bins[i];
      const taxa = calcularTaxaAcerto(bin.wins, bin.losses);
      bin.taxaAcerto = taxa;
      if (taxa !== null) {
        const meio = (FAIXAS_CONFIANCA[i].min + Math.min(100, FAIXAS_CONFIANCA[i].max)) / 2;
        bin.calibrada = Math.abs(meio - (taxa * 100)) < TOLERANCIA_CALIBRACAO_PP;
      }
    }
    return bins;
  };

  const calcularBrierDoPadrao = (slot) => {
    let soma = 0, n = 0;
    for (const entry of slot.historicoCompleto) {
      if (entry.resultado !== 'win' && entry.resultado !== 'loss') continue;
      const p = clampConfianca(entry.confianca) / 100;
      const o = entry.resultado === 'win' ? 1 : 0;
      const d = p - o;
      soma += d * d;
      n += 1;
    }
    if (n === 0) return null;
    return soma / n;
  };

  // ==========================================================================
  // Estado em memoria
  // ==========================================================================

  let _state = carregar();
  let _eventStore = null;
  let _lifecycleUnsubscribe = null;

  /** Snapshot LRU congelado: Map<key, snapshot>. */
  const _snapshotLRU = new Map();
  const _snapshotKey = (padraoId, roundId) => `${padraoId}::${roundId || 'no-round'}`;

  /** Pub/sub interno. */
  const _internalSubs = new Set();
  const emitInternal = (type, data) => {
    for (const cb of _internalSubs) {
      try { cb({ type, ...data }); } catch (e) { warn('subscriber error:', e); }
    }
  };

  /** Modo replay. */
  let _replayMode = { ativo: false, roundId: null };

  /** Controle de snapshot periodico. */
  let _samplesSinceSnapshot = 0;
  let _lastSnapshotTs = 0;

  // ==========================================================================
  // Leader Election (BroadcastChannel)
  // ==========================================================================

  let _bc = null;
  let _isLeader = false;
  let _leaderId = null;
  let _lastLeaderHeartbeatAt = 0;
  let _heartbeatTimer = null;
  let _watchdogTimer = null;
  let _bcAvailable = false;

  function isLeader() {
    if (!_bcAvailable) return false; // fallback: read-only (nao escreve)
    return _isLeader === true;
  }

  function initLeaderElection() {
    if (typeof BroadcastChannel === 'undefined') {
      warn('BroadcastChannel indisponivel - modo read-only (fallback).');
      _bcAvailable = false;
      return;
    }
    try {
      _bc = new BroadcastChannel(BC_CHANNEL_NAME);
    } catch (e) {
      warn('Falha ao criar BroadcastChannel - modo read-only.', e);
      _bcAvailable = false;
      return;
    }
    _bcAvailable = true;

    _bc.onmessage = (ev) => handleBcMessage(ev.data);

    // Candidata-se a lider apos atraso aleatorio curto (anti-corrida).
    const claimDelay = 50 + Math.floor(Math.random() * 200);
    setTimeout(claimLeadership, claimDelay);

    // Watchdog: se o lider sumir, assume.
    _watchdogTimer = setInterval(watchdogLeader, 1_000);

    // Limpa em unload.
    try {
      if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener('beforeunload', () => {
          try {
            if (_isLeader && _bc) {
              _bc.postMessage({ type: 'leader_left', leaderId: TAB_ID, ts: Date.now() });
            }
            if (_bc) _bc.close();
          } catch (_) {}
        });
      }
    } catch (_) {}
  }

  function handleBcMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'leader_heartbeat') {
      _lastLeaderHeartbeatAt = msg.ts || Date.now();
      _leaderId = msg.leaderId || _leaderId;
      // Se outro tab e lider, eu nao sou.
      if (_leaderId && _leaderId !== TAB_ID) {
        _isLeader = false;
      }
    } else if (msg.type === 'leader_elected') {
      _leaderId = msg.leaderId;
      _lastLeaderHeartbeatAt = msg.ts || Date.now();
      if (_leaderId !== TAB_ID) _isLeader = false;
    } else if (msg.type === 'leader_left') {
      if (msg.leaderId === _leaderId) {
        _leaderId = null;
        _lastLeaderHeartbeatAt = 0;
        // assume imediatamente
        setTimeout(claimLeadership, 50 + Math.floor(Math.random() * 200));
      }
    } else if (msg.type === 'calibration_updated') {
      // Outro tab atualizou - recarrega snapshot localStorage para refletir.
      if (msg.leader && msg.leader !== TAB_ID) {
        try {
          const fresh = carregar();
          _state = fresh;
        } catch (_) {}
      }
    }
  }

  function claimLeadership() {
    if (_leaderId && _leaderId !== TAB_ID) {
      const idleMs = Date.now() - _lastLeaderHeartbeatAt;
      if (idleMs < LEADER_TAKEOVER_MS) {
        // ja existe lider vivo
        return;
      }
    }
    _isLeader = true;
    _leaderId = TAB_ID;
    _lastLeaderHeartbeatAt = Date.now();
    log('[leader] eleito:', TAB_ID);
    try {
      if (_bc) _bc.postMessage({ type: 'leader_elected', leaderId: TAB_ID, ts: Date.now() });
    } catch (_) {}

    // Inicia heartbeats.
    if (_heartbeatTimer) clearInterval(_heartbeatTimer);
    _heartbeatTimer = setInterval(() => {
      if (!_isLeader) return;
      try {
        if (_bc) _bc.postMessage({ type: 'leader_heartbeat', leaderId: TAB_ID, ts: Date.now() });
      } catch (_) {}
    }, HEARTBEAT_INTERVAL_MS);
  }

  function watchdogLeader() {
    if (_isLeader) return;
    if (!_leaderId) {
      // Sem lider conhecido - candidata-se.
      claimLeadership();
      return;
    }
    const idleMs = Date.now() - _lastLeaderHeartbeatAt;
    if (idleMs > LEADER_TAKEOVER_MS) {
      log(`[leader] takeover: ${_leaderId} ocioso por ${idleMs}ms`);
      _leaderId = null;
      claimLeadership();
    }
  }

  // ==========================================================================
  // EventStore: append + bootstrap
  // ==========================================================================

  function appendToEventStore(type, payload) {
    if (!_eventStore || typeof _eventStore.append !== 'function') return null;
    try {
      return _eventStore.append(type, payload);
    } catch (e) {
      warn('append falhou:', e);
      return null;
    }
  }

  /**
   * Bootstrap: reconstroi estado a partir do EventStore.query('calibration_sample').
   * Apenas eventos com source='live' afetam estatistica em memoria.
   */
  async function bootstrapFromEventStore() {
    if (!_eventStore || typeof _eventStore.query !== 'function') {
      log('bootstrap: sem EventStore - mantendo cache do localStorage.');
      return;
    }
    try {
      const events = await _eventStore.query('calibration_sample');
      if (!Array.isArray(events) || events.length === 0) {
        log('bootstrap: zero amostras no EventStore - mantendo cache.');
        return;
      }
      // Projecao do zero apenas com eventos 'live' (replay/import sao ignorados).
      const novoState = estruturaVazia();
      let usados = 0;
      for (const ev of events) {
        const p = ev.payload || ev.data || {};
        if (p.source && p.source !== 'live') continue;
        const padrao = p.padraoId || p.padrao;
        if (!padrao) continue;
        const slot = garantirSlot(novoState, padrao);
        slot.historicoCompleto.push({
          confianca: clampConfianca(p.confianca || p.confiancaNominal),
          resultado: p.resultado,
          cor: p.cor || null,
          roundId: p.roundId || null,
          ts: p.ts || ev.ts || ev.timestamp || Date.now(),
          seq: ev.seq || null
        });
        slot.ultimaAmostraTs = Math.max(slot.ultimaAmostraTs, p.ts || ev.ts || 0);
        usados++;
      }
      // Aplica janela e recalcula agregados.
      for (const nome of Object.keys(novoState.padroes)) {
        const slot = novoState.padroes[nome];
        aplicarFifo(slot);
        recalcularAgregadosJanela(slot);
      }
      _state = novoState;
      log(`bootstrap: ${usados} amostras live reconstruidas em ${Object.keys(novoState.padroes).length} padroes.`);
    } catch (e) {
      warn('bootstrap falhou:', e);
    }
  }

  // ==========================================================================
  // Snapshot LRU (evidencia congelada por decisao)
  // ==========================================================================

  function gravarSnapshot(padraoId, roundId) {
    const key = _snapshotKey(padraoId, roundId);
    const slot = _state.padroes[padraoId];
    let peso = null, confiancaReal = null, amostras = 0;
    if (slot) {
      const taxa = calcularTaxaAcerto(slot.wins, slot.losses);
      confiancaReal = taxa !== null ? taxa * 100 : null;
      amostras = slot.total;
      const w = pesoEvidencia(slot.total);
      peso = taxa !== null
        ? lerp(slot.confiancaNominalMedia / 100, taxa, w)
        : slot.confiancaNominalMedia / 100;
    }
    const snap = {
      peso,
      confiancaReal,
      amostras,
      versaoModelo: VERSAO_MODELO,
      ts: Date.now()
    };
    _snapshotLRU.set(key, snap);
    // LRU: remove os mais antigos
    while (_snapshotLRU.size > SNAPSHOT_LRU_SIZE) {
      const firstKey = _snapshotLRU.keys().next().value;
      _snapshotLRU.delete(firstKey);
    }
    return snap;
  }

  // ==========================================================================
  // Snapshot periodico em localStorage (apenas lider)
  // ==========================================================================

  function maybeSnapshotPeriodico() {
    if (!isLeader()) return;
    const agora = Date.now();
    const porN = _samplesSinceSnapshot >= SNAPSHOT_EVERY_N_SAMPLES;
    const porT = (agora - _lastSnapshotTs) >= SNAPSHOT_EVERY_MS;
    if (porN || porT) {
      _state.versaoModelo = VERSAO_MODELO;
      const ok = salvar(_state);
      if (ok) {
        _samplesSinceSnapshot = 0;
        _lastSnapshotTs = agora;
      }
    }
  }

  // ==========================================================================
  // API publica
  // ==========================================================================

  /** Conecta o EventStore (carrega historico). */
  const attachEventStore = (eventStore) => {
    _eventStore = eventStore;
    log('EventStore conectado.');
    // Bootstrap assincrono
    bootstrapFromEventStore().catch((e) => warn('bootstrap erro:', e));
  };

  /**
   * Conecta o RoundLifecycle - auto-registra resultado em round_end.
   * Espera payload `{ roundId, stats }` com `stats.resultado` (win|loss|tie).
   */
  const attachLifecycle = (lifecycle) => {
    if (!lifecycle || typeof lifecycle.subscribe !== 'function') {
      warn('attachLifecycle: lifecycle invalido.');
      return;
    }
    if (typeof _lifecycleUnsubscribe === 'function') {
      try { _lifecycleUnsubscribe(); } catch (_) {}
    }
    _lifecycleUnsubscribe = lifecycle.subscribe('round_end', (ev) => {
      try {
        const roundId = ev && ev.roundId;
        const stats = ev && ev.stats;
        if (!stats) return;
        const resultado = stats.resultado;
        if (!resultado) return;

        // O metadata da rodada pode trazer padrao/confianca da decisao tomada.
        const meta = stats.metadata || {};
        const padraoId = meta.padraoId || meta.padrao;
        if (!padraoId) {
          // Sem padrao na rodada: nada a registrar.
          return;
        }
        const confianca = meta.confianca != null
          ? meta.confianca
          : (meta.confiancaNominal != null ? meta.confiancaNominal : 0);

        registrarResultado({
          roundId,
          padraoId,
          padrao: padraoId,
          confianca,
          confiancaNominal: confianca,
          cor: meta.cor || null,
          resultado,
          source: 'live',
          ts: Date.now()
        });
      } catch (e) {
        warn('attachLifecycle handler erro:', e);
      }
    });
    log('Lifecycle conectado (round_end -> registrarResultado).');
  };

  /**
   * Registra o resultado de uma decisao para o loop de calibracao.
   * Aceita assinatura legada (padrao) e nova (padraoId, source).
   *
   * @returns {boolean} true se foi efetivamente persistido em estado live.
   */
  const registrarResultado = (args = {}) => {
    // Backward compat: aceita `padrao` e `padraoId`, `confianca` e `confiancaNominal`.
    const padrao = args.padraoId || args.padrao;
    const confianca = args.confianca != null ? args.confianca : args.confiancaNominal;
    const { cor, resultado, roundId } = args;
    const ts = Number.isFinite(args.ts)
      ? args.ts
      : (Number.isFinite(args.timestamp) ? args.timestamp : Date.now());
    const source = (args.source === 'replay' || args.source === 'import' || args.source === 'live')
      ? args.source
      : 'live';

    if (!padrao || typeof padrao !== 'string') {
      warn('registrarResultado ignorado: padrao invalido.', padrao);
      return false;
    }
    if (resultado !== 'win' && resultado !== 'loss' && resultado !== 'tie') {
      warn('registrarResultado ignorado: resultado invalido.', resultado);
      return false;
    }

    const conf = clampConfianca(confianca);

    // Sempre logamos em EventStore (auditoria), mesmo replay/import.
    const ar = appendToEventStore('calibration_sample', {
      roundId: roundId || null,
      padraoId: padrao,
      confianca: conf,
      confiancaNominal: conf,
      resultado,
      cor: cor || null,
      source,
      ts
    });

    if (source !== 'live') {
      log(`registro ignorado (source=${source}):`, padrao, 'res=', resultado);
      return false;
    }

    // Se nao for lider, nao escrevemos em localStorage nem mexemos no estado canonico.
    // Atualizamos estado em memoria mesmo assim (read-only -> projecao local).
    const slot = garantirSlot(_state, padrao);
    slot.historicoCompleto.push({
      confianca: conf,
      resultado,
      cor: cor || null,
      roundId: roundId || null,
      ts,
      seq: ar ? ar.seq : null
    });
    slot.ultimaAmostraTs = ts;
    aplicarFifo(slot);
    recalcularAgregadosJanela(slot);

    // P1 - Drift detection (EWMA sobre janela).
    const taxa = calcularTaxaAcerto(slot.wins, slot.losses);
    if (taxa !== null) {
      const confiancaReal = taxa;
      const nominal = slot.confiancaNominalMedia / 100;
      const delta = Math.abs(confiancaReal - nominal);
      if (delta > DRIFT_THRESHOLD) {
        slot.driftStreak += 1;
        if (slot.driftStreak >= DRIFT_CONSECUTIVE_ROUNDS) {
          emitInternal('drift_detected', {
            padraoId: padrao,
            delta,
            amostras: slot.total
          });
          slot.driftStreak = 0; // reset apos disparo
        }
      } else {
        slot.driftStreak = 0;
      }
    }

    // P1 - cold pattern alert (n abaixo do limiar cold).
    if (slot.total < STATUS_COLD_MAX) {
      emitInternal('cold_pattern_alert', {
        padraoId: padrao,
        ultimaAmostraTs: slot.ultimaAmostraTs
      });
    }

    // BroadcastChannel: notifica outros tabs.
    if (isLeader() && _bc) {
      try {
        const peso = getPesoAjustado(padrao, conf).peso;
        _bc.postMessage({
          type: 'calibration_updated',
          padraoId: padrao,
          peso,
          delta: taxa !== null ? Math.abs(taxa - (slot.confiancaNominalMedia / 100)) : null,
          leader: TAB_ID,
          ts: Date.now()
        });
      } catch (_) {}
    }

    // Snapshot periodico em localStorage (apenas lider).
    _samplesSinceSnapshot += 1;
    maybeSnapshotPeriodico();

    log('registro:', padrao, 'conf=', conf, 'res=', resultado, 'total=', slot.total,
        'source=', source, 'leader=', isLeader());
    return true;
  };

  /**
   * Stats de um padrao - inclui `status` (cold|warming|stable) na resposta principal.
   */
  const getStatsPadrao = (nomePadrao) => {
    const slot = _state.padroes[nomePadrao];
    if (!slot) return null;
    const taxa = calcularTaxaAcerto(slot.wins, slot.losses);
    const confiancaReal = taxa !== null ? taxa * 100 : null;
    const calibrada = confiancaReal !== null
      ? Math.abs(slot.confiancaNominalMedia - confiancaReal) < TOLERANCIA_CALIBRACAO_PP
      : null;
    return {
      padrao: nomePadrao,
      total: slot.total,
      wins: slot.wins,
      losses: slot.losses,
      ties: slot.ties,
      taxaAcerto: taxa,
      confiancaNominalMedia: slot.confiancaNominalMedia,
      confiancaReal,
      calibrada,
      status: statusDoPadrao(slot.total),
      bins: calcularBinsDoPadrao(slot)
    };
  };

  const getStatsPorConfianca = () => {
    const bins = FAIXAS_CONFIANCA.map(f => ({
      faixa: f.label,
      total: 0, wins: 0, losses: 0, ties: 0,
      taxaAcerto: null,
      confiancaMediaNoBin: 0,
      calibrada: null
    }));

    const acumConfPorBin = bins.map(() => ({ soma: 0, n: 0 }));

    for (const nome of Object.keys(_state.padroes)) {
      const slot = _state.padroes[nome];
      for (const entry of slot.historicoCompleto) {
        const c = clampConfianca(entry.confianca);
        const idx = FAIXAS_CONFIANCA.findIndex(f => c >= f.min && c < f.max);
        const realIdx = idx >= 0 ? idx : bins.length - 1;
        const bin = bins[realIdx];
        bin.total += 1;
        if (entry.resultado === 'win') bin.wins += 1;
        else if (entry.resultado === 'loss') bin.losses += 1;
        else if (entry.resultado === 'tie') bin.ties += 1;
        acumConfPorBin[realIdx].soma += c;
        acumConfPorBin[realIdx].n += 1;
      }
    }

    for (let i = 0; i < bins.length; i++) {
      const bin = bins[i];
      const taxa = calcularTaxaAcerto(bin.wins, bin.losses);
      bin.taxaAcerto = taxa;
      bin.confiancaMediaNoBin = acumConfPorBin[i].n > 0
        ? acumConfPorBin[i].soma / acumConfPorBin[i].n
        : 0;
      if (taxa !== null) {
        bin.calibrada = Math.abs(bin.confiancaMediaNoBin - (taxa * 100)) < TOLERANCIA_CALIBRACAO_PP;
      }
    }
    return bins;
  };

  /**
   * Peso ajustado em [0,1] - agora retorna objeto rico (P1).
   * Backward compat: o consumidor antigo pode ler `.peso` ou tratar como
   * objeto numerico via valueOf.
   */
  const getPesoAjustado = (nomePadrao, confianca) => {
    const nominalNorm = clampConfianca(confianca) / 100;
    const slot = _state.padroes[nomePadrao];
    if (!slot) {
      const obj = {
        peso: nominalNorm,
        confiancaReal: null,
        amostras: 0,
        status: statusDoPadrao(0)
      };
      // backward compat - permite uso como numero em codigo antigo:
      // const w = getPesoAjustado(...)  -> Number(w) ainda funciona via valueOf.
      Object.defineProperty(obj, 'valueOf', { value: () => obj.peso, enumerable: false });
      return obj;
    }
    const taxa = calcularTaxaAcerto(slot.wins, slot.losses);
    if (taxa === null) {
      const obj = {
        peso: nominalNorm,
        confiancaReal: null,
        amostras: slot.total,
        status: statusDoPadrao(slot.total)
      };
      Object.defineProperty(obj, 'valueOf', { value: () => obj.peso, enumerable: false });
      return obj;
    }
    const w = pesoEvidencia(slot.total);
    const peso = lerp(nominalNorm, taxa, w);
    const obj = {
      peso,
      confiancaReal: taxa * 100,
      amostras: slot.total,
      status: statusDoPadrao(slot.total)
    };
    Object.defineProperty(obj, 'valueOf', { value: () => obj.peso, enumerable: false });
    return obj;
  };

  /**
   * Snapshot congelado da evidencia no momento da decisao.
   * Grava na primeira consulta (idempotente por (padraoId, roundId)).
   */
  const getEvidenciaSnapshot = (padraoId, roundId) => {
    if (!padraoId) return null;
    const key = _snapshotKey(padraoId, roundId);
    let snap = _snapshotLRU.get(key);
    if (!snap) {
      snap = gravarSnapshot(padraoId, roundId);
    } else {
      // Atualiza LRU - re-insere.
      _snapshotLRU.delete(key);
      _snapshotLRU.set(key, snap);
    }
    return snap;
  };

  const getBrierScore = (nomePadrao) => {
    const slot = _state.padroes[nomePadrao];
    if (!slot) return null;
    return calcularBrierDoPadrao(slot);
  };

  const getRanking = (limit = 20) => {
    const linhas = [];
    for (const nome of Object.keys(_state.padroes)) {
      const stats = getStatsPadrao(nome);
      if (!stats) continue;
      const pesoObj = getPesoAjustado(nome, stats.confiancaNominalMedia);
      const peso = pesoObj.peso;
      const brier = calcularBrierDoPadrao(_state.padroes[nome]);
      linhas.push({
        padrao: nome,
        total: stats.total,
        wins: stats.wins,
        losses: stats.losses,
        ties: stats.ties,
        taxaAcerto: stats.taxaAcerto,
        confiancaNominalMedia: stats.confiancaNominalMedia,
        confiancaReal: stats.confiancaReal,
        calibrada: stats.calibrada,
        status: stats.status,
        peso,
        brier
      });
    }
    linhas.sort((a, b) => {
      if (b.peso !== a.peso) return b.peso - a.peso;
      return b.total - a.total;
    });
    return linhas.slice(0, Math.max(0, limit | 0));
  };

  const getPadroesParaDesligar = (minSamples = 30) => {
    const fora = [];
    for (const nome of Object.keys(_state.padroes)) {
      const slot = _state.padroes[nome];
      if (slot.total < minSamples) continue;
      const taxa = calcularTaxaAcerto(slot.wins, slot.losses);
      if (taxa === null) continue;
      if (taxa < TAXA_ACERTO_DESLIGAR) {
        fora.push({
          padrao: nome,
          total: slot.total,
          wins: slot.wins,
          losses: slot.losses,
          ties: slot.ties,
          taxaAcerto: taxa,
          confiancaNominalMedia: slot.confiancaNominalMedia,
          confiancaReal: taxa * 100,
          motivo: `taxaAcerto<${(TAXA_ACERTO_DESLIGAR * 100).toFixed(0)}% com N>=${minSamples}`
        });
      }
    }
    fora.sort((a, b) => a.taxaAcerto - b.taxaAcerto);
    return fora;
  };

  /** Pub/sub interno (drift, cold, replay etc). */
  const subscribeToCalibrationChanges = (cb) => {
    if (typeof cb !== 'function') return () => {};
    _internalSubs.add(cb);
    return () => _internalSubs.delete(cb);
  };

  /** Replay mode: pausa atualizacoes ao estado live. */
  const enterReplayMode = (roundId) => {
    _replayMode = { ativo: true, roundId: roundId || null };
    log('replay mode ON', roundId);
    emitInternal('replay_mode_changed', { ativo: true, roundId: roundId || null });
  };

  const exitReplayMode = () => {
    const prev = _replayMode.roundId;
    _replayMode = { ativo: false, roundId: null };
    log('replay mode OFF', prev);
    emitInternal('replay_mode_changed', { ativo: false, roundId: prev });
  };

  /** Estatisticas gerais (multi-tab / replay). */
  const getCalibrationStats = () => ({
    padroes: Object.keys(_state.padroes).length,
    totalAmostras: Object.values(_state.padroes).reduce((s, p) => s + p.total, 0),
    leaderId: _leaderId,
    modoReplay: _replayMode.ativo,
    tabId: TAB_ID,
    isLeader: isLeader(),
    bcAvailable: _bcAvailable
  });

  const reset = () => {
    _state = estruturaVazia();
    _snapshotLRU.clear();
    const ok = salvar(_state);
    log('reset executado.');
    return ok;
  };

  const exportar = () => {
    try {
      return JSON.parse(JSON.stringify(_state));
    } catch (e) {
      warn('Falha ao exportar.', e);
      return estruturaVazia();
    }
  };

  const importar = (data) => {
    if (!data || typeof data !== 'object') {
      warn('importar: payload invalido.');
      return false;
    }
    if (data.version !== SCHEMA_VERSION) {
      warn('importar: versao incompativel.', data.version, '!=', SCHEMA_VERSION);
      return false;
    }
    if (!data.padroes || typeof data.padroes !== 'object') {
      warn('importar: campo padroes ausente.');
      return false;
    }
    _state = {
      version: SCHEMA_VERSION,
      versaoModelo: VERSAO_MODELO,
      startedAt: Number.isFinite(data.startedAt) ? data.startedAt : Date.now(),
      padroes: {}
    };
    for (const nome of Object.keys(data.padroes)) {
      const src = data.padroes[nome] || {};
      const slot = garantirSlot(_state, nome);
      slot.total  = Number(src.total)  || 0;
      slot.wins   = Number(src.wins)   || 0;
      slot.losses = Number(src.losses) || 0;
      slot.ties   = Number(src.ties)   || 0;
      slot.confiancaNominalMedia = Number(src.confiancaNominalMedia) || 0;
      slot.historicoCompleto = Array.isArray(src.historicoCompleto)
        ? src.historicoCompleto.slice(-MAX_HISTORICO_POR_PADRAO).map(e => ({
            confianca: clampConfianca(e && e.confianca),
            resultado: (e && (e.resultado === 'win' || e.resultado === 'loss' || e.resultado === 'tie')) ? e.resultado : 'tie',
            cor: (e && e.cor) || null,
            roundId: (e && e.roundId) || null,
            ts: Number.isFinite(e && e.ts) ? e.ts : Date.now()
          }))
        : [];
      recalcularAgregadosJanela(slot);
    }
    log('importar concluido. padroes=', Object.keys(_state.padroes).length);
    return salvar(_state);
  };

  // ==========================================================================
  // Bootstrap automatico
  // ==========================================================================

  initLeaderElection();

  // ==========================================================================
  // Retorno publico
  // ==========================================================================
  return {
    // API nova (P0+P1)
    attachEventStore,
    attachLifecycle,
    getPesoAjustado,
    getEvidenciaSnapshot,
    registrarResultado,
    subscribeToCalibrationChanges,
    enterReplayMode,
    exitReplayMode,
    isLeader,
    getCalibrationStats,

    // API legada (backward compat)
    getStatsPadrao,
    getStatsPorConfianca,
    getBrierScore,
    getRanking,
    getPadroesParaDesligar,
    reset,
    exportar,
    importar,

    // Constantes
    _meta: {
      STORAGE_KEY,
      SCHEMA_VERSION,
      VERSAO_MODELO,
      FAIXAS_CONFIANCA,
      MAX_HISTORICO_POR_PADRAO,
      TOLERANCIA_CALIBRACAO_PP,
      N_CONFIANCA_TOTAL,
      N_CONFIANCA_ZERO,
      TAXA_ACERTO_DESLIGAR,
      STATUS_COLD_MAX,
      STATUS_WARMING_MAX,
      DRIFT_THRESHOLD,
      DRIFT_CONSECUTIVE_ROUNDS,
      SNAPSHOT_LRU_SIZE,
      SNAPSHOT_EVERY_N_SAMPLES,
      SNAPSHOT_EVERY_MS,
      BC_CHANNEL_NAME,
      HEARTBEAT_INTERVAL_MS,
      LEADER_TAKEOVER_MS,
      TAB_ID
    }
  };
})();

/* ---------------------------------------------------------------------------
 * Exemplo de uso (apenas referencia - nao executa em runtime):
 *
 *   // Conectar dependencias (chamado pelo bootstrap da extensao):
 *   CalibrationLoop.attachEventStore(EventStore);
 *   CalibrationLoop.attachLifecycle(RoundLifecycle); // auto round_end
 *
 *   // Registrar manualmente (legacy/fallback):
 *   CalibrationLoop.registrarResultado({
 *     roundId: 'r-12345',
 *     padraoId: 'WMSG-007',
 *     confiancaNominal: 85,
 *     cor: 'red',
 *     resultado: 'loss',
 *     source: 'live',
 *     ts: Date.now()
 *   });
 *
 *   // Peso ajustado (objeto rico, mas tambem usavel como numero via valueOf):
 *   const { peso, confiancaReal, amostras, status } =
 *     CalibrationLoop.getPesoAjustado('WMSG-007', 85);
 *
 *   // Snapshot congelado no momento da decisao:
 *   const snap = CalibrationLoop.getEvidenciaSnapshot('WMSG-007', 'r-12345');
 *
 *   // Pub/sub para alertas (drift, cold, replay):
 *   const off = CalibrationLoop.subscribeToCalibrationChanges((ev) => {
 *     if (ev.type === 'drift_detected') console.warn('drift', ev);
 *   });
 *
 *   // Replay:
 *   CalibrationLoop.enterReplayMode('r-12345');
 *   // ... reprocessa amostras com source='replay' (sao ignoradas no live)
 *   CalibrationLoop.exitReplayMode();
 * ------------------------------------------------------------------------- */
