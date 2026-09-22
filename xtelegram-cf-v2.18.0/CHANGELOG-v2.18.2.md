# v2.18.2 — avisos de restrição do X não são legendas

Corrige o aviso "Age-restricted adult content ... To view this media, you’ll need
to log in to X. Learn more" aparecendo no caption do Telegram.

- Filtra frases conhecidas de restrição etária, conteúdo sensível e login do X.
- Aplica a limpeza aos resolvers, aos campos de caption da metadata, aos captions
  explícitos do cliente e às edições de mensagens já existentes.
- Mantém texto real, autor, link de origem e hashtags. Quando só existe o aviso,
  usa o link de origem como fallback; não inventa o texto que não pôde ser lido.
- Testa cada candidato de metadata: um socialResolvedCaption inválido não bloqueia
  um socialCaption válido.
- Troca a versão do cache de metadata e rejeita captions contaminados no cache.
- Ao processar novamente uma URL com snapshot contaminado, limpa a mensagem já
  enviada. Preserva o message_id e não baixa/reenvia o vídeo. Funciona também no
  batch. A segunda execução não edita novamente.
- Falhas de edição mantêm o snapshot antigo para permitir nova tentativa.
- Mantém o modo de CPU pesada desligado por padrão.

## Atualizar

Use o projeto completo ou aplique o ZIP incremental sobre a versão 2.18.1.
Execute `npm ci` e `npm run deploy` na pasta do projeto. Não existe nova migração
em relação à 2.18.1; as migrações anteriores, inclusive a 0007, continuam necessárias.

Para corrigir uma mensagem já registrada, processe novamente sua URL com
`force: false` (ou omitido). `force: true` continua significando reenviar a mídia.
Não há varredura automática de todo o histórico após o deploy. Para registros
antigos sem snapshot de caption, envie também o caption corrigido explicitamente.

## Validação

- TypeScript passou.
- 48 testes passaram, incluindo regressões com o texto exato reportado, captions
  HTML, hashtags, alternativas de metadata e limpeza idempotente por URL/batch.
- Build do Worker passou em dry-run; nenhum deploy foi executado neste ambiente.
- Integrações usam SQLite local e Telegram simulado.
