/**
 * The primitive layer.
 *
 * Flat surfaces, hairline borders, generous padding, one solid primary action per screen.
 * Everything else in the app composes from these so spacing and weight stay consistent.
 */

import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { Link } from 'react-router';
import { Loader2 } from 'lucide-react';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/* --------------------------------------------------------------- surfaces */

export function Card({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div
      className={cx(
        'rounded-[var(--radius-card)] border border-hairline bg-surface shadow-[var(--shadow-card)]',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('flex flex-wrap items-start justify-between gap-3 border-b border-hairline px-5 py-4', className)}>
      <div className="min-w-0">
        <h2 className="text-[0.95rem] font-semibold text-navy">{title}</h2>
        {description ? <p className="mt-0.5 text-[0.8rem] text-ink-muted">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-lg text-navy">{title}</h2>
          {description ? <p className="mt-0.5 text-[0.82rem] text-ink-muted">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/* ---------------------------------------------------------------- buttons */

type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-navy text-parchment hover:bg-navy-700 active:bg-navy',
  outline: 'border border-hairline-strong bg-surface text-navy hover:bg-parchment-deep',
  ghost: 'text-navy hover:bg-parchment-deep',
  danger: 'border border-clay/40 bg-clay-soft text-clay hover:bg-clay/15',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1.5 text-[0.78rem]',
  md: 'px-4 py-2 text-[0.85rem]',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export function Button({
  variant = 'outline',
  size = 'md',
  loading = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={cx(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function LinkButton({
  to,
  variant = 'outline',
  size = 'md',
  className,
  children,
}: {
  to: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      viewTransition
      className={cx(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)}
    >
      {children}
    </Link>
  );
}

/* ----------------------------------------------------------------- fields */

export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline gap-1.5 text-[0.78rem] font-medium text-navy">
        {label}
        {required ? <span className="text-ink-faint">required</span> : null}
      </span>
      {children}
      {hint && !error ? <span className="mt-1 block text-[0.72rem] text-ink-muted">{hint}</span> : null}
      {error ? (
        <span className="mt-1 block text-[0.72rem] text-clay" role="alert">
          {error}
        </span>
      ) : null}
    </label>
  );
}

const CONTROL =
  'w-full rounded-md border border-hairline-strong bg-surface px-3 py-2 text-[0.85rem] text-ink placeholder:text-ink-faint transition-colors focus:border-navy-500 focus:outline-none';

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(CONTROL, className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(CONTROL, 'appearance-none pr-8', className)} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(CONTROL, 'min-h-20 resize-y', className)} {...rest} />;
}

/* ------------------------------------------------------------------ state */

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[var(--radius-card)] border border-dashed border-hairline-strong px-6 py-12 text-center">
      {icon ? <div className="text-ink-faint">{icon}</div> : null}
      <p className="font-display text-base text-navy">{title}</p>
      {description ? <p className="max-w-sm text-[0.82rem] text-ink-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-[0.82rem] text-ink-muted" role="status">
      <Loader2 size={15} className="animate-spin" aria-hidden />
      {label}…
    </div>
  );
}

export function ErrorNote({ title, message }: { title?: string; message: string }) {
  return (
    <div
      role="alert"
      className="rounded-[var(--radius-card)] border border-clay/30 bg-clay-soft px-4 py-3 text-[0.82rem] text-clay"
    >
      {title ? <p className="font-medium">{title}</p> : null}
      <p className={title ? 'mt-0.5' : undefined}>{message}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ table */

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-card)] border border-hairline bg-surface">
      <table className={cx('w-full min-w-[42rem] text-left text-[0.82rem]', className)}>{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={cx(
        'border-b border-hairline px-4 py-2.5 text-[0.7rem] font-semibold uppercase tracking-wide text-ink-muted',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cx('border-b border-hairline/60 px-4 py-3 align-middle', className)}>{children}</td>;
}

/* ------------------------------------------------------------------- misc */

export function Stat({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'default' | 'teal' | 'clay' | 'gold';
}) {
  const tones = {
    default: 'text-navy',
    teal: 'text-teal',
    clay: 'text-clay',
    gold: 'text-gold',
  };

  return (
    <div className="rounded-[var(--radius-card)] border border-hairline bg-surface px-4 py-3.5">
      <p className="text-[0.7rem] font-medium uppercase tracking-wide text-ink-muted">{label}</p>
      <p className={cx('mt-1 font-display text-2xl tabular', tones[tone])}>{value}</p>
      {hint ? <p className="mt-0.5 text-[0.75rem] text-ink-muted">{hint}</p> : null}
    </div>
  );
}

export function Divider({ label }: { label?: string }) {
  if (!label) return <hr className="border-hairline" />;
  return (
    <div className="flex items-center gap-3">
      <hr className="flex-1 border-hairline" />
      <span className="text-[0.7rem] font-medium uppercase tracking-wide text-ink-faint">{label}</span>
      <hr className="flex-1 border-hairline" />
    </div>
  );
}
