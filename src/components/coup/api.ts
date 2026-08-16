/** API client + shared types for the dynaCOUP camp pages. */

export interface CoupUser { username: string; displayName: string; isAdmin: boolean }

export interface BotSlot {
  name: string;
  mode: 'blocks' | 'python';
  blocksJson: unknown;
  python: string;
  updatedAt: number;
}

// A bot match is a BEST OF 5: five 100-game series, the match going to
// whoever takes more series. Everything is recorded from players[0]'s side.
export interface MatchRow {
  id: string; ts: number;
  mode: 'gauntlet' | 'botduel';
  level: number | null;             // gauntlet: which house level (0-based)
  players: [string, string];        // bot names
  owners: [string, string];         // usernames ('house' for house bots)
  ownerNames: [string, string];
  score: [number, number];          // series won, out of 5 (draws count for neither)
  winnerName: string | null;        // null = drawn match
  gamesPerSeries: number;
  series: { winsA: number; winsB: number }[];
  mine: number;                     // my index in players/owners (-1 for admin spectating)
}

export interface PendingJob {
  id: string; mode: 'gauntlet' | 'botduel'; level: number | null;
  players: [string, string]; owners: [string, string]; ownerNames: [string, string];
  status: 'queued' | 'running' | 'failed'; ts: number; error: string | null;
}

export interface MatchesData { matches: MatchRow[]; pending: PendingJob[] }

export interface GauntletData {
  levels: { level: number; name: string }[];
  seriesCount: number;
  seriesGames: number;
  selected: { slot: number; name: string } | null;
  pending: PendingJob[];
}

export interface ReplayMatchInfo {
  mode: 'gauntlet' | 'botduel'; level: number | null;
  players: [string, string]; ownerNames: [string, string];
  score: [number, number]; matchWinner: string | null; gamesPerSeries: number;
  seriesIndex: number;
  seriesScores: [number, number][];
  winStrip: string;                 // this series, from players[0]'s side
  browsable: boolean;               // true → any game can be re-dealt on demand
  samples: number[];                // game numbers stored verbatim (instant)
  game: number;                     // the game number being watched
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

// live human-vs-human (+ bot-battle challenges)
export interface LiveOnlineUser { username: string; displayName: string; role: string }
export interface LivePollData {
  online: LiveOnlineUser[];
  invite: { from: string; fromName: string; kind: 'duel' | 'bots' } | null;
  match: string | null;
}
export interface LiveSnapshot extends PlaySnapshot {
  youIndex: number;
  waitingFor: string | null;
  forfeited: boolean;
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
  const data = await res.json().catch(() => null);
  // a static host with no backend answers API routes with empty/HTML bodies —
  // surface that clearly instead of pretending the login was wrong
  if (data === null) {
    throw new ApiError('Cannot reach the game server from this page — ask a mentor for the right address.', 0);
  }
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

// The server defaults (server/arena.js). Only safe for static copy — anything
// rendering real data must read gamesPerSeries off the payload.
export const SERIES_GAMES = 100;
export const SERIES_COUNT = 5;

/** Re-cut a win strip so '1' means the bot you're looking at won that game. */
export function orientStrip(strip: string, flip: boolean): string {
  if (!flip) return strip;
  return strip.replace(/[01]/g, (c) => (c === '1' ? '0' : '1'));
}

export function timeAgo(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
