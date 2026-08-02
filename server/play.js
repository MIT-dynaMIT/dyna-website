/**
 * play — heads-up table sessions: one human + four ScriptBots.
 * Bots answer instantly, so the whole game is driven over plain HTTP:
 * the session advances until the human must decide, then waits.
 */
'use strict';

const crypto = require('node:crypto');
const { CoupGame } = require('./coup');

class PlaySession {
  /** @param opponents [{bot: ScriptBot, name}] — exactly 1 (heads-up) */
  constructor(humanName, opponents) {
    this.id = crypto.randomBytes(8).toString('hex');
    this.createdAt = Date.now();
    this.humanId = 'p0';
    this.ids = ['p0', 'p1'];
    this.names = { p0: humanName };
    this.bots = {};
    opponents.slice(0, 1).forEach((o, i) => {
      const id = 'p' + (i + 1);
      this.names[id] = o.name;
      this.bots[id] = o.bot;
    });
    this.game = new CoupGame(this.ids);
    this.frames = [];
    this.prompt = null;
    this._logIdx = 0;
    this._polled = null;   // {key, responses: Map, humanPassed}
    this._preferReveal = null;
    this._snap();
    this.advance();
  }

  _snap() {
    while (this._logIdx < this.game.log.length) {
      this.frames.push({ log: this.game.log[this._logIdx], view: this.game.view(this.humanId) });
      this._logIdx++;
    }
  }

  _pollState() {
    const key = this.game.log.length + ':' + (this.game.pending ? this.game.pending.type : '');
    if (!this._polled || this._polled.key !== key) {
      this._polled = { key, responses: new Map(), humanPassed: false };
    }
    return this._polled;
  }

  _actionInfo() {
    const g = this.game;
    const nameOf = (id) => this.names[id];
    const info = g.ctx ? {
      type: g.ctx.type,
      actor: nameOf(g.ctx.actor),
      target: g.ctx.target ? nameOf(g.ctx.target) : null,
      call: g.ctx.call || null,
      is_block: false, claimed_role: null,
    } : null;
    if (info && g.pending && g.pending.type === 'challenge' && g.pending.claim) {
      info.claimed_role = g.pending.claim.role;
      info.is_block = !!g.pending.blocking;
      if (g.pending.blocking) info.blocker = nameOf(g.pending.claim.player);
    }
    return info;
  }

  /** run bot decisions until the human is needed (or the game ends) */
  advance() {
    const g = this.game;
    const rng = Math.random;
    let guard = 0;
    while (!g.winner && ++guard < 500) {
      const pend = g.pending;
      if (!pend) break;

      if (pend.type === 'action') {
        if (pend.player === this.humanId) {
          this.prompt = { kind: 'action', actions: g.legalActions(this.humanId).map((a) => ({
            type: a.type, targets: (a.targets || []).map((t) => this.names[t]),
            call: !!a.call,
          })), mustCoup: !!pend.mustCoup };
          return;
        }
        const id = pend.player;
        const act = this.bots[id].yourTurn(g, id, this.names, {}, rng);
        g._assassinP = act.type === 'assassinate' ? (act.p || 0) : 0;
        g.submitAction(id, act);
        this._snap();
        continue;
      }

      if (pend.type === 'challenge') {
        const poll = this._pollState();
        let challenger = null;
        // assassin's pre-committed challenge-Contessa probability
        if (pend.blocking && g.ctx && g.ctx.type === 'assassinate' && pend.claim.role === 'contessa'
          && pend.who.includes(g.ctx.actor) && g.ctx.actor !== this.humanId
          && (g._assassinP || 0) > 0 && !poll.responses.has('__p')) {
          poll.responses.set('__p', true);
          if (rng() < g._assassinP) challenger = g.ctx.actor;
        }
        if (!challenger) {
          for (const id of pend.who) {
            if (id === this.humanId) {
              if (poll.humanPassed) continue;
              this.prompt = { kind: 'respond', mode: 'challenge', action: this._actionInfo(), options: ['pass', 'challenge'] };
              return;
            }
            if (pend.blocking && g.ctx && g.ctx.type === 'assassinate' && id === g.ctx.actor) continue;
            if (!poll.responses.has(id)) {
              poll.responses.set(id, this.bots[id].respond(g, id, this.names, {}, rng, 'challenge'));
            }
            const r = poll.responses.get(id);
            if (r && r.challenge) { challenger = id; break; }
          }
        }
        g.resolveChallenge(challenger);
        this._snap();
        continue;
      }

      if (pend.type === 'block') {
        const poll = this._pollState();
        let blocker = null, role = null;
        for (const id of pend.who) {
          if (id === this.humanId) {
            if (poll.humanPassed) continue;
            const isAssassination = g.ctx.type === 'assassinate' && id === g.ctx.target;
            this.prompt = {
              kind: 'respond', mode: 'block', action: this._actionInfo(),
              options: ['pass', ...pend.roles.map((r) => 'block:' + r)],
              assassination: isAssassination,
            };
            return;
          }
          if (!poll.responses.has(id)) {
            let r;
            if (g.ctx.type === 'assassinate' && id === g.ctx.target) {
              const w = this.bots[id].whenAssassinated(g, id, this.names, {}, rng);
              r = w.block ? { block: 'contessa' } : 'pass';
            } else {
              r = this.bots[id].respond(g, id, this.names, {}, rng, 'block');
            }
            poll.responses.set(id, r);
          }
          const r = poll.responses.get(id);
          if (r && r.block) { blocker = id; role = r.block; break; }
        }
        g.resolveBlock(blocker, role);
        this._snap();
        continue;
      }

      if (pend.type === 'lose') {
        const id = pend.player;
        if (id === this.humanId) {
          const p = g.player(id);
          this.prompt = {
            kind: 'lose', why: pend.why,
            cards: p.cards.map((role, i) => ({ idx: i, role })),
          };
          return;
        }
        g.resolveLose(id, this.bots[id].chooseCardToLose(g, id, this.names, {}, rng));
        this._snap();
        continue;
      }

      if (pend.type === 'exchange') {
        const id = pend.player;
        if (id === this.humanId) {
          this.prompt = { kind: 'exchange', pool: pend.pool, keep: pend.keep, reason: pend.reason };
          return;
        }
        g.resolveExchange(id, this.bots[id].chooseExchange(g, id, this.names, {}, rng));
        this._snap();
        continue;
      }
      break;
    }
    if (!g.winner && guard >= 500) { g.adjudicate(); this._snap(); }
    this.prompt = null;
  }

  humanMove(msg) {
    const g = this.game;
    const pend = g.pending;
    if (!pend) throw new Error('game is over');
    if (msg.kind === 'action') {
      if (pend.type !== 'action' || pend.player !== this.humanId) throw new Error('not your turn');
      g._assassinP = 0; // humans challenge manually
      g.submitAction(this.humanId, { type: msg.type, call: msg.call });
    } else if (msg.kind === 'respond') {
      const poll = this._pollState();
      if (pend.type === 'challenge') {
        if (msg.what === 'challenge') { g.resolveChallenge(this.humanId); this._polled = null; }
        else { poll.humanPassed = true; }
      } else if (pend.type === 'block') {
        if (msg.what === 'block' && pend.roles.includes(msg.role)) {
          g.resolveBlock(this.humanId, msg.role); this._polled = null;
        } else { poll.humanPassed = true; }
      } else throw new Error('nothing to respond to');
    } else if (msg.kind === 'lose') {
      g.resolveLose(this.humanId, Number(msg.idx));
    } else if (msg.kind === 'exchange') {
      g.resolveExchange(this.humanId, (msg.keep || []).map(Number));
    } else {
      throw new Error('unknown move');
    }
    this._snap();
    this.prompt = null;
    this.advance();
  }

  snapshot(cursor = 0) {
    return {
      id: this.id,
      seatNames: this.ids.map((id) => this.names[id]),
      you: this.names[this.humanId],
      view: this.game.view(this.humanId),
      frames: this.frames.slice(cursor),
      cursor: this.frames.length,
      prompt: this.prompt,
      done: !!this.game.winner,
      winnerName: this.game.winner ? this.names[this.game.winner] : null,
    };
  }
}

class PlayManager {
  constructor() { this.sessions = new Map(); }
  create(humanName, opponents) {
    const s = new PlaySession(humanName, opponents);
    this.sessions.set(s.id, s);
    // keep at most a few hours of sessions
    const cutoff = Date.now() - 3 * 3600 * 1000;
    for (const [id, sess] of this.sessions) if (sess.createdAt < cutoff) this.sessions.delete(id);
    return s;
  }
  get(id) { return this.sessions.get(id) || null; }
}

module.exports = { PlayManager, PlaySession };
