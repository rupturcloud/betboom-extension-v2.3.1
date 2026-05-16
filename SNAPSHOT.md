# Claudinho — Snapshot Puro

## Origem

| Campo | Valor |
|---|---|
| **Commit** | `5aa55d386dc3dc35fd587d6ef5093f9b1b5ce386` (`5aa55d3`) |
| **Data** | 2026-05-14 17:08:52 -03:00 |
| **Branch** | `claude-code` |
| **Repo** | `rupturcloud/hitl-automation-engine` |
| **Pasta original** | `~/dev/hitl/betboom-extension-v2.3.1-backup/betboom-extension-v2.3.1` |
| **Extraído via** | `git archive 5aa55d3 \| tar -x` |
| **Extraído em** | 2026-05-15 |

## Mensagem do commit base

```
fix(SAFETY): desativa fallback heuristico + safety cap absoluto de stake

INCIDENTE: bot tentando apostar R$5000 ao inves de R$5.

Causa raiz: fallback heuristico CDP em content.js usa mapa hardcoded
CHIP_INDEX = { 5: 0, 10: 1, 25: 2, ... }. Esse mapa assume layout
de mesa low-stake (primeira ficha = R$5). Em mesas live-high do
BetBoom, a primeira ficha (idx=0) eh R$5000, nao R$5.

Mitigacoes em camadas:
1) config.js: permitirFallbackHeuristico: false + stakeCapMultiplier: 10
2) content.js: fallback só dispara se permitirFallbackHeuristico===true
3) executor.js: safety cap absoluto antes de qualquer caminho
```

## Estado do código nesse snapshot

- ✅ **Signature canônica unificada** — NÃO. Este commit é ANTERIOR ao fix R5
  (commit 367864b de 15/05 05:52). Pode apresentar duplicação de rodadas
  no histórico/indicação quando snapshot bulk chega antes do round confirmado.
- ✅ **Safety cap R$5K** — SIM. As 3 mitigações estão aplicadas.
- ✅ **CLICA TUDO no decision.js** — NÃO. As funções `isClicaTudoMode`,
  `normalizarDecisaoClicaTudo` foram adicionadas DEPOIS desse ponto.
- ❌ **realizarAposta.js (motor da extensão 2)** — NÃO. Importado só no
  commit a5c84a7 da branch `grok`, depois.
- ❌ **BB_CLICK do top frame (versão GROK)** — NÃO. A função `window.BB_CLICK`
  no top frame ainda é a original (sem bug de `alvo/valor` undefined).

## Modificações neste snapshot

Apenas `manifest.json` foi tocado depois da extração:
- `name`: `BetBoom Auto Pattern` → `BetBoom Claudinho (snapshot 14/05 17:08)`
- `version`: `2.3.1` → `2.3.1-claudinho`
- `description`: ajustada pra identificar origem

Todo o resto (`js/*`, `css/*`, `icons/*`, `popup.html`) é byte-idêntico ao commit.

## Como carregar no Chrome

1. `chrome://extensions`
2. Liga "Modo desenvolvedor"
3. "Carregar sem compactação"
4. Aponta para `/Users/diego/dev/hitl/claudinho`

A versão aparece como **"BetBoom Claudinho (snapshot 14/05 17:08)"** — fica
lado a lado das outras instaladas sem conflito.
