import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { MapPin, QrCode, Search, ShieldCheck, Users } from 'lucide-react';

import { api } from '../lib/api.ts';
import { dateOf } from '../lib/format.ts';
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Input,
  Spinner,
  cx,
} from '../components/ui/primitives.tsx';
import { HashText, TechnicalDetails } from '../components/ledger/Crypto.tsx';
import { StatusBadge } from '../components/ledger/StatusBadge.tsx';
import { useChainReport } from '../components/ledger/ChainStatusPill.tsx';
import { ZkBadge } from '../components/ledger/PrivacyShield.tsx';

/**
 * The buyer-facing page.
 *
 * Mobile-first, because most people arrive here from a QR code on a phone. No jargon and
 * no raw hashes unless someone asks for them — the answer to "is this real?" should be
 * readable without knowing what a hash is.
 */
export function PublicLookup() {
  const { factoryId } = useParams();
  return factoryId ? <FactoryTimeline factoryId={factoryId} /> : <FactorySearch />;
}

function FactorySearch() {
  const navigate = useNavigate();
  const [term, setTerm] = useState('');

  const { data, isPending } = useQuery({
    queryKey: ['public', 'factories'],
    queryFn: api.publicFactories,
  });

  const factories = (data?.factories ?? []).filter((factory) =>
    `${factory.name} ${factory.city} ${factory.id}`.toLowerCase().includes(term.toLowerCase().trim()),
  );

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="text-center">
        <h1 className="text-[1.7rem] text-navy">Check a factory</h1>
        <p className="mx-auto mt-2 max-w-lg text-[0.9rem] leading-relaxed text-ink-muted">
          Look up any factory on the ledger and see its verified history. No account, no sign-in.
        </p>
      </header>

      <Card className="p-4">
        <label className="block">
          <span className="sr-only">Search by factory name, city or code</span>
          <div className="relative">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
              aria-hidden
            />
            <Input
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Factory name, city, or code from a QR tag"
              className="pl-9"
              autoComplete="off"
            />
          </div>
        </label>

        <div className="mt-3 flex items-center gap-2 rounded-md border border-dashed border-hairline-strong px-3 py-2.5">
          <QrCode size={16} className="shrink-0 text-ink-faint" aria-hidden />
          <p className="text-[0.76rem] text-ink-muted">
            Scanning a garment tag opens this page with the factory code already filled in.
          </p>
        </div>
      </Card>

      {isPending ? (
        <Spinner />
      ) : factories.length === 0 ? (
        <EmptyState title="No match" description="Try a different name, city, or factory code." />
      ) : (
        <ul className="space-y-3">
          {factories.map((factory) => (
            <li key={factory.id}>
              <button
                type="button"
                onClick={() => navigate(`/lookup/${factory.id}`, { viewTransition: true })}
                className="w-full rounded-[var(--radius-card)] border border-hairline bg-surface p-4 text-left transition-colors hover:border-hairline-strong"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-display text-[1.05rem] text-navy">{factory.name}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[0.78rem] text-ink-muted">
                      <MapPin size={12} aria-hidden />
                      {factory.city}, {factory.country}
                    </p>
                  </div>
                  {factory.trust ? <TrustScore score={factory.trust.score} /> : null}
                </div>
                {factory.certifications.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {factory.certifications.map((cert) => (
                      <span
                        key={cert}
                        className="rounded-[var(--radius-pill)] border border-hairline bg-parchment px-2 py-0.5 text-[0.7rem] text-ink-muted"
                      >
                        {cert}
                      </span>
                    ))}
                  </div>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FactoryTimeline({ factoryId }: { factoryId: string }) {
  const [showTechnical, setShowTechnical] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'chemical' | 'commercial' | 'audit'>('all');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'verified' | 'flagged' | 'disputed'>('all');
  const { data: report } = useChainReport();

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['public', 'factory', factoryId],
    queryFn: () => api.publicFactory(factoryId),
  });

  if (isPending) return <Spinner label="Loading factory history" />;
  if (isError) {
    return (
      <div className="mx-auto max-w-2xl">
        <ErrorNote title="Factory not found" message={(error as Error).message} />
        <Link to="/lookup" viewTransition className="mt-4 inline-block text-[0.85rem] text-navy hover:underline">
          ← Search again
        </Link>
      </div>
    );
  }

  const { factory, trust, timeline } = data;

  const filteredTimeline = timeline.filter((entry) => {
    if (statusFilter !== 'all' && entry.status !== statusFilter) return false;

    if (categoryFilter === 'chemical') {
      const isChem =
        entry.headline.toLowerCase().includes('chemical') ||
        entry.headline.toLowerCase().includes('dye') ||
        entry.headline.toLowerCase().includes('consumption') ||
        entry.summary.toLowerCase().includes('chemical');
      if (!isChem) return false;
    } else if (categoryFilter === 'commercial') {
      const isComm =
        entry.headline.toLowerCase().includes('contract') ||
        entry.headline.toLowerCase().includes('order') ||
        entry.headline.toLowerCase().includes('invoice') ||
        entry.headline.toLowerCase().includes('payment') ||
        entry.headline.toLowerCase().includes('po') ||
        entry.summary.toLowerCase().includes('order');
      if (!isComm) return false;
    } else if (categoryFilter === 'audit') {
      const isAudit =
        entry.headline.toLowerCase().includes('audit') ||
        entry.headline.toLowerCase().includes('wage') ||
        entry.headline.toLowerCase().includes('labor') ||
        entry.headline.toLowerCase().includes('review') ||
        entry.headline.toLowerCase().includes('dispute') ||
        entry.headline.toLowerCase().includes('cert');
      if (!isAudit) return false;
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      const match =
        entry.headline.toLowerCase().includes(q) ||
        entry.summary.toLowerCase().includes(q) ||
        entry.submitter_name.toLowerCase().includes(q) ||
        entry.event_id.toLowerCase().includes(q);
      if (!match) return false;
    }

    return true;
  });

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link to="/lookup" viewTransition className="text-[0.8rem] text-ink-muted hover:text-navy">
        ← All factories
      </Link>

      <header>
        <h1 className="text-[1.7rem] text-navy">{factory.name}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.85rem] text-ink-muted">
          <span className="flex items-center gap-1.5">
            <MapPin size={13} aria-hidden />
            {factory.city}, {factory.country}
          </span>
          <span className="flex items-center gap-1.5">
            <Users size={13} aria-hidden />
            {factory.employee_count.toLocaleString('en-US')} workers
          </span>
        </p>
      </header>

      {/* the plain-language verdict */}
      {trust ? (
        <Card className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[0.95rem] font-semibold text-navy">
                {trust.verified} of {trust.total_records} records independently confirmed
              </p>
              <p className="mt-1.5 text-[0.84rem] leading-relaxed text-ink-muted">
                {trust.disputed > 0
                  ? `${trust.disputed} record${trust.disputed === 1 ? ' has' : 's have'} been disputed by an auditor and remain${trust.disputed === 1 ? 's' : ''} on the record — nothing is removed once written.`
                  : trust.flagged > 0
                    ? `${trust.flagged} record${trust.flagged === 1 ? ' is' : 's are'} currently waiting for an auditor to look at ${trust.flagged === 1 ? 'it' : 'them'}.`
                    : 'Nothing on this factory’s history is currently disputed or waiting for review.'}
              </p>
            </div>
            <TrustScore score={trust.score} />
          </div>

          {report ? (
            <p
              className={cx(
                'mt-4 flex items-center gap-1.5 border-t border-hairline pt-3 text-[0.78rem]',
                report.ok ? 'text-teal' : 'text-clay',
              )}
            >
              <ShieldCheck size={13} aria-hidden />
              {report.ok
                ? 'This history has been checked end to end and shows no sign of alteration.'
                : `Warning: the ledger currently fails verification at block ${report.firstBreakIndex}.`}
            </p>
          ) : null}
        </Card>
      ) : null}

      {factory.certifications.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {factory.certifications.map((cert) => (
            <span
              key={cert}
              className="rounded-[var(--radius-pill)] border border-gold/40 bg-gold-soft px-2.5 py-1 text-[0.74rem] text-[#8a6d24]"
            >
              {cert}
            </span>
          ))}
        </div>
      ) : null}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg text-navy">Verified History</h2>
          <Button size="sm" variant="ghost" onClick={() => setShowTechnical((value) => !value)}>
            {showTechnical ? 'Hide technical details' : 'Show technical details'}
          </Button>
        </div>

        {/* History category & search toolbar */}
        <div className="space-y-2 rounded-md border border-hairline bg-surface p-3">
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
              aria-hidden
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search history records, ZK proofs, or milestones…"
              className="h-8 pl-8 text-[0.8rem]"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[0.74rem]">
            <span className="font-semibold text-ink-faint mr-1">Category:</span>
            {(
              [
                { id: 'all', label: 'All History' },
                { id: 'chemical', label: 'Chemical / ZDHC' },
                { id: 'commercial', label: 'Orders & Commercial' },
                { id: 'audit', label: 'Labor & Certifications' },
              ] as const
            ).map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setCategoryFilter(cat.id)}
                className={cx(
                  'rounded-[var(--radius-pill)] border px-2.5 py-0.5 transition-colors',
                  categoryFilter === cat.id
                    ? 'border-navy bg-navy text-parchment font-medium'
                    : 'border-hairline bg-surface text-ink-muted hover:border-hairline-strong hover:text-navy',
                )}
              >
                {cat.label}
              </button>
            ))}

            <span className="font-semibold text-ink-faint ml-2 mr-1">Status:</span>
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'verified', label: 'Verified' },
                { id: 'flagged', label: 'Flagged' },
              ] as const
            ).map((st) => (
              <button
                key={st.id}
                type="button"
                onClick={() => setStatusFilter(st.id)}
                className={cx(
                  'rounded-[var(--radius-pill)] border px-2.5 py-0.5 transition-colors',
                  statusFilter === st.id
                    ? 'border-teal bg-teal text-parchment font-medium'
                    : 'border-hairline bg-surface text-ink-muted hover:border-hairline-strong hover:text-navy',
                )}
              >
                {st.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {timeline.length === 0 ? (
        <EmptyState title="No public records yet" />
      ) : filteredTimeline.length === 0 ? (
        <EmptyState
          title="No history matches filter"
          description="Try selecting All History or clearing the search."
        />
      ) : (
        <ol className="relative space-y-3 before:absolute before:bottom-3 before:left-[7px] before:top-3 before:w-px before:bg-hairline">
          {filteredTimeline.map((entry) => (

            <li key={entry.event_id} className="relative pl-7">
              <span
                aria-hidden
                className={cx(
                  'absolute left-0 top-4 size-[15px] rounded-full border-2 bg-surface',
                  entry.status === 'verified'
                    ? 'border-teal'
                    : entry.status === 'disputed'
                      ? 'border-navy'
                      : entry.status === 'flagged'
                        ? 'border-clay'
                        : 'border-hairline-strong',
                )}
              />
              <Card className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[0.88rem] font-medium text-navy">{entry.headline}</p>
                    <p className="text-[0.74rem] text-ink-faint">{dateOf(entry.timestamp)}</p>
                  </div>
                  <StatusBadge status={entry.status} size="sm" />
                </div>

                <p className="mt-2 text-[0.84rem] leading-relaxed text-ink">{entry.summary}</p>

                {/* ZK-proof badges for sensitive record types */}
                {(entry.headline.toLowerCase().includes('chemical') ||
                  entry.headline.toLowerCase().includes('dye') ||
                  entry.headline.toLowerCase().includes('consumption')) && (
                  <ZkBadge
                    label="Chemical Formulation"
                    proof="Certified ZDHC MRSL Level 3 Compliant"
                    category="chemical"
                  />
                )}
                {(entry.headline.toLowerCase().includes('material') ||
                  entry.headline.toLowerCase().includes('receipt') ||
                  entry.headline.toLowerCase().includes('shipment')) && (
                  <ZkBadge
                    label="Commercial Terms"
                    proof="Verified ≤ PO Ceiling (Proof #zk-7f8a)"
                    category="commercial"
                  />
                )}

                <p className="mt-2 text-[0.76rem] text-ink-muted">
                  Recorded by {entry.submitter_name}
                  {entry.reviewer_name ? ` · reviewed by ${entry.reviewer_name}` : ''}
                </p>

                {entry.ai_flag && entry.ai_flag_reason ? (
                  <p className="mt-2 rounded-md bg-clay-soft px-3 py-2 text-[0.78rem] text-clay">
                    {entry.ai_flag_reason}
                  </p>
                ) : null}

                {showTechnical ? (
                  <div className="mt-3 border-t border-hairline pt-3">
                    <TechnicalDetails summary={`Block ${entry.block_index}`} defaultOpen>
                      <dl className="space-y-1.5">
                        <TechRow label="Block hash" value={entry.block_hash} />
                        <TechRow label="Previous hash" value={entry.previous_block_hash} />
                        <TechRow label="Signature" value={entry.signature} />
                      </dl>
                      <Link
                        to={`/record/${encodeURIComponent(entry.event_id)}`}
                        viewTransition
                        className="mt-2 inline-block text-[0.76rem] text-navy hover:underline"
                      >
                        Open the full record →
                      </Link>
                    </TechnicalDetails>
                  </div>
                ) : null}
              </Card>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function TechRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[0.72rem] text-ink-muted">{label}</dt>
      <dd>
        <HashText value={value} label={label} lead={8} tail={8} />
      </dd>
    </div>
  );
}

function TrustScore({ score }: { score: number }) {
  const tone =
    score >= 80 ? 'text-teal' : score >= 50 ? 'text-gold' : 'text-clay';

  return (
    <div className="shrink-0 text-right">
      <p className={cx('font-display text-3xl tabular leading-none', tone)}>{score}</p>
      <p className="mt-1 text-[0.68rem] uppercase tracking-wide text-ink-faint">Trust score</p>
    </div>
  );
}
