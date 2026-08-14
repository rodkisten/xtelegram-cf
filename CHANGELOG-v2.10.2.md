# xtelegram-cf 2.10.2

## Vídeo X/Twitter

- Vídeos diretos de video.twimg.com com tamanho conhecido e dentro do limite
  configurado passam pelo Worker como upload binário para Telegram.
- O Worker conserva os bytes e os headers necessários do X; somente esse caso
  deixa de usar URL-first. URLs de fotos, outros provedores e arquivos sem
  tamanho conhecido permanecem no caminho leve original.
- Álbuns com vídeo do X tentam o grupo multipart attach antes da URL remota.
  A ordem do álbum e a política contra retries ambíguos permanecem intactas.

## Resolver e segurança de entrega

- Twirrl seleciona uma variante por slot e, quando o payload informa dimensões,
  privilegia a proporção correta antes da resolução total.
- Tokens e chat de Telegram foram removidos do wrangler.jsonc distribuído.
  Use secrets do Wrangler e .dev.vars local.

Não há migration D1 nova.
