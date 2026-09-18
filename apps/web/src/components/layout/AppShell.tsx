import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import {
  Beaker,
  Blocks,
  Boxes,
  ChevronDown,
  FileText,
  Globe,
  KeyRound,
  LayoutDashboard,
  Lock,
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
import { usePrivacy } from '../../store/privacyStore.ts';
import { Button, cx } from '../ui/primitives.tsx';
import { ChainStatusPill } from '../ledger/ChainStatusPill.tsx';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

interface NavGroup {
  label: string;
  icon: LucideIcon;
  items: NavItem[];
}

type NavEntry = NavItem | NavGroup;

function isGroup(entry: NavEntry): entry is NavGroup {
  return 'items' in entry;
}

/** Items always shown to anonymous visitors */
const PUBLIC_NAV: NavItem[] = [
  { to: '/explorer', label: 'Explorer', icon: Blocks },
  { to: '/lookup', label: 'Public lookup', icon: Search },
];

/** Build role-aware navigation with grouped menus */
function navForRole(role: string | undefined, factoryId: string | null | undefined): NavEntry[] {
  const entries: NavEntry[] = [
    { to: '/app', label: 'Dashboard', icon: LayoutDashboard, end: true },
  ];

  // Records group
  const recordItems: NavItem[] = [];
  if (role === 'factory') {
    recordItems.push({ to: '/app/submit', label: 'Submit Record', icon: ScrollText });
  }
  if (role === 'auditor') {
    recordItems.push({ to: '/app/review', label: 'Review Queue', icon: ShieldCheck });
  }
  recordItems.push({ to: '/app/transactions', label: 'Transactions', icon: Blocks });

  entries.push({ label: 'Records', icon: ScrollText, items: recordItems });

  // Inventory group
  entries.push({
    label: 'Inventory',
    icon: Boxes,
    items: [
      { to: '/app/inventory/materials', label: 'Materials', icon: Boxes },
      { to: '/app/inventory/chemicals', label: 'Chemicals', icon: Beaker },
    ],
  });

  // Commerce group
  entries.push({
    label: 'Commerce',
    icon: FileText,
    items: [
      { to: '/app/contracts', label: 'Contracts', icon: FileText },
      { to: '/app/invoices', label: 'Invoices', icon: Receipt },
      { to: '/app/payments', label: 'Payments', icon: Wallet },
    ],
  });

  // Security group
  entries.push({
    label: 'Security',
    icon: KeyRound,
    items: [
      { to: '/app/security', label: 'Key Management', icon: KeyRound },
    ],
  });

  void factoryId;
  return entries;
}

/* ------------------------------------------------------------------ Dropdown */

function DropdownMenu({
  group,
  onNavigate,
}: {
  group: NavGroup;
  onNavigate?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const location = useLocation();

  // Close when route changes
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const isAnyActive = group.items.some((item) => {
    if (item.end) return location.pathname === item.to;
    return location.pathname.startsWith(item.to);
  });

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        className={cx(
          'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[0.82rem] transition-colors select-none',
          isAnyActive
            ? 'bg-navy/8 font-medium text-navy'
            : 'text-ink-muted hover:bg-parchment-deep hover:text-navy',
        )}
      >
        <group.icon size={14} aria-hidden />
        {group.label}
        <ChevronDown
          size={12}
          aria-hidden
          className={cx('transition-transform duration-150', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div
          role="menu"
          className={cx(
            'absolute left-0 top-full z-50 mt-1.5 min-w-[11rem] rounded-lg',
            'border border-hairline bg-surface shadow-[var(--shadow-raised)]',
            'py-1',
            'animate-in',
          )}
          style={{ animation: 'dropdown-in 0.13s var(--ease-out-soft) both' }}
        >
          {group.items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              viewTransition
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onNavigate?.();
              }}
              className={({ isActive }) =>
                cx(
                  'flex items-center gap-2.5 px-3.5 py-2 text-[0.82rem] transition-colors',
                  isActive
                    ? 'bg-navy/6 font-medium text-navy'
                    : 'text-ink-muted hover:bg-parchment-deep hover:text-navy',
                )
              }
            >
              <item.icon size={14} aria-hidden />
              {item.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ NavBar links */

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

/* ------------------------------------------------------------------ Desktop nav */

function DesktopNav({ entries }: { entries: NavEntry[] }) {
  return (
    <nav aria-label="Main" className="ml-4 hidden flex-1 items-center gap-0.5 lg:flex">
      {entries.map((entry) =>
        isGroup(entry) ? (
          <DropdownMenu key={entry.label} group={entry} />
        ) : (
          <NavLink
            key={entry.to}
            to={entry.to}
            end={entry.end}
            viewTransition
            className={({ isActive }) =>
              cx(
                'inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[0.82rem] transition-colors',
                isActive
                  ? 'bg-navy/8 font-medium text-navy'
                  : 'text-ink-muted hover:bg-parchment-deep hover:text-navy',
              )
            }
          >
            <entry.icon size={14} aria-hidden />
            {entry.label}
          </NavLink>
        ),
      )}
    </nav>
  );
}

/* ------------------------------------------------------------------ Mobile nav */

function MobileNav({
  entries,
  identity,
  signOut,
  onClose,
}: {
  entries: NavEntry[];
  identity: ReturnType<typeof useSession>['identity'];
  signOut: () => void;
  onClose: () => void;
}) {
  return (
    <nav
      id="mobile-nav"
      aria-label="Main"
      className="border-t border-hairline bg-surface px-4 py-3 lg:hidden"
    >
      <div className="flex flex-col gap-0.5">
        {entries.map((entry) =>
          isGroup(entry) ? (
            <MobileGroup key={entry.label} group={entry} onClose={onClose} />
          ) : (
            <NavLink
              key={entry.to}
              to={entry.to}
              end={entry.end}
              viewTransition
              onClick={onClose}
              className={({ isActive }) =>
                cx(
                  'inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[0.82rem] transition-colors',
                  isActive
                    ? 'bg-navy/8 font-medium text-navy'
                    : 'text-ink-muted hover:bg-parchment-deep hover:text-navy',
                )
              }
            >
              <entry.icon size={14} aria-hidden />
              {entry.label}
            </NavLink>
          ),
        )}
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
            onClick={onClose}
            className="inline-flex w-full items-center justify-center rounded-md bg-navy px-3 py-2 text-[0.82rem] font-medium text-parchment"
          >
            Sign in
          </Link>
        )}
      </div>
    </nav>
  );
}

/** Accordion-style expandable group for mobile */
function MobileGroup({ group, onClose }: { group: NavGroup; onClose: () => void }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  const isAnyActive = group.items.some((item) => {
    if (item.end) return location.pathname === item.to;
    return location.pathname.startsWith(item.to);
  });

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cx(
          'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[0.82rem] transition-colors',
          isAnyActive
            ? 'bg-navy/8 font-medium text-navy'
            : 'text-ink-muted hover:bg-parchment-deep hover:text-navy',
        )}
      >
        <group.icon size={14} aria-hidden />
        <span className="flex-1 text-left">{group.label}</span>
        <ChevronDown
          size={12}
          aria-hidden
          className={cx('transition-transform duration-150', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div className="ml-4 mt-0.5 flex flex-col gap-0.5 border-l border-hairline pl-3">
          {group.items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              viewTransition
              onClick={onClose}
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
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ AppShell */

export function AppShell({ children }: { children: React.ReactNode }) {
  const { identity, signOut, status } = useSession();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  const entries: NavEntry[] = identity
    ? navForRole(identity.role, identity.factory_id)
    : PUBLIC_NAV;

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
          {/* Brand */}
          <Link to="/" viewTransition className="flex shrink-0 items-center gap-2">
            <BreadcrumbsMark />
            <span className="font-display text-[1.05rem] font-semibold tracking-tight text-navy">
              Breadcrumbs
            </span>
          </Link>

          {/* Desktop navigation (grouped dropdowns) */}
          <DesktopNav entries={entries} />

          {/* Right-hand controls */}
          <div className="ml-auto flex items-center gap-2">
            <ChainStatusPill />

            {/* Privacy / View Mode Toggle */}
            {identity && <PrivacyToggle />}

            {identity ? (
              <div className="hidden items-center gap-2 sm:flex">
                {/* User badge */}
                <div className="hidden items-center gap-2 rounded-md border border-hairline bg-parchment-deep px-2.5 py-1.5 md:flex">
                  <div className="h-6 w-6 shrink-0 rounded-full bg-navy flex items-center justify-center">
                    <span className="text-[0.6rem] font-semibold text-parchment uppercase">
                      {identity.name.charAt(0)}
                    </span>
                  </div>
                  <div className="leading-tight">
                    <p className="text-[0.78rem] font-medium text-navy">{identity.name}</p>
                    <p className="text-[0.68rem] text-ink-muted">{ROLE_LABEL[identity.role]}</p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={signOut}
                  aria-label="Sign out"
                  title="Sign out"
                >
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

            {/* Mobile hamburger */}
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

        {/* Mobile drawer */}
        {menuOpen && (
          <MobileNav
            entries={entries}
            identity={identity}
            signOut={signOut}
            onClose={() => setMenuOpen(false)}
          />
        )}
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

/**
 * Privacy / View-Mode Toggle.
 *
 * Appears in the navbar when signed in. Demonstrates the ZKP privacy architecture:
 * public mode shows ZK-proof compliance badges; authorized mode reveals actual values.
 */
function PrivacyToggle() {
  const { viewMode, toggle } = usePrivacy();
  const isPublic = viewMode === 'public';

  return (
    <button
      type="button"
      onClick={toggle}
      title={isPublic ? 'Switch to Authorized Brand view (reveals confidential data)' : 'Switch to Public / Auditor view (shows ZK-proof badges)'}
      className={cx(
        'hidden items-center gap-1.5 rounded-[var(--radius-pill)] border px-2.5 py-1 text-[0.72rem] font-medium transition-colors sm:inline-flex',
        isPublic
          ? 'border-[#4B3B6A]/30 bg-[#1e1030]/6 text-[#5b3fa8] hover:bg-[#1e1030]/10'
          : 'border-teal/30 bg-teal-soft text-teal hover:bg-teal/15',
      )}
      aria-pressed={!isPublic}
    >
      {isPublic ? (
        <>
          <Globe size={11} aria-hidden />
          Public View
        </>
      ) : (
        <>
          <Lock size={11} aria-hidden />
          Authorized View
        </>
      )}
    </button>
  );
}
