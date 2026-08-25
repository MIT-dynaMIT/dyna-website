import { useEffect, useState } from 'react';
import { api } from './api';

/**
 * A bufo, hiding. Three are tucked around the app; tickling all three is an
 * achievement.
 *
 * It renders fully TRANSPARENT and only fades in while the pointer is over it,
 * so it cannot be spotted by reading the page — you find it by wandering. The
 * cursor stays an arrow on purpose: a pointer would give the game away a whole
 * hover early. Once tickled it stays visible for good (remembered locally),
 * because finding a frog should feel like keeping it.
 *
 * The alt text is deliberately empty — a screen reader should not be made to
 * read out the answer, and the button carries its own label.
 */
const KEY = 'coup_bufos';

/** which frog hides where — thematic, so finding one feels earned */
const ART: Record<string, string> = {
  editor: '/bufo/hacker.png',       // the Bot Editor
  levels: '/bufo/magician.png',     // the house bosses, all smoke and mirrors
  matches: '/bufo/detective.png',   // poring over replays
};

function remembered(): string[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}

export default function Bufo({ id, style }: { id: string; style?: React.CSSProperties }) {
  const [found, setFound] = useState(false);
  const [wiggle, setWiggle] = useState(false);

  useEffect(() => { setFound(remembered().includes(id)); }, [id]);

  const tickle = () => {
    setWiggle(true);
    setTimeout(() => setWiggle(false), 800);
    if (found) return;
    setFound(true);
    try {
      localStorage.setItem(KEY, JSON.stringify(Array.from(new Set([...remembered(), id]))));
    } catch { /* private mode: the server still holds the real record */ }
    api.post('/achievements/bufo', { id }).catch(() => {});
  };

  return (
    <button
      type="button"
      className={`bufo ${found ? 'found' : ''} ${wiggle ? 'wiggle' : ''}`}
      style={style}
      onClick={tickle}
      aria-label={found ? 'a bufo you have already tickled' : 'a hidden bufo'}
    >
      <img src={ART[id] || '/bufo/duke.png'} alt="" draggable={false} />
    </button>
  );
}
