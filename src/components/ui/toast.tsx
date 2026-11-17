import { create } from 'zustand';

interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'error' | 'success';
}

const useToasts = create<{ list: Toast[] }>(() => ({ list: [] }));
let seq = 0;

export function toast(text: string, tone: Toast['tone'] = 'info', ms = 3200) {
  const id = ++seq;
  useToasts.setState((s) => ({ list: [...s.list.slice(-3), { id, text, tone }] }));
  setTimeout(() => useToasts.setState((s) => ({ list: s.list.filter((t) => t.id !== id) })), ms);
}

export function Toasts() {
  const list = useToasts((s) => s.list);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
