import { create } from 'zustand';

type Modal = 'share' | 'record' | 'link' | 'upload' | 'help' | 'album' | null;

/** Board-level UI state: which dialog is open, panel visibility. */
export const useUi = create<{
  modal: Modal;
  legend: boolean;
  open: (m: Exclude<Modal, null>) => void;
  close: () => void;
  toggleLegend: () => void;
}>((set) => ({
  modal: null,
  legend: typeof window !== 'undefined' ? window.innerWidth > 1100 : true,
  open: (modal) => set({ modal }),
  close: () => set({ modal: null }),
  toggleLegend: () => set((s) => ({ legend: !s.legend })),
}));
