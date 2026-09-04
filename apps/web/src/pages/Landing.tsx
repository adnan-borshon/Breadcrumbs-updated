import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  Beaker,
  Blocks,
  Boxes,
  FileText,
  Fingerprint,
  Link2,
  Receipt,
  ScrollText,
  Search,
  ShieldCheck,
  UserRound,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { api } from '../lib/api.ts';
import { Card, LinkButton, cx } from '../components/ui/primitives.tsx';
import { useChainReport } from '../components/ledger/ChainStatusPill.tsx';

export function Landing() {
  const { data: report } = useChainReport();
  const { data: factories } = useQuery({ queryKey: ['public', 'factories'], queryFn: api.publicFactories });

  return (
    <div className="space-y-16 pb-8">
      {/* ------------------------------------------------------------ hero */}
      <section className="pt-6 sm:pt-12">
        <div className="max-w-3xl">
          <p className="inline-flex items-center gap-2 rounded-[var(--radius-pill)] border border-gold/40 bg-gold-soft px-3 py-1 text-[0.72rem] font-medium text-[#8a6d24]">
            <Fingerprint size={12} aria-hidden />
            Private · permissioned · tamper-evident
          </p>

          <h1 className="mt-5 text-[2.1rem] leading-[1.15] text-navy sm:text-[2.75rem]">
            A garment supply chain that can prove what it says.
          </h1>

          <p className="mt-4 max-w-2xl text-[1rem] leading-relaxed text-ink-muted">
            Breadcrumbs records factory audits, material and chemical stock, contracts, invoices and
            payments on a single signed, linked ledger. Every entry carries the signature of whoever
            made it, and altering anything after the fact breaks the chain in a way anyone can check.
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <LinkButton to="/login" variant="primary">
              Sign in to the ledger
              <ArrowRight size={15} aria-hidden />
            </LinkButton>
            <LinkButton to="/lookup">
              <Search size={15} aria-hidden />
              Public lookup — no account
            </LinkButton>
            <LinkButton to="/explorer" variant="ghost">
              <Blocks size={15} aria-hidden />
              Browse the chain
            </LinkButton>
          </div>

          {report ? (
            <p className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8rem] text-ink-muted">
              <ShieldCheck size={14} className="text-teal" aria-hidden />
              <span className="tabular font-medium text-navy">{report.height}</span> blocks on the
              ledger,
              <span className={cx('font-medium', report.ok ? 'text-teal' : 'text-clay')}>
                {report.ok ? 'all verified' : `broken at block ${report.firstBreakIndex}`}
              </span>
              <span className="text-ink-faint">· checked live, in your browser</span>
            </p>
          ) : null}
        </div>
      </section>

      {/* ------------------------------------- the three questions it answers */}
      <section>
        <h2 className="font-display text-xl text-navy">
          Three questions, answered on every screen
        </h2>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <QuestionCard
            icon={UserRound}
            question="Who submitted this?"
            answer="Every record is signed on the submitter's own device with a key the server has never held. Authorship is provable, and it cannot later be denied."
          />
          <QuestionCard
            icon={Link2}
            question="Has it been altered?"
            answer="Each block carries a fingerprint of the one before it. Changing an old record breaks its own fingerprint and every link that follows — visibly, and permanently."
          />
          <QuestionCard
            icon={ShieldCheck}
            question="Did a person review it?"
            answer="An automated check flags unusual records for an auditor. Their decision is written to the chain as its own signed entry — the original is never edited or removed."
          />
        </div>
      </section>

      {/* --------------------------------------------------- how it works */}
      <section>
        <h2 className="font-display text-xl text-navy">How it works</h2>
        <p className="mt-1 max-w-2xl text-[0.88rem] text-ink-muted">
          Three steps, and no exotic cryptography — a fingerprint, a signature, and a link.
        </p>

        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <StepCard
            step="1"
            title="Submit"
            body="A factory records what happened — an inspection, a production run, a chemical movement, an invoice. The browser signs it before it is sent."
          />
          <StepCard
            step="2"
            title="Verify"
            body="The server checks the signature, applies the permission rules for that role, runs a small anomaly check, then hashes the record onto the end of the chain."
          />
          <StepCard
            step="3"
            title="View"
            body="Auditors review anything flagged. Brands see their contracts and payments. Buyers can look up a factory's history with no account at all."
          />
        </div>

        <ChainDiagram />
      </section>

      {/* ---------------------------------------------------------- roles */}
      <section>
        <h2 className="font-display text-xl text-navy">Three roles, three views</h2>
        <p className="mt-1 max-w-2xl text-[0.88rem] text-ink-muted">
          The ledger is permissioned: a role can only commit the kinds of entry it has authority
          over. A factory cannot approve its own payments, and an auditor cannot raise invoices.
        </p>

        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <RoleCard
            title="Factory"
            body="Records production, inspections, certifications, shipments, and material and chemical movements. Issues invoices against signed contracts."
            can={['Audit records', 'Inventory movements', 'Invoices', 'Counter-signing contracts']}
          />
          <RoleCard
            title="Auditor"
            body="Sees only what the automated check flagged, and rules on it. Confirms or disputes — never deletes."
            can={['Confirm a flagged record', 'Dispute a flagged record']}
          />
          <RoleCard
            title="Brand / Buyer"
            body="Opens purchase agreements, approves or disputes invoices, and moves money. Watches the compliance position of every factory it buys from."
            can={['Contracts', 'Invoice approval', 'Payments']}
          />
        </div>
      </section>

      {/* -------------------------------------------------------- modules */}
      <section>
        <h2 className="font-display text-xl text-navy">What sits on the ledger</h2>
        <p className="mt-1 max-w-2xl text-[0.88rem] text-ink-muted">
          One chain, six families of event. Stock levels, invoice balances and contract status are
          not stored figures — they are calculated by replaying the ledger, so they cannot quietly
          disagree with it.
        </p>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <ModuleCard icon={ScrollText} title="Audit" body="Inspections, production reports, certifications, shipments." />
          <ModuleCard icon={Boxes} title="Materials" body="Receipts, issues to line, and stock corrections — with derived on-hand." />
          <ModuleCard icon={Beaker} title="Chemicals" body="Receipts, consumption and disposal, with CAS numbers, hazard class and MRSL status." />
          <ModuleCard icon={FileText} title="Contracts" body="Purchase agreements, signed by both parties before they bind." />
          <ModuleCard icon={Receipt} title="Invoices" body="Raised against a contract, approved or disputed by the buyer." />
          <ModuleCard icon={Wallet} title="Payments" body="Initiated, settled or failed — reconciled against the invoice balance." />
        </div>
      </section>

      {/* ------------------------------------------------------- factories */}
      {factories?.factories.length ? (
        <section>
          <h2 className="font-display text-xl text-navy">Factories on the ledger</h2>
          <p className="mt-1 text-[0.88rem] text-ink-muted">
            Anyone can inspect a factory&rsquo;s verified history — no sign-in required.
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {factories.factories.map((factory) => (
              <Link
                key={factory.id}
                to={`/lookup/${factory.id}`}
                viewTransition
                className="group rounded-[var(--radius-card)] border border-hairline bg-surface p-4 transition-colors hover:border-hairline-strong"
              >
                <p className="font-display text-[0.95rem] text-navy group-hover:underline">
                  {factory.name}
                </p>
                <p className="mt-0.5 text-[0.75rem] text-ink-muted">
                  {factory.city}, {factory.country}
                </p>
                {factory.trust ? (
                  <p className="mt-3 flex items-baseline gap-1.5 text-[0.75rem] text-ink-muted">
                    <span className="tabular font-display text-lg text-navy">
                      {factory.trust.total_records}
                    </span>
                    records ·{' '}
                    <span className="text-teal">{factory.trust.verified} verified</span>
                  </p>
                ) : null}
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------ fragments */

function QuestionCard({
  icon: Icon,
  question,
  answer,
}: {
  icon: LucideIcon;
  question: string;
  answer: string;
}) {
  return (
    <Card className="p-5">
      <Icon size={18} className="text-gold" aria-hidden />
      <h3 className="mt-3 text-[0.95rem] font-semibold text-navy">{question}</h3>
      <p className="mt-1.5 text-[0.82rem] leading-relaxed text-ink-muted">{answer}</p>
    </Card>
  );
}

function StepCard({ step, title, body }: { step: string; title: string; body: string }) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2.5">
        <span className="grid size-6 place-items-center rounded-full bg-navy text-[0.72rem] font-medium text-parchment">
          {step}
        </span>
        <h3 className="font-display text-[1.05rem] text-navy">{title}</h3>
      </div>
      <p className="mt-2.5 text-[0.82rem] leading-relaxed text-ink-muted">{body}</p>
    </Card>
  );
}

function RoleCard({ title, body, can }: { title: string; body: string; can: string[] }) {
  return (
    <Card className="flex flex-col p-5">
      <h3 className="font-display text-[1.05rem] text-navy">{title}</h3>
      <p className="mt-1.5 flex-1 text-[0.82rem] leading-relaxed text-ink-muted">{body}</p>
      <ul className="mt-4 space-y-1.5 border-t border-hairline pt-3">
        {can.map((item) => (
          <li key={item} className="flex items-start gap-2 text-[0.78rem] text-ink">
            <span className="mt-1.5 size-1 shrink-0 rounded-full bg-gold" aria-hidden />
            {item}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ModuleCard({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-hairline bg-surface p-4">
      <div className="flex items-center gap-2">
        <Icon size={15} className="text-navy-300" aria-hidden />
        <h3 className="text-[0.88rem] font-semibold text-navy">{title}</h3>
      </div>
      <p className="mt-1.5 text-[0.78rem] leading-relaxed text-ink-muted">{body}</p>
    </div>
  );
}

/**
 * A literal picture of the mechanism: each block stores the previous block's fingerprint,
 * which is why editing an old one cannot stay local.
 */
function ChainDiagram() {
  const blocks = [
    { n: 'Block 41', hash: 'a3f5c9e1', prev: '7b21e40f' },
    { n: 'Block 42', hash: '2e84b7d0', prev: 'a3f5c9e1' },
    { n: 'Block 43', hash: 'c1907fa6', prev: '2e84b7d0' },
  ];

  return (
    <div className="mt-5 overflow-x-auto rounded-[var(--radius-card)] border border-hairline bg-surface p-5">
      <div className="flex min-w-[36rem] items-stretch gap-3">
        {blocks.map((block, i) => (
          <div key={block.n} className="flex flex-1 items-center gap-3">
            <div className="flex-1 rounded-md border border-hairline bg-parchment/70 p-3">
              <p className="text-[0.75rem] font-medium text-navy">{block.n}</p>
              <dl className="mt-2 space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-[0.65rem] uppercase tracking-wide text-ink-faint">prev</dt>
                  <dd className="crypto text-navy-300">{block.prev}…</dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-[0.65rem] uppercase tracking-wide text-ink-faint">hash</dt>
                  <dd className="crypto font-medium text-navy">{block.hash}…</dd>
                </div>
              </dl>
            </div>
            {i < blocks.length - 1 ? (
              <ArrowRight size={16} className="shrink-0 text-hairline-strong" aria-hidden />
            ) : null}
          </div>
        ))}
      </div>
      <p className="mt-4 max-w-2xl text-[0.78rem] leading-relaxed text-ink-muted">
        Block 43 stores block 42&rsquo;s fingerprint. Edit block 42 and its fingerprint changes —
        but block 43 still names the old one, so the break is immediate and everything after it is
        invalidated too.
      </p>
    </div>
  );
}
