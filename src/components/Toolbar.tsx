import { useEffect, useRef } from 'react';
import { addFiles, addText } from '../store/actions';
import { redo, undo, useBoard } from '../store/board';
import { Icon, type IconName } from './ui/Icon';
import { useUi } from './uiState';

function Tool({ icon, label, kbd, onClick, disabled }: { icon: IconName; label: string; kbd?: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button className="tool" onClick={onClick} disabled={disabled} aria-label={label}>
      <Icon name={icon} size={19} />
      <span className="tool-tip">
        {label}
        {kbd && <kbd>{kbd}</kbd>}
      </span>
    </button>
  );
}

export function Toolbar() {
  const canUndo = useBoard((s) => s.canUndo);
  const canRedo = useBoard((s) => s.canRedo);
  const { open, modal, close } = useUi();
  const audioInput = useRef<HTMLInputElement>(null);
  const midiInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);

  // "upload" from the empty state opens the audio picker.
  useEffect(() => {
    if (modal === 'upload') {
      close();
      audioInput.current?.click();
    }
  }, [modal, close]);

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    if (files.length) void addFiles(files);
  };

  return (
    <nav className="toolbar panel" aria-label="Add to board">
      <Tool icon="note" label="Note" kbd="N" onClick={() => addText()} />
      <Tool icon="audio" label="Audio" kbd="A" onClick={() => audioInput.current?.click()} />
      <Tool icon="piano" label="MIDI" kbd="M" onClick={() => midiInput.current?.click()} />
      <Tool icon="mic" label="Record" kbd="R" onClick={() => open('record')} />
      <Tool icon="image" label="Image" kbd="I" onClick={() => imageInput.current?.click()} />
      <Tool icon="link" label="Link" kbd="L" onClick={() => open('link')} />
      <div className="tool-sep" />
      <Tool icon="undo" label="Undo" kbd="⌘Z" onClick={undo} disabled={!canUndo} />
      <Tool icon="redo" label="Redo" kbd="⇧⌘Z" onClick={redo} disabled={!canRedo} />
      <input ref={audioInput} type="file" hidden multiple accept="audio/*,.wav,.aif,.aiff,.flac,.mp3,.ogg,.m4a,.mid,.midi" onChange={pick} data-picker="audio" />
      <input ref={midiInput} type="file" hidden multiple accept=".mid,.midi,audio/midi" onChange={pick} data-picker="midi" />
      <input ref={imageInput} type="file" hidden multiple accept="image/*" onChange={pick} data-picker="image" />
    </nav>
  );
}
