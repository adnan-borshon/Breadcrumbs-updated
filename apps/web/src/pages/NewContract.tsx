import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { BackLink } from '../components/ui/BackLink.tsx';

import { api } from '../lib/api.ts';
import { commitEvent } from '../lib/signer.ts';
import { useSession } from '../store/session.ts';
import {
  Button,
  Card,
  CardHeader,
  ErrorNote,
  Field,
  Input,
  Select,
} from '../components/ui/primitives.tsx';

function contractId(): string {
  const year = new Date().getFullYear();
  return `CON-${year}-${Math.floor(100 + Math.random() * 900)}`;
}

function isoDate(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

export function NewContract() {
  const { identity } = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: factoriesData } = useQuery({ queryKey: ['factories'], queryFn: api.factories });
  const factories = factoriesData?.factories ?? [];

  const [form, setForm] = useState({
    title: '',
    factory_id: '',
    product: '',
    value: '',
    order_quantity: '',
    currency: 'USD',
    incoterm: 'FOB Chattogram',
    start_date: isoDate(),
    delivery_date: isoDate(90),
  });

  const set = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const create = useMutation({
    mutationFn: async () => {
      const id = contractId();
      const factoryId = form.factory_id || factories[0]?.id || '';

      await commitEvent({
        eventType: 'contract_created',
        factoryId,
        eventId: `${id}-CREATE`,
        refId: id,
        dataFields: {
          contract_id: id,
          title: form.title.trim(),
          brand_id: identity!.id,
          factory_id: factoryId,
          value_minor: Math.round(Number(form.value) * 100),
          currency: form.currency,
          incoterm: form.incoterm.trim(),
          order_quantity: Number(form.order_quantity),
          product: form.product.trim(),
          start_date: form.start_date,
          delivery_date: form.delivery_date,
        },
      });

      // Opening a contract and agreeing to it are different acts, but a buyer raising one
      // is plainly agreeing to it — so the brand's signature goes on immediately. The
      // factory's counter-signature is what actually activates it.
      await commitEvent({
        eventType: 'contract_signed',
        factoryId,
        eventId: `${id}-SIGN-BRAND`,
        refId: id,
        dataFields: { contract_id: id },
      });

      return id;
    },
    onSuccess: async (id) => {
      await queryClient.invalidateQueries({ predicate: () => true });
      navigate(`/app/contracts/${id}`, { viewTransition: true });
    },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <BackLink defaultTo="/app/contracts" defaultLabel="Contracts" />

      <header>
        <h1 className="text-[1.6rem] text-navy">New contract</h1>
        <p className="mt-1.5 text-[0.88rem] leading-relaxed text-ink-muted">
          Opening a contract writes two blocks: the agreement itself, and your signature on it. It
          becomes active — and invoiceable — once the factory counter-signs.
        </p>
      </header>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <Card>
          <CardHeader title="Agreement" />
          <div className="grid gap-4 px-5 py-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Title" required>
                <Input
                  required
                  value={form.title}
                  onChange={(event) => set('title', event.target.value)}
                  placeholder="AW26 cotton tee programme"
                />
              </Field>
            </div>

            <Field label="Factory" required>
              <Select
                required
                value={form.factory_id}
                onChange={(event) => set('factory_id', event.target.value)}
              >
                <option value="">Select a factory…</option>
                {factories.map((factory) => (
                  <option key={factory.id} value={factory.id}>
                    {factory.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Product" required>
              <Input
                required
                value={form.product}
                onChange={(event) => set('product', event.target.value)}
                placeholder="Men's cotton crew tee, 180gsm"
              />
            </Field>

            <Field label="Contract value" required hint="Total agreed value, in the currency below.">
              <Input
                required
                type="number"
                step="0.01"
                min="0.01"
                value={form.value}
                onChange={(event) => set('value', event.target.value)}
                placeholder="480000.00"
              />
            </Field>

            <Field label="Currency">
              <Select value={form.currency} onChange={(event) => set('currency', event.target.value)}>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="BDT">BDT</option>
              </Select>
            </Field>

            <Field label="Order quantity" required>
              <Input
                required
                type="number"
                min="1"
                value={form.order_quantity}
                onChange={(event) => set('order_quantity', event.target.value)}
                placeholder="120000"
              />
            </Field>

            <Field label="Incoterm" required>
              <Input
                required
                value={form.incoterm}
                onChange={(event) => set('incoterm', event.target.value)}
              />
            </Field>

            <Field label="Start date" required>
              <Input
                required
                type="date"
                value={form.start_date}
                onChange={(event) => set('start_date', event.target.value)}
              />
            </Field>

            <Field label="Delivery date" required>
              <Input
                required
                type="date"
                value={form.delivery_date}
                onChange={(event) => set('delivery_date', event.target.value)}
              />
            </Field>
          </div>

          <div className="flex items-center justify-between border-t border-hairline px-5 py-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => navigate('/app/contracts')}
            >
              Cancel
            </Button>
            <div className="flex items-center gap-3">
              {create.error ? <ErrorNote message={(create.error as Error).message} /> : null}
              <Button type="submit" variant="primary" loading={create.isPending}>
                <FileText size={15} aria-hidden />
                Open and sign
              </Button>
            </div>
          </div>
        </Card>
      </form>
    </div>
  );
}
