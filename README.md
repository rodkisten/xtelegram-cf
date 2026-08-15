# xtelegram-cf · Telegram Media Relay v2.10.4

Cloudflare Worker em TypeScript para resolver, preparar e enviar vídeos, fotos, áudio e carrosséis para Telegram, agora com **Cloudflare D1/SQLite**, deduplicação por mídia, histórico por canal, envio parcial, `force=true`, consultas e batch de links.

## Correção da v2.10.4 · rastreio seguro de ponta a ponta

- Cada requisição recebe `X-Relay-Trace-Id`, preservado em `/batch`, `/resolve-and-send` e nos envios internos. O AIO mostra esse identificador no Console quando o Debug do script está ligado, permitindo localizar a requisição exata no Worker.
- Com `RELAY_DEBUG=true`, o Worker emite logs estruturados para entrada, validação, resolução social, canonicalização do X, preflight D1, claims, preparação de mídia, Telegram, persistência e liberação de claim.
- Os logs não imprimem bearer tokens, cookies, headers secretos nem query strings de URLs CDN assinadas. URLs são reduzidas a origem + pathname.
- Nenhuma migration D1 nova é necessária.

## Correção da v2.10.3 · contrato de canais e URL canônica do X

- Resoluções sociais que enviam uma ou mais mídias individuais agora retornam o contrato agregado `channels` no topo de `/resolve-and-send`. O resultado de `/batch` preserva os canais realmente cobertos, inseridos, já enviados ou com falha; o cliente não interpreta mais uma entrega válida como “nenhum canal recebeu”.
- URLs internas `https://x.com/i/status/:id`, comuns no viewer imersivo e em Bookmarks virtualizados, são convertidas para `https://x.com/@autor/status/:id` antes de Twirrl/DTwitter. O Worker busca o autor em syndication pública e aceita o handle capturado pelo cliente somente como último fallback.
- O enriquecimento de metadata do X não usa `i` como se fosse username. Não há migration D1 nova.

## Correção da v2.10.2 · vídeo X/Twitter preservado

- Vídeo direto de video.twimg.com deixa de depender da busca remota do Telegram quando o arquivo cabe no limite seguro do Worker. O Worker baixa os bytes com Referer de X e faz sendVideo/attach com o arquivo original.
- Em álbuns que contêm esse vídeo, o Relay tenta o grupo attach primeiro, mantendo a ordem e o álbum nativo. Se a preparação não couber no orçamento, volta ao caminho URL-first sem criar side effect; respostas ambíguas nunca são repetidas.
- O resolver Twirrl preserva uma variante por slot de mídia e, quando recebe dimensões, prioriza a mesma proporção do conteúdo em vez de uma variante com mais pixels mas aspecto incompatível.
- A configuração distribuída não contém tokens/chats embutidos. Configure TELEGRAM_BOT_TOKEN, RELAY_TOKEN e, se necessário, TELEGRAM_CHAT_ID como secrets do Wrangler.
- Não há migration D1 nesta versão.

## Correção da v2.10.1 · carrosséis mistos

- **Foto + vídeo deixam de falhar como post inteiro:** o Relay tenta `sendMediaGroup` por URL, repete o mesmo grupo como `attach://` multipart usando os headers de cada mídia e, somente após uma rejeição definitiva (`400`, `413` ou `415`) das duas opções, envia `sendPhoto`/`sendVideo` na ordem original.
- O álbum nativo é mantido quando o Telegram aceita o grupo. A recuperação ordenada é exclusiva de lotes mistos e existe para entregar o conteúdo quando a própria Bot API recusa a combinação.
- Se o orçamento combinado do multipart for ultrapassado, a recuperação prepara e envia uma mídia por vez — preserva `Referer`/`User-Agent`, limita memória do Worker e não perde o carrossel.
- Falhas de rede e 5xx não fazem tentativa alternativa, evitando retransmissões ambíguas. Falhas parciais preservam o claim D1 até o TTL para não duplicar os itens já aceitos.
- `telegram.deliveries` agora inclui `transport`, `fallbackAttempted`, `orderedFallbackAttempted`, `attemptCount` e `fallbackError` para diagnóstico.

## O que a v2.10 adiciona

- **Enriquecimento social no próprio Worker** para URLs canônicas de Instagram e X/Twitter. O client não precisa mais abrir a publicação nem montar o caption.
- Antes de chamar a Bot API, o relay tenta obter `@autor` e caption/texto diretamente da publicação. Para X, usa o endpoint público de syndication como estratégia primária e o HTML/meta tags como fallback; para Instagram, usa o HTML público, Open Graph e JSON embutido.
- Caption Telegram social fica no formato **origem + @ + caption + link Origem**. O conteúdo é escapado e enviado em `parse_mode=HTML`.
- Se nenhuma metadata confiável for recuperada, o caption vira **somente a URL original da publicação**, sem reaproveitar título/texto potencialmente incorreto enviado pelo client.
- O enrichment é compartilhado por `/send`, álbuns, multipart, `/batch` e `/resolve-and-send`.
- Resultados de metadata são deduplicados em memória por URL, possuem cache curto de 10 minutos e chamadas concorrentes para a mesma publicação compartilham a mesma Promise.
- `SOCIAL_METADATA_TIMEOUT_MS` controla o timeout de rede (default 5 s, mínimo 1 s, máximo 12 s).
- A metadata persistida no D1 ganha `socialPlatform`, `socialOrigin`, `socialSourceUrl`, `socialAuthor`, `socialCaption`, `socialMetadataStrategy` e `socialMetadataEnriched`.

Exemplo de caption enriquecido:

```text
Instagram

@usuario

Texto original da publicação

Origem
```

Se o Instagram/X bloquear a leitura ou a publicação não expuser metadata pública:

```text
https://www.instagram.com/reel/ABC123/
```

---

## O que a v2.9 adiciona

- **Claims atômicos por mídia + canal** antes do side effect externo no Telegram. Requests concorrentes deixam de passar juntos pela janela `check → send → persist`; o segundo recebe `delivery_in_progress` enquanto o primeiro possui o claim.
- `delivery_claims` usa TTL configurável por `DELIVERY_CLAIM_TTL_SECONDS` (30 min por padrão) para cobrir resolução/HLS lentos. Claims de canais com falha conhecida são liberados; se o Telegram respondeu sucesso mas a persistência D1 falhar, o claim do canal bem-sucedido é mantido até expirar para evitar um reenvio externo imediato com estado de persistência incerto.
- `/media/check` liga arrays como JSON e expande com `json_each()`, mantendo constante a quantidade de parâmetros da prepared statement mesmo com 100 mídias + canais.
- IDs nativos de provider agora são tratados como **opacos e case-sensitive**. Chaves antigas lossily-normalized continuam aceitas como aliases e são reutilizadas quando já existem, evitando dividir o histórico de uma mesma publicação.
- Métricas de batch agora incluem claims, round trips/statements D1, resoluções, tentativas Telegram e timings.
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
- `delivery_in_progress` identifica um canal que já está reservado por outro request concorrente; não é `telegram_error` e não deve ser forçado automaticamente.
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

### `delivery_claims`

Reserva por `media_key + channel_id` adquirida **antes** de chamar a Bot API. O claim impede dois requests concorrentes de enviarem a mesma mídia para o mesmo canal, inclusive quando `force=true`. Claims expirados são limpos automaticamente. Depois de falha conhecida, o claim é liberado; depois de sucesso Telegram, ele só é liberado quando a persistência D1 correspondente foi confirmada. Se essa persistência falhar, o claim permanece até o TTL como proteção conservadora. `force=true` ignora apenas o histórico já persistido; ele **não** ignora um claim ativo de outra request.

A migração `0002_delivery_claims.sql` cria a tabela e o índice por `expires_at`.

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

As migrations estão em:

```text
migrations/0001_media_delivery_history.sql
migrations/0002_delivery_claims.sql
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

### Debug temporário do Worker

Para investigar um envio sem deixar logs detalhados ligados permanentemente, adicione uma variável de ambiente no Cloudflare Worker:

```text
RELAY_DEBUG=true
```

Depois de reproduzir o problema, consulte os logs pelo `X-Relay-Trace-Id` retornado pela resposta. Desative/remova a variável ao terminar a investigação.

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
→ instagram:ABCxyz

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

`mediaHeaders` pode ser enviado em cada item (preferencial) ou no nível raiz do payload como fallback. O Worker usa esses headers quando precisa baixar o item no fallback multipart; o caminho normal continua URL-first.

Para um carrossel com foto + vídeo, `metadata.allowOrderedSingleFallback` pode ser definido como `false` para desabilitar a recuperação final. O padrão é `true`: ela só ocorre após rejeições definitivas dos dois transportes de álbum e preserva a ordem original.

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

O `/send` continua fazendo o guard final. Na v2.9 esse guard adquire um **claim atômico** por mídia+canal antes de chamar o Telegram. O preflight do batch permanece uma otimização para evitar trabalho caro; o claim é a proteção de concorrência.

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

### Métricas v2.9

A resposta de `/batch` inclui, em `summary`, além dos contadores de resultado:

- `preflightQueries`
- `identityAliasQueries`
- `claimQueries`
- `dbRoundTrips` / `dbStatements`
- `mediaResolutions`
- `telegramAttempts`
- `preflightDurationMs` / `processingDurationMs` / `durationMs`

Essas métricas são de diagnóstico/custo e não alteram a ordem dos resultados.

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

`force=true` ignora a deduplicação histórica para aquele item e permite reenvio, incrementando `send_count` após sucesso. A proteção contra envio concorrente e duplicata dentro do mesmo batch continua ativa.

### Deduplicação do próprio batch

Se a mesma mídia aparecer duas vezes no mesmo request para o mesmo canal, somente a primeira combinação é agendada, inclusive com `force=true`. `force` significa “reenviar histórico”, não “duplicar o mesmo item dentro da mesma request”. As repetições recebem:

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
4. serializa chaves e canais em arrays JSON e expande com `json_each()`;
5. executa **uma única query indexada no D1**, sem crescer o número de parâmetros bound;
6. reconstrói os resultados na mesma ordem da entrada.

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
      "mediaKey": "instagram:ABC123",
      "provider": "instagram",
      "mediaId": "ABC123",
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

`/media/check` é um pre-check de UX e planejamento. `/send` e `/batch` não confiam nele como lock. Antes do side effect externo, qualquer envio adquire `delivery_claims(media_key, channel_id)`. Em `force=true`, o histórico é ignorado, mas o lock concorrente continua obrigatório. Se outro request já possui o claim, o canal volta como `delivery_in_progress`; se já existe histórico, volta como `already_sent`.

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

# Arquitetura do código

`src/index.ts` é deliberadamente mínimo e só exporta o Worker. O fluxo HTTP foi separado por responsabilidade para evitar que novas features recriem um monólito:

```text
src/index.ts
  Entry point de 1 linha.

src/app/worker.ts
  Error boundary global do Worker.

src/app/router.ts
  Routing, OPTIONS e autorização centralizada.

src/http/*
  Auth, CORS/JSON responses e requests internos.

src/validation/*
  Normalização/validação compartilhada de payloads, canais, mídia e identidade.

src/services/channels.ts
  Destinos Telegram e compatibilidade TELEGRAM_CHAT_ID/TELEGRAM_CHANNEL_ID.

src/services/delivery-plan.ts
  Identidade, claims atômicos, lifecycle de claims e proteção contra retries duplicados.

src/services/telegram-delivery.ts
  Entrega de mídia preparada e formatação de resultados Telegram.

src/routes/send/index.ts
  Dispatcher JSON / album / multipart.

src/routes/send/single.ts
  Envio de mídia única/HLS.

src/routes/send/album.ts
  Carrossel/sendMediaGroup, chunking 2-10 e fallback URL → attach:// → foto/vídeo ordenados para lotes mistos rejeitados.

src/routes/send/multipart.ts
src/routes/send/multipart-utils.ts
  Uploads multipart e utilitários de arquivo.

src/routes/batch.ts
  Preflight D1, dedupe do próprio batch e concorrência limitada.

src/routes/resolve.ts
  Resolução social e resolve-and-send.

src/routes/media/check.ts
src/routes/media/query.ts
  Lookup em lote e histórico.

src/db.ts
  Identidade, claims, consultas D1 e persistência.

src/social.ts
  Resolução social.

src/media.ts
  Preparação de arquivo/HLS.

src/telegram.ts
  Telegram Bot API.

src/hls/*
  Parser, downloader, decoder, resolver e remuxer HLS.
```

## Correções de robustez da v2.9

- `/resolve` e `/resolve-and-send` agora passam pela mesma autorização central das demais rotas protegidas; não há mais auth comentada dentro de handlers.
- `force=true` continua reenviando histórico, mas agora também adquire claim atômico e não atravessa uma entrega concorrente.
- `DELIVERY_CLAIM_TTL_SECONDS` voltou a ser efetivamente aplicado aos claims.
- `SOCIAL_METADATA_TIMEOUT_MS` controla o timeout do fetch server-side de metadata social (default `5000`).
- `TELEGRAM_CHANNEL_ID` é aceito como alias legado de `TELEGRAM_CHAT_ID`, corrigindo projetos que usavam o nome antigo no Wrangler.
- Resoluções sociais heterogêneas com múltiplos itens ganham identidade estável por item, evitando colisão de todos os filhos no mesmo `media_key`.
- `/resolve-and-send` não aborta mais toda a resolução no primeiro item que falha: retorna `207` quando há sucesso parcial.
- Itens do `/batch` são isolados por error boundary; uma exceção inesperada em um item não derruba os resultados do lote inteiro.
- `force=true` não permite duplicar a mesma combinação mídia+canal duas vezes dentro de um único batch.
- Álbuns e multipart param de enviar novos chunks/arquivos para um canal após a primeira falha, reduzindo side effects parciais.
- Se um álbum/multipart ficar parcialmente enviado a um canal, o claim desse canal permanece até TTL em vez de ser liberado imediatamente e permitir um retry duplicar os chunks que já chegaram.
- Multipart sem `mediaKey`, `mediaId` ou URL estável não usa mais `nome+tamanho+MIME` como identidade, pois isso causava falsos conflitos; nesses casos a identidade é request-scoped.
- Secrets foram removidos de `wrangler.jsonc`; use Wrangler secrets ou `.dev.vars` local.

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

## Caption-first reconciliation (v2.11)

Media state is no longer coupled to Telegram delivery. A post can be registered before its downloadable media URL is known:

- `pending`: identity/caption is known, but media is not resolved yet.
- `ready`: media has been resolved/prepared and can be delivered.
- `sent`: at least one Telegram delivery was persisted.

`POST /media/check` remains a normal status check, but item objects may also carry `caption`, `parseMode` and `metadata`. When those fields are present the check becomes an idempotent reconciliation operation.

```json
{
  "items": [
    {
      "provider": "twitter",
      "mediaId": "1234567890",
      "sourceUrl": "https://x.com/user/status/1234567890",
      "caption": "<b>@user</b>\nPost caption",
      "parseMode": "HTML",
      "metadata": {
        "author": "@user"
      }
    }
  ],
  "channels": ["-1001234567890"]
}
```

If the media has never been sent, the caption is stored and the media stays `pending`. If delivery history already contains Telegram `chat_id` + `message_id`, the relay persists the caption and calls `editMessageCaption` for the stored delivery. Album captions target the first message ID of the latest persisted album delivery.

Explicit captions always win over server-side social metadata scraping. Scraping is now a fallback used only when the caller did not already provide a caption.
