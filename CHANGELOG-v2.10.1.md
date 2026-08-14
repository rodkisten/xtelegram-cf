# xtelegram-cf 2.10.1

## Carrossel misto foto + vídeo

- Restaura e amplia o fallback de álbum que havia sido perdido na 2.10.0.
- Cadeia segura: `sendMediaGroup` por URL → `sendMediaGroup` multipart
  `attach://` → `sendPhoto`/`sendVideo` ordenados quando ambos os grupos forem
  definitivamente rejeitados (`400`, `413` ou `415`).
- Mantém o álbum nativo quando aceito; a degradação para mensagens ordenadas é
  exclusiva de lotes realmente mistos e só acontece como recuperação final.
- Se o total do grupo multipart ultrapassar o orçamento, prepara e encaminha
  uma mídia por vez, sem perder os headers ou a ordem.

## Compatibilidade e diagnóstico

- Restaura `mediaHeaders` por item em `RelayAlbumItem`, alinhando tipos,
  validação, `/resolve-and-send` e o fallback Worker-side.
- Preserva o enrichment social da 2.10.0 em URL, multipart e fallback.
- Respostas de álbum incluem transporte usado, tentativas de fallback e
  quantidade real de chamadas à Bot API.
- Falhas parciais retêm o claim D1 até o TTL, protegendo contra retry imediato
  que poderia duplicar conteúdo já entregue.

Não há migration D1 nova. Configure os mesmos secrets e faça `npm run deploy`.
