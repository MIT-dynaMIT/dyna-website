import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useToast } from '../CoupApp';

interface Overview {
  totalMatches: number;
  activeCount: number;
  achievementTotal: number;
  arena: { maxWorkers: number; choices: number[]; running: number; queued: number };
  students: {
    username: string; displayName: string; isAdmin: boolean; role: string;
    active: boolean; achievements: number;
    slotsUsed: number; selectedBot: string | null;
  }[];
}

interface LadderState {
  running: boolean; totalBots: number; totalMatches: number;
  tickMs: number; tickChoices: number[];
  defenders: string[]; houseBots: string[];
}

/** a 700-game match takes ~0.5-0.9s, so all but the last are comfortably idle */
const TICK_LABEL: Record<number, string> = {
  40000: 'Relaxed — one match every 40s',
  20000: 'Brisk — every 20s',
  10000: 'Fast — every 10s',
  5000: 'Frantic — every 5s',
  1000: 'Flat out — every 1s ⚠',
  0: 'MAX — no waiting at all ⚠⚠',
};

export default function AdminPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [ladder, setLadder] = useState<LadderState | null>(null);
  const [nu, setNu] = useState({ username: '', displayName: '', password: '' });
  const toast = useToast();

  const refresh = useCallback(() => Promise.all([
    api.get<Overview>('/admin/overview').then(setData).catch(() => {}),
    api.get<LadderState>('/ladder').then(setLadder).catch(() => {}),
  ]), []);
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

  const setScrimmage = async (running: boolean) => {
    if (!running && !window.confirm('Pause the scrimmage? Matches stop, and the Leaderboard disappears for the campers — nobody can see standings or submit a bot until you start it again. Ratings are kept.')) return;
    const r = await api.post<{ running: boolean }>('/admin/ladder-run', { running });
    setLadder((l) => (l ? { ...l, running: r.running } : l));
    toast(r.running
      ? '▶ Scrimmage started — the Leaderboard is live for everyone'
      : '⏸ Scrimmage paused — the Leaderboard is hidden from the campers');
    refresh();
  };

  const toggleDefender = async (name: string, on: boolean) => {
    if (!ladder) return;
    const next = on
      ? [...ladder.defenders, name]
      : ladder.defenders.filter((d) => d !== name);
    if (!on && !window.confirm(
      `Take ${name} off the leaderboard?\n\n`
      + 'The bot comes off the board and its rating goes with it — putting it back '
      + 'later starts it again at 1000. Everyone else keeps their rating.')) return;
    const r = await api.post<{ defenders: string[] }>('/admin/house-defenders', { names: next });
    setLadder((l) => (l ? { ...l, defenders: r.defenders } : l));
    toast(r.defenders.length
      ? `Defending the board: ${r.defenders.join(', ')}`
      : 'No house bots on the board — campers fight only each other');
    refresh();
  };

  const setTick = async (ms: number) => {
    try {
      const r = await api.post<{ tickMs: number }>('/admin/ladder-tick', { ms });
      setLadder((l) => (l ? { ...l, tickMs: r.tickMs } : l));
      toast(`Scrimmage speed: a match every ${r.tickMs / 1000}s`);
      refresh();
    } catch (ex) {
      toast(ex instanceof Error ? ex.message : 'could not change the speed');
    }
  };

  const setWorkers = async (n: number) => {
    try {
      await api.post('/admin/arena-workers', { n });
      toast(`Level runs and bot battles: ${n} at a time`);
      refresh();
    } catch (ex) {
      toast(ex instanceof Error ? ex.message : 'could not change that');
    }
  };

  const resetLadder = async () => {
    if (!window.confirm('Reset the leaderboard? Every bot comes off the ladder and all ratings are wiped — Andrew re-seats fresh at 1000. Match history is kept.')) return;
    await api.post('/admin/ladder-reset');
    toast('Leaderboard reset — a new season begins');
    refresh();
  };

  const setActive = async (usernames: string[], active: boolean) => {
    if (!usernames.length) { toast('Nobody to change'); return; }
    if (!active && !window.confirm(
      `Retire ${usernames.length} account${usernames.length === 1 ? '' : 's'}?\n\n`
      + 'They are signed out immediately and cannot log back in, and they stop counting '
      + 'towards the achievement percentages — which is how last week\'s campers stop '
      + 'dragging this week\'s numbers down.\n\nTheir bots and achievements are kept, '
      + 'so you can bring them back at any time.')) return;
    const r = await api.post<{ changed: string[] }>('/admin/set-active', { usernames, active });
    toast(active
      ? `Brought back ${r.changed.length} account${r.changed.length === 1 ? '' : 's'}`
      : `Retired ${r.changed.length} account${r.changed.length === 1 ? '' : 's'}`);
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
        </div>

        <div className="coup-card" style={{ background: 'var(--panel-2)', margin: '0 0 16px' }}>
          <h2 className="coup-h" style={{ marginTop: 0 }}>🏆 Scrimmage
            <small>
              {ladder
                ? ladder.running
                  ? `running — ${ladder.totalBots} bots, ${ladder.totalMatches.toLocaleString()} matches played`
                  : `paused — hidden from campers (${ladder.totalBots} bots still rated)`
                : 'loading…'}
            </small>
          </h2>
          <p className="coup-sub">
            While the scrimmage is paused the campers cannot see the Leaderboard tab,
            the standings, their rating, or scrimmage matches in Match History — and
            nobody can submit a bot. Ratings are kept, so you can pause and start again
            without losing a season.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {ladder?.running
              ? <button className="danger" onClick={() => setScrimmage(false)}
                  title="Stop pairing and hide the whole leaderboard from the campers">
                  ⏸ Pause scrimmage
                </button>
              : <button className="primary" onClick={() => setScrimmage(true)}
                  title="Start pairing bots and show the leaderboard to everyone">
                  ▶ Start scrimmage
                </button>}
            <button onClick={resetLadder}
              title="Fresh week: everyone off the leaderboard, ratings wiped, Andrew re-seats at 1000">
              🔄 Reset leaderboard
            </button>
          </div>
          {ladder && ladder.houseBots && (
            <div style={{ marginTop: 12 }}>
              <label style={{ margin: '0 0 6px' }}>House bots on the board</label>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                {ladder.houseBots.map((name) => (
                  <label key={name} style={{
                    margin: 0, display: 'flex', alignItems: 'center', gap: 5,
                    textTransform: 'none', letterSpacing: 0, fontSize: 13.5,
                    color: ladder.defenders.includes(name) ? 'var(--accent)' : 'var(--ink-mut)',
                  }}>
                    <input type="checkbox" style={{ width: 'auto', margin: 0 }}
                      checked={ladder.defenders.includes(name)}
                      onChange={(e) => toggleDefender(name, e.target.checked)} />
                    {name}
                  </label>
                ))}
                <span className="coup-note">
                  {ladder.defenders.length === 0
                    ? 'campers fight only each other'
                    : `${ladder.defenders.length} defending — they play from your saved slots`}
                </span>
              </div>
            </div>
          )}
          {ladder && ladder.tickChoices && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
              <label style={{ margin: 0 }}>Speed</label>
              <select value={ladder.tickMs} style={{ width: 250 }}
                onChange={(e) => setTick(Number(e.target.value))}>
                {ladder.tickChoices.map((ms) => (
                  <option key={ms} value={ms}>{TICK_LABEL[ms] ?? `every ${ms / 1000}s`}</option>
                ))}
              </select>
              <span className="coup-note">
                {ladder.tickMs === 0
                  // no interval to divide by — a match takes ~0.7s, so this is
                  // simply as fast as the machine goes
                  ? 'as fast as the machine allows — roughly 5,000 matches/hour, one worker pinned. Do not leave this on.'
                  : <>
                      ≈ {Math.round(3600 / (ladder.tickMs / 1000))} matches/hour
                      · {(3600 / (ladder.tickMs / 1000) * 700).toLocaleString()} games
                      {ladder.tickMs <= 1000 && ' · a worker busy ~70% of the time, ~250 MB/hr of records'}
                    </>}
              </span>
            </div>
          )}
        </div>
        <div className="coup-card" style={{ background: 'var(--panel-2)', margin: '0 0 16px' }}>
          <h2 className="coup-h" style={{ marginTop: 0 }}>🗓 Cohort
            <small>{data.activeCount} active · {data.students.filter((s) => !s.isAdmin && !s.active).length} retired</small>
          </h2>
          <p className="coup-sub">
            Achievement percentages are shares of the <b>active</b> accounts — students,
            mentors and board alike. Retiring a finished week signs those campers out,
            blocks their logins, and takes them out of the percentages so this week's
            rarity numbers mean something. Their bots and trophies are kept.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="danger"
              onClick={() => setActive(
                data.students.filter((s) => s.role === 'student' && s.active).map((s) => s.username),
                false,
              )}
              title="Sign out and retire every currently-active student login">
              🗄 Retire all students
            </button>
            <button
              onClick={() => setActive(
                data.students.filter((s) => !s.isAdmin && !s.active).map((s) => s.username),
                true,
              )}
              title="Bring every retired account back">
              ↩ Bring everyone back
            </button>
          </div>
        </div>

        <div className="coup-card" style={{ background: 'var(--panel-2)', margin: '0 0 16px' }}>
          <h2 className="coup-h" style={{ marginTop: 0 }}>⚙️ Match queue
            <small>
              {data.arena.running} running · {data.arena.queued} waiting ·
              {' '}{data.arena.maxWorkers} at a time
            </small>
          </h2>
          <p className="coup-sub">
            Level runs and bot battles share these workers, so a whole class pressing
            “play this level” at once queues behind them. One match is ~700 games and
            takes about a second. Raise this if campers are waiting; lower it if the
            site feels sluggish — a small cloud instance has far less CPU than it claims.
          </p>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ margin: 0 }}>At once</label>
            <select value={data.arena.maxWorkers} style={{ width: 110 }}
              onChange={(e) => setWorkers(Number(e.target.value))}>
              {data.arena.choices.map((n) => (
                <option key={n} value={n}>{n} match{n === 1 ? '' : 'es'}</option>
              ))}
            </select>
            <span className="coup-note">
              {data.arena.maxWorkers <= 2
                ? 'safe on any instance'
                : 'needs real CPU — check the site stays responsive'}
            </span>
          </div>
        </div>

        <div style={{ maxHeight: '62vh', overflowY: 'auto' }}>
          <table className="coup-table">
            <thead><tr><th>Login</th><th>Name</th><th>Role</th>
              <th className="num">Saved</th><th className="num">🏅</th>
              <th>Selected bot</th><th /></tr></thead>
            <tbody>
              {data.students.map((s) => (
                <tr key={s.username} style={s.active ? undefined : { opacity: 0.45 }}>
                  <td className="mono" style={{ fontSize: 13 }}>{s.username}{s.isAdmin ? ' ⭐' : ''}</td>
                  <td>{s.displayName}{s.active ? '' : ' · retired'}</td>
                  <td style={{ color: 'var(--ink-mut)', fontSize: 13 }}>{s.role}</td>
                  <td className="num">{s.slotsUsed}</td>
                  <td className="num" style={{ color: 'var(--ink-mut)', fontSize: 13 }}>
                    {s.achievements}/{data.achievementTotal}
                  </td>
                  <td style={{ color: 'var(--ink-mut)', fontSize: 13 }}>{s.selectedBot ? `★ ${s.selectedBot}` : '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="small ghost" onClick={() => resetPw(s.username)}>reset pw</button>
                    {!s.isAdmin && (
                      <button className="small ghost" onClick={() => setActive([s.username], !s.active)}>
                        {s.active ? 'retire' : 'restore'}
                      </button>
                    )}
                  </td>
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
