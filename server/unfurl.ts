import dns from 'node:dns/promises';
import net from 'node:net';
import type { LinkMeta } from '../shared/types.ts';

const cache = new Map<string, { at: number; meta: LinkMeta }>();

function isPrivate(ip: string) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
    );
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivate(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

async function assertPublic(url: URL) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('bad protocol');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivate(a.address))) throw new Error('blocked host');
}

function decode(s: string) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .trim();
}

function metaContent(html: string, names: string[]) {
  for (const name of names) {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`,
      'i',
    );
    const m = html.match(re);
    const v = m?.[1] ?? m?.[2];
    if (v) return decode(v);
  }
  return undefined;
}

// Big media sites serve consent walls to scrapers but answer oEmbed cleanly.
const OEMBED: [RegExp, string][] = [
  [/^((www|m|music)\.)?youtube\.com$|^youtu\.be$/, 'https://www.youtube.com/oembed?format=json&url='],
  [/^vimeo\.com$/, 'https://vimeo.com/api/oembed.json?url='],
  [/^soundcloud\.com$/, 'https://soundcloud.com/oembed?format=json&url='],
  [/^open\.spotify\.com$/, 'https://open.spotify.com/oembed?url='],
];

async function oembed(url: URL): Promise<LinkMeta | null> {
  const host = url.hostname.replace(/^www\./, '');
  const endpoint = OEMBED.find(([re]) => re.test(host) || re.test(url.hostname))?.[1];
  if (!endpoint) return null;
  try {
    const res = await fetch(endpoint + encodeURIComponent(url.toString()), { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const j = (await res.json()) as { title?: string; author_name?: string; thumbnail_url?: string; provider_name?: string };
    if (!j.title) return null;
    return { title: j.title, description: j.author_name ? `by ${j.author_name}` : undefined, image: j.thumbnail_url, siteName: j.provider_name };
  } catch {
    return null;
  }
}

export async function unfurl(raw: string): Promise<LinkMeta> {
  const hit = cache.get(raw);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.meta;

  let url = new URL(raw);
  const viaOembed = await oembed(url);
  if (viaOembed) {
    cache.set(raw, { at: Date.now(), meta: viaOembed });
    return viaOembed;
  }
  let res: Response | null = null;
  for (let hop = 0; hop < 4; hop++) {
    await assertPublic(url);
    res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(6000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AudiationSpaceBot/1.0; +https://audiation.space)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      url = new URL(loc, url);
      continue;
    }
    break;
  }
  if (!res || !res.ok || !(res.headers.get('content-type') ?? '').includes('html')) return {};

  // Only read the head of the document.
  const reader = res.body!.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < 400_000) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
    if (new TextDecoder().decode(value).includes('</head>')) break;
  }
  reader.cancel().catch(() => {});
  const html = new TextDecoder().decode(Buffer.concat(chunks));

  const image = metaContent(html, ['og:image', 'twitter:image', 'og:image:url']);
  const meta: LinkMeta = {
    title: metaContent(html, ['og:title', 'twitter:title']) ?? (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ? decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)![1]) : undefined),
    description: metaContent(html, ['og:description', 'twitter:description', 'description'])?.slice(0, 300),
    image: image ? new URL(image, url).toString() : undefined,
    siteName: metaContent(html, ['og:site_name']) ?? url.hostname.replace(/^www\./, ''),
  };
  cache.set(raw, { at: Date.now(), meta });
  return meta;
}
