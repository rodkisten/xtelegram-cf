# v2.18.1 — comparação de metadata/caption e edição condicional

O relay compara o payload recebido com o último estado confirmado de cada destino
(canal + tópico). A mídia já entregue permanece com o mesmo message_id.

| Entrada | Comportamento |
| --- | --- |
| Caption e metadata iguais | Não chama editMessageCaption e não altera o snapshot. |
| Metadata com chaves em outra ordem | Considera equivalente. |
| Caption ou parseMode diferente | Edita o caption da mensagem existente. |
| Somente metadata diferente | Atualiza D1 sem substituir um caption omitido. |
| Campo omitido | Preserva o campo salvo naquele destino. |
| `caption: ""` ou `caption: null` | Remove explicitamente o caption. |
| `metadata: {}` ou `metadata: null` | Limpa explicitamente a metadata customizada. |
| Metadata fornecida | Substitui o conjunto customizado; chaves ausentes são removidas. |
| Erro do Telegram | Mantém o estado confirmado, informa falha e permite nova tentativa. |
| `force: true` | Mantém o comportamento de reenviar mídia. Para editar, omita ou use false. |

Exemplo para uma mídia já entregue:

```json
{
  "url": "https://x.com/example/status/123",
  "channels": ["-100123:65"],
  "caption": "Caption atualizado",
  "metadata": { "category": "travel", "author": "Rod" }
}
```

Envie ao `/resolve-and-send`, ou use `mediaUrl` no `/send`. A mesma regra se aplica
a itens do `/batch`, ao caption principal de álbuns, a multipart, a
`/media/check` com payload de apresentação e a retries idempotentes de
`/media/register`. A comparação usa a entrega mais recente do destino.

O de-para aparece em `presentationResults[].changes`:

```json
{
  "field": "metadata.category",
  "before": "personal",
  "after": "travel"
}
```

`presentation` informa `compared`, `changed`, `edited`, `metadataOnly`, `unchanged`
e `failed`. Falhas retornam HTTP 207 e `ok: false` nos fluxos de edição.
Metadata continua aceitando o contrato existente de valores escalares
(string/número/booleano, normalizados como strings). Não é metadata embutida no
arquivo de vídeo: são os dados do relay. A chamada ao Telegram só ocorre quando
o caption renderizado ou sua formatação muda.

Correções incluídas:

- Batch deixa de bloquear o de-para ao encontrar `already_sent`.
- Campos omitidos não são confundidos com pedidos de remoção.
- Metadata fornecida pelo resolver é separada do payload customizado.
- `/resolve-and-send` com todos os destinos já entregues dispensa o resolver e
  o download. Continua funcionando quando o link temporário da mídia expirou.
- Claims do D1 serializam edições concorrentes por destino. Uma chamada que
  encontra o destino ocupado recebe `update_in_progress` para tentar depois.
- Os snapshots antigos são preservados antes de alterar o registro compartilhado,
  inclusive para tópicos que não foram selecionados.
- `/media/check` respeita os canais de cada item; `/media/register` sinaliza
  falhas de edição sem incrementar o contador de envios.
- O test runner resolve imports TypeScript extensionless e roda todos os testes.
- `npm run build` usa o dry-run suportado pelo Wrangler 4.
- Os comandos de migração usam o binding `RELAY_DB`, de acordo com wrangler.toml.
- Ajuste de tipos do BufferSource para o compilador instalado, sem cópia no
  caminho comum de Web Crypto. O modo de CPU pesada permanece desligado.

## Instalação

Na pasta extraída, com Node.js 24 ou posterior:

```bash
npm ci
npm run db:migrate:remote
npm run deploy
```

As migrações existentes, inclusive `0007_delivery_presentation_state.sql`, são
obrigatórias. Não há nova migração na 2.18.1. Se a 0007 já foi aplicada, o Wrangler
não a aplica novamente. Preserve a configuração/segredos do seu ambiente.

O ZIP de arquivos modificados é incremental sobre a 2.18.0 presentation-sync.
Para atualizar a partir da 2.17.0 ou anterior, use o ZIP completo.

## Validação local

- `npm run typecheck`: passou.
- `npm test`: 39 testes passaram, incluindo 14 de integração com SQLite local
  executando as migrações e as rotas reais; a API do Telegram foi simulada.
- `npm run build`: bundle do Worker passou em dry-run, sem deploy.
- Integridade dos ZIPs verificada.

Documentação do método utilizado:
https://core.telegram.org/bots/api#editmessagecaption
