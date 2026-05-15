# 🏗️ ARQUITETURA VISUALIZADA — BetBoom Extension v2.3.1

---

## 📐 FLUXO CRÍTICO (Decision → Execution)

```
┌──────────────────────────────────────────────────────────────────┐
│                      COLLECTOR (collector.js)                     │
│                    Lê DOM + Normaliza Cores                       │
│  Input: DOM (6 linhas × 26 colunas) → Output: [Azul|Verm|Empa]   │
└────────────────────────────┬─────────────────────────────────────┘
                             ↓ historico atualizado
┌──────────────────────────────────────────────────────────────────┐
│                   PATTERN DETECTION (patterns.js)                │
│              18 WMSG + 18 Nativos (3 tipos matching)             │
│  Input: Histórico 4 últimas cores → Output: {padrão, tipo, conf} │
│  ├─ Sequencial (últimas 4): 85% confiança ✅                      │
│  ├─ Linha (qualquer linha): 82% confiança ✅                      │
│  └─ Diagonal (↘↙): 79% confiança ✅                               │
└────────────────────────────┬─────────────────────────────────────┘
                             ↓ padrões candidatos
┌──────────────────────────────────────────────────────────────────┐
│              CONSENSUS ENGINE (consensus-engine.js)              │
│                   Qual padrão ganhou votação?                    │
│  Input: {WMSG-005: 85%, WMSG-009: 70%, ...}                      │
│  Output: {dominante: WMSG-005, consensoScore: 72%}              │
│  Status: ✅ IMPLEMENTADO | ❌ NÃO INTEGRADO                      │
└────────────────────────────┬─────────────────────────────────────┘
                             ↓ padrão vencedor + consenso
┌──────────────────────────────────────────────────────────────────┐
│            CONTEXT HEALTH ENGINE (context-health-engine.js)      │
│           Mesa boa ou ruim? (8 métricas de saúde)               │
│  Input: Histórico completo, série temporal                      │
│  Output: {estabilidade, volatilidade, drift, entropia, ...}     │
│  Status: ✅ IMPLEMENTADO | ❌ NÃO INTEGRADO                      │
└────────────────────────────┬─────────────────────────────────────┘
                             ↓ métricas de saúde
┌──────────────────────────────────────────────────────────────────┐
│             CONVICTION ENGINE (conviction-engine.js)             │
│                  Entrar ou Hesitar?                              │
│  Input: consensoScore + contextHealth + histórico               │
│  Output: {convictionScore, recomendação: GO|HESITATE|NO-GO}     │
│  Status: ✅ IMPLEMENTADO | ❌ NÃO INTEGRADO                      │
└────────────────────────────┬─────────────────────────────────────┘
                             ↓ decisão de entrada
┌──────────────────────────────────────────────────────────────────┐
│              EXPLAINABILITY ENGINE (explainability-engine.js)    │
│            Por quê? (Narrativa estruturada)                     │
│  Input: Padrão + Consenso + Conviction + ContextHealth          │
│  Output: {raciocinio, justificativas, alternativas}             │
│  Status: ✅ IMPLEMENTADO | ⚠️ PARCIALMENTE INTEGRADO              │
└────────────────────────────┬─────────────────────────────────────┘
                             ↓ narrativa de decisão
┌──────────────────────────────────────────────────────────────────┐
│               DECISION FSM (decision.js FSM)                     │
│  OFF → OBSERVING → SIGNAL_FOUND → EXECUTE_REQUESTED             │
│  → CLICK_CONFIRMED → WAITING_RESULT → WIN/LOSS/STOP             │
│                                                                  │
│  Estado Atual: ⚠️ FSM EXISTE MAS NÃO CHAMA ENGINES               │
│  Falta: Wiring para chamar consensus, conviction, explain       │
└────────────────────────────┬─────────────────────────────────────┘
                             ↓ CASA ou FORA?
┌──────────────────────────────────────────────────────────────────┐
│             SAFETY GOVERNANCE (safety-governance.js)             │
│                 Circuit Breaker + Risk Check                    │
│  ├─ Taxa de operação: 10 ops/min ✅                             │
│  ├─ Risco máximo: 5% da banca ✅                                │
│  └─ Kill switch automático: SIM ✅                              │
└────────────────────────────┬─────────────────────────────────────┘
                             ↓ aprovado?
┌──────────────────────────────────────────────────────────────────┐
│                   EXECUTOR (executor.js)                         │
│          Simula click real (mouse + pointer events)              │
│  ├─ pointerdown → mousedown → mouseup → pointerup → click       │
│  ├─ Confirmação: TOTAL_BET_INCREASED ou CHIP_INSIDE_AREA        │
│  └─ Taxa sucesso: 97%+ ✅                                        │
└────────────────────────────┬─────────────────────────────────────┘
                             ↓ aposta enviada
┌──────────────────────────────────────────────────────────────────┐
│            BANKROLL MANAGER (decision.js continued)              │
│         Gale, Stop Win/Loss, Proteção Empate                    │
│  ├─ Stake base: 5.00 ✅                                         │
│  ├─ Martingale: ×2 após loss ✅                                 │
│  ├─ Stop Win: 100 ✅                                            │
│  └─ Stop Loss: 50 ✅                                            │
└────────────────────────────┬─────────────────────────────────────┘
                             ↓ rodada espera resultado
┌──────────────────────────────────────────────────────────────────┐
│         CLICK VALIDATOR (click-validator.js)                     │
│             Aposta entrou mesmo?                                │
│  Input: TOTAL_BET ou CHIP_INSIDE sinais                         │
│  Output: {betId, amountBet, confirmado}                         │
└────────────────────────────┬─────────────────────────────────────┘
                             ↓ WIN/LOSS confirmado
┌──────────────────────────────────────────────────────────────────┐
│         EVENT STORE (event-store.js)                            │
│             Persiste em localStorage                             │
│  ├─ RoundId + Padrão + Confiança + Decisão + Resultado          │
│  └─ Auditoria bruta (logs, não estruturado)                    │
└────────────────────────────┬─────────────────────────────────────┘
                             ↓ rodada registrada
┌──────────────────────────────────────────────────────────────────┐
│       GRAPH ENGINE (graph-engine.js) — MISSING INTEGRATION      │
│             Rastreabilidade Causal                              │
│  ├─ 12 nós de decisão (HISTORY→CONSENSUS→CONVICTION→EXEC...)   │
│  ├─ Arestas causal (A causou B, B bloqueou C)                  │
│  └─ Status: ✅ IMPLEMENTADO | 🔴 SEM INTEGRAÇÃO                 │
│                                                                  │
│  ❌ CRÍTICO: Sem causalidade = sem auditoria                   │
└──────────────────────────────────────────────────────────────────┘
```

---

## 🧩 DEPENDÊNCIA DE MÓDULOS (Digraph)

```
collector.js                          (leitura DOM)
    ↓
patterns.js ←─────────────────┐       (18 padrões WMSG)
    ↓                        │
f1-scorer.js                 │       (confiança)
    ↓                        │
    ├→ consensus-engine.js   │       (votação)
    │   ↓                   │
    │   conviction-engine.js─┘       (hesitação)
    │   ↓
    ├→ context-health-engine.js      (8 métricas)
    │
    ├→ decision.js FSM       ←─────┐ (OFF→SIGNAL→EXECUTE)
    │   ├─ executor.js       ←─────┤ (click real)
    │   ├─ bankroll logic    ←─────┤ (gale/stop)
    │   └─ safety-governance ←─────┤ (circuit breaker)
    │       ↓
    ├→ click-validator.js            (confirmação)
    │
    ├→ event-store.js        ←─────┐ (persistência)
    │                        └─────→ observability.js
    │
    └→ overlay.js            ←───── UI + tabuleiro visual
        ├─ popup.js
        └─ content.js


⚠️ ACOPLAMENTO ALTO:
  overlay.js depende de TODOS os engines
  → Risco: overlay.js = 2.4K LOC monolítica
  → Solução: Refatorar em componentes

❌ INTEGRAÇÃO FALTANDO:
  decision.js FSM NÃO chama:
    - consensus-engine
    - conviction-engine
    - context-health-engine
    - explainability-engine (50% implementado)
    - graph-engine
  → Risco: Dead code, sem explicabilidade
```

---

## 📊 MATRIZ DE MATURIDADE

```
┌────────────────────┬──────────┬────────┬─────────────┐
│ Módulo             │ LOC      │ Status │ Integrado?  │
├────────────────────┼──────────┼────────┼─────────────┤
│ CORE               │          │        │             │
│ ├─ collector       │ 617      │ ✅ Prod│ SIM         │
│ ├─ patterns        │ 1123     │ ✅ Prod│ SIM         │
│ ├─ f1-scorer       │ 283      │ ✅ Prod│ SIM         │
│ ├─ executor        │ 539      │ ✅ Prod│ SIM         │
│ └─ decision        │ 931      │ ✅ Prod│ PARCIAL ⚠️  │
├────────────────────┼──────────┼────────┼─────────────┤
│ ENGINES NOVOS      │          │        │             │
│ ├─ consensus       │ 260      │ ✅ Novo│ NÃO 🔴      │
│ ├─ conviction      │ 280      │ ✅ Novo│ NÃO 🔴      │
│ ├─ context-health  │ 350      │ ✅ Novo│ NÃO 🔴      │
│ └─ graph-engine    │ 358      │ ✅ Novo│ NÃO 🔴      │
├────────────────────┼──────────┼────────┼─────────────┤
│ EXPLICABILIDADE    │          │        │             │
│ ├─ explainability  │ 488      │ ✅ Novo│ PARCIAL ⚠️  │
│ ├─ causality       │ 300      │ 🔴 Plan│ NÃO         │
│ ├─ breakpoint      │ 350      │ 🔴 Plan│ NÃO         │
│ └─ replay          │ 250      │ 🔴 Plan│ NÃO         │
├────────────────────┼──────────┼────────┼─────────────┤
│ SEGURANÇA          │          │        │             │
│ ├─ safety-gov      │ 285      │ ✅ Prod│ SIM         │
│ ├─ idempotency     │ 243      │ ✅ Prod│ SIM         │
│ └─ click-validator │ 288      │ ✅ Prod│ SIM         │
├────────────────────┼──────────┼────────┼─────────────┤
│ UI/UX              │          │        │             │
│ ├─ overlay         │ 2453 ⚠️  │ ✅ Prod│ SIM (debt)  │
│ ├─ popup           │ 704      │ ✅ Prod│ SIM         │
│ └─ debug-ui        │ 300 (est)│ 🔴 Plan│ NÃO         │
├────────────────────┼──────────┼────────┼─────────────┤
│ OBSERV.            │          │        │             │
│ ├─ event-store     │ 317      │ ✅ Prod│ SIM         │
│ ├─ observability   │ 1349     │ ✅ Prod│ SIM         │
│ └─ telemetry       │ 278      │ ✅ Prod│ SIM         │
├────────────────────┼──────────┼────────┼─────────────┤
│ CONFIG             │ 1044     │ ✅ Prod│ SIM         │
├────────────────────┼──────────┼────────┼─────────────┤
│ TOTAL              │ 22.5K    │ 65% ✅ │ 75% integr. │
│                    │          │ 35% 🔴 │ 25% missing │
└────────────────────┴──────────┴────────┴─────────────┘

LEGENDA:
✅ Prod = Em produção, testado
✅ Novo = Novo, implementado, testado isoladamente
⚠️ Parcial = Implementado, mas integração incompleta
🔴 Plan = Planejado, não implementado
🔴 Dead = Implementado mas não usado
```

---

## 🚨 GAPS DE CRÍTICO

```
┌─────────────────────────────────────────────────────┐
│ GAP 1: Sem Integração FSM ↔ Engines               │
├─────────────────────────────────────────────────────┤
│ decision.js FSM atual:                             │
│   OFF → OBSERVING → SIGNAL_FOUND → EXECUTE         │
│                                                    │
│ decision.js NÃO chama:                             │
│   ✗ consensus-engine.resolveConsensus()            │
│   ✗ conviction-engine.calculateConviction()        │
│   ✗ context-health-engine.assessHealth()           │
│   ✗ explainability-engine.explain()                │
│   ✗ graph-engine.setNodeRunning()                  │
│                                                    │
│ IMPACTO: Engines existem mas são DEAD CODE         │
│ ESFORÇO: 2h para integração FSM                    │
│ CRITICIDADE: P0 BLOQUEADOR                         │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ GAP 2: Sem Rastreabilidade Causal                  │
├─────────────────────────────────────────────────────┤
│ Impossível responder:                              │
│   "Por quê essa decisão foi tomada?"               │
│   "O quê bloqueou essa entrada?"                   │
│   "E se tivesse entrada alternativa?"              │
│                                                    │
│ Causa: graph-engine implementado mas não wired     │
│ Falta:                                             │
│   ✗ causality-engine (rastreabilidade linear)      │
│   ✗ breakpoint-engine (pausas para debug)          │
│   ✗ replay-engine (reexecução determinística)      │
│                                                    │
│ IMPACTO: Operador não confia, sem compliance       │
│ ESFORÇO: 5-6h para 3 engines + integração          │
│ CRITICIDADE: P0 BLOQUEADOR PARA PRODUÇÃO           │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ GAP 3: Overlay.js Monolítica                       │
├─────────────────────────────────────────────────────┤
│ Tamanho: 2.453 LOC (maior que patterns.js!)        │
│ Problema:                                          │
│   - Sem componentes isolados                       │
│   - UI misturada com lógica                        │
│   - Impossível testar isoladamente                 │
│   - Acoplada a todos os engines                    │
│                                                    │
│ IMPACTO: Debt crescente, refactor cada 6 meses     │
│ ESFORÇO: 4h para refatorar em componentes          │
│ CRITICIDADE: P1 IMPORTANTE                         │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ GAP 4: Sem Testes de Integração                    │
├─────────────────────────────────────────────────────┤
│ Existem testes unit de alguns módulos              │
│ Faltam:                                            │
│   ✗ E2E: padrão → decisão → execução completo      │
│   ✗ FSM: todas as 8 transições de estado           │
│   ✗ Integração engines: consensus + conviction     │
│   ✗ Auditoria: rodada replayável 100%              │
│                                                    │
│ IMPACTO: Bugs em produção indetectáveis            │
│ ESFORÇO: 3h para cobertura E2E                     │
│ CRITICIDADE: P1 IMPORTANTE                         │
└─────────────────────────────────────────────────────┘
```

---

## 🎯 ROADMAP CRÍTICO (3 sprints, 4-5 dias)

```
SPRINT 1 (2 dias) — CORE CRÍTICA
┌─────────────────────────────────────────┐
│ [ ] 1. Integrar 4 engines em decision.js │ (2h)
│       ├─ consensus.resolveConsensus()   │
│       ├─ conviction.calculateConviction()
│       ├─ context-health.assessHealth()  │
│       └─ graph-engine.setNodeRunning()  │
│                                         │
│ [ ] 2. Criar wrapper ExplainabilityFull │ (1.5h)
│       └─ Narrativa estruturada JSON     │
│                                         │
│ [ ] 3. Atualizar overlay.js com novas  │ (2h)
│       abas: Consensus, Conviction,     │
│       Health, Graph Preview             │
│                                         │
│ [ ] 4. Unit tests para integração FSM   │ (1.5h)
│       ├─ Consensus votação               │
│       ├─ Conviction hesitação            │
│       └─ Health metrix                   │
│                                         │
│ TOTAL: 7h | ✅ BLOCKER RESOLVIDO        │
└─────────────────────────────────────────┘

SPRINT 2 (1.5 dias) — AUDITORIA MVP
┌─────────────────────────────────────────┐
│ [ ] 5. Criar causality-engine (1h)       │
│       └─ Timeline causal: A→B→C         │
│                                         │
│ [ ] 6. Criar breakpoint-engine (1.5h)   │
│       ├─ 15 breakpoint types            │
│       ├─ Pause + snapshot                │
│       └─ Integrar em decision.js        │
│                                         │
│ [ ] 7. Criar debug-operational.js (1h)  │
│       └─ Logs estruturados por engine   │
│                                         │
│ [ ] 8. Integration tests E2E (1h)       │
│       └─ Rodada completa auditável      │
│                                         │
│ TOTAL: 4.5h | ✅ AUDITORIA FUNCIONA     │
└─────────────────────────────────────────┘

SPRINT 3 (1 dia) — VISUALIZAÇÃO & POLISH
┌─────────────────────────────────────────┐
│ [ ] 9. Criar replay-engine (1.5h)        │
│       ├─ Replay determinístico           │
│       └─ Cinematic de rodada             │
│                                         │
│ [ ] 10. Criar debug-graph-ui.js (1.5h)  │
│        └─ Grafo visual interativo       │
│                                         │
│ [ ] 11. Refatorar overlay.js (2h)        │
│        └─ Componentes isoladas          │
│                                         │
│ [ ] 12. Stress tests (1h)                │
│        ├─ 100+ rodadas rápidas          │
│        └─ Grafo com 1000+ nós           │
│                                         │
│ TOTAL: 6h | ✅ PRODUÇÃO READY            │
└─────────────────────────────────────────┘

TOTAL CAMINHO CRÍTICO: 17.5h (4-5 dias com 1 dev)
BLOQUEADORES RESOLVIDOS: 3/3 (integração, auditoria, escalabilidade)
```

---

## 💰 ESTIMATIVA DE ESFORÇO

```
POR CATEGORIA                           HORAS   DIAS
─────────────────────────────────────────────────────
Integração FSM ↔ Engines               2.0     0.25
Criar 3 engines ausentes               3.5     0.5
Atualizar overlay.js                   2.0     0.25
Unit + Integration tests               4.0     0.5
Debug UI + Replay                      3.0     0.4
Refatoração overlay                    2.0     0.25
Docs + ADRs                           2.0     0.25
─────────────────────────────────────────────────────
TOTAL BLOQUEADORES                     18.5    2.3 dias
Mais: polimento, stress tests          6.0     0.75 dias
─────────────────────────────────────────────────────
TOTAL PARA PRODUÇÃO                   24.5    3.1 dias
                                              (1 dev)
```

---

## ✅ CHECKLIST PRÉ-PRODUÇÃO

```
ANTES DE SPRINT 1
  [ ] Confirmar prioridade: integração FSM é GO?
  [ ] Confirmar abas no overlay: quais 5?
  [ ] Confirmar 15 breakpoint types (lista)
  [ ] Confirmar logs estruturados template

APÓS SPRINT 1
  [ ] FSM wiring completo
  [ ] 4 engines chatáveis de decision.js
  [ ] Unit tests 100% P0s
  [ ] Overlay com 5 abas novas
  [ ] Sem dead code

APÓS SPRINT 2
  [ ] Causality linear testada
  [ ] Replay determinístico funciona
  [ ] Auditoria completa de 1 rodada
  [ ] Breakpoints pausam corretamente
  [ ] E2E testes verdes

APÓS SPRINT 3
  [ ] Visualização gráfica live
  [ ] Stress tests passam (100+ rodadas)
  [ ] Compliance checklist OK
  [ ] Documentação (ARCHITECTURE.md, ADRs)
  [ ] Pronto para LGC/compliance

ANTES DE LAUNCH
  [ ] Security review dos 7 engines novos
  [ ] Performance benchmark vs target
  [ ] Smoking test em staging (simulador)
  [ ] User acceptance test (operador novo)
  [ ] Compliance sign-off
```

---

**Gerado**: 2026-05-13 | **Próxima Atualização**: Pós-Sprint 1
