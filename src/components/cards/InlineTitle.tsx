import { useState } from 'react';
import { useBoard } from '../../store/board';

/** A card title that renames on double-click, or when the card menu's Rename sets editingId. */
export function InlineTitle({ id, value, editable, onChange }: { id: string; value: string; editable: boolean; onChange: (v: string) => void }) {
  const [local, setLocal] = useState(false);
  const fromMenu = useBoard((s) => s.editingId === id);
  const editing = editable && (local || fromMenu);
  const setEditing = (on: boolean) => {
    setLocal(on);
    if (!on && useBoard.getState().editingId === id) useBoard.setState({ editingId: null });
  };
  if (editing)
    return (
      <input
        className="sc-name-input"
        autoFocus
        defaultValue={value}
        data-nodrag
        onFocus={(e) => e.target.select()}
        onBlur={(e) => {
          setEditing(false);
          const v = e.target.value.trim();
          if (v && v !== value) onChange(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            (e.target as HTMLInputElement).value = value;
            (e.target as HTMLInputElement).blur();
          }
          e.stopPropagation();
        }}
      />
    );
  return (
    <div className="sc-name" title={editable ? `${value} — double-click to rename` : value} onDoubleClick={() => editable && setEditing(true)}>
      {value}
    </div>
  );
}
