import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { AchievementRow, AchievementsData } from '../api';

type Filter = 'all' | 'unlocked' | 'locked';

/** "3.4%" for the rare ones, whole numbers above 10% */
function rarityLabel(pct: number): string {
  const p = pct * 100;
  if (p <= 0) return 'Nobody yet';
  if (p < 10) return `${p.toFixed(1)}%`;
  return `${Math.round(p)}%`;
}

function rarityTone(pct: number): string {
  if (pct <= 0) return 'none';
  if (pct < 0.1) return 'legendary';
  if (pct < 0.3) return 'rare';
  return 'common';
}

function unlockedDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function Plaque({ a }: { a: AchievementRow }) {
  const unlocked = a.unlockedAt != null;
  const secret = a.hidden && !unlocked;
  return (
    <div className={`ach-card ${unlocked ? 'got' : 'locked'} ${secret ? 'secret' : ''}`}>
      <div className="ach-icon" aria-hidden>
        {secret ? '🔒' : a.icon}
      </div>
      <div className="ach-body">
        <div className="ach-title">
          {secret ? 'Hidden achievement' : a.name}
          {a.hidden && unlocked && <span className="ach-tag">hidden</span>}
        </div>
        <div className="ach-desc">
          {secret
            ? 'Keep playing. You will know it when it happens.'
            : a.desc}
        </div>
        <div className="ach-foot">
          <span className={`ach-rarity ${rarityTone(a.pct)}`}>
            <span className="ach-bar"><i style={{ width: `${Math.max(2, a.pct * 100)}%` }} /></span>
            {rarityLabel(a.pct)}
          </span>
          {unlocked && <span className="ach-when">unlocked {unlockedDate(a.unlockedAt!)}</span>}
        </div>
      </div>
    </div>
  );
}

export default function AchievementsPage() {
  const [data, setData] = useState<AchievementsData | null>(null);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  // A swallowed error here is indistinguishable from a slow load: the page
  // would sit on its spinner forever. Say what went wrong instead.
  const refresh = useCallback(
    () => api.get<AchievementsData>('/achievements')
      .then((d) => { setData(d); setErr(''); })
      .catch((ex) => setErr(ex instanceof Error ? ex.message : 'could not load achievements')),
    [],
  );

  useEffect(() => { refresh(); }, [refresh]);
  // trophies land from matches running in the background — keep the page honest
  useEffect(() => {
    const t = setInterval(() => refresh(), 20000);
    return () => clearInterval(t);
  }, [refresh]);

  // Within a category: unlocked first (newest first), then the commonest of
  // what is left — the next-easiest thing to go and try is always on top.
  const grouped = useMemo(() => {
    if (!data) return [];
    const keep = (a: AchievementRow) =>
      filter === 'all' || (filter === 'unlocked' ? a.unlockedAt != null : a.unlockedAt == null);
    return data.categories.map((c) => ({
      ...c,
      rows: data.achievements
        .filter((a) => a.cat === c.id && keep(a))
        .sort((x, y) => {
          if (!!x.unlockedAt !== !!y.unlockedAt) return x.unlockedAt ? -1 : 1;
          if (x.unlockedAt && y.unlockedAt) return y.unlockedAt - x.unlockedAt;
          return y.pct - x.pct;
        }),
      total: data.achievements.filter((a) => a.cat === c.id).length,
      got: data.achievements.filter((a) => a.cat === c.id && a.unlockedAt != null).length,
    }));
  }, [data, filter]);

  if (!data) {
    if (err) {
      return (
        <div className="coup-card">
          <h2 className="coup-h">🏅 Achievements</h2>
          <p className="coup-sub" style={{ marginBottom: 10 }}>{err}</p>
          <p className="coup-note" style={{ marginBottom: 14 }}>
            If a mentor just updated the site, the game server may still need restarting —
            the achievements API is newer than it.
          </p>
          <button className="primary small" onClick={() => refresh()}>Try again</button>
        </div>
      );
    }
    return <div className="coup-note"><span className="coup-spin" /> Loading…</div>;
  }

  const pct = data.total ? (data.unlockedCount / data.total) * 100 : 0;

  return (
    <div className="ach-page">
      <div className="coup-card ach-head">
        <div className="ach-head-main">
          <h2 className="coup-h" style={{ marginBottom: 6 }}>
            🏅 Achievements
            <small>percentages are of {data.activeCount} active players</small>
          </h2>
          <p className="coup-sub" style={{ margin: 0 }}>
            Most of these are hiding in the Bot Editor. Try something you have not tried yet.
          </p>
        </div>
        <div className="ach-score">
          <div className="ach-score-n">
            {data.unlockedCount}<span className="ach-score-of">/{data.total}</span>
          </div>
          <div className="ach-progress"><i style={{ width: `${pct}%` }} /></div>
          <div className="coup-note" style={{ fontSize: 12 }}>{Math.round(pct)}% complete</div>
        </div>
      </div>

      <div className="ach-filters">
        {(['all', 'unlocked', 'locked'] as Filter[]).map((f) => (
          <button key={f} className={filter === f ? 'primary small' : 'small'}
            onClick={() => setFilter(f)}>
            {f === 'all' ? `All ${data.total}`
              : f === 'unlocked' ? `Unlocked ${data.unlockedCount}`
              : `Locked ${data.total - data.unlockedCount}`}
          </button>
        ))}
      </div>

      {grouped.map((c) => c.rows.length > 0 && (
        <section key={c.id} className="ach-section">
          <h3 className="ach-section-h">
            {c.name}
            <small>{c.blurb}</small>
            <span className="ach-section-n">{c.got}/{c.total}</span>
          </h3>
          <div className="ach-grid">
            {c.rows.map((a) => <Plaque key={a.id} a={a} />)}
          </div>
        </section>
      ))}

      {grouped.every((c) => c.rows.length === 0) && (
        <div className="coup-card coup-note">
          {filter === 'unlocked'
            ? 'Nothing yet. Go and save a bot — half of these are just for writing code.'
            : 'Every single one. There is nothing left to find.'}
        </div>
      )}
    </div>
  );
}
