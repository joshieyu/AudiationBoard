import { useBoard } from '../store/board';
import { useUi } from './uiState';
import { Icon } from './ui/Icon';
import { addText } from '../store/actions';

const COPY = {
  single: {
    title: 'Start your board',
    body: 'Drop loops, stems, voice memos, MIDI, images or links anywhere. Every sound is listened to on arrival and tagged by role, tone and character, so you can tell your pads from your plucks at a glance.',
  },
  song: {
    title: 'Start this song',
    body: 'Drop the loops, stems, memos and MIDI for this song. Set its key and tempo at the bottom so you can see what fits.',
  },
  overview: {
    title: 'The album page',
    body: 'For ideas that cover the whole record: the concept, artwork and mood references, sequencing notes, and sounds you want to run through every song.',
  },
};

export function EmptyState() {
  const editable = useBoard((s) => s.access === 'edit');
  const kind = useBoard((s) => s.kind);
  const open = useUi((s) => s.open);
  const copy = COPY[kind] ?? COPY.single;
  if (!editable)
    return (
      <div className="empty">
        <div className="empty-card">
          <h2>Nothing here yet</h2>
          <p>Whoever has the edit link hasn't added anything to this board.</p>
        </div>
      </div>
    );
  return (
    <div className="empty">
      <div className="empty-card">
        <div className="empty-wave" aria-hidden>
          {Array.from({ length: 28 }, (_, i) => (
            <span key={i} style={{ animationDelay: `${i * 60}ms`, ['--h' as string]: `${18 + Math.abs(Math.sin(i * 0.7)) * 70}%` }} />
          ))}
        </div>
        <h2>{copy.title}</h2>
        <p>{copy.body}</p>
        <div className="empty-actions">
          <button className="btn primary" onClick={() => open('upload')}>
            <Icon name="audio" size={16} /> Add sounds
          </button>
          <button className="btn" onClick={() => open('record')}>
            <Icon name="mic" size={16} /> Record an idea
          </button>
          <button className="btn" onClick={() => addText()}>
            <Icon name="note" size={16} /> Write a note
          </button>
          <button className="btn" onClick={() => open('link')}>
            <Icon name="link" size={16} /> Paste a link
          </button>
        </div>
        <p className="empty-hint">Tip: double-click empty space for a note · paste a YouTube or Spotify link anywhere</p>
      </div>
    </div>
  );
}
