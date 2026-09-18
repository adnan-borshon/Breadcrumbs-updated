import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import type { Role } from '@breadcrumbs/shared';

import { AppShell } from './components/layout/AppShell.tsx';
import { Spinner } from './components/ui/primitives.tsx';
import { useSession } from './store/session.ts';

import { Landing } from './pages/Landing.tsx';
import { Login } from './pages/Login.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { SubmitRecord } from './pages/SubmitRecord.tsx';
import { ReviewQueue } from './pages/ReviewQueue.tsx';
import { Explorer } from './pages/Explorer.tsx';
import { RecordDetail } from './pages/RecordDetail.tsx';
import { PublicLookup } from './pages/PublicLookup.tsx';
import { Transactions } from './pages/Transactions.tsx';
import { Inventory } from './pages/Inventory.tsx';
import { InventoryItemPage } from './pages/InventoryItem.tsx';
import { Contracts } from './pages/Contracts.tsx';
import { ContractDetail } from './pages/ContractDetail.tsx';
import { NewContract } from './pages/NewContract.tsx';
import { Invoices } from './pages/Invoices.tsx';
import { InvoiceDetail } from './pages/InvoiceDetail.tsx';
import { NewInvoice } from './pages/NewInvoice.tsx';
import { Payments } from './pages/Payments.tsx';
import { PaymentDetail } from './pages/PaymentDetail.tsx';
import { NotFound } from './pages/NotFound.tsx';
import { Security } from './pages/Security.tsx';

/** Gates a route behind sign-in, and optionally behind particular roles. */
function Protected({ roles, children }: { roles?: Role[]; children: React.ReactNode }) {
  const { status, identity } = useSession();
  const location = useLocation();

  if (status === 'restoring') return <Spinner label="Restoring your session" />;
  if (!identity) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (roles && !roles.includes(identity.role)) return <Navigate to="/app" replace />;

  return <>{children}</>;
}

export function App() {
  const restore = useSession((state) => state.restore);

  useEffect(() => {
    void restore();
  }, [restore]);

  return (
    <AppShell>
      <Routes>
        {/* Public — transparency is a feature, not a gated tier. */}
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/explorer" element={<Explorer />} />
        <Route path="/record/:eventId" element={<RecordDetail />} />
        <Route path="/records/:eventId" element={<RecordDetail />} />
        <Route path="/app/record/:eventId" element={<RecordDetail />} />
        <Route path="/app/records/:eventId" element={<RecordDetail />} />
        <Route path="/app/explorer" element={<Navigate to="/explorer" replace />} />
        <Route path="/lookup" element={<PublicLookup />} />
        <Route path="/lookup/:factoryId" element={<PublicLookup />} />
        <Route path="/app/lookup" element={<Navigate to="/lookup" replace />} />
        <Route path="/app/lookup/:factoryId" element={<PublicLookup />} />

        {/* Signed in */}
        <Route
          path="/app"
          element={
            <Protected>
              <Dashboard />
            </Protected>
          }
        />
        <Route
          path="/app/transactions"
          element={
            <Protected>
              <Transactions />
            </Protected>
          }
        />
        <Route
          path="/app/submit"
          element={
            <Protected roles={['factory', 'auditor']}>
              <SubmitRecord />
            </Protected>
          }
        />
        <Route
          path="/app/review"
          element={
            <Protected roles={['auditor']}>
              <ReviewQueue />
            </Protected>
          }
        />

        <Route
          path="/app/inventory"
          element={<Navigate to="/app/inventory/materials" replace />}
        />
        <Route
          path="/app/inventory/:kind"
          element={
            <Protected>
              <Inventory />
            </Protected>
          }
        />
        <Route
          path="/app/inventory/:factoryId/:sku"
          element={
            <Protected>
              <InventoryItemPage />
            </Protected>
          }
        />

        <Route
          path="/app/contracts"
          element={
            <Protected>
              <Contracts />
            </Protected>
          }
        />
        <Route
          path="/app/contracts/new"
          element={
            <Protected roles={['brand']}>
              <NewContract />
            </Protected>
          }
        />
        <Route
          path="/app/contracts/:contractId"
          element={
            <Protected>
              <ContractDetail />
            </Protected>
          }
        />

        <Route
          path="/app/invoices"
          element={
            <Protected>
              <Invoices />
            </Protected>
          }
        />
        <Route
          path="/app/invoices/new"
          element={
            <Protected roles={['factory']}>
              <NewInvoice />
            </Protected>
          }
        />
        <Route
          path="/app/invoices/:invoiceId"
          element={
            <Protected>
              <InvoiceDetail />
            </Protected>
          }
        />

        <Route
          path="/app/payments"
          element={
            <Protected>
              <Payments />
            </Protected>
          }
        />
        <Route
          path="/app/payments/:paymentId"
          element={
            <Protected>
              <PaymentDetail />
            </Protected>
          }
        />

        <Route
          path="/app/security"
          element={
            <Protected>
              <Security />
            </Protected>
          }
        />

        <Route path="*" element={<NotFound />} />
      </Routes>
    </AppShell>
  );
}
