import { useState } from 'react';
import { Link } from 'react-router';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Coins,
  Download,
  ExternalLink,
  FileSignature,
  FileText,
  Receipt,
  Search,
  ShieldAlert,
  SlidersHorizontal,
} from 'lucide-react';
import type { LedgerRecord } from '@breadcrumbs/shared';
import { dateTimeOf, eventLabel, money } from '../../lib/format.ts';
import { api } from '../../lib/api.ts';
import { Card, CardHeader, EmptyState, Input, cx } from '../ui/primitives.tsx';
import { HashText } from './Crypto.tsx';
import { StatusBadgeLink } from './StatusBadge.tsx';

export interface EntityAuditTimelineProps {
  events: LedgerRecord[];
  entityType?: 'contract' | 'invoice' | 'payment' | 'generic';
  title?: string;
  description?: string;
  className?: string;
}

export function EntityAuditTimeline({
  events,
  entityType = 'generic',
  title = 'Chain audit trail',
  description = 'Chronological blocks written to the ledger, each individually signed and verified.',
  className,
}: EntityAuditTimelineProps) {
  const [search, setSearch] = useState('');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('asc');
  const [expandedEvents, setExpandedEvents] = useState<Record<string, boolean>>({});

  const toggleExpand = (eventId: string) => {
    setExpandedEvents((prev) => ({ ...prev, [eventId]: !prev[eventId] }));
  };

  const filtered = events.filter((ev) => {
    if (!search.trim()) return true;
    const term = search.toLowerCase();
    return (
      ev.event_id.toLowerCase().includes(term) ||
      ev.event_type.toLowerCase().includes(term) ||
      ev.submitter_name.toLowerCase().includes(term) ||
      JSON.stringify(ev.data_fields).toLowerCase().includes(term)
    );
  });

  const sorted = [...filtered].sort((a, b) => {
    const diff = a.block_index - b.block_index;
    return sortOrder === 'asc' ? diff : -diff;
  });

  const getEventIcon = (record: LedgerRecord) => {
    if (record.ai_flag || record.status === 'disputed') {
      return <AlertTriangle size={15} className="text-clay" />;
    }
    if (record.event_type.includes('signed') || record.event_type.includes('signature')) {
      return <FileSignature size={15} className="text-navy" />;
    }
    if (record.event_type.includes('approved') || record.event_type.includes('settled')) {
      return <CheckCircle2 size={15} className="text-teal" />;
    }
    if (record.event_type.includes('invoice')) {
      return <Receipt size={15} className="text-gold" />;
    }
    if (record.event_type.includes('payment')) {
      return <Coins size={15} className="text-teal" />;
    }
    if (record.event_type.includes('contract')) {
      return <FileText size={15} className="text-navy" />;
    }
    return <Clock size={15} className="text-ink-muted" />;
  };

  return (
    <Card className={cx('overflow-hidden', className)}>
      <CardHeader
        title={title}
        description={description}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {events.length > 3 && (
              <div className="relative">
                <Search
                  size={13}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
                  aria-hidden
                />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter timeline…"
                  className="h-7 w-36 pl-7 text-[0.74rem] sm:w-44"
                />
              </div>
            )}
            <button
              type="button"
              onClick={() => setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'))}
              className="inline-flex items-center gap-1 rounded border border-hairline bg-surface px-2 py-1 text-[0.74rem] font-medium text-navy hover:border-navy"
              title="Toggle timeline order"
            >
              <SlidersHorizontal size={11} />
              {sortOrder === 'asc' ? 'Oldest first' : 'Newest first'}
            </button>
          </div>
        }
      />

      {sorted.length === 0 ? (
        <div className="p-6">
          <EmptyState
            title="No events match"
            description="Clear the search filter to show the full audit trail."
          />
        </div>
      ) : (
        <div className="p-5">
          <ol className="relative space-y-6 before:absolute before:bottom-3 before:left-[17px] before:top-3 before:w-0.5 before:bg-hairline">
            {sorted.map((record) => {
              const isExpanded = !!expandedEvents[record.event_id];
              const fields = record.data_fields;

              return (
                <li key={record.event_id} className="relative pl-9">
                  {/* Timeline node icon indicator */}
                  <span
                    aria-hidden
                    className={cx(
                      'absolute left-0 top-1.5 flex size-9 items-center justify-center rounded-full border-2 bg-surface shadow-xs',
                      record.status === 'verified'
                        ? 'border-teal bg-teal-soft/30'
                        : record.status === 'flagged'
                          ? 'border-clay bg-clay-soft/40'
                          : record.status === 'disputed'
                            ? 'border-navy bg-navy/10'
                            : 'border-hairline-strong bg-parchment',
                    )}
                  >
                    {getEventIcon(record)}
                  </span>

                  {/* Main Event Box */}
                  <div
                    className={cx(
                      'rounded-md border bg-surface p-4 transition-shadow hover:shadow-xs',
                      record.status === 'flagged'
                        ? 'border-clay/40 bg-clay-soft/10'
                        : 'border-hairline',
                    )}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-parchment-deep px-1.5 py-0.5 font-mono text-[0.68rem] text-ink-muted">
                            Block #{record.block_index}
                          </span>
                          <Link
                            to={`/record/${encodeURIComponent(record.event_id)}`}
                            viewTransition
                            className="text-[0.92rem] font-semibold text-navy hover:underline"
                          >
                            {eventLabel(record.event_type)}
                          </Link>
                        </div>
                        <p className="mt-1 text-[0.76rem] text-ink-muted">
                          Committed by <span className="font-medium text-navy">{record.submitter_name}</span> (
                          <span className="capitalize">{record.submitter_role}</span>) ·{' '}
                          <time dateTime={record.timestamp}>{dateTimeOf(record.timestamp)}</time>
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <StatusBadgeLink status={record.status} eventId={record.event_id} size="sm" compact />
                        <button
                          type="button"
                          onClick={() => toggleExpand(record.event_id)}
                          className="rounded p-1 text-ink-muted hover:bg-parchment hover:text-navy"
                          aria-label={isExpanded ? 'Collapse event details' : 'Expand event details'}
                          title="Inspect cryptographic proof and payload"
                        >
                          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>
                      </div>
                    </div>

                    {/* Business Value & Delta Summary */}
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded border border-hairline/60 bg-parchment/40 px-3 py-2 text-[0.78rem]">
                      {renderPayloadSummary(record, entityType)}
                    </div>

                    {/* AI Flag warning if present */}
                    {record.ai_flag && record.ai_flag_reason && (
                      <div className="mt-2.5 flex items-start gap-2 rounded border border-clay/30 bg-clay-soft px-3 py-2 text-[0.76rem] text-clay">
                        <ShieldAlert size={14} className="mt-0.5 shrink-0" />
                        <div>
                          <p className="font-medium">AI Governance Rule Triggered: {record.ai_rule ?? 'Anomaly'}</p>
                          <p className="mt-0.5 text-clay/90">{record.ai_flag_reason}</p>
                        </div>
                      </div>
                    )}

                    {/* Expanded Cryptographic Inspector */}
                    {isExpanded && (
                      <div className="mt-3 border-t border-hairline pt-3 text-[0.76rem]">
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div>
                            <span className="text-ink-faint">Event ID: </span>
                            <span className="font-mono text-navy">{record.event_id}</span>
                          </div>
                          <div>
                            <span className="text-ink-faint">Submitter Key: </span>
                            <span className="font-mono text-ink-muted">
                              {record.submitter_id ? record.submitter_id.slice(0, 16) + '…' : '—'}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-ink-faint">Block Hash: </span>
                            <HashText value={record.block_hash} label="Block hash" lead={6} tail={4} />
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-ink-faint">Prev Hash: </span>
                            <HashText value={record.previous_block_hash} label="Prev hash" lead={6} tail={4} />
                          </div>
                        </div>

                        {/* Raw fields preview */}
                        <div className="mt-2.5 rounded bg-parchment-deep p-2 font-mono text-[0.72rem] text-ink-muted">
                          <p className="font-semibold text-navy">State Data Fields:</p>
                          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap">
                            {JSON.stringify(fields, null, 2)}
                          </pre>
                        </div>

                        {/* Direct action links */}
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-hairline/60 pt-2">
                          <Link
                            to={`/record/${encodeURIComponent(record.event_id)}`}
                            viewTransition
                            className="inline-flex items-center gap-1 font-medium text-navy hover:underline"
                          >
                            <ExternalLink size={12} />
                            Open full record view
                          </Link>

                          <button
                            type="button"
                            onClick={() => void api.downloadReceipt(record.event_id)}
                            className="inline-flex items-center gap-1 text-ink-muted hover:text-navy hover:underline"
                            title="Download cryptographic receipt bundle (.json)"
                          >
                            <Download size={12} />
                            Download receipt (.json)
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </Card>
  );
}

/** Renders concise business impact summary per record */
function renderPayloadSummary(record: LedgerRecord, _entityType: string) {
  const fields = record.data_fields;

  if (record.event_type === 'contract_created') {
    return (
      <>
        <span>
          <strong>Terms:</strong> {String(fields['title'] ?? 'Contract Opened')}
        </span>
        {typeof fields['value_minor'] === 'number' && (
          <span>
            <strong>Agreed Value:</strong>{' '}
            {money(fields['value_minor'] as number, (fields['currency'] as any) ?? 'USD')}
          </span>
        )}
      </>
    );
  }

  if (record.event_type === 'contract_signed') {
    return (
      <span className="text-teal">
        <strong>Digital Signature:</strong> Cryptographically executed by party key
      </span>
    );
  }

  if (record.event_type === 'invoice_issued') {
    return (
      <>
        <span>
          <strong>Invoice Amount:</strong>{' '}
          {typeof fields['total_minor'] === 'number'
            ? money(fields['total_minor'] as number, (fields['currency'] as any) ?? 'USD')
            : '—'}
        </span>
        {fields['due_date'] && (
          <span>
            <strong>Due Date:</strong> {String(fields['due_date'])}
          </span>
        )}
      </>
    );
  }

  if (record.event_type === 'invoice_approved') {
    return (
      <span className="text-teal">
        <strong>Brand Approval:</strong> Invoice authorized for commercial settlement
      </span>
    );
  }

  if (record.event_type === 'invoice_disputed') {
    return (
      <span className="text-clay">
        <strong>Dispute Raised:</strong> {String(fields['reason'] ?? 'Dispute on invoice figures')}
      </span>
    );
  }

  if (record.event_type === 'payment_initiated') {
    return (
      <>
        <span>
          <strong>Amount Initiated:</strong>{' '}
          {typeof fields['amount_minor'] === 'number'
            ? money(fields['amount_minor'] as number, (fields['currency'] as any) ?? 'USD')
            : '—'}
        </span>
        <span>
          <strong>Method:</strong> {String(fields['method'] ?? 'bank_transfer')}
        </span>
      </>
    );
  }

  if (record.event_type === 'payment_settled') {
    return (
      <>
        <span className="text-teal">
          <strong>Settlement Confirmed:</strong> Funds cleared counter-party ledger
        </span>
        {fields['clearing_ref'] && (
          <span>
            <strong>Ref:</strong> {String(fields['clearing_ref'])}
          </span>
        )}
      </>
    );
  }

  // Generic fallback
  const firstNumeric = Object.entries(fields).find(([_, v]) => typeof v === 'number');
  if (firstNumeric) {
    return (
      <span>
        <strong>{firstNumeric[0]}:</strong> {Number(firstNumeric[1]).toLocaleString('en-US')}
      </span>
    );
  }

  return <span><strong>Event:</strong> {eventLabel(record.event_type)}</span>;
}
