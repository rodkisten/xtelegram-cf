# v2.18.6 — Thumbnail Base64 no contrato do relay

- `/resolve` e `/resolve-and-send` passam a devolver `thumbnail_url`,
  `thumbnail_base64`, `thumbnail_mime_type`, `thumbnail_bytes`,
  `thumbnail_source`, `thumbnail_included` e `thumbnail_error`.
- O Base64 usa o thumbnail/cover já fornecido pelos resolvers sociais; para
  fotos, a mídia resolvida é fallback quando não existe cover dedicada.
- O download é limitado e abortado ao exceder o orçamento. O padrão é 384 KiB,
  com teto absoluto de 768 KiB. `THUMBNAIL_BASE64_MAX_BYTES` configura o limite
  global e `thumbnail_max_bytes` pode reduzi-lo/ajustá-lo por chamada.
- Falha de thumbnail nunca transforma um envio válido em erro. O URL permanece
  disponível e `thumbnail_error` explica `thumbnail_too_large`, timeout, HTTP,
  conteúdo não-imagem ou outra falha de fetch.
- Chamadas sociais individuais incluem Base64 por padrão;
  `include_thumbnail=false` evita o download.
- `/send` também aceita `thumbnail_url`/`thumbnailUrl` (além de aliases de poster/cover);
  com `include_thumbnail=true`, uma foto direta pode usar a própria `mediaUrl` como fallback.
- `/batch` desabilita Base64 por padrão para proteger o tamanho da resposta;
  `include_thumbnail=true` habilita explicitamente.
- O primeiro thumbnail de um batch é promovido ao topo, além de permanecer no
  resultado individual do item.
- O URL escolhido é persistido como `socialThumbnailUrl` na metadata interna,
  permitindo que conflitos `already_sent` futuros reconstruam o thumbnail sem
  reexecutar o resolver.
- Nenhuma migration D1 nova é necessária.
