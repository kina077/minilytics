import { lazy, Suspense, useState } from 'react';
import { qs } from '../lib/api';
import { useDash } from '../lib/context';
import { countryName, fmtDateTime, fmtDuration } from '../lib/format';
import { useApi } from '../lib/useApi';
import { BrowserIcon, DeviceIcon, Flag } from './Icons';
import { Modal } from './Modal';

const ReplayPlayer = lazy(() => import('./ReplayPlayer'));

export interface ReplayRow {
  id: string;
  session_id: string;
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

/** DomainToolBelt: session recordings from the data-replay pages that match the dashboard filters, kept 7 days. */
export function ReplaysPanel() {
  const { site, q, reloadKey, openVisitor } = useDash();
  const [all, setAll] = useState(false);
  const { data } = useApi<ReplayRow[]>(`/api/sites/${site.id}/replays?${qs(q)}`, reloadKey);
  if (!data) return null;

  return (
    <div className="card p-3">
      <div className="flex items-center justify-between px-3 pb-2 pt-1">
        <span className="font-semibold">Replays</span>
        <span className="text-xs text-stone-400">Last 7 days kept · typed text hidden</span>
      </div>
      {data.length === 0 && <p className="px-3 py-2 text-sm text-stone-400">No replays for this period and these filters</p>}
      <ReplayList rows={all ? data : data.slice(0, 10)} onVisitor={openVisitor} />
      {data.length > 10 && (
        <button className="mx-auto mt-3 flex text-xs font-semibold uppercase tracking-wider text-stone-500 hover:text-ink" onClick={() => setAll((a) => !a)}>
          {all ? 'Show fewer' : `Show all ${data.length}`}
        </button>
      )}
    </div>
  );
}

/** Rows with a Play button; also used in the visitor profile (no onVisitor there). */
export function ReplayList({ rows, onVisitor }: { rows: ReplayRow[]; onVisitor?: (vid: string) => void }) {
  const { site } = useDash();
  const [open, setOpen] = useState<ReplayRow | null>(null);
  return (
    <>
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
            <button
              className="hidden w-36 shrink-0 text-right text-sm text-stone-500 enabled:hover:text-ink sm:block"
              disabled={!onVisitor}
              onClick={() => onVisitor?.(r.visitor_id)}
            >
              {fmtDateTime(r.started_at, site.timezone)}
            </button>
          </div>
        ))}
      </div>
      <ReplayModal replay={open} onClose={() => setOpen(null)} />
    </>
  );
}

/** A replay is "live" while its visit may still be going: the last part arrived under 2 minutes ago. */
const LIVE_MS = 2 * 60_000;

/** The player in a modal. Also opened from the visitor profile and the Live list. */
export function ReplayModal({ replay, onClose }: { replay: { id: string; path?: string | null; last_at?: number; live?: boolean } | null; onClose: () => void }) {
  const { site } = useDash();
  const live = !!replay && (replay.live || (replay.last_at !== undefined && Date.now() - replay.last_at < LIVE_MS));
  return (
    <Modal open={!!replay} onClose={onClose} width="max-w-5xl" title={(replay?.path ?? 'Replay') + (live ? ' · live, about 30 s behind' : '')}>
      {replay && (
        <Suspense fallback={<div className="min-h-[200px]" />}>
          <ReplayPlayer siteId={site.id} id={replay.id} live={live} />
        </Suspense>
      )}
    </Modal>
  );
}

/** Small play triangle, the same everywhere a replay can be opened. */
export function PlayIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 2.5v11l9-5.5z" fill="currentColor" />
    </svg>
  );
}
