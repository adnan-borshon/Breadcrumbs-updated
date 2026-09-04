import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Blocks,
  CheckCircle2,
  FlaskConical,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { EVENT_FAMILIES, FAMILY_LABEL } from '@breadcrumbs/shared';
import type { BlockCheck, ChainReport, EventFamily } from '@breadcrumbs/shared';

import { api } from '../lib/api.ts';
import { dateTimeOf, eventLabel } from '../lib/format.ts';
import { Button, Card, ErrorNote, Spinner, Stat, cx } from '../components/ui/primitives.tsx';
import { HashText } from '../components/ledger/Crypto.tsx';
import { StatusBadge } from '../components/ledger/StatusBadge.tsx';

export function Explorer() {
  const queryClient = useQueryClient();
  const [family, setFamily] = useState<EventFamily | 'all'>('all');
  const [labOpen, setLabOpen] = useState(false);

  const blocksQuery = useQuery({
    queryKey: ['chain', 'blocks', family],
    queryFn: () => api.blocks(family === 'all' ? {} : { family }),
  });

  const verifyQuery = useQuery({ queryKey: ['chain', 'verify'], queryFn: api.verify });

  const invalidateEverything = () =>
    queryClient.invalidateQueries({ predicate: () => true });

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
        <Button
          variant="primary"
          onClick={() => verifyNow.mutate()}
          loading={verifyNow.isPending}
        >
          <ShieldCheck size={15} aria-hidden />
          Verify chain integrity
        </Button>
      </header>

      {report ? <VerifyResult report={report} /> : null}

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

      {/* ---------------------------------------------------------- filter */}
      <div className="flex flex-wrap gap-1.5">
        <FilterChip active={family === 'all'} onClick={() => setFamily('all')}>
          All families
        </FilterChip>
        {EVENT_FAMILIES.map((option) => (
          <FilterChip key={option} active={family === option} onClick={() => setFamily(option)}>
            {FAMILY_LABEL[option]}
          </FilterChip>
        ))}
      </div>

      {/* ---------------------------------------------------------- blocks */}
      {blocksQuery.isPending ? (
        <Spinner label="Loading the chain" />
      ) : blocksQuery.isError ? (
        <ErrorNote
          title="Could not load the chain"
          message={(blocksQuery.error as Error).message}
        />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-hairline bg-surface">
          <table className="w-full min-w-[52rem] text-left text-[0.82rem]">
            <thead>
              <tr>
                {['#', 'Event', 'Factory', 'Submitted by', 'Previous hash', 'Block hash', 'Status', 'Integrity'].map(
                  (heading) => (
                    <th
                      key={heading}
                      scope="col"
                      className="border-b border-hairline px-3 py-2.5 text-[0.68rem] font-semibold uppercase tracking-wide text-ink-muted"
                    >
                      {heading}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {[...blocksQuery.data.blocks].reverse().map((block) => {
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
      )}
    </div>
  );
}

/* ------------------------------------------------------------ fragments */

function VerifyResult({ report }: { report: ChainReport }) {
  const ok = report.ok;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cx(
        'rounded-[var(--radius-card)] border p-5',
        ok ? 'border-teal/30 bg-teal-soft' : 'border-clay/30 bg-clay-soft',
      )}
    >
      <div className="flex items-start gap-3">
        {ok ? (
          <ShieldCheck size={22} className="mt-0.5 shrink-0 text-teal" aria-hidden />
        ) : (
          <ShieldAlert size={22} className="mt-0.5 shrink-0 text-clay" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <h2 className={cx('font-display text-lg', ok ? 'text-teal' : 'text-clay')}>
            {ok ? 'Chain integrity verified' : 'Chain integrity broken'}
          </h2>
          <p className="mt-1 text-[0.85rem] leading-relaxed text-ink">
            {ok ? (
              <>
                All {report.height} blocks recomputed to their stored hashes, every block links to
                the one before it, and every signature verifies against its submitter&rsquo;s
                registered key.
              </>
            ) : (
              <>
                The chain breaks at block{' '}
                <span className="font-medium tabular">{report.firstBreakIndex}</span>. Because each
                block anchors to the one before it, that break invalidates{' '}
                <span className="font-medium tabular">{report.brokenCount}</span> of{' '}
                {report.height} blocks — the altered record and everything written after it.
              </>
            )}
          </p>
          <p className="mt-2 text-[0.72rem] text-ink-muted">
            Checked {dateTimeOf(report.checkedAt)}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <Stat label="Height" value={report.height} />
        <Stat
          label="Hashes valid"
          value={report.blocks.filter((b) => b.hashValid).length}
          tone={report.blocks.every((b) => b.hashValid) ? 'teal' : 'clay'}
        />
        <Stat
          label="Links valid"
          value={report.blocks.filter((b) => b.linkValid).length}
          tone={report.blocks.every((b) => b.linkValid) ? 'teal' : 'clay'}
        />
        <Stat
          label="Signatures valid"
          value={report.blocks.filter((b) => b.signatureValid).length}
          tone={report.blocks.every((b) => b.signatureValid) ? 'teal' : 'clay'}
        />
      </div>
    </div>
  );
}

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

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        'rounded-[var(--radius-pill)] border px-3 py-1 text-[0.76rem] transition-colors',
        active
          ? 'border-navy bg-navy text-parchment'
          : 'border-hairline bg-surface text-ink-muted hover:border-hairline-strong hover:text-navy',
      )}
    >
      {children}
    </button>
  );
}
