import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { GameView } from './api';
import { ROLE_GLYPHS, ROLE_LABEL, ACTION_LABEL } from './api';
import './table.css';

// ---------------------------------------------------------------- log → text
export type Tone = 'action' | 'challenge' | 'block' | 'kill' | 'win' | 'info';
export interface TalkLine { text: string; lead?: string; tone: Tone }

type Log = Record<string, unknown>;

const ROLE_UP = (r: unknown) => (ROLE_LABEL[String(r)] || String(r || '')).toUpperCase();

/** Turn one engine log entry into a friendly bit of "table talk". */
export function describe(log: Log | null | undefined, seatNames: string[]): TalkLine | null {
  if (!log) return null;
  const nm = (id: unknown) => {
    const s = String(id ?? '');
    const i = s.startsWith('p') ? Number(s.slice(1)) : NaN;
    return Number.isInteger(i) ? (seatNames[i] ?? s) : s;
  };
  switch (log.t) {
    case 'action': {
      const who = nm(log.player);
      const tgt = log.target ? nm(log.target) : null;
      switch (log.action) {
        case 'income': return { lead: who, text: ' takes Income (+1 coin).', tone: 'action' };
        case 'foreign_aid': return { lead: who, text: ' reaches for Foreign Aid (+2).', tone: 'action' };
        case 'tax': return { lead: who, text: ' claims the DUKE and taxes for 3.', tone: 'action' };
        case 'exchange': return { lead: who, text: ' claims the AMBASSADOR to exchange cards.', tone: 'action' };
        case 'steal': return { lead: who, text: ` claims the CAPTAIN to steal from ${tgt}.`, tone: 'action' };
        case 'assassinate': return { lead: who, text: ` sends an ASSASSIN after ${tgt}.`, tone: 'kill' };
        case 'coup': return { lead: who, text: ` launches a COUP on ${tgt}!`, tone: 'kill' };
        default: return { lead: who, text: ` does ${String(log.action)}.`, tone: 'action' };
      }
    }
    case 'nochallenge':
      return { text: `Nobody challenges the ${ROLE_UP(log.role)} claim.`, tone: 'info' };
    case 'challenge': {
      const truthful = !!log.truthful;
      return {
        lead: 'CHALLENGE!',
        text: ` ${nm(log.by)} doubts ${nm(log.against)}'s ${ROLE_UP(log.role)}${truthful ? ' — but it was real.' : ' — a bluff!'}`,
        tone: 'challenge',
      };
    }
    case 'block':
      return { lead: nm(log.player), text: ` claims the ${ROLE_UP(log.role)} to block the ${ACTION_LABEL[String(log.action)] || log.action}.`, tone: 'block' };
    case 'blocked':
      return { lead: 'BLOCKED.', text: ` The ${ACTION_LABEL[String(log.action)] || log.action} is stopped by ${nm(log.by)}.`, tone: 'block' };
    case 'stole':
      return { lead: nm(log.actor), text: ` pockets ${log.amount} coin${Number(log.amount) === 1 ? '' : 's'} from ${nm(log.target)}.`, tone: 'action' };
    case 'exchanged':
      return { lead: nm(log.player), text: ' swaps cards with the court deck.', tone: 'info' };
    case 'lost': {
      const who = nm(log.player);
      const out = !!log.out;
      return {
        lead: who,
        text: ` loses the ${ROLE_UP(log.role)}${out ? ' and is OUT of the game.' : '.'}`,
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
// seat centres as % of the board box; index === seat index
const SEAT_POS = [
  { x: 50, y: 84 }, // you (bottom centre)
  { x: 13, y: 60 },
  { x: 22, y: 24 },
  { x: 78, y: 24 },
  { x: 87, y: 60 },
];
const BANK = { x: 56, y: 50 };
const DECK = { x: 44, y: 50 };

// ---------------------------------------------------------------- effects diff
interface Flyer { id: number; kind: 'coin' | 'card'; fromX: number; fromY: number; tx: number; ty: number; delay: number }
interface SeatPulse { flip?: boolean; shake?: boolean }
interface StepFx { flyers: Flyer[]; pulses: Record<number, SeatPulse>; deckWiggle: boolean }

let flyerSeq = 1;

function computeFx(prev: GameView, cur: GameView, log: Log | null | undefined, W: number, H: number): StepFx {
  const px = (p: { x: number; y: number }) => ({ x: (p.x / 100) * W, y: (p.y / 100) * H });
  const flyers: Flyer[] = [];
  const pulses: Record<number, SeatPulse> = {};
  let deckWiggle = false;

  const coin = (from: { x: number; y: number }, to: { x: number; y: number }, n: number) => {
    const a = px(from), b = px(to);
    for (let i = 0; i < Math.min(n, 6); i++) {
      flyers.push({ id: flyerSeq++, kind: 'coin', fromX: a.x, fromY: a.y, tx: b.x - a.x, ty: b.y - a.y, delay: i * 70 });
    }
  };

  // steal: single transfer victim → thief (handled off the log so we don't
  // double-count it as two bank transfers)
  const stole = log && log.t === 'stole';
  const stoleActor = stole ? Number(String(log!.actor).slice(1)) : -1;
  const stoleTarget = stole ? Number(String(log!.target).slice(1)) : -1;
  if (stole && SEAT_POS[stoleActor] && SEAT_POS[stoleTarget]) {
    coin(SEAT_POS[stoleTarget], SEAT_POS[stoleActor], Number(log!.amount) || 1);
  }

  for (let i = 0; i < cur.players.length && i < SEAT_POS.length; i++) {
    if (i === stoleActor || i === stoleTarget) continue;
    const d = cur.players[i].coins - prev.players[i].coins;
    if (d > 0) coin(BANK, SEAT_POS[i], d);
    else if (d < 0) coin(SEAT_POS[i], BANK, -d);

    // an influence just got revealed → flip + shake that seat
    const revNow = cur.players[i].cards.filter((c) => c.revealed).length;
    const revBefore = prev.players[i].cards.filter((c) => c.revealed).length;
    if (revNow > revBefore) pulses[i] = { ...pulses[i], flip: true };
  }

  // exchange: deck shuffle + two cards slide from the deck to the player
  if (log && log.t === 'exchanged') {
    const i = Number(String(log.player).slice(1));
    if (SEAT_POS[i]) {
      deckWiggle = true;
      const a = px(DECK), b = px(SEAT_POS[i]);
      for (let k = 0; k < 2; k++) {
        flyers.push({ id: flyerSeq++, kind: 'card', fromX: a.x, fromY: a.y, tx: b.x - a.x, ty: b.y - a.y, delay: k * 130 });
      }
    }
  }

  // a coup/assassinate hit: shake the target seat (log tells us who)
  if (log && (log.t === 'lost')) {
    const i = Number(String(log.player).slice(1));
    if (SEAT_POS[i]) pulses[i] = { ...pulses[i], shake: true };
  }

  return { flyers, pulses, deckWiggle };
}

// ---------------------------------------------------------------- card view
function CardFace({ role, dead, flip }: { role: string; dead: boolean; flip?: boolean }) {
  return (
    <div className={`ct-card face role-${role} ${dead ? 'dead' : ''} ${flip ? 'flip' : ''}`}>
      <div className="band">{ROLE_GLYPHS[role] || '?'}</div>
      <div className="rname">{ROLE_LABEL[role] || role}</div>
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
  const [fx, setFx] = useState<StepFx>({ flyers: [], pulses: {}, deckWiggle: false });
  const talkRef = useRef<HTMLDivElement>(null);
  const lastKey = useRef(-1);

  // measure the board so flyer geometry is in real pixels
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

  // fire animations when a new step lands
  useEffect(() => {
    if (animKey === lastKey.current) return;
    lastKey.current = animKey;
    if (!animate || !prevView || reduced || box.w === 0) { setFx({ flyers: [], pulses: {}, deckWiggle: false }); return; }
    const next = computeFx(prevView, view, stepLog, box.w, box.h);
    setFx(next);
    const t = setTimeout(() => setFx({ flyers: [], pulses: {}, deckWiggle: false }), 1000);
    return () => clearTimeout(t);
  }, [animKey, animate, prevView, view, stepLog, box.w, box.h, reduced]);

  // auto-scroll table talk to newest
  useEffect(() => {
    if (talkRef.current) talkRef.current.scrollTop = talkRef.current.scrollHeight;
  }, [talk.length]);

  return (
    <div className="ct-wrap">
      <div className="ct-main">
        <div className="ct-board" ref={boardRef}>
          <div className="ct-felt" />

          {banner && (
            <div className={`ct-banner t-${banner.tone}`}>
              {banner.lead && <span className="lead">{banner.lead}</span>}
              {banner.text}
            </div>
          )}

          {/* centre: deck + coin bank */}
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
            const dead = !p.alive;
            const isTurn = view.turn === p.id && !view.winner;
            const pulse = fx.pulses[i] || {};
            return (
              <div key={p.id}
                className={`ct-seat s${i} ${dead ? 'dead' : ''} ${isTurn ? 'turn' : ''} ${i === youIndex ? 'you' : ''} ${pulse.shake ? 'shake' : ''}`}>
                <div className="ct-plate">
                  {isTurn && <span className="ct-crown">▸</span>}
                  <span className="nm">{seatNames[i]}</span>
                </div>
                <div className="ct-seatcards">
                  {dead && <div className="ct-out">OUT</div>}
                  <div className="ct-hand">
                    {p.cards.map((c, ci) => (
                      c.role
                        ? <CardFace key={ci} role={c.role} dead={c.revealed} flip={!!pulse.flip && c.revealed} />
                        : <div key={ci} className="ct-card back" />
                    ))}
                  </div>
                </div>
                <CoinStack coins={p.coins} />
              </div>
            );
          })}

          {/* flyers */}
          <div className="ct-fxlayer">
            {fx.flyers.map((f) => (
              <div key={f.id}
                className={`ct-flyer ${f.kind === 'card' ? 'card' : ''}`}
                style={{
                  left: f.fromX, top: f.fromY,
                  animationDelay: `${f.delay}ms`,
                  ['--tx' as string]: `${f.tx}px`,
                  ['--ty' as string]: `${f.ty}px`,
                }}>
                {f.kind === 'coin' && <div className="ct-coin" />}
              </div>
            ))}
          </div>

          {overlay && <div className="ct-overlay">{overlay}</div>}
        </div>
      </div>

      <div className="ct-talk">
        <h3>Table talk</h3>
        <div className="lines" ref={talkRef}>
          {talk.length === 0 && <div className="ct-line">The court awaits its first move…</div>}
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

function CoinStack({ coins }: { coins: number }) {
  const left = Math.min(coins, 5);
  const right = coins > 5 ? Math.min(coins - 5, 5) : 0;
  return (
    <div className="ct-coinstack" title={`${coins} coins`}>
      {coins > 0 && (
        <>
          <div className="ct-stackcol">
            {Array.from({ length: left }).map((_, i) => <div key={i} className="ct-coin" />)}
          </div>
          {right > 0 && (
            <div className="ct-stackcol">
              {Array.from({ length: right }).map((_, i) => <div key={i} className="ct-coin" />)}
            </div>
          )}
        </>
      )}
      <span className="ct-coinchip">{coins}</span>
    </div>
  );
}
