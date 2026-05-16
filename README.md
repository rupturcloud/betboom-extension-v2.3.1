# Autodrive HITL Core — Engine de Decisão Inteligente

**Versão**: 2.4.0
**Status**: Engine de Automação com Human-in-the-Loop + Autodrive
**Branch ativa**: `claude-code`

Uma plataforma de **decisão autonômica** com forte camada de supervisão humana (HITL), arquitetura modular e foco em auditabilidade total. Originalmente nascido para Bac Bo, projetado para ser **agnóstico de plataforma**.

---

## 🎯 Visão Geral

- **Autodrive** — execução automática quando convicção e contexto são fortes
- **HITL** — operador confirma, cancela ou aguarda timer (5–8 s) com botões grandes e explicáveis
- **Explicabilidade** — toda decisão carrega o "Por quê?" (padrão + convicção + contexto)
- **Auditabilidade Total** — `EventStore` como SSoT + `ReplayEngine` determinístico
- **Engenharia limpa** — Clean Architecture, ports & adapters, engines modulares

---

## 🧠 Engines do núcleo

| Módulo | Responsabilidade |
|---|---|
| `event-store.js` | SSoT com `seq` monotônico + `queryByRoundId` + pub/sub |
| `round-lifecycle.js` | FSM canônica da rodada (idle/active/closed) + watchdog sob demanda |
| `plan-executor.js` | Plano serializável com steps/fallbacks/idempotência + executionMode replay-safe |
| `replay-engine.js` | Replay determinístico read-only + cache LRU + comparação entre rodadas |
| `calibration-loop.js` | Aprendizado WIN/LOSS por padrão + leader election multi-tab + drift detection |
| `decision.js` | Orquestrador central + Conviction + Consensus + ContextHealth |
| `patterns.js` | 18 padrões WMSG + 14 WILL extras + 11 dinâmicos + 18 nativos |
| `executor.js` | Execução de clique robusta (chip + spot + confirm) com anti-bot |
| `overlay.js` | UI view-only com HITL forte (countdown, confirmar, cancelar) |

### Adapters de integração

- `lifecycle-gate.js` — PlanExecutor consome RoundLifecycle sem importar direto
- `lifecycle-replay-projector.js` — Replay reconstrói FSM a partir do EventStore
- `calibration-lifecycle-adapter.js` — Calibration escuta `round_end` direto
- `calibration-plan-adapter.js` — Extrai contexto de calibração dos planos
- `calibration-replay-adapter.js` — Replay nunca polui calibração (modo replay)

---

## 🎲 Padrões de Detecção (47 estratégias ativas)

### WMSG (18 — Will Dados Pro sequências exatas em 4 casas)
Sequência → Linha → Diagonal. Inclui streaks, zigue-zague, espelhos, sanduíches e padrões de empate.

### WILL Extras (14 — sequências de tamanho variável)
Streaks longos (5 e 7), espelhos longos, zigue-zague longo, padrões complexos, empate duplo, empate intercalado.

### Bibliotecas Dinâmicas (11) + Padrões Nativos (18)
Xadrez, Reversão, Pós-Empate, Diagonal, Casadinho, Linha Devedora, Quebra de Padrão, Sequências, Ponta, Ping-Pong, Tendência, Correção Após Empate, Espelho, Canal Horizontal, Reversão Diagonal.

---

## 🤝 Human-in-the-Loop

Três níveis de operação:
1. **Alta convicção** (≥ 85%) → auto-executa após countdown breve
2. **Média convicção** → countdown 5s + botão "✅ CONFIRMAR" piscando + botão "❌ CANCELAR" ao lado
3. **Operador discorda** → clique em CANCELAR aborta instantaneamente

Toda decisão fica registrada no `EventStore` para replay e auditoria.

---

## 💰 Bankroll Management

- **Stake base** configurável
- **Martingale** (gale) com reset em vitória + proteção empate opcional
- **Stop Win / Stop Loss** rigorosos
- **Banca**: extensão **nunca** bloqueia clique por banca — quem aceita ou recusa é a casa

---

## 📡 Observabilidade

- `EventStore` (IndexedDB) com `append → {seq, persistedAt}` síncrono no seq
- `EvidenceEngine` (localStorage) como índice rápido
- `ReplayEngine.replayRound(roundId)` reproduz timeline determinística
- `[BB-FLOW]`, `[DECISOR-DEBUG]`, `[COUNTDOWN-DEBUG]` logs estruturados

---

## 🚀 Instalação

```bash
git clone https://github.com/rupturcloud/hitl-automation-engine.git
cd hitl-automation-engine
git checkout claude-code
```

1. Chrome → `chrome://extensions/`
2. Modo desenvolvedor ON
3. Carregar pasta da extensão
4. Abrir mesa (BetBoom Bac Bo) — extensão injeta overlay no top frame

---

## 🧪 Como testar

1. Recarregue a extensão após qualquer mudança
2. Console deve mostrar:
   ```
   [EventStore] ✅ IndexedDB inicializado
   [RoundLifecycle] configure() chamado
   [Wire-up dos módulos novos concluído]
   ```
3. Quando padrão for detectado:
   ```
   [DECISOR-DEBUG] ✅ DECISÃO PRONTA: WMSG-007 → vermelho
   [COUNTDOWN-DEBUG] PASSOU TODOS OS GUARDS — chamando iniciarCountdown
   ```
4. Overlay mostra botão laranja piscando "✅ CONFIRMAR (5s)" + botão "❌ CANCELAR"

---

## 📐 Filosofia de engenharia

- UI/UX preservada (operador mantém familiaridade)
- Motor interno reconstruído com padrões profissionais (Strategy, Observer, Command, State, Repository, Factory)
- Cada módulo testável isoladamente
- Backward compatible: tudo opcional via `attach()`, fluxo legado funciona se algo não carregar
- Multi-plataforma por design (BetBoom → Brazzer → H2 via adapters)

---

## 🤖 Contribuições por agentes

Sprint de 4 rodadas de debate adversarial entre 4 agentes especialistas (Sistemas Distribuídos, FSM/Event Sourcing, Observabilidade, ML/Estatística) + 6 agentes de implementação em paralelo, orquestrados como CTO. Ver `git log claude-code` para histórico detalhado.

---

**Mantido por**: Ruptur Cloud · **Engenharia**: Multi-agente coordenado
