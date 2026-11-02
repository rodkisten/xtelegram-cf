/**
 * Self-contained notification composer, served directly by the Worker.
 *
 * No Worker secrets are interpolated into this page. The generated examples
 * deliberately read NOTIFICATION_API_TOKEN from the caller's environment.
 */
const PAGE = String.raw`<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
    <meta name="color-scheme" content="dark">
    <meta name="theme-color" content="#0b0c0e">
    <meta name="referrer" content="no-referrer">
    <title>Notification Studio · Relay</title>
    <style>
      :root { font-family: -apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif; color:#eff0f1; background:#0b0c0e; font-synthesis:none; }
      * { box-sizing:border-box; }
      html { scroll-behavior:smooth; }
      body { margin:0; min-width:320px; }
      button,input,textarea,select { font:inherit; }
      button { cursor:pointer; }
      button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible { outline:2px solid #78abff; outline-offset:2px; }
      button:disabled { cursor:not-allowed; opacity:.4; }
      a { color:inherit; }
      .shell { max-width:1480px; padding:0 28px 70px; margin:auto; }
      .topbar { display:flex; align-items:center; justify-content:space-between; gap:16px; min-height:82px; border-bottom:1px solid #25272b; }
      .brand { display:flex; align-items:center; gap:12px; font-weight:700; letter-spacing:-.4px; font-size:17px; }
      .mark { height:35px; width:35px; border-radius:11px; background:#f3f5f8; color:#101114; display:grid; place-items:center; font-size:21px; }
      .brand small { font-weight:500; color:#777b84; margin-left:7px; font-size:12px; }
      .toplink { text-decoration:none; border:1px solid #32353a; border-radius:10px; padding:10px 13px; color:#b4b9c1; font-size:12px; }
      .toplink:hover { background:#22252a; }
      .intro { display:flex; align-items:flex-end; justify-content:space-between; gap:20px; padding:34px 0 28px; }
      .eyebrow { color:#93a1b2; font-size:11px; font-weight:700; letter-spacing:2px; text-transform:uppercase; }
      h1 { font-size:clamp(30px,3vw,44px); margin:9px 0 7px; letter-spacing:-1.7px; line-height:1.08; }
      .intro p { margin:0; color:#9397a0; font-size:14px; line-height:1.6; }
      .endpoint { background:#16181b; border:1px solid #34373c; border-radius:9px; padding:11px 13px; color:#bfc3c9; font:12px ui-monospace,SFMono-Regular,Menlo,monospace; white-space:nowrap; }
      .endpoint b { color:#7ae5af; font-weight:600; margin-right:7px; }
      .workspace { display:grid; grid-template-columns:minmax(410px,1.12fr) minmax(370px,.88fr); gap:20px; align-items:stretch; }
      .panel { min-width:0; background:#111315; border:1px solid #292b30; border-radius:18px; overflow:hidden; }
      .panel-head { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:20px 22px; border-bottom:1px solid #25282c; }
      .panel-head h2 { margin:0; font-size:15px; font-weight:700; letter-spacing:-.2px; }
      .panel-head p { margin:5px 0 0; color:#81858d; font-size:12px; }
      .pill { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.8px; border:1px solid #33373e; color:#b9bec8; border-radius:99px; padding:6px 10px; white-space:nowrap; }
      .form { padding:22px; display:grid; gap:17px; }
      label { display:block; font-size:12px; color:#bcc0c7; font-weight:600; margin:0 0 9px; }
      .row { display:grid; grid-template-columns:1fr 1fr; gap:13px; }
      input,select,textarea { border-radius:10px; border:1px solid #35383e; background:#1b1d20; color:#eef0f3; width:100%; min-height:42px; padding:10px 12px; font-size:16px; transition:border-color .18s,background .18s; }
      textarea { min-height:204px; line-height:1.6; resize:vertical; font:13px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace; border-top:0; border-top-left-radius:0; border-top-right-radius:0; }
      input:focus,select:focus,textarea:focus { border-color:#a0a4ac; background:#202227; outline:none; }
      input::placeholder,textarea::placeholder { color:#6f737a; }
      .hint { display:block; color:#777c84; font-size:11px; line-height:1.6; margin:6px 0 0; }
      .editor-top { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:9px; }
      .editor-top label { margin:0; }
      .counter { color:#777c85; font:11px ui-monospace,SFMono-Regular,monospace; }
      .editor-tools { display:flex; gap:3px; align-items:center; padding:6px 8px; background:#1b1d20; border:1px solid #35383e; border-radius:10px 10px 0 0; }
      .tool { border:0; border-radius:6px; background:transparent; color:#b8bcc5; min-width:33px; height:29px; font-size:13px; }
      .tool:hover { background:#32353b; color:#fff; }
      .separator { width:1px; height:19px; background:#363940; margin:0 4px; }
      .sectionline { display:flex; justify-content:space-between; align-items:center; gap:10px; }
      .ghost { border:1px solid #383b41; background:#1c1e22; color:#cbd0d7; border-radius:8px; padding:8px 12px; font-size:12px; font-weight:600; }
      .ghost:hover { background:#2b2d33; }
      .button-fields { display:grid; gap:8px; margin-top:10px; }
      .button-entry { display:grid; grid-template-columns:minmax(75px,.75fr) minmax(130px,1.55fr) 54px 31px; gap:7px; align-items:center; }
      .button-entry input,.button-entry select { min-width:0; min-height:38px; padding:8px; font-size:13px; }
      .button-entry select { font-size:12px; }
      .remove { border:0; border-radius:8px; background:#292a2e; color:#e1a0a0; height:36px; }
      .switchline { display:flex; align-items:center; gap:12px; font-size:12px; color:#c8cbd0; }
      .switchline input { width:19px; height:19px; min-height:unset; accent-color:#d7dbe2; }
      .switchline label { margin:0; font-size:13px; cursor:pointer; }
      .alert { border:1px solid #624349; color:#e8b6bb; padding:10px 12px; border-radius:10px; background:#2e1b1f; font-size:12px; line-height:1.5; }
      .alert[hidden] { display:none; }
      .preview-panel { display:flex; flex-direction:column; }
      .preview-wrap { flex:1; min-height:630px; display:grid; place-items:center; padding:26px 22px 20px; background:radial-gradient(ellipse at 50% 22%,#22282d 0%,#111315 67%); }
      .iphone { width:min(100%,353px); height:604px; padding:7px; border-radius:46px; background:#090b0d; box-shadow:0 0 0 2px #414348,0 18px 70px #0009; position:relative; }
      .screen { position:relative; height:100%; border-radius:39px; overflow:hidden; background:#dfe7eb; display:flex; flex-direction:column; color:#1b2937; }
      .ios-status { position:relative; background:#f7f8fa; height:49px; min-height:49px; display:flex; justify-content:space-between; align-items:flex-end; padding:0 25px 10px; font-size:14px; font-weight:700; letter-spacing:-.2px; z-index:2; }
      .dynamic-island { position:absolute; width:106px; height:29px; background:#050506; border-radius:20px; left:50%; top:9px; transform:translateX(-50%); }
      .signal { font-size:12px; letter-spacing:-2px; white-space:nowrap; }
      .chatbar { height:62px; min-height:62px; background:rgba(249,250,252,.98); display:flex; align-items:center; gap:9px; border-bottom:1px solid #cad3d9; padding:4px 11px; }
      .back { color:#1689eb; font-size:24px; line-height:1; font-weight:400; }
      .back-count { color:#1689eb; font-size:16px; }
      .avatar { width:40px; height:40px; flex-shrink:0; border-radius:50%; background:linear-gradient(145deg,#45b5ff,#1789dd 65%,#1365ac); color:white; display:grid; place-items:center; font-size:21px; font-weight:700; }
      .chat-person { text-align:center; flex:1; min-width:0; display:flex; flex-direction:column; align-items:center; line-height:1.2; }
      .chat-person strong { font-size:15px; letter-spacing:-.25px; }
      .chat-person span { font-size:11px; margin-top:2px; color:#7b8590; }
      .chatbar .avatar { width:36px; height:36px; }
      .chatbar .info { color:#1689eb; font-size:20px; padding:0 3px; }
      .chat-content { flex:1; min-height:0; padding:20px 12px 12px; display:flex; flex-direction:column; overflow:auto; gap:12px; background-color:#dfe8e3; background-image:radial-gradient(#fff8 1px,transparent 1px),radial-gradient(#bfcfc7aa 1px,transparent 1px),linear-gradient(155deg,#e5eeeb,#dce5e6); background-size:38px 38px,57px 57px,100% 100%; background-position:0 0,10px 16px,0 0; }
      .date-chip { align-self:center; padding:4px 12px; border-radius:14px; background:#a2b5b3a8; color:white; font-weight:600; font-size:11px; text-shadow:0 1px 2px #4564; }
      .bubble { background:#fff; border-radius:15px 15px 15px 5px; box-shadow:0 1px 1px #132b3019; padding:9px 10px 7px; align-self:flex-start; max-width:96%; min-width:160px; width:fit-content; overflow-wrap:anywhere; }
      .sender { color:#318bc4; font-size:12px; font-weight:700; margin-bottom:4px; }
      .bubble-copy { font-size:13px; line-height:1.48; white-space:pre-wrap; max-height:312px; overflow:auto; }
      .bubble-copy a { color:#1688cf; text-decoration:none; pointer-events:none; }
      .bubble-copy b { font-weight:700; }
      .bubble-copy code { background:#eff1f3; color:#c24e72; padding:1px 3px; font:11px/1.4 ui-monospace,Menlo,monospace; border-radius:3px; }
      .bubble-copy pre { white-space:pre-wrap; margin:6px 0; background:#eff1f3; padding:8px; border-radius:6px; }
      .bubble-copy blockquote { border-left:3px solid #6bafe4; margin:4px 0; padding:2px 8px; color:#58636b; }
      .msg-meta { font-size:10px; color:#a0a5a7; text-align:right; margin-top:5px; }
      .tg-buttons { margin-top:8px; display:grid; gap:3px; }
      .tg-row { display:flex; gap:3px; }
      .tg-button { flex:1; min-width:0; padding:9px 5px; text-align:center; background:#fdfefe; border-radius:8px; box-shadow:0 1px 1px #132b3018; color:#2785c4; font-size:12px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .chat-bottom { background:#f5f7f9; border-top:1px solid #ccd3d9; padding:9px 10px 7px; }
      .input-fake { display:flex; gap:10px; align-items:center; font-size:23px; color:#87929e; }
      .input-fake .message-placeholder { color:#a0a9b3; padding:8px 12px; border-radius:19px; border:1px solid #ccd3dc; background:white; font-size:14px; flex:1; }
      .home-indicator { width:115px; height:4px; border-radius:3px; background:#14191d; margin:14px auto 2px; }
      .preview-caption { color:#838891; padding:0 22px 22px; text-align:center; font-size:11px; line-height:1.6; }
      .code-panel { margin-top:20px; }
      .code-head { display:flex; align-items:center; gap:12px; justify-content:space-between; padding:18px 22px 0; }
      .code-head h2 { font-size:15px; margin:0; }
      .code-actions { display:flex; align-items:center; gap:8px; }
      .copy { border:1px solid #e4e7ec; background:#eceef1; border-radius:9px; color:#131519; padding:9px 14px; font-size:12px; font-weight:700; }
      .copy:hover { background:white; }
      .tabs { display:flex; gap:20px; margin:16px 22px 0; border-bottom:1px solid #33363c; }
      .tab { padding:0 0 11px; border:0; border-bottom:2px solid transparent; background:transparent; color:#777e87; font-size:12px; font-weight:700; }
      .tab.active { color:#f4f5f6; border-bottom-color:#f4f5f6; }
      .codebox { margin:0; padding:19px 22px; overflow:auto; min-height:185px; max-height:390px; background:#111315; color:#cbd4dc; font:12px/1.65 ui-monospace,SFMono-Regular,Menlo,monospace; tab-size:2; }
      .codebox .hljs-keyword,.codebox .hljs-built_in { color:#c8a6f7; }
      .codebox .hljs-string,.codebox .hljs-attr { color:#a4d5aa; }
      .codebox .hljs-number,.codebox .hljs-literal { color:#f1ba86; }
      .codebox .hljs-comment { color:#737a85; }
      .codebox .hljs-variable,.codebox .hljs-title { color:#9ccef4; }
      .code-foot { padding:13px 22px 18px; border-top:1px solid #292c32; color:#7c818a; font-size:11px; line-height:1.6; }
      .footer { margin-top:23px; color:#72777f; font-size:12px; display:flex; justify-content:space-between; gap:16px; }
      .footer a { color:#bfc5ce; text-decoration:none; }
      @media (max-width:980px) {
        .workspace { grid-template-columns:1fr; }
        .preview-wrap { min-height:unset; }
        .intro { align-items:flex-start; flex-direction:column; }
      }
      @media (max-width:600px) {
        .shell { padding:0 13px 35px; }
        .topbar { min-height:68px; }
        .brand small { display:none; }
        .intro { padding:24px 3px 19px; }
        .intro p { font-size:13px; }
        .endpoint { font-size:10px; max-width:100%; overflow:auto; }
        .panel-head { padding:17px 15px; }
        .form { padding:16px; gap:16px; }
        .row { grid-template-columns:1fr; }
        .button-entry { grid-template-columns:minmax(70px,.75fr) minmax(94px,1.25fr) 48px 29px; gap:4px; }
        .button-entry input { padding:6px; font-size:12px; }
        .preview-wrap { padding:18px 12px; }
        .iphone { height:580px; }
        .code-head { padding:17px 16px 0; }
        .tabs { margin-left:16px; }
        .codebox { padding:16px; font-size:11px; }
        .footer { flex-direction:column; }
      }
      @media (prefers-reduced-motion:reduce) { *,*::before,*::after { scroll-behavior:auto !important; transition:none !important; } }
    </style>
  </head>
  <body>
    <div class="shell">
      <header class="topbar">
        <div class="brand"><span class="mark">✈</span><span>relay<span style="color:#7d828a"> / </span>notifications <small>STUDIO</small></span></div>
        <a class="toplink" href="/health" target="_blank" rel="noopener">API status ↗</a>
      </header>

      <section class="intro">
        <div>
          <div class="eyebrow">Telegram Notification Builder</div>
          <h1>Uma mensagem. Mil possibilidades.</h1>
          <p>Escreva em Markdown, visualize no Telegram para iOS e gere a requisição da API.</p>
        </div>
        <div class="endpoint"><b>POST</b> /notifications/send</div>
      </section>

      <main>
        <section class="workspace">
          <div class="panel">
            <div class="panel-head">
              <div><h2>Compor notificação</h2><p>Dados enviados ao endpoint do relay.</p></div>
              <button class="ghost" id="reset" type="button">Restaurar exemplo</button>
            </div>
            <div class="form">
              <div class="row">
                <div>
                  <label for="status">Tipo de evento</label>
                  <select id="status">
                    <option value="success">✅ Sucesso</option>
                    <option value="error">❌ Erro</option>
                    <option value="progress">🔄 Em progresso</option>
                    <option value="warning">⚠️ Atenção</option>
                    <option value="info">ℹ️ Informação</option>
                    <option value="custom">Sem ícone</option>
                  </select>
                </div>
                <div>
                  <label for="title">Título</label>
                  <input id="title" maxlength="180" value="Deploy concluído" autocomplete="off">
                </div>
              </div>
              <div class="row">
                <div>
                  <label for="chat">Chat ID <span style="color:#777c84;font-weight:400">(opcional)</span></label>
                  <input id="chat" placeholder="-1001234567890:73 ou @canal" spellcheck="false" autocomplete="off">
                  <span class="hint">Vazio usa NOTIFICATION_CHAT_ID do Worker.</span>
                </div>
                <div>
                  <label for="thread">ID do tópico <span style="color:#777c84;font-weight:400">(opcional)</span></label>
                  <input id="thread" inputmode="numeric" placeholder="73" autocomplete="off">
                  <span class="hint">Não preencher se já usou chat_id:tópico.</span>
                </div>
              </div>
              <div>
                <div class="editor-top"><label for="body">Mensagem · Markdown</label><span class="counter" id="counter">0/4096</span></div>
                <div class="editor-tools" aria-label="Ferramentas de formatação">
                  <button class="tool" data-wrap="bold" type="button" title="Negrito"><b>B</b></button>
                  <button class="tool" data-wrap="italic" type="button" title="Itálico"><i>I</i></button>
                  <button class="tool" data-wrap="strike" type="button" title="Riscado"><s>S</s></button>
                  <button class="tool" data-wrap="code" type="button" title="Código">&lt;/&gt;</button>
                  <span class="separator"></span>
                  <button class="tool" data-wrap="link" type="button" title="Link">🔗</button>
                  <button class="tool" data-wrap="quote" type="button" title="Citação">❞</button>
                  <button class="tool" data-wrap="list" type="button" title="Lista">☷</button>
                </div>
                <textarea id="body" spellcheck="true">**PhotoIntel API** está disponível.

Deploy realizado na branch &#96;main&#96; e todos os serviços estão operacionais.

> Nenhum erro detectado no pipeline.</textarea>
                <span class="hint">Markdown é convertido para HTML compatível com o Telegram. HTML digitado é tratado como texto.</span>
              </div>
              <div>
                <div class="sectionline">
                  <label style="margin:0">Botões inline · HTTPS</label>
                  <button class="ghost" id="add-button" type="button">+ Adicionar botão</button>
                </div>
                <div id="button-fields" class="button-fields"></div>
                <span class="hint">Até 3 linhas com até 3 botões por linha, como na Bot API.</span>
              </div>
              <div class="switchline">
                <input type="checkbox" id="silent">
                <label for="silent">Enviar silenciosamente (disable_notification)</label>
              </div>
              <div id="alert" class="alert" role="alert" hidden></div>
            </div>
          </div>

          <section class="panel preview-panel" aria-label="Prévia do Telegram para iOS">
            <div class="panel-head">
              <div><h2>Telegram para iOS</h2><p>Prévia aproximada em tempo real.</p></div>
              <span class="pill">Live preview</span>
            </div>
            <div class="preview-wrap">
              <div class="iphone" role="img" aria-label="Simulação de um chat do Telegram para iPhone">
                <div class="screen">
                  <div class="ios-status"><span>9:41</span><span class="dynamic-island"></span><span class="signal">▂▄▆  ◕  ▰</span></div>
                  <div class="chatbar">
                    <span class="back">‹</span><span class="back-count">Chats</span>
                    <div class="chat-person"><strong>Relay Notifications</strong><span>bot</span></div>
                    <div class="avatar">✈</div>
                  </div>
                  <div class="chat-content">
                    <span class="date-chip">Hoje</span>
                    <div>
                      <div class="bubble">
                        <div class="sender">Relay Notifications</div>
                        <div class="bubble-copy" id="message-preview"></div>
                        <div class="msg-meta" id="preview-time">9:41</div>
                      </div>
                      <div class="tg-buttons" id="button-preview"></div>
                    </div>
                  </div>
                  <div class="chat-bottom">
                    <div class="input-fake"><span>＋</span><span class="message-placeholder">Mensagem</span><span>◉</span><span>♬</span></div>
                    <div class="home-indicator"></div>
                  </div>
                </div>
              </div>
            </div>
            <div class="preview-caption">Simulação visual, não uma captura do aplicativo. Quebras de linha, formatação e botões acompanham o payload.</div>
          </section>
        </section>

        <section class="panel code-panel" aria-label="Requisição gerada">
          <div class="code-head">
            <h2>Integração pronta para copiar</h2>
            <div class="code-actions"><button id="copy" class="copy" type="button">Copiar código</button></div>
          </div>
          <div class="tabs" role="tablist" aria-label="Linguagem do exemplo">
            <button class="tab active" data-lang="curl" role="tab" aria-selected="true" type="button">cURL</button>
            <button class="tab" data-lang="fetch" role="tab" aria-selected="false" type="button">Fetch (Node.js)</button>
            <button class="tab" data-lang="json" role="tab" aria-selected="false" type="button">JSON body</button>
          </div>
          <pre class="codebox"><code id="generated-code"></code></pre>
          <div class="code-foot">O código lê <strong>NOTIFICATION_API_TOKEN</strong> do ambiente. Nunca publique esse token no frontend. O editor e o preview não enviam mensagens nem acessam seus segredos.</div>
        </section>
      </main>

      <footer class="footer"><span>Relay Notification Studio · compatível com Telegram Bot API HTML</span><a href="https://core.telegram.org/bots/api#formatting-options" target="_blank" rel="noopener noreferrer">Formatação aceita pelo Telegram ↗</a></footer>
    </div>
    <script type="module">
      const $ = (id) => document.getElementById(id);
      const statusIcons = { success:"✅", error:"❌", progress:"🔄", warning:"⚠️", info:"ℹ️", custom:"" };
      const defaultButton = { text:"🔎 Abrir workflow", url:"https://github.com/rodkisten/photointel/actions", row:1 };
      const state = { tab:"curl", buttons:[{ ...defaultButton }], code:"", errors:[] };
      let markedParser = null;
      let highlighter = null;
      const escapeHtml = (value) => String(value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
      const validUrl = (value) => {
        try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; }
        catch { return false; }
      };
      function inline(tokens) {
        return (tokens || []).map((t) => {
          if (t.type === "strong") return "<b>" + inline(t.tokens) + "</b>";
          if (t.type === "em") return "<i>" + inline(t.tokens) + "</i>";
          if (t.type === "del") return "<s>" + inline(t.tokens) + "</s>";
          if (t.type === "codespan") return "<code>" + escapeHtml(t.text) + "</code>";
          if (t.type === "br") return "\n";
          if (t.type === "link") {
            const label = inline(t.tokens) || escapeHtml(t.text || t.href);
            return validUrl(t.href) ? '<a href="' + escapeHtml(t.href) + '">' + label + "</a>" : label;
          }
          if (t.type === "image") return escapeHtml(t.text || "");
          if (t.type === "text" && t.tokens) return inline(t.tokens);
          return escapeHtml(t.text || t.raw || "");
        }).join("");
      }
      function blocks(tokens) {
        return (tokens || []).map((t) => {
          if (t.type === "space") return "";
          if (t.type === "heading") return "<b>" + inline(t.tokens) + "</b>";
          if (t.type === "paragraph" || t.type === "text") return inline(t.tokens || [{ type:"text", text:t.text || "" }]);
          if (t.type === "code") return "<pre><code>" + escapeHtml(t.text || "") + "</code></pre>";
          if (t.type === "blockquote") return "<blockquote>" + blocks(t.tokens) + "</blockquote>";
          if (t.type === "list") {
            return (t.items || []).map((item,index) => (t.ordered ? (Number(t.start || 1) + index) + "." : "•") + " " + blocks(item.tokens).trim()).join("\n");
          }
          if (t.type === "hr") return "────────────";
          if (t.type === "table") {
            const row = (cells) => cells.map((c) => inline(c.tokens)).join("  |  ");
            return [row(t.header),...(t.rows || []).map(row)].join("\n");
          }
          return escapeHtml(t.text || t.raw || "");
        }).filter(Boolean).join("\n\n");
      }
      function asTelegramHtml(markdown) {
        if (!markedParser) return escapeHtml(markdown);
        try { return blocks(markedParser.lexer(markdown, { gfm:true, breaks:true })); }
        catch { return escapeHtml(markdown); }
      }
      function compose() {
        const title = $("title").value.trim();
        const icon = statusIcons[$("status").value] || "";
        const heading = title ? (icon ? icon + " " : "") + "<b>" + escapeHtml(title) + "</b>" : "";
        const content = asTelegramHtml($("body").value.trim());
        return [heading,content].filter(Boolean).join("\n\n");
      }
      function buttonRows() {
        const rows = [[],[],[]];
        state.buttons.forEach((b) => {
          const row = Math.max(1,Math.min(3,Number(b.row) || 1));
          if (b.text.trim() && b.url.trim()) rows[row - 1].push({ text:b.text.trim(), url:b.url.trim() });
        });
        return rows.filter((r) => r.length);
      }
      function validate(body) {
        const errors = [];
        if (!body.trim()) errors.push("Escreva um título ou uma mensagem.");
        if (body.length > 4096) errors.push("A mensagem excede 4096 caracteres no HTML gerado.");
        const chat = $("chat").value.trim();
        if (chat && !/^(?:-?\d+(?::[1-9]\d*)?|@[A-Za-z0-9_]{5,32})$/.test(chat)) errors.push("Chat ID inválido: use um ID numérico, @canal ou ID:tópico.");
        const thread = $("thread").value.trim();
        if (thread && (!/^[1-9]\d*$/.test(thread) || !Number.isSafeInteger(Number(thread)))) errors.push("O tópico precisa ser um inteiro positivo.");
        if (chat.includes(":") && thread) errors.push("Informe o tópico no Chat ID ou no campo de tópico, nunca em ambos.");
        const count = [0,0,0];
        state.buttons.forEach((b) => {
          count[Number(b.row) - 1] += 1;
          if (!b.text.trim() || !b.url.trim() || !validUrl(b.url)) errors.push("Preencha o texto e uma URL HTTPS válida para cada botão.");
          if (b.text.length > 64) errors.push("Texto dos botões: máximo de 64 caracteres.");
        });
        if (state.buttons.length > 9 || count.some((n) => n > 3)) errors.push("Máximo de 3 botões por linha e 3 linhas.");
        return [...new Set(errors)];
      }
      function payload(html) {
        const data = { body:html, parse_mode:"HTML", disable_notification:$("silent").checked };
        const chat = $("chat").value.trim();
        if (chat) data.chat_id = chat;
        const thread = $("thread").value.trim();
        if (thread && /^[1-9]\d*$/.test(thread) && Number.isSafeInteger(Number(thread))) data.message_thread_id = Number(thread);
        const rows = buttonRows();
        if (rows.length) data.buttons = rows;
        return data;
      }
      function shQuote(value) { return "'" + value.replace(/'/g, "'\"'\"'") + "'"; }
      function snippets(data) {
        const url = new URL("/notifications/send", location.origin).toString();
        const compact = JSON.stringify(data);
        return {
          curl: [
            "curl --fail-with-body -X POST " + shQuote(url) + " \\",
            "  -H \"Authorization: Bearer \u0024NOTIFICATION_API_TOKEN\" \\",
            "  -H \"Content-Type: application/json\" \\",
            "  --data-raw " + shQuote(compact)
          ].join("\n"),
          fetch: [
            "const payload = " + JSON.stringify(data,null,2) + ";",
            "",
            "const response = await fetch(" + JSON.stringify(url) + ", {",
            '  method: "POST",',
            '  headers: {',
            '    "Authorization": "Bearer " + process.env.NOTIFICATION_API_TOKEN,',
            '    "Content-Type": "application/json"',
            "  },",
            "  body: JSON.stringify(payload)",
            "});",
            "",
            "const result = await response.json();",
            "if (!response.ok) throw new Error(JSON.stringify(result));",
            "console.log(result);"
          ].join("\n"),
          json: JSON.stringify(data,null,2)
        };
      }
      function paintCode() {
        const el = $("generated-code");
        const language = state.tab === "curl" ? "bash" : state.tab === "fetch" ? "javascript" : "json";
        if (highlighter) {
          try { el.innerHTML = highlighter.highlight(state.code,{ language }).value; return; } catch {}
        }
        el.textContent = state.code;
      }
      function refresh() {
        const html = compose();
        const data = payload(html);
        state.errors = validate(html);
        const alerts = $("alert");
        alerts.hidden = !state.errors.length;
        alerts.textContent = state.errors.join(" ");
        $("counter").textContent = html.length + "/4096";
        $("counter").style.color = html.length > 4096 ? "#e8a7ab" : "";
        $("message-preview").innerHTML = html || "<i>Escreva uma notificação…</i>";
        $("preview-time").textContent = new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});
        const buttonPreview = $("button-preview");
        buttonPreview.replaceChildren();
        buttonRows().forEach((row) => {
          const line = document.createElement("div");
          line.className = "tg-row";
          row.forEach((button) => {
            const item = document.createElement("div");
            item.className = "tg-button";
            item.textContent = button.text + " ↗";
            item.title = button.url;
            line.append(item);
          });
          buttonPreview.append(line);
        });
        state.code = snippets(data)[state.tab];
        $("copy").disabled = Boolean(state.errors.length);
        paintCode();
      }
      function renderButtons() {
        const target = $("button-fields");
        target.replaceChildren();
        state.buttons.forEach((button,index) => {
          const entry = document.createElement("div");
          entry.className = "button-entry";
          const label = document.createElement("input");
          label.placeholder = "Texto do botão";
          label.value = button.text;
          label.maxLength = 64;
          label.setAttribute("aria-label","Texto do botão " + (index + 1));
          label.addEventListener("input",() => { button.text = label.value; refresh(); });
          const url = document.createElement("input");
          url.type = "url";
          url.placeholder = "https://…";
          url.value = button.url;
          url.spellcheck = false;
          url.setAttribute("aria-label","URL do botão " + (index + 1));
          url.addEventListener("input",() => { button.url = url.value; refresh(); });
          const row = document.createElement("select");
          row.setAttribute("aria-label","Linha do botão " + (index + 1));
          [1,2,3].forEach((n) => {
            const option = document.createElement("option");
            option.value = String(n);
            option.textContent = "L" + n;
            row.append(option);
          });
          row.value = String(button.row);
          row.addEventListener("change",() => { button.row = Number(row.value); refresh(); });
          const remove = document.createElement("button");
          remove.className = "remove";
          remove.type = "button";
          remove.textContent = "×";
          remove.title = "Excluir botão";
          remove.addEventListener("click",() => { state.buttons.splice(index,1); renderButtons(); refresh(); });
          entry.append(label,url,row,remove);
          target.append(entry);
        });
        $("add-button").disabled = state.buttons.length >= 9;
      }
      function wrapSelection(type) {
        const area = $("body");
        const start = area.selectionStart;
        const end = area.selectionEnd;
        const selected = area.value.slice(start,end) || "texto";
        const tick = String.fromCharCode(96);
        const formats = {
          bold:["**","**"], italic:["*","*"], strike:["~~","~~"], code:[tick,tick],
          link:["[","](https://example.com)"], quote:["> ",""], list:["- ",""]
        };
        const parts = formats[type] || ["",""];
        const insert = parts[0] + selected + parts[1];
        area.setRangeText(insert,start,end,"select");
        area.focus();
        area.dispatchEvent(new Event("input",{bubbles:true}));
      }
      async function copyText(value) {
        try { await navigator.clipboard.writeText(value); return true; }
        catch {
          const area = document.createElement("textarea");
          area.value = value;
          area.style.position = "fixed";
          area.style.opacity = "0";
          document.body.append(area);
          area.select();
          const ok = document.execCommand("copy");
          area.remove();
          return ok;
        }
      }
      function restore() {
        $("status").value = "success";
        $("title").value = "Deploy concluído";
        $("chat").value = "";
        $("thread").value = "";
        $("silent").checked = false;
        $("body").value = "**PhotoIntel API** está disponível.\n\nDeploy realizado na branch " + String.fromCharCode(96) + "main" + String.fromCharCode(96) + " e todos os serviços estão operacionais.\n\n> Nenhum erro detectado no pipeline.";
        state.buttons = [{ ...defaultButton }];
        renderButtons(); refresh();
      }
      document.querySelectorAll("#status,#title,#chat,#thread,#silent,#body").forEach((item) => {
        item.addEventListener("input",refresh);
        item.addEventListener("change",refresh);
      });
      document.querySelectorAll("[data-wrap]").forEach((btn) => btn.addEventListener("click",() => wrapSelection(btn.dataset.wrap)));
      document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click",() => {
        state.tab = tab.dataset.lang;
        document.querySelectorAll(".tab").forEach((item) => {
          const active = item === tab;
          item.classList.toggle("active",active);
          item.setAttribute("aria-selected",String(active));
        });
        refresh();
      }));
      $("add-button").addEventListener("click",() => {
        const counts = [1,2,3].map((n) => state.buttons.filter((b) => b.row === n).length);
        const row = counts.findIndex((n) => n < 3) + 1;
        if (!row || state.buttons.length >= 9) return;
        state.buttons.push({ text:"", url:"", row });
        renderButtons(); refresh();
      });
      $("reset").addEventListener("click",restore);
      $("copy").addEventListener("click",async () => {
        if (state.errors.length) return;
        const copied = await copyText(state.code);
        const button = $("copy");
        button.textContent = copied ? "✓ Copiado" : "Não foi possível copiar";
        window.setTimeout(() => { button.textContent = "Copiar código"; },1700);
      });
      renderButtons(); refresh();
      import("https://esm.sh/marked@15.0.12").then((module) => {
        markedParser = module.marked;
        refresh();
      }).catch(() => { /* plaintext fallback remains functional */ });
      Promise.all([
        import("https://esm.sh/highlight.js@11.11.1/lib/core"),
        import("https://esm.sh/highlight.js@11.11.1/lib/languages/bash"),
        import("https://esm.sh/highlight.js@11.11.1/lib/languages/javascript"),
        import("https://esm.sh/highlight.js@11.11.1/lib/languages/json")
      ]).then(([core,bash,js,json]) => {
        highlighter = core.default;
        highlighter.registerLanguage("bash",bash.default);
        highlighter.registerLanguage("javascript",js.default);
        highlighter.registerLanguage("json",json.default);
        paintCode();
      }).catch(() => { /* uncolored, copyable code still works */ });
    </script>
  </body>
</html>`;

export function handleNotificationsPage(): Response {
  return new Response(PAGE, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline' https://esm.sh; style-src 'unsafe-inline'; connect-src https://esm.sh; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
  });
}
