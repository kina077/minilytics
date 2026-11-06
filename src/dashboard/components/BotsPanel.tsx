import { useState } from 'react';
import { qs } from '../lib/api';
import { useDash } from '../lib/context';
import { fmtNumber } from '../lib/format';
import { useApi } from '../lib/useApi';

interface BotRow {
  bot: string;
  category: string | null;
  visits: number;
  pages: number;
}

/** DomainToolBelt: Cloudflare-verified bots that loaded pages in the period. Bots never run the tracker, so they
 *  are not in any other number on the dashboard. */
export function BotsPanel() {
  const { site, q, reloadKey } = useDash();
  const [all, setAll] = useState(false);
  const { data } = useApi<{ configured: boolean; bots: BotRow[] }>(`/api/sites/${site.id}/bots?${qs({ ...q, filters: {} })}`, reloadKey);
  if (!data) return null;
  const rows = all ? data.bots : data.bots.slice(0, 8);
  const max = Math.max(1, ...data.bots.map((b) => b.visits));

  return (
    <div className="mt-4 border-t border-stone-100 pt-3">
      <div className="flex items-center justify-between px-3 pb-2 text-xs font-medium uppercase tracking-wider text-stone-400">
        <span title="Verified by Cloudflare (IP and reverse DNS checked), so fake bot user agents are not counted">Verified bots</span>
        <span className="flex gap-6">
          <span>Visits</span>
          <span className="w-10 text-right">Pages</span>
        </span>
      </div>
      {!data.configured && <p className="px-3 py-2 text-sm text-stone-400">Add CF_ANALYTICS_TOKEN to the Worker to see bots.</p>}
      {data.configured && data.bots.length === 0 && <p className="px-3 py-2 text-sm text-stone-400">No bot visits in this period</p>}
      <div className="space-y-1">
        {rows.map((b) => (
          <div key={b.bot} className="relative flex h-10 items-center rounded-lg" title={b.category ?? undefined}>
            <div className="absolute inset-y-0 left-0 rounded-lg bg-stone-100" style={{ width: `${(b.visits / max) * 100}%`, minWidth: 4 }} />
            <div className="relative flex min-w-0 flex-1 items-baseline gap-2 px-3 text-[15px]">
              <span className="truncate">{b.bot}</span>
              {b.category && <span className="hidden truncate text-xs text-stone-400 sm:inline">{b.category}</span>}
            </div>
            <div className="relative flex shrink-0 gap-6 pr-3 text-[15px] font-medium">
              <span>{fmtNumber(b.visits)}</span>
              <span className="w-10 text-right text-stone-500">{fmtNumber(b.pages)}</span>
            </div>
          </div>
        ))}
      </div>
      {data.bots.length > 8 && (
        <button className="mx-auto mt-3 flex text-xs font-semibold uppercase tracking-wider text-stone-500 hover:text-ink" onClick={() => setAll((a) => !a)}>
          {all ? 'Show fewer' : `Show all ${data.bots.length}`}
        </button>
      )}
    </div>
  );
}
