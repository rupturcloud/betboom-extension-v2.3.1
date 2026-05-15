# Camada de Detecção Operacional — Documentação Completa

## Visão Geral

A **Camada de Detecção Operacional** substitui a abordagem genérica de "primeiro elemento encontrado" por um sistema determinístico que retorna "o elemento operacionalmente válido".

### O Problema Anterior
- Múltiplos seletores genéricos (data-chip-value, class-pattern, data-valor)
- Sem priorização operacional (qual é realmente clicável?)
- Sem validação elementFromPoint()
- Sem explicação de por que foi escolhido
- Sem debug visual

### A Solução
- **buildOperationalCandidates()**: Encontra TODOS os candidatos, valida CADA UM
- **Scoring com 9 fatores operacionais**: Visibilidade, clickability, opacity, z-index, tamanho, não-obscurecimento, zona segura, aria, iframe
- **elementFromPoint() validation**: Valida que o elemento realmente recebe o hit antes de clicar
- **shadowHover()**: Simula hover sem mudança de estado
- **Debug visual**: Highlighting em verde (aprovado) ou vermelho (bloqueado)
- **[OperationalCandidate] log**: Formato estruturado com razão completa da decisão

---

## Arquitetura

### 1. buildOperationalCandidates(valor, targetType)

Encontra todos os candidatos e os avalia operacionalmente.

**Entrada:**
- `valor`: número da ficha (ex: 25) — se undefined, busca apenas targets
- `targetType`: tipo de alvo (player/banker/tie) — se undefined, busca apenas chips

**Saída:**
Array de candidatos ordenados por operationalScore (descendente):
```javascript
{
  element: HTMLElement,
  selector: "#id or .class",
  text: "texto do elemento",
  rect: { top, left, width, height, centerX, centerY },
  style: { visibility, opacity, zIndex, pointerEvents, display },
  aria: { label, role, disabled },
  parentChain: [{tag, classes, id, depth}, ...],
  iframe: { isInMainFrame, frameUrl },
  safeZone: { temperature, isSafe },
  operationalScore: 0-100,
  hitValidation: { elementAtPoint, isHitTarget: true/false }
}
```

### 2. scoreOperationalCandidate(element, valor, targetType)

Calcula score 0-100 baseado em 9 fatores:

| Fator | Pontos | Critério |
|-------|--------|----------|
| 1. Visibilidade | 15 | rect.width > 0, rect.height > 0, visibility !== hidden, in viewport |
| 2. Clickability | 15 | pointerEvents !== none, não disabled |
| 3. Opacity | 10 | opacity > 0.8 |
| 4. Z-Index | 10 | zIndex >= 0 ou auto |
| 5. Tamanho | 15 | (chip: w>=20,h>=20) ou (target: w>=30,h>=30) |
| 6. Não Obscurecido | 15 | elementFromPoint() retorna este elemento |
| 7. Zona Segura | 10 | temperature > 0 (não proibida) |
| 8. ARIA/Acessibilidade | 5 | aria-label ou role válido |
| 9. Iframe Válido | 5 | ownership válido |
| **TOTAL** | **100** | |

**Penalidade:**
- Se hitValidation.isHitTarget === false: -25 pontos
- Se opacity < 0.1: retorna 0
- Se pointerEvents === none: retorna 0
- Se display === none: retorna 0

### 3. selectBestOperationalCandidate(candidates)

Escolhe o melhor candidato com validação final.

**Processo:**
1. Retorna o primeiro candidato (maior score)
2. Valida hitTarget com elementFromPoint()
3. Se não passar, tenta próximos candidatos (ordem de score)
4. Retorna null se nenhum passou na validação

### 4. elementFromPoint() Validation

**O que valida:**
```javascript
const elementAtPoint = document.elementFromPoint(centerX, centerY);
const isHitTarget = elementAtPoint === element || element.contains(elementAtPoint);
```

Garante que o elemento realmente receberá o clique antes de executar.

### 5. shadowHover(element, options)

Simula hover sem disparar eventos ou mudar estado.

**Saída:**
```javascript
{
  success: true,
  reason: "Hover ready",
  duration: 1.23, // ms
  rect: { top, left, width, height, ... }
}
```

---

## Fluxo Integrado em detectAndValidateClick()

```
detectAndValidateClick(targetType, valor, options)
  │
  ├─ PASSO 1: Detectar Chip
  │  ├─ Se useOperationalLayer = true:
  │  │  ├─ buildOperationalCandidates(valor, null)
  │  │  ├─ selectBestOperationalCandidate()
  │  │  └─ Validação operacional completa
  │  └─ Senão: detectChipElement() (método anterior)
  │
  ├─ PASSO 2: Detectar Alvo (similar ao chip)
  │
  ├─ PASSO 3: Validar iframe
  │
  ├─ PASSO 4: Validar Safe Zone
  │
  ├─ PASSO 5: Shadow Click
  │
  ├─ DECISÃO FINAL:
  │  ├─ Se tudo passou: approved + canProceed = true
  │  └─ Se fallhou: blocked + canProceed = false
  │
  └─ DEBUG VISUAL (se enableDebugVisualization = true):
     ├─ Highlighting verde (aprovado)
     ├─ Highlighting vermelho (bloqueado)
     └─ Console log [OperationalCandidate]
```

---

## Testing no Console

### Test 1: Listar Candidatos Brutos

```javascript
// Ver TODOS os candidatos para uma ficha de 25
const chipCandidates = InteractionIntelligence.buildOperationalCandidates(25, null);
console.table(chipCandidates.map(c => ({
  selector: c.selector,
  score: c.operationalScore,
  visible: c.style.visibility,
  clickable: c.style.pointerEvents !== 'none',
  hitTarget: c.hitValidation.isHitTarget,
  temp: c.safeZone.temperature
})));
```

### Test 2: Selecionar Melhor Candidato

```javascript
const chipCandidates = InteractionIntelligence.buildOperationalCandidates(25, null);
const bestChip = InteractionIntelligence.selectBestOperationalCandidate(chipCandidates);

console.log({
  found: !!bestChip,
  selector: bestChip?.selector,
  score: bestChip?.operationalScore,
  rect: bestChip?.rect,
  hitValid: bestChip?.hitValidation.isHitTarget
});
```

### Test 3: Detecção Completa com Operational Layer

```javascript
// Ativar debug visual
InteractionIntelligence.enableDebugVisualization(true);

// Executar detecção completa
const result = InteractionIntelligence.detectAndValidateClick('player', 25, {
  confidenceThreshold: 70,
  shadowClick: true,
  useOperationalLayer: true  // ← NOVO: usa Camada de Detecção Operacional
});

console.log({
  approved: result.finalDecision === 'approved',
  canProceed: result.canProceed,
  chipScore: result.chipOperationalScore,
  targetScore: result.targetOperationalScore,
  operationalData: result.operationalCandidateData,
  reasons: result.decisionReason
});
```

### Test 4: Ver Histórico de Candidatos Avaliados

```javascript
// Ver os últimos 10 conjuntos de candidatos avaliados
const history = InteractionIntelligence.getOperationalCandidateHistory(10);

history.forEach((entry, i) => {
  console.log(`[${i}] valor=${entry.valor} target=${entry.targetType} found=${entry.candidatesFound}`);
  console.table(entry.topCandidates); // Top 3 de cada avaliação
});
```

### Test 5: Comparação Before/After (sem vs com Operational Layer)

```javascript
// SEM Operational Layer (método anterior)
const withoutOp = InteractionIntelligence.detectAndValidateClick('player', 25, {
  useOperationalLayer: false
});

// COM Operational Layer (novo método)
const withOp = InteractionIntelligence.detectAndValidateClick('player', 25, {
  useOperationalLayer: true
});

console.log({
  without: {
    approved: withoutOp.finalDecision === 'approved',
    confidence: withoutOp.chipConfidence
  },
  with: {
    approved: withOp.finalDecision === 'approved',
    confidence: withOp.chipConfidence,
    operationalScore: withOp.chipOperationalScore
  }
});
```

---

## Expected Log Output

### Quando Aprovado

```
[OperationalCandidate] APPROVED score=92 selector=[data-chip-value="25"] visible=visible clickable=true hitTarget=true safe=true
```

### Quando Bloqueado

```
[OperationalCandidate] BLOCKED reasons=Chip confidence 45 < threshold 70, Target in forbidden zone (temperature: 0), Shadow click failed: Element would be overlapped
```

---

## Failure Scenarios

### Cenário 1: Elemento Obscurecido

```javascript
// Chip encontrado mas está coberto por overlay
{
  operationalScore: 35, // penalizado por hitTarget=false
  hitValidation: { isHitTarget: false },
  finalDecision: "blocked",
  decisionReason: ["Chip confidence 35 < threshold 75"]
}
```

### Cenário 2: Zona Proibida

```javascript
// Alvo detectado mas muito perto da borda
{
  targetOperationalScore: 60,
  safeZoneCheck: { safe: false, temperature: 0 },
  finalDecision: "blocked",
  decisionReason: ["Target in forbidden zone (temperature: 0)"]
}
```

### Cenário 3: Nenhum Candidato Válido

```javascript
// Nenhum elemento passou nas validações operacionais
{
  chipDetected: false,
  targetDetected: false,
  finalDecision: "blocked",
  decisionReason: ["Chip not detected with sufficient confidence", "Target not detected with sufficient confidence"]
}
```

---

## Debug Visual Mode

### Ativar Debug

```javascript
InteractionIntelligence.enableDebugVisualization(true);
```

### Efeito Visual

- Elemento APROVADO: **2px solid green border + dashed outline**
- Elemento BLOQUEADO: **2px solid red border + dashed outline**
- Auto-remove após 3 segundos

### Console Output

Cada detecção printa um [OperationalCandidate] log com:
- APPROVED ou BLOCKED
- score (0-100)
- selector (CSS selector do elemento)
- visibility status
- clickability status
- hitTarget validation
- safe zone status

---

## Configuration

### Padrão (detectAndValidateClick)

```javascript
const result = InteractionIntelligence.detectAndValidateClick('player', 25, {
  confidenceThreshold: 70,      // Mínimo de confiança necessária
  shadowClick: true,             // Executar validação de shadow click
  useOperationalLayer: true      // ← NOVO: usa detecção operacional (default: true)
});
```

### Threshold Operacional

- **Score >= 75**: APROVADO (operacionalmente válido)
- **Score 50-74**: FALLBACK (candidato, mas com cuidado)
- **Score < 50**: REJEITADO (operacionalmente inválido)

### Zone Temperatures (Existing)

- **HOT (100)**: Centro da tela (0-30% distância do centro)
- **WARM (70)**: Área intermediária (30-60%)
- **COLD (30)**: Perto das bordas (>60%)
- **FORBIDDEN (0)**: <100px das extremidades

---

## Integration Checklist

- [x] Função `buildOperationalCandidates()` criada
- [x] Função `scoreOperationalCandidate()` com 9 fatores implementada
- [x] Função `selectBestOperationalCandidate()` com validação elementFromPoint()
- [x] Função `shadowHover()` implementada
- [x] Debug visual com `enableDebugVisualization()` e `highlightOperationalCandidate()`
- [x] [OperationalCandidate] log format
- [x] `detectAndValidateClick()` integrado com Operational Layer
- [x] Histórico de candidatos com `getOperationalCandidateHistory()`
- [x] Return values exportados

---

## Próximos Passos

1. **Breakpoint Engine**: Pausar execução em breakpoints específicos (15 tipos)
2. **Operator Cognition Engine**: Modelar comportamento humano em detecção visual
3. **Integration Testing**: Testar todos os engines em conjunto
4. **Live Testing**: Validar em ambiente BetBoom real

---

## Referências Rápidas

```javascript
// Ativar debug
InteractionIntelligence.enableDebugVisualization(true);

// Construir candidatos para chip 25
const chipCandidates = InteractionIntelligence.buildOperationalCandidates(25, null);

// Construir candidatos para alvo 'player'
const targetCandidates = InteractionIntelligence.buildOperationalCandidates(null, 'player');

// Selecionar melhor candidato
const best = InteractionIntelligence.selectBestOperationalCandidate(chipCandidates);

// Detecção completa com Operational Layer
const result = InteractionIntelligence.detectAndValidateClick('player', 25, {
  useOperationalLayer: true
});

// Ver histórico
const history = InteractionIntelligence.getOperationalCandidateHistory(10);

// Simular hover
const hoverResult = InteractionIntelligence.shadowHover(element);
```
