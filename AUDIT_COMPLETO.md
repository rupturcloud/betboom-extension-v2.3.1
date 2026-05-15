# 🔍 AUDIT COMPLETO — Estado Atual + Nova Solicitação

**Data**: 2026-05-13 | **Commit**: N/A | **Status**: Mapeamento Completo Pré-Implementação

---

# PARTE 1: O QUE EXISTE HOJE (30 arquivos .js)

## Core: Pattern Detection & Execution (5)

| Arquivo | Linhas | Status | Responsabilidade |
|---------|--------|--------|------------------|
| `patterns.js` | 1,123 | ✅ Prod | 18 padrões WMSG + 18 nativos, matching sequencial/linha/diagonal |
| `collector.js` | 617 | ✅ Prod | Lê DOM, constrói histórico de cores, timestamps |
| `f1-scorer.js` | 283 | ✅ Prod | Calcula confidence (F1) para padrões detectados |
| `executor.js` | 516 | ✅ Prod | Executa clicks reais, valida posição/timing |
| `decision.js` | 892 | ✅ Prod | Lógica de decisão (stake, gale, stop win/loss) |

## Bankroll & Safety (3)

| Arquivo | Linhas | Status | Responsabilidade |
|---------|--------|--------|------------------|
| `config.js` | 1,044 | ✅ Prod | Configurações: stake, gale, stop win/loss, sensibilidades |
| `safety-governance.js` | 285 | ✅ Prod | Circuit breaker, rate limiting (10 ops/min), validação de risco |
| `click-validator.js` | 288 | ✅ Prod | Valida sucesso de click (TOTAL_BET_INCREASED ou CHIP_INSIDE) |

## Infrastructure & Observability (6)

| Arquivo | Linhas | Status | Responsabilidade |
|---------|--------|--------|------------------|
| `observability.js` | 1,349 | ✅ Prod | Snapshot da sessão, métricas por padrão, estatísticas agregadas |
| `telemetry.js` | 278 | ✅ Prod | Coleta de eventos (padrão detectado, aposta, resultado) |
| `telemetry-collector.js` | 483 | ✅ Prod | Store de eventos para análise |
| `event-store.js` | 317 | ✅ Prod | Persistência de eventos em localStorage |
| `evidence-engine.js` | 293 | ✅ Prod | Estrutura de evidência para decisões |
| `idempotency-layer.js` | 243 | ✅ Prod | Previne duplicação: lastBetRoundId, pendingBet |

## UI & UX (4)

| Arquivo | Linhas | Status | Responsabilidade |
|---------|--------|--------|------------------|
| `overlay.js` | 2,063 | ✅ Prod | Sidebar 320px/36px, tabuleiro 6×26, status bar, logs |
| `popup.js` | 704 | ✅ Prod | Painel de controle: Ligar/Desligar, Configuração |
| `content.js` | 1,385 | ✅ Prod | Content script principal: injeção, listeners |
| `injected.js` | 189 | ✅ Prod | Script injetado no window global do DOM |

## Calibração & Extras (4)

| Arquivo | Linhas | Status | Responsabilidade |
|---------|--------|--------|------------------|
| `calibrador.js` | 243 | ✅ Prod | Ajustes dinâmicos de sensibilidade |
| `dynamic-calibrator.js` | 167 | ✅ Prod | Auto-calibração baseada em resultados |
| `smoke-tests.js` | 156 | ✅ Prod | Testes básicos de carga |
| `ws-live-capture.js` | 284 | ✅ Prod | Captura live de WebSocket (Evolution games) |

## Background & Model (2)

| Arquivo | Linhas | Status | Responsabilidade |
|---------|--------|--------|------------------|
| `background.js` | 274 | ✅ Prod | Service worker, gerenciamento de runtime |
| `decision-model.js` | 529 | ✅ Prod | Modelo de decisão com pesos/justificativas |

## Infra & Guardrails (1)

| Arquivo | Linhas | Status | Responsabilidade |
|---------|--------|--------|------------------|
| `infra-guardrails.js` | 252 | ✅ Prod | Validações de infraestrutura, checks pré-operação |

---

## Total Existente
- **30 arquivos .js**
- **~18,500 linhas de código funcional**
- **Status: Produção** (motor de sinais + execução funcional)

---

# PARTE 2: O QUE FOI ADICIONADO AGORA (4 engines novos)

## Recém Criados (4 arquivos novos)

| Arquivo | Linhas | Status | Responsabilidade |
|---------|--------|--------|------------------|
| `graph-engine.js` | 358 | ✅ Novo | Decision/Execution grafo: 12 nós, arestas, rastreamento causal |
| `conviction-engine.js` | ~280 | ✅ Novo | Convicção (execution readiness) separada de confidence |
| `consensus-engine.js` | ~260 | ✅ Novo | Votação entre padrões, detecção de conflito, agreement score |
| `context-health-engine.js` | ~350 | ✅ Novo | 8 métricas de saúde: estabilidade, volatilidade, entropia, drift |

**Total novo**: ~1,250 linhas (4 engines 100% funcionais, sem scaffolding)

---

## Estado Integração

```
❌ NÃO integrado em decision.js FSM (ainda)
❌ NÃO ligado em overlay (ainda)
❌ NÃO em manifest.json (ainda)
```

---

# PARTE 3: O QUE FOI SOLICITADO AGORA (11 engines + integração)

## Solicitação: Motor Observável, Causal, Contextual, Auditável, Explicável

### 11 Engines ainda FALTAM

| # | Engine | Linhas Est. | Dependências | Crítico? |
|---|--------|------------|--------------|----------|
| 5 | `explainability-engine.js` | ~400 | PatternEngine, ConvictionEngine | **SIM** |
| 6 | `causality-engine.js` | ~300 | GraphEngine, EventStore | **SIM** |
| 7 | `breakpoint-engine.js` | ~350 | GraphEngine | **SIM** |
| 8 | `operator-cognition-engine.js` | ~280 | EventStore, ObservabilityEngine | Não |
| 9 | `debug-operational.js` | ~200 | Todos engines | **SIM** |
| 10 | `replay-engine.js` | ~250 | GraphEngine, EventStore | Não |
| 11 | `causal-reports.js` | ~350 | GraphEngine, CausalityEngine, ExplainabilityEngine | Não |
| 12 | **Update `overlay.js`** | +500 | Todos engines | **SIM** |
| 13 | `debug-graph-ui.js` | ~300 | GraphEngine, BreakpointEngine | Não |
| 14 | **Integração em `decision.js` FSM** | +200 | Todos engines | **SIM** |
| 15 | **Update `manifest.json`** | +15 | — | **SIM** |

**Total a adicionar**: ~3,500 linhas + modificações em 3 arquivos existentes

---

# PARTE 4: ANÁLISE DE CONFLITOS & REDUNDÂNCIAS

## ⚠️ Potenciais Conflitos

### 1. Decision.js vs Conviction/Consensus
```
CONFLITO:
- decision.js já decide "ir" ou "não ir" baseado em confiança
- ConvictionEngine vai separar isso em conviction + hesitação
- ConsensusEngine vai votar entre padrões

RESOLUÇÃO:
decision.js deve ser atualizado para:
  1. Usar Consensus para resolver qual padrão (votação)
  2. Usar Conviction para determinar "GO/NO-GO"
  3. Usar Explainability para narrar a decisão
```

### 2. Event-Store vs Graph-Engine
```
CONFLITO:
- EventStore já persiste eventos
- GraphEngine vai rastrear nós e arestas

RESOLUÇÃO:
- EventStore = dados brutos (o que aconteceu)
- GraphEngine = estrutura causal (por que aconteceu, cadeia)
- Podem coexistir (complementares, não competitivos)
```

### 3. Observability.js vs Context-Health
```
CONFLITO:
- Observability.js já coleta métricas
- ContextHealthEngine vai monitorar saúde

RESOLUÇÃO:
- Observability = agregação de padrões/sessão
- ContextHealth = análise de série temporal (estabilidade, drift)
- ContextHealth alimenta alertas em Observability
```

### 4. Overlay.js complexidade
```
CONFLITO:
- overlay.js já tem 2,063 linhas
- Novo overlay contextual vai adicionar +500 linhas

RESOLUÇÃO:
- Manter sidebar existente como "Summary"
- Adicionar novas abas: "Consensus", "Conviction", "Graph", "Health", "Breakpoints"
- Usar tabs/expand para não poluir UI
```

---

# PARTE 5: MAPA DE INTEGRAÇÃO PROPOSTO

## Fluxo Completo (Como vai funcionar)

```
ROUND_DETECTED (collector.js detecta nova cor)
    ↓
HISTORY_UPDATED (collector atualiza histórico)
    ↓ [GraphEngine.setNodeRunning('HISTORY_UPDATED')]
PATTERN_MATCHED (patterns.js detecta padrões + confiança)
    ↓ [GraphEngine.addEvidence('PATTERN_MATCHED', patterns)]
CONTEXT_EVALUATED (ContextHealthEngine.assessContextHealth)
    ↓ [GraphEngine.updateMetrics('CONTEXT_EVALUATED', {stability, volatility, ...})]
CONSENSUS_RESOLVED (ConsensusEngine.resolveConsensus)
    ↓ [GraphEngine.updateMetrics('CONSENSUS_RESOLVED', {agreementScore, dominantSignal})]
CONVICTION_CALCULATED (ConvictionEngine.calculateConviction)
    ↓ [GraphEngine.updateMetrics('CONVICTION_CALCULATED', {convictionScore, recommendation})]
DECISION_CREATED (decision.js + ExplainabilityEngine)
    ↓ [GraphEngine.updateMetrics + ExplainabilityEngine.explain]
SAFETY_CHECKED (safety-governance.js existente)
    ↓ [GraphEngine.setNodeRunning('SAFETY_CHECKED')]
OPERATOR_CONFIRMED (overlay mostra tudo, operador clica GO)
    ↓ [GraphEngine.updateMetrics + BreakpointEngine.checkBreakpoints]
ACTION_EXECUTED (executor.js faz click real)
    ↓ [GraphEngine.setNodeRunning('ACTION_EXECUTED')]
ACTION_CONFIRMED (click-validator.js valida)
    ↓ [GraphEngine.setNodePassed('ACTION_CONFIRMED', {betId, amountBet})]
ROUND_SETTLED (resultado chega, bankroll atualizado)
    ↓ [GraphEngine.finalizeGraph, CausalityEngine.buildCausalChain]
```

---

# PARTE 6: BACKLOG ORGANIZADO

## Fase 1: Integração Core (CRÍTICA)

```
[ ] Task 1: Atualizar decision.js FSM
    - Adicionar GraphEngine chamadas em cada estado
    - Integrar ConsensusEngine decisão de qual padrão
    - Integrar ConvictionEngine decisão de GO/NO-GO
    - Tempo est: 2h

[ ] Task 2: Criar explainability-engine.js
    - Responder: por quê entrou, por quê não, por quê hesitou, por quê bloqueou
    - Inputs: padrões detectados, consensus, conviction, context health
    - Outputs: narrativas estruturadas (JSON)
    - Tempo est: 1.5h

[ ] Task 3: Criar causality-engine.js
    - Traçar cadeia: A causou B, B bloqueou C, etc
    - Input: GraphEngine.getCausalPath()
    - Output: timeline causal estruturada
    - Tempo est: 1h

[ ] Task 4: Criar breakpoint-engine.js
    - Implementar 15 tipos de breakpoint
    - Pausar fluxo, mostrar snapshot, permitir revisão
    - Input: GraphEngine nós + métricas
    - Tempo est: 1.5h

[ ] Task 5: Criar debug-operational.js
    - Logs contextualizados por engine
    - [Decision] | [Consensus] | [Conviction] | [Context] | [Causality] | [Execution]
    - Substituir logs antigos inúteis
    - Tempo est: 1h

[ ] Task 6: Atualizar overlay.js
    - Adicionar 5 novas abas
    - Mostrar Consensus, Conviction, ContextHealth, GraphPreview, Breakpoints
    - Permitir expandir/collapse
    - Tempo est: 2h
```

**Total Fase 1**: ~9 horas | **Crítico**: SIM

---

## Fase 2: Visualização & Debug (IMPORTANTE)

```
[ ] Task 7: Criar debug-graph-ui.js
    - Renderizar grafo visual: nós + arestas + latência
    - Cores por status (verde/amarelo/vermelho/cinza/azul)
    - Timeline na base
    - Zoom/pan interativo
    - Tempo est: 2h

[ ] Task 8: Criar operator-cognition-engine.js
    - Modelar: trust, hesitação, rejeições, reação
    - Coleta de padrões humanos (analytics)
    - Tempo est: 1h

[ ] Task 9: Criar replay-engine.js
    - Replay completo de rodada sem re-execução
    - Mostrar grafo, quebra-pontos, decisão em cinematic
    - Tempo est: 1.5h
```

**Total Fase 2**: ~4.5 horas | **Crítico**: NÃO

---

## Fase 3: Relatórios & Finalização (BÔNUS)

```
[ ] Task 10: Criar causal-reports.js
    - Relatórios respondendo: o quê/por quê/e se
    - Templates: rodada, sessão, análise manual
    - Tempo est: 1.5h

[ ] Task 11: Atualizar manifest.json
    - Adicionar 11 novos arquivos .js
    - Ordenar load: cores → engines → integração
    - Tempo est: 0.5h

[ ] Task 12: Testes de integração
    - 1 rodada completa: grafo gerado, consenso funciona, convicção trabalha
    - Breakpoints funcionam
    - Overlay mostra tudo
    - Tempo est: 1.5h
```

**Total Fase 3**: ~3.5 horas | **Crítico**: NÃO

---

# PARTE 7: TIMELINE & SEQUÊNCIA

## Caminho Crítico (Mínimo Viável)

```
Fase 1 (core): 9h
├─ decision.js FSM wiring (2h)
├─ explainability-engine (1.5h)
├─ causality-engine (1h)
├─ breakpoint-engine (1.5h)
├─ debug-operational (1h)
└─ overlay update (2h)

Fase 2 (visual): 4.5h
├─ debug-graph-ui (2h)
├─ operator-cognition (1h)
└─ replay-engine (1.5h)

Fase 3 (polish): 3.5h
├─ causal-reports (1.5h)
├─ manifest + cleanup (0.5h)
└─ integration tests (1.5h)

TOTAL: ~17 horas
```

---

# PARTE 8: CHECKLIST PRÉ-BUILD

## Antes de começar Fase 1

- [ ] Confirmar Fase 1 é o GO (core crítica)
- [ ] Confirmar prioridade dos 15 breakpoint types
- [ ] Confirmar quantas abas novas no overlay
- [ ] Confirmar se decision.js FSM precisa rewrite ou wrapper
- [ ] Confirmar logs devem substituir antigos ou conviver

## Dependências Externas

- [ ] patterns.js: ✅ Existe e funciona
- [ ] collector.js: ✅ Existe e funciona
- [ ] event-store.js: ✅ Existe, será usado
- [ ] observability.js: ✅ Existe, será estendido
- [ ] overlay.js: ✅ Existe, será expandido
- [ ] manifest.json: ✅ Existe, será atualizado

---

# PARTE 9: MATRIZ DE RISCO

| Componente | Risco | Mitigação |
|-----------|-------|-----------|
| decision.js rewrite | Alto | Usar wrapper em vez de modificar core |
| overlay.js +500 linhas | Médio | Componentes separados (abas independentes) |
| GraphEngine escalabilidade | Médio | Cleanup de grafos > 1h, limite de histórico |
| ConvictionEngine tuning | Médio | Parâmetros em config.js, ajustáveis |
| Latência total pipeline | Médio | Medir em cada Task, target < 100ms total |
| Novos logs inúteis | Baixo | Debug-operational bem estruturado |

---

# RESUMO EXECUTIVO

## HOJE
- 30 arquivos .js, ~18.5k linhas
- Motor funcional: detecta padrões + executa + gerencia bankroll
- **Capacidade**: Sinais binários (ENTRAR ou NÃO)

## APÓS FASE 1
- 35 arquivos .js, ~21.75k linhas
- Motor observável: mostra decisão, consenso, convicção, causalidade
- **Capacidade**: Sinais com contexto + explicação + breakpoints

## APÓS FASE 2
- 37 arquivos .js, ~23k linhas
- Motor auditável: replay, gráfico visual, análise de comportamento humano
- **Capacidade**: Auditoria completa de qualquer rodada

## APÓS FASE 3
- 37 arquivos .js, ~24.5k linhas
- Motor reportável: relatórios causais, evidência estruturada
- **Capacidade**: Entender e documentar "o quê/por quê/e se" de cada decisão

---

**Status**: 🟡 Aguardando Aprovação de Fase 1 para começar

