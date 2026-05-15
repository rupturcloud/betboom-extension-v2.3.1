# ✅ Checklist de Testes Rápido — v2.3.1

**Data**: 2026-05-13 | **Versão**: 2.3.1 WMSG | **Status**: Aguardando testes

---

## 🧪 Teste 1: Validar Padrões (HTML)

**Tempo estimado**: 5 min | **Local**: Browser local

- [ ] Abrir `test-wmsg-patterns.html` no navegador
- [ ] Página mostra "✅ 18 padrões WMSG carregados"
- [ ] Total de estratégias: 36 (18 WMSG + 18 nativos)
- [ ] Todos os 5 testes de sequência mostram "✅ PASS"
- [ ] Taxa de sucesso: 100%
- [ ] DevTools Console: nenhum erro crítico

**Status**: ⬜ Pendente | ✅ Passou | ❌ Falhou

---

## 📦 Teste 2: Carregar em Chrome

**Tempo estimado**: 3 min | **Local**: chrome://extensions/

- [ ] Extensão aparece como "BetBoom Auto Pattern v2.3.1"
- [ ] Status: "Habilitada" (toggle verde)
- [ ] Seção de erros: vazia (sem ⚠️)
- [ ] DevTools Console mostra:
  - [ ] `[PatternEngine] ✓ Padrões carregados: ... = 36 total`
  - [ ] Nenhum "Uncaught" error
- [ ] Ícone extensão aparece no canto superior direito

**Status**: ⬜ Pendente | ✅ Passou | ❌ Falhou

---

## 🎮 Teste 3: Click Real & Fichas

**Tempo estimado**: 5 min | **Local**: BetBoom Bac Bo

- [ ] Abrir BetBoom Bac Bo (ou jogo compatível)
- [ ] Clicar ícone extensão → "Ligar"
- [ ] Sidebar aparece no lado esquerdo
- [ ] Sidebar mostra "📊 Status: Aguardando..."
- [ ] Após ~10 seg: "📊 Detectadas: XX fichas"
- [ ] Tabuleiro visual mostra grid de cores (azul/vermelho/amarelo)
- [ ] Console mostra:
  - [ ] `[Collector] Histórico: [...]`
  - [ ] `[PatternEngine] Padrões detectados: ...`
  - [ ] `[F1Scorer] Confiança: XX%`
- [ ] Nenhum "Uncaught" error no console

**Status**: ⬜ Pendente | ✅ Passou | ❌ Falhou

---

## 💰 Teste 4: Gale (Martingale)

**Tempo estimado**: 10 min | **Local**: BetBoom Bac Bo (com Gale ativado)

**Configuração prévia**:
```
Stake Base: 5.00
Gale: ✅ Ativado
Limite Gale: 3
Stop Win: 50.00
Stop Loss: -150.00
```

- [ ] Após 1º loss: Stake muda para 10.00 (dobrado)
- [ ] Após 2º loss: Stake muda para 20.00 (dobrado novamente)
- [ ] Após 3º loss: Stake muda para 40.00 (G3)
- [ ] Após WIN em qualquer Gale level: Reset para 5.00
- [ ] Histórico mostra "Gale 0", "Gale 1", "Gale 2", "Gale 3" corretamente
- [ ] Console mostra:
  - [ ] `[Bankroll] G0 → Stake: 5.00`
  - [ ] `[Bankroll] G1 (após loss) → Stake: 10.00`
  - [ ] `[Bankroll] Após WIN → Reset para G0, Stake: 5.00`
- [ ] Stop Loss é respeitado (não aposta além do limite)
- [ ] Stop Win para quando lucro >= limite

**Status**: ⬜ Pendente | ✅ Passou | ❌ Falhou

---

## 🚀 Teste 5: Produção (BetBoom Real)

**Tempo estimado**: 30-60 min | **Local**: BetBoom Bac Bo (real ou teste)

**Configuração conservadora**:
```
Stake Base: 1.00
Gale: ✅ Ativado
Limite Gale: 2 (G2)
Stop Win: 20.00
Stop Loss: -50.00
Min. Confiança: 80%
```

### Fase A: Observação (20 rodadas)

- [ ] Extensão ativada
- [ ] Observar padrões detectados
- [ ] Validar que clicks acontecem
- [ ] Verificar confirmação de apostas (Wins/Losses)
- [ ] Nenhum erro crítico no console
- [ ] Saldo está atualizando corretamente

### Fase B: Coleta de Dados (50 rodadas total)

**Métricas esperadas ao fim**:

- [ ] Total de rodadas: ~50
- [ ] Entradas totais (apostas executadas): 40-50
- [ ] Wins: ___ (esperado: 55%+)
- [ ] Losses: ___ 
- [ ] Taxa de acerto: ___% (alvo: 60%+)
- [ ] Saldo final: R$ ___ (positivo esperado)
- [ ] Lucro/Prejuízo: R$ ___

**Safety Governance** (verificar console):

- [ ] `[Safety] Circuit breaker: OK`
- [ ] `[Safety] Rate limit: X/10 ops/min` (nunca ultrapassar 10)
- [ ] `[Safety] Risk validation: OK`
- [ ] Nenhuma mensagem "CRÍTICO"

### Resultados

- [ ] Saldo final >= Saldo inicial (breakeven no mínimo)
- [ ] Taxa de acerto >= 55%
- [ ] Nenhum erro não tratado
- [ ] Gale funcionou conforme esperado
- [ ] Stop Win/Loss respeitados

**Status**: ⬜ Pendente | ✅ Passou | ❌ Falhou

---

## 📊 Resumo Final

| Teste | Status | Observações |
|-------|--------|-------------|
| 1. Padrões (HTML) | ⬜ | |
| 2. Chrome Load | ⬜ | |
| 3. Click & Fichas | ⬜ | |
| 4. Gale (Martingale) | ⬜ | |
| 5. Produção (BetBoom) | ⬜ | |

**Legenda**: ⬜ Pendente | ✅ Passou | ❌ Falhou | ⚠️ Com observações

---

## 🎯 Critério de Sucesso Global

✅ **Todos os testes 1-4 devem passar antes de Teste 5**

✅ **Teste 5 deve ter: taxa >= 55%, saldo positivo, Safety OK**

✅ **Se algum teste falhar**: Consulte GUIA_TESTES_PRATICOS.md → Troubleshooting

---

## 📝 Notas Adicionais

```
Coloque suas observações aqui durante os testes:

Teste 1 (HTML):
─────────────

Teste 2 (Chrome):
─────────────

Teste 3 (Click):
─────────────

Teste 4 (Gale):
─────────────

Teste 5 (Produção):
─────────────
```

---

**Próximo passo após conclusão**: Documentar resultados em DEPLOYMENT_CHECKLIST.md (seção "Teste Manual Extended")

