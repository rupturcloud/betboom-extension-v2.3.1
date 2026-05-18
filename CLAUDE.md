# CLAUDE.md — Extensão Claudinho HITL (Bac Bo / BetBoom)

> Documento para agentes (Claude e similares) que vão trabalhar nesta
> extensão. Leia antes de mexer. Diego (ruptur.cloud@gmail.com) é o
> operador principal.

## 📁 Caminho da extensão

Esta worktree é a base de desenvolvimento ativa:

```
/Users/diego/dev/hitl/claudinho/.claude/worktrees/sad-swanson-7ac4ec
```

Branch: `claude/sad-swanson-7ac4ec` (espelha `origin/claudinho`).

Carregar no Chrome: `chrome://extensions` → **Modo desenvolvedor** →
**Carregar sem compactação** → apontar para o caminho acima.

A pasta `/Users/diego/dev/hitl/claudinho-apostadora` é um snapshot
antigo (commit `463916d`, 16/05) preservado por pedido do Diego —
**não trabalhe nela**.

## 🛰️ Servidor de telemetria (USO PADRÃO — dev E produção)

Toda sessão de trabalho com Diego começa subindo o servidor local de
telemetria. Ele evita pedir logs manualmente: a extensão emite eventos
em tempo real, e o agente consulta direto.

### Subir o servidor

```bash
cd /Users/diego/dev/hitl/claudinho/.claude/worktrees/sad-swanson-7ac4ec
node tools/telemetry-server.js                       # dev (sem auth)
CLAUDINHO_TOKEN=$(uuidgen) node tools/telemetry-server.js  # produção
```

Output esperado:
```
[telemetry-server] 🛰  ouvindo em http://127.0.0.1:9876
[telemetry-server] log -> tools/telemetry.jsonl
[telemetry-server] cmds -> tools/commands.json
[telemetry-server] token = ⚠ dev (sem auth — POST /command aberto)
```

Em produção (Diego decidindo apostar de verdade), **sempre** use token:
- Diego exporta `CLAUDINHO_TOKEN` e me passa
- Eu envio comandos com header `X-Token: <valor>`

### Consultar (Claude → servidor)

```bash
curl -s localhost:9876/summary | jq                   # resumo geral
curl -s 'localhost:9876/query?type=decisao_tomada' | jq
curl -s 'localhost:9876/query?type=bet_confirmation&veredito=NAO_ENTROU' | jq
curl -s localhost:9876/recent?n=20 | jq
curl -N localhost:9876/tail                           # stream live (SSE)
```

### Comandar (Claude → extensão)

```bash
# Sem token (dev):
curl -s -X POST localhost:9876/command -d '{"cmd":"calibrar"}'

# Com token (produção):
curl -s -X POST localhost:9876/command \
  -H "X-Token: $CLAUDINHO_TOKEN" \
  -d '{"cmd":"calibrar"}'
```

Comandos suportados (lista completa em [tools/README.md](tools/README.md)):
- `snapshot` — emite estado completo
- `calibrar` — dispara `BBCalibrator.tudo()`
- `modo_observacao` `{on: bool}` — toggle clique real
- `parar` / `iniciar` — controla bot
- `aplicar_config` `{stakeInicial, stopWin, ...}` — muda CONFIG
- `aposta_teste` `{cor, stake}` — **bloqueado quando modo_observacao=ON**
- `limpar_calibracao`

### Eventos emitidos pela extensão (campo `.type`)

| Tipo | Quando | Campos chave |
|------|--------|--------------|
| `boot` | content script carregou | `extension_version`, `user_agent` |
| `decisao_tomada` | passou guard WMSG e vai armar | `cor`, `source`, `padrao`, `stake`, `conviction` |
| `guard_origem_bloqueado` | decisão NÃO-WMSG bloqueada | `source`, `padrao` |
| `bet_confirmation` | saldo conferido pós-clique | `veredito`, `cor`, `stake`, `delta` |
| `aposta_teste_blocked` | comando burlado por modo observação | `motivo` |
| `comando_recebido` | extensão recebeu /command | `cmd`, `args` |
| `error` | qualquer erro capturado | `erro` |

## 🎨 Regras de UX do Diego (read before changing UI)

1. **Overlay = fonte de verdade**: mudança que não aparece no overlay
   visualmente é equivalente a "não fiz". Console-only não conta.
2. **Tag de versão**: cada commit visível incrementa o badge `vN-nome`
   no canto direito da barra auto-start. Diego confirma reload pela tag.
3. **Botão visível e habilitado tem que fazer algo útil**. Bot rodando →
   "▶ INICIAR" vira "🔄 REINICIAR" (não fica cinza inerte).
4. **Comunicação sempre em pt-BR** (vide CLAUDE.md global do Diego).

## 🧱 Arquitetura — quem mora onde

```
content_scripts (manifest.json, ordem importa!):
  infra-guardrails → click-validator → chip-detector → calibrator →
  bet-confirmation-tracker → evidence-engine → idempotency-layer →
  event-store → round-lifecycle → plan-executor → replay-engine →
  calibration-loop → lifecycle-gate → lifecycle-replay-projector →
  calibration-{lifecycle,plan,replay}-adapter → config → collector →
  history-{store,normalizer,capture,diff,plan,graph,renderer,integrity} →
  patterns → decision-model → f1-scorer → graph-engine →
  conviction-engine → consensus-engine → context-health-engine →
  operational-{zones,candidate-pipeline} → interaction-intelligence →
  temporal-confidence-engine → behavior-drift-engine →
  table-degradation-engine → pattern-entropy-engine → robo-runtime →
  plan-visualizer → test-robo-runtime → decision → breakpoint-engine →
  explainability-engine → fsm-integration → observability → executor →
  debug-graph-ui → overlay → telemetry → content →
  debug-snapshot → telemetry-streamer

MAIN world (separado):
  calibrator-main.js  (BBCalibrator + ponte BBCAL_RUN_REQ)
  injected.js         (WebSocket override)
```

### Pontos críticos do pipeline (fluxo decisão)

```
WS evo-game (Evolution iframe)
  ↓ injected.js (MAIN) intercepta
  ↓ postMessage
content.js processa bacbo.road/playerState
  ↓ Collector.sincronizarRoad / adicionarResultadoConfirmado
  ↓ onNovoResultado callback (overlay.js)
  ↓
DecisionEngine.decidir(cores)
  ├─ verificarStopWin/StopLoss → motivoParada bloqueia
  ├─ PatternEngine.analisar → SÓ wmsg_AllMethods (18 WMSG)
  └─ FSMIntegration → RoboRuntime 7 checkpoints
  ↓ decisao {cor, source, padrao, stake}
  ↓
overlay.js callback:
  ├─ EMPATE→AZUL (overlay:1995+)
  ├─ INVERSÃO POR FAIXA 50-60/70-78 (overlay:2018+)
  └─ Guard origem=WMSG  ← bloqueia se source não wmsg*
  ↓
armarDecisao → countdown → _dispararExecucaoDecisao
  ↓ Executor.executarAposta
  ↓ Se modoTeste=true → ABORTA (executor:310)
  ↓
BBCalibrator.executarAposta(cor, stake, {somenteFicha: fichaPreferida=5})
  ↓ composeStake → sequencia [ficha × N]
  ↓ Para cada par: clicarHardware(chip) → clicarHardware(spot)
  ↓ BRIDGE_REQ → background.js → chrome.debugger.Input.dispatchMouseEvent
  ↓
BetConfirmationTracker.armar (10s timeout)
  ↓ saldo decrementou em ~stake → CONFIRMADA
  ↓ saldo igual → NAO_ENTROU
```

## 🚨 Bugs conhecidos (não corrigidos)

1. **ChipDetector falha 100% em mesa canvas-only** (Bac Bo Mini).
   Fallback heurístico em `content.js:1108` clica coords fixas que
   geralmente erram o spot. **Solução existente:** `BBCalibrator.tudo()`
   manual + uso de `executarAposta()` em vez do BB_CLICK heurístico.
2. **Composição não-exata**: stake R$37 com fichas [5,10,25] vira R$35
   (faltam R$2). `composeStake` retorna `ok:false` mas executor
   continua. Por design — Will sabe que o saldo é o limite.
3. **`logPadroesAtivos`** ainda mostra dynamicStrats=[] vazio. Cosmético.

## ✅ Bugs corrigidos nesta branch (vs `2afd0f9`)

- `WILL_EXTRA_PATTERNS is not defined` (referências mortas → patterns.js
  inteiro travava → PatternEngine virava undefined → cascata de crash)
- Auto-start nunca disparava (callback `onNovoResultado` só registrava
  quando Will clicava ▶ Iniciar manualmente)
- `analisar()` sempre detectava algo (~50 detectores frouxos com
  prob. ~100% combinada — agora 18 WMSG estritos)
- Calibração tentava fichas que Will não tinha saldo → cliques mortos

## 🔐 Segurança

- **Servidor de telemetria bind em 127.0.0.1** (não acessível externamente)
- **Token obrigatório em POST /command** quando `CLAUDINHO_TOKEN` setado
- **Modo observação bloqueia** `aposta_teste` (não dá pra burlar)
- **NUNCA** commitar `tools/telemetry.jsonl` (pode ter saldo/round_id)
  — `.gitignore` recomendado

## 🧠 Memórias relevantes (Diego)

- `feedback_overlay_visual.md` — overlay é fonte de verdade

## 📋 Checklist antes de mexer

- [ ] Server de telemetria rodando (`curl localhost:9876/health`)
- [ ] Tag visual `vN-nome` da última versão batendo com último commit
- [ ] Leu seção "Arquitetura" para entender ordem de carregamento
- [ ] Mudança visual? Bumpou tag + commit menciona o que mudou no overlay
- [ ] Adicionou hook de telemetria pros pontos novos? (`TelemetryStream.push({type:...})`)

## 🆘 Onde pedir socorro

- README do servidor: [tools/README.md](tools/README.md)
- Diagrama de fluxo: [docs/fluxo-extensao.mmd](docs/fluxo-extensao.mmd) /
  [docs/fluxo-extensao.png](docs/fluxo-extensao.png)
- Snapshot original (não mexer): `/Users/diego/dev/hitl/claudinho-apostadora`
