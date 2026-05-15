# 🚀 PLANO DE AÇÃO IMEDIATO — Sprint 1 Tarefas Específicas

**Status**: Pronto para Kickoff | **Duração**: 2 dias | **Recursos**: 1 dev full-time

---

## TAREFA 1: Integrar 4 Engines em decision.js FSM (2h)

### O Quê
Fazer `decision.js` chamar os 4 engines novos (consensus, conviction, context-health, graph) em pontos específicos do FSM.

### Onde
`betboom-extension-v2.3.1/js/decision.js`

### Como

#### 1.1 No início do arquivo (imports)
```javascript
// Adicionar após imports existentes:
const ConsensusEngine = require('./consensus-engine');
const ConvictionEngine = require('./conviction-engine');
const ContextHealthEngine = require('./context-health-engine');
const GraphEngine = require('./graph-engine');
```

#### 1.2 Na transição `OBSERVING → SIGNAL_FOUND`
```javascript
case 'SIGNAL_FOUND':
  // Chamar consensus: qual padrão venceu?
  const consensus = ConsensusEngine.resolveConsensus(
    state.candidatePatterns, 
    state.decisionHistory
  );
  state.consensusScore = consensus.agreementScore;
  state.dominantSignal = consensus.dominantSignal;
  
  // Log estruturado
  console.log('[Decision]', 'CONSENSUS_RESOLVED', {
    candidatesCount: state.candidatePatterns.length,
    consensusScore: consensus.agreementScore,
    dominantSignal: consensus.dominantSignal.id
  });
  
  // Próximo estado: avaliar contexto
  state.currentState = 'CONTEXT_EVALUATING';
  GraphEngine.setNodeRunning('SIGNAL_FOUND');
  break;

case 'CONTEXT_EVALUATING':
  // Chamar context-health: mesa boa ou ruim?
  const health = ContextHealthEngine.assessContextHealth(
    state.colorHistory,
    state.decisionHistory,
    state.currentSeries
  );
  state.contextHealth = health;
  
  console.log('[Decision]', 'CONTEXT_EVALUATED', {
    stability: health.stability,
    volatility: health.volatility,
    risk: health.riskScore
  });
  
  // Próximo estado: calcular conviction
  state.currentState = 'CONVICTION_CALCULATING';
  GraphEngine.updateMetrics('CONTEXT_EVALUATED', health);
  break;

case 'CONVICTION_CALCULATING':
  // Chamar conviction-engine: entrar ou hesitar?
  const conviction = ConvictionEngine.calculateConviction(
    state.consensusScore,
    state.contextHealth,
    state.dominantSignal
  );
  state.convictionScore = conviction.score;
  state.recommendation = conviction.recommendation; // GO | HESITATE | NO-GO
  
  console.log('[Decision]', 'CONVICTION_CALCULATED', {
    convictionScore: conviction.score,
    recommendation: conviction.recommendation,
    reasoning: conviction.reasoning
  });
  
  // Decidir se avança para EXECUTE ou volta para OBSERVING
  if (conviction.recommendation === 'GO') {
    state.currentState = 'EXECUTE_REQUESTED';
  } else if (conviction.recommendation === 'HESITATE') {
    state.currentState = 'HESITATING';
    // Aguarda X ms, então volta a OBSERVING
    setTimeout(() => { state.currentState = 'OBSERVING'; }, 5000);
    return;
  } else {
    state.currentState = 'SIGNAL_REJECTED';
    return;
  }
  GraphEngine.updateMetrics('CONVICTION_CALCULATED', conviction);
  break;

case 'EXECUTE_REQUESTED':
  // Chamar explainability: por quê?
  const explanation = ExplainabilityEngine.explain({
    patternMatched: state.dominantSignal,
    confidence: state.consensusScore,
    contextHealth: state.contextHealth,
    conviction: state.convictionScore,
    decisionHistory: state.decisionHistory
  });
  state.explanation = explanation;
  
  console.log('[Decision]', 'EXECUTE_REQUESTED', {
    pattern: state.dominantSignal.id,
    entry: state.dominantSignal.entry,
    explanation: explanation.summary
  });
  
  // Próximo: verificar segurança, depois CLICK
  state.currentState = 'SAFETY_CHECK';
  GraphEngine.setNodeRunning('EXECUTE_REQUESTED');
  break;
```

#### 1.3 Adicionar novo estado `HESITATING`
```javascript
case 'HESITATING':
  // Mostrar no overlay: "Sistema está hesitando..."
  if (state.hesitationTimeout) clearTimeout(state.hesitationTimeout);
  state.hesitationTimeout = setTimeout(() => {
    state.currentState = 'OBSERVING';
  }, 5000); // 5 segundos de hesitação
  
  console.log('[Decision]', 'HESITATING', {
    reason: state.lastRejectionReason,
    willRetry: 'in 5s'
  });
  break;
```

#### 1.4 Adicionar novo estado `SIGNAL_REJECTED`
```javascript
case 'SIGNAL_REJECTED':
  console.log('[Decision]', 'SIGNAL_REJECTED', {
    pattern: state.lastRejectedPattern.id,
    reason: 'conviction too low'
  });
  state.currentState = 'OBSERVING';
  break;
```

### Critério de Aceitação
- [ ] Todos 4 engines chamados em sequência correta
- [ ] Logs estruturados para cada transição
- [ ] Estados HESITATING e SIGNAL_REJECTED funcionam
- [ ] GraphEngine chamado em 3+ pontos críticos
- [ ] Unit test: padrão com consenso 72% + contexto verde → GO
- [ ] Unit test: padrão com consonenso 55% + contexto vermelho → HESITATE

---

## TAREFA 2: Criar Wrapper Explainability Estruturado (1.5h)

### O Quê
Garantir que `explainability-engine.js` retorna narrativa estruturada JSON que pode ser renderizada no overlay.

### Arquivo
`betboom-extension-v2.3.1/js/explainability-engine.js`

### Saída Esperada
```javascript
{
  summary: "WMSG-005 (85% confiança) + Mesa estável → ENTRADA CASA recomendada",
  rationale: [
    "Padrão WMSG-005 casado em sequência (A,A,V,V)",
    "Consenso 72% vs WMSG-009 (68%)",
    "Mesa estável (volatilidade: 0.35, drift: 0.12)",
    "Conviction score: 0.78 (GO)"
  ],
  alternatives: [
    { pattern: "WMSG-009", consensus: 68%, why: "Diagonal fraca" }
  ],
  riskFactors: [
    "Histórico curto (10 rodadas apenas)"
  ],
  confidence: 0.85
}
```

### Checklist
- [ ] Função `explain()` retorna JSON estruturado
- [ ] Campo `summary` < 200 chars, legível operador
- [ ] Campo `rationale` lista 3-5 razões com números
- [ ] Campo `alternatives` mostra por quê outros padrões perderam
- [ ] Campo `riskFactors` lista preocupações (histórico curto, mesa instável, etc)
- [ ] Tudo é auditável (não há "magic" sem explicação)

---

## TAREFA 3: Atualizar overlay.js com 5 Novas Abas (2h)

### O Quê
Adicionar novas abas ao overlay mostrando consensus, conviction, health, graph, breakpoints.

### Arquivo
`betboom-extension-v2.3.1/js/overlay.js`

### Nova Estrutura de Abas
```
[Summary] [Consensus] [Conviction] [Health] [Breakpoints] [Debug]
  ↓
- Summary: Abas existentes (saldo, últimas rodadas, logs)
- Consensus: Votação entre padrões (gráfico de barras)
- Conviction: Confiança de entrada (score, recomendação)
- Health: 8 métricas (série temporal)
- Breakpoints: Lista de pausas (se houver)
- Debug: Grafo visual (básico, sem interatividade)
```

### Código Mínimo
```javascript
// Em overlay.js, função renderOverlay():

const tabsConfig = [
  { id: 'summary', label: '📊 Summary', render: renderSummaryTab },
  { id: 'consensus', label: '🗳️ Consensus', render: renderConsensusTab },
  { id: 'conviction', label: '💪 Conviction', render: renderConvictionTab },
  { id: 'health', label: '❤️ Health', render: renderHealthTab },
  { id: 'breakpoints', label: '🔴 Breakpoints', render: renderBreakpointsTab },
  { id: 'debug', label: '🔧 Debug', render: renderDebugTab },
];

function renderConsensusTab() {
  const consensus = CurrentState.lastConsensus;
  if (!consensus) return '<p>Aguardando padrão...</p>';
  
  const bars = consensus.candidates
    .sort((a, b) => b.score - a.score)
    .map(c => `
      <div style="margin: 8px 0">
        <div>${c.pattern} <strong>${(c.score*100).toFixed(0)}%</strong></div>
        <div style="background: #eee; height: 8px; border-radius: 4px">
          <div style="background: #2196F3; width: ${c.score*100}%; height: 100%; border-radius: 4px"></div>
        </div>
      </div>
    `).join('');
  
  return `
    <h3>Votação de Padrões</h3>
    ${bars}
    <p><strong>Vencedor</strong>: ${consensus.dominant.pattern} (${(consensus.agreementScore*100).toFixed(0)}% consenso)</p>
  `;
}

function renderConvictionTab() {
  const conviction = CurrentState.lastConviction;
  if (!conviction) return '<p>Aguardando análise...</p>';
  
  const color = conviction.score > 0.7 ? '#4CAF50' : conviction.score > 0.5 ? '#FF9800' : '#f44336';
  return `
    <h3>Convicção de Entrada</h3>
    <div style="text-align: center; padding: 20px">
      <div style="font-size: 48px; color: ${color}; font-weight: bold">
        ${(conviction.score*100).toFixed(0)}%
      </div>
      <div style="font-size: 18px; margin-top: 10px; color: ${color}">
        ${conviction.recommendation}
      </div>
    </div>
    <p>${conviction.reasoning}</p>
  `;
}

function renderHealthTab() {
  const health = CurrentState.lastContextHealth;
  if (!health) return '<p>Calculando saúde...</p>';
  
  const metrics = [
    { name: 'Estabilidade', value: (health.stability*100).toFixed(0), max: 100 },
    { name: 'Volatilidade', value: (health.volatility*100).toFixed(0), max: 100 },
    { name: 'Drift', value: (health.drift*100).toFixed(0), max: 100 },
    { name: 'Entropia', value: (health.entropy*100).toFixed(0), max: 100 },
  ];
  
  return '<h3>Saúde da Mesa</h3>' + metrics.map(m => `
    <div style="margin: 8px 0">
      <div>${m.name}: <strong>${m.value}</strong></div>
      <div style="background: #eee; height: 6px; border-radius: 3px">
        <div style="background: ${m.value > 70 ? '#4CAF50' : m.value > 50 ? '#FF9800' : '#f44336'}; 
                    width: ${m.value}%; height: 100%; border-radius: 3px"></div>
      </div>
    </div>
  `).join('');
}

// Similares para renderBreakpointsTab, renderDebugTab
```

### Checklist
- [ ] 5 abas são tabs (clicáveis, não acopladas)
- [ ] Cada aba é componente isolado < 300 LOC
- [ ] Dados vêm de `CurrentState` (não direto de engines)
- [ ] Styling consistente (cores, font, padding)
- [ ] Sem valores hardcoded (tudo vem do state)
- [ ] Mobile-responsive (sidebar 36px collapsed)

---

## TAREFA 4: Unit Tests para Integração FSM (1.5h)

### Arquivo
`betboom-extension-v2.3.1/js/test-decision-integration.js`

### Testes Mínimos

```javascript
describe('Decision FSM with Engines', () => {
  
  test('Consensus: WMSG-005 (85%) bate WMSG-009 (70%)', () => {
    const candidates = [
      { id: 'WMSG-005', confidence: 0.85, type: 'seq' },
      { id: 'WMSG-009', confidence: 0.70, type: 'diag' }
    ];
    const result = ConsensusEngine.resolveConsensus(candidates);
    
    expect(result.dominantSignal.id).toBe('WMSG-005');
    expect(result.agreementScore).toBeGreaterThan(0.70);
  });
  
  test('Conviction: Consenso 72% + Contexto Verde → GO', () => {
    const conviction = ConvictionEngine.calculateConviction(
      consensusScore = 0.72,
      contextHealth = { stability: 0.85, volatility: 0.2, drift: 0.1 },
      dominantSignal = { entry: 'CASA' }
    );
    
    expect(conviction.recommendation).toBe('GO');
    expect(conviction.score).toBeGreaterThan(0.65);
  });
  
  test('Conviction: Consenso 55% + Contexto Vermelho → HESITATE', () => {
    const conviction = ConvictionEngine.calculateConviction(
      0.55,
      { stability: 0.4, volatility: 0.8, drift: 0.6 },
      { entry: 'FORA' }
    );
    
    expect(conviction.recommendation).toBe('HESITATE');
    expect(conviction.score).toBeLessThan(0.60);
  });
  
  test('Explainability: Narrativa estruturada gerada', () => {
    const explanation = ExplainabilityEngine.explain({
      patternMatched: { id: 'WMSG-005', entry: 'CASA' },
      confidence: 0.85,
      contextHealth: { stability: 0.8 },
      conviction: 0.78,
      decisionHistory: []
    });
    
    expect(explanation.summary).toBeTruthy();
    expect(explanation.rationale.length).toBeGreaterThanOrEqual(3);
    expect(explanation.confidence).toBe(0.85);
  });
  
  test('FSM completo: OBSERVING → CONSENSUS → CONVICTION → GO → EXECUTE', () => {
    const state = {
      currentState: 'OBSERVING',
      colorHistory: [/* ... */],
      candidatePatterns: [/* ... */]
    };
    
    // Simular transições
    runFSMStep(state); // OBSERVING → SIGNAL_FOUND
    expect(state.currentState).toBe('CONTEXT_EVALUATING');
    
    runFSMStep(state); // CONTEXT_EVALUATING → CONVICTION_CALCULATING
    expect(state.currentState).toBe('CONVICTION_CALCULATING');
    
    runFSMStep(state); // CONVICTION_CALCULATING → EXECUTE_REQUESTED
    expect(state.currentState).toBe('EXECUTE_REQUESTED');
    expect(state.explanation).toBeTruthy();
  });
  
});
```

### Checklist
- [ ] 5+ testes cobrindo path feliz
- [ ] 2+ testes cobrindo edge cases (consenso baixo, contexto ruim)
- [ ] Tudo passa (npm test)
- [ ] Coverage > 80% para FSM transitions

---

## SUMMARY: Tarefas Prioritárias

| # | Tarefa | Tempo | Dependências | Status |
|---|--------|-------|--------------|--------|
| 1 | Integração FSM | 2h | decision.js, 4 engines | 🔴 Bloqueador |
| 2 | Explainability wrapper | 1.5h | explainability-engine.js | 🔴 Bloqueador |
| 3 | Novas abas overlay | 2h | Task 1 + 2 | 🟠 Importante |
| 4 | Unit tests | 1.5h | Task 1 + 2 | 🟠 Importante |

**Total**: 7h (1 dia de trabalho concentrado)

**Próxima**: Sprint 2 (causality-engine, breakpoint-engine, replay-engine)

---

**Pronto para Kickoff?** Sim, todas as tarefas estão bem-definidas e prontas para começar.
