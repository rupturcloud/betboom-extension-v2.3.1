# Tabuleiro de Histórico - Padrão TICKER/ESTEIRA

## Visão Geral

O tabuleiro de histórico funciona como um **TICKER/ESTEIRA (Conveyor Belt)** - similar a um placar de aeroporto ou LED matrix display.

## Estrutura

- **Grid Fixo**: 6 linhas × 26 colunas (SEMPRE, nunca muda)
- **Cada Coluna**: 1 rodada completa (6 bolinhas, uma por linha)
- **Cada Célula**: Tem uma cor INDEPENDENTE — representa uma perspectiva/análise diferente da **mesma rodada**
- **Linha 0**: Evidência Player (azul se player ganhou, vermelho se banker ganhou, etc.)
- **Linha 1**: Evidência Banker (vermelho se banker ganhou, azul se player ganhou, etc.)
- **Linha 2**: Evidência Tie (cor base do resultado, relevância do empate)
- **Linhas 3-5**: Repetição das 3 análises para visualização completa
- **Conteúdo**: Sempre as **últimas 26 rodadas** visíveis

```
┌─────────────────────────────────────────────────────┐
│ [Rod1] [Rod2] [Rod3] ... [Rod26]                    │
│  🔵    🔴    ⚪    ... 🔵                            │
│  🔵    🔴    ⚪    ... 🔵                            │
│  🔵    🔴    ⚪    ... 🔵                            │
│  🔵    🔴    ⚪    ... 🔵                            │
│  🔵    🔴    ⚪    ... 🔵                            │
│  🔵    🔴    ⚪    ... 🔵                            │
└─────────────────────────────────────────────────────┘
```

## Fluxo de Atualização (TICKER)

### Momento 0 - Carga Inicial
```
Histórico disponível: [Rod1, Rod2, ..., Rod100]
Tabuleiro mostra:     [Rod75, Rod76, ..., Rod100]  ← últimas 26
Array interno:        [Col75, Col76, ..., Col100]  ← 26 colunas
```

### Nova Rodada Chega (Rod101)
```
Ação:
  1. Cria coluna para Rod101
  2. Adiciona ao final: array.push(ColRod101)
  3. Remove a mais antiga: array.shift()  ← Remove ColRod75

Resultado:
Array interno:        [Col76, Col77, ..., Col101]  ← 26 colunas
Tabuleiro mostra:     [Rod76, Rod77, ..., Rod101]
```

### Nova Rodada Chega (Rod102)
```
Array interno:        [Col77, Col78, ..., Col102]  ← 26 colunas
Tabuleiro mostra:     [Rod77, Rod78, ..., Rod102]
```

## Pontos Críticos

✅ **Grid tamanho fixo**: Sempre 6×26 (nunca muda de tamanho)
✅ **Grid auto-flow coluna**: `grid-auto-flow: column;` — posiciona 1ª bolinha no topo de cada coluna
✅ **Sem animação de slide**: Não usa transform/translate — apenas substitui conteúdo
✅ **Substituição de conteúdo**: Apenas muda quais rodadas aparecem, grid permanece idêntico  
✅ **Array com 26 colunas**: `.push()` nova + `.shift()` antiga = sempre 26 rodadas visíveis
✅ **FIFO Queue**: First In, First Out com tamanho máximo = Conveyor Belt  

## Implementação

### JavaScript — Lógica FIFO

```javascript
// Array mantém sempre últimas 26 rodadas
let tabuleiroColunas = [];  // Máximo 26 colunas

function adicionarNovaRodada(novaRodada) {
  // 1. Cria coluna (6 bolinhas)
  const novaColuna = criarColuna(novaRodada);
  
  // 2. Adiciona no final
  tabuleiroColunas.push(novaColuna);
  
  // 3. Se passou de 26, remove a primeira (mais antiga)
  if (tabuleiroColunas.length > 26) {
    tabuleiroColunas.shift();
  }
  
  // 4. Renderiza o grid com essas 26 colunas
  renderizarTabuleiro(tabuleiroColunas);
}
```

### CSS — Posicionamento por Coluna

```css
.bb-tabuleiro {
  display: grid;
  grid-template-columns: repeat(26, 1fr);  /* 26 colunas */
  grid-template-rows: repeat(6, auto);     /* 6 linhas */
  grid-auto-flow: column;                  /* ⭐ CRÍTICO: posiciona por coluna, não por linha */
  gap: 3px;
  padding: 8px;
}
```

**O que `grid-auto-flow: column;` faz:**
- Sem ele (padrão): bolinhas preenchem linha-por-linha (ERRADO)
  ```
  Col1 Col2 Col3 ...  ← Linha 1 (6 bolinhas)
  Col1 Col2 Col3 ...  ← Linha 2 (6 bolinhas)
  ```
- Com ele: bolinhas preenchem coluna-por-coluna (CORRETO)
  ```
  Rod1 Rod2 Rod3 ... Rod26  ← Linha 1 (1 bolinha por rodada)
  Rod1 Rod2 Rod3 ... Rod26  ← Linha 2 (1 bolinha por rodada)
  Rod1 Rod2 Rod3 ... Rod26  ← Linha 3...
  ```

## Geração de Cores por Rodada

Cada rodada gera 6 cores (uma por linha) baseado no resultado real:

```javascript
// Se rodada teve resultado = 'azul' (player venceu)
cores = ['azul', 'vermelho', 'empate', 'azul', 'vermelho', 'empate']

// Se rodada teve resultado = 'vermelho' (banker venceu)
cores = ['vermelho', 'azul', 'empate', 'vermelho', 'azul', 'empate']

// Se rodada teve resultado = 'empate'
cores = ['empate', 'empate', 'empate', 'empate', 'empate', 'empate']
```

**Interpretação:**
- Cada linha mostra o resultado de uma **perspectiva diferente** da mesma rodada
- Linha 0 (Player): azul se acertou (player venceu), vermelho/empate se errou
- Linha 1 (Banker): vermelho se acertou (banker venceu), azul/empate se errou
- Linha 2 (Tie): empate se acertou, colors dos acertos se errou
- Linhas 3-5: Repetição para melhor visualização temporal

## Listeners

O tabuleiro escuta por novas rodadas via `Collector.onNovoResultado()`:

```javascript
if (typeof Collector !== 'undefined' && Collector.onNovoResultado) {
  Collector.onNovoResultado((novaRodada) => {
    adicionarNovaRodada(novaRodada);
  });
}
```

## Visual Result

Quando renderizado, o DOM mostra **sempre e apenas** 26 colunas (156 células):
- Conteúdo muda com cada nova rodada
- Grid size permanece idêntico
- Bolinhas antigas somem pela esquerda
- Bolinhas novas aparecem pela direita
