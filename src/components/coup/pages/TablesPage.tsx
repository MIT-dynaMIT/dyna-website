import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useToast } from '../CoupApp';
import '../tables.css';

/** Classic multiplayer Coup — 15 cards, five roles, 4-6 players a table. */

const ROLE_LABEL: Record<string, string> = {
  duke: 'Duke', assassin: 'Assassin', captain: 'Captain', ambassador: 'Ambassador', contessa: 'Contessa',
};
const ACTION_LABEL: Record<string, string> = {
  income: 'Income (+1)', foreign_aid: 'Foreign Aid (+2)', tax: 'Tax (+3)',
  coup: 'Coup (7)', assassinate: 'Assassinate (3)', steal: 'Steal', exchange: 'Exchange',
};
const BUFO = (role: string) => `/bufo/${role}.png`;

interface LobbyTable { id: string; size: number; seated: string[]; open: number; playing: boolean }
interface LobbyData { tables: LobbyTable[]; mine: { id: string; playing: boolean; over: boolean } | null }

interface MPlayer { id: string; coins: number; alive: boolean; influence: number; revealed: string[]; cards: (string | null)[] }
interface MView { players: MPlayer[]; deckCount: number; turn: string | null; winner: string | null }
interface MPrompt {
  kind: 'action' | 'respond' | 'lose' | 'exchange';
  mustCoup?: boolean;
  actions?: { type: string; needsTarget: boolean; targets: { id: string; name: string }[] }[];
  mode?: 'challenge' | 'block';
  action?: { type: string; actor: string; target: string | null } | null;
  claim?: { player: string; role: string; blocking: boolean };
  options?: string[];
  why?: string;
  cards?: { idx: number; role: string }[];
  pool?: string[];
  keep?: number;
}
interface MSnap {
  seatNames: string[]; you: string; youIndex: number;
  view: MView; frames: { log: Record<string, unknown> }[]; cursor: number;
  prompt: MPrompt | null; waitingFor: string[]; timerMs: number | null;
  done: boolean; winnerName: string | null;
}

function describe(log: Record<string, unknown>, nm: (id: unknown) => string): string | null {
  const role = (r: unknown) => ROLE_LABEL[String(r)] || String(r);
  switch (log.t) {
    case 'action': {
      const a = String(log.action);
      const t = log.target ? ` on ${nm(log.target)}` : '';
      return `${nm(log.player)} — ${ACTION_LABEL[a] || a}${t}`;
    }
    case 'block': return `${nm(log.player)} claims the ${role(log.role)} to block`;
    case 'blocked': return `Blocked by ${nm(log.by)}.`;
    case 'challenge': return `${nm(log.by)} challenges ${nm(log.against)}'s ${role(log.role)} — ${log.truthful ? 'it was real!' : 'a bluff!'}`;
    case 'proved': return `${nm(log.player)} shows the ${role(log.role)} and draws a new card`;
    case 'gain': return `${nm(log.player)} collects ${log.amount} coin${Number(log.amount) === 1 ? '' : 's'}`;
    case 'stole': return `${nm(log.actor)} steals ${log.amount} from ${nm(log.target)}`;
    case 'exchanged': return `${nm(log.player)} exchanges with the deck`;
    case 'lost': return `${nm(log.player)} loses the ${role(log.role)} (${log.why})${log.out ? ' — OUT!' : ''}`;
    case 'win': return `👑 ${nm(log.player)} wins!`;
    default: return null;
  }
}

export default function TablesPage() {
  const toast = useToast();
  const [lobby, setLobby] = useState<LobbyData | null>(null);
  const [size, setSize] = useState(5);
  const [snap, setSnap] = useState<MSnap | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [targetFor, setTargetFor] = useState<string | null>(null);
  const [exchangeSel, setExchangeSel] = useState<number[]>([]);
  const snapRef = useRef<MSnap | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // decision clock
  const deadlineRef = useRef<number | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((k) => k + 1), 500);
    return () => clearInterval(t);
  }, []);
  const secondsLeft = deadlineRef.current != null
    ? Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000)) : null;

  const inGame = !!lobby?.mine && (lobby.mine.playing || lobby.mine.over);

  const applySnap = useCallback((s: MSnap) => {
    const prev = snapRef.current;
    snapRef.current = s;
    setSnap(s);
    deadlineRef.current = s.timerMs != null ? Date.now() + s.timerMs : null;
    if (s.frames.length) {
      const nm = (id: unknown) => s.seatNames[Number(String(id).slice(1))] ?? String(id);
      setLogs((l) => [...l, ...s.frames.map((f) => describe(f.log, nm)).filter(Boolean) as string[]]);
    }
    const promptChanged = JSON.stringify(prev?.prompt ?? null) !== JSON.stringify(s.prompt);
    if (promptChanged) { setTargetFor(null); setExchangeSel([]); }
  }, []);

  // lobby poll (always) + game poll (when seated at a live table)
  useEffect(() => {
    let stop = false;
    const beat = async () => {
      try {
        const d = await api.get<LobbyData>('/multi/lobby');
        if (stop) return;
        setLobby(d);
        if (d.mine && (d.mine.playing || d.mine.over)) {
          const cur = snapRef.current;
          const s = await api.get<MSnap>(`/multi/game?cursor=${cur ? cur.cursor : 0}`);
          if (stop) return;
          applySnap(s);
        } else if (snapRef.current) {
          snapRef.current = null; setSnap(null); setLogs([]);
        }
      } catch { /* blip */ }
    };
    beat();
    const t = setInterval(beat, 1000);
    return () => { stop = true; clearInterval(t); };
  }, [applySnap]);

  const act = async (path: string, body?: Record<string, unknown>) => {
    setBusy(true);
    try {
      await api.post(`/multi/${path}`, body);
    } catch (ex) {
      toast(ex instanceof Error ? ex.message : 'that did not work');
    } finally {
      setBusy(false);
    }
  };

  const sendMove = async (msg: Record<string, unknown>) => {
    const cur = snapRef.current;
    if (!cur || busy) return;
    setBusy(true);
    try {
      const s = await api.post<MSnap>('/multi/move', { cursor: cur.cursor, ...msg });
      applySnap(s);
    } catch (ex) {
      toast(ex instanceof Error ? ex.message : 'that move was not allowed');
    } finally {
      setBusy(false);
    }
  };

  // ---------------------------------------------------------------- lobby
  if (!inGame || !snap) {
    return (
      <div>
        <div className="coup-card" style={{ marginBottom: 18 }}>
          <h2 className="coup-h">🐸 Multiplayer Coup
            <small>classic rules · 15 cards · five characters · 4-6 a table</small>
          </h2>
          <p className="coup-sub">
            Real Coup, everyone for themselves. Sit at a table — the game deals the moment
            the last seat fills. 10 seconds a turn, 5 to react. Last player standing wins.
          </p>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <label style={{ margin: 0 }}>Table size</label>
            <select value={size} onChange={(e) => setSize(Number(e.target.value))} style={{ width: 130 }}>
              <option value={4}>4 players</option>
              <option value={5}>5 players ★</option>
              <option value={6}>6 players</option>
            </select>
            <button className="primary" disabled={busy || !!lobby?.mine}
              onClick={() => act('create', { size })}>+ Add a table &amp; sit down</button>
            {lobby?.mine && !lobby.mine.playing && (
              <button className="ghost" disabled={busy} onClick={() => act('leave')}>Stand up</button>
            )}
          </div>
        </div>

        {!lobby && <p className="coup-note"><span className="coup-spin" /> Loading tables…</p>}
        {lobby && lobby.tables.length === 0 && (
          <p className="coup-note">No tables yet — add one and others will see it instantly.</p>
        )}
        <div className="mp-tables">
          {lobby?.tables.map((t) => {
            const mine = lobby.mine?.id === t.id;
            return (
              <div key={t.id} className={`coup-card mp-table ${mine ? 'mine' : ''}`}>
                <div className="mp-table-head">
                  <b>{t.seated.length}/{t.size}</b> seated {t.playing ? '· 🎮 playing' : '· waiting'}
                </div>
                <div className="mp-seats">
                  {t.seated.map((n) => <span key={n} className="mp-seat-chip">{n}</span>)}
                  {Array.from({ length: t.open }).map((_, i) => <span key={'o' + i} className="mp-seat-chip open">empty</span>)}
                </div>
                {!t.playing && !mine && t.open > 0 && (
                  <button className="primary small" disabled={busy || !!lobby.mine}
                    onClick={() => act('sit', { id: t.id })}>Sit down</button>
                )}
                {mine && !t.playing && <span className="coup-note">waiting for {t.open} more…</span>}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- game
  const v = snap.view;
  const me = v.players[snap.youIndex];
  const prompt = snap.prompt;
  const nmOf = (i: number) => snap.seatNames[i];

  return (
    <div>
      <div className="ct-shell" style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <h2 className="coup-h" style={{ margin: 0 }}>🐸 Table
          <small>classic coup · you are {snap.you}</small>
        </h2>
        <div style={{ flex: 1 }} />
        <button className="ghost small danger" disabled={busy}
          onClick={() => { if (window.confirm(snap.done ? 'Leave the table?' : 'Leave mid-game? Your turns will play themselves.')) void act('leave'); }}>
          Leave table
        </button>
      </div>

      <div className="mp-game">
        <div className="mp-board coup-card">
          <div className="mp-opps">
            {v.players.map((p, i) => {
              if (i === snap.youIndex) return null;
              const active = !snap.done && snap.waitingFor.includes(nmOf(i));
              return (
                <div key={p.id} className={`mp-opp ${p.alive ? '' : 'dead'} ${active ? 'active' : ''}`}>
                  <div className="mp-opp-name">{nmOf(i)}{v.turn === p.id ? ' ●' : ''}</div>
                  <div className="mp-opp-row">
                    <span className="mp-coins" title="coins">🪙 {p.coins}</span>
                    <span className="mp-cards">
                      {Array.from({ length: p.influence }).map((_, k) => (
                        <span key={k} className="mp-cardback" title="hidden influence">🐸</span>
                      ))}
                      {p.revealed.map((r, k) => (
                        <img key={'r' + k} className="mp-mini dead" src={BUFO(r)} title={`lost ${ROLE_LABEL[r]}`} alt={r} />
                      ))}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mp-center">
            <span className="coup-note">deck {v.deckCount} · {snap.done
              ? <b>👑 {snap.winnerName} wins!</b>
              : snap.waitingFor.length ? `waiting for ${snap.waitingFor.join(', ')}` : '…'}</span>
            {secondsLeft != null && !snap.done && (
              <span className={`mp-clock ${secondsLeft <= 3 ? 'low' : ''}`}>⏱ {secondsLeft}s</span>
            )}
          </div>

          <div className="mp-me">
            <div className="mp-hand">
              {me.cards.map((role, i) => role && (
                <div key={i} className="mp-card">
                  <img src={BUFO(role)} alt={role} />
                  <span>{ROLE_LABEL[role]}</span>
                </div>
              ))}
              {me.revealed.map((r, k) => (
                <div key={'r' + k} className="mp-card dead">
                  <img src={BUFO(r)} alt={r} />
                  <span>{ROLE_LABEL[r]} ✗</span>
                </div>
              ))}
            </div>
            <div className="mp-me-meta">
              <b>{snap.you}</b> · 🪙 {me.coins}{!me.alive && ' · eliminated'}
            </div>
          </div>
        </div>

        <div className="mp-log coup-card">
          <h3 className="coup-h" style={{ fontSize: 14 }}>Table talk</h3>
          <div className="mp-log-lines">
            {logs.slice(-60).map((l, i) => <div key={i}>{l}</div>)}
            <div ref={logEndRef} />
          </div>
        </div>
      </div>

      <div className="ct-actionbar">
        {snap.done ? (
          <p className="barhead">👑 {snap.winnerName} wins! Next game starts shortly — or leave the table.</p>
        ) : !prompt ? (
          <p className="barsub">Waiting for {snap.waitingFor.join(', ') || '…'}…</p>
        ) : prompt.kind === 'action' ? (
          targetFor ? (
            <div>
              <p className="barhead">{ACTION_LABEL[targetFor]} — pick a target</p>
              <div className="ct-btns">
                {(prompt.actions?.find((a) => a.type === targetFor)?.targets || []).map((t) => (
                  <button key={t.id} className="ct-actbtn" disabled={busy}
                    onClick={() => sendMove({ kind: 'action', type: targetFor, target: t.id })}>{t.name}</button>
                ))}
                <button className="ghost" onClick={() => setTargetFor(null)}>← back</button>
              </div>
            </div>
          ) : (
            <div>
              <p className="barhead">Your move{prompt.mustCoup ? ' — 10+ coins, you must Coup' : ''}</p>
              <div className="ct-btns">
                {(prompt.actions || []).map((a) => (
                  <button key={a.type} className="ct-actbtn" disabled={busy}
                    onClick={() => a.needsTarget ? setTargetFor(a.type) : sendMove({ kind: 'action', type: a.type })}>
                    {ACTION_LABEL[a.type] || a.type}
                  </button>
                ))}
              </div>
            </div>
          )
        ) : prompt.kind === 'respond' ? (
          <div>
            <p className="barhead">
              {prompt.mode === 'challenge'
                ? <>{prompt.claim!.player} claims the <b>{ROLE_LABEL[prompt.claim!.role]}</b>{prompt.claim!.blocking ? ' to block' : ''} — believe them?</>
                : <>{prompt.action ? `${prompt.action.actor} — ${ACTION_LABEL[prompt.action.type]}${prompt.action.target ? ' on ' + prompt.action.target : ''}` : 'An action'} — block it?</>}
            </p>
            <div className="ct-btns">
              {(prompt.options || []).map((o) => o === 'pass' ? (
                <button key={o} className="ghost" disabled={busy}
                  onClick={() => sendMove({ kind: 'respond', what: 'pass' })}>
                  {prompt.mode === 'challenge' ? 'Let it stand' : 'Allow it'}
                </button>
              ) : o === 'challenge' ? (
                <button key={o} className="danger" disabled={busy}
                  onClick={() => sendMove({ kind: 'respond', what: 'challenge' })}>⚑ Challenge!</button>
              ) : (
                <button key={o} className="ct-actbtn" disabled={busy}
                  onClick={() => sendMove({ kind: 'respond', what: 'block', role: o.slice(6) })}>
                  Block with {ROLE_LABEL[o.slice(6)]}
                </button>
              ))}
            </div>
          </div>
        ) : prompt.kind === 'lose' ? (
          <div>
            <p className="barhead">Choose a card to give up ({prompt.why}).</p>
            <div className="ct-btns">
              {(prompt.cards || []).map((c) => (
                <button key={c.idx} className="ct-actbtn" disabled={busy}
                  onClick={() => sendMove({ kind: 'lose', idx: c.idx })}>
                  <img className="mp-btn-bufo" src={BUFO(c.role)} alt="" />{ROLE_LABEL[c.role]}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <p className="barhead">Exchange — keep exactly {prompt.keep} ({exchangeSel.length}/{prompt.keep} picked).</p>
            <div className="ct-btns">
              {(prompt.pool || []).map((role, i) => (
                <button key={i}
                  className={`ct-actbtn ${exchangeSel.includes(i) ? 'sel' : ''}`}
                  style={exchangeSel.includes(i) ? { borderColor: 'var(--accent)', boxShadow: '0 0 0 2px var(--accent)' } : undefined}
                  disabled={busy}
                  onClick={() => setExchangeSel((s) => s.includes(i) ? s.filter((x) => x !== i) : s.length < (prompt.keep || 0) ? [...s, i] : s)}>
                  <img className="mp-btn-bufo" src={BUFO(role)} alt="" />{ROLE_LABEL[role]}
                </button>
              ))}
              <button className="primary" disabled={busy || exchangeSel.length !== prompt.keep}
                onClick={() => sendMove({ kind: 'exchange', keep: exchangeSel })}>Confirm</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
