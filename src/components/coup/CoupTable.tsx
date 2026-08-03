import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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

// ---------------------------------------------------------------- geometry
// heads-up: you bottom-centre, rival top-centre
const SEAT_POS = [
  { x: 50, y: 78 }, // you
  { x: 50, y: 22 }, // rival
];
const railAnchor = (i: number) => ({ x: SEAT_POS[i].x, y: SEAT_POS[i].y + (i === 0 ? 12 : -12) });
const BANK = { x: 58, y: 50 };
const DECK = { x: 42, y: 50 };

// ---------------------------------------------------------------- effects diff
interface Flyer { id: number; kind: 'coin' | 'card' | 'deadcard'; role?: string; fromX: number; fromY: number; tx: number; ty: number; delay: number }
interface StepFx { flyers: Flyer[]; shake: Record<number, boolean>; deckWiggle: boolean; missFlash: boolean }

let flyerSeq = 1;

function computeFx(prev: GameView, cur: GameView, log: Log | null | undefined, W: number, H: number): StepFx {
  const px = (p: { x: number; y: number }) => ({ x: (p.x / 100) * W, y: (p.y / 100) * H });
  const flyers: Flyer[] = [];
  const shake: Record<number, boolean> = {};
  let deckWiggle = false, missFlash = false;

  const fly = (kind: Flyer['kind'], from: { x: number; y: number }, to: { x: number; y: number }, n: number, role?: string) => {
    const a = px(from), b = px(to);
    for (let i = 0; i < n; i++) {
      flyers.push({ id: flyerSeq++, kind, role, fromX: a.x, fromY: a.y, tx: b.x - a.x, ty: b.y - a.y, delay: i * 90 });
    }
  };

  // steal: single victim → thief transfer (don't double-count it as bank moves)
  const stole = log && log.t === 'stole';
  const sA = stole ? seatIdx(log!.actor) : -1;
  const sT = stole ? seatIdx(log!.target) : -1;
  if (stole && SEAT_POS[sA] && SEAT_POS[sT]) fly('coin', SEAT_POS[sT], SEAT_POS[sA], Math.min(Number(log!.amount) || 1, 6));

  for (let i = 0; i < cur.players.length && i < SEAT_POS.length; i++) {
    if (i !== sA && i !== sT) {
      const d = cur.players[i].coins - prev.players[i].coins;
      if (d > 0) fly('coin', BANK, SEAT_POS[i], Math.min(d, 6));
      else if (d < 0) fly('coin', SEAT_POS[i], BANK, Math.min(-d, 6));
    }
    // an influence just died → its card flies from the hand to the graveyard rail
    const gNow = cur.players[i].graveyard;
    const gBefore = prev.players[i].graveyard;
    if (gNow.length > gBefore.length) {
      shake[i] = true;
      fly('deadcard', SEAT_POS[i], railAnchor(i), 1, gNow[gNow.length - 1]);
    }
  }

  // MISS! — the revealed hand goes back to the deck (shuffled)
  if (log && log.t === 'miss') {
    missFlash = true;
    const i = seatIdx(log.target);
    if (SEAT_POS[i]) {
      deckWiggle = true;
      const n = cur.players[i] ? Math.max(1, cur.players[i].cards.length) : 2;
      fly('card', SEAT_POS[i], DECK, n);
    }
  }
  // redraw (post-miss) — fresh cards slide from the deck to the player
  if (log && log.t === 'redraw') {
    const i = seatIdx(log.player);
    if (SEAT_POS[i]) {
      deckWiggle = true;
      const n = cur.players[i] ? Math.max(1, cur.players[i].cards.length) : 2;
      fly('card', DECK, SEAT_POS[i], n);
    }
  }
  // exchange (Ambassador)
  if (log && log.t === 'exchanged') {
    const i = seatIdx(log.player);
    if (SEAT_POS[i]) { deckWiggle = true; fly('card', DECK, SEAT_POS[i], 2); }
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

function LifeRail({ graveyard, you }: { graveyard: string[]; you: boolean }) {
  const remaining = Math.max(0, 5 - graveyard.length);
  return (
    <div className="ct-rail" title={`${remaining} of 5 lives`} data-you={you ? '1' : '0'}>
      {graveyard.map((role, i) => (
        <div className="ct-slot lost" key={`d${i}`}><CardFace role={role} mini dead /></div>
      ))}
      {Array.from({ length: remaining }).map((_, i) => (
        <div className="ct-slot life" key={`l${i}`}>♥</div>
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
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [fx, setFx] = useState<StepFx>({ flyers: [], shake: {}, deckWiggle: false, missFlash: false });
  const talkRef = useRef<HTMLDivElement>(null);
  const lastKey = useRef(-1);

  useLayoutEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const reduced = typeof window !== 'undefined'
    && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    if (animKey === lastKey.current) return;
    lastKey.current = animKey;
    if (!animate || !prevView || reduced || box.w === 0) { setFx({ flyers: [], shake: {}, deckWiggle: false, missFlash: false }); return; }
    setFx(computeFx(prevView, view, stepLog, box.w, box.h));
    const t = setTimeout(() => setFx({ flyers: [], shake: {}, deckWiggle: false, missFlash: false }), 1100);
    return () => clearTimeout(t);
  }, [animKey, animate, prevView, view, stepLog, box.w, box.h, reduced]);

  useEffect(() => {
    if (talkRef.current) talkRef.current.scrollTop = talkRef.current.scrollHeight;
  }, [talk.length]);

  return (
    <div className="ct-wrap">
      <div className="ct-main">
        <div className="ct-board heads-up" ref={boardRef}>
          <div className="ct-felt" />

          {banner && (
            <div className={`ct-banner t-${banner.tone}`}>
              {banner.lead && <span className="lead">{banner.lead}</span>}
              {banner.text}
            </div>
          )}

          {/* centre: deck + treasury */}
          <div className="ct-center">
            <div className={`ct-deck ${fx.deckWiggle ? 'wiggle' : ''}`}>
              <div className="ct-card back d1" />
              <div className="ct-card back d2" />
              <div className="ct-card back" />
              <div className="ct-count">{view.deckCount} in deck</div>
            </div>
            <div className="ct-bank">
              {Array.from({ length: 5 }).map((_, i) => <div key={i} className="ct-coin" />)}
              <div className="ct-bank-lbl">Treasury</div>
            </div>
          </div>

          {/* seats */}
          {view.players.map((p, i) => {
            const pos = SEAT_POS[i];
            if (!pos) return null;
            const isTurn = view.turn === p.id && !view.winner;
            const you = i === youIndex;
            const dead = !p.alive;
            return (
              <div key={p.id}
                className={`ct-seat s${i} ${isTurn ? 'turn' : ''} ${you ? 'you' : ''} ${dead ? 'dead' : ''} ${fx.shake[i] ? 'shake' : ''}`}>
                <div className="ct-plate">
                  {isTurn && <span className="ct-crown">▸</span>}
                  <span className="nm">{seatNames[i]}</span>
                  {dead && <span className="ct-fallen">fallen</span>}
                </div>
                <div className="ct-mid">
                  <div className="ct-seatcards">
                    <div className="ct-hand">
                      {p.cards.map((c, ci) => (
                        c.role ? <CardFace key={ci} role={c.role} /> : <div key={ci} className="ct-card back" />
                      ))}
                    </div>
                  </div>
                  <CoinStack coins={p.coins} />
                </div>
                <LifeRail graveyard={p.graveyard} you={you} />
              </div>
            );
          })}

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

          {overlay && <div className="ct-overlay">{overlay}</div>}
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
