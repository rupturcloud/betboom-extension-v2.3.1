# 🎯 Claudinho — Extensão HITL para Bac Bo (Will)

Robô supervisionado que detecta padrões na mesa Bac Bo da BetBoom e **clica por você** se você deixar.
Você (Will) vê a sugestão, tem 5 segundos pra cancelar, e pode parar tudo a qualquer instante.

---

## 📦 Como instalar

### Opção 1 — Pasta (modo desenvolvedor)

1. Abre `chrome://extensions` no navegador
2. Liga **"Modo do desenvolvedor"** (canto superior direito)
3. Clica em **"Carregar sem compactação"**
4. Aponta para a pasta `claudinho` que você recebeu
5. Confirma que a extensão **"Claudinho (snapshot 14/05 17:08)"** aparece ativada

### Opção 2 — ZIP

1. Descompacta o `claudinho.zip` em qualquer pasta
2. Segue os passos da opção 1 apontando pra pasta descompactada

### Opção 3 — Clone direto do GitHub (atualizações futuras)

```bash
git clone -b claudinho https://github.com/rupturcloud/betboom-extension-v2.3.1.git claudinho
```

---

## ⚙️ Como configurar

Clica no ícone da extensão (canto direito do Chrome) pra abrir o painel de configuração:

| Campo | O que é | Sugestão inicial |
|---|---|---|
| **Stake inicial** | Valor da primeira aposta de cada padrão | R$ 5 |
| **Gale (máx níveis)** | Quantas tentativas em sequência (martingale) | 2 |
| **Stop Win** | Para quando o lucro da sessão atinge esse valor | R$ 100 |
| **Stop Loss** | Para quando a perda da sessão atinge esse valor | R$ 50 |
| **Modo teste** | Quando ligado, NÃO clica de verdade (só simula) | LIGADO no primeiro dia |

**Importante:** começa com **Modo teste ligado** no primeiro dia pra ver as indicações sem arriscar dinheiro.

---

## 🎮 Como usar

### 1. Abre a mesa Bac Bo na BetBoom

A extensão detecta o jogo sozinha e abre um overlay no canto da tela.

### 2. Calibra UMA VEZ (importante!)

Clica no botão roxo **🎯 CAL** no canto superior direito do overlay. O robô vai te pedir pra clicar **na ficha de R$5** e em **cada um dos 3 spots** (Jogador, Banca, Empate). Faz uma vez só — fica salvo.

> Sem calibrar: o click no Empate funciona, mas Jogador e Banca podem errar a mira.

### 3. Deixa rodar

Quando o robô detectar um padrão, vai aparecer no overlay:

```
Padrão Casadinho detectado → BANCA R$ 25 em 5s
[ ❌ CANCELAR ]
```

- **Se você não fizer nada:** após 5 segundos (ou 1s se a convicção for alta), o robô clica sozinho.
- **Se você clicar CANCELAR** (ou apertar `ESC` ou `Ctrl+Shift+C`): a aposta é descartada.

### 4. Parar tudo a qualquer momento

- Botão vermelho gigante **🛑 PARAR** no topo do overlay
- Ou atalho de teclado: **`Ctrl+Shift+K`**

Enquanto parado, **nenhuma decisão dispara clique**. Clica de novo (ou `Ctrl+Shift+K` de novo) pra retomar.

---

## ⌨️ Atalhos de teclado

| Atalho | O que faz |
|---|---|
| `ESC` | Cancela a decisão atual (só se houver countdown rolando) |
| `Ctrl+Shift+C` | Cancela a decisão atual |
| `Ctrl+Shift+K` | PARAR GLOBAL — trava todas as próximas decisões |

---

## 📋 Ver o histórico depois

Abre o DevTools do Chrome (F12) → aba Console → digita:

```js
BBLog.ler()       // mostra todas as entradas do log
BBLog.exportar()  // baixa um .txt com tudo
BBLog.limpar()    // apaga o histórico
```

O log guarda as últimas 200 entradas (sugestões, cancelamentos, cliques, erros).

---

## 🛡️ Segurança automática

O robô **NÃO clica** automaticamente nestes casos:

- Saldo **= R$ 0** ou **R$ 2.969,00** (valores zumbi conhecidos — sinal de bug do site)
- Quando a aposta calculada passar de `stake inicial × 10` (limite anti-disparo absurdo)
- Quando você acionar PARAR GLOBAL

---

## 🚨 O que fazer se travar

1. **Não tá detectando padrão?**
   Recarrega a página da mesa (`F5`). Espera ~10s pra o robô reler o histórico via WebSocket.

2. **Tá indicando, mas não clica?**
   Provavelmente coords não calibradas. Aperta **🎯 CAL** no overlay e refaça.

3. **Indicação errada / aposta no spot errado?**
   - Aperta **`Ctrl+Shift+K`** agora pra parar tudo
   - Recalibra (**🎯 CAL**)
   - Se persistir, anota o padrão detectado vs a entrada errada e me passa

4. **Quer reset completo?**
   No console (F12 → Console):
   ```js
   localStorage.clear()
   indexedDB.deleteDatabase('betboom-history')
   location.reload()
   ```

5. **Quer desinstalar?**
   `chrome://extensions` → encontra "Claudinho" → clica em **"Remover"**.

---

## 📊 Estatística de convicção (Diego observou na sessão de teste)

| Convicção | Performance | O que fazer |
|---|---|---|
| **≥ 80%** | Quase sempre acerta | Deixa clicar |
| **~ 69%** | Costuma acertar | Deixa clicar |
| **~ 74%** | Costuma vir invertido | **CANCELA** (ESC) |
| **~ 56%** | Vem invertido invertido | **CANCELA** (ESC) |
| Sugestão de **Empate** | Quase sempre vem Azul | **CANCELA** (ESC) |

Use esses padrões como guia. Você é o freio.

---

## ℹ️ Origem

- Base: snapshot `5aa55d3` da branch `claude-code` (rupturcloud/hitl-automation-engine), commit de **2026-05-14 17:08**
- Branch atual: `claudinho` em `rupturcloud/betboom-extension-v2.3.1`
- Ajustes do PRD do Will: botão 🎯 CAL no overlay, atalhos ESC/Ctrl+Shift+C/Ctrl+Shift+K, botão 🛑 PARAR GLOBAL, guard de saldo anômalo (0/2969), log persistente em localStorage, README pt-BR
