# 📋 PLANO DE DESENVOLVIMENTO: Módulo de Histórico como Fonte de Verdade

**Data**: 2026-05-13  
**Versão**: 2.3.1  
**Status**: PLANEJAMENTO  
**Responsável**: Diego / Agente Dev

---

## 🎯 OBJETIVO

Reconstruir o módulo de histórico como **fonte de verdade operacional ponta a ponta**, garantindo que:

```
1 rodada real = 1 bolinha renderizada
Sem perspectiva misturada
Sem gaps, sem duplicatas, sem inversões
```

Histórico é base para: padrões, predição, F1, decisão, telemetria, relatório, replay, autoclick.

**Se o histórico estiver errado, todo o resto fica inválido.**

---

## 📊 ESCOPO

### ✅ DENTRO DO ESCOPO

**Arquivos a criar/restruturar:**
- `js/history-store.js` — Armazenamento + dedup
- `js/history-capture.js` — Captura de fontes
- `js/history-normalizer.js` — Normalização de dados
- `js/history-diff.js` — Detecção de mudanças
- `js/history-plan.js` — Runtime plan
- `js/history-graph.js` — Execution graph
- `js/history-renderer.js` — Renderização correto (1 rodada = 1 bolinha)
- `js/history-debug.js` — Ferramentas de debug
- **Atualizar**: `js/history-integrity.js` — Validação + gates
- **Atualizar**: `js/overlay.js` — Integração com novo módulo

**Funções principais:**
- Captura de WebSocket, DOM, Visual, Storage
- Normalização com contrato de dados claro
- Armazenamento com dedup por signature
- Diff loop automático
- Validação com status EMPTY|VALID|DEGRADED|INVALID
- Render com regra: `realHistory.length === bolinhas renderizadas`
- Gates para bloquear padrões/F1/autoclick se inválido
- Modos: Observação, Debug, Validação Manual, Assistido

**Validação:**
- Botão "VALIDAR HISTÓRICO" com UI completa
- Logs estruturados: `[HistoryCapture]`, `[HistoryStore]`, `[HistoryRenderDebug]`
- Comparação visual realHistory vs renderedHistory
- Relatório de integridade

---

### ❌ FORA DO ESCOPO

```
- F1 (deixa como está)
- Predição (deixa como está)
- Autoclick (deixa como está)
- Novas estratégias (deixa como está)
- Chips / Detector (deixa como está)
- Layout de botões (deixa como está)
- Padrões (só integra gates, não reescreve)
- Decision Engine (só integra gates, não reescreve)
```

---

## 📁 ARQUIVOS AFETADOS

| Arquivo | Tipo | Linhas | Motivo |
|---------|------|-------|--------|
| `js/history-capture.js` | NOVO | ~150 | Captura de WebSocket/DOM/Visual/Storage |
| `js/history-normalizer.js` | NOVO | ~120 | Normaliza dados crus para contrato |
| `js/history-store.js` | NOVO | ~180 | Armazena + dedup + merge |
| `js/history-diff.js` | NOVO | ~100 | Diff loop automático |
| `js/history-plan.js` | NOVO | ~80 | Runtime plan operacional |
| `js/history-graph.js` | NOVO | ~120 | Execution graph (nós + fluxo) |
| `js/history-renderer.js` | NOVO | ~140 | Renderiza 1 rodada = 1 bolinha |
| `js/history-debug.js` | NOVO | ~150 | UI de debug + exportar/validar |
| `js/history-integrity.js` | ATUALIZAR | ~50 linhas | Adaptar para novo contrato + gates |
| `js/overlay.js` | ATUALIZAR | ~100 linhas | Integrar captura/render/validação |
| `manifest.json` | ATUALIZAR | 5 linhas | Ordem de carregamento |

**Total**: ~1.200 linhas de novo código.

---

## ⚙️ FUNÇÕES PRINCIPAIS

### history-capture.js
```js
captureFromWebSocket(payload)
captureFromDOM()
captureFromVisual()
captureFromStorage()
emitCaptureEvent(event)
```

### history-normalizer.js
```js
normalizeRound(raw, source)
normalizeHistory(rawList, source)
mapResult(vencedor)
mapColor(cor)
generateSignature(round)
```

### history-store.js
```js
addRound(round)
addMany(rounds)
replaceSnapshot(rounds, source)
dedupe()
order()
getRealHistory()
getLastRounds(n)
getBySignature(sig)
reset()
export()
```

### history-diff.js
```js
diffHistory(prevHistory, nextHistory)
hasChanges()
```

### history-plan.js
```js
createHistoryPlan(objective)
markStepRunning(step)
markStepPassed(step)
markStepBlocked(step)
getHistoryPlan()
```

### history-graph.js
```js
createGraphNode(type, status)
markNodeRunning(nodeId)
markNodePassed(nodeId)
markNodeFailed(nodeId)
getExecutionPath()
```

### history-renderer.js
```js
renderRealHistory(container, realHistory)
renderBall(round, row, col)
getRenderedHistory()
```

### history-integrity.js (atualizado)
```js
validarIntegridade()
canUseFor(moduleName)
deveBloquearOperacoes()
getStatus()
```

---

## 🚨 RISCO

| Risco | Probabilidade | Impacto | Mitigação |
|-------|--------------|--------|-----------|
| Histórico vazio ao iniciar | ALTA | ALTO | Captura WebSocket + DOM em paralelo |
| Duplicatas de signature | MÉDIA | ALTO | Dedup por roundId + signature + timestamp |
| Reordenação temporal | MÉDIA | CRÍTICO | Order por timestamp confirmado |
| Render não corresponde ao store | ALTA | CRÍTICO | Validação com `renderedBalls === realCount` |
| Perspectiva se misturando com realHistory | MÉDIA | CRÍTICO | Separação clara + testes |
| Gates não bloqueando | BAIXA | CRÍTICO | Testes manuais de cada gate |

---

## 🔄 ORDEM DE EXECUÇÃO

### Fase 1: Fundação (1h)
```
1. Criar CONTRATO DE DADOS em history-store.js
2. Criar history-store.js básico (addRound, getRealHistory)
3. Criar history-normalizer.js
4. Criar history-capture.js stub
```

### Fase 2: Captura (1.5h)
```
5. Implementar captureFromWebSocket
6. Implementar captureFromDOM
7. Integrar em Collector.js
8. Criar [HistoryCapture] logs
```

### Fase 3: Pipeline (1h)
```
9. Criar history-diff.js
10. Criar history-plan.js
11. Criar history-graph.js
12. Testar fluxo: capture → normalize → store → diff
```

### Fase 4: Render (1.5h)
```
13. Criar history-renderer.js
14. Implementar 1 rodada = 1 bolinha
15. Validar: renderedBalls === realCount
16. Testar com 3, 6, 7, 26 rodadas
```

### Fase 5: Integridade + Gates (1h)
```
17. Atualizar history-integrity.js com novo contrato
18. Implementar canUseFor(moduleName)
19. Adicionar gates em PatternEngine, DecisionEngine, Executor
20. Criar [HistoryGate] logs
```

### Fase 6: Debug + UI (1h)
```
21. Criar history-debug.js
22. Botão "VALIDAR HISTÓRICO"
23. Mostrar Diff, Graph, Exportar, Resetar
24. Alerta EMPTY vs INVALID
```

### Fase 7: Integração (1h)
```
25. Atualizar overlay.js (integração final)
26. Atualizar manifest.json
27. Testes manuais obrigatórios (7 casos)
```

### Fase 8: Relatório + Telemetria (30min)
```
28. Adicionar relatório de história
29. Emitir eventos telemetria
30. Implementar replayHistory(traceId)
```

**Total**: ~8-10 horas.

---

## ✅ CRITÉRIOS DE ACEITE

### Críticos (OBRIGATÓRIO)
```
✅ realHistory.length === renderedBalls
✅ 1 rodada = 1 bolinha (não 6)
✅ 3 rodadas = 3 bolinhas (não 18)
✅ Sem coresReais no histórico real
✅ Sem resultado.cores no histórico real
✅ HistoryIntegrity.status nunca é 'OK' se realCount === 0
✅ HistoryIntegrity.status === 'EMPTY' para real vazio
✅ Ordem temporal preservada (rod 1, 2, 3, não reverse)
✅ Cores normalizadas: player=blue, banker=red, tie=green
✅ Botão "VALIDAR HISTÓRICO" funciona
✅ Alerta CATASTROPHIC só aparece se INVALID
✅ Gates bloqueiam padrões/F1/autoclick se INVALID
✅ Logs [HistoryCapture], [HistoryStore], [HistoryRenderDebug]
```

### Desejáveis (NICE-TO-HAVE)
```
🟡 Graph mostra path completo
🟡 Diff mostra todas as mudanças
🟡 Exportar histórico como JSON
🟡 Replay sem clicar
🟡 Telemetria emitindo eventos
```

---

## 🧪 COMO TESTAR

### Teste Manual 1: 1 rodada
```
Input: vermelho
Esperado: 🔴 (1 bolinha vermelha)
Validação: renderedBalls === 1
```

### Teste Manual 2: 4 rodadas
```
Input: vermelho, empate, azul, azul
Esperado: 🔴 🟢 🔵 🔵 (4 bolinhas)
Validação: renderedBalls === 4
```

### Teste Manual 3: 3 rodadas
```
Input: 3 rodadas qualquer
Esperado: 3 bolinhas, NÃO 18
Validação: renderedBalls === 3
```

### Teste Manual 4: 6 rodadas
```
Input: 6 rodadas
Esperado: 1 coluna com 6 bolinhas
Validação: grid-column=1, grid-row=1-6
```

### Teste Manual 5: 7 rodadas
```
Input: 7 rodadas
Esperado: 6 em col 1, 1 em col 2
Validação: renderedBalls === 7
```

### Teste Manual 6: Histórico VALID
```
Input: 47 rodadas do banco
Esperado: matchRate >= 95%, status=VALID
Validação: overlay sem alerta, operações liberadas
```

### Teste Manual 7: Histórico INVALID
```
Input: renderedBalls ≠ realHistory.length
Esperado: Alerta catastrófico vermelho
Validação: 🚨 HISTÓRICO INVÁLIDO aparece
```

---

## 🔙 ROLLBACK

Se algo quebrar:

```bash
git diff js/history-*.js js/overlay.js js/manifest.json
git checkout -- js/history-*.js
git checkout -- js/overlay.js
git checkout -- js/manifest.json
```

Restaura última versão funcional em 10 segundos.

---

## 📊 SAÍDA ESPERADA DO AGENTE

Ao final, responder com:

```
1. BLUF (Bottom Line Up Front)
2. KNOWN (O que foi feito)
3. 5 WHYs (Por quê decisões)
4. Arquivos alterados
5. Fluxo final do histórico
6. Como captura → normaliza → armazena → diffa → renderiza → valida → bloqueia
7. Como testar (7 casos manuais)
8. Logs esperados
9. Critérios atendidos
10. Riscos restantes
11. Confiança %
```

---

## 🎯 PRÓXIMO PASSO

Agente Dev deve confirmar:

```
✅ Plano entendido?
✅ Pronto para FASE 1 (Fundação)?
✅ Dúvidas ou ajustes?
```

Se sim → partir para SPEC + PATCH.

---

**Criado em**: 2026-05-13  
**Status**: AGUARDANDO CONFIRMAÇÃO
