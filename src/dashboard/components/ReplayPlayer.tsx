import { useEffect, useRef, useState } from 'react';
import RRPlayer from 'rrweb-player';
import 'rrweb-player/dist/style.css';
import { api } from '../lib/api';

/** Loaded with React.lazy: the player (~100 KB gzip) is only downloaded when a replay is opened. */
export default function ReplayPlayer({ siteId, id }: { siteId: string; id: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let player: { $destroy(): void } | undefined;
    let alive = true;
    api<any[]>(`/api/sites/${siteId}/replays/${id}`)
      .then((events) => {
        if (!alive || !box.current) return;
        if (events.length < 2) return setError('This replay has no page snapshot yet.');
        const width = Math.min(box.current.clientWidth, 960);
        // svelte types aren't installed (the player bundles svelte), so $destroy isn't typed
        player = new RRPlayer({ target: box.current, props: { events, width, height: Math.round(width * 0.56), autoPlay: true, skipInactive: true } }) as unknown as { $destroy(): void };
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
      player?.$destroy();
    };
  }, [siteId, id]);

  return error ? <p className="text-sm text-stone-500">{error}</p> : <div ref={box} className="min-h-[200px] w-full" />;
}
