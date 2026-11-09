# Relay → Fila de reposts no X → Scriptable (sem X API)

Esta integração é **assistida**, não um bot que clica no botão de publicar no site do X.
As regras atuais do X proíbem automatizar a interface web com scripts; o envio final
permanece sob a ação explícita do titular da conta. O Scriptable não precisa guardar
cookies do X, interceptar endpoints privados, nem manter a interface aberta.

## Fluxo

1. Userscript/Shortcut chama a rota normal do Relay para enviar vídeo ao Telegram.
2. Com `x_repost: true` no JSON, o Relay insere automaticamente um item após a entrega
   bem-sucedida. A configuração padrão desta branch é `X_REPOST_AUTO_QUEUE = "true"`,
   portanto **não precisa alterar o Scriptable XTelegram v3.5.5 existente**, nem o
   fluxo do Shortcut que chama `/resolve-and-send` ou `/media/register`.
3. O registro é deduplicado pelo ID do post original no X; a legenda usa `@/usuario`
   e preserva hashtags. Intervalos iniciais ficam entre 45 e 75 minutos. A fila não
   publica vários posts simultaneamente.
4. O Scriptable (ou o Atalhos) consulta a fila, baixa o MP4 do R2 caso disponível
   e abre o compartilhamento do iOS. A legenda é copiada para colar no compositor.
5. Só após o usuário confirmar que publicou, o item vira `posted`.

**Importante**: disponibilizar a mídia ao Scriptable no horário agendado requer uma
cópia persistente. O bucket privado `x-repost-media` foi criado na Cloudflare e
está associado ao binding `X_REPOST_MEDIA` nesta branch. O Relay tenta armazenar MP4s
resolvidos de `video.twimg.com` se Content-Length existir e for de até 80 MB.
O endpoint `PUT /x/repost/queue/:id/media` permite upload do MP4 pelo Shortcuts
com Content-Type `video/mp4` e Content-Length, no mesmo token do Relay.
Sem R2, o Scriptable tenta usar a URL original temporária.

## Setup no repositório

- Execute `npm run db:migrate:remote` **antes** do deploy do Worker.
- O repositório já usa Wrangler e migrações D1; mantenha esse fluxo de publicação.
- Esta branch define `X_REPOST_AUTO_QUEUE = "true"`, conforme solicitado.
  Para desativar a captura automática, troque para `"false"`.
  Isso não automatiza publicações no X, apenas cria itens na fila.
- Opcional: configure um segredo/variável `X_REPOST_NOTIFY_CHAT_ID` para receber
  aviso no Telegram a cada item que venceu seu horário. O cron roda a cada 10 min.
- Para guardar vídeos, a branch já contém o binding no wrangler.toml:

```toml
[[r2_buckets]]
binding = "X_REPOST_MEDIA"
bucket_name = "x-repost-media"
```

O bucket privado já existe. O acesso aos arquivos passa pelo Worker autenticado.
O uso do R2 pode gerar custos acima da franquia gratuita.

## Setup no Scriptable

1. **Preserve seu cliente XTelegram Scriptable v3.5.5** e o atalho existente,
   com os modos `route`, `send`, `fallback` e `register_compressed`. O Relay
   detecta automaticamente a entrega e enfileira o post do X pelo backend.
2. Crie um script auxiliar chamado **Relay X Queue** com o conteúdo
   de `scriptable/Relay-X-Queue.js`.
3. Execute uma vez no aplicativo. A URL `https://xtelegram-cf.migos.club` já é o padrão.
   Informe o `RELAY_TOKEN` somente se ele não estiver no Keychain do Scriptable.
   O token fica no Keychain local do Scriptable, não no código.
4. No Atalhos iOS, use a ação do Scriptable **Run Script** com parâmetro `check`
   em automações de horário fixo, por exemplo 10h, 13h, 16h, 19h. Ela emite
   notificação local para o primeiro item vencido e ainda não notificado.
5. Toque na notificação, ou execute `Relay X Queue` normalmente: ele reservará
   **um** item por vez, copiará a legenda e abrirá o compartilhamento do vídeo.
6. Após o post aparecer no X, confirme. Se desistir ou der erro, adie o item.

Para o Shortcut já existente (XTelegram v3.5.5), **não é necessária nenhuma
etapa adicional de enfileiramento** quando `X_REPOST_AUTO_QUEUE=true`.
Se quiser usar um worker com captura automática desativada, após a entrega Telegram você pode
passar ao Scriptable um dicionário com `mode: "enqueue"`, `url`, `caption` e
`hashtags`. Isso chama `POST /x/repost/queue`, sem exigir `x_repost` na
requisição original. As duas maneiras são idempotentes por ID do post.

## API privada do Relay

Todas usam `Authorization: Bearer RELAY_TOKEN`:

| Método | Rota | Ação |
| --- | --- | --- |
| POST | `/x/repost/queue` | Enfileirar `{url, caption, hashtags, mediaUrl?}` |
| GET | `/x/repost/queue?status=queued` | Consultar registros |
| POST | `/x/repost/claim` | Reservar um item vencido por até 2 h |
| PATCH | `/x/repost/queue/:id` | `posted`, `cancel`, `reschedule`, `release` |
| PUT | `/x/repost/queue/:id/media` | Salvar MP4 no R2 |
| GET | `/x/repost/queue/:id/media` | Baixar MP4 privado |

`posted` e `release` requerem `claimToken`. O modo `reschedule` deve
receber `scheduledAt` em segundos UNIX, com ao menos 10 min de antecedência.

## Segurança e limitações

- A fila não publica nem finge que um post foi feito, e não automatiza ações no DOM.
- iOS não garante que uma tela do Scriptable abra, faça login e compartilhe uma mídia
  sem interação, em especial com o aparelho bloqueado.
- O arquivo de vídeo deve ter direitos de redistribuição autorizados.
- Não armazene tokens do Relay ou cookies do X no repositório.
- A contagem de 280 caracteres é uma aproximação; o compositor do X é a fonte final
  para validação de comprimento e outras restrições.
