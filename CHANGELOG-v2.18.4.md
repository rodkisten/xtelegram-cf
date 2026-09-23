# v2.18.4 — variantes e links diretos em todas as respostas

- Todas as respostas JSON dos endpoints de mídia incluem no topo:
  - `variants`: dados completos de todas as qualidades conhecidas;
  - `variantUrls`: lista simples de links diretos;
  - `qualityUrls`: qualidade, link, dimensões, tamanho e bitrate.
- O contrato é mantido em sucesso, conflito, parcial, erro, batch e fallback
  controlado; quando nenhuma variante é conhecida, os três campos são arrays
  vazios.
- `/send` também devolve as variantes recebidas no payload, mesmo depois de
  uma entrega bem-sucedida.
- Respostas de `/resolve` e `/resolve-and-send` consolidam variantes aninhadas
  de todos os itens sem remover a estrutura original `resolution.media`.
- Corrige resoluções repetidas do FxTwitter: dimensões codificadas no URL de
  cada rendition agora prevalecem sobre metadata genérica repetida pelo
  provedor.
