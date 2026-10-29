import { useCallback, useEffect, useState } from 'react';
import { displayName } from '../../shared/names';
import { api } from '../lib/api';
import { useDash } from '../lib/context';
import { countryName, fmtAgo } from '../lib/format';
import { Avatar, DeviceIcon, Flag, SourceIcon } from './Icons';

interface LiveVisitor {
  visitor_id: string;
  country: string | null;
  city: string | null;
  device: string | null;
  source: string;
  page: string | null;
  last_seen_at: number;
  pageviews: number;
  name: string | null;
  email: string | null;
}

interface FeedItem {
  id: string;
  ts: number;
  type: 'pageview' | 'goal' | 'payment' | 'refund';
  label?: string;
  amount?: number;
  visitor_id: string | null;
  name: string | null;
  country: string | null;
}

interface Realtime {
  visitors: LiveVisitor[];
  feed: FeedItem[];
}

const POLL_MS = 10_000;
const FEED_ROWS = 12;

/** Who is on the site right now and the last 30 minutes of activity, without opening the map. */
export function LivePanel({ onMap }: { onMap: () => void }) {
  const { site, money, openVisitor } = useDash();
  const [data, setData] = useState<Realtime | null>(null);
  const [error, setError] = useState(false);
  const [, tick] = useState(0);

  const load = useCallback(async () => {
    try {
      setData(await api<Realtime>(`/api/sites/${site.id}/realtime`));
      setError(false);
    } catch {
      setError(true);
    }
  }, [site.id]);

  // Poll only while the tab is visible, and refresh as soon as it comes back.
  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') load();
      else tick((n) => n + 1);
    }, POLL_MS);
    const onVis = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [load]);

  const visitors = data?.visitors ?? [];
  const feed = (data?.feed ?? []).slice(0, FEED_ROWS);

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between gap-2 pb-3">
        <div className="flex items-center gap-2 font-semibold">
          <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
          Live now
          <span className="text-sm font-normal text-stone-500">
            {data ? `${visitors.length} on the site` : ''}
          </span>
        </div>
        <button className="rounded-lg px-2 py-1 text-sm text-stone-500 hover:bg-stone-100 hover:text-ink" onClick={onMap}>
          Open map
        </button>
      </div>
      {error && (
        <p className="text-sm text-stone-500">
          Couldn't load live visitors.{' '}
          <button className="underline" onClick={load}>
            Try again
          </button>
        </p>
      )}
      {!data && !error && <div className="h-24 animate-pulse rounded-xl bg-stone-100" />}
      {data && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <div className="pb-1 text-xs font-medium uppercase tracking-wider text-stone-400">On the site</div>
            {visitors.length === 0 && <p className="py-2 text-sm text-stone-500">Nobody right now.</p>}
            <div className="max-h-72 overflow-y-auto">
              {visitors.map((v) => (
                <button
                  key={v.visitor_id}
                  onClick={() => openVisitor(v.visitor_id)}
                  className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left text-sm hover:bg-stone-100"
                >
                  <Avatar id={v.visitor_id} size={26} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 font-medium">
                      <span className="truncate">{displayName(v.visitor_id, v.name, v.email)}</span>
                      <Flag cc={v.country} size={14} />
                      <DeviceIcon name={v.device} size={14} />
                      <SourceIcon source={v.source} size={14} />
                    </span>
                    <span className="block truncate text-xs text-stone-500">
                      on <code>{v.page ?? '/'}</code> · {v.pageviews} page{v.pageviews === 1 ? '' : 's'}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-stone-400">{fmtAgo(Date.now() - v.last_seen_at)}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="pb-1 text-xs font-medium uppercase tracking-wider text-stone-400">Last 30 minutes</div>
            {feed.length === 0 && <p className="py-2 text-sm text-stone-500">No activity in the last 30 minutes.</p>}
            <div className="max-h-72 overflow-y-auto">
              {feed.map((f) => (
                <button
                  key={f.id}
                  disabled={!f.visitor_id}
                  onClick={() => f.visitor_id && openVisitor(f.visitor_id)}
                  className="flex w-full items-start gap-2 rounded-lg px-1.5 py-1 text-left text-[13px] leading-snug hover:bg-stone-100"
                >
                  <span className="mt-0.5 shrink-0">{f.type === 'payment' ? '💳' : f.type === 'refund' ? '↩️' : f.type === 'goal' ? '🎯' : '👁'}</span>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{f.visitor_id ? displayName(f.visitor_id, f.name) : f.name ?? 'Someone'}</span>
                    {f.country && <span className="text-stone-500"> from {countryName(f.country)}</span>}{' '}
                    {f.type === 'pageview' && (
                      <>
                        visited <code>{f.label}</code>
                      </>
                    )}
                    {f.type === 'goal' && <span className="text-violet-500">{f.label}</span>}
                    {f.type === 'payment' && <span className="font-semibold text-emerald-600">paid {money(f.amount ?? 0)}</span>}
                    {f.type === 'refund' && <>refunded {money(Math.abs(f.amount ?? 0))}</>}
                  </span>
                  <span className="shrink-0 text-xs text-stone-400">{fmtAgo(Date.now() - f.ts)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
