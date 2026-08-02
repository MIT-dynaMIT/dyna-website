import { useCallback, useEffect, useRef, useState } from 'react';
import * as Blockly from 'blockly/core';
import { api, ApiError } from '../api';
import type { BotSlot, CheckResult, CoupUser } from '../api';
import { timeAgo } from '../api';
import { useToast } from '../CoupApp';
import {
  coupTheme, ensureBlocklySetup, generatePython, makeToolbox,
  STARTER_PYTHON, starterWorkspaceJson,
} from '../editor/blocks';
import '../editor.css';

type Mode = 'blocks' | 'python';

const FUN_NAMES = [
  'Sir Bluff-a-Lot', 'Lady Deception', 'The Quiet Duke', 'Baron Backstab',
  'Countess Cunning', 'Duke Nukem', 'The Contessa Kid', 'Captain Chaos',
  'Ambassador Sneaky', 'Reckless Regent',
];
const defaultName = (idx: number) => FUN_NAMES[idx % FUN_NAMES.length];

function blocksJsonIsEmpty(json: unknown): boolean {
  if (!json || typeof json !== 'object') return true;
  const b = (json as { blocks?: { blocks?: unknown[] } }).blocks;
  return !b || !Array.isArray(b.blocks) || b.blocks.length === 0;
}

export default function EditorPage({ user }: { user: CoupUser }) {
  const toast = useToast();

  const [slots, setSlots] = useState<(BotSlot | null)[]>([]);
  const [idx, setIdx] = useState(0);
  const [mode, setMode] = useState<Mode>('blocks');
  const [name, setName] = useState('');
  const [pythonText, setPythonText] = useState(STARTER_PYTHON);
  const [dirty, setDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [generated, setGenerated] = useState('');
  const [codeOpen, setCodeOpen] = useState(true);
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(false);
  const [, setClock] = useState(0);

  const blocklyDiv = useRef<HTMLDivElement>(null);
  const wsRef = useRef<Blockly.WorkspaceSvg | null>(null);
  const loadingRef = useRef(false);
  const pyHistory = useRef<string[]>([]);

  // live refs so callbacks always see current values
  const idxRef = useRef(idx); idxRef.current = idx;
  const modeRef = useRef(mode); modeRef.current = mode;
  const nameRef = useRef(name); nameRef.current = name;
  const pyRef = useRef(pythonText); pyRef.current = pythonText;
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const slotsRef = useRef(slots); slotsRef.current = slots;

  // ---------------------------------------------------------------- load a slot into the editor
  const loadSlot = useCallback((slot: BotSlot | null, i: number) => {
    const ws = wsRef.current;
    if (!ws) return;
    const m: Mode = slot?.mode === 'python' ? 'python' : 'blocks';
    setMode(m);
    setName(slot?.name || defaultName(i));
    setCheck(null);

    loadingRef.current = true;
    const json = slot && !blocksJsonIsEmpty(slot.blocksJson) ? slot.blocksJson : starterWorkspaceJson();
    try {
      Blockly.serialization.workspaces.load(json as object, ws);
    } catch {
      Blockly.serialization.workspaces.load(starterWorkspaceJson(), ws);
    }
    loadingRef.current = false;

    const gen = generatePython(ws);
    setGenerated(gen);
    setPythonText(slot?.python || (m === 'python' ? STARTER_PYTHON : gen));
    pyHistory.current = [];
    setDirty(false);
    setLastSavedAt(slot?.updatedAt ?? null);
    setTimeout(() => Blockly.svgResize(ws), 0);
  }, []);

  // ---------------------------------------------------------------- init: fetch + inject once
  useEffect(() => {
    let cancelled = false;
    ensureBlocklySetup();

    (async () => {
      let loaded: (BotSlot | null)[] = [];
      try {
        const r = await api.get<{ slots: (BotSlot | null)[]; slotCount: number }>('/bots');
        loaded = r.slots;
      } catch { /* leave empty */ }
      if (cancelled) return;
      setSlots(loaded);

      const div = blocklyDiv.current;
      if (!div || wsRef.current) return;
      const ws = Blockly.inject(div, {
        toolbox: makeToolbox(),
        theme: coupTheme(),
        renderer: 'zelos',
        grid: { spacing: 24, length: 2, colour: '#222c35', snap: true },
        zoom: { controls: true, wheel: true, startScale: 0.85, maxScale: 2, minScale: 0.4 },
        trashcan: true,
        move: { scrollbars: true, drag: true, wheel: true },
      });
      wsRef.current = ws;

      // The category flyout's scrollbar can linger on screen after the flyout
      // closes. Hide/show it in step with the flyout's own visibility.
      const flyout = ws.getFlyout();
      if (flyout) {
        const origSetVisible = flyout.setVisible.bind(flyout);
        flyout.setVisible = (visible: boolean) => {
          origSetVisible(visible);
          div.querySelectorAll<SVGElement>('.blocklyFlyoutScrollbar')
            .forEach((el) => { el.style.display = visible ? '' : 'none'; });
        };
      }

      ws.addChangeListener((e: Blockly.Events.Abstract) => {
        if (loadingRef.current || e.isUiEvent) return;
        if (e.type === Blockly.Events.VIEWPORT_CHANGE) return;
        setGenerated(generatePython(ws));
        setDirty(true);
      });

      const firstNonEmpty = loaded.findIndex((s) => s && s.python);
      const start = firstNonEmpty >= 0 ? firstNonEmpty : 0;
      setIdx(start);
      loadSlot(loaded[start] ?? null, start);
      setReady(true);
    })();

    return () => {
      cancelled = true;
      wsRef.current?.dispose();
      wsRef.current = null;
    };
  }, [loadSlot]);

  // keep the workspace sized to its container
  useEffect(() => {
    if (!ready) return;
    const onResize = () => wsRef.current && Blockly.svgResize(wsRef.current);
    window.addEventListener('resize', onResize);
    const ro = new ResizeObserver(onResize);
    if (blocklyDiv.current) ro.observe(blocklyDiv.current);
    return () => { window.removeEventListener('resize', onResize); ro.disconnect(); };
  }, [ready]);

  // ticking clock for "saved X ago"
  useEffect(() => {
    const t = setInterval(() => setClock((c) => c + 1), 20000);
    return () => clearInterval(t);
  }, []);

  // ---------------------------------------------------------------- save
  const doSave = useCallback(async (i: number, opts?: { silent?: boolean }): Promise<boolean> => {
    const ws = wsRef.current;
    if (!ws) return false;
    const blocksJson = Blockly.serialization.workspaces.save(ws);
    const m = modeRef.current;
    const python = m === 'blocks' ? generatePython(ws) : pyRef.current;
    const payload = {
      name: nameRef.current || defaultName(i), mode: m, blocksJson, python,
      // reject-stale-writes guard: what this tab believes the slot's version is
      baseUpdatedAt: slotsRef.current[i]?.updatedAt ?? null,
    };
    try {
      const r = await api.put<{ slot: BotSlot }>(`/bots/${i}`, payload);
      const saved: BotSlot = r?.slot ?? { ...payload, updatedAt: Date.now() } as BotSlot;
      setSlots((prev) => { const next = prev.slice(); next[i] = saved; return next; });
      if (i === idxRef.current) { setDirty(false); setLastSavedAt(saved.updatedAt); }
      if (!opts?.silent) toast(`Saved “${payload.name}” ✓`);
      return true;
    } catch (ex) {
      if (ex instanceof ApiError && ex.status === 409) {
        // someone else (another tab?) saved this slot after we loaded it —
        // never clobber: refresh from the server instead
        try {
          const r = await api.get<{ slots: (BotSlot | null)[] }>('/bots');
          setSlots(r.slots);
          if (i === idxRef.current) loadSlot(r.slots[i] ?? null, i);
        } catch { /* keep local state */ }
        toast('This slot was changed in another tab — reloaded the newer version');
        return false;
      }
      if (!opts?.silent) toast(ex instanceof Error ? ex.message : 'Save failed');
      return false;
    }
  }, [toast, loadSlot]);

  // ---------------------------------------------------------------- autosave (every 5 min when dirty)
  useEffect(() => {
    const t = setInterval(() => {
      if (dirtyRef.current) doSave(idxRef.current, { silent: true }).then((ok) => { if (ok) toast('Autosaved'); });
    }, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [doSave, toast]);

  // ---------------------------------------------------------------- switch slot (save current first)
  const switchSlot = useCallback(async (i: number) => {
    if (i === idxRef.current) return;
    if (dirtyRef.current) await doSave(idxRef.current, { silent: true });
    setIdx(i);
    loadSlot(slots[i] ?? null, i);
  }, [doSave, loadSlot, slots]);

  // ---------------------------------------------------------------- mode toggle
  const switchToPython = () => {
    const ws = wsRef.current;
    if (!ws) return;
    setPythonText(generatePython(ws));
    pyHistory.current = [];
    setMode('python');
  };
  const switchToBlocks = () => {
    if (!window.confirm(
      'Switch back to Blocks?\n\nYour bot will reload from the blocks — any changes you typed in the code editor will be lost.'
    )) return;
    const ws = wsRef.current;
    setMode('blocks');
    if (ws) { setGenerated(generatePython(ws)); setTimeout(() => Blockly.svgResize(ws), 0); }
  };

  // ---------------------------------------------------------------- python textarea edit + undo
  const onPyChange = (v: string) => {
    pyHistory.current.push(pyRef.current);
    if (pyHistory.current.length > 200) pyHistory.current.shift();
    setPythonText(v);
    setDirty(true);
  };
  const undo = () => {
    if (modeRef.current === 'blocks') { wsRef.current?.undo(false); }
    else {
      const prev = pyHistory.current.pop();
      if (prev !== undefined) { setPythonText(prev); setDirty(true); }
    }
  };

  // ---------------------------------------------------------------- check
  const runCheck = async () => {
    const ws = wsRef.current;
    const python = modeRef.current === 'blocks' && ws ? generatePython(ws) : pyRef.current;
    setChecking(true); setCheck(null);
    try {
      const r = await api.post<CheckResult>('/check', { python });
      setCheck(r);
    } catch (ex) {
      setCheck({ ok: false, problems: [{ message: ex instanceof Error ? ex.message : 'check failed' }], notes: [] });
    } finally {
      setChecking(false);
    }
  };

  const handleSave = async () => { setSaving(true); try { await doSave(idxRef.current); } finally { setSaving(false); } };
  const renameCurrent = (v: string) => { setName(v); setDirty(true); };

  const codeForView = mode === 'blocks' ? generated : pythonText;
  const lineCount = codeForView.split('\n').length;

  // ---------------------------------------------------------------- render
  return (
    <div className="ed-wrap">
      {/* sidebar */}
      <aside className="ed-side coup-card">
        <h2 className="coup-h">Your Bots <small>{slots.length || '—'} slots</small></h2>
        <p className="coup-sub">Each slot is a separate champion. Switch anytime — your work is saved automatically.</p>
        <div className="ed-slots">
          {slots.map((s, i) => (
            <button
              key={i}
              className={`ed-slot ${i === idx ? 'active' : ''} ${s && s.python ? '' : 'empty'}`}
              onClick={() => switchSlot(i)}
            >
              <span className="ed-slot-n">{i + 1}</span>
              <span className="ed-slot-body">
                <span className="ed-slot-name">{s?.name || <em>empty slot</em>}</span>
                <span className="ed-slot-meta">
                  {s?.updatedAt ? `saved ${timeAgo(s.updatedAt)}` : 'not saved yet'}
                  {s?.mode === 'python' && ' · code'}
                  {i === idx && dirty && ' · unsaved'}
                </span>
              </span>
            </button>
          ))}
          {slots.length === 0 && <div className="coup-note">Loading your slots…</div>}
        </div>
      </aside>

      {/* main editor */}
      <section className="ed-main">
        <div className="coup-card ed-head">
          <div className="ed-head-top">
            <div className="ed-name-field">
              <label htmlFor="botname">Bot name</label>
              <input id="botname" type="text" value={name} maxLength={24}
                onChange={(e) => renameCurrent(e.target.value)} />
            </div>
            <div className="ed-status">
              <span className={`ed-dot ${dirty ? 'on' : ''}`} title={dirty ? 'unsaved changes' : 'all saved'} />
              <span className="coup-note">
                {dirty ? 'Unsaved changes' : lastSavedAt ? `Saved ${timeAgo(lastSavedAt)}` : 'Not saved yet'}
              </span>
            </div>
          </div>
          <p className="ed-hint">
            🎭 Pick a fun name — it shows on the ladder for everyone to see! You are coding for slot {idx + 1}
            {user.isAdmin ? ' (organizer — you have lots of slots)' : ''}.
          </p>

          <div className="ed-toolbar">
            <div className="ed-modes">
              <button className={mode === 'blocks' ? 'primary small' : 'small'}
                onClick={() => mode === 'python' && switchToBlocks()}>🧩 Blocks</button>
              <button className={mode === 'python' ? 'primary small' : 'small'}
                onClick={() => mode === 'blocks' && switchToPython()}>⌨ Advanced (Python)</button>
            </div>
            <div className="ed-actions">
              <button className="small" onClick={undo}>↶ Undo</button>
              <button className="small" onClick={runCheck} disabled={checking}>
                {checking ? 'Checking…' : 'Check my bot ✓'}
              </button>
              <button className="primary small" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : '💾 Save'}
              </button>
            </div>
          </div>
        </div>

        {/* blocks workspace (kept mounted; hidden in python mode) */}
        <div className={`ed-blockly-shell coup-card ${mode === 'python' ? 'hidden' : ''}`}>
          <div ref={blocklyDiv} className="ed-blockly" />
        </div>

        {/* advanced python editor */}
        {mode === 'python' && (
          <div className="ed-py coup-card">
            <div className="ed-py-inner">
              <pre className="ed-gutter" aria-hidden>
                {Array.from({ length: lineCount }, (_, i) => i + 1).join('\n')}
              </pre>
              <textarea
                className="ed-py-area mono" spellCheck={false} value={pythonText}
                onChange={(e) => onPyChange(e.target.value)}
                wrap="off"
              />
            </div>
            <p className="coup-note ed-py-note">
              Write functions only: <code>your_turn</code>, <code>respond</code>, <code>when_assassinated</code>,
              <code> choose_card_to_lose</code>. Heads-up: <code>coup</code> and <code>assassinate</code> name a
              character (<code>coup("duke")</code>, <code>assassinate("duke", 0.35)</code>) and <code>steal()</code>
              takes no argument. No imports, f-strings, or keyword args — pass values positionally.
            </p>
          </div>
        )}

        {/* live generated-code panel (blocks mode) */}
        {mode === 'blocks' && (
          <div className="coup-card ed-codepanel">
            <button className="ed-code-toggle" onClick={() => setCodeOpen((o) => !o)}>
              <span>{codeOpen ? '▾' : '▸'}</span> Generated code <small>(this is exactly what your bot runs)</small>
            </button>
            {codeOpen && <pre className="ed-code mono">{generated || '# add some blocks to see your bot’s code'}</pre>}
          </div>
        )}

        {/* check results */}
        {check && (
          <div className={`coup-card ed-check ${check.ok ? 'ok' : 'bad'}`}>
            {check.ok ? (
              <>
                <h3 className="ed-check-h">⚔️ Ready for battle!</h3>
                <p className="coup-note">Your bot compiled and made legal moves in every test game. Send it to the ladder!</p>
              </>
            ) : (
              <>
                <h3 className="ed-check-h">🛠 A few things to fix first</h3>
                <ul className="ed-problems">
                  {check.problems.map((p, i) => (
                    <li key={i}>
                      {p.fn && <span className="ed-fn">{p.fn}</span>}
                      {p.line != null && <span className="ed-line">line {p.line}</span>}
                      <span>{p.message}</span>
                    </li>
                  ))}
                </ul>
                <p className="coup-note">Don’t worry — every great strategist debugs. Fix these and check again!</p>
              </>
            )}
            {check.notes.length > 0 && (
              <ul className="ed-notes">
                {check.notes.map((n, i) => <li key={i}>💡 {n}</li>)}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
