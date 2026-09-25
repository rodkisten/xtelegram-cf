# v2.18.7 — Thumbnail Base64 com redimensionamento automático

## O que mudou

A resposta de thumbnail Base64 agora passa por **auto-resize** antes da
codificação. O objetivo é devolver previews muito menores e mais leves para
consumo em Shortcuts, Scriptable e UIs móveis.

### Novo comportamento padrão

- largura máxima padrão de thumbnail: **320 px**;
- resize com `fit=scale-down`, mantendo proporção;
- qualidade JPEG padrão: **75**;
- o contrato continua expondo `thumbnail_url` separadamente;
- o Base64 continua vindo **sem** prefixo `data:`.

### Novos campos de resposta

Agora as respostas podem incluir:

```json
{
  "thumbnail_width": 320,
  "thumbnail_height": 180,
  "thumbnail_source_width": 1280,
  "thumbnail_source_height": 720,
  "thumbnail_resized": true
}
```

### Novos controles

#### Variável de ambiente

- `THUMBNAIL_MAX_WIDTH` — substitui a largura máxima padrão do auto-resize.

#### Por chamada

- `thumbnail_max_width`
- `thumbnailMaxWidth`

Exemplo:

```json
{
  "include_thumbnail": true,
  "thumbnail_max_width": 160
}
```

### Compatibilidade

- `/resolve` e `/resolve-and-send` continuam habilitando thumbnail Base64 por padrão;
- `/batch` continua com thumbnail Base64 desligado por padrão, mas respeita `include_thumbnail: true`;
- `/send` continua aceitando `thumbnail_url` / `thumbnailUrl` / `poster_*` / `cover_*`.

## Arquivos principais alterados

- `src/lib/thumbnail-response.ts`
- `src/routes/resolve.ts`
- `src/routes/send/index.ts`
- `src/routes/batch.ts`
- `src/config/constants.ts`
- `src/types.ts`
- `README.md`
- `tests/thumbnail-response.test.ts`
