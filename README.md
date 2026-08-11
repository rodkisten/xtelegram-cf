# xtelegram-cf · Telegram Media Relay v2.7

Cloudflare Worker em TypeScript para resolver, preparar e enviar vídeos, fotos, áudio e carrosséis para Telegram, agora com **Cloudflare D1/SQLite**, deduplicação por mídia, histórico por canal, envio parcial, `force=true`, consultas e batch de links.

## O que a v2.7 adiciona

- D1/SQLite como registro persistente das mídias enviadas.
- Identidade estável no formato `provider:media_id` sempre que possível.
- Fallback por SHA-256 curto da URL canônica quando o provedor não expõe um ID utilizável.
- Registro de URL, provider, media ID, tipo, quantidade de itens, metadata e timestamps.
- Registro por canal Telegram com primeiro/último `message_id`, chat retornado pelo Telegram, `send_count` e timestamps.
- Deduplicação **por mídia + canal** antes de baixar/remuxar/enviar.
- HTTP `409 Conflict` quando todos os canais solicitados já receberam a mídia.
- `force=true` para reenviar mesmo se já existir; o registro existente é atualizado e `send_count` é incrementado.
- Entrega parcial: se um canal falhar e outro funcionar, o válido continua sendo enviado e persistido.
- Resposta uniforme com IDs inseridos e canais não enviados.
- `POST /batch` para enviar vários links/posts em uma chamada com preflight D1 único, concorrência limitada, deduplicação por mídia+canal e resultados parciais item a item.
- `GET /media` e `GET /media/:key` para consulta do histórico.
- `POST /media/check` para consultar até 100 mídias/URLs em lote com **uma única query D1**, opcionalmente filtrada por até 100 canais.
- Fotos, vídeos, HLS, arquivos multipart e carrosséis continuam suportados.

---

## Arquitetura de persistência

A persistência é propositalmente pequena e normalizada:

### `media`

Uma linha por mídia lógica/post.

Campos principais:

- `media_key`: chave primária, por exemplo `twitter:1823456789012345678`.
- `provider`: `twitter`, `instagram`, `tiktok`, `generic`, etc.
- `provider_media_id`: ID nativo ou hash de fallback.
- `canonical_url`: URL usada para identidade depois de remover fragmentos e parâmetros de tracking conhecidos.
- `source_url` / `page_url`.
- `media_type`: `photo`, `video`, `audio`, `document` ou `album`.
- `media_count`: número de itens da publicação.
- `metadata_json`.
- `first_seen_at` / `updated_at`.

### `media_deliveries`

Uma linha por par `media_key + channel_id`.

Campos principais:

- `channel_id`: ID ou `@username` solicitado.
- `telegram_chat_id` e `telegram_chat_title` retornados pelo Telegram.
- `first_message_ids_json`.
- `last_message_ids_json`.
- `send_count`.
- `first_sent_at` / `last_sent_at`.

A tabela usa `PRIMARY KEY (media_key, channel_id)`. Um reenvio forçado não duplica a linha: atualiza a última entrega e incrementa `send_count`.

---

# Instalação

```bash
npm install
npm run typecheck
```

## 1. Criar o banco D1

```bash
npm run db:create
```

Equivalente a:

```bash
npx wrangler d1 create xtelegram-relay
```

O Wrangler retornará um `database_id` e um bloco de binding. Copie-o para `wrangler.jsonc` usando **exatamente** `RELAY_DB` como binding:

```jsonc
{
  "d1_databases": [
    {
      "binding": "RELAY_DB",
      "database_name": "xtelegram-relay",
      "database_id": "SEU-UUID-AQUI"
    }
  ]
}
```

## 2. Aplicar a migration

Produção/remoto:

```bash
npm run db:migrate:remote
```

Local:

```bash
npm run db:migrate:local
```

Listar migrations:

```bash
npm run db:migrations:list
```

A migration inicial está em:

```text
migrations/0001_media_delivery_history.sql
```

## 3. Configurar secrets

Nunca coloque token de bot ou `RELAY_TOKEN` em `wrangler.jsonc`.

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put RELAY_TOKEN
```

Destino default opcional:

```bash
npx wrangler secret put TELEGRAM_CHAT_ID
```

Para desenvolvimento local, copie:

```bash
cp .dev.vars.example .dev.vars
```

E preencha os valores reais.

## 4. Typecheck e deploy

```bash
npm run typecheck
npm run deploy
```

---

# Autenticação

Endpoints de envio, batch e consultas usam:

```http
Authorization: Bearer <RELAY_TOKEN>
```

---

# Identidade e deduplicação

A ordem de prioridade é:

1. `mediaKey` explícito.
2. `provider + mediaId` explícitos.
3. ID extraído da URL do provider.
4. Hash estável da URL canônica.

Exemplos automáticos:

```text
https://x.com/user/status/1234567890
→ twitter:1234567890

https://www.instagram.com/p/ABCxyz/
→ instagram:abcxyz

https://www.tiktok.com/@user/video/7512345678901234567
→ tiktok:7512345678901234567
```

Você pode controlar explicitamente a identidade:

```json
{
  "provider": "my-provider",
  "mediaId": "post-123"
}
```

Resultado:

```text
my-provider:post-123
```

Ou definir a chave completa:

```json
{
  "mediaKey": "archive:item-2026-0001"
}
```

## Sem `force`

Se a mídia já foi enviada para **todos** os canais pedidos:

```http
409 Conflict
```

Exemplo resumido:

```json
{
  "ok": false,
  "conflict": true,
  "media": {
    "key": "twitter:1234567890"
  },
  "channels": {
    "requested": ["-100111"],
    "inserted": [],
    "notSent": [
      {
        "channelId": "-100111",
        "reason": "already_sent"
      }
    ]
  }
}
```

Se apenas alguns canais já receberam a mídia, esses canais são pulados e os restantes continuam.

## Com `force=true`

```json
{
  "url": "https://x.com/user/status/1234567890",
  "channels": ["-100111"],
  "force": true
}
```

A mídia é reenviada, `send_count` é incrementado e os IDs da última mensagem são atualizados.

---

# Formato de resposta de canais

Nos caminhos persistidos, a resposta usa:

```json
{
  "channels": {
    "requested": ["-100111", "-100222"],
    "attempted": ["-100111", "-100222"],
    "inserted": ["-100111"],
    "notSent": [
      {
        "channelId": "-100222",
        "reason": "telegram_error",
        "error": "Bad Request: chat not found"
      }
    ]
  }
}
```

`inserted` contém apenas canais cuja entrega completa foi aceita pelo Telegram e persistida no D1.

### Status HTTP

- `200`: tudo solicitado foi enviado.
- `207`: houve sucesso parcial, por exemplo um canal válido e outro inválido ou já enviado.
- `409`: nenhum envio foi necessário porque todos os destinos já tinham a mídia.
- `400`: payload inválido.
- `401`: `RELAY_TOKEN` inválido/ausente em endpoints protegidos.
- `422`: mídia não pôde ser resolvida/preparada.
- `502`: Telegram recusou todas as entregas tentadas.

---

# API

## `GET /health`

```bash
curl https://SEU-WORKER/health
```

---

## `POST /send` · mídia direta

### Vídeo

```bash
curl -X POST https://SEU-WORKER/send \
  -H 'Authorization: Bearer SEU_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "mediaUrl": "https://example.com/video.mp4",
    "sourceUrl": "https://example.com/post/123",
    "provider": "generic",
    "mediaId": "123",
    "mediaType": "video",
    "caption": "Vídeo",
    "channels": ["-100111", "-100222"]
  }'
```

### Foto

```json
{
  "mediaUrl": "https://example.com/photo.jpg",
  "mediaType": "photo",
  "provider": "generic",
  "mediaId": "photo-123",
  "channel": "-100111"
}
```

Aliases aceitos para mídia direta:

- `mediaUrl`
- `photoUrl`
- `videoUrl`
- `fileUrl`
- `url`

### HLS

```json
{
  "mediaUrl": "https://example.com/master.m3u8",
  "sourceUrl": "https://example.com/watch/42",
  "mediaType": "video",
  "channel": "-100111",
  "mediaHeaders": {
    "Referer": "https://example.com/"
  }
}
```

O HLS é preparado apenas depois da verificação de duplicidade. Se o mesmo post já tiver sido enviado ao canal, o Worker evita download, decrypt, remux e upload desnecessários.

---

## `POST /send` · carrossel/álbum

```json
{
  "mediaItems": [
    {
      "mediaUrl": "https://example.com/1.jpg",
      "mediaType": "photo"
    },
    {
      "mediaUrl": "https://example.com/2.jpg",
      "mediaType": "photo"
    },
    {
      "mediaUrl": "https://example.com/3.mp4",
      "mediaType": "video"
    }
  ],
  "provider": "instagram",
  "mediaId": "ABCxyz",
  "sourceUrl": "https://www.instagram.com/p/ABCxyz/",
  "caption": "Post",
  "channels": ["-100111", "-100222"]
}
```

Também são aceitos:

```json
{
  "mediaUrls": [
    "https://example.com/1.jpg",
    "https://example.com/2.mp4"
  ]
}
```

E somente fotos:

```json
{
  "photoUrls": [
    "https://example.com/1.jpg",
    "https://example.com/2.jpg"
  ]
}
```

O Worker divide automaticamente álbuns grandes em lotes compatíveis com Telegram. Um canal só entra em `inserted` quando todos os lotes daquele canal foram aceitos.

---

## `POST /resolve`

Resolve uma URL social e retorna as mídias sem enviar.

```json
{
  "url": "https://x.com/user/status/1234567890"
}
```

---

## `POST /resolve-and-send`

Resolve Instagram/X/TikTok e envia o resultado.

```json
{
  "url": "https://www.instagram.com/p/ABCxyz/",
  "channels": ["-100111", "-100222"]
}
```

Com reenvio:

```json
{
  "url": "https://www.instagram.com/p/ABCxyz/",
  "channels": ["-100111"],
  "force": true
}
```

Fotos e vídeos múltiplos compatíveis são enviados como álbum. Um item único usa o fluxo de mídia simples.

---

# Batch

## `POST /batch` · envio real de vários posts/mídias

O `/batch` aceita até **50 itens** e pode enviar todos para um canal, vários canais compartilhados ou destinos diferentes por item.

Antes de iniciar o trabalho caro, o Worker resolve as identidades conhecidas e faz **uma única consulta D1** para descobrir quais combinações mídia+canal já existem. Canais já entregues são removidos do envio antes de download, resolução social, HLS/remux ou chamada ao Telegram.

O `/send` continua validando duplicidade novamente durante a entrega. O preflight do batch é uma otimização, não a única garantia de integridade.

### Lista simples de links

```json
{
  "links": [
    "https://x.com/user/status/111",
    "https://www.instagram.com/p/ABC/",
    "https://www.tiktok.com/@user/video/222"
  ],
  "channels": ["-100111", "-100222"]
}
```

Cada link é resolvido e enviado independentemente. Uma falha não cancela os outros itens.

### Batch para um único canal

```json
{
  "links": [
    "https://x.com/user/status/111",
    "https://x.com/user/status/222",
    "https://www.instagram.com/p/ABC/"
  ],
  "channel": "-100111"
}
```

### Batch com objetos completos

```json
{
  "items": [
    {
      "url": "https://x.com/user/status/111",
      "caption": "Post do X"
    },
    {
      "url": "https://www.instagram.com/p/ABC/",
      "channels": ["-100333"]
    },
    {
      "mediaUrl": "https://example.com/photo.jpg",
      "mediaType": "photo",
      "provider": "generic",
      "mediaId": "photo-9"
    },
    {
      "mediaItems": [
        { "mediaUrl": "https://example.com/a.jpg", "mediaType": "photo" },
        { "mediaUrl": "https://example.com/b.mp4", "mediaType": "video" }
      ],
      "provider": "generic",
      "mediaId": "album-10",
      "caption": "Carrossel"
    }
  ],
  "channels": ["-100111"],
  "metadata": {
    "source": "userscript"
  }
}
```

Suporta no mesmo lote:

- posts sociais que precisam de `/resolve-and-send` internamente;
- vídeo direto;
- foto direta;
- áudio/documento já suportado por `/send`;
- HLS;
- carrossel/álbum com foto+vídeo;
- destinos específicos por item;
- `caption`, `parseMode`, `metadata`, `mediaKey`, `provider` e `mediaId` por item.

### `force=true`

Global:

```json
{
  "links": [
    "https://x.com/user/status/111",
    "https://x.com/user/status/222"
  ],
  "channel": "-100111",
  "force": true
}
```

Ou apenas para um item:

```json
{
  "items": [
    { "url": "https://x.com/user/status/111" },
    { "url": "https://x.com/user/status/222", "force": true }
  ],
  "channel": "-100111"
}
```

`force=true` ignora a deduplicação para aquele item e permite reenvio, incrementando `send_count` após sucesso.

### Deduplicação do próprio batch

Se a mesma mídia aparecer duas vezes no mesmo request para o mesmo canal e `force` não estiver ativo, somente a primeira combinação é agendada. As repetições recebem:

```json
{
  "channelId": "-100111",
  "reason": "duplicate_in_batch"
}
```

Mídias que já estavam persistidas no D1 continuam usando:

```json
{
  "channelId": "-100111",
  "reason": "already_sent"
}
```

Isso evita a race em que dois itens idênticos passariam pelo mesmo preflight antes da primeira entrega ser gravada.

### Concorrência limitada

O batch deixou de ser estritamente sequencial. Por padrão processa **3 itens simultaneamente**, equilibrando velocidade, memória e chamadas externas.

Você pode reduzir ou aumentar dentro do limite seguro de 1 a 5:

```json
{
  "links": ["...", "...", "..."],
  "channel": "-100111",
  "concurrency": 2
}
```

Default: `3`  
Máximo: `5`

Para lotes pesados com HLS/remux grande, use `1` ou `2`. Para fotos/URLs diretas pequenas, `3` a `5` tende a ser adequado.

### Resposta

Exemplo de sucesso parcial:

```json
{
  "ok": true,
  "partial": true,
  "summary": {
    "requested": 4,
    "succeeded": 2,
    "failed": 2,
    "conflicts": 1,
    "insertedChannels": 3,
    "skippedAlreadySent": 2,
    "skippedDuplicateInBatch": 1,
    "preflightQueries": 1,
    "concurrency": 3
  },
  "results": [
    {
      "index": 0,
      "status": 200,
      "ok": true,
      "channels": {
        "requested": ["-100111", "-100222"],
        "attempted": ["-100222"],
        "inserted": ["-100222"],
        "notSent": [
          { "channelId": "-100111", "reason": "already_sent" }
        ]
      }
    }
  ]
}
```

A ordem de `results` é sempre a mesma ordem recebida em `items`/`links`.

### Status HTTP do batch

- `200`: todos os itens concluíram com sucesso;
- `207 Multi-Status`: houve sucesso e falha/conflito no mesmo lote;
- `409 Conflict`: nenhum item foi enviado porque todos conflitaram;
- `502`: nenhum item conseguiu ser enviado e não foi um lote puramente conflitante;
- `400`: payload global inválido.

### Regras de herança

- `channels` do item substitui os canais compartilhados naquele item;
- `force` do item substitui o `force` global;
- `caption`, `parseMode` e `metadata` podem ser globais ou por item;
- máximo de 50 itens por request;
- o preflight usa uma única query D1 para todas as identidades que já podem ser determinadas antes da resolução;
- itens cuja identidade só fique disponível após resolver a mídia continuam protegidos pela deduplicação do `/send`.

---

# Multipart

Quando o cliente já possui os bytes finais, envie `multipart/form-data` para `/send`.

Campos:

- `payload`: JSON com metadata/destinos.
- `file`: um ou mais arquivos.
- `files`: alias/repetido.
- `audioFile`: força aquele arquivo para `audio`.

Exemplo conceitual em JavaScript:

```js
const form = new FormData();

form.append("payload", JSON.stringify({
  provider: "twitter",
  mediaId: "1234567890",
  sourceUrl: "https://x.com/user/status/1234567890",
  channels: ["-100111", "-100222"],
  caption: "Post",
  force: false
}));

form.append("file", videoBlob, "video.mp4");

await fetch("https://SEU-WORKER/send", {
  method: "POST",
  headers: {
    Authorization: "Bearer SEU_TOKEN"
  },
  body: form
});
```

Para multipart, prefira sempre informar `mediaKey` ou `provider + mediaId` ou uma `sourceUrl` estável. Se nenhum identificador existir, o Worker usa um fallback derivado dos metadados dos arquivos.

---

# Consulta otimizada em lote: `POST /media/check`

Use este endpoint quando o cliente já possui uma lista de mídias e quer descobrir **antes de enviar** quais já existem no histórico e para quais canais foram entregues.

O endpoint:

1. valida até 100 entradas;
2. resolve todas com a mesma função `resolveMediaIdentity()` usada por `/send` e `/batch`;
3. remove `media_key` repetidas em memória;
4. executa **uma única query indexada no D1**;
5. reconstrói os resultados na mesma ordem da entrada.

A consulta usa `media.media_key` (PRIMARY KEY) e `media_deliveries(media_key, channel_id)` (PRIMARY KEY composta). Portanto não é necessário adicionar índices redundantes para este caminho.

## Lista simples de URLs

```bash
curl -X POST "https://SEU-WORKER/media/check" \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      "https://www.instagram.com/p/ABC123/",
      "https://x.com/user/status/1234567890",
      "https://www.tiktok.com/@user/video/7512345678901234567"
    ]
  }'
```

## Chaves ou IDs explícitos

```json
{
  "items": [
    { "mediaKey": "instagram:abc123" },
    { "provider": "twitter", "mediaId": "1234567890" },
    { "provider": "tiktok", "mediaId": "7512345678901234567" }
  ]
}
```

Uma string que não é URL deve ser uma `mediaKey` completa, por exemplo `twitter:1234567890`. Um `mediaId` isolado é ambíguo e deve ser enviado junto do `provider`.

## Verificar somente canais selecionados

```json
{
  "items": [
    "https://www.instagram.com/p/ABC123/",
    "https://x.com/user/status/1234567890"
  ],
  "channels": [
    "-1001111111111",
    "-1002222222222"
  ]
}
```

Quando `channels` é informado, o filtro é aplicado no próprio `LEFT JOIN`, reduzindo os rows retornados pelo D1.

Resposta resumida:

```json
{
  "ok": true,
  "results": [
    {
      "index": 0,
      "input": "https://www.instagram.com/p/ABC123/",
      "valid": true,
      "mediaKey": "instagram:abc123",
      "provider": "instagram",
      "mediaId": "abc123",
      "exists": true,
      "channels": [
        {
          "channelId": "-1001111111111",
          "sendCount": 2,
          "firstSentAt": "2026-08-10T12:00:00.000Z",
          "lastSentAt": "2026-08-11T15:00:00.000Z"
        }
      ],
      "requestedChannels": {
        "-1001111111111": {
          "sent": true,
          "sendCount": 2,
          "firstSentAt": "2026-08-10T12:00:00.000Z",
          "lastSentAt": "2026-08-11T15:00:00.000Z"
        },
        "-1002222222222": {
          "sent": false,
          "sendCount": 0,
          "firstSentAt": null,
          "lastSentAt": null
        }
      }
    }
  ],
  "meta": {
    "requested": 2,
    "valid": 2,
    "invalid": 0,
    "unique": 2,
    "found": 1,
    "missing": 1,
    "foundInputs": 1,
    "queryCount": 1,
    "channelFilterCount": 2
  }
}
```

### Entradas duplicadas

Se 100 entradas representarem apenas 40 mídias lógicas diferentes, o Worker consulta somente as 40 chaves únicas. A resposta continua contendo as 100 posições originais.

### Entradas inválidas

Entradas inválidas não impedem a consulta das válidas. Elas aparecem individualmente com:

```json
{
  "valid": false,
  "exists": false,
  "error": "Provide a mediaKey, provider + mediaId, or an HTTP(S) URL"
}
```

### Importante: check não substitui deduplicação do envio

`/media/check` é um pre-check de UX e planejamento. `/send` e `/batch` continuam verificando o banco novamente antes de enviar. Isso evita duplicação por race condition caso outra requisição envie a mídia entre o check e o send.

---

# Consultas D1 pela API

Todas exigem `Authorization`.

## Buscar mídia pela chave

```http
GET /media/twitter:1234567890
```

Ou:

```http
GET /media?key=twitter:1234567890
```

Resposta inclui mídia e canais:

```json
{
  "ok": true,
  "media": {
    "key": "twitter:1234567890",
    "provider": "twitter",
    "mediaId": "1234567890",
    "mediaType": "video",
    "mediaCount": 1
  },
  "deliveries": [
    {
      "channelId": "-100111",
      "telegramChatId": "-100111",
      "lastMessageIds": [987],
      "sendCount": 2
    }
  ]
}
```

## Buscar por provider + media ID

```http
GET /media?provider=twitter&mediaId=1234567890
```

## Buscar pela URL de origem

```http
GET /media?sourceUrl=https%3A%2F%2Fx.com%2Fuser%2Fstatus%2F1234567890
```

## Últimas mídias

```http
GET /media?limit=25
```

`limit` é limitado a 100.

---

# Consultas D1 via Wrangler

Exemplo remoto:

```bash
npx wrangler d1 execute xtelegram-relay --remote --command \
  "SELECT media_key, provider, provider_media_id, updated_at FROM media ORDER BY updated_at DESC LIMIT 20"
```

Canais de uma mídia:

```bash
npx wrangler d1 execute xtelegram-relay --remote --command \
  "SELECT channel_id, send_count, last_message_ids_json, last_sent_at FROM media_deliveries WHERE media_key = 'twitter:1234567890'"
```

Mídias enviadas para um canal:

```bash
npx wrangler d1 execute xtelegram-relay --remote --command \
  "SELECT media_key, send_count, last_sent_at FROM media_deliveries WHERE channel_id = '-100111' ORDER BY last_sent_at DESC"
```

---

# Performance e custo

A ordem do caminho de envio é importante:

1. Validar payload e canais.
2. Calcular `media_key`.
3. Fazer uma consulta D1 apenas para os canais solicitados.
4. Remover destinos já atendidos.
5. Se nada restar, responder `409` **antes** de preparar a mídia.
6. Preparar HLS/download uma única vez.
7. Enviar sequencialmente para os canais restantes.
8. Persistir apenas canais com sucesso usando `D1.batch()`.

Isso evita gastar CPU, memória, tráfego e chamadas Telegram com duplicatas conhecidas.

---

# HLS

O pipeline continua suportando:

- Master playlists e playlists aninhadas.
- Seleção de variante.
- Alternate audio renditions.
- `EXT-X-BYTERANGE`.
- `EXT-X-MAP`.
- AES-128 identity via Web Crypto.
- MPEG-TS → fragmented MP4 com `mux.js`.
- fMP4/CMAF compatível.
- Download com concorrência limitada.
- LL-HLS snapshots onde possível.

Variáveis:

### `MAX_MEDIA_BYTES`

Default no `wrangler.jsonc`:

```text
32000000
```

### `HLS_CONCURRENCY`

Default:

```text
4
```

### `HLS_MAX_MEDIA_BYTES`

Opcional.

### `MULTIPART_MAX_TOTAL_BYTES`

Opcional.

---

# Arquivos importantes

```text
src/index.ts
  Rotas, validação, batch, deduplicação e respostas.

src/db.ts
  Identidade, consultas D1 e persistência.

migrations/0001_media_delivery_history.sql
  Schema SQLite/D1.

src/social.ts
  Resolução social.

src/media.ts
  Preparação de arquivo/HLS.

src/telegram.ts
  Telegram Bot API.

src/hls/*
  Parser, downloader, decoder, resolver e remuxer HLS.
```

---

# Desenvolvimento

```bash
npm run db:migrate:local
npm run dev
```

Typecheck:

```bash
npm run typecheck
```

Build:

```bash
npm run build
```

Deploy:

```bash
npm run deploy
```

---

# Observação sobre segurança

Se um token real de Telegram ou relay já tiver sido commitado/publicado anteriormente, rotacione-o. A configuração desta versão deixa secrets fora de `wrangler.jsonc` e fornece apenas `.dev.vars.example` para desenvolvimento local.
