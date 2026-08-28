import { useEffect, useState } from 'react';
import { api } from '../api';
import { useToast } from '../CoupApp';

interface HouseBot { level: number; name: string; source: string; lines: number }

/**
 * The four level bots, published in full.
 *
 * Reading the opponent is the point: every one of these is a real botlang
 * program a camper could have written, and the comments in them record what
 * was tried and what LOST, which is the part that is hard to learn from a
 * win/loss column.
 */
export default function HouseBotsPage() {
  const toast = useToast();
  const [bots, setBots] = useState<HouseBot[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(0);

  useEffect(() => {
    api.get<{ bots: HouseBot[] }>('/housebots')
      .then((r) => { setBots(r.bots); setErr(null); })
      .catch((e) => setErr(e instanceof Error ? e.message : 'could not load the house bots'));
  }, []);

  if (err) {
    return (
      <div className="coup-card">
        <h2 className="coup-h">🏛 The house bots</h2>
        <p className="coup-note" style={{ color: 'var(--bad)' }}>{err}</p>
        <button className="small" onClick={() => window.location.reload()}>Try again</button>
      </div>
    );
  }
  if (!bots) return <div className="coup-note"><span className="coup-spin" /> Loading the house bots…</div>;

  const bot = bots[open];
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(bot.source);
      toast(`${bot.name}'s code copied — paste it into a slot in the Bot Editor`);
    } catch {
      toast('Could not copy — select the code and copy it by hand');
    }
  };

  return (
    <div className="coup-card">
      <h2 className="coup-h">🏛 The house bots
        <small>the four you face in Levels — every line of them</small>
      </h2>
      <p className="coup-sub">
        These are the real programs, not summaries. Read the comments as well as the code:
        they record what was <b>tried and lost</b>, which is the part a win/loss column can
        never tell you. Steal anything you like — but a copy of Andrew only ever draws with
        Andrew, and the campers above you on the leaderboard are the ones who found what he
        gets <i>wrong</i>.
      </p>

      <div className="hb-tabs">
        {bots.map((b, i) => (
          <button key={b.name}
            className={`hb-tab ${i === open ? 'on' : ''}`}
            onClick={() => setOpen(i)}>
            <span className="hb-lvl">Level {b.level}</span>
            <span className="hb-name">{b.name}</span>
            <span className="hb-lines">{b.lines} lines</span>
          </button>
        ))}
      </div>

      <div className="hb-bar">
        <b>{bot.name}</b>
        <span className="coup-note">level {bot.level} · {bot.lines} lines of botlang</span>
        <span style={{ flex: 1 }} />
        <button className="small" onClick={copy}>Copy code</button>
      </div>

      <div className="hb-code">
        <pre className="hb-gutter" aria-hidden>
          {Array.from({ length: bot.lines }, (_, i) => i + 1).join('\n')}
        </pre>
        <pre className="hb-src mono">{bot.source}</pre>
      </div>

      <p className="coup-note" style={{ marginTop: 12 }}>
        These are the builds the <b>Levels</b> ladder plays. An organizer can tune a
        leaderboard defender live, so the bot defending the scrimmage may be a version ahead
        of what you see here.
      </p>
    </div>
  );
}
