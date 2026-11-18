# Notify! + Telegram: GitHub Actions Webhooks

The relay now supports text notifications independently from media uploads.

## Notification Studio (interface visual)

Abra **GET /notifications** no mesmo domínio do Worker (também aceita /notifications/).
É uma página HTML responsiva servida diretamente pelo relay, sem build de frontend e sem autenticação para a prévia.

- Editor Markdown com barra de formatação, tipos de evento, título, chat ID, tópico e modo silencioso.
- Conversão local do Markdown para as tags HTML aceitas pela Telegram Bot API, com escapes de texto/URLs.
- Mockup interativo de uma conversa do Telegram para iOS, com bolha do bot e botões inline.
- Até 3 linhas de 3 botões HTTPS, com validação de URL e tamanho da mensagem.
- Geradores com syntax highlighting e botão de copiar: cURL, Fetch para Node.js e JSON body.
- Exemplos de cURL/Fetch usam NOTIFICATION_API_TOKEN do **ambiente de execução**, nunca um valor do Worker.
- O editor não envia mensagens, não lê secrets e não persiste o conteúdo. O envio real continua exclusivamente pelo POST /notifications/send autenticado.

A prévia é uma simulação visual e não reproduz fielmente cada versão do Telegram nem todas as particularidades do parser da Bot API. ESMs de Marked/Highlight.js são carregados via esm.sh, com fallback para texto simples caso o CDN esteja indisponível.

## Endpoints

| Endpoint | Authentication | Purpose |
| --- | --- | --- |
| GET /notifications | Nenhuma (HTML público, sem tokens) | Compor e visualizar mensagens e gerar cURL/Fetch |
| POST /notifications/send | Authorization: Bearer NOTIFICATION_API_TOKEN | Deliver text to a Telegram chat or forum topic |
| POST /webhooks/github | X-Hub-Signature-256 (GitHub HMAC SHA-256) | Envia atualizações de workflow para Notify! e alertas de falha para Telegram |

Both return JSON with ok and error details, and preserve X-Relay-Trace-Id response correlation. Never share bot tokens or API secrets in client-side code.

### 1. Configure Cloudflare Worker

    npx wrangler secret put NOTIFICATION_API_TOKEN
    npx wrangler secret put GITHUB_WEBHOOK_SECRET

Use two independent, high-entropy random secrets. The GitHub webhook secret must match the Secret field in GitHub's webhook settings.

Set nonsecret destinations in Wrangler vars:

    NOTIFICATION_CHAT_ID="-1001234567890:73"
    GITHUB_WEBHOOK_CHAT_ID="-1001234567890:73"
    GITHUB_NOTIFY_ACTIONS="requested,in_progress,completed"

The destination supports numeric IDs, Telegram @channel usernames or -100...:73 for forum topics. For private messages, start the bot (/start) and use your own numeric Telegram chat ID. Bots cannot initiate a private chat before the user opens them.

GITHUB_WEBHOOK_CHAT_ID falls back to NOTIFICATION_CHAT_ID, then the legacy TELEGRAM_CHAT_ID. Set an explicit GitHub destination to avoid notifications in a media-only channel.

Production deployments **automatically migrate remote D1 before building**.
Use one command after installing dependencies (only when you intend to publish):

    npm ci
    npm run typecheck
    npm test
    npm run deploy

`npm run deploy` executes `db:migrate:remote → build → wrangler deploy`.
If a D1 migration fails, the build and Worker publication stop immediately.
Wrangler records successful migrations; subsequent deploys apply only pending files.

Do not place real API tokens in wrangler.toml or GitHub files. Rotate previously committed credentials and replace them with Wrangler secrets.

### 2. Send text via API

    curl --fail-with-body -X POST "https://YOUR-WORKER.example/notifications/send" \
      -H "Authorization: Bearer $NOTIFICATION_API_TOKEN" \
      -H "Content-Type: application/json" \
      -d '{"chat_id":"-1001234567890:73","body":"✅ Build concluído!","parse_mode":"HTML","disable_notification":false,"buttons":[[{"text":"🔎 Abrir run","url":"https://github.com/owner/repo/actions"}]]}'

The JSON object accepts:

- body (required) or text: 1-4096 characters
- chat_id / chatId: optional if NOTIFICATION_CHAT_ID is configured
- message_thread_id / messageThreadId: integer topic ID, optional
- parse_mode / parseMode: HTML or MarkdownV2, default plain text
- disable_notification: optional boolean
- buttons: optional array of up to 3 rows of up to 3 HTTPS URL buttons

Success example:

    { "ok": true, "chat_id": "-1001234567890", "message_thread_id": 73, "message_id": 456 }

Telegram errors return HTTP 502, stage=telegram, and telegramStatus when available. Unauthenticated requests receive HTTP 401.

### 3. Native GitHub webhook setup

For each repository, or at organization level (with the appropriate permissions):

1. Open Settings > Webhooks > Add webhook.
2. Payload URL: https://YOUR-WORKER.example/webhooks/github
3. Content type: application/json
4. Secret: same value as GITHUB_WEBHOOK_SECRET
5. Choose individual events, select Workflow runs, and activate the webhook.

The endpoint verifies GitHub's signature against the raw bytes BEFORE parsing JSON. Unsigned or incorrectly signed requests return 401.

### Seleção de workflows e roteamento

**Configuração atual:** `GITHUB_NOTIFY_ACTIONS="requested,in_progress,completed"` no `wrangler.toml`. Essa variável filtra **ações do evento** `workflow_run`, não nomes de workflows.

| Evento / conclusão | Notify! | Telegram |
| --- | --- | --- |
| `requested` | Inicia Live Activity | Não |
| `in_progress` | Atualiza ou inicia Live Activity | Não |
| `completed: success` | Finaliza atividade e envia push | Não |
| `completed: failure` | Finaliza atividade e envia push | **Sim** |
| `completed: timed_out` | Finaliza atividade e envia push | **Sim** |
| `completed: startup_failure` | Finaliza atividade e envia push | **Sim** |
| `completed: action_required` | Finaliza atividade e envia push | **Sim** |
| `completed: cancelled` | Finaliza atividade e envia push | Não |
| Outras conclusões de `completed` | Finaliza atividade e envia push | Não |

- **Filtro por arquivo YAML:** `GITHUB_NOTIFY_WORKFLOWS` aceita caminhos exatos e globs sobre `workflow_run.path`. A configuração é opcional e, quando ausente, aceita todos os workflows.
- Padrões positivos incluem; padrões iniciados por `!` excluem e têm prioridade. Sem padrões positivos, todos são incluídos exceto os excluídos. Se um filtro estiver configurado e o evento não trouxer `workflow_run.path`, o evento é ignorado.
- Os padrões são separados por vírgula ou quebra de linha; `*` corresponde a caracteres dentro de um diretório, `**` atravessa diretórios e `?` corresponde a um caractere. Não é necessário consultar a API do GitHub.

```toml
GITHUB_NOTIFY_WORKFLOWS = """
.github/workflows/*.yml
.github/workflows/*.yaml
!.github/workflows/repair-lockfile.yml
!.github/workflows/cleanup-*.yml
"""
```

**Exemplo com exclusões apenas:** `GITHUB_NOTIFY_WORKFLOWS = "!.github/workflows/repair-lockfile.yml"`.
- **Não existe filtro por branch, repositório ou arquivo YAML no Worker.** O escopo dos repositórios é determinado pelos webhooks instalados no GitHub.
- Apenas o evento `workflow_run` é aceito. Eventos `workflow_job` e progresso individual dos steps não são processados por esse webhook; o progresso exibido é do workflow.
- Para receber somente conclusões, configure `GITHUB_NOTIFY_ACTIONS="completed"`. Isso desativa as atualizações de início e andamento.
- A autenticação HMAC é obrigatória, e o D1 deduplica o mesmo `X-GitHub-Delivery`.
- O Telegram continua configurado com `GITHUB_WEBHOOK_CHAT_ID` (fallback para `NOTIFICATION_CHAT_ID` e `TELEGRAM_CHAT_ID`), mas só recebe alertas das conclusões de falha listadas acima.

### Configuração Notify!

Configure as credenciais do dispositivo **como secrets do Cloudflare Worker**, não em arquivos versionados:

```sh
npx wrangler secret put NOTIFY_DEVICE_ID
npx wrangler secret put NOTIFY_TOKEN
```

O serviço usa `src/services/notify.ts` diretamente, sem uma chamada HTTP interna ao próprio Worker. Se as credenciais estiverem ausentes, o canal Notify! é ignorado; se o Notify! falhar, o webhook registra a falha e ainda tenta enviar o alerta Telegram quando a conclusão exigir.

- **Ícone personalizado:** `https://raw.githubusercontent.com/rodkisten/xtelegram-cf/refs/heads/main/public/IMG_9928.png`
- **Prioridade solicitada:** `timeSensitive=true` nos parâmetros de envio, e `timeSensitive: true` no corpo dos pushes `notify-json`. A apresentação final depende do suporte da API Notify! e das permissões do iOS.
- **Live Activity:** identificador armazenado na tabela D1 `github_notify_activities`, separado por repositório, execução e tentativa.
- **Migração:** `migrations/0010_github_notify_activities.sql`, aplicada automaticamente por `npm run deploy`.
- **Links:** a notificação aponta para a execução do GitHub Actions.
- **Sem garantias de entrega:** falhas de rede ou indisponibilidade do Notify! podem impedir notificações; não interpretar uma resposta do webhook como confirmação visual no iPhone.

Mensagens de falha no Telegram incluem nome do repositório e workflow, execução/tentativa, branch, commit e link para o run.

Repeated GitHub deliveries of the same X-GitHub-Delivery ID are deduplicated in D1. Failed attempts can retry; abandoned claims become retryable after five minutes. After ambiguous Telegram network failures, a redelivery may still produce a duplicate.

### 4. Alternative: manual notification step inside a GitHub Actions workflow

If native webhooks are unavailable, add NOTIFICATION_API_TOKEN to the repo's Actions secrets and use an optional post-build step:

    - name: Notify Telegram
      if: always()
      continue-on-error: true
      env:
        NOTIFY_TOKEN: ${{ secrets.NOTIFICATION_API_TOKEN }}
        RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
        STATUS: ${{ job.status }}
      run: |
        jq -n --arg body "GitHub Actions: $STATUS" \
          --arg url "$RUN_URL" \
          '{body:$body,buttons:[[{text:"🔎 Abrir execução",url:$url}]]}' > notification.json
        curl --fail-with-body --retry 2 \
          -X POST "https://YOUR-WORKER.example/notifications/send" \
          -H "Authorization: Bearer $NOTIFY_TOKEN" \
          -H "Content-Type: application/json" \
          --data-binary @notification.json

Prefer the native webhook for consistent results across all workflow files without editing every workflow YAML.


## Editar mensagens sem poluir o Telegram

O relay permite **uma única mensagem por execução**. A primeira chamada
envia `sendMessage`, e as próximas atualizam o mesmo `message_id` via
`editMessageText` automaticamente:

```json
{
  "notification_key": "workflow:rodkisten/photointel:41476496429",
  "sequence": 100102,
  "body": "🔄 Workflow em execução: 2/5",
  "chat_id": "-1001234567890:73",
  "parse_mode": "HTML",
  "buttons": [[{"text":"Ver workflow","url":"https://github.com/rodkisten/photointel/actions"}]]
}
```

Faça `POST /notifications/send` com `Authorization: Bearer NOTIFICATION_API_TOKEN`.
Envie a mesma chave nas atualizações e aumente `sequence` progressivamente;
o relay ignora versões atrasadas e retorna `stale: true`. A API devolve
`message_id` e `edited` para cada chamada. Uma chave não identifica apenas
uma mensagem entre todos os chats: a unicidade é por **chat, tópico e chave**.

Se já tiver o ID do Telegram e não precisar de persistência por chave,
`POST /notifications/edit` aceita `message_id` + `chat_id` + `body`.
A API também aceita esse formato em `POST /notifications/send`.
Ambas exigem o mesmo bearer token do endpoint de envio.

É possível testar e gerar `curl`/`fetch` para envio, upsert e edição na UI
**/notifications**.

### Proteções e implantação

- D1 `notification_messages` guarda `message_id`, versão e um lease contra
  atualizações concorrentes entre múltiplos Workers.
- `GET /notifications/capabilities`, autenticado, responde
  `version: editable-v1`; o PhotoIntel consulta antes de enviar mensagens
  editáveis, evitando que um relay antigo ignore a chave e crie duplicatas.
- O webhook assinado do GitHub e a action `Notify` do PhotoIntel compartilham
  `notification_key = workflow:<owner>/<repo>:<run_id>`.
- Falhas temporárias não substituem mensagens; uma mensagem apagada no Telegram
  só é recriada se a Bot API retornar explicitamente erro de mensagem inexistente.
- Os dados do D1 persistem após reiniciar Worker. A entrega continua *at-least-once*
  em caso de ACK de rede ambíguo.

**Ordem automática de ativação:** execute um único comando de produção:

```sh
npm ci
npm run deploy
```

O script `build:release` aplica todas as migrations remotas pendentes **antes**
de chamar `npm run build`. `npm run deploy` executa esse script e só então
publica o Worker. Não é necessário rodar migrations manualmente a cada deploy.

Para usar a mesma ordem no GitHub Actions, execute manualmente o workflow
**🚀 Relay · Migrate → Build → Deploy** em `main`. Ele instala dependências,
valida o projeto, aplica migrations D1 remotas, roda o build e só depois
publica. Se quiser automatizar nos pushes da `main`, habilite a variável de
repositório `RELAY_AUTO_DEPLOY=true`. O workflow requer os segredos
`CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID` com permissões
**D1 Edit** e **Workers Scripts Edit**.

`npm run build` continua sendo **somente validação (dry-run)**, sem mexer no
banco remoto: é usado nos PRs. A CI valida migrations em uma base **local**
antes desse build, sem risco de alterar produção. `npm run dev` também aplica
migrations locais automaticamente antes de iniciar o Wrangler.

O deploy do Worker exige credenciais Cloudflare válidas e o segredo
`NOTIFICATION_API_TOKEN` devidamente provisionado. Publique o relay
**antes de atualizar os containers do PhotoIntel**.

⚠️ Tokens de bot e outros segredos não devem ficar em `wrangler.toml` nem
ser impressos em logs; configure-os com `wrangler secret put` e rotacione
quaisquer valores que já tenham sido comitados.
