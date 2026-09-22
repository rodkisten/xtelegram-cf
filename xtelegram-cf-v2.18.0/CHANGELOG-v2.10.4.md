# Relay v2.10.4

## Correção

- Adicionado trace por requisição (`X-Relay-Trace-Id`) até os envios internos de `/batch` e `/resolve-and-send`.
- `RELAY_DEBUG=true` ativa logs estruturados de validação, resolução, D1, mídia, Telegram, persistência e claims.
- Logs de debug removem tokens, cookies e query strings de URLs assinadas.
- Sem alteração de schema ou migration D1.
