/**
 * Status is never carried by colour alone.
 *
 * Every badge pairs a colour with an icon and a text label, so it survives greyscale
 * printing, colour-blindness, and a compliance officer squinting at a projector.
 */

import { Link, useLocation } from 'react-router';
import { AlertTriangle, CheckCircle2, CircleSlash, Clock, Landmark } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { cx } from '../ui/primitives.tsx';

export type BadgeStatus = 'verified' | 'pending' | 'flagged' | 'disputed' | 'system';

const STATUS: Record<BadgeStatus, { label: string; icon: LucideIcon; className: string }> = {
  verified: {
    label: 'Verified',
    icon: CheckCircle2,
    className: 'border-teal/30 bg-teal-soft text-teal',
  },
  pending: {
    label: 'Pending review',
    icon: Clock,
    className: 'border-gold/40 bg-gold-soft text-[#8a6d24]',
  },
  flagged: {
    label: 'Flagged',
    icon: AlertTriangle,
    className: 'border-clay/30 bg-clay-soft text-clay',
  },
  disputed: {
    label: 'Disputed',
    icon: CircleSlash,
    className: 'border-navy/25 bg-navy/8 text-navy',
  },
  system: {
    label: 'System',
    icon: Landmark,
    className: 'border-hairline-strong bg-parchment-deep text-ink-muted',
  },
};

export function StatusBadge({
  status,
  size = 'md',
  compact = false,
}: {
  status: string;
  size?: 'sm' | 'md';
  compact?: boolean;
}) {
  const config = STATUS[status as BadgeStatus] ?? STATUS.system;
  const Icon = config.icon;

  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-pill)] border font-medium',
        config.className,
        size === 'sm' ? 'px-2 py-0.5 text-[0.68rem]' : 'px-2.5 py-1 text-[0.72rem]',
      )}
    >
      <Icon size={size === 'sm' ? 11 : 12} aria-hidden />
      {compact ? config.label.split(' ')[0] : config.label}
    </span>
  );
}

/**
 * The same badge, but linked.
 *
 * A status badge anywhere in the app leads to the one canonical record page — the
 * dashboard, the explorer, the transaction feed and the public timeline all land on the
 * same URL, so there is a single place a record is described.
 */
export function StatusBadgeLink({
  status,
  eventId,
  size = 'md',
  compact = false,
  state,
}: {
  status: string;
  eventId: string;
  size?: 'sm' | 'md';
  compact?: boolean;
  state?: { from?: string; label?: string };
}) {
  const location = useLocation();
  const returnState = state ?? {
    from: location.pathname,
    label: location.pathname.includes('review')
      ? 'Review Queue'
      : location.pathname.includes('transactions')
        ? 'Transactions'
        : location.pathname.includes('explorer')
          ? 'Explorer'
          : location.pathname.includes('inventory')
            ? 'Inventory'
            : 'Dashboard',
  };

  return (
    <Link
      to={`/record/${encodeURIComponent(eventId)}`}
      state={returnState}
      viewTransition
      className="rounded-[var(--radius-pill)] transition-opacity hover:opacity-80"
      aria-label={`View record ${eventId} — ${STATUS[status as BadgeStatus]?.label ?? status}`}
    >
      <StatusBadge status={status} size={size} compact={compact} />
    </Link>
  );
}

export function statusLabel(status: string): string {
  return STATUS[status as BadgeStatus]?.label ?? status;
}
