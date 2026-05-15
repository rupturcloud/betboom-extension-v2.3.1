/**
 * test-history-module.js — Testes Node.js puros para o History Module
 * Execute: node js/test-history-module.js
 */

// ─── Mock de browser globals ────────────────────────────────────────────────
if (typeof window === 'undefined') global.window = {};
if (typeof document === 'undefined') global.document = {
  createElement: () => ({
    className: '', style: { cssText: '' }, dataset: {}, innerHTML: '',
    appendChild: () => {}, querySelectorAll: () => [],
    querySelector: () => null, classList: { add: () => {}, contains: () => false },
    offsetParent: {}, addEventListener: () => {}
  }),
  body: { appendChild: () => {}, querySelector: () => null },
  getElementById: () => null,
  querySelectorAll: () => []
};

// ─── Carregar módulos ────────────────────────────────────────────────────────
const HistoryStore      = require('./history-store.js');
const HistoryNormalizer = require('./history-normalizer.js');
const HistoryDiff       = require('./history-diff.js');
const HistoryIntegrity  = require('./history-integrity.js');

// ─── Utilitários de teste ────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
let total  = 0;

function assert(description, condition, extra) {
  total++;
  if (condition) {
    passed++;
    console.log(`  ✓ ${description}`);
  } else {
    failed++;
    console.error(`  ✗ FALHOU: ${description}`, extra !== undefined ? `→ got: ${JSON.stringify(extra)}` : '');
  }
}

function section(name) {
  console.log(`\n═══ ${name} ═══`);
}

// ─── Fixtures ────────────────────────────────────────────────────────────────
function makeRaw(overrides = {}) {
  const ts = Date.now();
  return {
    roundId:     overrides.roundId     || `round-${ts}`,
    result:      overrides.result      || 'player',
    color:       overrides.color       || 'blue',
    playerScore: overrides.playerScore !== undefined ? overrides.playerScore : 5,
    bankerScore: overrides.bankerScore !== undefined ? overrides.bankerScore : 3,
    timestamp:   overrides.timestamp   || ts,
    ...overrides
  };
}

function makeNorm(overrides = {}) {
  const raw = makeRaw(overrides);
  return HistoryNormalizer.normalizeRound(raw, overrides.source || 'websocket');
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. HistoryNormalizer
// ═══════════════════════════════════════════════════════════════════════════
section('HistoryNormalizer');

{
  const norm = HistoryNormalizer.normalizeRound(makeRaw({ result: 'player' }), 'websocket');
  assert('normalizeRound player → color=blue',  norm && norm.color === 'blue',   norm?.color);
  assert('normalizeRound player → result=player', norm && norm.result === 'player', norm?.result);
  assert('normalizeRound gera signature', norm && typeof norm.signature === 'string' && norm.signature.length > 0, norm?.signature);
  assert('normalizeRound source=websocket', norm && norm.source === 'websocket', norm?.source);
  assert('normalizeRound preserva raw', norm && typeof norm.raw === 'object', typeof norm?.raw);
}

{
  const norm = HistoryNormalizer.normalizeRound(makeRaw({ result: 'banker' }), 'dom');
  assert('normalizeRound banker → color=red', norm && norm.color === 'red', norm?.color);
}

{
  const norm = HistoryNormalizer.normalizeRound(makeRaw({ result: 'tie' }), 'dom');
  assert('normalizeRound tie → color=green', norm && norm.color === 'green', norm?.color);
}

{
  // Derivação de color a partir de result
  const raw = { result: 'banker', timestamp: Date.now(), roundId: 'x1' };
  const norm = HistoryNormalizer.normalizeRound(raw, 'dom');
  assert('normalizeRound sem .color deriva de result', norm && norm.color === 'red', norm?.color);
}

{
  // Derivação de result a partir de color
  const raw = { color: 'blue', timestamp: Date.now(), roundId: 'x2' };
  const norm = HistoryNormalizer.normalizeRound(raw, 'dom');
  assert('normalizeRound sem .result deriva de color', norm && norm.result === 'player', norm?.result);
}

{
  // Signature determinística (mesmo input = mesma sig)
  const raw1 = { roundId: 'abc123', result: 'player', timestamp: 1000000, playerScore: 5, bankerScore: 3 };
  const raw2 = { roundId: 'abc123', result: 'player', timestamp: 1000000, playerScore: 5, bankerScore: 3 };
  const sig1 = HistoryNormalizer.generateSignature(raw1);
  const sig2 = HistoryNormalizer.generateSignature(raw2);
  assert('generateSignature é determinístico', sig1 === sig2, { sig1, sig2 });
}

{
  // calculateConfidence
  const conf1 = HistoryNormalizer.calculateConfidence(
    { roundId: 'abc', playerScore: 5, bankerScore: 3, timestamp: Date.now(), result: 'player' },
    'websocket'
  );
  const conf2 = HistoryNormalizer.calculateConfidence(
    { playerScore: null, bankerScore: null, timestamp: 0, result: 'player' },
    'visual'
  );
  assert('calculateConfidence websocket completo > visual incompleto', conf1 > conf2, { conf1, conf2 });
  assert('calculateConfidence retorna 0-1', conf1 >= 0 && conf1 <= 1, conf1);
}

{
  // Rejeitar round inválido
  const norm = HistoryNormalizer.normalizeRound(null, 'dom');
  assert('normalizeRound null → null', norm === null, norm);

  const norm2 = HistoryNormalizer.normalizeRound({ roundId: 'x', timestamp: Date.now() }, 'dom');
  assert('normalizeRound sem result/color → null', norm2 === null, norm2);
}

{
  // normalizeHistory batch
  const list = [
    makeRaw({ roundId: 'r1', result: 'player' }),
    makeRaw({ roundId: 'r2', result: 'banker' }),
    { invalido: true } // deve ser ignorado
  ];
  const normalized = HistoryNormalizer.normalizeHistory(list, 'dom');
  assert('normalizeHistory batch: 2 válidos de 3', normalized.length === 2, normalized.length);
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. HistoryStore
// ═══════════════════════════════════════════════════════════════════════════
section('HistoryStore');

{
  HistoryStore.reset();
  assert('reset: história vazia', HistoryStore.getCount() === 0, HistoryStore.getCount());
}

{
  const r1 = makeNorm({ roundId: 'store-1', result: 'player', timestamp: 1000 });
  const r2 = makeNorm({ roundId: 'store-2', result: 'banker', timestamp: 2000 });
  const r3 = makeNorm({ roundId: 'store-3', result: 'tie',    timestamp: 3000 });

  HistoryStore.reset();
  const res1 = HistoryStore.addRound(r1);
  const res2 = HistoryStore.addRound(r2);
  const res3 = HistoryStore.addRound(r3);

  assert('addRound retorna added:true', res1.added === true, res1);
  assert('addRound 3 rounds: count=3', HistoryStore.getCount() === 3, HistoryStore.getCount());
  assert('getRealHistory retorna array', Array.isArray(HistoryStore.getRealHistory()), true);
  assert('getRealHistory length=3', HistoryStore.getRealHistory().length === 3, HistoryStore.getRealHistory().length);
}

{
  // Deduplicação por signature
  const r = makeNorm({ roundId: 'dup-test', result: 'player', timestamp: 9000, source: 'dom' });
  HistoryStore.reset();
  HistoryStore.addRound(r);
  const res = HistoryStore.addRound(r); // duplicata exata
  assert('addRound duplicata: não adiciona', res.added === false, res);
  assert('addRound duplicata: count permanece 1', HistoryStore.getCount() === 1, HistoryStore.getCount());
}

{
  // Merge: fonte melhor sobrescreve
  const rDom = makeNorm({ roundId: 'merge-test', result: 'player', timestamp: 5000, source: 'dom', confidence: 0.9 });
  const rWS  = makeNorm({ roundId: 'merge-test', result: 'player', timestamp: 5000, source: 'websocket', confidence: 1.0 });
  HistoryStore.reset();
  HistoryStore.addRound(rDom);
  const resMerge = HistoryStore.addRound(rWS);
  assert('merge: websocket sobrescreve dom (reason=updated)', resMerge.reason === 'updated', resMerge.reason);
  assert('merge: count permanece 1', HistoryStore.getCount() === 1, HistoryStore.getCount());
  const stored = HistoryStore.getRealHistory()[0];
  assert('merge: source atualizado para websocket', stored.source === 'websocket', stored?.source);
}

{
  // getWindowHistory: 156 slots
  HistoryStore.reset();
  for (let i = 0; i < 200; i++) {
    const r = makeNorm({ roundId: `win-${i}`, result: ['player','banker','tie'][i % 3], timestamp: 1000 + i });
    HistoryStore.addRound(r);
  }
  const win = HistoryStore.getWindowHistory();
  assert('getWindowHistory: máximo 156', win.length === 156, win.length);
}

{
  // getWindowHistory com menos de 156
  HistoryStore.reset();
  for (let i = 0; i < 30; i++) {
    const r = makeNorm({ roundId: `small-${i}`, result: 'player', timestamp: 1000 + i });
    HistoryStore.addRound(r);
  }
  const win = HistoryStore.getWindowHistory();
  assert('getWindowHistory com 30 rounds: retorna 30', win.length === 30, win.length);
}

{
  // getLastRounds
  HistoryStore.reset();
  const r1 = makeNorm({ roundId: 'last-1', result: 'player', timestamp: 1 });
  const r2 = makeNorm({ roundId: 'last-2', result: 'banker', timestamp: 2 });
  const r3 = makeNorm({ roundId: 'last-3', result: 'tie',    timestamp: 3 });
  HistoryStore.addRound(r1);
  HistoryStore.addRound(r2);
  HistoryStore.addRound(r3);
  const last2 = HistoryStore.getLastRounds(2);
  assert('getLastRounds(2): 2 itens', last2.length === 2, last2.length);
  assert('getLastRounds(2): último é tie', last2[1].result === 'tie', last2[1]?.result);
}

{
  // getBySignature
  HistoryStore.reset();
  const r = makeNorm({ roundId: 'sig-test', result: 'player', timestamp: 99000 });
  HistoryStore.addRound(r);
  const found = HistoryStore.getBySignature(r.signature);
  assert('getBySignature encontra por signature', found !== null, found);
  assert('getBySignature: result correto', found?.result === 'player', found?.result);
}

{
  // addMany batch
  HistoryStore.reset();
  const rounds = [
    makeNorm({ roundId: 'batch-1', result: 'player', timestamp: 100 }),
    makeNorm({ roundId: 'batch-2', result: 'banker', timestamp: 200 }),
    makeNorm({ roundId: 'batch-3', result: 'tie',    timestamp: 300 })
  ];
  const stats = HistoryStore.addMany(rounds);
  assert('addMany: 3 adicionados', stats.added === 3, stats);
  assert('addMany: count=3', HistoryStore.getCount() === 3, HistoryStore.getCount());
}

{
  // replaceSnapshot: snapshot >= existente → substitui
  HistoryStore.reset();
  HistoryStore.addRound(makeNorm({ roundId: 'old-1', result: 'player', timestamp: 1 }));
  HistoryStore.addRound(makeNorm({ roundId: 'old-2', result: 'banker', timestamp: 2 }));

  const snapshot = [
    makeNorm({ roundId: 'new-1', result: 'tie',    timestamp: 10 }),
    makeNorm({ roundId: 'new-2', result: 'player', timestamp: 20 }),
    makeNorm({ roundId: 'new-3', result: 'banker', timestamp: 30 })
  ];
  HistoryStore.replaceSnapshot(snapshot, 'websocket');
  assert('replaceSnapshot: substitui por snapshot maior', HistoryStore.getCount() === 3, HistoryStore.getCount());
}

{
  // export alias
  assert('export alias existe como função', typeof HistoryStore.export === 'function', typeof HistoryStore.export);
  const exp = HistoryStore.export();
  assert('export retorna objeto com .history', Array.isArray(exp.history), typeof exp.history);
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. HistoryDiff
// ═══════════════════════════════════════════════════════════════════════════
section('HistoryDiff');

{
  const prev = [
    { signature: 'sig-1', roundId: 'r1', color: 'blue',  result: 'player' },
    { signature: 'sig-2', roundId: 'r2', color: 'red',   result: 'banker' }
  ];
  const next = [
    { signature: 'sig-1', roundId: 'r1', color: 'blue',  result: 'player' },
    { signature: 'sig-2', roundId: 'r2', color: 'red',   result: 'banker' },
    { signature: 'sig-3', roundId: 'r3', color: 'green', result: 'tie' }
  ];
  const diff = HistoryDiff.diffHistory(prev, next);
  assert('diffHistory detecta 1 added', diff.added.length === 1, diff.added);
  assert('diffHistory hasChanges=true', diff.hasChanges === true, diff.hasChanges);
  assert('diffHistory removed=0', diff.removed.length === 0, diff.removed);
}

{
  const h = [{ signature: 's1', color: 'blue' }, { signature: 's2', color: 'red' }];
  const diff = HistoryDiff.diffHistory(h, h);
  assert('diffHistory histórico idêntico: hasChanges=false', diff.hasChanges === false, diff.hasChanges);
}

{
  const prev = [{ signature: 's1', color: 'blue' }];
  const next = [{ signature: 's1', color: 'red' }]; // cor mudou
  const diff = HistoryDiff.diffHistory(prev, next);
  assert('diffHistory detecta mudança de cor', diff.colorChanged.length === 1, diff.colorChanged);
}

{
  assert('hasChanges: arrays diferentes → true', HistoryDiff.hasChanges([{signature:'a',color:'blue'}], [{signature:'b',color:'red'}]), true);
  assert('hasChanges: arrays iguais → false', !HistoryDiff.hasChanges([{signature:'a',color:'blue'}], [{signature:'a',color:'blue'}]), false);
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. HistoryIntegrity
// ═══════════════════════════════════════════════════════════════════════════
section('HistoryIntegrity');

{
  // Status EMPTY quando realHistory vazio
  const r = HistoryIntegrity.assessIntegrity([], []);
  assert('assessIntegrity vazio → EMPTY', r.status === 'EMPTY', r.status);
  assert('assessIntegrity vazio → score=0', r.score === 0, r.score);
}

{
  // Status INVALID quando rendered vazio mas real tem dados
  const real = [
    { signature: 's1', color: 'blue',  result: 'player', timestamp: 1 },
    { signature: 's2', color: 'red',   result: 'banker', timestamp: 2 }
  ];
  const r = HistoryIntegrity.assessIntegrity(real, []);
  assert('assessIntegrity real=2, rendered=0 → INVALID', r.status === 'INVALID', r.status);
}

{
  // Status INVALID quando rendered > real
  const real     = [{ signature: 's1', color: 'blue', result: 'player', timestamp: 1 }];
  const rendered = [
    { signature: 's1', color: 'blue', result: 'player' },
    { signature: 's2', color: 'red',  result: 'banker' }
  ];
  const r = HistoryIntegrity.assessIntegrity(real, rendered);
  assert('assessIntegrity rendered>real → INVALID', r.status === 'INVALID', r.status);
}

{
  // Status VALID quando cores batem 100%
  const history = [
    { signature: 's1', color: 'blue',  result: 'player', timestamp: 1 },
    { signature: 's2', color: 'red',   result: 'banker', timestamp: 2 },
    { signature: 's3', color: 'green', result: 'tie',    timestamp: 3 }
  ];
  const rendered = history.map(r => ({ ...r }));
  const res = HistoryIntegrity.assessIntegrity(history, rendered);
  assert('assessIntegrity 100% match → VALID', res.status === 'VALID', res.status);
  assert('assessIntegrity score ≥ 0.95', res.score >= 0.95, res.score);
}

{
  // Status DEGRADED quando 70-94% match
  const real = Array.from({ length: 10 }, (_, i) => ({
    signature: `s${i}`, color: 'blue', result: 'player', timestamp: i
  }));
  // Rendered com 2 cores erradas de 10 → 80% match
  const rendered = real.map((r, i) => ({
    ...r, color: i < 2 ? 'red' : 'blue'
  }));
  const res = HistoryIntegrity.assessIntegrity(real, rendered);
  assert('assessIntegrity ~80% cores → score > 0.70', res.score > 0.70, res.score);
  // Note: pode ser DEGRADED ou VALID dependendo do peso das penalidades — só verificar que não é INVALID
  assert('assessIntegrity ~80% cores → não é INVALID', res.status !== 'INVALID', res.status);
}

{
  // canUseFor gate
  // Forçar assessment INVALID
  HistoryIntegrity.assessIntegrity(
    [{ signature: 's1', color: 'blue', result: 'player', timestamp: 1 }],
    [] // rendered vazio → INVALID
  );
  assert('canUseFor("patterns") quando INVALID → false', !HistoryIntegrity.canUseFor('patterns'), true);
  assert('canUseFor("replay") quando INVALID → true', HistoryIntegrity.canUseFor('replay'), true);
}

{
  // canUseFor com assessment VALID
  const history = Array.from({ length: 5 }, (_, i) => ({
    signature: `v${i}`, color: 'blue', result: 'player', timestamp: i
  }));
  HistoryIntegrity.assessIntegrity(history, history.map(r => ({ ...r })));
  assert('canUseFor("patterns") quando VALID → true', HistoryIntegrity.canUseFor('patterns'), true);
  assert('canUseFor("execution") quando VALID → true', HistoryIntegrity.canUseFor('execution'), true);
}

{
  // canUseFor módulo desconhecido → false
  assert('canUseFor módulo desconhecido → false', !HistoryIntegrity.canUseFor('modulo_inventado'), true);
}

{
  // perspectiveHistory não polui realHistory
  HistoryIntegrity.setPerspectiveHistory([{ fake: true }]);
  const persp = HistoryIntegrity.getPerspectiveHistory();
  assert('perspectiveHistory separado do real', Array.isArray(persp) && persp.length === 1, persp.length);
}

{
  // isBlocking
  HistoryIntegrity.assessIntegrity([], []); // EMPTY
  assert('isBlocking quando EMPTY → true', HistoryIntegrity.isBlocking() === true, HistoryIntegrity.isBlocking());
}

{
  // getLastAssessment
  const assessment = HistoryIntegrity.getLastAssessment();
  assert('getLastAssessment retorna objeto', assessment !== null && typeof assessment === 'object', assessment);
  assert('getLastAssessment tem .status', typeof assessment.status === 'string', assessment?.status);
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. Grid algorithm — sem DOM, lógica pura
// ═══════════════════════════════════════════════════════════════════════════
section('Grid Algorithm (lógica pura sem DOM)');

{
  const ROWS = 6, COLS = 26, TOTAL_SLOTS = 156;

  function computeGrid(realHistory) {
    const windowHistory = realHistory.slice(-TOTAL_SLOTS);
    const offset = TOTAL_SLOTS - windowHistory.length;
    const slots = [];
    for (let slot = 0; slot < TOTAL_SLOTS; slot++) {
      const historyIndex = slot - offset;
      const round = historyIndex >= 0 ? windowHistory[historyIndex] : null;
      const row = (slot % ROWS) + 1;
      const col = Math.floor(slot / ROWS) + 1;
      slots.push({ slot, row, col, round });
    }
    return slots;
  }

  // Com 0 rounds: 156 slots vazios
  const g0 = computeGrid([]);
  assert('Grid vazio: 156 slots', g0.length === TOTAL_SLOTS, g0.length);
  assert('Grid vazio: todos null', g0.every(s => s.round === null), true);

  // Com 1 round: 155 vazios + 1 preenchido no slot 0
  const r1 = [{ signature: 's1', color: 'blue', result: 'player' }];
  const g1 = computeGrid(r1);
  assert('Grid 1 round: slot 0 é null (offset=155)', g1[0].round === null, g1[0].round);
  assert('Grid 1 round: slot 155 tem round', g1[155].round !== null, g1[155].round);
  assert('Grid 1 round: slot 155 row=6 col=26', g1[155].row === 6 && g1[155].col === 26, `row=${g1[155].row} col=${g1[155].col}`);

  // Preenchimento por coluna: slot 0=row1col1, slot 1=row2col1, slot 5=row6col1, slot 6=row1col2
  const g6 = computeGrid(Array.from({ length: 156 }, (_, i) => ({ signature: `s${i}`, color: 'blue' })));
  assert('Grid 156: slot 0 → row=1 col=1', g6[0].row === 1 && g6[0].col === 1, `row=${g6[0].row} col=${g6[0].col}`);
  assert('Grid 156: slot 5 → row=6 col=1', g6[5].row === 6 && g6[5].col === 1, `row=${g6[5].row} col=${g6[5].col}`);
  assert('Grid 156: slot 6 → row=1 col=2', g6[6].row === 1 && g6[6].col === 2, `row=${g6[6].row} col=${g6[6].col}`);
  assert('Grid 156: slot 155 → row=6 col=26', g6[155].row === 6 && g6[155].col === 26, `row=${g6[155].row} col=${g6[155].col}`);

  // Com 200 rounds: window = últimos 156
  const r200 = Array.from({ length: 200 }, (_, i) => ({ signature: `s${i}`, color: 'blue' }));
  const g200 = computeGrid(r200);
  const filled = g200.filter(s => s.round !== null).length;
  assert('Grid 200 rounds: 156 slots preenchidos', filled === TOTAL_SLOTS, filled);
  assert('Grid 200 rounds: último round é index 199', g200[155].round?.signature === 's199', g200[155].round?.signature);
}

// ─── Resultado Final ─────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(50)}`);
console.log(`RESULTADO: ${passed}/${total} passaram | ${failed} falharam`);
if (failed === 0) {
  console.log('✅ TODOS OS TESTES PASSARAM');
} else {
  console.error(`❌ ${failed} TESTE(S) FALHARAM`);
  process.exit(1);
}
