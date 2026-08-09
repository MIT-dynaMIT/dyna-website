import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, timeAgo, orientStrip } from '../api';
import type { MatchRow } from '../api';
import { WinStrip } from '../CoupTable';

interface MatchesData {
  bot: { id: string; name: string; elo: number; games: number } | null;
  matches: MatchRow[];
}

const REFRESH_MS = 5 * 60 * 1000; // the scrim server plays a LOT of games

/** A row's score and win strip are recorded from players[0]'s point of view,
 *  which is only sometimes your bot — orient both to `myBot`. */
function orientRow(m: MatchRow) {
  const opp = m.players.find((p) => p !== m.myBot) ?? m.players[1] ?? '';
  return {
    opp,
    mine: m.score?.[m.myBot] ?? 0,
    theirs: m.score?.[opp] ?? 0,
    strip: m.winStrip ? orientStrip(m.winStrip, m.players[0] !== m.myBot) : null,
  };
}

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
          <div className="stat"><div className="lab">Series played</div><div className="val">{data.bot.games}</div></div>
          <div style={{ flex: 1 }} />
          <span className="coup-note">
            last 20 series · refreshes every 5 min{updatedAt ? ` · updated ${timeAgo(updatedAt)}` : ''}
          </span>
        </div>
      </div>

      {data.matches.length === 0 && (
        <p className="coup-note">No series recorded yet — the scrim server will get to your bot shortly.</p>
      )}
      {data.matches.map((m) => {
        const { opp, mine, theirs, strip } = orientRow(m);
        // A dead-even series is rated as a draw even though one name is recorded
        // as the winner — don't call it a loss.
        const drawn = !!m.series && mine === theirs;
        return (
          <div key={m.id}
            className={`match-row ${m.win ? 'win' : 'loss'} ${drawn ? 'ct-draw' : ''} ${strip ? 'ct-hasstrip' : ''}`}
            onClick={() => nav(`/coup/matches/${m.id}`)}
            role="button" tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') nav(`/coup/matches/${m.id}`); }}>
            <div className="verdict">
              {m.series
                ? `${drawn ? 'D' : m.win ? 'W' : 'L'} ${mine}–${theirs}`
                : (m.win ? 'WIN' : 'LOSS')}
              <small>
                {m.series ? `avg ${m.turns} turns` : `${m.turns} turns`}{m.adjudicated ? ' · judged' : ''}
              </small>
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
            {strip && (
              <WinStrip strip={strip}
                title={`${mine}–${theirs} vs ${opp} over ${m.gamesTotal ?? strip.length} games — green = ${m.myBot} won`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
