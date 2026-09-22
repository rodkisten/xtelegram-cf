import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeDeliveryCaption, stripSocialAccessNotices } from '../src/lib/social-caption.ts';
import { resolveSocialDeliveryContent } from '../src/services/social-metadata.ts';

const warning = 'Age-restricted adult content. This content might not be appropriate for people under 18 years old. To view this media, you’ll need to log in to X. Learn more';
const sourceUrl = 'https://x.com/example/status/123';

test('removes the complete X age gate, straight or curly apostrophe', () => {
  for (const text of [warning, warning.replace('’', "'"), warning.replace('’', '&#39;')]) {
    assert.equal(stripSocialAccessNotices(text).caption, '');
    assert.equal(sanitizeDeliveryCaption(text, null, sourceUrl), sourceUrl);
  }
});

test('preserves author, source link, real text and every hashtag in an HTML caption', () => {
  const caption = `<b>X</b>\n\n@example\n\nA real caption\n\n${warning}\n\n<a href="${sourceUrl}">Origem</a>\n\n#Caught #Public #Spy`;
  const cleaned = sanitizeDeliveryCaption(caption, 'HTML', sourceUrl);
  assert.ok(!cleaned.includes('Age-restricted'));
  assert.ok(cleaned.includes('@example')); assert.ok(cleaned.includes('A real caption'));
  assert.ok(cleaned.includes(`<a href="${sourceUrl}">Origem</a>`));
  assert.ok(cleaned.endsWith('#Caught #Public #Spy'));
});

test('keeps genuine captions unchanged, including ordinary adult/sensitive vocabulary', () => {
  for (const text of ['I make adult content', 'A sensitive topic. Learn more on my website', 'I log in to X every day', 'Age 18 and proud', 'A caption with #Public']) {
    assert.equal(stripSocialAccessNotices(text).caption, text);
    assert.equal(stripSocialAccessNotices(text).removed, false);
  }
});

test('resolver warning is rejected, but a second valid caption candidate is used', async () => {
  const result = await resolveSocialDeliveryContent({ provider: 'twitter', sourceUrl,
    caption: '', captionExplicit: false, parseMode: null,
    metadata: { socialResolvedCaption: warning, socialCaption: 'The actual caption', socialAuthorUsername: 'example' },
    hashtags: ['Public'],
  }, {} as any);
  assert.ok(result.caption.includes('The actual caption'));
  assert.ok(!result.caption.includes('Age-restricted'));
  assert.ok(result.caption.includes('@example')); assert.ok(result.caption.endsWith('#Public'));
});

test('author-only resolver metadata produces clean attribution instead of a warning', async () => {
  const result = await resolveSocialDeliveryContent({ provider: 'twitter', sourceUrl,
    caption: '', captionExplicit: false, parseMode: null,
    metadata: { socialResolvedCaption: warning, socialAuthorUsername: 'example' }, hashtags: ['Public'],
  }, {} as any);
  assert.ok(!result.caption.includes('Age-restricted'));
  assert.ok(result.caption.includes(sourceUrl)); assert.ok(result.caption.includes('@example'));
});

test('explicit client captions are cleaned before appending requested hashtags', async () => {
  const result = await resolveSocialDeliveryContent({ provider: 'twitter', sourceUrl,
    caption: warning, captionExplicit: true, parseMode: null, metadata: null, hashtags: ['Public'],
  }, {} as any);
  assert.equal(result.caption, `${sourceUrl}\n\n#Public`);
});
