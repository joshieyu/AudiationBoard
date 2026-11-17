import { useEffect, useMemo, useRef } from 'react';
import type { Item } from '../../../shared/types';
import { renderMarkdown, toggleTask } from '../../lib/markdown';
import { removeItems, updateItem } from '../../store/actions';
import { useBoard } from '../../store/board';

const PLACEHOLDER = 'Write anything — lyrics, mix notes, a to-do…\n\n**bold** · *italic* · # heading · - list · - [ ] task · ==highlight==';

export function TextCard({ item }: { item: Item<'text'> }) {
  const editing = useBoard((s) => s.editingId === item.id);
  const editable = useBoard((s) => s.access === 'edit');
  const html = useMemo(() => renderMarkdown(item.data.md), [item.data.md]);
  const ta = useRef<HTMLTextAreaElement>(null);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editing && ta.current) {
      ta.current.focus();
      const len = ta.current.value.length;
      ta.current.setSelectionRange(len, len);
    }
  }, [editing]);

  const finish = () => {
    const md = ta.current?.value ?? item.data.md;
    useBoard.setState({ editingId: null });
    if (!md.trim() && !item.data.md.trim()) {
      removeItems([item.id]);
      return;
    }
    if (md !== item.data.md) updateItem(item.id, { data: { md } });
    // Grow to fit what was written (within reason).
    requestAnimationFrame(() => {
      const el = body.current;
      if (el && el.scrollHeight > el.clientHeight + 4) {
        const grow = Math.min(640, item.h + (el.scrollHeight - el.clientHeight) + 8);
        if (grow > item.h) updateItem(item.id, { h: Math.round(grow) }, false);
      }
    });
  };

  return (
    <div className={`card text-card note-${item.data.color}`} onDoubleClick={() => editable && useBoard.setState({ editingId: item.id })}>
      {editing ? (
        <textarea
          ref={ta}
          className="md-editor"
          defaultValue={item.data.md}
          placeholder={PLACEHOLDER}
          onBlur={finish}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) (e.target as HTMLTextAreaElement).blur();
          }}
          onPointerDown={(e) => e.stopPropagation()}
        />
      ) : (
        <div
          ref={body}
          className="md"
          data-scroll
          dangerouslySetInnerHTML={{ __html: item.data.md.trim() ? html : `<p class="md-empty">${editable ? 'Double-click to write' : 'Empty note'}</p>` }}
          onClick={(e) => {
            const t = e.target as HTMLElement;
            if (t instanceof HTMLInputElement && t.dataset.task !== undefined) {
              e.stopPropagation();
              if (!editable) {
                e.preventDefault();
                return;
              }
              updateItem(item.id, { data: { md: toggleTask(item.data.md, Number(t.dataset.task)) } });
            }
          }}
        />
      )}
    </div>
  );
}
