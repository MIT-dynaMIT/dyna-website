import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, timeAgo } from '../api';
import type { GauntletData, MatchesData, MatchRow } from '../api';
import { useToast } from '../CoupApp';

const LEVEL_FLAVOR = [
  'Level 1. Just happy to be here. Something about him seems… oddly familiar.',
  'Level 2. Never lies, audits everything. Lying to Greg gets expensive.',
  "Level 3. The final boss. We don't talk about Kevin's win rate.",
];
const LEVEL_ICON = ['🥉', '🥈', '🏆'];

export default function LevelsPage() {
  const toast = useToast();
  const [data, setData] = useState<GauntletData | null>(null);
  const [results, setResults] = useState<MatchRow[]>([]);
  const [busy, setBusy] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    const [g, m] = await Promise.all([
      api.get<GauntletData>('/gauntlet'),
      api.get<MatchesData>('/matches'),
    ]);
    setData(g);
    setResults(m.matches.filter((x) => x.mode === 'gauntlet'));
  }, []);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  // poll faster while a match is running so the result shows up on its own
  useEffect(() => {
    const t = setInterval(() => refresh().catch(() => {}),
      data?.pending.length ? 3000 : 20000);
    return () => clearInterval(t);
  }, [refresh, data?.pending.length]);

  if (!data) return <div className="coup-note"><span className="coup-spin" /> Loading…</div>;

  const challenge = async (level: number) => {
    setBusy(level);
    try {
      await api.post('/gauntlet/challenge', { level });
      toast(`Match started vs ${data.levels[level].name} — results in about 20 seconds`);
      await refresh();
    } catch (ex) {
      toast(ex instanceof Error ? ex.message : 'could not start the match');
    } finally {
      setBusy(null);
    }
  };

  // best result per level
  const bestByLevel = new Map<number, MatchRow>();
  for (const r of results) {
    if (r.level == null) continue;
    const cur = bestByLevel.get(r.level);
    const myScore = (m: MatchRow) => (m.mine === 1 ? m.score[1] - m.score[0] : m.score[0] - m.score[1]);
    if (!cur || myScore(r) > myScore(cur)) bestByLevel.set(r.level, r);
  }

  return (
    <div>
      <div className="coup-card" style={{ marginBottom: 18 }}>
        <h2 className="coup-h">🎯 Levels
          <small>three bots to beat · best of {data.seriesCount} · each round is a {data.seriesGames}-game series</small>
        </h2>
        <p className="coup-sub">
          Your <b>selected bot</b> plays a house bot for {data.seriesCount} rounds of {data.seriesGames} games
          each. Win more rounds than the house and you've beaten the level. Results and replays
          land in <Link to="/coup/matches">Match History</Link>.
        </p>
        <p className="coup-sub" style={{ marginBottom: 0 }}>
          Playing as: {data.selected
            ? <b>★ {data.selected.name}</b>
            : <em>no bot yet — build one in the Bot Editor and mark it with the ★</em>}
        </p>
      </div>

      {data.pending.length > 0 && (
        <div className="coup-card" style={{ marginBottom: 18 }}>
          {data.pending.map((j) => (
            <p key={j.id} className="coup-note" style={{ margin: '4px 0' }}>
              {j.status === 'failed'
                ? <>💥 {j.players[0]} vs {j.players[1]} crashed: {j.error}</>
                : <><span className="coup-spin" /> {j.players[0]} vs {j.players[1]} — {j.status}…</>}
            </p>
          ))}
        </div>
      )}

      <div className="coup-grid2" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
        {data.levels.map((l) => {
          const best = bestByLevel.get(l.level);
          const mineFirst = best && best.mine !== 1;
          const my = best ? (mineFirst ? best.score[0] : best.score[1]) : null;
          const their = best ? (mineFirst ? best.score[1] : best.score[0]) : null;
          const beaten = best != null && my! > their!;
          return (
            <div key={l.level} className="coup-card" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 40, marginBottom: 6 }}>{LEVEL_ICON[l.level] ?? '🤖'}</div>
              <h2 className="coup-h" style={{ justifyContent: 'center' }}>{l.name}</h2>
              <p className="coup-sub" style={{ minHeight: 40 }}>{LEVEL_FLAVOR[l.level] ?? ''}</p>
              <button className="primary" disabled={busy != null || !data.selected}
                onClick={() => challenge(l.level)}>
                {busy === l.level ? 'Starting…' : 'Play this level'}
              </button>
              <p className="coup-note" style={{ marginTop: 12 }}>
                {best
                  ? beaten
                    ? <>✅ <b>Beaten {my}–{their}</b> · {timeAgo(best.ts)}</>
                    : <>best so far: {my}–{their} · {timeAgo(best.ts)}</>
                  : 'not beaten yet'}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
