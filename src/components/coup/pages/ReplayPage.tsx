import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, stripOwner } from '../api';
import type { Frame, SeriesInfo } from '../api';
import CoupTable, { describe, WinStrip } from '../CoupTable';
import type { TalkLine } from '../CoupTable';

interface ReplayData {
  frames: Frame[];
  seatNames: string[];
  owners: string[];
  winnerName: string | null;
  eloDelta: Record<string, number>;
  ts: number;
  series?: SeriesInfo;
}

export default function ReplayPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<ReplayData | null>(null);
  const [err, setErr] = useState('');
  const [idx, setIdx] = useState(0);
  // which stored sample game to watch — this is an INDEX into series.samples,
  // not a game number, and it is what ?sample= expects.
  const [sample, setSample] = useState(0);
  const [animate, setAnimate] = useState(false);
  const [animKey, setAnimKey] = useState(0);
  const [playing, setPlaying] = useState(false);
  const playRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    if (!id) return;
    setPlaying(false);
    api.get<ReplayData>(`/matches/${id}/replay?sample=${sample}`)
      .then((d) => { setData(d); setIdx(0); setAnimate(false); })
      .catch((ex) => setErr(ex instanceof Error ? ex.message : 'could not load the replay'));
  }, [id, sample]);

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

  // Seats swap between games of a series, so this game's seat 0 is not a stable
  // thing to orient a series scoreboard to — it would flip the score between
  // samples. Anchor to the strip's own bot instead and name both sides.
  const s = data.series;
  const home = s ? stripOwner(s.winStrip, s.score) : '';
  const away = s ? (Object.keys(s.score).find((n) => n !== home) ?? '') : '';

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <Link to="/coup/matches" className="coup-note" style={{ textDecoration: 'none' }}>← Match history</Link>
        <div style={{ flex: 1 }} />
        <span className="coup-note">{dateStr}</span>
      </div>

      <div className="ct-replayhead">
        <div className="coup-card" style={{ flex: '1 1 320px', padding: '12px 16px' }}>
          <div className="ct-seatlist">
            {data.seatNames.map((nm, i) => {
              const d = data.eloDelta[nm] ?? 0;
              const win = nm === data.winnerName;
              return (
                <div className="row" key={i}>
                  <span className={`bn ${win ? 'win' : ''}`}>{win ? '♛ ' : ''}{nm}</span>
                  <span className="ow">{data.owners[i] && data.owners[i] !== 'House' ? data.owners[i] : 'House'}</span>
                  <span className={`ed ${d >= 0 ? 'pos' : 'neg'}`}>{d >= 0 ? '+' : ''}{d} ELO</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {s && (
        <div className="ct-serieshead">
          <div className="sline">
            Series {home} <b>{s.score[home] ?? 0}–{s.score[away] ?? 0}</b> {away}
            {' · watching game '}<b>{s.game}</b> of {s.gamesTotal}
          </div>
          <div className="sbtns">
            {s.samples.map((g, i) => (
              <button key={g} className={`small ${i === s.sampleIndex ? 'primary' : ''}`}
                onClick={() => setSample(i)} disabled={i === s.sampleIndex}>
                Game {g}
              </button>
            ))}
          </div>
          <WinStrip strip={s.winStrip} highlight={s.game}
            title={`${s.gamesTotal} games — green = ${home} won`} />
          <span className="skey">
            <i>■</i> {home} · <s>■</s> {away} — seats swap each game; only games{' '}
            {s.samples.join(', ')} were recorded
          </span>
        </div>
      )}

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
      />

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
    </div>
  );
}
