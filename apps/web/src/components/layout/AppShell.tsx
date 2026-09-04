import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import {
  Beaker,
  Blocks,
  Boxes,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Receipt,
  ScrollText,
  Search,
  ShieldCheck,
  Wallet,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ROLE_LABEL } from '@breadcrumbs/shared';

import { useSession } from '../../store/session.ts';
import { Button, cx } from '../ui/primitives.tsx';
import { ChainStatusPill } from '../ledger/ChainStatusPill.tsx';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

const PUBLIC_NAV: NavItem[] = [
  { to: '/explorer', label: 'Explorer', icon: Blocks },
  { to: '/lookup', label: 'Public lookup', icon: Search },
];

function navForRole(role: string | undefined, factoryId: string | null | undefined): NavItem[] {
  const items: NavItem[] = [{ to: '/app', label: 'Dashboard', icon: LayoutDashboard, end: true }];

  if (role === 'factory') {
    items.push({ to: '/app/submit', label: 'Submit record', icon: ScrollText });
  }
  if (role === 'auditor') {
    items.push({ to: '/app/review', label: 'Review queue', icon: ShieldCheck });
  }

  items.push(
    { to: '/app/inventory/materials', label: 'Materials', icon: Boxes },
    { to: '/app/inventory/chemicals', label: 'Chemicals', icon: Beaker },
    { to: '/app/contracts', label: 'Contracts', icon: FileText },
    { to: '/app/invoices', label: 'Invoices', icon: Receipt },
    { to: '/app/payments', label: 'Payments', icon: Wallet },
    { to: '/app/transactions', label: 'Transactions', icon: Blocks },
  );

  void factoryId;
  return items;
}

function NavLinks({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  return (
    <>
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          viewTransition
          onClick={onNavigate}
          className={({ isActive }) =>
            cx(
              'inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[0.82rem] transition-colors',
              isActive
                ? 'bg-navy/8 font-medium text-navy'
                : 'text-ink-muted hover:bg-parchment-deep hover:text-navy',
            )
          }
        >
          <item.icon size={14} aria-hidden />
          {item.label}
        </NavLink>
      ))}
    </>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { identity, signOut, status } = useSession();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  const items = identity ? navForRole(identity.role, identity.factory_id) : PUBLIC_NAV;

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-navy focus:px-3 focus:py-2 focus:text-parchment"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-30 border-b border-hairline bg-parchment/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-[78rem] items-center gap-3 px-4 py-3 sm:px-6">
          <Link to="/" viewTransition className="flex shrink-0 items-center gap-2">
            <BreadcrumbsMark />
            <span className="font-display text-[1.05rem] font-semibold tracking-tight text-navy">
              Breadcrumbs
            </span>
          </Link>

          <nav aria-label="Main" className="ml-4 hidden flex-1 items-center gap-0.5 lg:flex">
            <NavLinks items={items} />
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <ChainStatusPill />

            {identity ? (
              <div className="hidden items-center gap-2 sm:flex">
                <div className="text-right leading-tight">
                  <p className="text-[0.78rem] font-medium text-navy">{identity.name}</p>
                  <p className="text-[0.68rem] text-ink-muted">{ROLE_LABEL[identity.role]}</p>
                </div>
                <Button size="sm" variant="ghost" onClick={signOut} aria-label="Sign out">
                  <LogOut size={14} aria-hidden />
                </Button>
              </div>
            ) : status === 'anonymous' ? (
              <Link
                to="/login"
                viewTransition
                className="hidden rounded-md bg-navy px-3 py-1.5 text-[0.8rem] font-medium text-parchment transition-colors hover:bg-navy-700 sm:inline-flex"
              >
                Sign in
              </Link>
            ) : null}

            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              className="rounded-md p-1.5 text-navy transition-colors hover:bg-parchment-deep lg:hidden"
              aria-expanded={menuOpen}
              aria-controls="mobile-nav"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            >
              {menuOpen ? <X size={18} aria-hidden /> : <Menu size={18} aria-hidden />}
            </button>
          </div>
        </div>

        {menuOpen ? (
          <nav
            id="mobile-nav"
            aria-label="Main"
            className="border-t border-hairline bg-surface px-4 py-3 lg:hidden"
          >
            <div className="flex flex-col gap-0.5">
              <NavLinks items={items} onNavigate={() => setMenuOpen(false)} />
            </div>
            <div className="mt-3 border-t border-hairline pt-3">
              {identity ? (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[0.82rem] font-medium text-navy">{identity.name}</p>
                    <p className="text-[0.72rem] text-ink-muted">{ROLE_LABEL[identity.role]}</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={signOut}>
                    Sign out
                  </Button>
                </div>
              ) : (
                <Link
                  to="/login"
                  viewTransition
                  className="inline-flex w-full items-center justify-center rounded-md bg-navy px-3 py-2 text-[0.82rem] font-medium text-parchment"
                >
                  Sign in
                </Link>
              )}
            </div>
          </nav>
        ) : null}
      </header>

      <main id="main" className="mx-auto w-full max-w-[78rem] flex-1 px-4 py-7 sm:px-6">
        {children}
      </main>

      <footer className="border-t border-hairline bg-surface/60">
        <div className="mx-auto flex max-w-[78rem] flex-wrap items-center justify-between gap-3 px-4 py-5 text-[0.75rem] text-ink-muted sm:px-6">
          <p>
            Breadcrumbs — a private, permissioned hash-chain for garment compliance and commerce.
          </p>
          <div className="flex items-center gap-4">
            <Link to="/explorer" viewTransition className="hover:text-navy">
              Explorer
            </Link>
            <Link to="/lookup" viewTransition className="hover:text-navy">
              Public lookup
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

/**
 * The mark: three linked blocks. Restrained on purpose — the brief rules out glowing
 * chains and coins, so this reads as a seal or a record mark rather than crypto imagery.
 */
export function BreadcrumbsMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden focusable="false">
      <rect x="0.75" y="0.75" width="26.5" height="26.5" rx="6.25" fill="#0F2540" />
      <circle cx="8.6" cy="14" r="2.7" fill="#F7F5EF" />
      <circle cx="14" cy="14" r="2.7" fill="#C9A24B" />
      <circle cx="19.4" cy="14" r="2.7" fill="#F7F5EF" />
      <path d="M8.6 14h10.8" stroke="#F7F5EF" strokeOpacity="0.45" strokeWidth="1.1" />
    </svg>
  );
}
