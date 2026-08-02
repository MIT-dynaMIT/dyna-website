# dynaCOUP camp server

The backend for the `/coup` pages of the dynaMIT website: student logins, saved
bot versions, the always-running scrimmage ladder (ELO), match replays, and
heads-up play against your own bots.

## Camp-day quickstart

```bash
# one time (or to start over): create logins + sample bots + warm the ladder
node server/seed.js 1500 --fresh

# development: two processes
npm run server        # API on :8787 (scrims run continuously)
npm run dev           # Vite on :5173, proxies /api → :8787
# open http://localhost:5173/coup

# production/camp: build once, serve everything from the API process
npm run build && npm run server        # site + API on :8787
```

## Logins

Accounts are pre-created (no signup). Seeded logins:

| login | password | who |
|---|---|---|
| `admin` | `dynamit` (env `ADMIN_PASS`) | organizer console, 100 bot slots, multi-submit |
| `hank` `charlie` `tina` `daisy` `randy` `barry` `carl` `ava` `mia` `sam` `wes` `greta` | `coup123` | sample students, one bot each |

Create real student logins from the Organizer page (or `POST /api/coup/admin/create-user`).

## How it fits together

- `botlang.js` — sandboxed Python-subset interpreter. Block coding and the
  advanced editor both produce this language; step-limited so `while True:`
  can't hang the ladder; seeded rng so games are reproducible.
- `botapi.js` — builds the `state` object bots see (live claim tracking from
  the public log, scrim-history stats), validates bot returns, safe fallbacks,
  and the "Check my bot" battery.
- `coup.js` — the pure rules engine (ported from the dynacs repo).
- `runner.js` — plays bot games, records `seed + decisions`; replays re-run
  the engine only, so stored matches are tiny and bit-exact.
- `scrim.js` — every 4s plays 3 ladder games among submitted bots
  (least-played favored). ELO: winner scores a pairwise win vs each of the
  other four, K=8 per pair. Only the winner matters.
- `store.js` — JSON files in `server/data/`. Matches capped at 2500.
- `play.js` — heads-up sessions (human + 4 bots) over plain HTTP.

## Ops notes

- Data lives in `server/data/*.json`; back it up by copying the folder.
- `seed.js N` is idempotent (re-running adds games, not duplicate users);
  `--fresh` wipes everything first.
- Pause/resume scrims from the Organizer page.
- Env: `PORT` (8787), `DATA_DIR`, `ADMIN_PASS`.
