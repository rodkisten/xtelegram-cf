import type { Env } from "../types";
import { deliverMutableNotification } from "../lib/mutable-notifications";
import type { NotificationButton } from "../lib/github-notifications";

type Event = { id: number; title: string; detail: string; severity: string };
export type GroupInput = {
  chatId: string; threadId: number | null; groupKey: string; eventKey: string;
  title: string; detail: string; severity: "running" | "success" | "error";
  buttons: NotificationButton[][]; deleteAfterMinutes: number;
};
export async function appendNotificationGroup(env: Env, input: GroupInput) {
  const threadId = input.threadId ?? 0;
  await env.RELAY_DB.prepare(
    "INSERT INTO notification_group_events(chat_id,thread_id,group_key,event_key,title,detail,severity) " +
    "VALUES(?,?,?,?,?,?,?) ON CONFLICT(chat_id,thread_id,group_key,event_key) " +
    "DO UPDATE SET title=excluded.title,detail=excluded.detail,severity=excluded.severity"
  ).bind(input.chatId,threadId,input.groupKey,input.eventKey,input.title,input.detail,input.severity).run();
  const rows = await env.RELAY_DB.prepare(
    "SELECT id,title,detail,severity FROM notification_group_events " +
    "WHERE chat_id=? AND thread_id=? AND group_key=? ORDER BY id DESC LIMIT 25"
  ).bind(input.chatId,threadId,input.groupKey).all<Event>();
  const events = [...rows.results].reverse();
  const count = events.length;
  const errors = events.filter(x=>x.severity==="error").length;
  const running = events.filter(x=>x.severity==="running").length;
  const success = count-errors-running;
  const heading = errors ? "⚠️" : running ? "⏳" : "✅";
  const summary = heading+" PhotoIntel · "+count+" eventos\n"+
    "❌ "+errors+" erros · ⏳ "+running+" executando · ✅ "+success+" concluídos";
  const body = events.map(x=>(x.severity==="error"?"❌ ":x.severity==="running"?"⏳ ":"✅ ")+
    x.title+"\n"+x.detail.slice(0,250)).join("\n\n");
  const text = (summary+"\n\n"+body).slice(0,3900);
  const sequence = Math.max(...events.map(x=>x.id));
  return deliverMutableNotification(env,{
    chatId:input.chatId,threadId:input.threadId,notificationKey:"group:"+input.groupKey,
    sequence,text,parseMode:null,buttons:input.buttons,
    disableNotification:count>1,
  });
}
