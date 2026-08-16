import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import type { CoupUser, Frame, GameView, LiveSnapshot, Prompt } from '../api';
import { useLive, useToast } from '../CoupApp';
import CoupTable, { describe } from '../CoupTable';
import type { TalkLine } from '../CoupTable';
import { ActionBar } from './PlayPage';

const STEP_MS = 900;       // cadence while replaying the opponent's moves
const POLL_MS = 1200;      // how often we ask the server for news mid-duel

export default function VersusPage({ user }: { user: CoupUser }) {
  const toast = useToast();
  const live = useLive();

  // localMatch makes accept-a-challenge snappy; the global poll catches up
  const [localMatch, setLocalMatch] = useState<string | null>(null);
  const matchId = localMatch ?? live?.match ?? null;

  // ------------------------------------------------ live game state
  const [snap, setSnap] = useState<LiveSnapshot | null>(null);
  const [displayView, setDisplayView] = useState<GameView | null>(null);
  const [prevView, setPrevView] = useState<GameView | null>(null);
  const [stepLog, setStepLog] = useState<Record<string, unknown> | null>(null);
  const [animKey, setAnimKey] = useState(0);
  const [logs, setLogs] = useState<Record<string, unknown>[]>([]);
  const [queue, setQueue] = useState<Frame[]>([]);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [busy, setBusy] = useState(false);
  const [callFor, setCallFor] = useState<string | null>(null);
  const [exchangeSel, setExchangeSel] = useState<number[]>([]);

  const snapRef = useRef<LiveSnapshot | null>(null);
  const viewRef = useRef<GameView | null>(null);
  const pendingPrompt = useRef<Prompt | null>(null);
  viewRef.current = displayView;

  const applySnapshot = useCallback((s: LiveSnapshot, isStart: boolean) => {
    const prev = snapRef.current;
    snapRef.current = s;
    setSnap(s);
    pendingPrompt.current = s.prompt;
    // don't wipe a half-picked call/exchange on a quiet poll — only when
    // something actually happened or the ask itself changed
    const promptChanged = JSON.stringify(prev?.prompt ?? null) !== JSON.stringify(s.prompt);
    if (isStart || s.frames.length > 0 || promptChanged) {
      setCallFor(null);
      setExchangeSel([]);
    }
    if (isStart) {
      setLogs([]);
      setPrevView(null);
      setQueue([]);
      setDisplayView(s.view);
      viewRef.current = s.view;
      // opening frames replay from a blank table; skip straight to now
      setLogs(s.frames.map((f) => f.log));
      setPrompt(s.prompt);
      return;
    }
    if (s.frames.length > 0) setQueue((q) => [...q, ...s.frames]);
  }, []);

  // drain the frame queue one step at a time, then reveal the prompt
  useEffect(() => {
    if (queue.length === 0) { setPrompt(pendingPrompt.current); return; }
    const t = setTimeout(() => {
      setQueue((q) => {
        if (q.length === 0) return q;
        const [f, ...rest] = q;
        setPrevView(viewRef.current);
        setDisplayView(f.view);
        viewRef.current = f.view;
        setStepLog(f.log);
        setAnimKey((k) => k + 1);
        setLogs((l) => [...l, f.log]);
        return rest;
      });
    }, STEP_MS);
    return () => clearTimeout(t);
  }, [queue, snap]);

  // join / rejoin the assigned duel
  useEffect(() => {
    if (!matchId) { setSnap(null); snapRef.current = null; return; }
    if (snapRef.current?.id === matchId) return;
    api.get<LiveSnapshot>(`/live/match/${matchId}?cursor=0`)
      .then((s) => applySnapshot(s, true))
      .catch(() => setLocalMatch(null));
  }, [matchId, applySnapshot]);

  // poll for the opponent's moves
  useEffect(() => {
    if (!matchId || !snap || (snap.done && queue.length === 0)) return;
    const t = setInterval(() => {
      const cur = snapRef.current;
      if (!cur || busy) return;
      api.get<LiveSnapshot>(`/live/match/${matchId}?cursor=${cur.cursor}`)
        .then((s) => applySnapshot(s, false))
        .catch(() => {});
    }, POLL_MS);
    return () => clearInterval(t);
  }, [matchId, snap, busy, queue.length, applySnapshot]);

  const sendMove = async (msg: Record<string, unknown>) => {
    const s = snapRef.current;
    if (!s || busy) return;
    setBusy(true);
    setPrompt(null);
    try {
      const next = await api.post<LiveSnapshot>(`/live/match/${s.id}/move`, { cursor: s.cursor, ...msg });
      applySnapshot(next, false);
    } catch (ex) {
      toast(ex instanceof ApiError ? ex.message : 'that move was not allowed');
      setPrompt(pendingPrompt.current);
    } finally {
      setBusy(false);
    }
  };

  const concede = async () => {
    const s = snapRef.current;
    if (!s) return;
    if (!window.confirm('Give up this game?')) return;
    try {
      const next = await api.post<LiveSnapshot>(`/live/match/${s.id}/forfeit`, { cursor: s.cursor });
      applySnapshot(next, false);
    } catch { /* poll will catch up */ }
  };

  const backToLobby = async () => {
    try { await api.post('/live/leave'); } catch { /* fine */ }
    setLocalMatch(null);
    setSnap(null); snapRef.current = null;
    setDisplayView(null); viewRef.current = null;
    setPrevView(null); setLogs([]); setQueue([]); setPrompt(null);
  };

  // ------------------------------------------------ lobby
  const challenge = async (to: string, name: string, kind: 'duel' | 'bots') => {
    try {
      await api.post('/live/challenge', { to, kind });
      toast(kind === 'bots'
        ? `Bot battle sent to ${name} — waiting for them to accept.`
        : `Challenge sent to ${name} — waiting for them to accept.`);
    } catch (ex) {
      toast(ex instanceof Error ? ex.message : 'challenge failed');
    }
  };

  const answerInvite = async (accept: boolean) => {
    try {
      const r = await api.post<{ match?: string; bots?: boolean }>('/live/respond', { accept });
      if (accept && r.bots) toast('Bot battle started — results in Match History in about 20 seconds');
      else if (accept && r.match) setLocalMatch(r.match);
    } catch (ex) {
      toast(ex instanceof Error ? ex.message : 'that challenge expired');
    }
  };

  if (!matchId || !snap || !displayView) {
    const online = live?.online ?? [];
    return (
      <div className="coup-grid2" style={{ gridTemplateColumns: '1.2fr 1fr' }}>
        <div className="coup-card">
          <h2 className="coup-h">🏟 Versus
            <small>{online.length} other player{online.length === 1 ? '' : 's'} online</small>
          </h2>
          <p className="coup-sub">Two ways to play someone: <b>⚔ Duel</b> — a live game, you against them.
            {' '}<b>🤖 Bot battle</b> — your selected bot vs theirs, best of 5 rounds, results in Match History.</p>
          {live?.invite && (
            <div className="coup-card" style={{ background: 'var(--panel-2)', marginBottom: 14 }}>
              <p style={{ margin: '0 0 10px' }}>
                {live.invite.kind === 'bots'
                  ? <>🤖 <b>{live.invite.fromName}</b> wants a bot battle — their selected bot vs yours!</>
                  : <>⚔ <b>{live.invite.fromName}</b> wants to play you live!</>}
              </p>
              <button className="primary" onClick={() => answerInvite(true)}>Accept</button>{' '}
              <button className="ghost" onClick={() => answerInvite(false)}>Decline</button>
            </div>
          )}
          {online.length === 0 && <p className="coup-note">Nobody else is online right now.</p>}
          {online.length > 0 && (
            <table className="coup-table">
              <thead><tr><th>Player</th><th /><th /></tr></thead>
              <tbody>
                {online.map((o) => (
                  <tr key={o.username}>
                    <td>{o.displayName}</td>
                    <td style={{ color: 'var(--ink-mut)', fontSize: 12.5 }}>{o.role === 'mentor' ? 'mentor' : o.role === 'organizer' ? 'organizer' : ''}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="small" onClick={() => challenge(o.username, o.displayName, 'duel')}>⚔ Duel</button>{' '}
                      <button className="small" onClick={() => challenge(o.username, o.displayName, 'bots')}>🤖 Bot battle</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="coup-card">
          <h2 className="coup-h">How it works</h2>
          <p className="coup-sub">
            Challenges show up within a few seconds — the other player gets an Accept
            button. Organizers can also pair everyone up at once: a random live game
            (you get pulled straight here) or a random bot battle. Leaving a live
            game counts as giving up.
          </p>
        </div>
      </div>
    );
  }

  // ------------------------------------------------ game screen
  const talk: TalkLine[] = logs.map((l) => describe(l, snap.seatNames)).filter(Boolean) as TalkLine[];
  const banner = talk.length ? talk[talk.length - 1] : null;
  const animating = queue.length > 0;
  const showPrompt = !animating && !!prompt && !busy;
  const done = snap.done && !animating;
  const oppName = snap.seatNames[1 - snap.youIndex];

  const overlay = done ? (
    <>
      <div className="crown">♛</div>
      <div className="rules">
        {snap.forfeited && <div style={{ marginBottom: 6 }}>The game was conceded.</div>}
        {snap.winnerName === user.displayName
          ? <><b>You</b> win!</>
          : <><b>{snap.winnerName}</b> wins.</>}
      </div>
      <div className="ovbtns"><button className="primary" onClick={backToLobby}>Back to the lobby</button></div>
    </>
  ) : null;

  return (
    <div>
      <div className="ct-shell" style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <h2 className="coup-h" style={{ margin: 0 }}>🏟 Live game
          <small>you vs {oppName} — a real person!</small>
        </h2>
        <div style={{ flex: 1 }} />
        {!done && <button className="ghost small danger" onClick={concede}>Give up</button>}
      </div>

      <CoupTable
        seatNames={snap.seatNames}
        view={displayView}
        prevView={prevView}
        stepLog={stepLog}
        animate
        animKey={animKey}
        youIndex={snap.youIndex}
        banner={banner}
        talk={talk}
        overlay={overlay}
      />

      {!done && (
        <div className="ct-actionbar">
          {animating && <p className="barsub">…</p>}
          {showPrompt && prompt && (
            <ActionBar
              prompt={prompt}
              callFor={callFor}
              setCallFor={setCallFor}
              exchangeSel={exchangeSel}
              setExchangeSel={setExchangeSel}
              onMove={sendMove}
            />
          )}
          {!animating && !showPrompt && (
            <p className="barsub">
              {snap.waitingFor ? <>Waiting for <b>{snap.waitingFor}</b>…</> : 'Waiting…'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
