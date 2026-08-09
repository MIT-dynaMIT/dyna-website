import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { GameView } from './api';
import { ROLE_GLYPHS, ROLE_LABEL, ACTION_LABEL } from './api';
import './table.css';

// ---------------------------------------------------------------- log → text
export type Tone = 'action' | 'challenge' | 'block' | 'kill' | 'miss' | 'win' | 'info';
export interface TalkLine { text: string; lead?: string; tone: Tone }

type Log = Record<string, unknown>;

const ROLE_UP = (r: unknown) => (ROLE_LABEL[String(r)] || String(r || '')).toUpperCase();
const seatIdx = (id: unknown) => {
  const s = String(id ?? '');
  return s.startsWith('p') ? Number(s.slice(1)) : NaN;
};

/** Turn one engine log entry into a friendly bit of "table talk". */
export function describe(log: Log | null | undefined, seatNames: string[]): TalkLine | null {
  if (!log) return null;
  const nm = (id: unknown) => {
    const i = seatIdx(id);
    return Number.isInteger(i) ? (seatNames[i] ?? String(id)) : String(id ?? '');
  };
  switch (log.t) {
    case 'action': {
      const who = nm(log.player);
      switch (log.action) {
        case 'income': return { lead: who, text: ' takes Income (+1 coin).', tone: 'action' };
        case 'foreign_aid': return { lead: who, text: ' reaches for Foreign Aid (+2).', tone: 'action' };
        case 'tax': return { lead: who, text: ' claims the DUKE and taxes for 3.', tone: 'action' };
        case 'exchange': return { lead: who, text: ' claims the AMBASSADOR to exchange cards.', tone: 'action' };
        case 'steal': return { lead: who, text: ' claims the CAPTAIN to steal.', tone: 'action' };
        case 'assassinate': return { lead: who, text: ` pays 3 and sends an ASSASSIN, calling the ${ROLE_UP(log.call)}.`, tone: 'kill' };
        case 'coup': return { lead: who, text: ` pays 7 and launches a COUP, calling the ${ROLE_UP(log.call)}!`, tone: 'kill' };
        default: return { lead: who, text: ` does ${String(log.action)}.`, tone: 'action' };
      }
    }
    case 'nochallenge':
      return { text: `The ${ROLE_UP(log.role)} claim goes unchallenged.`, tone: 'info' };
    case 'challenge':
      return {
        lead: 'CHALLENGE!',
        text: ` ${nm(log.by)} doubts ${nm(log.against)}'s ${ROLE_UP(log.role)}${log.truthful ? ' — but it was real.' : ' — a bluff!'}`,
        tone: 'challenge',
      };
    case 'block':
      return { lead: nm(log.player), text: ` claims the ${ROLE_UP(log.role)} to block the ${ACTION_LABEL[String(log.action)] || log.action}.`, tone: 'block' };
    case 'blocked':
      return { lead: 'BLOCKED.', text: ` The ${ACTION_LABEL[String(log.action)] || log.action} is stopped by ${nm(log.by)}.`, tone: 'block' };
    case 'stole':
      return { lead: nm(log.actor), text: ` pockets ${log.amount} coin${Number(log.amount) === 1 ? '' : 's'} from ${nm(log.target)}.`, tone: 'action' };
    case 'hit':
      return { lead: 'CALLED IT!', text: ` ${nm(log.actor)} names the ${ROLE_UP(log.call)} — ${nm(log.target)} loses it.`, tone: 'kill' };
    case 'miss': {
      const shown = Array.isArray(log.revealed) ? (log.revealed as string[]).map((r) => ROLE_LABEL[r] || r).join(', ') : '';
      return { lead: 'MISS!', text: ` ${nm(log.target)} has no ${ROLE_UP(log.call)} — hand shown: ${shown}. It goes back to the deck and they draw a fresh hand.`, tone: 'miss' };
    }
    case 'redraw':
      return { lead: nm(log.player), text: ' is dealt a fresh hand.', tone: 'info' };
    case 'exchanged':
      return {
        lead: nm(log.player),
        text: log.reason === 'miss' ? ' redraws a fresh hand after the miss.' : ' swaps cards with the court deck.',
        tone: 'info',
      };
    case 'lost': {
      const who = nm(log.player);
      const out = !!log.out;
      const lives = Number(log.lives);
      return {
        lead: who,
        text: out
          ? ` loses their last ${ROLE_UP(log.role)} and falls.`
          : ` loses the ${ROLE_UP(log.role)} — ${lives} ${lives === 1 ? 'life' : 'lives'} left.`,
        tone: 'kill',
      };
    }
    case 'win':
      return { lead: '♛ ' + nm(log.player), text: ` rules the court!${log.adjudicated ? ' (by the judges)' : ''}`, tone: 'win' };
    default:
      return null;
  }
}

// ---------------------------------------------------------------- effects diff
type Pt = { x: number; y: number };
interface Anchors { seat: (i: number) => Pt | null; rail: (i: number) => Pt | null; bank: Pt | null; deck: Pt | null }
interface Flyer { id: number; kind: 'coin' | 'card' | 'deadcard'; role?: string; fromX: number; fromY: number; tx: number; ty: number; delay: number }
interface StepFx { flyers: Flyer[]; shake: Record<number, boolean>; deckWiggle: boolean; missFlash: boolean }

let flyerSeq = 1;

/** Diff two views (+ the newest log) into a set of transient board effects.
 *  Positions come from the live DOM (A), so the flow layout can move freely. */
function computeFx(prev: GameView, cur: GameView, log: Log | null | undefined, A: Anchors): StepFx {
  const flyers: Flyer[] = [];
  const shake: Record<number, boolean> = {};
  let deckWiggle = false, missFlash = false;

  const fly = (kind: Flyer['kind'], from: Pt | null, to: Pt | null, n: number, role?: string) => {
    if (!from || !to) return;
    for (let i = 0; i < n; i++) {
      flyers.push({ id: flyerSeq++, kind, role, fromX: from.x, fromY: from.y, tx: to.x - from.x, ty: to.y - from.y, delay: i * 90 });
    }
  };

  // steal: single victim → thief transfer (don't double-count it as bank moves)
  const stole = log && log.t === 'stole';
  const sA = stole ? seatIdx(log!.actor) : -1;
  const sT = stole ? seatIdx(log!.target) : -1;
  if (stole) fly('coin', A.seat(sT), A.seat(sA), Math.min(Number(log!.amount) || 1, 6));

  for (let i = 0; i < cur.players.length; i++) {
    if (i !== sA && i !== sT) {
      const d = cur.players[i].coins - prev.players[i].coins;
      if (d > 0) fly('coin', A.bank, A.seat(i), Math.min(d, 6));
      else if (d < 0) fly('coin', A.seat(i), A.bank, Math.min(-d, 6));
    }
    // an influence just died → its card flies from the hand to the graveyard rail
    const gNow = cur.players[i].graveyard;
    const gBefore = prev.players[i].graveyard;
    if (gNow.length > gBefore.length) {
      shake[i] = true;
      fly('deadcard', A.seat(i), A.rail(i), 1, gNow[gNow.length - 1]);
    }
  }

  // MISS! — the revealed hand goes back to the deck (shuffled)
  if (log && log.t === 'miss') {
    missFlash = true;
    const i = seatIdx(log.target);
    deckWiggle = true;
    fly('card', A.seat(i), A.deck, cur.players[i] ? Math.max(1, cur.players[i].cards.length) : 2);
  }
  // redraw (post-miss) — fresh cards slide from the deck to the player
  if (log && log.t === 'redraw') {
    const i = seatIdx(log.player);
    deckWiggle = true;
    fly('card', A.deck, A.seat(i), cur.players[i] ? Math.max(1, cur.players[i].cards.length) : 2);
  }
  // exchange (Ambassador)
  if (log && log.t === 'exchanged') {
    const i = seatIdx(log.player);
    deckWiggle = true;
    fly('card', A.deck, A.seat(i), 2);
  }

  return { flyers, shake, deckWiggle, missFlash };
}

// ---------------------------------------------------------------- pieces
function CardFace({ role, mini, dead }: { role: string; mini?: boolean; dead?: boolean }) {
  return (
    <div className={`ct-card face role-${role} ${mini ? 'mini' : ''} ${dead ? 'dead' : ''}`}>
      <div className="band">{ROLE_GLYPHS[role] || '?'}</div>
      {!mini && <div className="rname">{ROLE_LABEL[role] || role}</div>}
    </div>
  );
}

function LifeRail({ lives, graveyard, innerRef }: {
  lives: number; graveyard: string[]; innerRef?: (el: HTMLDivElement | null) => void;
}) {
  const remaining = Math.max(0, lives);
  const total = remaining + graveyard.length;
  return (
    <div className="ct-rail" ref={innerRef} title={`${remaining} of ${total} lives`}>
      {graveyard.map((role, i) => (
        <div className="ct-slot lost" key={`d${i}`}><CardFace role={role} mini dead /></div>
      ))}
      {Array.from({ length: remaining }).map((_, i) => (
        <div className="ct-slot life" key={`l${i}`}>♥</div>
      ))}
    </div>
  );
}

/** One tick per game of a series, left to right. '1' = a win for whoever the
 *  strip has been oriented to. `highlight` is a 1-based game number. */
export function WinStrip({ strip, highlight, title }: {
  strip: string; highlight?: number; title?: string;
}) {
  return (
    <div className="ct-strip" title={title}>
      {Array.from(strip).map((c, i) => (
        <span key={i} className={`tick ${c === '1' ? 'w' : 'l'} ${highlight === i + 1 ? 'on' : ''}`} />
      ))}
    </div>
  );
}

function CoinStack({ coins }: { coins: number }) {
  const left = Math.min(coins, 5);
  const right = coins > 5 ? Math.min(coins - 5, 5) : 0;
  return (
    <div className="ct-coinstack" title={`${coins} coins`}>
      {coins > 0 && (
        <>
          <div className="ct-stackcol">{Array.from({ length: left }).map((_, i) => <div key={i} className="ct-coin" />)}</div>
          {right > 0 && <div className="ct-stackcol">{Array.from({ length: right }).map((_, i) => <div key={i} className="ct-coin" />)}</div>}
        </>
      )}
      <span className="ct-coinchip">{coins}</span>
    </div>
  );
}

// ---------------------------------------------------------------- props
export interface CoupTableProps {
  seatNames: string[];
  view: GameView;
  prevView?: GameView | null;
  youIndex?: number;
  stepLog?: Log | null;
  animate?: boolean;
  animKey?: number;
  banner?: TalkLine | null;
  talk?: TalkLine[];
  overlay?: ReactNode;
}

export default function CoupTable({
  seatNames, view, prevView, youIndex = 0, stepLog,
  animate = false, animKey = 0, banner, talk = [], overlay,
}: CoupTableProps) {
  const boardRef = useRef<HTMLDivElement>(null);
  const deckRef = useRef<HTMLDivElement>(null);
  const bankRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Array<HTMLDivElement | null>>([]);
  const railRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [fx, setFx] = useState<StepFx>({ flyers: [], shake: {}, deckWiggle: false, missFlash: false });
  const talkRef = useRef<HTMLDivElement>(null);
  const lastKey = useRef(-1);

  const reduced = typeof window !== 'undefined'
    && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // fire animations when a new step lands — anchors are read from the live DOM
  useEffect(() => {
    if (animKey === lastKey.current) return;
    lastKey.current = animKey;
    const board = boardRef.current;
    if (!animate || !prevView || reduced || !board) {
      setFx({ flyers: [], shake: {}, deckWiggle: false, missFlash: false });
      return;
    }
    const b = board.getBoundingClientRect();
    const centerOf = (el: HTMLElement | null): Pt | null => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2 - b.left, y: r.top + r.height / 2 - b.top };
    };
    const A: Anchors = {
      seat: (i) => centerOf(cardRefs.current[i]),
      rail: (i) => centerOf(railRefs.current[i]),
      bank: centerOf(bankRef.current),
      deck: centerOf(deckRef.current),
    };
    setFx(computeFx(prevView, view, stepLog, A));
    const t = setTimeout(() => setFx({ flyers: [], shake: {}, deckWiggle: false, missFlash: false }), 1100);
    return () => clearTimeout(t);
  }, [animKey, animate, prevView, view, stepLog, reduced]);

  useEffect(() => {
    if (talkRef.current) talkRef.current.scrollTop = talkRef.current.scrollHeight;
  }, [talk.length]);

  const renderSeat = (i: number) => {
    const p = view.players[i];
    if (!p) return null;
    const isTurn = view.turn === p.id && !view.winner;
    const you = i === youIndex;
    const dead = !p.alive;
    // One horizontal band per player: name · hand · coins · life rail. The four
    // tracks are fixed width so both players' columns line up for comparison.
    return (
      <div key={p.id}
        className={`ct-seat ${isTurn ? 'turn' : ''} ${you ? 'you' : ''} ${dead ? 'dead' : ''} ${fx.shake[i] ? 'shake' : ''}`}>
        <div className="ct-plate" title={seatNames[i]}>
          <span className="nm">{seatNames[i]}</span>
          {dead && <span className="ct-fallen">fallen</span>}
        </div>
        <div className="ct-res">
          <div className="ct-seatcards" ref={(el) => { cardRefs.current[i] = el; }}>
            <div className="ct-hand">
              {p.cards.map((c, ci) => (
                c.role ? <CardFace key={ci} role={c.role} /> : <div key={ci} className="ct-card back" />
              ))}
            </div>
          </div>
          <CoinStack coins={p.coins} />
        </div>
        <LifeRail lives={p.lives} graveyard={p.graveyard} innerRef={(el) => { railRefs.current[i] = el; }} />
      </div>
    );
  };

  // rival(s) on top, you at the bottom
  const others = view.players.map((_, i) => i).filter((i) => i !== youIndex);

  return (
    <div className="ct-wrap">
      <div className="ct-main">
        <div className="ct-board" ref={boardRef}>
          <div className="ct-felt" />

          <div className="ct-flow">
            {others.map((i) => renderSeat(i))}

            {/* the banner owns a reserved lane between the bands — open felt in
                the middle of a table reads naturally, and it can never land on
                a name plate */}
            <div className="ct-lane">
              {banner && (
                <div className={`ct-banner t-${banner.tone}`}>
                  {banner.lead && <span className="lead">{banner.lead}</span>}
                  {banner.text}
                </div>
              )}
            </div>

            <div className="ct-center-row">
              <div className={`ct-deck ${fx.deckWiggle ? 'wiggle' : ''}`} ref={deckRef}>
                <div className="ct-card back d1" />
                <div className="ct-card back d2" />
                <div className="ct-card back" />
                <div className="ct-count">{view.deckCount} in deck</div>
              </div>
              <div className="ct-bank" ref={bankRef}>
                {Array.from({ length: 5 }).map((_, i) => <div key={i} className="ct-coin" />)}
                <div className="ct-bank-lbl">Treasury</div>
              </div>
            </div>

            {renderSeat(youIndex)}
          </div>

          {/* flyers */}
          <div className="ct-fxlayer">
            {fx.flyers.map((f) => (
              <div key={f.id}
                className={`ct-flyer ${f.kind}`}
                style={{ left: f.fromX, top: f.fromY, animationDelay: `${f.delay}ms`, ['--tx' as string]: `${f.tx}px`, ['--ty' as string]: `${f.ty}px` }}>
                {f.kind === 'coin' && <div className="ct-coin" />}
                {f.kind === 'deadcard' && f.role && (
                  <div className={`ct-card face mini dead role-${f.role}`}><div className="band">{ROLE_GLYPHS[f.role]}</div></div>
                )}
              </div>
            ))}
          </div>

          {fx.missFlash && <div className="ct-missflash">MISS!</div>}

          {overlay && (
            <div className="ct-overlay">
              <div className="ct-plaque">{overlay}</div>
            </div>
          )}
        </div>
      </div>

      <div className="ct-talk">
        <h3>Table talk</h3>
        <div className="lines" ref={talkRef}>
          {talk.length === 0 && <div className="ct-line">The duel is about to begin…</div>}
          {talk.map((l, i) => (
            <div key={i} className={`ct-line t-${l.tone}`}>
              {l.lead && <b>{l.lead}</b>}{l.text}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
