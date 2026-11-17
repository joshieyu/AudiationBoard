import type { Embed } from '../../shared/types';

export function normalizeUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname.includes('.')) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function looksLikeUrl(s: string) {
  return /^(https?:\/\/|www\.)\S+$/i.test(s.trim()) || /^[a-z0-9-]+(\.[a-z0-9-]+)+\/\S*$/i.test(s.trim());
}

function ytStart(u: URL) {
  const t = u.searchParams.get('t') ?? u.searchParams.get('start');
  if (!t) return '';
  const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
  const secs = m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : Number(t);
  return secs ? `&start=${secs}` : '';
}

/** Recognised music/video players, rendered inline instead of as a plain link. */
export function embedFor(raw: string): Embed | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www|m)\./, '');

  if (host === 'youtube.com' || host === 'music.youtube.com' || host === 'youtu.be' || host === 'youtube-nocookie.com') {
    let id: string | null = null;
    if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (u.pathname === '/watch') id = u.searchParams.get('v');
    else {
      const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{6,})/);
      if (m) id = m[1];
    }
    if (id && /^[\w-]{6,}$/.test(id)) {
      return {
        provider: 'youtube',
        src: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0${ytStart(u)}`,
        height: 0,
        thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        kind: host === 'music.youtube.com' ? 'song' : 'video',
      };
    }
  }

  if (host === 'open.spotify.com') {
    const m = u.pathname.match(/^\/(?:intl-[a-z-]+\/)?(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]+)/);
    if (m) {
      const tall = m[1] !== 'track' && m[1] !== 'episode';
      return { provider: 'spotify', src: `https://open.spotify.com/embed/${m[1]}/${m[2]}?utm_source=generator&theme=0`, height: tall ? 352 : 152, kind: m[1] };
    }
  }

  if (host === 'soundcloud.com' || host === 'on.soundcloud.com') {
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length >= 2 || host === 'on.soundcloud.com') {
      const set = parts[1] === 'sets';
      return {
        provider: 'soundcloud',
        src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(u.toString())}&color=%23ff5500&auto_play=false&visual=${set ? 'true' : 'false'}&show_comments=false`,
        height: set ? 300 : 166,
        kind: set ? 'playlist' : 'track',
      };
    }
  }

  if (host === 'music.apple.com') {
    const isSong = u.searchParams.has('i') || u.pathname.includes('/song/');
    return { provider: 'apple', src: `https://embed.music.apple.com${u.pathname}${u.search}`, height: isSong ? 175 : 450, kind: isSong ? 'song' : 'album' };
  }

  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const m = u.pathname.match(/(?:\/video)?\/(\d+)/);
    if (m) return { provider: 'vimeo', src: `https://player.vimeo.com/video/${m[1]}?autoplay=1`, height: 0, kind: 'video' };
  }

  if (host.endsWith('bandcamp.com') && /\/(track|album)\//.test(u.pathname)) {
    // Bandcamp needs a numeric id from the page, so it renders as a rich link.
    return null;
  }
  return null;
}

export const PROVIDER_LABEL: Record<Embed['provider'], string> = {
  youtube: 'YouTube',
  spotify: 'Spotify',
  soundcloud: 'SoundCloud',
  apple: 'Apple Music',
  vimeo: 'Vimeo',
  bandcamp: 'Bandcamp',
};
