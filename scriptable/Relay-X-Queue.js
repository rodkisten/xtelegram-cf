// Relay X Queue
// Scriptable for iPhone. No X API, no cookie extraction and no automated X form submission.
// Run with shortcutParameter "check" to notify, or "run" to share one due item.
// After sending a video to Telegram, an existing Shortcut may also invoke this script with:
// { mode: "enqueue", url, caption, hashtags, mediaUrl, telegramMessageUrl }
// Store RELAY_TOKEN in the Scriptable Keychain. Never embed credentials in this file.

const KEYS = {
  endpoint: "relay-x-queue:endpoint",
  token: "relay-x-queue:token",
  lastNotification: "relay-x-queue:last-notification",
};

const mode = String(
  typeof args.shortcutParameter === "string" ? args.shortcutParameter :
    (args.shortcutParameter && args.shortcutParameter.mode) ||
    (args.queryParameters && args.queryParameters.mode) || "run"
).toLowerCase();

function getStored(key) {
  return Keychain.contains(key) ? Keychain.get(key) : "";
}

async function askSetting(title, message, secure = false) {
  const alert = new Alert();
  alert.title = title;
  alert.message = message;
  if (secure) alert.addSecureTextField("Token do Relay");
  else alert.addTextField("URL HTTPS");
  alert.addAction("Salvar");
  alert.addCancelAction("Cancelar");
  if (await alert.presentAlert() < 0) throw new Error("Configuração cancelada.");
  return (alert.textFieldValue(0) || "").trim();
}

async function configForMode() {
  let endpoint = getStored(KEYS.endpoint);
  let token = getStored(KEYS.token);

  if (mode === "check" && (!endpoint || !token)) return null;
  if (!endpoint) {
    endpoint = await askSetting("Relay", "Informe a URL HTTPS do seu Worker, sem a barra final.");
    if (!/^https:\/\//i.test(endpoint)) throw new Error("A URL precisa ser HTTPS.");
    endpoint = endpoint.replace(/\/+$/, "");
    Keychain.set(KEYS.endpoint, endpoint);
  }
  if (!token) {
    token = await askSetting("Autenticação", "Informe RELAY_TOKEN do Worker.", true);
    if (!token) throw new Error("Token vazio.");
    Keychain.set(KEYS.token, token);
  }
  return { endpoint, token };
}

async function relay(config, path, method = "GET", body = null) {
  const request = new Request(config.endpoint + path);
  request.method = method;
  request.headers = {
    Authorization: "Bearer " + config.token,
    Accept: "application/json",
    ...(body == null ? {} : { "Content-Type": "application/json" }),
  };
  if (body != null) request.body = JSON.stringify(body);
  const result = await request.loadJSON();
  if (!request.response || request.response.statusCode >= 400 || !result.ok) {
    throw new Error(result.error || "Relay retornou erro.");
  }
  return result;
}

async function showMessage(title, message) {
  const alert = new Alert();
  alert.title = title;
  alert.message = message;
  alert.addAction("OK");
  await alert.presentAlert();
}

async function checkDue(config) {
  const result = await relay(config, "/x/repost/queue?status=queued&limit=30");
  const now = Math.floor(Date.now() / 1000);
  const next = result.items.find(item => Number(item.scheduled_at) <= now);
  if (!next || getStored(KEYS.lastNotification) === next.id) return;

  const notice = new Notification();
  notice.identifier = "relay-x-repost-" + next.id;
  notice.title = "🎬 Seu vídeo está pronto para o X";
  notice.body = "Abra o Scriptable para compartilhar e confirmar a publicação.";
  notice.openURL = URLScheme.forRunningScript();
  notice.sound = "default";
  await notice.schedule();
  Keychain.set(KEYS.lastNotification, next.id);
}

async function downloadVideo(config, item) {
  const fm = FileManager.local();
  const target = fm.joinPath(fm.temporaryDirectory(), "relay-x-" + item.id + ".mp4");
  if (fm.fileExists(target)) return target;

  // First try a private durable copy in R2, then the original source CDN URL.
  const sources = [
    { url: config.endpoint + "/x/repost/queue/" + item.id + "/media", private: true },
    ...(item.media_url ? [{ url: item.media_url, private: false }] : []),
  ];
  for (const source of sources) {
    try {
      const request = new Request(source.url);
      request.timeoutInterval = 60;
      if (source.private) request.headers = { Authorization: "Bearer " + config.token };
      const data = await request.load();
      const status = request.response && request.response.statusCode;
      const mime = String(request.response && request.response.headers
        ? request.response.headers["Content-Type"] || request.response.headers["content-type"] || ""
        : "");
      // Do not accidentally share a JSON error page as a video.
      if (status >= 400 || !data || data.length === 0 || /application\/json|text\/html/i.test(mime)) {
        continue;
      }
      fm.write(target, data);
      return target;
    } catch (error) {
      console.warn("Video source unavailable: " + String(error));
    }
  }
  return null;
}

async function finishItem(config, item) {
  const alert = new Alert();
  alert.title = "Publicação";
  alert.message = "Você publicou o vídeo no X? Só confirme se o post realmente apareceu.";
  alert.addAction("Sim, publiquei");
  alert.addAction("Adiar 1 hora");
  alert.addCancelAction("Não publiquei");
  const choice = await alert.presentAlert();

  if (choice === 0) {
    const linkPrompt = new Alert();
    linkPrompt.title = "Post publicado";
    linkPrompt.message = "URL do novo post (opcional).";
    linkPrompt.addTextField("https://x.com/seu-perfil/status/...");
    linkPrompt.addAction("Confirmar");
    await linkPrompt.presentAlert();
    const postUrl = (linkPrompt.textFieldValue(0) || "").trim();
    await relay(config, "/x/repost/queue/" + item.id, "PATCH", {
      action: "posted",
      claimToken: item.claim_token,
      postUrl,
    });
    await showMessage("Concluído", "Marcado como publicado. ✅");
  } else {
    const nextAt = Math.floor(Date.now() / 1000) + (choice === 1 ? 60 * 60 : 30 * 60);
    await relay(config, "/x/repost/queue/" + item.id, "PATCH", {
      action: "reschedule",
      scheduledAt: nextAt,
    });
  }
}

async function processNext(config) {
  const result = await relay(config, "/x/repost/claim", "POST", {});
  const item = result.item;
  if (!item) {
    await showMessage("Fila em dia", "Nenhum vídeo está agendado para agora.");
    return;
  }

  Pasteboard.copyString(item.caption);
  const localFile = Array.isArray(args.fileURLs) && args.fileURLs.length
    ? args.fileURLs[0] : null;
  const options = new Alert();
  options.title = "🎬 Publicar no X";
  options.message = item.caption + "\n\nA legenda já está copiada.";
  options.addAction("Compartilhar vídeo");
  options.addAction("Abrir compositor");
  options.addAction("Adiar 1 hora");
  options.addCancelAction("Cancelar por agora");
  const choice = await options.presentAlert();

  try {
    if (choice === 0) {
      const video = localFile || await downloadVideo(config, item);
      if (video) {
        await ShareSheet.present([video]);
      } else {
        await showMessage("Vídeo não disponível",
          "O MP4 não está no R2 nem no CDN. Use seu script de download e passe o arquivo ao Scriptable.");
        Safari.open(item.source_url);
        await relay(config, "/x/repost/queue/" + item.id, "PATCH", {
          action: "reschedule",
          scheduledAt: Math.floor(Date.now() / 1000) + 60 * 60,
        });
        return;
      }
      await finishItem(config, item);
    } else if (choice === 1) {
      Safari.open("https://x.com/intent/post?text=" + encodeURIComponent(item.caption));
      await finishItem(config, item);
    } else {
      const extra = choice === 2 ? 3600 : 1800;
      await relay(config, "/x/repost/queue/" + item.id, "PATCH", {
        action: "reschedule",
        scheduledAt: Math.floor(Date.now() / 1000) + extra,
      });
    }
  } catch (error) {
    // A claimed item has a two-hour server lease and will become eligible again.
    await showMessage("Não concluído", String(error));
  }
}

async function enqueueFromShortcut(config, payload) {
  const result = await relay(config, "/x/repost/queue", "POST", {
    url: payload.url || payload.sourceUrl,
    caption: payload.caption || "",
    hashtags: payload.hashtags || [],
    mediaUrl: payload.mediaUrl || null,
    telegramMessageUrl: payload.telegramMessageUrl || null,
  });
  Script.setShortcutOutput({
    ok: true,
    id: result.item.id,
    scheduledAt: result.item.scheduled_at,
  });
}

async function main() {
  const config = await configForMode();
  if (!config) return;
  if (mode === "check") return checkDue(config);
  if (mode === "enqueue") {
    if (!args.shortcutParameter || typeof args.shortcutParameter !== "object") {
      throw new Error("Passe um dicionário ao Atalhos no modo enqueue.");
    }
    return enqueueFromShortcut(config, args.shortcutParameter);
  }
  return processNext(config);
}

try {
  await main();
} catch (error) {
  console.error(error);
  if (mode !== "check") await showMessage("Relay X Queue", String(error));
} finally {
  Script.complete();
}
