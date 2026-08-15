import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { LeaderRow } from '../api';
import { useToast } from '../CoupApp';

interface Overview {
  leaderboard: LeaderRow[];
  totalGames: number;
  running: boolean;
  perf?: { lastChunkMs: number; maxChunkMs: number; lastError: string | null };
  students: {
    username: string; displayName: string; isAdmin: boolean;
    slotsUsed: number; submitted: string[];
  }[];
}

export default function AdminPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [nu, setNu] = useState({ username: '', displayName: '', password: '' });
  const toast = useToast();

  const refresh = useCallback(() => api.get<Overview>('/admin/overview').then(setData).catch(() => {}), []);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 10000);
    return () => clearInterval(t);
  }, [refresh]);

  if (!data) return <div className="coup-note"><span className="coup-spin" /> Loading the court records…</div>;

  const toggleScrims = async () => {
    await api.post('/admin/running', { running: !data.running });
    toast(data.running ? 'Scrims paused' : 'Scrims resumed');
    refresh();
  };

  const resetPw = async (username: string) => {
    const pw = window.prompt(`New password for ${username}:`, 'coup123');
    if (!pw) return;
    await api.post('/admin/reset-password', { username, newPassword: pw });
    toast(`Password reset for ${username}`);
  };

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/admin/create-user', nu);
      toast(`Created ${nu.username}`);
      setNu({ username: '', displayName: '', password: '' });
      refresh();
    } catch (ex) {
      toast(ex instanceof Error ? ex.message : 'failed');
    }
  };

  return (
    <div className="coup-grid2" style={{ gridTemplateColumns: '1.3fr 1fr' }}>
      <div className="coup-card">
        <h2 className="coup-h">👑 Full leaderboard
          <small>{data.leaderboard.length} bots · {data.totalGames.toLocaleString()} games</small>
        </h2>
        <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={toggleScrims}>{data.running ? '⏸ Pause scrims' : '▶ Resume scrims'}</button>
          {data.perf && (
            <span className="coup-sub" style={{ margin: 0, fontSize: 13 }}>
              ladder slice {data.perf.lastChunkMs}ms · worst {data.perf.maxChunkMs}ms
              {data.perf.lastError && <strong style={{ color: 'var(--bad, #c0392b)' }}> · {data.perf.lastError}</strong>}
            </span>
          )}
        </div>
        <div style={{ maxHeight: '62vh', overflowY: 'auto' }}>
          <table className="coup-table">
            <thead>
              <tr><th className="rank">#</th><th>Bot</th><th>Coach</th>
                <th className="num">ELO</th><th className="num">Games</th><th className="num">Win %</th></tr>
            </thead>
            <tbody>
              {data.leaderboard.map((r) => (
                <tr key={r.id} className={r.rank === 1 ? 'top1' : ''}>
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
      </div>

      <div>
        <div className="coup-card" style={{ marginBottom: 18 }}>
          <h2 className="coup-h">🎓 Students</h2>
          <p className="coup-sub">Your own bots live in the Bot Editor — organizers get 100 slots and can submit as many to the ladder as they like.</p>
          <table className="coup-table">
            <thead><tr><th>Login</th><th>Name</th><th className="num">Saved</th><th>On ladder</th><th /></tr></thead>
            <tbody>
              {data.students.map((s) => (
                <tr key={s.username}>
                  <td className="mono" style={{ fontSize: 13 }}>{s.username}{s.isAdmin ? ' ⭐' : ''}</td>
                  <td>{s.displayName}</td>
                  <td className="num">{s.slotsUsed}</td>
                  <td style={{ color: 'var(--ink-mut)', fontSize: 13 }}>{s.submitted.join(', ') || '—'}</td>
                  <td><button className="small ghost" onClick={() => resetPw(s.username)}>reset pw</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="coup-card">
          <h2 className="coup-h">➕ Add a login</h2>
          <form onSubmit={createUser}>
            <label>Username</label>
            <input type="text" value={nu.username} onChange={(e) => setNu({ ...nu, username: e.target.value })} />
            <label>Display name</label>
            <input type="text" value={nu.displayName} onChange={(e) => setNu({ ...nu, displayName: e.target.value })} />
            <label>Password</label>
            <input type="text" value={nu.password} placeholder="coup123"
              onChange={(e) => setNu({ ...nu, password: e.target.value })} />
            <div style={{ marginTop: 14 }}>
              <button className="primary" disabled={!nu.username}>Create login</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
