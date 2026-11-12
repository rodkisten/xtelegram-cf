import type { Env } from "../types";

export async function scheduleNotificationDeletion(env: Env, chatId: string, messageId: number, minutes: number): Promise<void> {
  if (!minutes) return;
  const due = Math.floor(Date.now() / 1000) + minutes * 60;
  await env.RELAY_DB.prepare(
    "INSERT INTO notification_retention(chat_id,message_id,delete_at) VALUES(?,?,?) " +
    "ON CONFLICT(chat_id,message_id) DO UPDATE SET delete_at=excluded.delete_at,status='pending',attempts=0,lease_until=0,last_error=NULL"
  ).bind(chatId, messageId, due).run();
}
export async function processNotificationDeletions(env: Env): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const due = await env.RELAY_DB.prepare(
    "SELECT chat_id,message_id FROM notification_retention WHERE status='pending' AND delete_at<=? AND lease_until<=? ORDER BY delete_at LIMIT 15"
  ).bind(now, now).all<{chat_id:string;message_id:number}>();
  for (const item of due.results) {
    const lease = await env.RELAY_DB.prepare(
      "UPDATE notification_retention SET lease_until=? WHERE chat_id=? AND message_id=? AND status='pending' AND lease_until<=?"
    ).bind(now+90,item.chat_id,item.message_id,now).run();
    if (!lease.meta.changes) continue;
    try {
      const response = await fetch("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/deleteMessage", {
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({chat_id:item.chat_id,message_id:item.message_id}),
      });
      const result = await response.json() as {ok?:boolean;description?:string};
      if (response.ok && result.ok || /message to delete not found/i.test(result.description || "")) {
        await env.RELAY_DB.prepare(
          "DELETE FROM notification_retention WHERE chat_id=? AND message_id=?"
        ).bind(item.chat_id,item.message_id).run();
      } else {
        await env.RELAY_DB.prepare(
          "UPDATE notification_retention SET attempts=attempts+1,lease_until=0,delete_at=?,status=CASE WHEN attempts>=8 THEN 'failed' ELSE 'pending' END,last_error=? WHERE chat_id=? AND message_id=?"
        ).bind(now+Math.min(3600,60*(2**Math.min(6,Number(response.status===429?4:1)))),String(result.description || response.status).slice(0,200),item.chat_id,item.message_id).run();
      }
    } catch (error) {
      await env.RELAY_DB.prepare(
        "UPDATE notification_retention SET attempts=attempts+1,lease_until=0,delete_at=?,status=CASE WHEN attempts>=8 THEN 'failed' ELSE 'pending' END,last_error=? WHERE chat_id=? AND message_id=?"
      ).bind(now+300,error instanceof Error?error.message.slice(0,200):"Network error",item.chat_id,item.message_id).run();
    }
  }
}
