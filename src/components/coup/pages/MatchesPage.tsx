import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, timeAgo } from '../api';
import type { MatchesData, MatchRow } from '../api';
import { useLive } from '../CoupApp';

/** Rows are recorded from players[0]'s side — orient scores to "me".
 *  Admin rows where I'm not a player stay in recorded order. */
function orient(m: MatchRow) {
  const flip = m.mine === 1;
  return {
    myBot: flip ? m.players[1] : m.players[0],
    opp: flip ? m.players[0] : m.players[1],
    oppOwner: flip ? m.ownerNames[0] : m.ownerNames[1],
    my: flip ? m.score[1] : m.score[0],
    their: flip ? m.score[0] : m.score[1],
    series: m.series.map((s) => (flip ? [s.winsB, s.winsA] : [s.winsA, s.winsB])),
  };
}

export default function MatchesPage() {
  const [data, setData] = useState<MatchesData | null>(null);
  const [tab, setTab] = useState<'games' | 'ladder'>('games');
  const nav = useNavigate();
  const live = useLive();
  // the scrimmage sub-tab exists only while the scrimmage does
  const ladderOn = !!live?.ladderOn;

  // if it gets paused while someone is sitting on that tab, move them back
  useEffect(() => {
    if (!ladderOn && tab === 'ladder') setTab('games');
  }, [ladderOn, tab]);

  useEffect(() => {
    const load = () => api.get<MatchesData>('/matches').then(setData).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  if (!data) return <div className="coup-note"><span className="coup-spin" /> Loading…</div>;

  const inLadderTab = tab === 'ladder' && ladderOn;
  const shown = data.matches.filter((m) => inLadderTab === (m.mode === 'ladder'));
  const pendingShown = data.pending.filter((j) => inLadderTab === (j.mode === 'ladder'));

  return (
    <div>
      <div className="coup-card" style={{ marginBottom: 16 }}>
        <h2 className="coup-h" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>📜 Match history
          {ladderOn && <span style={{ display: 'inline-flex', gap: 6 }}>
            <button className={tab === 'games' ? 'primary small' : 'small'}
              onClick={() => setTab('games')}>Levels &amp; Battles</button>
            <button className={tab === 'ladder' ? 'primary small' : 'small'}
              onClick={() => setTab('ladder')}>Leaderboard</button>
          </span>}
        </h2>
        <p className="coup-sub" style={{ marginBottom: 0 }}>
          {!inLadderTab
            ? 'Level runs and bot battles, best of 5 — your last 5 are kept. Click a match to watch any of its games.'
            : 'Leaderboard matches, best of 7 — each of the 7 a 100-game series. Your last 5 are kept.'}
        </p>
      </div>

      {pendingShown.map((j) => (
        <div key={j.id} className="match-row" style={{ cursor: 'default' }}>
          <div className="verdict">{j.status === 'failed' ? '💥' : <span className="coup-spin" />}</div>
          <div className="lineup">
            <span className="p">{j.players[0]}</span> vs <span className="p">{j.players[1]}</span>
            {j.status === 'failed'
              ? <span className="coup-error" style={{ marginLeft: 10 }}>{j.error}</span>
              : <span className="coup-note" style={{ marginLeft: 10 }}>
                  {j.mode === 'gauntlet' ? 'level run' : j.mode === 'ladder' ? 'leaderboard match' : 'bot battle'} {j.status}…
                </span>}
          </div>
        </div>
      ))}

      {shown.length === 0 && pendingShown.length === 0 && (
        <p className="coup-note">
          {!inLadderTab
            ? 'Nothing here yet — play a level or start a bot battle in Versus.'
            : 'No leaderboard matches yet — submit a bot on the Leaderboard page.'}
        </p>
      )}

      {shown.map((m) => {
        const o = orient(m);
        const drawn = m.winnerName === null;
        const win = !drawn && m.winnerName === o.myBot;
        const spectator = m.mine < 0;
        return (
          <div key={m.id}
            className={`match-row ${win ? 'win' : 'loss'} ${drawn ? 'ct-draw' : ''}`}
            onClick={() => nav(`/coup/matches/${m.id}`)}
            role="button" tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') nav(`/coup/matches/${m.id}`); }}>
            <div className="verdict">
              {spectator ? `${m.score[0]}–${m.score[1]}` : `${drawn ? 'D' : win ? 'W' : 'L'} ${o.my}–${o.their}`}
              <small>{m.mode === 'gauntlet' ? `level ${(m.level ?? 0) + 1}` : m.mode === 'ladder' ? 'leaderboard' : 'bot battle'}</small>
            </div>
            <div className="lineup">
              {m.players.map((p: string, i: number) => (
                <span key={i}
                  className={`p ${p === m.winnerName ? 'winner' : ''} ${!spectator && p === o.myBot ? 'me' : ''}`}>
                  {p === m.winnerName ? '♛ ' : ''}{p}
                  <span style={{ opacity: 0.6 }}> ({m.ownerNames[i]})</span>
                </span>
              ))}
            </div>
            <div className="delta" style={{ width: 'auto', fontSize: 13, color: 'var(--ink-mut)' }}>
              {o.series.map((s, i) => <span key={i} style={{ marginLeft: 8 }}>{s[0]}-{s[1]}</span>)}
            </div>
            <div className="meta">{timeAgo(m.ts)} ▸</div>
          </div>
        );
      })}
    </div>
  );
}
