import { create } from 'zustand';
import type { Theme } from './colors';

type Pref = Theme | 'system';

function systemTheme(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function readPref(): Pref {
  try {
    const v = localStorage.getItem('ab:theme');
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0c0d11' : '#f3f1ec');
}

const initialPref = readPref();
const initial = initialPref === 'system' ? systemTheme() : initialPref;
apply(initial);

export const useTheme = create<{ theme: Theme; pref: Pref }>(() => ({ theme: initial, pref: initialPref }));

window.matchMedia?.('(prefers-color-scheme: light)').addEventListener('change', () => {
  if (useTheme.getState().pref === 'system') {
    const t = systemTheme();
    apply(t);
    useTheme.setState({ theme: t });
  }
});

export function toggleTheme() {
  const next: Theme = useTheme.getState().theme === 'dark' ? 'light' : 'dark';
  try {
    localStorage.setItem('ab:theme', next);
  } catch {
    /* storage unavailable */
  }
  apply(next);
  useTheme.setState({ theme: next, pref: next });
}
