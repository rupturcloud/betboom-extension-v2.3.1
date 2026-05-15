# Interaction Intelligence Layer — Testing & Documentation

## Overview

A Interaction Intelligence Layer é uma camada de validação inteligente que:
1. Detecta chip (elemento de ficha) com confidence score
2. Detecta alvo (Player/Banker/Tie) com confidence score
3. Valida ownership de iframe
4. Valida safe zones
5. Executa shadow click (teste sem efeito)
6. Gera logs estruturados
7. Bloqueia clique se confidence < threshold

## Arquivos Modificados

### 1. `js/interaction-intelligence.js`
- **Novas funções**: 
  - `detectChipElement(valor)` — Detecta ficha com scoring de confiança
  - `detectTargetElement(targetType)` — Detecta Player/Banker/Tie com scoring
  - `validateIframeOwnership(element)` — Valida se está no iframe correto
  - `detectAndValidateClick(targetType, valor, options)` — Orquestra todo o fluxo

- **Estratégias de detecção de chip**:
  - `[data-chip-value]` attribute match (confidence: 95)
  - Classe com chip + valor no texto (confidence: 75)
  - `[data-valor]` attribute match (confidence: 85)

- **Estratégias de detecção de alvo**:
  - `[data-target]` / `[data-color]` attribute match (confidence: 90)
  - Classe + texto pattern match (confidence: 70)

### 2. `js/executor.js`
- **Linha ~317**: Integração de `InteractionIntelligence.detectAndValidateClick()`
- Novo campo em `lastExecutionMeta`: `interactionLog` com resultado completo
- Execução bloqueada se `canProceed === false`

### 3. `js/decision.js`
- **Integração FSM**: Chamada a `FSMIntegration.executarFluxoCompleto()` no decisor principal
- **Snapshot registration**: `ReplayEngine.registrarSnapshot()` após decisão
- **Resultado registration**: Atualização do FSM com resultado final

## Testing no Console

### Test 1: Detectar Chip Isoladamente
```javascript
// Verificar estrutura de um chip
const chip = InteractionIntelligence.detectChipElement(5);
console.log('Chip detectado:', chip);
// Esperado:
// {
//   element: <HTMLElement>,
//   selector: "[data-chip-value=\"5\"]",
//   source: "data-chip-value",
//   confidence: 95,
//   reason: "Exact match on data-chip-value attribute"
// }
```

### Test 2: Detectar Alvo Isoladamente
```javascript
// Detectar botão Player
const target = InteractionIntelligence.detectTargetElement('player');
console.log('Alvo detectado:', target);
// Esperado:
// {
//   element: <HTMLElement>,
//   selector: "[data-target=\"player\"]",
//   source: "data-attribute",
//   confidence: 90,
//   reason: "Target matched on data-target/data-color: player"
// }
```

### Test 3: Fluxo Completo (detectAndValidateClick)
```javascript
// Testar o fluxo completo de detecção
const result = InteractionIntelligence.detectAndValidateClick('player', 25, {
  confidenceThreshold: 70,
  shadowClick: true
});

console.log(result);
// Resultado esperado:
// {
//   traceId: "interaction-1715586234567-abc123de",
//   timestamp: 1715586234567,
//   targetType: "player",
//   valor: 25,
//   chipDetected: true,           // Se chip foi detectado
//   targetDetected: true,         // Se alvo foi detectado
//   chipConfidence: 95,           // Confiança do chip
//   targetConfidence: 90,         // Confiança do alvo
//   chipElement: {
//     selector: "[data-chip-value=\"25\"]",
//     source: "data-chip-value",
//     confidence: 95,
//     reason: "Exact match on data-chip-value attribute"
//   },
//   targetElement: {
//     selector: "[data-target=\"player\"]",
//     source: "data-attribute",
//     confidence: 90,
//     reason: "Target matched on data-target/data-color: player"
//   },
//   iframeValidation: {
//     valid: true,
//     reason: "Element ownership valid",
//     frame: "main",
//     frameUrl: "https://betboom.com/..."
//   },
//   safeZoneCheck: {
//     safe: true,
//     temperature: 100,           // HOT=100, WARM=70, COLD=30, FORBIDDEN=0
//     centerX: 512,
//     centerY: 384
//   },
//   shadowClickResult: {
//     success: true,
//     reason: "Ready to click",
//     duration: 12,               // ms
//     validation: { /* ... */ }
//   },
//   finalDecision: "approved",    // "approved" ou "blocked"
//   decisionReason: [],           // Lista de razões se bloqueado
//   canProceed: true              // true = clique pode ser executado
// }
```

### Test 4: Monitorar Execução Real
```javascript
// Monitorar um clique real através do log do executor
// A mensagem será logada no console com toda a estrutura de interação

// Depois que uma aposta for executada, verificar:
const meta = Executor.getLastExecutionMeta();
console.log('Interaction Log:', meta.interactionLog);
```

## Expected Log Output

Quando uma aposta é executada, você verá no console:

```
[Interaction Intelligence] {
  "traceId":"interaction-1715586234567-abc123de",
  "timestamp":1715586234567,
  "targetType":"player",
  "valor":25,
  "chipDetected":true,
  "targetDetected":true,
  "chipConfidence":95,
  "targetConfidence":90,
  "chipElement":{
    "selector":"[data-chip-value=\"25\"]",
    "source":"data-chip-value",
    "confidence":95,
    "reason":"Exact match on data-chip-value attribute"
  },
  "targetElement":{
    "selector":"[data-target=\"player\"]",
    "source":"data-attribute",
    "confidence":90,
    "reason":"Target matched on data-target/data-color: player"
  },
  "iframeValidation":{
    "valid":true,
    "reason":"Element ownership valid",
    "frame":"main",
    "frameUrl":"https://br.betboom.com/..."
  },
  "safeZoneCheck":{
    "safe":true,
    "temperature":100,
    "centerX":512,
    "centerY":384
  },
  "shadowClickResult":{
    "success":true,
    "reason":"Ready to click",
    "duration":8
  },
  "finalDecision":"approved",
  "decisionReason":[],
  "canProceed":true
}
```

## Failure Scenarios

### Scenario 1: Chip não detectado
```javascript
// Se nenhuma ficha foi encontrada com confidence >= 70
{
  chipDetected: false,
  chipConfidence: 0,
  finalDecision: "blocked",
  decisionReason: ["Chip not detected with sufficient confidence"],
  canProceed: false
}
```

### Scenario 2: Alvo em zona proibida
```javascript
// Se o alvo está perto da borda (zona FORBIDDEN)
{
  targetDetected: true,
  targetConfidence: 70,
  safeZoneCheck: {
    safe: false,
    temperature: 0  // FORBIDDEN
  },
  finalDecision: "blocked",
  decisionReason: ["Target in forbidden zone (temperature: 0)"],
  canProceed: false
}
```

### Scenario 3: Fallback element (baixa confiança)
```javascript
// Se usou fallback genérico, confiança será reduzida
{
  chipDetected: true,
  chipConfidence: 45,  // Abaixo do threshold
  finalDecision: "blocked",
  decisionReason: ["Chip confidence 45 < threshold 70"],
  canProceed: false
}
```

## Flow Before vs After

### ANTES (sem Interaction Intelligence)
```
decidirEntrada()
  ↓
encontrarElemento(seletor genérico)
  ↓
clicarElemento(btnCor)
  ↓
❌ Sem validação de origem
❌ Sem validação de confiança
❌ Sem shadow click
❌ Log não estruturado
```

### DEPOIS (com Interaction Intelligence)
```
executarAposta(decisao)
  ↓
InteractionIntelligence.detectAndValidateClick()
  ├─ detectChipElement() → 95% confidence
  ├─ detectTargetElement() → 90% confidence
  ├─ validateIframeOwnership() → ✓ VALID
  ├─ isClickSafe() → HOT zone (100)
  ├─ shadowClick() → SUCCESS (no side effects)
  └─ ✓ CAN PROCEED
  ↓
definirStake() → Click no chip
  ↓
clicarElemento(btnCor) → Click no alvo
  ↓
✅ Log estruturado com traceId
✅ Auditável e rastreável
```

## Configuration

### Confidence Threshold
Default: **70%**
- Acima de 70: APROVADO
- Entre 50-70: FALLBACK (considera como candidato baixa confiança)
- Abaixo de 50: REJEITADO

### Safe Zones Temperatures
- **HOT (100)**: Centro da tela (0-30% de distância do centro)
- **WARM (70)**: Área intermediária (30-60% de distância)
- **COLD (30)**: Perto das bordas (>60% de distância)
- **FORBIDDEN (0)**: <100px das extremidades

## Logging Integration

### Estrutura de Log para Auditoria
Cada interação registra:
```json
{
  "traceId": "interaction-{timestamp}-{random}",
  "timestamp": 1715586234567,
  "targetType": "player|banker|tie",
  "valor": 25,
  "chipDetected": true,
  "targetDetected": true,
  "chipConfidence": 95,
  "targetConfidence": 90,
  "chipElement": {/* estratégia usada */},
  "targetElement": {/* estratégia usada */},
  "iframeValidation": {/* resultado */},
  "safeZoneCheck": {/* temperatura e posição */},
  "shadowClickResult": {/* resultado do teste */},
  "finalDecision": "approved|blocked",
  "decisionReason": [/* lista de problemas se bloqueado */],
  "canProceed": true
}
```

## Debugging

### Ver todas as fichas detectadas
```javascript
InteractionIntelligence.detectChipElement(25) // retorna melhor candidato
```

### Ver histórico de interações
```javascript
const history = InteractionIntelligence.getInteractionHistory(50);
console.table(history);
```

### Ver conformidade de DOM
```javascript
const drift = InteractionIntelligence.detectDrift('[data-chip-value="25"]');
console.log('Mudanças no elemento:', drift);
```

### Ver zonas seguras
```javascript
const zones = InteractionIntelligence.getSafeZones();
console.log('Grades de segurança:', zones.length, 'zonas');
```

## Próximos Passos

1. **Integração com Breakpoint Engine**: Pausar execução em breakpoints específicos
2. **Operator Cognition Engine**: Modelar comportamento humano
3. **Causality Engine**: Rastreamento de causas de falhas
4. **Explainability Engine**: Gerar explicações em linguagem natural

## Referências

- `InteractionIntelligence.detectChipElement()` — Detectar chip
- `InteractionIntelligence.detectTargetElement()` — Detectar alvo
- `InteractionIntelligence.validateIframeOwnership()` — Validar frame
- `InteractionIntelligence.detectAndValidateClick()` — Orquestração completa
