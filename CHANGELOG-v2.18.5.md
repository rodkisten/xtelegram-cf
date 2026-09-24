# v2.18.5 — IDs, URLs e deep links das mensagens Telegram

- Respostas de entrega expõem no topo um contrato simples para Shortcuts/Scriptable:
  - `message_id`: primeira mensagem Telegram relevante;
  - `message_url`: URL HTTPS da primeira mensagem;
  - `message_deeplink`: deep link `tg://` da primeira mensagem;
  - `message_ids`, `message_urls`, `message_deeplinks`: todas as mensagens conhecidas.
- `/send` cobre mídia simples, álbum e multipart, inclusive respostas parciais em que o Telegram já criou mensagens antes de outro destino/arquivo falhar.
- `/resolve-and-send` agrega os campos dos itens filhos no topo da resposta.
- `/batch` agrega os campos dos itens bem-sucedidos no topo e preserva os mesmos campos em cada resultado individual.
- `/media/register` devolve imediatamente os links das mensagens registradas pelo fallback direto do cliente/a-Shell.
- `already_sent` e conflitos de deduplicação recuperam IDs e links a partir do histórico D1, sem chamar o Telegram novamente.
- Canais públicos usam `https://t.me/<username>/<message_id>` e `tg://resolve?...`.
- Canais/supergrupos privados `-100...` usam `https://t.me/c/<channel>/<message_id>` e `tg://privatepost?...`.
- Tópicos adicionam `thread=<message_thread_id>`; itens de álbum usam `single` para apontar para a mídia específica.
- `TelegramMessage` agora preserva também `chat.username` e `message_thread_id` quando o Bot API os retorna.
- Nenhuma migration D1 nova é necessária.
