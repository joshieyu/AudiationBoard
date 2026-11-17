import { create } from 'zustand';

export const useRoute = create<{ path: string }>(() => ({ path: location.pathname }));

export function navigate(path: string) {
  if (path === location.pathname) return;
  history.pushState(null, '', path);
  useRoute.setState({ path });
}

window.addEventListener('popstate', () => useRoute.setState({ path: location.pathname }));

export type Route =
  | { name: 'home' }
  | { name: 'admin' }
  | { name: 'board'; token: string; mode: 'edit' | 'view' }
  | { name: 'album'; token: string; song: string | null };

export function parseRoute(path: string): Route {
  if (/^\/admin\/?$/.test(path)) return { name: 'admin' };
  const m = path.match(/^\/(b|e)\/([\w-]+)\/?$/);
  if (m) return { name: 'board', token: m[2], mode: m[1] === 'e' ? 'edit' : 'view' };
  const a = path.match(/^\/a\/([\w-]+)(?:\/([\w-]+))?\/?$/);
  if (a) return { name: 'album', token: a[1], song: a[2] ?? null };
  return { name: 'home' };
}

/** Like navigate, but replaces the history entry (for redirects). */
export function replaceRoute(path: string) {
  history.replaceState(null, '', path);
  useRoute.setState({ path });
}
