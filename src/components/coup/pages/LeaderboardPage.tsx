import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { BotSlot, CoupUser } from '../api';
import { useToast } from '../CoupApp';

interface LadderRow {
  rank: number; id: string; name: string; owner: string; isHouse: boolean;
  elo: number; matches: number; score: number;
  errors?: number;              // organizer view only
}
/** rank is null unless the bot is actually on the visible top 10 (or you are
 *  an organizer) — see the note in ladder.js view() */
interface MineRow { id: string; name: string; slot: number; elo: number; matches: number; errors: number; rank: number | null }
interface LadderData {
  top: LadderRow[]; totalBots: number; totalMatches: number; running: boolean;
  hidden?: boolean;
  full?: boolean;               // organizer: `top` is the WHOLE board
  seriesCount: number; seriesGames: number; mine: MineRow[];
}

export default function LeaderboardPage({ user }: { user: CoupUser }) {
  const toast = useToast();
  const [data, setData] = useState<LadderData | null>(null);
  const [slots, setSlots] = useState<(BotSlot | null)[]>([]);
  const [pick, setPick] = useState(0);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [d, b] = await Promise.all([
      api.get<LadderData>('/ladder'),
      api.get<{ slots: (BotSlot | null)[] }>('/bots'),
    ]);
    setData(d);
    setSlots(b.slots);
  }, []);

  useEffect(() => {
    refresh().catch(() => {});
    const t = setInterval(() => refresh().catch(() => {}), 8000);
    return () => clearInterval(t);
  }, [refresh]);

  if (!data) return <div className="coup-note"><span className="coup-spin" /> Loading the leaderboard…</div>;

  // paused. Campers get the sign; the server has already withheld every
  // number, so there is nothing here to leak.
  if (!data.running && data.hidden) {
    return (
      <div className="ld-construction">
        <div className="ld-cone" aria-hidden="true">🚧</div>
        <h2>This area is under construction.</h2>
        <p className="ld-heh">Heheheha.</p>
        <div className="ld-tape" aria-hidden="true" />
      </div>
    );
  }

  // paused, but an organizer is looking — show the real state and the way back
  if (!data.running) {
    return (
      <div className="coup-card">
        <h2 className="coup-h">🏆 Scrimmage paused<small>campers see the construction sign</small></h2>
        <p className="coup-sub">
          Everyone else gets “This area is under construction. Heheheha.” instead of this
          page — no standings, no ratings, no scrimmage matches in Match History, and no
          bot can be submitted.
          {data.totalBots > 0 && <> The {data.totalBots} bots already rated keep their ELO.</>}
        </p>
        <p className="coup-note">Start it again from the <b>Organizer</b> tab.</p>
      </div>
    );
  }

  const filled = slots.map((s, i) => ({ s, i })).filter((x) => x.s && x.s.python && x.s.python.trim());

  const submit = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ submission: { name: string }; unchanged?: boolean }>('/ladder/submit', { slot: pick });
      toast(r.unchanged
        ? `${r.submission.name} is already on the leaderboard — rating kept.`
        : `${r.submission.name} is on the leaderboard!`);
      await refresh();
    } catch (ex) {
      toast(ex instanceof Error ? ex.message : 'submit failed');
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (id: string) => {
    await api.post('/ladder/withdraw', { id });
    toast('Bot withdrawn from the leaderboard');
    await refresh();
  };

  return (
    <div className="coup-grid2" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
      <div className="coup-card">
        <h2 className="coup-h">🏆 Leaderboard — {data.full ? `all ${data.totalBots}` : 'top 10'}
          <small>{data.totalBots} bots · {data.totalMatches.toLocaleString()} matches · {data.running ? 'live' : 'paused'}</small>
        </h2>
        {data.full && (
          <p className="coup-sub">
            Organizer view: the whole board, crashes included. Campers only ever see the top 10.
          </p>
        )}
        <div className={data.full ? 'ld-scroll' : undefined}>
          <table className="coup-table">
            <thead>
              <tr><th className="rank">#</th><th>Bot</th><th>Coach</th>
                <th className="num">ELO</th><th className="num">Matches</th><th className="num">Recent</th>
                {data.full && <th className="num">Crashes</th>}</tr>
            </thead>
            <tbody>
              {data.top.map((r) => (
                <tr key={r.id} className={`${r.rank === 1 ? 'top1' : ''} ${data.mine.some((m) => m.id === r.id) ? 'goldrow' : ''}`}>
                  <td className="rank">{r.rank}</td>
                  <td>{r.name}{r.isHouse && <span className="house-tag">HOUSE</span>}</td>
                  <td style={{ color: 'var(--ink-mut)' }}>{r.isHouse ? '—' : r.owner}</td>
                  <td className="num">{r.elo}</td>
                  <td className="num">{r.matches}</td>
                  <td className="num">{r.matches ? Math.round(r.score * 100) + '%' : '—'}</td>
                  {data.full && (
                    <td className="num" style={r.errors ? { color: 'var(--bad)' } : undefined}>
                      {r.errors || '—'}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="coup-note" style={{ marginTop: 10 }}>
          Every pairing is a best of {data.seriesCount} — each of the {data.seriesCount} is a{' '}
          {data.seriesGames}-game series. ELO moves once per match, on who takes the majority.
          Matches (with replays) land in Match History.
        </p>
      </div>

      <div>
        <div className="coup-card" style={{ marginBottom: 18 }}>
          <h2 className="coup-h">⚔️ Send a bot to the ladder</h2>
          <p className="coup-sub">
            {user.isAdmin
              ? 'Organizers can field several bots.'
              : 'Pick ANY saved bot — it does not have to be your ★. You get one spot; submitting again replaces it (same code keeps its rating).'}
          </p>
          <label htmlFor="ldpick">Choose a saved bot</label>
          <select id="ldpick" value={pick} onChange={(e) => setPick(Number(e.target.value))}>
            {filled.length === 0 && <option value={0}>— no saved bots yet —</option>}
            {filled.map(({ s, i }) => (
              <option key={i} value={i}>Slot {i + 1}: {s!.name}</option>
            ))}
          </select>
          <div style={{ marginTop: 14 }}>
            <button className="primary" onClick={submit} disabled={busy || filled.length === 0}>
              {busy ? 'Submitting…' : 'Submit to the leaderboard'}
            </button>
          </div>
        </div>

        <div className="coup-card">
          <h2 className="coup-h">🎖 My bot{data.mine.length > 1 ? 's' : ''}</h2>
          {data.mine.length === 0 && <p className="coup-note">Nothing on the ladder yet.</p>}
          {data.mine.map((m) => (
            <div key={m.id} style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <strong style={{ color: 'var(--parch)', fontSize: 16 }}>{m.name}</strong>
                {m.rank
                  ? <span className="coup-note">rank #{m.rank} of {data.totalBots}</span>
                  : <span className="coup-note">on the ladder</span>}
                <span style={{ flex: 1 }} />
                <button className="small danger ghost" onClick={() => withdraw(m.id)}>withdraw</button>
              </div>
              <div className="coup-stat-row" style={{ marginTop: 8 }}>
                <div className="stat"><div className="lab">ELO</div><div className="coup-elo-big">{m.elo}</div></div>
                <div className="stat"><div className="lab">Matches</div><div className="val">{m.matches}</div></div>
                {m.errors > 0 && (
                  <div className="stat"><div className="lab">Crashes</div>
                    <div className="val" style={{ color: 'var(--bad)' }}>{m.errors}</div></div>
                )}
              </div>
              {m.errors > 0 && (
                <p className="coup-note" style={{ color: 'var(--bad)' }}>
                  Your bot hit errors and fell back to safe moves — run “Check my bot” in the editor.
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
