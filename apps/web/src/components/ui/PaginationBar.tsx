import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { cx } from './primitives.tsx';

export interface PaginationBarProps {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
  className?: string;
}

export function PaginationBar({
  page,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
  className,
}: PaginationBarProps) {
  if (totalItems <= 0) return null;

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(totalItems, page * pageSize);

  // Generate page numbers to show
  const getPageNumbers = () => {
    const pages: (number | 'ellipsis')[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (page > 3) pages.push('ellipsis');
      const startP = Math.max(2, page - 1);
      const endP = Math.min(totalPages - 1, page + 1);
      for (let i = startP; i <= endP; i++) pages.push(i);
      if (page < totalPages - 2) pages.push('ellipsis');
      pages.push(totalPages);
    }
    return pages;
  };

  return (
    <div
      className={cx(
        'flex flex-wrap items-center justify-between gap-3 border-t border-hairline py-3 text-[0.8rem] text-ink-muted',
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <p className="tabular">
          Showing <span className="font-medium text-navy">{start}</span>–
          <span className="font-medium text-navy">{end}</span> of{' '}
          <span className="font-medium text-navy">{totalItems}</span> records
        </p>

        {onPageSizeChange && (
          <div className="flex items-center gap-1.5 pl-2 border-l border-hairline">
            <label htmlFor="page-size-select" className="text-[0.74rem] text-ink-faint">
              Per page:
            </label>
            <select
              id="page-size-select"
              value={pageSize}
              onChange={(e) => {
                onPageSizeChange(Number(e.target.value));
                onPageChange(1);
              }}
              className="rounded border border-hairline bg-surface px-1.5 py-0.5 text-[0.76rem] font-medium text-navy focus:border-navy focus:outline-none"
            >
              {pageSizeOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(1)}
          disabled={page <= 1}
          aria-label="First page"
          className="rounded p-1 text-ink-muted transition-colors hover:bg-parchment hover:text-navy disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ChevronsLeft size={15} />
        </button>
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
          className="rounded p-1 text-ink-muted transition-colors hover:bg-parchment hover:text-navy disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ChevronLeft size={15} />
        </button>

        <div className="flex items-center gap-1 px-1">
          {getPageNumbers().map((p, idx) => {
            if (p === 'ellipsis') {
              return (
                <span key={`ellipsis-${idx}`} className="px-1.5 text-ink-faint">
                  …
                </span>
              );
            }
            const active = p === page;
            return (
              <button
                key={p}
                type="button"
                onClick={() => onPageChange(p)}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'min-w-[1.8rem] rounded px-2 py-0.5 text-center font-medium transition-colors',
                  active
                    ? 'bg-navy text-parchment'
                    : 'text-ink-muted hover:bg-parchment hover:text-navy',
                )}
              >
                {p}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          aria-label="Next page"
          className="rounded p-1 text-ink-muted transition-colors hover:bg-parchment hover:text-navy disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ChevronRight size={15} />
        </button>
        <button
          type="button"
          onClick={() => onPageChange(totalPages)}
          disabled={page >= totalPages}
          aria-label="Last page"
          className="rounded p-1 text-ink-muted transition-colors hover:bg-parchment hover:text-navy disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ChevronsRight size={15} />
        </button>
      </div>
    </div>
  );
}
