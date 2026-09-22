# xtelegram-cf 2.10.3

## X/Twitter: resultado fiel por canal

- `/resolve-and-send` passa a agregar os `channels` de todas as entregas que uma URL social gera, inclusive quando o resolver retorna uma mídia única fora do caminho de álbum.
- `requested`, `attempted`, `inserted`, `covered` e `notSent` passam a existir no resultado externo com a mesma semântica de `/send`.
- Entregas já existentes continuam sendo reportadas como `already_sent`; falhas sem contrato explícito agora ficam como `delivery_unconfirmed`, sem falso sucesso.

## URL pública para resolver mídia do X

- O Worker normaliza `/i/status/:id` usando `cdn.syndication.twimg.com` antes de chamar Twirrl/DTwitter.
- Quando a syndication pública não responde, um `twitterAuthor` capturado pelo userscript pode completar a URL como fallback final.
- A normalização de metadata não transforma a rota interna `i` em autor de Tweet.

Não há migration D1 nova.
