import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, ROLE_GLYPHS, ROLE_LABEL, ACTION_LABEL } from '../api';
import type { BotSlot, CoupUser, Frame, GameView, PlaySnapshot, Prompt } from '../api';
import { useToast } from '../CoupApp';
import CoupTable, { describe } from '../CoupTable';
import type { TalkLine } from '../CoupTable';

const STEP_MS = 900;         // cadence while animating bot moves
const ACTION_COST: Record<string, number> = { coup: 7, assassinate: 3 };
const ACTION_ROLE: Record<string, string> = { tax: 'duke', steal: 'captain', exchange: 'ambassador', assassinate: 'assassin' };

type Pick = number | 'house';

export default function PlayPage({ user }: { user: CoupUser }) {
  const toast = useToast();
  const [phase, setPhase] = useState<'setup' | 'game'>('setup');

  // ------------------------------------------------ setup
  const [slots, setSlots] = useState<(BotSlot | null)[]>([]);
  const [picks, setPicks] = useState<Pick[]>(['house', 'house', 'house', 'house']);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    api.get<{ slots: (BotSlot | null)[] }>('/bots').then((b) => setSlots(b.slots)).catch(() => {});
  }, []);

  const filled = slots.map((s, i) => ({ s, i })).filter((x) => x.s && x.s.python);

  // ------------------------------------------------ live game state
  const [snap, setSnap] = useState<PlaySnapshot | null>(null);
  const [displayView, setDisplayView] = useState<GameView | null>(null);
  const [prevView, setPrevView] = useState<GameView | null>(null);
  const [stepLog, setStepLog] = useState<Record<string, unknown> | null>(null);
  const [animKey, setAnimKey] = useState(0);
  const [logs, setLogs] = useState<Record<string, unknown>[]>([]);
  const [queue, setQueue] = useState<Frame[]>([]);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<{ type: string; targets: string[] } | null>(null);
  const [exchangeSel, setExchangeSel] = useState<number[]>([]);

  const snapRef = useRef<PlaySnapshot | null>(null);
  const viewRef = useRef<GameView | null>(null);
  const pendingPrompt = useRef<Prompt | null>(null);
  viewRef.current = displayView;

  const applySnapshot = useCallback((s: PlaySnapshot, isStart: boolean) => {
    snapRef.current = s;
    setSnap(s);
    pendingPrompt.current = s.prompt;
    setPrompt(null);
    setTarget(null);
    setExchangeSel([]);
    if (isStart) {
      setLogs([]);
      setPrevView(null);
      setDisplayView(s.view);
      viewRef.current = s.view;
    }
    setQueue(s.frames);
  }, []);

  // drain the frame queue one step at a time, then reveal the prompt
  useEffect(() => {
    if (queue.length === 0) {
      setPrompt(pendingPrompt.current);
      return;
    }
    const first = !viewRef.current;
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
    }, first ? 0 : STEP_MS);
    return () => clearTimeout(t);
  }, [queue]);

  const startGame = async () => {
    setStarting(true);
    try {
      const s = await api.post<PlaySnapshot>('/play/start', { opponents: picks });
      setPhase('game');
      applySnapshot(s, true);
    } catch (ex) {
      toast(ex instanceof Error ? ex.message : 'could not deal the table');
    } finally {
      setStarting(false);
    }
  };

  const sendMove = async (msg: Record<string, unknown>) => {
    const s = snapRef.current;
    if (!s || busy) return;
    setBusy(true);
    setPrompt(null);
    try {
      const next = await api.post<PlaySnapshot>(`/play/${s.id}/move`, { cursor: s.cursor, ...msg });
      applySnapshot(next, false);
    } catch (ex) {
      const m = ex instanceof ApiError ? ex.message : 'the court rejected that move';
      toast(m);
      setPrompt(pendingPrompt.current); // let them try again
    } finally {
      setBusy(false);
    }
  };

  const leaveTable = () => {
    setPhase('setup');
    setSnap(null); snapRef.current = null;
    setDisplayView(null); viewRef.current = null;
    setPrevView(null); setLogs([]); setQueue([]); setPrompt(null);
  };

  // ------------------------------------------------ setup screen
  if (phase === 'setup' || !displayView || !snap) {
    return (
      <div className="coup-card" style={{ maxWidth: 560 }}>
        <h2 className="coup-h">🎭 Choose your opposition</h2>
        <p className="coup-sub">
          Take a seat against four rivals. Field your own saved bots or let the House
          send its regulars — then deal yourself in.
        </p>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ marginBottom: 4 }}>
            <label htmlFor={`opp${i}`}>Seat {i + 2}</label>
            <select id={`opp${i}`} value={String(picks[i])}
              onChange={(e) => {
                const v = e.target.value;
                setPicks((p) => p.map((x, j) => (j === i ? (v === 'house' ? 'house' : Number(v)) : x)));
              }}>
              <option value="house">House bot</option>
              {filled.map(({ s, i: si }) => (
                <option key={si} value={si}>My bot — {s!.name}</option>
              ))}
            </select>
          </div>
        ))}
        <div style={{ marginTop: 20 }}>
          <button className="primary" onClick={startGame} disabled={starting}>
            {starting ? 'Dealing…' : '♠ Deal me in'}
          </button>
        </div>
        {filled.length === 0 && (
          <p className="coup-note" style={{ marginTop: 12 }}>
            You have no saved bots yet — you can still play a full table against the House.
          </p>
        )}
      </div>
    );
  }

  // ------------------------------------------------ game screen
  const talk: TalkLine[] = logs.map((l) => describe(l, snap.seatNames)).filter(Boolean) as TalkLine[];
  const banner = talk.length ? talk[talk.length - 1] : null;
  const animating = queue.length > 0;
  const showPrompt = !animating && !!prompt && !busy;
  const done = snap.done && !animating;

  const overlay = done ? (
    <>
      <div className="crown">♛</div>
      <div className="rules">
        {snap.winnerName === user.displayName
          ? <><b>You</b> rule the court!</>
          : <><b>{snap.winnerName}</b> rules the court.</>}
      </div>
      <div className="ovbtns">
        <button className="primary" onClick={leaveTable}>Play again</button>
      </div>
    </>
  ) : null;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <h2 className="coup-h" style={{ margin: 0 }}>🎭 Your table
          <small>heads-up · you are {snap.you}</small>
        </h2>
        <div style={{ flex: 1 }} />
        <button className="ghost small" onClick={leaveTable}>Leave table</button>
      </div>

      <CoupTable
        seatNames={snap.seatNames}
        view={displayView}
        prevView={prevView}
        stepLog={stepLog}
        animate
        animKey={animKey}
        youIndex={0}
        banner={banner}
        talk={talk}
        overlay={overlay}
      />

      {!done && (
        <div className="ct-actionbar">
          {animating && <p className="barsub">The court is deliberating…</p>}
          {showPrompt && prompt && (
            <ActionBar
              prompt={prompt}
              target={target}
              setTarget={setTarget}
              exchangeSel={exchangeSel}
              setExchangeSel={setExchangeSel}
              onMove={sendMove}
            />
          )}
          {!animating && !showPrompt && <p className="barsub">Waiting…</p>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- action bar
function actionGlyph(type: string) {
  const role = ACTION_ROLE[type];
  return role ? ROLE_GLYPHS[role] : (type === 'coup' ? '⚔' : type === 'income' ? '＋' : '⛃');
}

function ActionBar({ prompt, target, setTarget, exchangeSel, setExchangeSel, onMove }: {
  prompt: Prompt;
  target: { type: string; targets: string[] } | null;
  setTarget: (t: { type: string; targets: string[] } | null) => void;
  exchangeSel: number[];
  setExchangeSel: (s: number[]) => void;
  onMove: (msg: Record<string, unknown>) => void;
}) {
  // ----- pick an action
  if (prompt.kind === 'action') {
    if (target) {
      return (
        <div>
          <p className="barhead">{ACTION_LABEL[target.type] || target.type} — who is the target?</p>
          <div className="ct-btns">
            {target.targets.map((t) => (
              <button key={t} onClick={() => onMove({ kind: 'action', type: target.type, target: t })}>{t}</button>
            ))}
            <button className="ghost" onClick={() => setTarget(null)}>← back</button>
          </div>
        </div>
      );
    }
    const mustCoup = prompt.mustCoup;
    return (
      <div>
        <p className="barhead">{mustCoup ? 'Your move' : 'Make your move'}</p>
        {mustCoup && <p className="ct-mustcoup">You are sitting on 10+ coins — you must launch a Coup.</p>}
        <div className="ct-btns">
          {(prompt.actions || []).map((a) => {
            const cost = ACTION_COST[a.type];
            const label = ACTION_LABEL[a.type] || a.type;
            const onClick = () => {
              if (a.targets && a.targets.length) setTarget(a);
              else onMove({ kind: 'action', type: a.type, target: null });
            };
            return (
              <button key={a.type} className="ct-actbtn" onClick={onClick}>
                <span className="glyph">{actionGlyph(a.type)}</span>
                {label}
                {cost != null && <span className="cost">{cost}</span>}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ----- respond to a claim (challenge / block window)
  if (prompt.kind === 'respond') {
    const a = prompt.action;
    const opts = prompt.options || [];
    let head = 'A claim is on the table.';
    if (a) {
      const act = ACTION_LABEL[a.type] || a.type;
      if (a.is_block) {
        head = `${a.blocker} claims the ${(a.claimed_role || '').toUpperCase()} to block ${a.actor}'s ${act}.`;
      } else if (prompt.mode === 'challenge') {
        head = `${a.actor} claims the ${(a.claimed_role || '').toUpperCase()} to take ${act}${a.target ? ` on ${a.target}` : ''}.`;
      } else {
        head = `${a.actor} moves to ${act}${a.target ? ` you` : ''}.`;
      }
    }
    const assassination = !!prompt.assassination;
    return (
      <div>
        <p className="barhead">{head}</p>
        <p className="barsub">
          {assassination
            ? 'The blade is meant for you. Claim the Contessa to survive — or accept your fate.'
            : 'Do you believe them?'}
        </p>
        <div className="ct-btns">
          {opts.map((o) => {
            if (o === 'pass') {
              return (
                <button key={o} className="ghost" onClick={() => onMove({ kind: 'respond', what: 'pass' })}>
                  {assassination ? 'Accept your fate' : prompt.mode === 'block' ? 'Allow it' : 'Let it stand'}
                </button>
              );
            }
            if (o === 'challenge') {
              return (
                <button key={o} className="danger" onClick={() => onMove({ kind: 'respond', what: 'challenge' })}>
                  ⚑ Challenge!
                </button>
              );
            }
            if (o.startsWith('block:')) {
              const role = o.slice(6);
              return (
                <button key={o} className="ct-actbtn" onClick={() => onMove({ kind: 'respond', what: 'block', role })}>
                  <span className="glyph">{ROLE_GLYPHS[role]}</span>
                  {assassination && role === 'contessa' ? 'Claim the Contessa' : `Block with ${ROLE_LABEL[role] || role}`}
                </button>
              );
            }
            return null;
          })}
        </div>
      </div>
    );
  }

  // ----- lose an influence
  if (prompt.kind === 'lose') {
    const cards = prompt.cards || [];
    return (
      <div>
        <p className="barhead">Choose an influence to give up{prompt.why ? ` (${prompt.why})` : ''}.</p>
        <div className="ct-pickcards">
          {cards.map((c) => (
            <button key={c.idx} className={`ct-card face role-${c.role}`}
              style={{ padding: 0, border: 'none', background: 'none' }}
              onClick={() => onMove({ kind: 'lose', idx: c.idx })}
              title={`Give up your ${ROLE_LABEL[c.role] || c.role}`}>
              <span className="band" style={{ display: 'flex' }}>{ROLE_GLYPHS[c.role]}</span>
              <span className="rname">{ROLE_LABEL[c.role] || c.role}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ----- exchange (Ambassador)
  if (prompt.kind === 'exchange') {
    const pool = prompt.pool || [];
    const keep = prompt.keep || 0;
    const toggle = (i: number) => {
      if (exchangeSel.includes(i)) setExchangeSel(exchangeSel.filter((x) => x !== i));
      else if (exchangeSel.length < keep) setExchangeSel([...exchangeSel, i]);
    };
    return (
      <div>
        <p className="barhead">Exchange — keep exactly {keep} card{keep === 1 ? '' : 's'}.</p>
        <p className="barsub">Chosen {exchangeSel.length} / {keep}. The rest return to the deck.</p>
        <div className="ct-pickcards">
          {pool.map((role, i) => (
            <div key={i} className={`ct-card face role-${role} ${exchangeSel.includes(i) ? 'sel' : ''}`}
              onClick={() => toggle(i)} role="button">
              <div className="band">{ROLE_GLYPHS[role]}</div>
              <div className="rname">{ROLE_LABEL[role] || role}</div>
            </div>
          ))}
        </div>
        <button className="primary" disabled={exchangeSel.length !== keep}
          onClick={() => onMove({ kind: 'exchange', keep: exchangeSel })}>
          Confirm
        </button>
      </div>
    );
  }

  return null;
}
