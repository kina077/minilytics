import { lazy, Suspense, useState } from 'react';
import { qs } from '../lib/api';
import { useDash } from '../lib/context';
import { countryName, fmtDateTime, fmtDuration } from '../lib/format';
import { useApi } from '../lib/useApi';
import { BrowserIcon, DeviceIcon, Flag } from './Icons';
import { Modal } from './Modal';

const ReplayPlayer = lazy(() => import('./ReplayPlayer'));

interface ReplayRow {
  id: string;
  path: string | null;
  started_at: number;
  last_at: number;
  bytes: number;
  visitor_id: string;
  country: string | null;
  browser: string | null;
  os: string | null;
  device: string | null;
}

/** DomainToolBelt: session recordings from the data-replay pages, kept 7 days. */
export function ReplaysPanel() {
  const { site, q, reloadKey, openVisitor } = useDash();
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<ReplayRow | null>(null);
  const { data } = useApi<ReplayRow[]>(`/api/sites/${site.id}/replays?${qs({ ...q, filters: {} })}`, reloadKey);
  if (!data) return null;
  const rows = all ? data : data.slice(0, 10);

  return (
    <div className="card p-3">
      <div className="flex items-center justify-between px-3 pb-2 pt-1">
        <span className="font-semibold">Replays</span>
        <span className="text-xs text-stone-400">Last 7 days kept · typed text hidden</span>
      </div>
      {data.length === 0 && <p className="px-3 py-2 text-sm text-stone-400">No replays in this period</p>}
      <div className="space-y-1">
        {rows.map((r) => (
          <div key={r.id} className="flex h-10 items-center gap-3 rounded-lg px-3 text-[15px] hover:bg-stone-50">
            <button className="rounded-lg bg-stone-100 px-2.5 py-1 text-xs font-semibold hover:bg-stone-200" onClick={() => setOpen(r)}>
              Play
            </button>
            <span className="min-w-0 flex-1 truncate">{r.path ?? '/'}</span>
            <span className="hidden items-center gap-1.5 text-stone-500 sm:flex" title={countryName(r.country)}>
              <Flag cc={r.country} size={15} />
              <BrowserIcon name={r.browser} />
              <DeviceIcon name={r.device} />
            </span>
            <span className="w-14 shrink-0 text-right text-stone-500">{fmtDuration(r.last_at - r.started_at)}</span>
            <button className="hidden w-36 shrink-0 text-right text-sm text-stone-500 hover:text-ink sm:block" onClick={() => openVisitor(r.visitor_id)}>
              {fmtDateTime(r.started_at, site.timezone)}
            </button>
          </div>
        ))}
      </div>
      {data.length > 10 && (
        <button className="mx-auto mt-3 flex text-xs font-semibold uppercase tracking-wider text-stone-500 hover:text-ink" onClick={() => setAll((a) => !a)}>
          {all ? 'Show fewer' : `Show all ${data.length}`}
        </button>
      )}
      <Modal open={!!open} onClose={() => setOpen(null)} width="max-w-5xl" title={open?.path ?? 'Replay'}>
        {open && (
          <Suspense fallback={<div className="min-h-[200px]" />}>
            <ReplayPlayer siteId={site.id} id={open.id} />
          </Suspense>
        )}
      </Modal>
    </div>
  );
}
