import { create } from 'zustand';

/** Live (uncommitted) drag/resize offsets, so only the cards involved re-render. */
export const useGesture = create<{
  dragIds: string[];
  dx: number;
  dy: number;
  resize: { id: string; w: number; h: number } | null;
}>(() => ({ dragIds: [], dx: 0, dy: 0, resize: null }));

/** Set while a two-finger pinch/pan is running so card drags yield to it. */
export const pinch = { active: false };

export function setGesturing(on: boolean) {
  document.body.classList.toggle('gesturing', on);
}
