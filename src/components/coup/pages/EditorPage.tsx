import { useCallback, useEffect, useRef, useState } from 'react';
import * as Blockly from 'blockly/core';
import { api, ApiError } from '../api';
import type { BotSlot, CheckResult, CoupUser } from '../api';
import { timeAgo } from '../api';
import { useToast } from '../CoupApp';
import {
  coupTheme, ensureBlocklySetup, generatePython, makeToolbox,
  STARTER_PYTHON, starterWorkspaceJson, tidyWorkspace,
} from '../editor/blocks';
import { astToWorkspaceJson, DecompileError } from '../editor/decompile';
import '../editor.css';

type Mode = 'blocks' | 'python';
type FnStatus = 'ok' | 'default' | 'error';
interface RichCheck extends CheckResult { functions?: { fn: string; status: FnStatus }[] }
interface ParseResult { ok: boolean; ast?: unknown; error?: string; line?: number }

const FUN_NAMES = [
  'Sir Bluff-a-Lot', 'Lady Deception', 'The Quiet Duke', 'Baron Backstab',
  'Countess Cunning', 'Duke Nukem', 'The Contessa Kid', 'Baroness Chaos',
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
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [idx, setIdx] = useState(0);
  const [mode, setMode] = useState<Mode>('blocks');
  const [name, setName] = useState('');
  const [pythonText, setPythonText] = useState(STARTER_PYTHON);
  const [dirty, setDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [generated, setGenerated] = useState('');
  const [codeOpen, setCodeOpen] = useState(true);
  const [check, setCheck] = useState<RichCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(false);
  const [, setClock] = useState(0);

  const blocklyDiv = useRef<HTMLDivElement>(null);
  const wsRef = useRef<Blockly.WorkspaceSvg | null>(null);
  const loadingRef = useRef(false);
  const pyHistory = useRef<string[]>([]);
  // bumped on every slot load so a slow /parse from a previous slot can't apply
  const loadToken = useRef(0);

  // live refs so callbacks always see current values
  const idxRef = useRef(idx); idxRef.current = idx;
  const modeRef = useRef(mode); modeRef.current = mode;
  const nameRef = useRef(name); nameRef.current = name;
  const pyRef = useRef(pythonText); pyRef.current = pythonText;
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const slotsRef = useRef(slots); slotsRef.current = slots;
  // stash of hand-written python while "peeking" at blocks (see mode toggle)
  const pyStash = useRef<{ python: string; blocksSnapshot: string } | null>(null);

  // turn a python-mode slot into blocks on load; on failure fall back to
  // Advanced. Guards against a stale slot switch landing on the wrong slot.
  // keepDirty: an uploaded file is unsaved work — don't mark it clean.
  const autoDecompile = useCallback((python: string, token: number, keepDirty = false) => {
    const ws = wsRef.current;
    if (!ws) return;
    api.post<ParseResult>('/parse', { python })
      .then((r) => {
        if (loadToken.current !== token || !wsRef.current) return;
        if (!r.ok || !r.ast) throw new DecompileError(r.error || 'this code has a syntax error', r.line);
        const wsJson = astToWorkspaceJson(r.ast as { fns: Record<string, unknown> });
        loadingRef.current = true;
        Blockly.serialization.workspaces.load(wsJson as object, ws);
        loadingRef.current = false;
        setGenerated(generatePython(ws));
        setMode('blocks');
        setDirty(keepDirty);
        setTimeout(() => {
          if (loadToken.current !== token || !wsRef.current) return;
          Blockly.svgResize(ws);
          tidyWorkspace(ws, true);
          // stash AFTER tidy so an untouched peek→Advanced restores the
          // original code (and an untouched save keeps mode 'python').
          pyStash.current = { python, blocksSnapshot: JSON.stringify(Blockly.serialization.workspaces.save(ws)) };
          setGenerated(generatePython(ws));
        }, 0);
      })
      .catch(() => {
        loadingRef.current = false;
        if (loadToken.current !== token) return;
        pyStash.current = null;
        setMode('python');
        toast('Opened in Advanced — this code uses something blocks can’t show yet');
      });
  }, [toast]);

  // ---------------------------------------------------------------- load a slot into the editor
  const loadSlot = useCallback((slot: BotSlot | null, i: number) => {
    const ws = wsRef.current;
    if (!ws) return;
    const token = ++loadToken.current;
    setName(slot?.name || defaultName(i));
    setCheck(null);
    pyStash.current = null;

    loadingRef.current = true;
    const hasSavedBlocks = !!slot && !blocksJsonIsEmpty(slot.blocksJson);
    // a saved workspace we can no longer load (e.g. a pre-variant-D bot built
    // with the old steal/Captain blocks) must NOT be silently replaced by the
    // starter — fall back to the slot's own code in Advanced instead
    let blocksUnloadable = false;
    try {
      Blockly.serialization.workspaces.load(
        (hasSavedBlocks ? slot!.blocksJson : starterWorkspaceJson()) as object, ws,
      );
    } catch {
      blocksUnloadable = hasSavedBlocks;
      Blockly.serialization.workspaces.load(starterWorkspaceJson(), ws);
    }
    loadingRef.current = false;

    const gen = generatePython(ws);
    setGenerated(gen);
    setPythonText(slot?.python || (slot?.mode === 'python' ? STARTER_PYTHON : gen));
    pyHistory.current = [];
    setDirty(false);
    setLastSavedAt(slot?.updatedAt ?? null);

    // Blocks are the default view. A python-mode slot with real code
    // auto-decompiles into blocks; everything else just shows its blocks.
    const savedPython = slot?.python && slot.python.trim().length > 0 ? slot.python : null;
    if (blocksUnloadable && savedPython) {
      setPythonText(savedPython);
      setMode('python');
      toast('Opened in Advanced — this bot uses blocks the game no longer has (your code is safe)');
      return;
    }
    const isPython = slot?.mode === 'python' && !!savedPython;
    setMode('blocks');
    setTimeout(() => {
      if (loadToken.current !== token || !wsRef.current) return;
      Blockly.svgResize(ws);
      tidyWorkspace(ws, false);
    }, 0);
    if (isPython) autoDecompile(savedPython!, token);
  }, [autoDecompile, toast]);

  // ---------------------------------------------------------------- init: fetch + inject once
  useEffect(() => {
    let cancelled = false;
    ensureBlocklySetup();

    (async () => {
      let loaded: (BotSlot | null)[] = [];
      try {
        const r = await api.get<{ slots: (BotSlot | null)[]; slotCount: number; selectedSlot: number | null }>('/bots');
        loaded = r.slots;
        setSelectedSlot(r.selectedSlot);
      } catch { /* leave empty */ }
      if (cancelled) return;
      setSlots(loaded);

      const div = blocklyDiv.current;
      if (!div || wsRef.current) return;
      const ws = Blockly.inject(div, {
        toolbox: makeToolbox(),
        theme: coupTheme(),
        renderer: 'zelos',
        grid: { spacing: 24, length: 2, colour: '#d8d3c4', snap: true },
        zoom: { controls: true, wheel: true, startScale: 0.85, maxScale: 2, minScale: 0.4 },
        // trashcan without the confusing "recycle bin" flyout — Undo covers recovery
        trashcan: true,
        maxTrashcanContents: 0,
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
    let m = modeRef.current;
    let python = m === 'blocks' ? generatePython(ws) : pyRef.current;
    // saving while merely PEEKING at blocks (hand-written python stashed,
    // blocks untouched) must save the real code, not the generated shell
    if (m === 'blocks' && pyStash.current
      && pyStash.current.blocksSnapshot === JSON.stringify(blocksJson)) {
      m = 'python';
      python = pyStash.current.python;
    }
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
  // Blocks can't represent hand-written Python, so peeking at Blocks stashes
  // the code; switching back restores it verbatim UNLESS the blocks were
  // actually edited in between (then they become the source of truth).
  const switchToPython = () => {
    const ws = wsRef.current;
    if (!ws) return;
    const snapshot = JSON.stringify(Blockly.serialization.workspaces.save(ws));
    if (pyStash.current && pyStash.current.blocksSnapshot === snapshot) {
      setPythonText(pyStash.current.python);   // untouched round-trip: no loss
    } else {
      setPythonText(generatePython(ws));
      pyHistory.current = [];
    }
    pyStash.current = null;
    setMode('python');
  };
  const switchToBlocks = async () => {
    const ws = wsRef.current;
    if (!ws) return;
    const generated = generatePython(ws);
    if (pyRef.current.trim() === generated.trim()) {
      // blocks already produce this exact code — just show them
      pyStash.current = null;
      setMode('blocks');
      setGenerated(generated);
      setTimeout(() => Blockly.svgResize(ws), 0);
      return;
    }
    // hand-written (or block-edited) code: try to turn it INTO blocks
    try {
      const r = await api.post<{ ok: boolean; ast?: unknown; error?: string; line?: number }>('/parse', { python: pyRef.current });
      if (!r.ok || !r.ast) throw new DecompileError(r.error || 'this code has a syntax error', r.line);
      const wsJson = astToWorkspaceJson(r.ast as { fns: Record<string, unknown> });
      loadingRef.current = true;
      Blockly.serialization.workspaces.load(wsJson as object, ws);
      loadingRef.current = false;
      pyStash.current = null;
      setGenerated(generatePython(ws));
      setMode('blocks');
      setDirty(true);
      toast('Turned your code into blocks — comments were dropped');
      setTimeout(() => { Blockly.svgResize(ws); tidyWorkspace(ws, true); setGenerated(generatePython(ws)); }, 0);
    } catch (e) {
      loadingRef.current = false;
      const de = e as DecompileError;
      const reason = (de && de.message) || 'could not convert this code';
      const at = de && typeof de.line === 'number' ? ` (around line ${de.line})` : '';
      if (!window.confirm(
        `I couldn't turn this code into blocks: ${reason}${at}.\n\n`
        + 'Peek at Blocks anyway? Your typed code is kept safe — switch back to Advanced without touching the blocks and it will still be there. '
        + 'But if you EDIT the blocks, they become the bot and the typed code is discarded.'
      )) return;
      pyStash.current = {
        python: pyRef.current,
        blocksSnapshot: JSON.stringify(Blockly.serialization.workspaces.save(ws)),
      };
      setMode('blocks');
      setGenerated(generated);
      setTimeout(() => Blockly.svgResize(ws), 0);
    }
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
      const r = await api.post<RichCheck>('/check', { python });
      setCheck(r);
    } catch (ex) {
      setCheck({ ok: false, problems: [{ message: ex instanceof Error ? ex.message : 'check failed' }], notes: [] });
    } finally {
      setChecking(false);
    }
  };

  const handleSave = async () => { setSaving(true); try { await doSave(idxRef.current); } finally { setSaving(false); } };
  const renameCurrent = (v: string) => { setName(v); setDirty(true); };

  // ---------------------------------------------------------------- .py download / upload
  const downloadPy = () => {
    const ws = wsRef.current;
    const python = modeRef.current === 'blocks' && ws ? generatePython(ws) : pyRef.current;
    const fname = (nameRef.current || 'bot').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'bot';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([python], { type: 'text/x-python' }));
    a.download = `${fname}.py`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const fileInput = useRef<HTMLInputElement>(null);
  const uploadPy = async (file: File) => {
    const text = await file.text();
    if (!text.trim()) { toast('That file is empty.'); return; }
    const base = file.name.replace(/\.py$/i, '').replace(/[-_]+/g, ' ').trim().slice(0, 24);
    if (base) setName(base);
    setPythonText(text);
    pyHistory.current = [];
    setCheck(null);
    setDirty(true);
    setMode('python');
    // same treatment as opening a python slot: show blocks when we can
    autoDecompile(text, ++loadToken.current, true);
    toast(`Loaded ${file.name} into slot ${idxRef.current + 1} — hit Save to keep it`);
  };

  // ---------------------------------------------------------------- fullscreen
  const edMainRef = useRef<HTMLElement>(null);
  const [isFull, setIsFull] = useState(false);
  useEffect(() => {
    const onChange = () => {
      setIsFull(!!document.fullscreenElement);
      setTimeout(() => wsRef.current && Blockly.svgResize(wsRef.current), 50);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void edMainRef.current?.requestFullscreen().catch(() => {});
  };

  const codeForView = mode === 'blocks' ? generated : pythonText;
  const lineCount = codeForView.split('\n').length;

  // ---------------------------------------------------------------- render
  return (
    <div className="ed-wrap">
      {/* sidebar */}
      <aside className="ed-side coup-card">
        <h2 className="coup-h">Your Bots <small>{slots.length || '—'} slots</small></h2>
        <p className="coup-sub">Ten save slots. The ★ marks your <b>selected bot</b> — the one that
          plays for you in Levels and bot battles.</p>
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
              {s && s.python && (
                <span
                  role="button" tabIndex={-1}
                  className="ed-slot-star"
                  style={{
                    marginLeft: 'auto', fontSize: 17, lineHeight: 1, padding: '2px 4px',
                    color: i === selectedSlot ? 'var(--accent)' : 'var(--ink-mut)',
                    opacity: i === selectedSlot ? 1 : 0.45,
                  }}
                  title={i === selectedSlot ? 'Your selected bot' : 'Make this your selected bot'}
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (i === selectedSlot) return;
                    try {
                      await api.put('/bots/selected', { slot: i });
                      setSelectedSlot(i);
                      toast(`★ ${s.name} is now your selected bot`);
                    } catch (ex) {
                      toast(ex instanceof Error ? ex.message : 'could not select');
                    }
                  }}
                >{i === selectedSlot ? '★' : '☆'}</span>
              )}
            </button>
          ))}
          {slots.length === 0 && <div className="coup-note">Loading your slots…</div>}
        </div>
      </aside>

      {/* main editor */}
      <section className="ed-main" ref={edMainRef}>
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
            Other players see this name in matches. You are editing slot {idx + 1}
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
              <input ref={fileInput} type="file" accept=".py,text/x-python,text/plain" hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void uploadPy(f);
                }} />
              <button className="small" onClick={() => fileInput.current?.click()}
                title="Load a .py bot file into this slot">⬆ Upload .py</button>
              <button className="small" onClick={downloadPy}
                title="Save this bot to your computer as a .py file">⬇ Download .py</button>
              <button className="small" onClick={toggleFullscreen} title="Fill the whole screen with the editor">
                {isFull ? '✕ Exit full screen' : '⛶ Full screen'}
              </button>
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

        {/* check results — one compact small-font row under the toolbar */}
        {check && (
          <div className={`ed-checkline ${check.ok ? 'ok' : 'bad'}`}>
            <button className="ed-alert-x" onClick={() => setCheck(null)} aria-label="Dismiss">✕</button>
            <span className="lead">{check.ok ? '✓ Ready — legal moves in every test game.' : '🛠 Fix:'}</span>
            {check.functions && check.functions.map((f) => (
              <span key={f.fn} className={`ed-fnchip ${f.status}`}>
                <code>{f.fn}</code>{f.status === 'ok' ? ' ✓' : f.status === 'default' ? ' · default' : ' ✗'}
              </span>
            ))}
            {!check.ok && check.problems.map((p, i) => (
              <span key={i} className="prob">
                {p.fn ? `${p.fn} — ` : ''}{p.line != null ? `line ${p.line}: ` : ''}{p.message}
              </span>
            ))}
            {!check.ok && mode === 'blocks' && <span className="prob dim">(line numbers = Generated code panel)</span>}
          </div>
        )}

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
              character (<code>coup("duke")</code>, <code>assassinate("duke", 0.35)</code>). There are four
              characters — duke, assassin, ambassador, contessa. No imports, f-strings, or keyword args — pass
              values positionally.
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

      </section>
    </div>
  );
}
