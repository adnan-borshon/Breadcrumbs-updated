import { EVENT_LABEL, formatMoney, shortHash } from '@breadcrumbs/shared';
import type { Currency, EventType } from '@breadcrumbs/shared';

export { formatMoney, shortHash, EVENT_LABEL };

export function money(minor: number, currency: Currency | string = 'USD'): string {
  return formatMoney(minor, (currency as Currency) ?? 'USD');
}

export function dateOf(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function dateTimeOf(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days < 0) return dateOf(iso);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  return dateOf(iso);
}

export function eventLabel(type: string): string {
  return EVENT_LABEL[type as EventType] ?? type.replace(/_/g, ' ');
}

/** Turns a data_fields key into a readable label: `units_produced` -> `Units produced`. */
export function fieldLabel(key: string): string {
  const cleaned = key
    .replace(/_minor$/, '')
    .replace(/_/g, ' ')
    .trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/** Renders a data_fields value for display, respecting minor-unit money fields. */
export function fieldValue(key: string, value: unknown, currency: Currency | string = 'USD'): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') {
    if (key.endsWith('_minor')) return money(value, currency);
    return value.toLocaleString('en-US', { maximumFractionDigits: 4 });
  }
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? singular : plural}`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}
