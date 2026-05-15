# PRD — Robô HITL Bac Bo BetBoom

**Versão:** 1.0
**Atualizado:** 2026-05-15
**Branch alvo:** `grok` no repo `betboom-extension-v2.3.1`
**Status:** ativo

---

## 1. Objetivo

Extensão Chrome que detecta padrões do Will (18 padrões) no Bac Bo da Evolution na BetBoom, sugere entradas (cor + stake + confiança) no overlay e — após aprovação humana ou countdown de 5s — clica no spot certo, no chip certo, com proteção automática de empate.

**Frase única:** *ferramenta de precisão operacional para HITL, não auto-pilot de apostas.*

---

## 2. Persona única

Operador HITL. Já tem banca na BetBoom, conhece Bac Bo, quer reduzir cansaço de leitura manual dos 18 padrões. Confia na ferramenta SE os dados (saldo + histórico) baterem 100% com a banca.

---

## 3. Fluxo do usuário (7 passos)

1. Operador abre mesa Bac Bo na BetBoom no Chrome.
2. Extensão carrega, lê **saldo** via walker WS + scraper DOM (fonte única, validado contra UI).
3. Extensão lê **histórico** via HistoryStore (fonte única, sem caminhos paralelos).
4. Decision Engine detecta um dos **18 padrões do Will**.
5. Overlay mostra sugestão: `CONFIRMAR BANKER R$10.00 (62%)` + botão **Cancelar** + countdown **5s**.
6. Operador clica **Confirmar** (ou ignora — countdown auto-executa; ou clica **Cancelar** — aborta).
7. Extensão clica **chip(s)** + **área** (Player/Banker/Tie) + **proteção automática 10%** no Tie quando ação ≠ Tie.

---

## 4. Invariantes não-negociáveis

| # | Invariante | Falha = |
|---|---|---|
| I1 | Saldo no overlay = saldo visível na banca | bloqueia entrada |
| I2 | Histórico no overlay = histórico da banca (mesma ordem, sem atraso > 1 rodada) | bloqueia entrada |
| I3 | Clique cai dentro do spot certo (`[data-bet="player\|banker\|tie"]` ou heurística com score ≥ 300) | aborta + log |
| I4 | F1 gate só bloqueia se score < 45 (não bloqueia entrada boa do Will) | passa pra próxima rodada |
| I5 | Stake nunca > 10× `stakeInicial` (safety cap absoluto) | bloqueia |
| I6 | Toda decisão registrada com `sourceRoundIds` + `timestamp` + `traceId` | sem isso, não loga "robô sugeriu" |
| I7 | Aposta ≠ Tie sempre acompanha proteção automática Tie (~10% do stake como chip inteiro) | warning + segue com a principal |
| I8 | Saldo > R$ 10.000.000 = lixo (concatenação errada) → rejeita | log `🛑 REJEITADO` |

---

## 5. Critérios de aceite (binário — entrega pro cliente)

Os 10 critérios abaixo devem dar **PASS** em mesa real antes do release:

- [ ] **C1** — 20 rodadas sem saldo errado no overlay (validado contra `R$ X,XX` do canto da mesa)
- [ ] **C2** — 20 rodadas com histórico batendo a banca slot a slot
- [ ] **C3** — Sugestão aparece com **cor + stake + confiança** visíveis no botão de confirmar
- [ ] **C4** — Countdown 5s funciona; **Cancelar** interrompe; ignorar executa
- [ ] **C5** — 10 cliques em mesa real acertam o spot correto (PLAYER/BANKER/TIE)
- [ ] **C6** — Chip do stake exato é selecionado (R$5 não pode clicar R$50)
- [ ] **C7** — Proteção automática Tie é adicionada quando ação ≠ Tie
- [ ] **C8** — Stop Win / Stop Loss para a operação imediatamente ao bater limite
- [ ] **C9** — Gale até G1 funciona conforme configurado (sem ultrapassar safety cap)
- [ ] **C10** — Console mostra logs estruturados `[REALIZAR-APOSTA] ✓ ...` em cada passo

---

## 6. Arquitetura de referência (fontes canônicas)

| Camada | Fonte canônica | Como reusar |
|---|---|---|
| **Clique** | `web-betia--studio000001/wdp/extensao 2/realizarAposta.js` | importar literal como `js/realizarAposta.js` |
| **Cérebro / 18 padrões** | `hitl-automation-engine` branch `claude-code` @ `85d4d54` (`decision.js`, `f1-scorer.js`, `patterns.js`, `conviction-engine.js`, `consensus-engine.js`) | já idêntico na `grok` — não tocar |
| **UX / comportamento esperado** | `web-betia--studio000001/wdp/print-telas-video-app-robo-automacao/transcricao.md` | seguir fluxo do vídeo |
| **Saldo (walker WS + scraper DOM fallback)** | `js/content.js` (commits `4f3831b` + `383c007` na grok) | já aplicado |
| **Overlay (sugestão + countdown + Confirmar/Cancelar)** | `js/overlay.js` (commit `85d4d54` no hitl-automation-engine) | já aplicado |

---

## 7. Fora-de-escopo explícito (NÃO faz, com motivo)

| Item | Por que NÃO agora |
|---|---|
| TypeScript / build pipeline | atrasa entrega; JS puro basta |
| Refactor dos 67 arquivos da v2.3.1 | risco alto; faxina será incremental e separada |
| Multi-mesa simultânea | complexidade fora do MVP |
| Auto-pilot 100% sem humano | viola princípio HITL |
| Calibração CDP por coordenadas | DOM puro da extensão 2 já funciona |
| Replay engine / event sourcing completo | nice-to-have, depois |
| F1 gate agressivo (≥ 60%) | conflita com I4 — bloqueia entrada boa |
| Pattern entropy + behavior drift + consensus no caminho crítico | excesso de gating; usado só como observabilidade passiva |
| Migração para HITL Precision Engine ou Elon-the-bot-click | refactor grande; v2.3.1 entrega antes |
| Auto-login (Ghost Login) | operador faz login manual |

---

## 8. Próximas 3 microvitórias (em ordem)

| # | Ação | Esforço | Saída mensurável |
|---|---|---|---|
| **A1** | Importar `realizarAposta.js` da extensão 2 + manifest update + wrapper `BB_CLICK` no subframe | 1h | `WillDadosAposta.realizarAposta('P', 5)` clica certo no console do iframe |
| **A2** | Auditar `patterns.js` vs 18 padrões da transcrição; listar divergências em tabela | 1h | tabela com 18 linhas: nome esperado vs nome real (OK/divergente/faltando) |
| **A3** | Mapear arquivos órfãos da v2.3.1 (não importados no manifest nem em outros JS) | 30min | lista com candidatos a remoção para você aprovar antes do delete |

---

## 9. Métricas L99 (baseline → meta)

| Métrica | Hoje | Meta pré-entrega |
|---|---|---|
| Confiabilidade do clique | 40% | ≥ 85% |
| Confiabilidade do saldo | 70% (pós scraper DOM) | ≥ 95% |
| Confiabilidade do histórico | 60% | ≥ 95% |
| Confiabilidade factual do relatório | 90% | ≥ 95% |
| Risco de execução errada | 60% | ≤ 15% |
| Risco de inferência sem lastro | 10% | ≤ 5% |
| Pronto para teste manual | sim | sim |
| Pronto para semi-automático (HITL) | **NÃO** | **sim** |
| Pronto para autônomo (auto-pilot) | NÃO | fora-de-escopo |

---

## 10. Não-negociáveis de processo

- Toda mudança vem com **commit + log claro + forma de testar** explícita no PR description.
- Toda revisão técnica segue protocolo **L99** (BLUF, KNOWN, ASSUME, WHY5, PRE, POST, 80/20, CHECKLIST, EXIT, CONF).
- Nada sem `sourceRoundIds` + `timestamp` + `traceId` em log de decisão.
- Trabalho fica em **branch `grok`**. PR para `main` só com os 10 critérios de aceite ✅.
- **Não force-push em `main`**. Não amend de commit já pushed.
- Anti-loop: se travar 3 ciclos em um mesmo problema, abrir **decision-gate** e mudar abordagem.

---

## 11. Critério L99 de fechamento

Considera-se "ACEITO PARA CLIENTE" quando:

- ✅ Os 10 itens C1-C10 passam em mesa real
- ✅ Cliente confirma após 1h de teste contínuo
- ✅ Sem regressão dos commits aplicados (`6d457ec`, `cce011f`, `4f3831b`, `383c007`)
- ✅ Branch `grok` mergeada em `main` via Pull Request (não force-push)
- ✅ Saldo e histórico do overlay batem 100% com a banca durante o teste
- ✅ Console limpo de erros (warnings tolerados)

---

## 12. O que não sabemos que não sabemos (gaps)

- DOM da BetBoom Bac Bo mudou entre o vídeo do influencer (2024-2025) e hoje?
- `data-bet="player"` ainda existe em todas as mesas (Mini canvas-only é exceção)?
- Os 18 padrões em `patterns.js` da v2.3.1 são *exatamente* os 18 do vídeo? **A2 vai responder isso.**
- Race condition entre walker WS e scraper DOM em payloads grandes?

---

**Próxima decisão pendente:** começar por **A1** (clique extensão 2) ou **A2** (auditar 18 padrões)?

*Recomendação: A1 primeiro — sem clique certo, padrão certo não vira aposta certa.*
