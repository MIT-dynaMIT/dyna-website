import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import type { Frame } from '../api';
import CoupTable, { describe } from '../CoupTable';
import type { TalkLine } from '../CoupTable';

interface ReplayData {
  frames: Frame[];
  seatNames: string[];
  owners: string[];
  winnerName: string | null;
  eloDelta: Record<string, number>;
  ts: number;
}

export default function ReplayPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<ReplayData | null>(null);
  const [err, setErr] = useState('');
  const [idx, setIdx] = useState(0);
  const [animate, setAnimate] = useState(false);
  const [animKey, setAnimKey] = useState(0);
  const [playing, setPlaying] = useState(false);
  const playRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    if (!id) return;
    api.get<ReplayData>(`/matches/${id}/replay`)
      .then((d) => { setData(d); setIdx(0); })
      .catch((ex) => setErr(ex instanceof Error ? ex.message : 'could not load the replay'));
  }, [id]);

  const N = data ? data.frames.length : 0;

  const go = (next: number, withAnim: boolean) => {
    const clamped = Math.max(0, Math.min(N - 1, next));
    setAnimate(withAnim && clamped === idx + 1);
    setIdx(clamped);
    setAnimKey((k) => k + 1);
  };

  // autoplay
  useEffect(() => {
    if (!playing) return;
    playRef.current = setInterval(() => {
      setIdx((i) => {
        if (i >= N - 1) { setPlaying(false); return i; }
        setAnimate(true);
        setAnimKey((k) => k + 1);
        return i + 1;
      });
    }, 1000);
    return () => clearInterval(playRef.current);
  }, [playing, N]);

  if (err) {
    return (
      <div className="coup-card">
        <p className="coup-error">{err}</p>
        <Link className="coup-nav" to="/coup/matches">← Back to match history</Link>
      </div>
    );
  }
  if (!data) return <div className="coup-note"><span className="coup-spin" /> Rewinding the tape…</div>;

  const frame = data.frames[idx];
  const view = frame.view;
  const prevView = idx > 0 ? data.frames[idx - 1].view : null;

  const talk: TalkLine[] = data.frames.slice(0, idx + 1)
    .map((f) => describe(f.log, data.seatNames)).filter(Boolean) as TalkLine[];
  const banner = talk.length ? talk[talk.length - 1] : null;

  const dateStr = new Date(data.ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });

  const strip = (
    <div className="ct-replay-strip">
      <Link to="/coup/matches">← Match history</Link>
      <span className="sep">·</span>
      {data.seatNames.map((nm, i) => {
        const d = data.eloDelta[nm] ?? 0;
        const win = nm === data.winnerName;
        const owner = data.owners[i] && data.owners[i] !== 'House' ? data.owners[i] : 'House';
        return (
          <span key={i}>
            {i > 0 && <span className="vs"> vs </span>}
            <span className={`bn ${win ? 'win' : ''}`}>{win ? '♛ ' : ''}{nm}</span>
            {' '}<span className="ow">({owner})</span>
            {' '}<span className={`ed ${d >= 0 ? 'pos' : 'neg'}`}>{d >= 0 ? '+' : ''}{d}</span>
          </span>
        );
      })}
      <span className="date">{dateStr}</span>
    </div>
  );

  const transport = (
    <div className="ct-transport">
      <div className="grp">
        <button className="small" onClick={() => go(0, false)} title="Jump to start">⏮</button>
        <button className="small" onClick={() => go(idx - 1, false)} disabled={idx === 0} title="Previous">◀</button>
        <button className="small primary" onClick={() => setPlaying((p) => !p)} disabled={idx >= N - 1 && !playing}>
          {playing ? '⏸ Pause' : '▶ Play'}
        </button>
        <button className="small" onClick={() => go(idx + 1, true)} disabled={idx >= N - 1} title="Next">▶</button>
        <button className="small" onClick={() => go(N - 1, false)} title="Jump to end">⏭</button>
      </div>
      <span className="frameno">frame {idx + 1} / {N}</span>
      <input type="range" min={0} max={Math.max(0, N - 1)} value={idx}
        onChange={(e) => { setPlaying(false); go(Number(e.target.value), false); }} />
    </div>
  );

  return (
    <div>
      {strip}
      <CoupTable
        seatNames={data.seatNames}
        view={view}
        prevView={prevView}
        stepLog={frame.log}
        animate={animate}
        animKey={animKey}
        youIndex={0}
        banner={banner}
        talk={talk}
        compact
        underBoard={transport}
      />
    </div>
  );
}
