import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import type { Frame, ReplayMatchInfo } from '../api';
import CoupTable, { describe, WinStrip } from '../CoupTable';
import type { TalkLine } from '../CoupTable';

interface ReplayData {
  frames: Frame[];
  seatNames: string[];
  owners: string[];
  winnerName: string | null;
  ts: number;
  match: ReplayMatchInfo;
}

export default function ReplayPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<ReplayData | null>(null);
  const [err, setErr] = useState('');
  const [idx, setIdx] = useState(0);
  // which of the 5 series, and which stored sample game within it (both indexes)
  const [series, setSeries] = useState(0);
  const [sample, setSample] = useState(0);
  const [animate, setAnimate] = useState(false);
  const [animKey, setAnimKey] = useState(0);
  const [playing, setPlaying] = useState(false);
  const playRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    if (!id) return;
    setPlaying(false);
    api.get<ReplayData>(`/matches/${id}/replay?series=${series}&sample=${sample}`)
      .then((d) => { setData(d); setIdx(0); setAnimate(false); })
      .catch((ex) => setErr(ex instanceof Error ? ex.message : 'could not load the replay'));
  }, [id, series, sample]);

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

  const m = data.match;
  const [nameA, nameB] = m.players;   // stable across series; strips are A's side

  return (
    <div>
      <div className="ct-shell" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <Link to="/coup/matches" className="coup-note" style={{ textDecoration: 'none' }}>← Match history</Link>
        <div style={{ flex: 1 }} />
        <span className="coup-note">
          {m.mode === 'gauntlet' ? `gauntlet level ${(m.level ?? 0) + 1}` : 'bot battle'} · {dateStr}
        </span>
      </div>

      <div className="ct-replayhead">
        <div className="coup-card" style={{ flex: '1 1 320px', padding: '12px 16px' }}>
          <div className="ct-seatlist">
            {m.players.map((nm, i) => {
              const win = nm === m.matchWinner;
              return (
                <div className="row" key={i}>
                  <span className={`bn ${win ? 'win' : ''}`}>{win ? '♛ ' : ''}{nm}</span>
                  <span className="ow">{m.ownerNames[i]}</span>
                  <span className="ed">{i === 0 ? m.score[0] : m.score[1]} series</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="ct-serieshead">
        <div className="sline">
          Match {nameA} <b>{m.score[0]}–{m.score[1]}</b> {nameB}
          {' · series '}<b>{m.seriesIndex + 1}</b> of {m.seriesScores.length}
          {' · watching game '}<b>{m.game}</b> of {m.gamesPerSeries}
        </div>
        <div className="sbtns">
          {m.seriesScores.map((s, i) => (
            <button key={i} className={`small ${i === m.seriesIndex ? 'primary' : ''}`}
              onClick={() => { setSeries(i); setSample(0); }} disabled={i === m.seriesIndex}>
              S{i + 1} · {s[0]}-{s[1]}
            </button>
          ))}
          <span style={{ width: 14 }} />
          {m.samples.map((g, i) => (
            <button key={g} className={`small ${i === m.sampleIndex ? 'primary' : ''}`}
              onClick={() => setSample(i)} disabled={i === m.sampleIndex}>
              Game {g}
            </button>
          ))}
        </div>
        <WinStrip strip={m.winStrip} highlight={m.game}
          title={`series ${m.seriesIndex + 1}: ${m.gamesPerSeries} games — green = ${nameA} won`} />
        <span className="skey">
          <i>■</i> {nameA} · <s>■</s> {nameB} — seats swap each game; only games{' '}
          {m.samples.join(', ')} of each series were recorded
        </span>
      </div>

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
