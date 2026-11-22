import { useEffect, useRef, useState } from 'react';
import RRPlayer from 'rrweb-player';
import 'rrweb-player/dist/style.css';
import { api } from '../lib/api';

const LIVE_POLL_MS = 10_000;

type Events = { next: number; events: any[] };
// svelte types aren't installed (the player bundles svelte), so these aren't typed on the class
type Instance = { $destroy(): void; addEvent(e: any): void };

/** Loaded with React.lazy: the player (~100 KB gzip) is only downloaded when a replay is opened.
 *  `live`: the visit may still be going, so keep pulling new parts (the recorder sends every 30 s). */
export default function ReplayPlayer({ siteId, id, live }: { siteId: string; id: string; live?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let player: Instance | undefined;
    let alive = true;
    let next = 0;
    let timer: ReturnType<typeof setInterval> | undefined;
    const url = () => `/api/sites/${siteId}/replays/${id}?from=${next}`;
    api<Events>(url())
      .then((r) => {
        if (!alive || !box.current) return;
        if (r.events.length < 2) return setError(live ? 'Recording has just started. Try again in 30 seconds.' : 'This replay has no page snapshot yet.');
        next = r.next;
        const width = Math.min(box.current.clientWidth, 960);
        player = new RRPlayer({
          target: box.current,
          props: { events: r.events, width, height: Math.round(width * 0.56), autoPlay: true, skipInactive: !live },
        }) as unknown as Instance;
        if (live) {
          timer = setInterval(() => {
            if (document.visibilityState !== 'visible') return;
            api<Events>(url())
              .then((more) => {
                if (!alive || !player) return;
                next = more.next;
                for (const e of more.events) player.addEvent(e);
              })
              .catch(() => {});
          }, LIVE_POLL_MS);
        }
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
      clearInterval(timer);
      player?.$destroy();
    };
  }, [siteId, id, live]);

  return error ? <p className="text-sm text-stone-500">{error}</p> : <div ref={box} className="min-h-[200px] w-full" />;
}
