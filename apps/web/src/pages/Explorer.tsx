import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Blocks,
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  FlaskConical,
  Globe,
  Loader2,
  Network,
  RotateCcw,
  Shield,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import type { BlockCheck, ChainReport, EventFamily } from '@breadcrumbs/shared';

import { api } from '../lib/api.ts';
import { verifyChainLocally, type LocalVerifyReport } from '../lib/verifyChain.ts';
import { dateTimeOf, eventLabel } from '../lib/format.ts';
import { Button, Card, EmptyState, ErrorNote, Spinner, cx } from '../components/ui/primitives.tsx';
import { HashText } from '../components/ledger/Crypto.tsx';
import { StatusBadge } from '../components/ledger/StatusBadge.tsx';
import { NetworkTopology } from '../components/ledger/NetworkTopology.tsx';
import { HistoryFilterToolbar, type DatePreset } from '../components/ledger/HistoryFilterToolbar.tsx';
import { PaginationBar } from '../components/ui/PaginationBar.tsx';

type ExplorerTab = 'blocks' | 'topology';

export function Explorer() {
  const queryClient = useQueryClient();
  const [family, setFamily] = useState<EventFamily | 'all'>('all');
  const [labOpen, setLabOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ExplorerTab>('blocks');

  // Search, filter, and pagination state
  const [search, setSearch] = useState('');
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [integrityFilter, setIntegrityFilter] = useState<'all' | 'broken' | 'valid'>('all');
  const [datePreset, setDatePreset] = useState<DatePreset>('all');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Server-side verification (existing)
  const blocksQuery = useQuery({
    queryKey: ['chain', 'blocks', family],
    queryFn: () => api.blocks(family === 'all' ? {} : { family }),
  });

  const verifyQuery = useQuery({ queryKey: ['chain', 'verify'], queryFn: api.verify });

  // Client-side local verification state
  const [localReport, setLocalReport] = useState<LocalVerifyReport | null>(null);
  const [localVerifying, setLocalVerifying] = useState(false);


  const invalidateEverything = () => {
    setLocalReport(null);
    queryClient.invalidateQueries({ predicate: () => true });
  };

  const verifyNow = useMutation({
    mutationFn: api.verify,
    onSuccess: (report) => queryClient.setQueryData(['chain', 'verify'], report),
  });

  const tamper = useMutation({
    mutationFn: api.tamper,
    onSuccess: () => invalidateEverything(),
  });

  const restore = useMutation({
    mutationFn: api.restore,
    onSuccess: () => invalidateEverything(),
  });

  const rebuild = useMutation({
    mutationFn: api.rebuild,
    onSuccess: () => invalidateEverything(),
  });

  const report = verifyNow.data ?? verifyQuery.data;
  const checks = new Map<number, BlockCheck>((report?.blocks ?? []).map((c) => [c.index, c]));

  /** Run client-side verification against the full raw block list. */
  const runLocalVerify = async () => {
    setLocalVerifying(true);
    try {
      const data = await api.rawBlocks();
      const sorted = [...data.blocks].sort((a, b) => a.index - b.index);
      const result = await verifyChainLocally(sorted);
      setLocalReport(result);
    } catch (err) {
      console.error('Local verification failed:', err);
    } finally {
      setLocalVerifying(false);
    }
  };

  const handleVerifyBoth = async () => {
    verifyNow.mutate();
    await runLocalVerify();
  };

  const rawBlocks = blocksQuery.data?.blocks ?? [];
  const now = Date.now();
  const dateThreshold =
    datePreset === 'today'
      ? now - 24 * 3600 * 1000
      : datePreset === '7d'
        ? now - 7 * 24 * 3600 * 1000
        : datePreset === '30d'
          ? now - 30 * 24 * 3600 * 1000
          : 0;

  const filteredBlocks = rawBlocks.filter((block) => {
    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      const match =
        block.index.toString().includes(q) ||
        block.block_hash.toLowerCase().includes(q) ||
        block.previous_block_hash.toLowerCase().includes(q) ||
        block.event_id.toLowerCase().includes(q) ||
        block.event_type.toLowerCase().includes(q) ||
        block.factory_name.toLowerCase().includes(q) ||
        block.submitter_name.toLowerCase().includes(q);
      if (!match) return false;
    }

    // Status
    if (selectedStatuses.length > 0 && !selectedStatuses.includes(block.status)) {
      return false;
    }

    // Date
    if (dateThreshold > 0 && new Date(block.timestamp).getTime() < dateThreshold) {
      return false;
    }

    // Integrity
    if (integrityFilter !== 'all') {
      const check = checks.get(block.index);
      const broken = check
        ? !check.hashValid || !check.linkValid || !check.signatureValid
        : false;
      const downstream = check?.invalidatedByEarlierBreak ?? false;
      const isCompromised = broken || downstream;

      if (integrityFilter === 'broken' && !isCompromised) return false;
      if (integrityFilter === 'valid' && isCompromised) return false;
    }

    return true;
  });

  const sortedBlocks = [...filteredBlocks].sort((a, b) =>
    sortOrder === 'asc' ? a.index - b.index : b.index - a.index,
  );

  const totalPages = Math.ceil(sortedBlocks.length / pageSize) || 1;
  const pagedBlocks = sortedBlocks.slice((page - 1) * pageSize, page * pageSize);

  const activeFiltersCount =
    (search ? 1 : 0) +
    (family !== 'all' ? 1 : 0) +
    selectedStatuses.length +
    (integrityFilter !== 'all' ? 1 : 0) +
    (datePreset !== 'all' ? 1 : 0);

  const resetFilters = () => {
    setSearch('');
    setFamily('all');
    setSelectedStatuses([]);
    setIntegrityFilter('all');
    setDatePreset('all');
    setPage(1);
  };

  return (

    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[1.6rem] text-navy">Ledger explorer</h1>
          <p className="mt-1 max-w-2xl text-[0.88rem] text-ink-muted">
            Every block, in the order it was written. Verification recomputes each hash, re-checks
            each link to the block before it, and re-verifies each signature.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() => void api.exportTransactions({ format: 'csv' })}
            title="Download human-readable ledger spreadsheet (CSV) for Excel or Google Sheets"
          >
            <FileSpreadsheet size={15} aria-hidden />
            Export CSV (Spreadsheet)
          </Button>
          <Button
            variant="outline"
            onClick={() => void api.exportTransactions({ format: 'json' })}
            title="Download full machine-verifiable cryptographic ledger snapshot as JSON"
          >
            <FileText size={15} aria-hidden />
            Export JSON
          </Button>
          <Button
            variant="primary"
            onClick={() => void handleVerifyBoth()}
            loading={verifyNow.isPending || localVerifying}
          >
            <ShieldCheck size={15} aria-hidden />
            Verify chain integrity
          </Button>
        </div>
      </header>

      {/* Dual-Attestation Panel */}
      {(report || localReport) && (
        <DualAttestationPanel
          serverReport={report ?? null}
          localReport={localReport}
          localVerifying={localVerifying}
        />
      )}

      {/* --------------------------------------------------- integrity lab */}
      <Card>
        <button
          type="button"
          onClick={() => setLabOpen((open) => !open)}
          aria-expanded={labOpen}
          className="flex w-full items-center gap-2.5 px-5 py-3.5 text-left transition-colors hover:bg-parchment-deep"
        >
          <FlaskConical size={15} className="shrink-0 text-gold" aria-hidden />
          <span className="flex-1">
            <span className="block text-[0.9rem] font-semibold text-navy">Integrity lab</span>
            <span className="block text-[0.78rem] text-ink-muted">
              Alter a committed block and watch verification catch it.
            </span>
          </span>
          <span className="text-[0.75rem] text-ink-faint">{labOpen ? 'Hide' : 'Open'}</span>
        </button>

        {labOpen ? (
          <div className="border-t border-hairline px-5 py-4">
            <p className="max-w-3xl text-[0.82rem] leading-relaxed text-ink-muted">
              This rewrites one block&rsquo;s data directly in the database and deliberately leaves
              its stored hash alone — exactly what someone with database access would do. It is the
              only thing in this application that mutates a committed block, and it exists so the
              verification can be seen doing real work. Where the altered field feeds a balance, the
              derived stock or invoice figures will visibly shift too.
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <TamperControl onTamper={(index) => tamper.mutate(index)} pending={tamper.isPending} />
              <Button variant="outline" onClick={() => restore.mutate()} loading={restore.isPending}>
                <RotateCcw size={14} aria-hidden />
                Restore clean ledger
              </Button>
              <Button variant="ghost" onClick={() => rebuild.mutate()} loading={rebuild.isPending}>
                Rebuild projections from chain
              </Button>
            </div>

            {tamper.data ? (
              <div className="mt-4 rounded-md border border-clay/30 bg-clay-soft px-4 py-3 text-[0.8rem] text-clay">
                Block {tamper.data.tampered.block_index} ({tamper.data.tampered.event_id}) —{' '}
                <span className="font-medium">{tamper.data.tampered.field}</span> changed from{' '}
                <span className="font-mono">{String(tamper.data.tampered.before)}</span> to{' '}
                <span className="font-mono">{String(tamper.data.tampered.after)}</span>. Run
                verification again.
              </div>
            ) : null}

            {rebuild.data ? (
              <div className="mt-4 rounded-md border border-teal/30 bg-teal-soft px-4 py-3 text-[0.8rem] text-teal">
                Replayed {rebuild.data.replayed} blocks. Every stock level, invoice balance and
                contract status on this site was just recomputed from the chain alone — if none of
                the figures moved, they were genuinely derived from it.
              </div>
            ) : null}

            {tamper.error ? (
              <div className="mt-4">
                <ErrorNote message={(tamper.error as Error).message} />
              </div>
            ) : null}
          </div>
        ) : null}
      </Card>

      {/* Tab switcher */}
      <div className="flex gap-1 rounded-[var(--radius-card)] border border-hairline bg-parchment p-1">
        <TabButton
          active={activeTab === 'blocks'}
          onClick={() => setActiveTab('blocks')}
          icon={<Blocks size={14} aria-hidden />}
        >
          Ledger Blocks
        </TabButton>
        <TabButton
          active={activeTab === 'topology'}
          onClick={() => setActiveTab('topology')}
          icon={<Network size={14} aria-hidden />}
        >
          Consensus &amp; Network Topology
        </TabButton>
      </div>

      {activeTab === 'topology' ? (
        <NetworkTopology />
      ) : (
        <>
          {/* ---------------------------------------------------------- unified filter toolbar */}
          <HistoryFilterToolbar
            search={search}
            onSearchChange={(s) => {
              setSearch(s);
              setPage(1);
            }}
            searchPlaceholder="Search blocks by index (#), hash, submitter, factory, or event..."
            selectedStatuses={selectedStatuses}
            onStatusToggle={(s) => {
              setSelectedStatuses((curr) =>
                curr.includes(s) ? curr.filter((x) => x !== s) : [...curr, s],
              );
              setPage(1);
            }}
            selectedFamily={family}
            onFamilySelect={(fam) => {
              setFamily(fam);
              setPage(1);
            }}
            datePreset={datePreset}
            onDatePresetChange={(dp) => {
              setDatePreset(dp);
              setPage(1);
            }}
            sortOrder={sortOrder}
            onSortOrderToggle={() => setSortOrder((o) => (o === 'desc' ? 'asc' : 'desc'))}
            activeFilterCount={activeFiltersCount}
            onResetAll={resetFilters}
          />

          {/* Cryptographic Integrity filter chips */}
          <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-hairline bg-surface p-3 text-[0.78rem]">
            <span className="text-[0.72rem] font-semibold uppercase tracking-wide text-ink-faint">
              Chain Integrity Filter:
            </span>
            <button
              type="button"
              onClick={() => {
                setIntegrityFilter('all');
                setPage(1);
              }}
              className={cx(
                'rounded-[var(--radius-pill)] border px-2.5 py-0.5 transition-colors',
                integrityFilter === 'all'
                  ? 'border-navy bg-navy text-parchment font-medium'
                  : 'border-hairline bg-surface text-ink-muted hover:border-hairline-strong hover:text-navy',
              )}
            >
              All Blocks ({rawBlocks.length})
            </button>
            <button
              type="button"
              onClick={() => {
                setIntegrityFilter('broken');
                setPage(1);
              }}
              className={cx(
                'inline-flex items-center gap-1 rounded-[var(--radius-pill)] border px-2.5 py-0.5 transition-colors',
                integrityFilter === 'broken'
                  ? 'border-clay bg-clay text-parchment font-medium'
                  : 'border-clay/40 bg-clay-soft text-clay hover:border-clay',
              )}
            >
              <AlertTriangle size={12} />
              Broken / Tampered Only
            </button>
            <button
              type="button"
              onClick={() => {
                setIntegrityFilter('valid');
                setPage(1);
              }}
              className={cx(
                'inline-flex items-center gap-1 rounded-[var(--radius-pill)] border px-2.5 py-0.5 transition-colors',
                integrityFilter === 'valid'
                  ? 'border-teal bg-teal text-parchment font-medium'
                  : 'border-teal/40 bg-teal-soft text-teal hover:border-teal',
              )}
            >
              <CheckCircle2 size={12} />
              Valid Blocks Only
            </button>
          </div>

          {/* ---------------------------------------------------------- blocks */}
          {blocksQuery.isPending ? (
            <Spinner label="Loading the chain" />
          ) : blocksQuery.isError ? (
            <ErrorNote
              title="Could not load the chain"
              message={(blocksQuery.error as Error).message}
            />
          ) : sortedBlocks.length === 0 ? (
            <EmptyState
              title="No blocks match filter"
              description="Try broadening your search term or resetting active filters."
            />
          ) : (
            <div className="space-y-2">
              <div className="overflow-x-auto rounded-[var(--radius-card)] border border-hairline bg-surface">
                <table className="w-full min-w-[52rem] text-left text-[0.82rem]">
                  <thead>
                    <tr>
                      {[
                        { id: 'index', label: '#' },
                        { id: 'event', label: 'Event' },
                        { id: 'factory', label: 'Factory' },
                        { id: 'submitter', label: 'Submitted by' },
                        { id: 'prev_hash', label: 'Previous hash' },
                        { id: 'block_hash', label: 'Block hash' },
                        { id: 'status', label: 'Status' },
                        { id: 'integrity', label: 'Integrity' },
                      ].map((col) => (
                        <th
                          key={col.id}
                          scope="col"
                          className="border-b border-hairline px-3 py-2.5 text-[0.68rem] font-semibold uppercase tracking-wide text-ink-muted"
                        >
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pagedBlocks.map((block) => {
                      const check = checks.get(block.index);
                      const broken = check
                        ? !check.hashValid || !check.linkValid || !check.signatureValid
                        : false;
                      const downstream = check?.invalidatedByEarlierBreak ?? false;

                      return (
                        <tr
                          key={block.index}
                          className={cx(
                            'transition-colors hover:bg-parchment/60',
                            broken && 'bg-clay-soft/70',
                            !broken && downstream && 'bg-gold-soft/40',
                          )}
                        >
                          <td className="border-b border-hairline/60 px-3 py-2.5 tabular text-ink-faint">
                            {block.index}
                          </td>
                          <td className="border-b border-hairline/60 px-3 py-2.5">
                            <Link
                              to={`/record/${encodeURIComponent(block.event_id)}`}
                              state={{ from: '/explorer', label: 'Explorer' }}
                              viewTransition
                              className="font-medium text-navy hover:underline"
                            >
                              {eventLabel(block.event_type)}
                            </Link>
                            <p className="text-[0.7rem] text-ink-faint">{dateTimeOf(block.timestamp)}</p>
                          </td>
                          <td className="border-b border-hairline/60 px-3 py-2.5 text-ink-muted">
                            {block.factory_name}
                          </td>
                          <td className="border-b border-hairline/60 px-3 py-2.5 text-ink-muted">
                            {block.submitter_name}
                          </td>
                          <td className="border-b border-hairline/60 px-3 py-2.5">
                            <HashText value={block.previous_block_hash} label="Previous hash" lead={6} tail={4} />
                          </td>
                          <td className="border-b border-hairline/60 px-3 py-2.5">
                            <HashText value={block.block_hash} label="Block hash" lead={6} tail={4} />
                          </td>
                          <td className="border-b border-hairline/60 px-3 py-2.5">
                            <StatusBadge status={block.status} size="sm" compact />
                          </td>
                          <td className="border-b border-hairline/60 px-3 py-2.5">
                            <IntegrityCell check={check} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination controls */}
              <PaginationBar
                page={page}
                totalPages={totalPages}
                totalItems={sortedBlocks.length}
                pageSize={pageSize}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Dual-Attestation Panel */

function DualAttestationPanel({
  serverReport,
  localReport,
  localVerifying,
}: {
  serverReport: ChainReport | null;
  localReport: LocalVerifyReport | null;
  localVerifying: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {/* Server attestation */}
      <div
        className={cx(
          'rounded-[var(--radius-card)] border p-4',
          serverReport
            ? serverReport.ok
              ? 'border-teal/30 bg-teal-soft'
              : 'border-clay/30 bg-clay-soft'
            : 'border-hairline bg-surface',
        )}
      >
        <div className="flex items-center gap-2 mb-2">
          <Globe size={16} className="shrink-0 text-ink-muted" aria-hidden />
          <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-ink-muted">
            Server Report
          </p>
        </div>
        {serverReport ? (
          <>
            <p
              className={cx(
                'flex items-center gap-2 font-semibold text-[0.9rem]',
                serverReport.ok ? 'text-teal' : 'text-clay',
              )}
            >
              {serverReport.ok ? <ShieldCheck size={16} aria-hidden /> : <ShieldAlert size={16} aria-hidden />}
              {serverReport.ok ? '200 OK (Clean)' : 'Integrity Failure Reported'}
            </p>
            <p className="mt-1 text-[0.74rem] text-ink-muted">
              {serverReport.height} blocks · checked at server
            </p>
            <p className="mt-0.5 text-[0.7rem] text-ink-faint">
              ⚠ Server-side only — a corrupted server can report false results
            </p>
          </>
        ) : (
          <p className="text-[0.82rem] text-ink-muted">Run verification to see server report.</p>
        )}
      </div>

      {/* Client-side attestation */}
      <div
        className={cx(
          'rounded-[var(--radius-card)] border p-4',
          localVerifying
            ? 'border-gold/30 bg-gold-soft/40'
            : localReport
              ? localReport.ok
                ? 'border-teal/30 bg-teal-soft'
                : 'border-clay/30 bg-clay-soft'
              : 'border-hairline bg-surface',
        )}
      >
        <div className="flex items-center gap-2 mb-2">
          <Shield size={16} className="shrink-0 text-ink-muted" aria-hidden />
          <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-ink-muted">
            Local Client Verification
          </p>
        </div>
        {localVerifying ? (
          <p className="flex items-center gap-2 text-[0.88rem] font-semibold text-[#8a6d24]">
            <Loader2 size={15} className="animate-spin" aria-hidden />
            Running in-browser…
          </p>
        ) : localReport ? (
          <>
            <p
              className={cx(
                'flex items-center gap-2 font-semibold text-[0.9rem]',
                localReport.ok ? 'text-teal' : 'text-clay',
              )}
            >
              {localReport.ok ? <ShieldCheck size={16} aria-hidden /> : <ShieldAlert size={16} aria-hidden />}
              {localReport.ok
                ? `${localReport.height}/${localReport.height} Blocks Verified on this Device`
                : `${localReport.brokenCount} Block${localReport.brokenCount !== 1 ? 's' : ''} Failed Verification`}
            </p>
            <p className="mt-1 text-[0.74rem] text-ink-muted">
              {localReport.durationMs}ms · SHA-256 + ECDSA P-256 · window.crypto.subtle
            </p>
            <p className={cx('mt-0.5 text-[0.7rem]', localReport.ok ? 'text-teal' : 'text-clay font-medium')}>
              {localReport.ok
                ? '✓ Mathematically verified in this browser — server cannot falsify this result'
                : `✗ Cryptographic violation detected locally starting at block #${localReport.firstBreakIndex ?? '?'}`}
            </p>
          </>
        ) : (
          <p className="text-[0.82rem] text-ink-muted">
            Click &quot;Verify chain integrity&quot; to run local cryptographic proof.
          </p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ fragments */

function IntegrityCell({ check }: { check: BlockCheck | undefined }) {
  if (!check) {
    return <span className="text-[0.72rem] text-ink-faint">not checked</span>;
  }

  const failures: string[] = [];
  if (!check.hashValid) failures.push('hash');
  if (!check.linkValid) failures.push('link');
  if (!check.signatureValid) failures.push('signature');

  if (failures.length > 0) {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[0.72rem] font-medium text-clay">
        <AlertTriangle size={12} aria-hidden />
        {failures.join(' + ')} failed
      </span>
    );
  }

  if (check.invalidatedByEarlierBreak) {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[0.72rem] font-medium text-[#8a6d24]">
        <AlertTriangle size={12} aria-hidden />
        invalidated upstream
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[0.72rem] text-teal">
      <CheckCircle2 size={12} aria-hidden />
      intact
    </span>
  );
}

function TamperControl({
  onTamper,
  pending,
}: {
  onTamper: (index: number) => void;
  pending: boolean;
}) {
  const [value, setValue] = useState('40');

  return (
    <div className="flex items-center gap-2">
      <label className="flex items-center gap-2 text-[0.78rem] text-ink-muted">
        Block
        <input
          type="number"
          min={1}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="w-20 rounded-md border border-hairline-strong bg-surface px-2 py-1.5 text-[0.8rem] tabular"
        />
      </label>
      <Button variant="danger" onClick={() => onTamper(Number(value))} loading={pending}>
        <Blocks size={14} aria-hidden />
        Tamper with this block
      </Button>
    </div>
  );
}


function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2 text-[0.82rem] font-medium transition-colors',
        active
          ? 'bg-surface text-navy shadow-[var(--shadow-card)]'
          : 'text-ink-muted hover:text-navy',
      )}
    >
      {icon}
      {children}
    </button>
  );
}
