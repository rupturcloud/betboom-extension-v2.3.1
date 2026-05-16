# Camada de Detecção Operacional — Testes de Integração

## Estado Atual (Implementação Completa)

### ✅ O Que Foi Implementado

1. **buildOperationalCandidates(valor, targetType)**
   - Encontra TODOS os candidatos no DOM
   - Avalia cada um com 9 fatores operacionais
   - Retorna array ordenado por score

2. **scoreOperationalCandidate(element, valor, targetType)**
   - 9 fatores = até 100 pontos
   - Penalidades para problemas operacionais
   - Score real reflete se pode clicar

3. **selectBestOperationalCandidate(candidates)**
   - Escolhe vencedor por score
   - Valida elementFromPoint() antes de retornar
   - Fallback para próximos candidatos se falhar

4. **shadowHover(element, options)**
   - Simula hover sem mudanças
   - Retorna sucesso/duração

5. **Debug Visual Mode**
   - `enableDebugVisualization(true)` ativa highlighting
   - Verde = aprovado, Vermelho = bloqueado
   - [OperationalCandidate] logs no console

6. **detectAndValidateClick() Atualizado**
   - Integra Operational Layer
   - Opção `useOperationalLayer: true` (default)
   - Retorna [OperationalCandidate] estruturado

7. **executor.js Atualizado**
   - Chama com `useOperationalLayer: true`
   - Bloqueia execução se canProceed === false

---

## Teste 1: Habilitação do Debug Visual

**Objetivo:** Verificar que o highlighting funciona corretamente.

```javascript
// 1. Ativar debug
InteractionIntelligence.enableDebugVisualization(true);

// 2. Executar detecção (provocará highlighting se aprovado)
const result = InteractionIntelligence.detectAndValidateClick('player', 25, {
  useOperationalLayer: true
});

// 3. Observar:
//    - Elemento APROVADO: 2px solid green border + dashed outline (3s)
//    - Elemento BLOQUEADO: 2px solid red border + dashed outline (3s)
//    - [OperationalCandidate] log no console

// 4. Desativar debug
InteractionIntelligence.enableDebugVisualization(false);
```

**Esperado:**
- ✅ Highlighting visual aparece e desaparece em 3s
- ✅ [OperationalCandidate] APPROVED ou BLOCKED no console
- ✅ Sem highlighting após `enableDebugVisualization(false)`

---

## Teste 2: Comparação Quantitativa (Candidatos Encontrados)

**Objetivo:** Validar que Operational Layer encontra e avalia múltiplos candidatos.

```javascript
// Ver TODOS os candidatos para chip 25
const candidates = InteractionIntelligence.buildOperationalCandidates(25, null);

console.log(`Total de candidatos encontrados: ${candidates.length}`);
console.table(candidates.map((c, i) => ({
  '#': i,
  'Selector': c.selector,
  'Score': c.operationalScore,
  'Visible': c.style.visibility,
  'Clickable': c.style.pointerEvents !== 'none',
  'HitTarget': c.hitValidation.isHitTarget,
  'SafeZone': c.safeZone.temperature
})));

// Selecionar vencedor
const winner = InteractionIntelligence.selectBestOperationalCandidate(candidates);
console.log('Vencedor:', {
  score: winner?.operationalScore,
  selector: winner?.selector,
  hitValid: winner?.hitValidation.isHitTarget
});
```

**Esperado:**
- ✅ candidates.length > 0
- ✅ Todos têm score 0-100
- ✅ Winner é o com maior score
- ✅ Winner.hitValidation.isHitTarget === true

---

## Teste 3: Validação elementFromPoint()

**Objetivo:** Garantir que o winner realmente receberá o clique.

```javascript
const candidates = InteractionIntelligence.buildOperationalCandidates(25, null);
const winner = InteractionIntelligence.selectBestOperationalCandidate(candidates);

if (winner) {
  const { centerX, centerY } = winner.rect;
  const elementAtPoint = document.elementFromPoint(centerX, centerY);
  
  const isActualTarget = elementAtPoint === winner.element || winner.element.contains(elementAtPoint);
  
  console.log({
    winner: winner.selector,
    rect: { centerX, centerY },
    elementAtPoint: elementAtPoint?.tagName + '#' + elementAtPoint?.id,
    isActualTarget,
    validation: isActualTarget ? '✅ PASS' : '❌ FAIL'
  });
}
```

**Esperado:**
- ✅ elementAtPoint === winner.element OU winner.element.contains(elementAtPoint)
- ✅ isActualTarget === true
- ✅ Elemento realmente receberá clique

---

## Teste 4: 9 Fatores de Scoring

**Objetivo:** Validar que todos os 9 fatores estão sendo avaliados.

```javascript
const candidates = InteractionIntelligence.buildOperationalCandidates(25, null);
const winner = InteractionIntelligence.selectBestOperationalCandidate(candidates);

if (winner) {
  const factors = {
    '1-Visibilidade': winner.style.visibility === 'visible' ? '✅' : '❌',
    '2-Clickability': winner.style.pointerEvents !== 'none' ? '✅' : '❌',
    '3-Opacity': parseFloat(winner.style.opacity) > 0.8 ? '✅' : '❌',
    '4-ZIndex': parseInt(winner.style.zIndex) >= 0 || winner.style.zIndex === 'auto' ? '✅' : '❌',
    '5-Tamanho': winner.rect.width >= 20 && winner.rect.height >= 20 ? '✅' : '❌',
    '6-NãoObscurecido': winner.hitValidation.isHitTarget ? '✅' : '❌',
    '7-ZonaSegura': winner.safeZone.isSafe ? '✅' : '❌',
    '8-ARIA': winner.aria.label || winner.aria.role ? '✅' : '⚠️',
    '9-Iframe': winner.iframe.isInMainFrame ? '✅' : '❌'
  };
  
  console.table(factors);
}
```

**Esperado:**
- ✅ Maioria dos fatores é ✅
- ✅ ARIA pode ser ⚠️ (nem sempre presente)
- ✅ Score reflete contagem de checkmarks

---

## Teste 5: Zona Segura (Safe Zone)

**Objetivo:** Validar que elementos em zona proibida são bloqueados.

```javascript
const result = InteractionIntelligence.detectAndValidateClick('player', 25, {
  useOperationalLayer: true
});

console.log({
  safeZone: result.safeZoneCheck?.safe,
  temperature: result.safeZoneCheck?.temperature,
  centerX: result.safeZoneCheck?.centerX,
  centerY: result.safeZoneCheck?.centerY,
  approved: result.finalDecision === 'approved'
});

// Se temperature === 0 (FORBIDDEN):
if (result.safeZoneCheck?.temperature === 0) {
  console.log('⚠️ ESPERADO: Elemento em zona proibida, deve bloquear');
}
```

**Esperado:**
- ✅ Temperature entre 0-100
- ✅ Se temp=0: canProceed=false
- ✅ decisionReason inclui "forbidden zone"

---

## Teste 6: Shadow Hover

**Objetivo:** Testar simulação de hover sem mudanças de estado.

```javascript
const candidates = InteractionIntelligence.buildOperationalCandidates(25, null);
const winner = InteractionIntelligence.selectBestOperationalCandidate(candidates);

if (winner?.element) {
  const hoverResult = InteractionIntelligence.shadowHover(winner.element);
  
  console.log({
    success: hoverResult.success,
    reason: hoverResult.reason,
    duration: hoverResult.duration + 'ms'
  });
}
```

**Esperado:**
- ✅ hoverResult.success === true
- ✅ hoverResult.duration > 0
- ✅ Nenhuma mudança visual ou de estado

---

## Teste 7: Histórico de Candidatos

**Objetivo:** Validar que histórico é mantido corretamente.

```javascript
// Executar detecção 3 vezes
for (let i = 0; i < 3; i++) {
  InteractionIntelligence.detectAndValidateClick('player', 25, {
    useOperationalLayer: true
  });
  await new Promise(r => setTimeout(r, 100));
}

// Ver histórico
const history = InteractionIntelligence.getOperationalCandidateHistory(10);

console.log(`Histórico: ${history.length} entradas`);
console.table(history.map(h => ({
  valor: h.valor,
  target: h.targetType,
  encontrados: h.candidatesFound,
  topScore: h.topCandidates[0]?.score
})));
```

**Esperado:**
- ✅ history.length >= 3
- ✅ Cada entrada tem candidatesFound
- ✅ Top candidates ordenados por score

---

## Teste 8: Comparação Before/After (Precisão)

**Objetivo:** Validar que Operational Layer é mais preciso que método antigo.

```javascript
// Teste 1: Sem Operational Layer
const resultOld = InteractionIntelligence.detectAndValidateClick('player', 25, {
  useOperationalLayer: false
});

// Teste 2: Com Operational Layer
const resultNew = InteractionIntelligence.detectAndValidateClick('player', 25, {
  useOperationalLayer: true
});

const comparison = {
  SEM_Operational: {
    approved: resultOld.finalDecision === 'approved',
    canProceed: resultOld.canProceed,
    confidence: resultOld.chipConfidence
  },
  COM_Operational: {
    approved: resultNew.finalDecision === 'approved',
    canProceed: resultNew.canProceed,
    score: resultNew.chipOperationalScore
  },
  diferenca: {
    resultadoMudou: resultOld.finalDecision !== resultNew.finalDecision,
    maiorValidacao: resultNew.operationalCandidateData ? 'sim' : 'não'
  }
};

console.table(comparison);
```

**Esperado:**
- ✅ COM_Operational tem mais dados (operationalCandidateData)
- ✅ Score (0-100) é mais preciso que confidence (padrão)
- ✅ Se resultado mudou, COM_Operational é mais conservador (bloqueia mais)

---

## Teste 9: Operação Integrada (Executor)

**Objetivo:** Validar fluxo completo desde decisão até execução.

```javascript
// Simular uma decisão
const decisao = {
  deveApostar: true,
  cor: 'player',
  stake: 25,
  padrao: { nome: 'teste' }
};

// Executar (será bloqueado se Operational Layer disser não)
const success = await Executor.executarAposta(decisao);

// Verificar meta
const meta = Executor.getLastExecutionMeta();

console.log({
  success,
  statusExecucao: meta.statusExecucao,
  interactionLog: meta.interactionLog?.canProceed ? '✅ Aprovado' : '❌ Bloqueado',
  razoesBloqueio: meta.interactionLog?.decisionReason
});
```

**Esperado:**
- ✅ Se interactionLog.canProceed === false: statusExecucao === 'bloqueada-ii'
- ✅ Se interactionLog.canProceed === true: clique será executado
- ✅ Meta contém interactionLog completo

---

## Teste 10: Log Output [OperationalCandidate] Format

**Objetivo:** Validar que logs seguem o padrão esperado.

```javascript
InteractionIntelligence.enableDebugVisualization(true);

const result = InteractionIntelligence.detectAndValidateClick('player', 25, {
  useOperationalLayer: true
});

// Observar console para logs como:
// [OperationalCandidate] APPROVED score=95 selector=[data-chip-value="25"] visible=visible clickable=true hitTarget=true safe=true
// ou
// [OperationalCandidate] BLOCKED reasons=...
```

**Esperado:**
- ✅ Log começa com `[OperationalCandidate]`
- ✅ Inclui APPROVED ou BLOCKED
- ✅ Score entre 0-100
- ✅ Todos os status booleanos listados

---

## Teste 11: Robustez (Elementos Ocultos/Desabilitados)

**Objetivo:** Validar que candidatos inválidos são filtrados.

```javascript
// Criar um chip e ocultá-lo
const hiddenChip = document.querySelector('[data-chip-value="25"]');
if (hiddenChip) {
  hiddenChip.style.display = 'none';
}

const candidates = InteractionIntelligence.buildOperationalCandidates(25, null);

// Nenhum candidato com display=none deve aparecer
const hasHidden = candidates.some(c => c.style.display === 'none');
console.log('Candidatos ocultos encontrados:', hasHidden ? '❌ FAIL' : '✅ PASS');

// Restaurar
if (hiddenChip) {
  hiddenChip.style.display = '';
}
```

**Esperado:**
- ✅ hasHidden === false
- ✅ Elementos com display: none, visibility: hidden, opacity < 0.1 são filtrados

---

## Teste 12: Scoring Progression (Candidatos Múltiplos)

**Objetivo:** Validar que scoring diferencia candidatos.

```javascript
const candidates = InteractionIntelligence.buildOperationalCandidates(25, null);

if (candidates.length > 1) {
  const scores = candidates.slice(0, 3).map(c => c.operationalScore);
  const isAscending = scores.every((val, i, arr) => i === 0 || val <= arr[i - 1]);
  
  console.log({
    total: candidates.length,
    top3scores: scores,
    descendingOrder: isAscending ? '✅ PASS' : '❌ FAIL'
  });
}
```

**Esperado:**
- ✅ Scores são descendentes (maior primeiro)
- ✅ Diferenças claras entre vencedor e runner-ups

---

## Checklist de Validação

- [ ] Debug visual highlighting funciona
- [ ] Múltiplos candidatos são encontrados
- [ ] elementFromPoint() validação passa
- [ ] 9 fatores são avaliados
- [ ] Safe zone bloqueia zona proibida
- [ ] Shadow hover funciona
- [ ] Histórico é mantido
- [ ] Operational Layer é mais preciso
- [ ] Integração com Executor funciona
- [ ] [OperationalCandidate] logs são corretos
- [ ] Elementos ocultos/desabilitados são filtrados
- [ ] Scoring diferencia candidatos

---

## Debugging Avançado

### Log Completo de Um Candidato

```javascript
const candidates = InteractionIntelligence.buildOperationalCandidates(25, null);
if (candidates.length > 0) {
  const best = candidates[0];
  console.log('Melhor candidato (completo):', best);
}
```

### Ver Parent Chain

```javascript
const candidates = InteractionIntelligence.buildOperationalCandidates(25, null);
if (candidates.length > 0) {
  console.log('Parent chain:', candidates[0].parentChain);
}
```

### Validar Sem Operational Layer

```javascript
// Se resultado com Operational Layer for diferente, comparar:
const oldWay = InteractionIntelligence.detectAndValidateClick('player', 25, {
  useOperationalLayer: false
});
const newWay = InteractionIntelligence.detectAndValidateClick('player', 25, {
  useOperationalLayer: true
});

console.log('Diferença de resultado:', oldWay.finalDecision, '→', newWay.finalDecision);
```

---

## Próximas Etapas

1. **Teste em Live BetBoom**: Validar com site real
2. **Breakpoint Engine**: Pausar em pontos de decisão
3. **Operator Cognition**: Modelar comportamento humano
4. **Integration Testing**: Todos os engines juntos
