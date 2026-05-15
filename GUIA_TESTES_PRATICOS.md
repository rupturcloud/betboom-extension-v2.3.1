# 🧪 Guia de Testes Práticos — v2.3.1 WMSG

**Data**: 2026-05-13  
**Versão**: 2.3.1 (18 Padrões WMSG)  
**Status**: Pronto para fase de testes manuais extended

---

## 📋 Índice

1. [Teste 1: Validar Padrões (HTML)](#teste-1-validar-padrões-html)
2. [Teste 2: Carregar Extensão em Chrome](#teste-2-carregar-extensão-em-chrome)
3. [Teste 3: Validação de Click Real](#teste-3-validação-de-click-real)
4. [Teste 4: Teste de Gale (Martingale)](#teste-4-teste-de-gale-martingale)
5. [Teste 5: Teste em Produção (BetBoom Real)](#teste-5-teste-em-produção-betboom-real)
6. [Troubleshooting](#troubleshooting)

---

## Teste 1: Validar Padrões (HTML)

**Objetivo**: Verificar que os 18 padrões WMSG carregam corretamente e matching funciona.

### Passo 1: Abrir arquivo de teste

```bash
cd /Users/diego/dev/hitl/betboom-extension-v2.3.1/betboom-extension-v2.3.1
open test-wmsg-patterns.html
```

Ou arraste `test-wmsg-patterns.html` para a janela de um navegador (Chrome recomendado).

### Passo 2: Verificar resultado esperado

Deve aparecer na página:

```
✅ 18 padrões WMSG carregados
Total de estratégias: 36 (18 WMSG + 18 nativos)

Padrões Exibidos (primeiros 6):
├─ WMSG-001 → [A,A,A,V] → Entrar: FORA
├─ WMSG-002 → [V,V,V,A] → Entrar: CASA
├─ WMSG-003 → [A,V,A,V] → Entrar: CASA
├─ WMSG-004 → [V,A,V,A] → Entrar: FORA
├─ WMSG-005 → [A,A,V,V] → Entrar: CASA
└─ WMSG-006 → [V,V,A,A] → Entrar: FORA

Testes de Sequência Exata:
✅ PASS WMSG-001: Esperado=vermelho, Obtido=vermelho, Confiança=85%
✅ PASS WMSG-002: Esperado=azul, Obtido=azul, Confiança=85%
✅ PASS WMSG-003: Esperado=azul, Obtido=azul, Confiança=85%
✅ PASS WMSG-005: Esperado=azul, Obtido=azul, Confiança=85%
✅ PASS WMSG-018: Esperado=azul, Obtido=azul, Confiança=85%

Resumo:
✅ Testes passados: 5
Testes falhados: 0
Taxa de sucesso: 100%
```

### ✅ Critério de Sucesso

- [x] 18 padrões carregados
- [x] 5/5 testes passam
- [x] Taxa de sucesso 100%
- [x] Nenhum console error crítico (DevTools → Console)

**Status**: ✅ PASSOU se todos os critérios acima confirmados

---

## Teste 2: Carregar Extensão em Chrome

**Objetivo**: Validar que a extensão carrega sem erros e pode ser ativada.

### Passo 1: Abrir chrome://extensions/

```
chrome://extensions/
```

### Passo 2: Ativar Modo de Desenvolvedor

Canto superior direito → Toggle "Modo de desenvolvedor"

### Passo 3: Carregar extensão não compactada

1. Clique em "Carregar extensão não compactada"
2. Navegue até: `/Users/diego/dev/hitl/betboom-extension-v2.3.1/betboom-extension-v2.3.1/`
3. Clique em "Selecionar Pasta"

### Passo 4: Verificar carregamento

Procure:
```
✅ BetBoom Auto Pattern — v2.3.1
   Habilitada
```

Se houver ⚠️ ou ❌ errors:
- Clique em "detalhes"
- Veja a seção "Erros"
- Consulte [Troubleshooting](#troubleshooting)

### Passo 5: Abrir painel de desenvolvimento

DevTools (F12) → Guia "Extensions" (se visível) ou "Console"

Procure por log:
```
[PatternEngine] ✓ Padrões carregados: WMSG-001..018 + 18 nativos = 36 total
```

### ✅ Critério de Sucesso

- [x] Extensão está "Habilitada" (verde)
- [x] Sem erros na seção de detalhes
- [x] Console não mostra "Uncaught" errors
- [x] Log de padrões carregados aparece

**Status**: ✅ PASSOU se todos os critérios acima confirmados

---

## Teste 3: Validação de Click Real

**Objetivo**: Verificar que clicks verdadeiros funcionam e fichas são detectadas.

### Passo 1: Ir para BetBoom Bac Bo

1. Navegue até `betboom.com` (ou teste local)
2. Abra jogo "Bac Bo" ou compatível
3. DevTools aberto (F12)

### Passo 2: Ativar extensão

1. Clique no ícone da extensão (canto superior direito, "BetBoom Auto Pattern")
2. Clique em "Ligar" (ou toggle ON)
3. Sidebar deve aparecer no lado esquerdo

### Passo 3: Esperar detecção de fichas

Na sidebar, procure:
```
🎮 Status: Aguardando...
```

Aguarde ~10 segundos. Se mudar para:
```
📊 Detectadas: 45 fichas azuis, 38 vermelho, 2 empate
```

✅ Fichas foram encontradas

### Passo 4: Simular aposta (observar, não clicar)

1. No tabuleiro visual (sidebar), deve aparecer grid de cores (azul/vermelho/amarelo)
2. Próxima ação deve mostrar: `Aguardando padrão...`
3. Na aba DevTools → Console, deve haver logs:

```
[Collector] Histórico: [azul, vermelho, azul, vermelho, ...]
[PatternEngine] Padrões detectados: WMSG-003 (Zigue-zague)
[F1Scorer] Confiança: 85% (sequencial)
[Executor] Pronto para click em CASA
```

### ✅ Critério de Sucesso

- [x] Extensão responde ao "Ligar"
- [x] Fichas são detectadas
- [x] Histórico aparece no console
- [x] Padrão é detectado quando deveria
- [x] Logs detalhados no console

**Status**: ✅ PASSOU se todos os critérios acima confirmados

---

## Teste 4: Teste de Gale (Martingale)

**Objetivo**: Validar que o sistema de Gale funciona após loss.

### Passo 1: Configurar Gale no painel

1. Sidebar → Aba "⚙️ Configuração"
2. Stake base: `5.00`
3. Gale: Ativar (checkbox)
4. Limite Gale: `3` (até G3)
5. Stop Win: `50.00`
6. Stop Loss: `-150.00`

### Passo 2: Aguardar 5 ciclos completos

- **Ciclo 1**: Aposta `5.00` → Perde
- **Ciclo 2 (G1)**: Aposta `10.00` (dobrada) → Perda (mais uma vez)
- **Ciclo 3 (G2)**: Aposta `20.00` (dobrada) → Perda
- **Ciclo 4 (G3)**: Aposta `40.00` (dobrada) → Ganha `80.00` (cobre 3 losses + lucro)
- **Ciclo 5**: Aposta `5.00` (reset) → Continua

### Passo 3: Verificar histórico

No painel, seção "📊 Últimos Resultados":
```
Rodada 100: CASA (A) — Gale 3 — R$ 40.00 → ✅ WIN (+80.00)
Rodada 99: FORA (V) — Gale 2 — R$ 20.00 → ❌ LOSS (-20.00)
Rodada 98: FORA (V) — Gale 1 — R$ 10.00 → ❌ LOSS (-10.00)
Rodada 97: CASA (A) — Gale 0 — R$ 5.00 → ❌ LOSS (-5.00)
Rodada 96: FORA (V) — Gale 0 — R$ 5.00 → ✅ WIN (+5.00)
```

DevTools → Console:
```
[Bankroll] G0 → Stake: 5.00
[Bankroll] G1 (após loss) → Stake: 10.00
[Bankroll] G2 (após loss) → Stake: 20.00
[Bankroll] G3 (após loss) → Stake: 40.00
[Bankroll] Após WIN → Reset para G0, Stake: 5.00
```

### ✅ Critério de Sucesso

- [x] Gale progride corretamente (5 → 10 → 20 → 40)
- [x] Reset acontece após win
- [x] Histórico mostra Gale level correto
- [x] Saldo reflete gains/losses corretamente
- [x] Sem "stack overflow" (limite de Gale respeitado)

**Status**: ✅ PASSOU se todos os critérios acima confirmados

---

## Teste 5: Teste em Produção (BetBoom Real)

**Objetivo**: Validação completa com dinheiro real (ou saldo de teste).

### ⚠️ Precauções Importantes

```
⚠️ NÃO use valores reais até ter 100% confiança
⚠️ Sempre use Stop Loss configurado
⚠️ Comece com Stake MÍNIMO (ex: R$ 1.00)
⚠️ Observe por 20+ rodadas antes de aumentar stake
⚠️ Se algo estranho acontecer: desative imediatamente
```

### Passo 1: Configuração Conservadora

```
Stake Base:        R$ 1.00
Gale Ativado:      SIM
Limite Gale:       G2 (não G3)
Stop Win:          R$ 20.00 (20 unidades de lucro)
Stop Loss:         -R$ 50.00 (5 perdas máximas)
Proteção Empate:   SIM
Min. Confiança:    80%
```

### Passo 2: Rodar 50 rodadas observando

1. Abra BetBoom Bac Bo
2. Ative extensão com config acima
3. Deixe rodar de forma contínua por ~50 rodadas
4. Monitore em tempo real:
   - Padrões detectados
   - Click confirmados
   - Wins/Losses
   - Progression de Gale

### Passo 3: Coletar métricas

Ao fim das 50 rodadas, copie do painel:

```
📊 Sessão Atual:
├─ Rodadas completadas: 50
├─ Entradas totais: 45 (algo não entrou por min. confiança)
├─ Wins: 28
├─ Losses: 17
├─ Taxa de acerto: 28/45 = 62.2%
├─ Saldo inicial: R$ 1000.00
├─ Saldo final: R$ 1230.50
└─ Lucro líquido: +R$ 230.50

🎯 Performance por padrão:
├─ WMSG-001: 3 entradas, 2 wins, 1 loss (67%)
├─ WMSG-002: 4 entradas, 3 wins, 1 loss (75%)
├─ WMSG-003: 5 entradas, 4 wins, 1 loss (80%)
...
```

### Passo 4: Validar Safety Governance

No console, procure por:
```
[Safety] Circuit breaker: OK
[Safety] Rate limit: 8/10 ops/min
[Safety] Risk validation: OK (2.3% da banca)
```

Não deve conter:
```
❌ Circuit breaker ABERTO
❌ Rate limit EXCEDIDO
❌ Risk CRÍTICO
```

### ✅ Critério de Sucesso

Para considerar fase de validação bem-sucedida:

- [x] 50 rodadas completadas sem crash
- [x] Taxa de acerto >= 55% (objetivo: 60%+)
- [x] Lucro ou pequena margem (sem grandes perdas)
- [x] Safety governance funcionando
- [x] Gale executado corretamente (quando applicable)
- [x] Stop Win/Loss respeitados
- [x] Nenhum erro não tratado no console

**Status**: ✅ PASSOU se 5+ critérios acima confirmados

---

## Troubleshooting

### Problema: "Padrão não detectado"

**Diagnóstico**:
1. DevTools → Console → buscar `[PatternEngine]`
2. Verificar log:
   ```
   [PatternEngine] Histórico: [azul, vermelho, azul, ...]
   [PatternEngine] Nenhum padrão casou nos 36 candidatos
   ```

**Solução**:
- Verifique se histórico tem pelo menos 4 casas
- Aumente "Min. Confiança" no painel para 75% (pode estar muito alto em 85%)
- Valide tabuleiro visual mostra cores corretas

---

### Problema: "Click não confirmado"

**Diagnóstico**:
1. DevTools → Elements (aba)
2. Procure por `<div class="chip">` ou `<span class="ficha">`
3. Se não encontrar: fichas não estão no DOM

**Solução**:
- Feche jogo, abra novamente
- Recarregue página (F5)
- Desative/reative extensão
- Verifique se jogo está carregado

---

### Problema: "Extensão travada"

**Diagnóstico**:
1. Clique na extensão → verificar status bar
2. DevTools → Console → procurar por `Uncaught` errors
3. Verifique se há loop infinito

**Solução**:
1. Desative extensão (toggle OFF)
2. Aguarde 3 segundos
3. Reative (toggle ON)
4. Se persistir, recarregue página ou feche/abra aba

---

### Problema: "Mensagem de erro no console"

**Leitura de erro**:

```javascript
// ✅ IGNORAR (avisos, não erros)
[PatternEngine] Padrão WMSG-007 não casou (log informativo)
[Safety] Rate limit atingido (limite de proteção, normal)

// ⚠️ IMPORTANTE (avisos que afetam função)
[Collector] Histórico vazio (esperado no início)
[Executor] Click falhou (pode ter fichas não detectadas)

// ❌ CRÍTICO (parar e reportar)
Uncaught TypeError: ... (erro de código)
Uncaught ReferenceError: ... (variável indefinida)
Failed to fetch (erro de rede)
```

---

### Problema: "Saldo não está atualizando"

**Diagnóstico**:
1. DevTools → Console → buscar `[Bankroll]`
2. Verificar se há:
   ```
   [Bankroll] Saldo anterior: 1000
   [Bankroll] Aposta confirmada: -5
   [Bankroll] Saldo novo: 995
   ```

**Solução**:
- Saldo inicial pode estar incorreto (configure manualmente)
- Clique em "Resetar Saldo" no painel
- Verifique se resultado da aposta foi detectado (Win/Loss/Draw)

---

## 📞 Contacto & Suporte

Se algo não funcionar conforme esperado:

1. **Coleta de informações**:
   - DevTools Console: copiar últimos 50 linhas de log
   - Descrição do problema: o que tentou, o que esperava
   - Status: qual teste falhou (1-5)

2. **Próximos passos**:
   - Analise o log coletado
   - Consulte seção Troubleshooting acima
   - Se não resolver: consulte README.md para detalhes técnicos

---

**Status Geral**: ✅ Pronto para fase de testes manuais extended  
**Próximo**: Após validar Testes 1-4, proceder com Teste 5 (produção)

