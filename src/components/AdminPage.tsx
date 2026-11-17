import { useEffect, useMemo, useState } from 'react';
import type { AdminStatus, AdminStorage, StorageBoard } from '../../shared/types';
import { adminDelete, adminKey, adminPruneUnused, adminStorage, formatBytes, setAdminKey } from '../lib/api';
import { toggleTheme, useTheme } from '../lib/theme';
import { navigate } from '../router';
import { Dialog } from './ui/Popover';
import { Icon } from './ui/Icon';

interface Project {
  key: string;
  type: 'album' | 'single';
  id: string;
  href: string;
  title: string;
  bytes: number;
  items: number;
  updatedAt: number;
  children: StorageBoard[];
}

type Sort = 'size' | 'stale' | 'recent';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const ago = (t: number) => {
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 60) return `${days} days ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

function projectsOf(data: AdminStorage): Project[] {
  const out: Project[] = [];
  for (const a of data.albums) {
    const children = data.boards.filter((b) => b.albumId === a.id).sort((x, y) => (x.kind === 'overview' ? -1 : y.kind === 'overview' ? 1 : x.position - y.position));
    out.push({
      key: `album:${a.id}`,
      type: 'album',
      id: a.id,
      href: `/a/${a.editId}`,
      title: a.title,
      bytes: children.reduce((n, b) => n + b.bytes, 0),
      items: children.reduce((n, b) => n + b.items, 0),
      updatedAt: Math.max(a.updatedAt, ...children.map((b) => b.updatedAt)),
      children,
    });
  }
  for (const b of data.boards) {
    if (b.albumId) continue;
    out.push({ key: `board:${b.id}`, type: 'single', id: b.id, href: `/e/${b.editId}`, title: b.title, bytes: b.bytes, items: b.items, updatedAt: b.updatedAt, children: [] });
  }
  return out;
}

function DiskMeter({ status, ours }: { status: AdminStatus; ours: number }) {
  const { total, free } = status.disk;
  const other = Math.max(0, total - free - ours);
  const pct = (n: number) => `${(n / total) * 100}%`;
  return (
    <div className="disk">
      <div className="disk-bar" role="img" aria-label={`${formatBytes(free)} free of ${formatBytes(total)}`}>
        <span className="disk-ours" style={{ width: pct(ours) }} />
        <span className="disk-other" style={{ width: pct(other) }} />
        {status.warnFree > 0 && <i className="disk-mark warn" style={{ right: pct(status.warnFree) }} title={`Warning below ${formatBytes(status.warnFree)} free`} />}
        {status.minFree > 0 && <i className="disk-mark stop" style={{ right: pct(status.minFree) }} title={`Uploads stop below ${formatBytes(status.minFree)} free`} />}
      </div>
      <div className="disk-legend">
        <span><i className="sw ours" /> Audiation Space · {formatBytes(ours)}</span>
        <span><i className="sw other" /> Everything else on the server · {formatBytes(other)}</span>
        <span><i className="sw free" /> Free · {formatBytes(free)}</span>
      </div>
    </div>
  );
}

function Unlock({ onKey, error }: { onKey: (k: string) => void; error: string | null }) {
  const [value, setValue] = useState('');
  return (
    <form
      className="admin-card admin-unlock"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onKey(value.trim());
      }}
    >
      <h2>Admin</h2>
      <p>Enter the admin key from the server's settings. This browser will remember it.</p>
      <label className="field">
        <span>Admin key</span>
        <input type="password" autoFocus autoComplete="current-password" value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      {error && <p className="form-error">{error}</p>}
      <button className="btn primary">Unlock</button>
    </form>
  );
}

export function AdminPage() {
  const theme = useTheme((s) => s.theme);
  const [key, setKey] = useState<string | null>(() => adminKey());
  const [data, setData] = useState<AdminStorage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>('size');
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Admin · Audiation Space';
  }, []);

  const load = async (k: string) => {
    try {
      const d = await adminStorage(k);
      setData(d);
      setError(null);
      setAdminKey(k);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 401 || status === 404) {
        setAdminKey(null);
        setKey(null);
        setError(status === 404 ? 'Admin is turned off on this server (no ADMIN_KEY set).' : 'That key is not right.');
      } else setError((e as Error).message);
    }
  };

  useEffect(() => {
    if (key) void load(key);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const projects = useMemo(() => (data ? projectsOf(data) : []), [data]);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = projects.filter((p) => !q || p.title.toLowerCase().includes(q) || p.children.some((c) => c.title.toLowerCase().includes(q)));
    return list.sort((a, b) => (sort === 'size' ? b.bytes - a.bytes : sort === 'stale' ? a.updatedAt - b.updatedAt : b.updatedAt - a.updatedAt));
  }, [projects, filter, sort]);

  // Selected albums cover their songs; a song can also be picked on its own.
  const selection = useMemo(() => {
    const albums = projects.filter((p) => p.type === 'album' && selected.has(p.key));
    const inAlbums = new Set(albums.map((a) => a.id));
    const boards = (data?.boards ?? []).filter((b) => selected.has(`board:${b.id}`) && !(b.albumId && inAlbums.has(b.albumId)));
    const bytes = albums.reduce((n, a) => n + a.bytes, 0) + boards.reduce((n, b) => n + b.bytes, 0);
    return { albums, boards, bytes, count: albums.length + boards.length };
  }, [selected, projects, data]);

  if (!key || !data) {
    return (
      <div className="admin">
        <AdminNav theme={theme} onLock={null} />
        {key && !error ? <div className="admin-card"><span className="spinner" /> Loading…</div> : <Unlock onKey={(k) => setKey(k)} error={error} />}
      </div>
    );
  }

  const ours = data.fileBytes + data.dbBytes;
  const toggle = (k: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const doDelete = async () => {
    setBusy(true);
    try {
      const r = await adminDelete(key, { albums: selection.albums.map((a) => a.id), boards: selection.boards.map((b) => b.id) });
      setNotice(`Deleted ${selection.count} project${selection.count === 1 ? '' : 's'} and freed ${formatBytes(r.freed.bytes)}.`);
      setSelected(new Set());
      setConfirm(false);
      await load(key);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doPrune = async () => {
    setBusy(true);
    try {
      const r = await adminPruneUnused(key);
      setNotice(`Removed ${r.freed.files} unused file${r.freed.files === 1 ? '' : 's'} and freed ${formatBytes(r.freed.bytes)}.`);
      await load(key);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin">
      <AdminNav
        theme={theme}
        onLock={() => {
          setAdminKey(null);
          setKey(null);
          setData(null);
        }}
      />

      <section className={`admin-card storage ${data.low ? 'low' : ''}`}>
        <div className="storage-head">
          <div>
            <h2>Storage</h2>
            <p className="storage-state">
              <Icon name={data.low ? 'info' : 'check'} size={15} />
              {data.low
                ? `Running low: ${formatBytes(data.disk.free)} free. Prune some projects below.`
                : `Healthy: ${formatBytes(data.disk.free)} free of ${formatBytes(data.disk.total)}.`}
            </p>
          </div>
          <button className="icon-btn" title="Refresh" aria-label="Refresh" onClick={() => void load(key)}>
            <Icon name="loop" size={16} />
          </button>
        </div>
        <DiskMeter status={data} ours={ours} />
        <p className="storage-note">
          {data.minFree > 0 ? `New uploads stop when free space drops below ${formatBytes(data.minFree)}, so other sites on the server keep running. ` : ''}
          Uploads {formatBytes(data.fileBytes)} · database {formatBytes(data.dbBytes)}.
        </p>
        {data.unused.files > 0 && (
          <div className="unused">
            <div>
              <b>{formatBytes(data.unused.bytes)} in unused files</b>
              <span>
                {data.unused.files} file{data.unused.files === 1 ? '' : 's'} from deleted cards, kept so undo works. Nothing on any board uses them.
              </span>
            </div>
            <button className="btn sm" disabled={busy} onClick={() => void doPrune()}>
              <Icon name="trash" size={14} /> Clean up
            </button>
          </div>
        )}
      </section>

      {notice && (
        <div className="admin-notice" role="status">
          <Icon name="check" size={15} /> {notice}
          <button className="icon-btn sm" aria-label="Dismiss" onClick={() => setNotice(null)}>
            <Icon name="close" size={13} />
          </button>
        </div>
      )}

      <section className="admin-card">
        <div className="projects-head">
          <h2>
            Projects <span className="count">{projects.length}</span>
          </h2>
          <div className="projects-tools">
            <input className="admin-search" placeholder="Search titles" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Search titles" />
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
              <option value="size">Largest first</option>
              <option value="stale">Least recently edited</option>
              <option value="recent">Recently edited</option>
            </select>
          </div>
        </div>

        <ul className="projects">
          {shown.map((p) => {
            const isOpen = open.has(p.key);
            const max = shown.reduce((m, x) => Math.max(m, x.bytes), 1);
            return (
              <li key={p.key} className={selected.has(p.key) ? 'sel' : ''}>
                <div className="proj-row">
                  <input type="checkbox" checked={selected.has(p.key)} onChange={() => toggle(p.key)} aria-label={`Select ${p.title}`} />
                  {p.type === 'album' ? (
                    <button
                      className="icon-btn sm"
                      aria-label={isOpen ? 'Hide songs' : 'Show songs'}
                      onClick={() =>
                        setOpen((s) => {
                          const next = new Set(s);
                          if (next.has(p.key)) next.delete(p.key);
                          else next.add(p.key);
                          return next;
                        })
                      }
                    >
                      <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size={14} />
                    </button>
                  ) : (
                    <span className="proj-icon" aria-hidden>
                      <Icon name="note" size={14} />
                    </span>
                  )}
                  <a className="proj-title" href={p.href} onClick={(e) => { e.preventDefault(); navigate(p.href); }}>
                    <span>{p.title}</span>
                    <small>
                      {p.type === 'album' ? `Album · ${plural(p.children.filter((c) => c.kind === 'song').length, 'song')}` : 'Single'} · {p.items} card{p.items === 1 ? '' : 's'} · edited {ago(p.updatedAt)}
                    </small>
                  </a>
                  <span className="proj-size">
                    {p.bytes > 0 && <span className="size-bar" style={{ width: `${Math.max(2, (p.bytes / max) * 100)}%` }} />}
                    {formatBytes(p.bytes)}
                  </span>
                </div>
                {isOpen && (
                  <ul className="songs">
                    {p.children.map((c) => (
                      <li key={c.id}>
                        {c.kind === 'song' ? (
                          <input
                            type="checkbox"
                            checked={selected.has(p.key) || selected.has(`board:${c.id}`)}
                            disabled={selected.has(p.key)}
                            onChange={() => toggle(`board:${c.id}`)}
                            aria-label={`Select ${c.title}`}
                          />
                        ) : (
                          <span className="cb-spacer" />
                        )}
                        <span className="proj-title">
                          <span>{c.kind === 'overview' ? 'Album page' : c.title}</span>
                          <small>
                            {c.items} card{c.items === 1 ? '' : 's'} · edited {ago(c.updatedAt)}
                          </small>
                        </span>
                        <span className="proj-size">{formatBytes(c.bytes)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
          {shown.length === 0 && <li className="proj-empty">{projects.length ? 'No titles match.' : 'No projects yet.'}</li>}
        </ul>
      </section>

      {selection.count > 0 && (
        <div className="admin-actionbar panel">
          <span>
            {selection.count} selected · {formatBytes(selection.bytes)}
          </span>
          <button className="btn ghost sm" onClick={() => setSelected(new Set())}>
            Clear
          </button>
          <button className="btn danger sm" onClick={() => setConfirm(true)}>
            <Icon name="trash" size={14} /> Delete…
          </button>
        </div>
      )}

      <Dialog open={confirm} onClose={() => !busy && setConfirm(false)} title="Delete permanently?">
        <div className="confirm-delete">
          <p>These will be deleted with all their sounds, MIDI and images. This can't be undone, and their links will stop working for everyone.</p>
          <ul>
            {selection.albums.map((a) => (
              <li key={a.key}>
                <Icon name="layers" size={14} /> {a.title} <small>album, {plural(a.children.filter((c) => c.kind === 'song').length, 'song')} · {formatBytes(a.bytes)}</small>
              </li>
            ))}
            {selection.boards.map((b) => (
              <li key={b.id}>
                <Icon name="note" size={14} /> {b.title} <small>{b.kind === 'song' ? 'song' : 'single'} · {formatBytes(b.bytes)}</small>
              </li>
            ))}
          </ul>
          <p className="hint">Files another board also uses are kept.</p>
          <div className="dialog-actions">
            <button className="btn ghost" disabled={busy} onClick={() => setConfirm(false)}>
              Cancel
            </button>
            <button className="btn danger" disabled={busy} onClick={() => void doDelete()}>
              {busy ? <span className="spinner" /> : <Icon name="trash" size={15} />} Delete {selection.count} for good
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function AdminNav({ theme, onLock }: { theme: string; onLock: (() => void) | null }) {
  return (
    <header className="landing-nav admin-nav">
      <a className="wordmark" href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>
        <span className="logo-mark" aria-hidden>
          <i />
          <i />
          <i />
          <i />
        </span>
        <span>
          Audiation <em>Space</em>
        </span>
        <span className="admin-tag">Admin</span>
      </a>
      <div className="admin-nav-actions">
        {onLock && (
          <button className="btn ghost sm" onClick={onLock} title="Forget the admin key in this browser">
            Lock
          </button>
        )}
        <button className="icon-btn" onClick={toggleTheme} aria-label="Toggle theme">
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
        </button>
      </div>
    </header>
  );
}
