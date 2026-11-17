import { useState } from 'react';

export function InlineTitle({ value, editable, onChange }: { value: string; editable: boolean; onChange: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
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
