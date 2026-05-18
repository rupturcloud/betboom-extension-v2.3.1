# Telemetry Server (Claudinho)

Servidor HTTP local que recebe telemetria da extensão em tempo real.
Sem dependências externas. Diego inicia, Claude consulta.

## Subir o servidor

```bash
cd /Users/diego/dev/hitl/claudinho/.claude/worktrees/sad-swanson-7ac4ec
node tools/telemetry-server.js
```

Saída esperada:
```
[telemetry-server] 🛰  ouvindo em http://127.0.0.1:9876
[telemetry-server] log -> tools/telemetry.jsonl
[telemetry-server] cmds -> tools/commands.json
```

Deixa rodando em outra aba do terminal.

## Endpoints (Claude consulta)

```bash
# Resumo geral
curl -s localhost:9876/summary | jq

# Últimos 50 eventos
curl -s localhost:9876/recent?n=50 | jq

# Filtrar por tipo
curl -s 'localhost:9876/query?type=decisao_tomada' | jq
curl -s 'localhost:9876/query?type=bet_confirmation&veredito=NAO_ENTROU' | jq

# Stream live (Ctrl+C pra sair)
curl -N localhost:9876/tail

# Saúde
curl -s localhost:9876/health | jq
```

## Enviar comandos pra extensão (Claude → extensão)

```bash
# Snapshot completo do estado
curl -s -X POST localhost:9876/command \
  -H 'Content-Type: application/json' \
  -d '{"cmd":"snapshot"}'

# Calibrar mesa
curl -s -X POST localhost:9876/command -d '{"cmd":"calibrar"}'

# Ligar/desligar modo observação
curl -s -X POST localhost:9876/command \
  -d '{"cmd":"modo_observacao","args":{"on":true}}'

# Parar / iniciar
curl -s -X POST localhost:9876/command -d '{"cmd":"parar"}'
curl -s -X POST localhost:9876/command -d '{"cmd":"iniciar"}'

# Aplicar config (qualquer chave do CONFIG)
curl -s -X POST localhost:9876/command \
  -d '{"cmd":"aplicar_config","args":{"stakeInicial":10,"stopWin":500}}'

# Disparar aposta teste (BBCalibrator.executarAposta)
curl -s -X POST localhost:9876/command \
  -d '{"cmd":"aposta_teste","args":{"cor":"azul","stake":5}}'

# Limpar calibração
curl -s -X POST localhost:9876/command -d '{"cmd":"limpar_calibracao"}'
```

Extensão polla `/commands` a cada 3s e executa pendentes (ack automático).

## Tipos de evento emitidos pela extensão

- `boot` — extensão carregou
- `decisao_tomada` — DecisionEngine.decidir() retornou deveApostar=true (já passou guard WMSG)
- `guard_origem_bloqueado` — decisão NÃO-WMSG bloqueada
- `bet_confirmation` — `{ veredito: CONFIRMADA | NAO_ENTROU, cor, stake, delta }`
- `comando_recebido` — extensão recebeu /command
- `aposta_teste_result` — resultado de aposta_teste
- `snapshot` — resposta ao comando snapshot
- `error` — erro capturado

## Arquivos gerados

- `tools/telemetry.jsonl` — append-only, 1 evento por linha (analisa com `jq` ou Python)
- `tools/commands.json` — fila de comandos pendentes (limpa após ack)

## Para o Claude debugar do worktree

```bash
# Última decisão tomada
curl -s 'localhost:9876/query?type=decisao_tomada&n=1' | jq '.[-1]'

# Hit rate atualizado
curl -s localhost:9876/summary | jq '{bets, bets_confirmed, hit_rate}'

# Ver se ainda está bloqueando por origem
curl -s 'localhost:9876/query?type=guard_origem_bloqueado' | jq length

# Tudo dos últimos 30s (via JSONL)
tail -100 tools/telemetry.jsonl | jq -c 'select(._server_ts > "'$(date -u -v-30S +%Y-%m-%dT%H:%M:%S)'")'
```
