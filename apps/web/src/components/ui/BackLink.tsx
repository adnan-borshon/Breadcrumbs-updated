import { ArrowLeft } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
import { cx } from './primitives.tsx';

interface BackLinkProps {
  /** Default fallback route if no history or state is available. */
  defaultTo: string;
  /** Label to display next to the arrow (e.g. "Dashboard", "Transactions"). */
  defaultLabel?: string;
  className?: string;
}

export function BackLink({ defaultTo, defaultLabel = 'Back', className }: BackLinkProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const state = location.state as { from?: string; label?: string } | null;
  const from = state?.from;
  const label = state?.label ?? defaultLabel;

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (from) {
      navigate(from, { viewTransition: true });
    } else if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate(defaultTo, { viewTransition: true });
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cx(
        'inline-flex items-center gap-1.5 text-[0.8rem] text-ink-muted transition-colors hover:text-navy cursor-pointer font-medium',
        className,
      )}
    >
      <ArrowLeft size={14} aria-hidden />
      <span>{label}</span>
    </button>
  );
}
