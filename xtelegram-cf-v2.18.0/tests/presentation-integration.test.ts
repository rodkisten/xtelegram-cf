import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestDb } from './helpers/d1.ts';
import { checkStoredMediaDeliveries, persistSuccessfulDeliveries } from '../src/db.ts';
import { handleSend } from '../src/routes/send/index.ts';
import { handleBatch } from '../src/routes/batch.ts';
import { handleResolve } from '../src/routes/resolve.ts';
import { handleMediaCheck } from '../src/routes/media/check.ts';
import { handleMediaRegister } from '../src/routes/media/register.ts';

const identity = { key: 'twitter:123', provider: 'twitter', providerMediaId: '123', canonicalUrl: 'https://x.com/example/status/123', legacyKeys: [] };
const channel = '-100123:65';
const channel2 = '-100123:66';
const payload = { mediaUrl: 'https://cdn.example.com/video.mp4', sourceUrl: identity.canonicalUrl, provider: 'twitter', mediaId: '123', channels: [channel] };
const req = (body: unknown) => new Request('https://relay.example/send', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test' }, body: JSON.stringify(body) });
async function fixture(t: any, channels = [channel]) {
  const { db, sqlite } = createTestDb();
  t.after(() => sqlite.close());
  const env = { RELAY_DB: db, TELEGRAM_BOT_TOKEN: 'test-token', RELAY_TOKEN: 'test' } as any;
  await persistSuccessfulDeliveries(db, { identity, sourceUrl: identity.canonicalUrl, pageUrl: null,
    mediaType: 'video', mediaCount: 1, caption: 'Original', parseMode: 'HTML',
    metadata: { a: '1', b: '2' }, presentationMetadata: { a: '1', b: '2' },
    deliveries: channels.map((c, i) => ({ requestedChatId: c, telegramChatId: '-100123', telegramChatTitle: null, messageIds: [101 + i] })),
  });
  const calls: any[] = [];
  let failure = '';
  let hold: Promise<void> | null = null;
  t.mock.method(globalThis, 'fetch', async (url: any, init: any) => {
    assert.equal(String(url), 'https://api.telegram.org/bottest-token/editMessageCaption', 'no source download, resolver or media send allowed');
    const body = JSON.parse(init.body); calls.push(body);
    if (hold) await hold;
    return Response.json(failure ? { ok: false, description: failure, error_code: 400 }
      : { ok: true, result: { message_id: body.message_id, chat: { id: -100123 } } }, { status: failure ? 400 : 200 });
  });
  const record = async () => (await checkStoredMediaDeliveries(db, [identity])).get(identity.key)!;
  return { env, db, sqlite, calls, record, fail(value: string) { failure = value; }, hold(value: Promise<void> | null) { hold = value; } };
}

test('same payload and reordered metadata make no Telegram edits or snapshot writes', async (t) => {
  const f = await fixture(t);
  const before = await f.record();
  const result = await (await handleSend(req({ ...payload, caption: 'Original', parseMode: 'HTML', metadata: { b: '2', a: '1' } }), f.env)).json() as any;
  assert.equal(result.action, 'presentation_unchanged'); assert.equal(f.calls.length, 0);
  assert.equal((await f.record()).deliveries[0].presentationUpdatedAt, before.deliveries[0].presentationUpdatedAt);
});

test('changed caption edits once and reports before/after; retry is a no-op', async (t) => {
  const f = await fixture(t);
  const body = { ...payload, caption: 'New', parseMode: 'HTML', metadata: { a: '2', c: '3' } };
  const result = await (await handleSend(req(body), f.env)).json() as any;
  assert.equal(result.presentation.edited, 1); assert.equal(f.calls[0].message_id, 101);
  assert.ok(result.presentationResults[0].changes.some((c: any) => c.field === 'metadata.a' && c.before === '1' && c.after === '2'));
  await handleSend(req(body), f.env); assert.equal(f.calls.length, 1);
  assert.equal((await f.record()).deliveries[0].sendCount, 1);
});

test('metadata-only update preserves caption, ignores key order, and clears explicitly', async (t) => {
  const f = await fixture(t);
  await handleSend(req({ ...payload, metadata: { a: '3' } }), f.env);
  const r = await f.record();
  assert.equal(r.media.caption, 'Original'); assert.equal(r.deliveries[0].sendCount, 1);
  assert.equal(JSON.parse(r.deliveries[0].presentationJson!).caption, 'Original');
  await handleSend(req({ ...payload, metadata: {} }), f.env);
  assert.equal((await f.record()).media.metadata, null); assert.equal(f.calls.length, 0);
});

test('explicit empty caption removes caption and retries unchanged', async (t) => {
  const f = await fixture(t);
  await handleSend(req({ ...payload, caption: '' }), f.env);
  assert.equal(f.calls[0].caption, ''); assert.equal((await f.record()).media.caption, null);
  await handleSend(req({ ...payload, caption: '' }), f.env); assert.equal(f.calls.length, 1);
});

test('failed edits retain confirmed state and can be retried', async (t) => {
  const f = await fixture(t); f.fail('Bad Request: message cannot be edited');
  const body = { ...payload, caption: 'New' };
  const response = await handleSend(req(body), f.env); assert.equal(response.status, 207);
  assert.equal(JSON.parse((await f.record()).deliveries[0].presentationJson!).caption, 'Original');
  f.fail(''); await handleSend(req(body), f.env); assert.equal(f.calls.length, 2);
  await handleSend(req(body), f.env); assert.equal(f.calls.length, 2);
});

test('Telegram not modified confirms the snapshot and stops repeated calls', async (t) => {
  const f = await fixture(t); f.fail('Bad Request: message is not modified');
  await handleSend(req({ ...payload, caption: 'Already new' }), f.env);
  await handleSend(req({ ...payload, caption: 'Already new' }), f.env);
  assert.equal(f.calls.length, 1);
});

test('batch reaches existing messages and honors per-item metadata removal', async (t) => {
  const f = await fixture(t);
  const response = await handleBatch(req({ channels: [channel], metadata: { inherited: 'yes' }, items: [{ ...payload, caption: 'Batch', metadata: null }] }), f.env);
  const body = await response.json() as any;
  assert.equal(body.results[0].presentation.edited, 1);
  assert.equal(JSON.parse((await f.record()).deliveries[0].presentationJson!).metadata, null);
});

test('resolve-and-send edits known social media without invoking the resolver', async (t) => {
  const f = await fixture(t);
  const response = await handleResolve(req({ url: identity.canonicalUrl, channels: [channel], caption: 'Resolved edit' }), f.env, true);
  assert.equal(response.status, 200); assert.equal(f.calls.length, 1);
});

test('media/check respects the channel of each item and does not edit unrelated topics', async (t) => {
  const f = await fixture(t, [channel, channel2]);
  await handleMediaCheck(req({ items: [
    { mediaKey: identity.key, channels: [channel], caption: 'First' },
    { mediaKey: identity.key, channels: [channel2], caption: 'Second' },
  ] }), f.env);
  assert.deepEqual(f.calls.map((c) => [c.message_id, c.caption]), [[101, 'First'], [102, 'Second']]);
});

test('legacy untargeted delivery keeps old baseline after another topic is edited', async (t) => {
  const f = await fixture(t, [channel, channel2]);
  f.sqlite.exec('UPDATE media_deliveries SET presentation_json = NULL');
  await handleSend(req({ ...payload, caption: 'Changed' }), f.env);
  await handleSend(req({ ...payload, channels: [channel2], caption: 'Changed' }), f.env);
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1].message_id, 102);
});

test('concurrent edits are serialized without duplicate Telegram calls', async (t) => {
  const f = await fixture(t);
  let release!: () => void;
  f.hold(new Promise<void>((resolve) => { release = resolve; }));
  const body = { ...payload, caption: 'Concurrent' };
  const first = handleSend(req(body), f.env);
  while (!f.calls.length) await new Promise((resolve) => setImmediate(resolve));
  const second = await (await handleSend(req(body), f.env)).json() as any;
  assert.equal(second.presentationResults[0].reason, 'update_in_progress');
  release(); await first; f.hold(null);
  await handleSend(req(body), f.env); assert.equal(f.calls.length, 1);
});

test('registration retry reports edit failure and preserves send count', async (t) => {
  const f = await fixture(t); f.fail('Bad Request: missing message');
  const response = await handleMediaRegister(req({ mediaKey: identity.key, channel, telegramChatId: '-100123', messageId: 101, caption: 'New' }), f.env);
  assert.equal(response.status, 207); assert.equal((await response.json() as any).ok, false);
  assert.equal((await f.record()).deliveries[0].sendCount, 1);
});

test('album duplicate edits its principal caption without resolving or uploading media', async (t) => {
  const f = await fixture(t);
  const response = await handleSend(req({ ...payload, caption: 'Album caption', mediaItems: [
    { mediaUrl: 'https://cdn.example.com/a.mp4', mediaType: 'video' },
    { mediaUrl: 'https://cdn.example.com/b.mp4', mediaType: 'video' },
  ] }), f.env);
  assert.equal(response.status, 200);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].caption, 'Album caption');
});

test('multipart duplicate compares metadata and edits the existing caption', async (t) => {
  const f = await fixture(t);
  const form = new FormData();
  form.set('payload', JSON.stringify({ ...payload, caption: 'Multipart caption', mediaType: 'photo' }));
  form.set('file', new Blob(['fixture'], { type: 'image/jpeg' }), 'fixture.jpg');
  const response = await handleSend(new Request('https://relay.example/send', { method: 'POST', body: form }), f.env);
  assert.equal(response.status, 200, await response.text());
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].caption, 'Multipart caption');
});

const xWarning = 'Age-restricted adult content. This content might not be appropriate for people under 18 years old. To view this media, you’ll need to log in to X. Learn more';
async function dirtyFixture(t: any) {
  const f = await fixture(t);
  const dirty = `<b>X</b>\n\n@example\n\n${xWarning}\n\n<a href="${identity.canonicalUrl}">Origem</a>\n\n#Caught #Public #Spy`;
  f.sqlite.prepare('UPDATE media SET caption = ?').run(dirty);
  f.sqlite.prepare('UPDATE media_deliveries SET presentation_json = ?').run(JSON.stringify({ caption: dirty, parseMode: 'HTML', metadata: { a: '1', b: '2' } }));
  return f;
}

test('reprocessing a URL repairs a stored X warning once, retaining hashtags and message id', async (t) => {
  const f = await dirtyFixture(t);
  const body = { url: identity.canonicalUrl, channels: [channel] };
  const first = await handleResolve(req(body), f.env, true);
  assert.equal(first.status, 200); assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].message_id, 101);
  assert.ok(f.calls[0].caption.endsWith('#Caught #Public #Spy'));
  assert.ok(!f.calls[0].caption.includes('Age-restricted'));
  assert.ok(!(await f.record()).media.caption?.includes('Age-restricted'));
  await handleResolve(req(body), f.env, true); assert.equal(f.calls.length, 1);
});

test('batch also repairs stored warnings without requiring an explicit new caption', async (t) => {
  const f = await dirtyFixture(t);
  await handleBatch(req({ channels: [channel], items: [payload] }), f.env);
  assert.equal(f.calls.length, 1); assert.ok(!f.calls[0].caption.includes('Age-restricted'));
});

test('a failed warning cleanup remains eligible for retry', async (t) => {
  const f = await dirtyFixture(t); f.fail('Bad Request: unavailable');
  assert.equal((await handleSend(req(payload), f.env)).status, 207);
  assert.ok(JSON.parse((await f.record()).deliveries[0].presentationJson!).caption.includes('Age-restricted'));
  f.fail(''); await handleSend(req(payload), f.env);
  assert.equal(f.calls.length, 2);
});
