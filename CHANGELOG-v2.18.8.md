# v2.18.8 — `force: "forward"`

## Novo modo de force

O relay agora aceita:

```json
{
  "force": "forward"
}
```

O comportamento de `force: true` permanece inalterado e continua fazendo o
reenvio normal da mídia.

## Como `forward` funciona

1. resolve a identidade da mídia e consulta a entrega anterior no D1;
2. mantém a mesma resolução atual de caption/metadata do fluxo normal;
3. reutiliza a mensagem Telegram já armazenada, sem baixar/reupar a mídia;
4. cria uma nova mensagem no destino;
5. aplica o caption atual à nova mensagem;
6. persiste os novos message IDs como `last_message_ids_json` e incrementa
   `send_count`.

Telegram não aceita caption novo em `forwardMessage`. Por isso o modo público
continua se chamando `forward`, mas a implementação usa `copyMessage` para uma
mensagem e `copyMessages` para múltiplas mensagens/álbuns.

Para múltiplas mensagens, `copyMessages` mantém o agrupamento de álbum. Os
captions antigos são removidos e o relay reaplica os captions atuais seguindo
a mesma distribuição do fluxo normal.

## Resposta

Respostas bem-sucedidas incluem:

```json
{
  "action": "forward",
  "force_mode": "forward",
  "message_id": 123,
  "message_url": "https://t.me/...",
  "message_deeplink": "tg://...",
  "message_ids": [123]
}
```

Se um destino não possuir mensagem anterior no D1, ele recebe
`forward_source_missing`; o relay não troca silenciosamente para upload normal.

## Compatibilidade

- `/resolve-and-send`: suportado;
- `/send` JSON single: suportado;
- `/send` JSON album: suportado;
- `/batch`: `force: "forward"` pode ser global ou por item;
- `force: true`: comportamento anterior preservado.
