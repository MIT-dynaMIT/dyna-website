import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, timeAgo } from '../api';
import type { MatchRow } from '../api';

interface MatchesData {
  bot: { id: string; name: string; elo: number; games: number } | null;
  matches: MatchRow[];
}

const REFRESH_MS = 5 * 60 * 1000; // the scrim server plays a LOT of games

export default function MatchesPage() {
  const [data, setData] = useState<MatchesData | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number>(0);
  const nav = useNavigate();

  useEffect(() => {
    const load = () => api.get<MatchesData>('/matches')
      .then((d) => { setData(d); setUpdatedAt(Date.now()); })
      .catch(() => {});
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  if (!data) return <div className="coup-note"><span className="coup-spin" /> Digging through the archives…</div>;

  if (!data.bot) {
    return (
      <div className="coup-card">
        <h2 className="coup-h">📜 Match history</h2>
        <p className="coup-note">No bot on the scrimmage ladder yet — submit one on the Scrimmage page and its games will show up here.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="coup-card" style={{ marginBottom: 16 }}>
        <div className="coup-stat-row">
          <div className="stat"><div className="lab">Bot</div>
            <div className="val" style={{ color: 'var(--accent)' }}>{data.bot.name}</div></div>
          <div className="stat"><div className="lab">ELO</div><div className="val">{data.bot.elo}</div></div>
          <div className="stat"><div className="lab">Total games</div><div className="val">{data.bot.games}</div></div>
          <div style={{ flex: 1 }} />
          <span className="coup-note">
            last 20 games · refreshes every 5 min{updatedAt ? ` · updated ${timeAgo(updatedAt)}` : ''}
          </span>
        </div>
      </div>

      {data.matches.length === 0 && (
        <p className="coup-note">No games recorded yet — the scrim server will get to your bot shortly.</p>
      )}
      {data.matches.map((m) => (
        <div key={m.id} className={`match-row ${m.win ? 'win' : 'loss'}`}
          onClick={() => nav(`/coup/matches/${m.id}`)}
          role="button" tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter') nav(`/coup/matches/${m.id}`); }}>
          <div className="verdict">
            {m.win ? 'WIN' : 'LOSS'}
            <small>{m.turns} turns{m.adjudicated ? ' · judged' : ''}</small>
          </div>
          <div className="lineup">
            {m.players.map((p) => (
              <span key={p}
                className={`p ${p === m.winnerName ? 'winner' : ''} ${p === m.myBot ? 'me' : ''}`}>
                {p === m.winnerName ? '♛ ' : ''}{p}
              </span>
            ))}
          </div>
          <div className={`delta ${m.eloDelta >= 0 ? 'pos' : 'neg'}`}>
            {m.eloDelta >= 0 ? '+' : ''}{m.eloDelta}
          </div>
          <div className="meta">{timeAgo(m.ts)} ▸</div>
        </div>
      ))}
    </div>
  );
}
