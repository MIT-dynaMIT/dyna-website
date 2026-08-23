import { useCallback, useEffect, useState } from 'react';
import { api, LADDER_ENABLED } from '../api';
import { useToast } from '../CoupApp';

interface Overview {
  totalMatches: number;
  students: {
    username: string; displayName: string; isAdmin: boolean; role: string;
    slotsUsed: number; selectedBot: string | null;
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

  if (!data) return <div className="coup-note"><span className="coup-spin" /> Loading…</div>;

  const pairDuels = async () => {
    const r = await api.post<{ matches: number; paired: number; benched: string | null }>('/admin/pair-online');
    if (!r.matches && !r.benched) { toast('No students are online right now'); return; }
    toast(`⚔ ${r.paired} students paired into ${r.matches} live game${r.matches === 1 ? '' : 's'}`
      + (r.benched ? ` — ${r.benched} sits out (odd one out)` : ''));
  };

  const pairBots = async () => {
    const r = await api.post<{ matches: number; paired: number; benched: string | null; skipped: string[] }>('/admin/pair-bots');
    if (!r.matches && !r.benched && !r.skipped.length) { toast('No students are online right now'); return; }
    toast(`🤖 ${r.matches} bot battle${r.matches === 1 ? '' : 's'} queued`
      + (r.benched ? ` — ${r.benched} sits out` : '')
      + (r.skipped.length ? ` — no bot yet: ${r.skipped.join(', ')}` : ''));
  };

  const resetLadder = async () => {
    if (!window.confirm('Reset the leaderboard? Every bot comes off the ladder and all ratings are wiped — Andrew re-seats fresh at 1000. Match history is kept.')) return;
    await api.post('/admin/ladder-reset');
    toast('Leaderboard reset — a new season begins');
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
        <h2 className="coup-h">🎓 Campers
          <small>{data.students.length} logins · {data.totalMatches} matches recorded</small>
        </h2>
        <div style={{ marginBottom: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="primary" onClick={pairDuels}
            title="Every online student gets paired into a random live game and pulled to the Versus page">
            ⚔ Pair up live games
          </button>
          <button className="primary" onClick={pairBots}
            title="Every online student's selected bot fights a random other student's bot — best of 5, results in Match History">
            🤖 Pair up bot battles
          </button>
          {LADDER_ENABLED && <button onClick={resetLadder}
            title="Fresh week: everyone off the leaderboard, ratings wiped, Andrew re-seats at 1000">
            🔄 Reset leaderboard
          </button>}
        </div>
        <div style={{ maxHeight: '62vh', overflowY: 'auto' }}>
          <table className="coup-table">
            <thead><tr><th>Login</th><th>Name</th><th>Role</th>
              <th className="num">Saved</th><th>Selected bot</th><th /></tr></thead>
            <tbody>
              {data.students.map((s) => (
                <tr key={s.username}>
                  <td className="mono" style={{ fontSize: 13 }}>{s.username}{s.isAdmin ? ' ⭐' : ''}</td>
                  <td>{s.displayName}</td>
                  <td style={{ color: 'var(--ink-mut)', fontSize: 13 }}>{s.role}</td>
                  <td className="num">{s.slotsUsed}</td>
                  <td style={{ color: 'var(--ink-mut)', fontSize: 13 }}>{s.selectedBot ? `★ ${s.selectedBot}` : '—'}</td>
                  <td><button className="small ghost" onClick={() => resetPw(s.username)}>reset pw</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
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
