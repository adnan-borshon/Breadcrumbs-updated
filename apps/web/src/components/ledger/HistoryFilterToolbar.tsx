import { ReactNode } from 'react';
import { Calendar, Check, RotateCcw, Search, SlidersHorizontal, X } from 'lucide-react';
import { EVENT_FAMILIES, FAMILY_LABEL, type EventFamily } from '@breadcrumbs/shared';
import { cx, Input } from '../ui/primitives.tsx';

export type DatePreset = 'all' | 'today' | '7d' | '30d';

export interface StatusOption {
  id: string;
  label: string;
  color?: 'default' | 'teal' | 'gold' | 'clay' | 'navy';
}

export const DEFAULT_STATUS_OPTIONS: StatusOption[] = [
  { id: 'verified', label: 'Verified', color: 'teal' },
  { id: 'pending', label: 'Pending', color: 'gold' },
  { id: 'flagged', label: 'Flagged', color: 'clay' },
  { id: 'disputed', label: 'Disputed', color: 'navy' },
];

export interface HistoryFilterToolbarProps {
  search: string;
  onSearchChange: (search: string) => void;
  searchPlaceholder?: string;

  // Status Filter
  selectedStatuses?: string[];
  onStatusToggle?: (statusId: string) => void;
  statusOptions?: StatusOption[];

  // Event Family Filter
  selectedFamily?: EventFamily | 'all';
  onFamilySelect?: (family: EventFamily | 'all') => void;
  selectedFamilies?: EventFamily[];
  onFamiliesToggle?: (family: EventFamily) => void;
  showFamilyFilter?: boolean;

  // Date Presets
  datePreset?: DatePreset;
  onDatePresetChange?: (preset: DatePreset) => void;

  // Sort direction
  sortOrder?: 'desc' | 'asc';
  onSortOrderToggle?: () => void;

  // Actions
  customActions?: ReactNode;
  onResetAll?: () => void;
  activeFilterCount?: number;
}

export function HistoryFilterToolbar({
  search,
  onSearchChange,
  searchPlaceholder = 'Search by ID, hash, party, or keyword…',
  selectedStatuses,
  onStatusToggle,
  statusOptions = DEFAULT_STATUS_OPTIONS,
  selectedFamily,
  onFamilySelect,
  selectedFamilies,
  onFamiliesToggle,
  showFamilyFilter = true,
  datePreset = 'all',
  onDatePresetChange,
  sortOrder,
  onSortOrderToggle,
  customActions,
  onResetAll,
  activeFilterCount = 0,
}: HistoryFilterToolbarProps) {
  const getStatusChipClass = (color?: string, active?: boolean) => {
    if (!active) {
      return 'border-hairline bg-surface text-ink-muted hover:border-hairline-strong hover:text-navy';
    }
    switch (color) {
      case 'teal':
        return 'border-teal bg-teal-soft text-teal font-medium';
      case 'gold':
        return 'border-gold bg-gold-soft text-[#8a6d24] font-medium';
      case 'clay':
        return 'border-clay bg-clay-soft text-clay font-medium';
      case 'navy':
        return 'border-navy bg-navy text-parchment font-medium';
      default:
        return 'border-navy bg-navy text-parchment font-medium';
    }
  };

  return (
    <div className="space-y-3 rounded-[var(--radius-card)] border border-hairline bg-surface p-4 shadow-[var(--shadow-card)]">
      {/* Primary search row & actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="pl-9 pr-8"
            aria-label="Search filter"
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-faint transition-colors hover:text-navy"
              aria-label="Clear search input"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Date presets */}
        {onDatePresetChange && (
          <div className="flex shrink-0 items-center gap-1 rounded-md border border-hairline bg-parchment/60 p-0.5 text-[0.76rem]">
            <Calendar size={13} className="ml-2 text-ink-muted" aria-hidden />
            <span className="sr-only">Date filter:</span>
            {(
              [
                { id: 'all', label: 'All time' },
                { id: 'today', label: 'Today' },
                { id: '7d', label: '7d' },
                { id: '30d', label: '30d' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => onDatePresetChange(opt.id)}
                className={cx(
                  'rounded px-2 py-1 transition-colors',
                  datePreset === opt.id
                    ? 'bg-surface font-semibold text-navy shadow-xs'
                    : 'text-ink-muted hover:text-navy',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}

        {/* Sort order toggle */}
        {onSortOrderToggle && sortOrder && (
          <button
            type="button"
            onClick={onSortOrderToggle}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-hairline bg-surface px-2.5 py-1.5 text-[0.78rem] font-medium text-navy transition-colors hover:border-navy"
            title="Toggle chronological sort direction"
          >
            <SlidersHorizontal size={13} />
            {sortOrder === 'desc' ? 'Newest First' : 'Oldest First'}
          </button>
        )}

        {/* Custom Actions (e.g. Export buttons) */}
        {customActions ? (
          <div className="flex shrink-0 items-center gap-2">{customActions}</div>
        ) : null}
      </div>

      {/* Secondary filter chips row: Statuses & Families */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline/60 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Status chips */}
          {selectedStatuses && onStatusToggle && statusOptions.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pr-2">
              <span className="text-[0.72rem] font-semibold uppercase tracking-wide text-ink-faint">
                Status:
              </span>
              {statusOptions.map((opt) => {
                const active = selectedStatuses.includes(opt.id);
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onStatusToggle(opt.id)}
                    aria-pressed={active}
                    className={cx(
                      'inline-flex items-center gap-1 rounded-[var(--radius-pill)] border px-2.5 py-0.5 text-[0.74rem] transition-colors',
                      getStatusChipClass(opt.color, active),
                    )}
                  >
                    {active && <Check size={11} />}
                    {opt.label}
                  </button>
                );
              })}
            </div>
          )}

          {/* Family single-choice chips */}
          {showFamilyFilter && selectedFamily !== undefined && onFamilySelect && (
            <div className="flex flex-wrap items-center gap-1.5 border-l border-hairline pl-2">
              <span className="text-[0.72rem] font-semibold uppercase tracking-wide text-ink-faint">
                Family:
              </span>
              <button
                type="button"
                onClick={() => onFamilySelect('all')}
                className={cx(
                  'rounded-[var(--radius-pill)] border px-2.5 py-0.5 text-[0.74rem] transition-colors',
                  selectedFamily === 'all'
                    ? 'border-navy bg-navy text-parchment font-medium'
                    : 'border-hairline bg-surface text-ink-muted hover:border-hairline-strong hover:text-navy',
                )}
              >
                All
              </button>
              {EVENT_FAMILIES.map((fam) => (
                <button
                  key={fam}
                  type="button"
                  onClick={() => onFamilySelect(fam)}
                  className={cx(
                    'rounded-[var(--radius-pill)] border px-2.5 py-0.5 text-[0.74rem] transition-colors',
                    selectedFamily === fam
                      ? 'border-navy bg-navy text-parchment font-medium'
                      : 'border-hairline bg-surface text-ink-muted hover:border-hairline-strong hover:text-navy',
                  )}
                >
                  {FAMILY_LABEL[fam]}
                </button>
              ))}
            </div>
          )}

          {/* Family multi-choice chips */}
          {showFamilyFilter && selectedFamilies !== undefined && onFamiliesToggle && (
            <div className="flex flex-wrap items-center gap-1.5 border-l border-hairline pl-2">
              <span className="text-[0.72rem] font-semibold uppercase tracking-wide text-ink-faint">
                Category:
              </span>
              {EVENT_FAMILIES.map((fam) => {
                const active = selectedFamilies.includes(fam);
                return (
                  <button
                    key={fam}
                    type="button"
                    onClick={() => onFamiliesToggle(fam)}
                    aria-pressed={active}
                    className={cx(
                      'inline-flex items-center gap-1 rounded-[var(--radius-pill)] border px-2.5 py-0.5 text-[0.74rem] transition-colors',
                      active
                        ? 'border-navy bg-navy text-parchment font-medium'
                        : 'border-hairline bg-surface text-ink-muted hover:border-hairline-strong hover:text-navy',
                    )}
                  >
                    {active && <Check size={11} />}
                    {FAMILY_LABEL[fam]}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Clear active filters button */}
        {activeFilterCount > 0 && onResetAll && (
          <button
            type="button"
            onClick={onResetAll}
            className="inline-flex items-center gap-1 text-[0.74rem] font-medium text-clay hover:underline"
          >
            <RotateCcw size={12} />
            Reset {activeFilterCount} active {activeFilterCount === 1 ? 'filter' : 'filters'}
          </button>
        )}
      </div>
    </div>
  );
}
