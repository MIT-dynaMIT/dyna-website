import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from './api';
import type { AchievementToastData } from './api';

const HOLD_MS = 3000;    // a quick flash of glory...
const FADE_MS = 450;     // ...then it fades out on its own

interface Toast extends AchievementToastData { leaving?: boolean }

/**
 * The unlock popups. Fresh awards ride in on the app-wide heartbeat; each one
 * slides into the bottom-right corner, holds for three seconds, then fades
 * away. The ✕ fades it out early. Acking is immediate and separate from the
 * fade — once the server knows a trophy was shown it stops re-sending it, so
 * a refresh mid-toast never replays the same unlock.
 */
export default function AchievementToasts({ incoming }: { incoming: AchievementToastData[] }) {
  const [shown, setShown] = useState<Toast[]>([]);
  const seen = useRef<Set<string>>(new Set());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // fade first, drop from the DOM once the fade has actually played
  const retire = useRef((id: string) => {
    setShown((cur) => cur.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
    timers.current.push(setTimeout(
      () => setShown((cur) => cur.filter((x) => x.id !== id)),
      FADE_MS,
    ));
  });

  useEffect(() => {
    const fresh = incoming.filter((a) => !seen.current.has(a.id));
    if (!fresh.length) return;
    fresh.forEach((a) => seen.current.add(a.id));
    setShown((cur) => [...cur, ...fresh]);
    // tell the server they have been popped, so they never come round again
    api.post('/achievements/ack', { ids: fresh.map((a) => a.id) }).catch(() => {});
    fresh.forEach((a) => {
      timers.current.push(setTimeout(() => retire.current(a.id), HOLD_MS));
    });
  }, [incoming]);

  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

  const dismiss = (id: string) => retire.current(id);

  if (!shown.length) return null;
  return (
    <div className="ach-toasts">
      {shown.map((a) => (
        <div key={a.id} className={`ach-toast ${a.leaving ? 'leaving' : ''}`} role="status">
          <button className="ach-toast-x" onClick={() => dismiss(a.id)}
            aria-label="Dismiss">✕</button>
          <div className="ach-toast-icon" aria-hidden>{a.icon}</div>
          <div className="ach-toast-body">
            <div className="ach-toast-lead">Achievement unlocked</div>
            <div className="ach-toast-name">{a.name}</div>
            <div className="ach-toast-desc">{a.desc}</div>
            <Link className="ach-toast-link" to="/coup/achievements"
              onClick={() => dismiss(a.id)}>See all achievements →</Link>
          </div>
        </div>
      ))}
    </div>
  );
}
