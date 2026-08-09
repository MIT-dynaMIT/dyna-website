/** API client + shared types for the dynaCOUP camp pages. */

export interface CoupUser { username: string; displayName: string; isAdmin: boolean }

export interface BotSlot {
  name: string;
  mode: 'blocks' | 'python';
  blocksJson: unknown;
  python: string;
  updatedAt: number;
}

export interface LeaderRow {
  rank: number; id: string; name: string; owner: string; isHouse: boolean;
  elo: number; games: number; winRate: number;
}

export interface MySub {
  id: string; name: string; slot: number; elo: number; games: number;
  winRate: number; lastN: number; errors: number; rank: number;
}

// A ladder pairing is a SERIES of games, scored as a whole; ELO moves once per
// series on the score fraction. `turns` is the per-game average.
export interface MatchRow {
  id: string; ts: number; myBot: string; win: boolean; winnerName: string;
  players: string[]; owners: string[]; eloDelta: number; turns: number; adjudicated: boolean;
  series?: boolean;
  gamesTotal?: number;
  score?: Record<string, number>;   // wins per bot name
  winStrip?: string;                // one char per game, '1' = players[0] won it
  sampleGames?: number[];           // game numbers that have a stored replay
}

export interface SeriesInfo {
  game: number; gamesTotal: number;
  score: Record<string, number>;
  winStrip: string;
  samples: number[];      // game numbers with replays; index into this is the ?sample= arg
  sampleIndex: number;
}

export interface CardView { revealed: boolean; role: string | null }
// Heads-up "Ultimate" variant: two players, four lives each. A dead card moves
// to the graveyard (face-up) and is always replaced — hands stay at 2 cards
// until the 4th death ends the game. lives + graveyard.length = the total.
export interface PlayerView {
  id: string; coins: number; alive: boolean;
  lives: number; graveyard: string[]; cards: CardView[];
}
export interface GameView {
  players: PlayerView[];
  turn: string | null;
  winner: string | null;
  deckCount: number;
  pending: {
    type: string; player?: string; who?: string[]; roles?: string[];
    claim?: { player: string; role: string }; action?: string;
    call?: string; reason?: 'ambassador' | 'miss';
    mustCoup?: boolean; why?: string; keep?: number; pool?: string[];
  } | null;
  ctx: { type: string; actor: string; target: string | null; call?: string | null } | null;
}
export interface Frame { log: Record<string, unknown>; view: GameView }

export interface Prompt {
  kind: 'action' | 'respond' | 'lose' | 'exchange';
  // call = true for coup/assassinate: the player must NAME a character
  actions?: { type: string; targets: string[]; call?: boolean }[];
  mustCoup?: boolean;
  mode?: 'challenge' | 'block';
  action?: {
    type: string; actor: string; target: string | null;
    is_block: boolean; claimed_role: string | null; blocker?: string;
    call?: string | null;
  };
  options?: string[];
  assassination?: boolean;
  why?: string;
  cards?: { idx: number; role: string }[];
  pool?: string[];
  keep?: number;
  reason?: 'ambassador' | 'miss';
}

export interface PlaySnapshot {
  id: string; seatNames: string[]; you: string;
  view: GameView; frames: Frame[]; cursor: number;
  prompt: Prompt | null; done: boolean; winnerName: string | null;
}

export interface CheckResult {
  ok: boolean;
  problems: { fn?: string; line?: number; message: string }[];
  notes: string[];
  functions?: { fn: string; status: 'ok' | 'default' | 'error' }[];
}

// ------------------------------------------------------------------

const TOKEN_KEY = 'coup_token';
const USER_KEY = 'coup_user';

export function getToken(): string | null { return localStorage.getItem(TOKEN_KEY); }
export function getStoredUser(): CoupUser | null {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
}
export function storeAuth(token: string, user: CoupUser) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}
export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`/api/coup${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // an expired/invalidated session (e.g. after a server reseed) should bounce
    // straight back to the login screen, not strand pages on their spinners —
    // but never reload on a failed login attempt itself
    if (res.status === 401 && !path.startsWith('/login')) {
      clearAuth();
      window.location.reload();
    }
    throw new ApiError((data as { error?: string }).error || `request failed (${res.status})`, res.status);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => req<T>('GET', path),
  post: <T>(path: string, body?: unknown) => req<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => req<T>('PUT', path, body),
};

// The four characters of the heads-up variant — no Captain, 3 copies each.
// Anything that offers a role choice (the call picker) maps over this.
export const ROLES_IN_PLAY = ['duke', 'assassin', 'ambassador', 'contessa'] as const;

export const ROLE_GLYPHS: Record<string, string> = {
  duke: '♛', assassin: '†', captain: '⚓', ambassador: '⚜', contessa: '❦',
};
export const ROLE_LABEL: Record<string, string> = {
  duke: 'Duke', assassin: 'Assassin', captain: 'Captain', ambassador: 'Ambassador', contessa: 'Contessa',
};
export const ACTION_LABEL: Record<string, string> = {
  income: 'Income', foreign_aid: 'Foreign Aid', coup: 'Coup', tax: 'Tax',
  assassinate: 'Assassinate', steal: 'Steal', exchange: 'Exchange',
};

// The server default (server/scrim.js, overridable there via COUP_SERIES_GAMES).
// Only safe for static copy — anything rendering real data must read gamesTotal
// off the payload, since a series may have been played at another length.
export const SERIES_GAMES = 100;

/** Re-cut a win strip so '1' means the bot you're looking at won that game. */
export function orientStrip(strip: string, flip: boolean): string {
  if (!flip) return strip;
  return strip.replace(/[01]/g, (c) => (c === '1' ? '0' : '1'));
}

/** Whose wins the '1's are: the bot whose series score equals the number of 1s.
 *  A drawn series is ambiguous, and then either name gives the same tally, so
 *  fall back to the first scored name (the series' seat 0). */
export function stripOwner(strip: string, score: Record<string, number>): string {
  const names = Object.keys(score);
  const ones = (strip.match(/1/g) || []).length;
  return names.find((n) => score[n] === ones) ?? names[0] ?? '';
}

export function timeAgo(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
