import { Link } from 'react-router';

import { LinkButton } from '../components/ui/primitives.tsx';
import { useSession } from '../store/session.ts';

export function NotFound() {
  const { identity } = useSession();

  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <p className="font-display text-5xl text-hairline-strong">404</p>
      <h1 className="mt-4 text-[1.5rem] text-navy">That page isn&rsquo;t here</h1>
      <p className="mt-2 text-[0.88rem] leading-relaxed text-ink-muted">
        The link may be wrong, or the record may live under a different identifier. The explorer
        lists every block on the ledger.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        {identity ? (
          <>
            <LinkButton to="/app" variant="primary">
              Return to Dashboard
            </LinkButton>
            <LinkButton to="/app/transactions">
              View Transactions
            </LinkButton>
          </>
        ) : (
          <>
            <LinkButton to="/" variant="primary">
              Back to the start
            </LinkButton>
            <LinkButton to="/explorer">Browse the chain</LinkButton>
          </>
        )}
      </div>
      <p className="mt-6 text-[0.8rem] text-ink-muted">
        Looking up a factory?{' '}
        <Link to="/lookup" viewTransition className="text-navy hover:underline">
          Public lookup
        </Link>
      </p>
    </div>
  );
}
