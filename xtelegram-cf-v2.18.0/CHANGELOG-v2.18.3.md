# v2.18.3 — falhas de tamanho na entrega preservam o fallback

- Quando o Telegram rejeita todas as entregas porque o arquivo ultrapassa o
  limite efetivo, `/send` agora responde com o fluxo controlado HTTP 413.
- A resposta conserva `clientFallback.variants`, headers, caption, metadata e
  contexto de registro para o cliente escolher uma variante menor ou comprimir.
- Evita converter uma falha conhecida de tamanho em HTTP 502 genérico.
- Compatível com Scriptable 3.5.2, que procura fallbacks aninhados em
  `deliveries[]` de respostas antigas do `/resolve-and-send`.
