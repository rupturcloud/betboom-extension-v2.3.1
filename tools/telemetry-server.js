#!/usr/bin/env node
/*
 * Claudinho Telemetry Server
 *
 * Servidor HTTP local que recebe eventos da extensao em tempo real.
 * Sem dependencias (so http/fs nativos do Node).
 *
 * Uso:
 *   node tools/telemetry-server.js [--port 9876] [--log telemetry.jsonl]
 *
 * Endpoints:
 *   POST /event       - extensao envia evento JSON
 *   GET  /recent?n=50 - ultimos N eventos
 *   GET  /query?type=decisao&color=azul - filtros simples
 *   GET  /summary     - estatisticas (clicks, decisoes, hit-rate)
 *   GET  /tail        - SSE stream (curl -N pra acompanhar live)
 *   POST /command     - envia comando pra extensao (ex: dispararCalibracao)
 *   GET  /commands?ack=true - extensao consulta comandos pendentes
 *   GET  /health      - { ok: true, uptime, total_events }
 *
 * Arquivos:
 *   telemetry.jsonl   - log append-only (1 evento por linha JSON)
 *   commands.json     - fila de comandos pendentes pra extensao
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const argv = process.argv.slice(2);
const PORT = Number(getArg('--port') || 9876);
const LOG_FILE = path.resolve(__dirname, getArg('--log') || 'telemetry.jsonl');
const CMD_FILE = path.resolve(__dirname, 'commands.json');
const BUFFER_LIMIT = 5000; // ultimos 5000 eventos em memoria
// P0-security: token opcional pra proteger POST /command de scripts que
// rodem no mesmo host. Default 'dev' (sessao local de desenvolvimento).
// Em producao: export CLAUDINHO_TOKEN=$(uuidgen) antes de rodar.
const TOKEN = process.env.CLAUDINHO_TOKEN || 'dev';

function getArg(name) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
}

const startedAt = Date.now();
const buffer = []; // ring buffer em memoria
const sseClients = new Set(); // clientes /tail
let commands = []; // { id, cmd, args, createdAt, ackedAt? }

// Bootstrap: ler comandos pendentes
try {
  if (fs.existsSync(CMD_FILE)) commands = JSON.parse(fs.readFileSync(CMD_FILE, 'utf8'));
} catch (e) {
  console.warn('[boot] commands.json invalido, comecando vazio:', e.message);
}

function appendEvent(ev) {
  const enriched = { ...ev, _server_ts: new Date().toISOString() };
  buffer.push(enriched);
  if (buffer.length > BUFFER_LIMIT) buffer.shift();
  try { fs.appendFileSync(LOG_FILE, JSON.stringify(enriched) + '\n'); }
  catch (e) { console.error('[append] falha:', e.message); }
  for (const res of sseClients) {
    try { res.write(`data: ${JSON.stringify(enriched)}\n\n`); } catch (_) {}
  }
}

function saveCommands() {
  try { fs.writeFileSync(CMD_FILE, JSON.stringify(commands, null, 2)); }
  catch (e) { console.error('[cmd] save falha:', e.message); }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function send(res, status, obj, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    ...extraHeaders,
  });
  res.end(JSON.stringify(obj));
}

function summary() {
  const byType = {};
  let bets = 0, betsConfirmed = 0, betsFailed = 0;
  let decisions = 0, blocksOrigem = 0, blocksStop = 0;
  let last = null;
  for (const e of buffer) {
    byType[e.type] = (byType[e.type] || 0) + 1;
    if (e.type === 'bet_confirmation') {
      bets++;
      if (e.veredito === 'CONFIRMADA') betsConfirmed++;
      if (e.veredito === 'NAO_ENTROU') betsFailed++;
    }
    if (e.type === 'decisao_tomada') decisions++;
    if (e.type === 'guard_origem_bloqueado') blocksOrigem++;
    if (e.type === 'stop_atingido') blocksStop++;
    last = e;
  }
  return {
    uptime_s: Math.floor((Date.now() - startedAt) / 1000),
    total_events: buffer.length,
    by_type: byType,
    bets, bets_confirmed: betsConfirmed, bets_failed: betsFailed,
    hit_rate: bets > 0 ? +(100 * betsConfirmed / bets).toFixed(1) : null,
    decisions, blocks_origem: blocksOrigem, blocks_stop: blocksStop,
    last_event_at: last?._server_ts || null,
    last_event_type: last?.type || null,
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/health') {
    return send(res, 200, { ok: true, uptime_s: Math.floor((Date.now() - startedAt) / 1000), total_events: buffer.length });
  }

  if (req.method === 'POST' && url.pathname === '/event') {
    try {
      const body = await readBody(req);
      if (Array.isArray(body)) body.forEach(appendEvent);
      else appendEvent(body);
      return send(res, 200, { ok: true });
    } catch (e) {
      return send(res, 400, { ok: false, error: e.message });
    }
  }

  if (url.pathname === '/recent') {
    const n = Math.min(Number(url.searchParams.get('n') || 50), buffer.length);
    return send(res, 200, buffer.slice(-n));
  }

  if (url.pathname === '/query') {
    const filtered = buffer.filter((e) => {
      for (const [k, v] of url.searchParams) {
        if (String(e[k]) !== v) return false;
      }
      return true;
    });
    const n = Math.min(Number(url.searchParams.get('n') || 100), filtered.length);
    return send(res, 200, filtered.slice(-n));
  }

  if (url.pathname === '/summary') {
    return send(res, 200, summary());
  }

  if (url.pathname === '/tail') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write(`: connected\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/command') {
    // P0-security: exige token quando nao for default 'dev'
    if (TOKEN !== 'dev' && req.headers['x-token'] !== TOKEN) {
      return send(res, 401, { ok: false, error: 'token-invalido', hint: 'use header X-Token' });
    }
    try {
      const body = await readBody(req);
      const cmd = {
        id: `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        cmd: body.cmd,
        args: body.args || {},
        createdAt: new Date().toISOString(),
        ackedAt: null,
      };
      commands.push(cmd);
      saveCommands();
      return send(res, 200, { ok: true, id: cmd.id });
    } catch (e) {
      return send(res, 400, { ok: false, error: e.message });
    }
  }

  if (url.pathname === '/commands') {
    const ack = url.searchParams.get('ack');
    if (ack) {
      const c = commands.find((x) => x.id === ack);
      if (c) c.ackedAt = new Date().toISOString();
      saveCommands();
      return send(res, 200, { ok: true });
    }
    const pendentes = commands.filter((c) => !c.ackedAt);
    return send(res, 200, pendentes);
  }

  if (url.pathname === '/') {
    return send(res, 200, {
      name: 'Claudinho Telemetry Server',
      port: PORT,
      log: LOG_FILE,
      endpoints: ['/health', 'POST /event', '/recent?n=50', '/query?type=X', '/summary', '/tail', 'POST /command', '/commands'],
      summary: summary(),
    });
  }

  send(res, 404, { ok: false, error: 'not found', path: url.pathname });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[telemetry-server] 🛰  ouvindo em http://127.0.0.1:${PORT}`);
  console.log(`[telemetry-server] log -> ${LOG_FILE}`);
  console.log(`[telemetry-server] cmds -> ${CMD_FILE}`);
  console.log(`[telemetry-server] token = ${TOKEN === 'dev' ? '⚠ dev (sem auth — POST /command aberto)' : '✓ via CLAUDINHO_TOKEN'}`);
  console.log(`[telemetry-server] try: curl -s localhost:${PORT}/summary`);
});

process.on('SIGINT', () => {
  console.log('\n[telemetry-server] shutting down');
  saveCommands();
  process.exit(0);
});
