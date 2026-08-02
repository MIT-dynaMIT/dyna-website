import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { BotSlot, CoupUser, LeaderRow, MySub } from '../api';
import { useToast } from '../CoupApp';

interface ScrimData {
  top: LeaderRow[];
  totalBots: number;
  totalGames: number;
  running: boolean;
  mine: MySub[];
}

export default function ScrimPage({ user }: { user: CoupUser }) {
  const [data, setData] = useState<ScrimData | null>(null);
  const [slots, setSlots] = useState<(BotSlot | null)[]>([]);
  const [pick, setPick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const toast = useToast();

  const refresh = useCallback(async () => {
    const [d, b] = await Promise.all([
      api.get<ScrimData>('/scrim'),
      api.get<{ slots: (BotSlot | null)[] }>('/bots'),
    ]);
    setData(d);
    setSlots(b.slots);
  }, []);

  useEffect(() => {
    refresh().catch(() => {});
    const t = setInterval(() => refresh().catch(() => {}), 15000);
    return () => clearInterval(t);
  }, [refresh]);

  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api.post<{ submission: { name: string }; unchanged?: boolean }>('/scrim/submit', { slot: pick });
      toast(r.unchanged
        ? `${r.submission.name} is already on the ladder — no changes, rating kept.`
        : `${r.submission.name} is on the ladder!`);
      await refresh();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'submit failed');
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (id: string) => {
    await api.post('/scrim/withdraw', { id });
    toast('Bot withdrawn from the ladder');
    await refresh();
  };

  if (!data) return <div className="coup-note"><span className="coup-spin" /> Loading the ladder…</div>;

  const filled = slots.map((s, i) => ({ s, i })).filter((x) => x.s && x.s.python);

  return (
    <div>
      <div className="coup-grid2" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
        <div className="coup-card">
          <h2 className="coup-h">🏆 Ladder — top 10
            <small>{data.totalBots} bots · {data.totalGames.toLocaleString()} games played · {data.running ? 'scrims live' : 'scrims paused'}</small>
          </h2>
          <table className="coup-table">
            <thead>
              <tr><th className="rank">#</th><th>Bot</th><th>Coach</th>
                <th className="num">ELO</th><th className="num">Games</th><th className="num">Win %</th></tr>
            </thead>
            <tbody>
              {data.top.map((r) => (
                <tr key={r.id} className={`${r.rank === 1 ? 'top1' : ''} ${data.mine.some((m) => m.id === r.id) ? 'goldrow' : ''}`}>
                  <td className="rank">{r.rank}</td>
                  <td>{r.name}{r.isHouse && <span className="house-tag">HOUSE</span>}</td>
                  <td style={{ color: 'var(--ink-mut)' }}>{r.isHouse ? '—' : r.owner}</td>
                  <td className="num">{r.elo}</td>
                  <td className="num">{r.games}</td>
                  <td className="num">{Math.round(r.winRate * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <div className="coup-card" style={{ marginBottom: 18 }}>
            <h2 className="coup-h">⚔️ Send a bot to battle</h2>
            <p className="coup-sub">
              {user.isAdmin
                ? 'Organizers can field as many bots as they like (up to 100).'
                : 'You get one bot on the ladder — submitting a new one replaces it.'}
            </p>
            <label htmlFor="slotpick">Choose a saved bot</label>
            <select id="slotpick" value={pick} onChange={(e) => setPick(Number(e.target.value))}>
              {filled.length === 0 && <option value={0}>— no saved bots yet —</option>}
              {filled.map(({ s, i }) => (
                <option key={i} value={i}>Slot {i + 1}: {s!.name}</option>
              ))}
            </select>
            <div style={{ marginTop: 14 }}>
              <button className="primary" onClick={submit} disabled={busy || filled.length === 0}>
                {busy ? 'Submitting…' : 'Submit to scrimmage'}
              </button>
            </div>
            <div className="coup-error">{err}</div>
          </div>

          <div className="coup-card">
            <h2 className="coup-h">🎖 My bot{data.mine.length > 1 ? 's' : ''} on the ladder</h2>
            {data.mine.length === 0 && <p className="coup-note">Nothing submitted yet — your bot is waiting in the wings.</p>}
            {data.mine.map((m) => (
              <div key={m.id} style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                  <strong style={{ color: 'var(--parch)', fontSize: 16 }}>{m.name}</strong>
                  <span className="coup-note">rank #{m.rank || '—'}</span>
                  <span style={{ flex: 1 }} />
                  <button className="small danger ghost" onClick={() => withdraw(m.id)}>withdraw</button>
                </div>
                <div className="coup-stat-row" style={{ marginTop: 8 }}>
                  <div className="stat"><div className="lab">ELO</div><div className="coup-elo-big">{m.elo}</div></div>
                  <div className="stat"><div className="lab">Win rate (last {m.lastN || 0})</div>
                    <div className="val">{m.lastN ? Math.round(m.winRate * 100) + '%' : '—'}</div></div>
                  <div className="stat"><div className="lab">Games</div><div className="val">{m.games}</div></div>
                  {m.errors > 0 && (
                    <div className="stat"><div className="lab">Crashes</div>
                      <div className="val" style={{ color: 'var(--bad)' }}>{m.errors}</div></div>
                  )}
                </div>
                {m.errors > 0 && (
                  <p className="coup-note" style={{ color: '#e0a196' }}>
                    Your bot hit errors in some games and fell back to safe moves — run “Check my bot” in the editor.
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
