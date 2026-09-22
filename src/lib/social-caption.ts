import type { ParseMode } from '../types';

// Match platform UI sentences, not general words such as "adult" or "sensitive".
// Authored captions, account names, hashtags and source links are otherwise kept.
const NOTICE_PATTERNS = [
  /\bage\\?[-‐‑– ]restricted\s+adult\s+content(?:\\?[.!])?/giu,
  /\bthis\s+content\s+might\s+not\s+be\s+appropriate\s+for\s+people\s+under\s+18\s+years\s+old(?:\\?[.!])?/giu,
  /\bto\s+view\s+this\s+media,?\s+you(?:['’]|&apos;|&#39;|&#x27;)ll\s+need\s+to\s+log\s+in\s+to\s+(?:X|Twitter)(?:\\?[.!])?/giu,
  /\bthe\s+following\s+media\s+(?:includes|may\s+contain)\s+potentially\s+sensitive\s+content(?:\\?[.!])?/giu,
  /\bthis\s+(?:post|tweet)\s+may\s+contain\s+sensitive\s+content(?:\\?[.!])?/giu,
  /\bconte[uú]do\s+adulto\s+com\s+restri[çc][ãa]o\s+de\s+idade(?:[.!])?/giu,
  /\beste\s+conte[uú]do\s+(?:pode\s+n[ãa]o\s+ser|talvez\s+n[ãa]o\s+seja)\s+apropriado\s+para\s+(?:pessoas\s+)?menores\s+de\s+18\s+anos(?:[.!])?/giu,
  /\bpara\s+(?:ver|visualizar)\s+(?:esta|essa)\s+m[ií]dia,?\s+voc[eê]\s+(?:precisa|precisar[aá])\s+(?:fazer\s+login|entrar)\s+no\s+(?:X|Twitter)(?:[.!])?/giu,
  /(?:^|\n)\s*(?:Log\s+in\s+to\s+(?:X|Twitter)|Sign\s+in\s+to\s+(?:X|Twitter)|Entre\s+no\s+(?:X|Twitter))\s*(?=$|\n)/giu,
];

export function stripSocialAccessNotices(value: string): { caption: string; removed: boolean } {
  let caption = value;
  let removed = false;
  for (const pattern of NOTICE_PATTERNS) {
    caption = caption.replace(pattern, () => { removed = true; return ''; });
  }
  if (!removed) return { caption: value, removed: false };
  // "Learn more" belongs to the warning, but do not remove it from ordinary captions.
  caption = caption.replace(/(?:<a\b[^>]*>\s*(?:Learn more|Saiba mais)\s*<\/a>|\bLearn more\b|\bSaiba mais\b)/giu, '')
    .replace(/<(b|i|strong|em)>\s*<\/\1>/giu, '')
    .replace(/[\t ]+\n/g, '\n').replace(/\n[\t ]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n').trim();
  return { caption, removed };
}

export function sanitizeDeliveryCaption(
  caption: string,
  parseMode: ParseMode | null,
  sourceUrl?: string | null,
): string {
  const cleaned = stripSocialAccessNotices(caption);
  if (!cleaned.removed) return caption;
  let result = cleaned.caption;
  if (sourceUrl && /^https?:\/\//i.test(sourceUrl) && !/https?:\/\//i.test(result)) {
    result = result.replace(/(?:^|\n)\s*Origem\s*(?=$|\n)/giu, '').trim();
    const url = parseMode === 'HTML'
      ? sourceUrl.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      : parseMode === 'MarkdownV2'
        ? sourceUrl.replace(/[_*\[\]()~`>#+=|{}.!\\-]/g, '\\$&')
        : sourceUrl;
    result = [result, url].filter(Boolean).join('\n\n');
  }
  return result;
}

export function storedCaptionHasAccessNotice(presentationJson: string | null): boolean {
  if (!presentationJson) return false;
  try {
    const value = JSON.parse(presentationJson);
    return typeof value?.caption === 'string' && stripSocialAccessNotices(value.caption).removed;
  } catch { return false; }
}
