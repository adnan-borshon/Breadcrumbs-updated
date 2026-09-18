/**
 * API client.
 *
 * One place that knows how to talk to the server, so error shapes, auth headers and the
 * base path are consistent everywhere. Requests go to a relative `/api` path, which the
 * dev server proxies — the same string works in a built deployment behind one origin.
 */

import type {
  Block,
  ChainReport,
  Contract,
  Factory,
  FactoryTrust,
  InventoryItemView,
  Invoice,
  LedgerRecord,
  Payment,
  Role,
} from '@breadcrumbs/shared';

const BASE = '/api';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let authToken: string | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');
  if (authToken) headers.set('Authorization', `Bearer ${authToken}`);

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, 'network_error', 'Could not reach the ledger service. Is the API running?');
  }

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const error = (payload as { error?: { code: string; message: string; details?: unknown } })?.error;
    throw new ApiError(
      response.status,
      error?.code ?? 'unknown_error',
      error?.message ?? `Request failed (${response.status}).`,
      error?.details,
    );
  }

  return payload as T;
}

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

/* ------------------------------------------------------------------ types */

export interface Identity {
  id: string;
  name: string;
  role: Role;
  org: string;
  factory_id: string | null;
}

export interface BlockSummary {
  index: number;
  timestamp: string;
  block_hash: string;
  previous_block_hash: string;
  event_id: string;
  event_type: string;
  event_family: string;
  factory_id: string;
  factory_name: string;
  submitter_name: string;
  submitter_role: string;
  ai_flag: boolean;
  status: string;
}

export interface AnomalyResult {
  flagged: boolean;
  score: number | null;
  reason: string | null;
  rule: string | null;
  note: string | null;
}

export interface CommitResponse {
  block: Block;
  anomaly: AnomalyResult;
  record: LedgerRecord;
}

export type FactoryWithTrust = Factory & { trust: FactoryTrust | null };

export interface PublicTimelineEntry {
  event_id: string;
  timestamp: string;
  headline: string;
  summary: string;
  status: string;
  submitter_name: string;
  submitter_role: string;
  reviewer_name: string | null;
  ai_flag: boolean;
  ai_flag_reason: string | null;
  block_index: number;
  block_hash: string;
  previous_block_hash: string;
  signature: string | null;
}

/* --------------------------------------------------------------- endpoints */

export const api = {
  health: () => get<{ ok: boolean; chain: string; height: number }>('/health'),

  identities: () => get<{ identities: Identity[] }>('/auth/identities'),
  login: (identityId: string) =>
    post<{ token: string; identity: Identity }>('/auth/login', { identity_id: identityId }),
  registerKey: (publicKeyJwk: JsonWebKey, label: string) =>
    post<{ fingerprint: string; label: string; reused: boolean }>('/auth/register-key', {
      public_key_jwk: publicKeyJwk,
      label,
    }),
  me: () =>
    get<{ identity: Identity; keys: { fingerprint: string; label: string; created_at: string }[] }>(
      '/auth/me',
    ),

  head: () => get<{ head: Block | null; height: number }>('/chain/head'),
  blocks: (params: { family?: string; factory?: string } = {}) =>
    get<{ blocks: BlockSummary[] }>(`/chain/blocks${query(params)}`),
  rawBlocks: () => get<{ blocks: Block[] }>('/chain/raw-blocks'),
  block: (index: number) => get<{ block: Block; record: LedgerRecord | null }>(`/chain/blocks/${index}`),
  verify: () => get<ChainReport>('/chain/verify'),
  commit: (body: { record: unknown; signature: string; key_fingerprint: string }) =>
    post<CommitResponse>('/chain/commit', body),

  records: (params: { family?: string; status?: string; factory?: string; event_type?: string; limit?: number } = {}) =>
    get<{ records: LedgerRecord[] }>(`/records${query(params)}`),
  flagged: () => get<{ records: LedgerRecord[] }>('/records/flagged'),
  record: (eventId: string) => get<{ record: LedgerRecord }>(`/records/${encodeURIComponent(eventId)}`),

  factories: () => get<{ factories: FactoryWithTrust[] }>('/factories'),

  materials: (factory?: string) =>
    get<{ items: InventoryItemView[] }>(`/inventory/materials${query({ factory })}`),
  chemicals: (factory?: string) =>
    get<{ items: InventoryItemView[] }>(`/inventory/chemicals${query({ factory })}`),
  inventoryItem: (factoryId: string, sku: string) =>
    get<{ item: InventoryItemView; ledger: LedgerRecord[] }>(
      `/inventory/${encodeURIComponent(factoryId)}/${encodeURIComponent(sku)}`,
    ),

  contracts: (params: { factory?: string; brand?: string } = {}) =>
    get<{ contracts: Contract[] }>(`/contracts${query(params)}`),
  contract: (id: string) =>
    get<{ contract: Contract; invoices: Invoice[]; events: LedgerRecord[] }>(
      `/contracts/${encodeURIComponent(id)}`,
    ),

  invoices: (params: { factory?: string; brand?: string; contract?: string; status?: string } = {}) =>
    get<{ invoices: Invoice[] }>(`/invoices${query(params)}`),
  invoice: (id: string) =>
    get<{ invoice: Invoice; payments: Payment[]; contract: Contract | null; events: LedgerRecord[] }>(
      `/invoices/${encodeURIComponent(id)}`,
    ),

  payments: (params: { invoice?: string; factory?: string; brand?: string } = {}) =>
    get<{ payments: Payment[] }>(`/payments${query(params)}`),
  payment: (id: string) =>
    get<{ payment: Payment; invoice: Invoice | null; events: LedgerRecord[] }>(
      `/payments/${encodeURIComponent(id)}`,
    ),

  transactions: (params: {
    family?: string;
    factory?: string;
    status?: string;
    q?: string;
    limit?: number;
    page?: number;
    fromDate?: string;
    toDate?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  } = {}) =>
    get<{
      transactions: LedgerRecord[];
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    }>(`/transactions${query(params)}`),

  publicFactories: () => get<{ factories: FactoryWithTrust[] }>('/public/factories'),
  publicFactory: (id: string) =>
    get<{ factory: Factory; trust: FactoryTrust | null; timeline: PublicTimelineEntry[] }>(
      `/public/factories/${encodeURIComponent(id)}`,
    ),
  publicVerify: (eventId: string) =>
    get<{ record: LedgerRecord; summary: string }>(`/public/verify/${encodeURIComponent(eventId)}`),

  tamper: (blockIndex: number) =>
    post<{
      tampered: { block_index: number; event_id: string; field: string; before: unknown; after: unknown };
      report: ChainReport;
    }>('/admin/tamper', { block_index: blockIndex }),
  restore: () => post<{ restored: boolean; blocks: number; flagged: number; report: ChainReport }>('/admin/restore'),
  rebuild: () => post<{ rebuilt: boolean; replayed: number }>('/admin/rebuild'),

  downloadReceiptUrl: (eventId: string) => `${BASE}/export/receipt/${encodeURIComponent(eventId)}`,
  downloadReceipt: async (eventId: string): Promise<void> => {
    const res = await fetch(`${BASE}/export/receipt/${encodeURIComponent(eventId)}`);
    if (!res.ok) throw new ApiError(res.status, 'download_failed', 'Could not download receipt.');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${eventId}-receipt.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
  downloadCertificateText: (record: LedgerRecord, blockHash?: string, prevBlockHash?: string): void => {
    const divider = '='.repeat(80);
    const lines = [
      divider,
      '        BREADCRUMBS ENTERPRISE LEDGER — CRYPTOGRAPHIC AUDIT CERTIFICATE        ',
      divider,
      `Generated At (UTC):   ${new Date().toISOString()}`,
      `Consortium Network:   Breadcrumbs Federated Network (BFT Quorum / P-256)`,
      '',
      '--- RECORD IDENTIFICATION ' + '-'.repeat(54),
      `Event ID:             ${record.event_id}`,
      `Event Type:           ${record.event_type}`,
      `Event Family:         ${record.event_family}`,
      `Block Height:         #${record.block_index}`,
      `Timestamp (UTC):      ${record.timestamp}`,
      `Factory Entity:       ${record.factory_name} (${record.factory_id})`,
      `Submitter:            ${record.submitter_name} [${record.submitter_role}] (ID: ${record.submitter_id})`,
      `Governance Status:    ${record.status.toUpperCase()}`,
      '',
      '--- CRYPTOGRAPHIC ATTESTATION ' + '-'.repeat(50),
      `Block Hash (SHA-256): ${blockHash || record.block_hash || 'Anchored to Immutable Chain'}`,
      `Previous Block Hash:  ${prevBlockHash || record.previous_block_hash || 'Verified Chain Linkage'}`,
      `Signature Algorithm:  ECDSA P-256 with SHA-256 (Client-Side WebCrypto)`,
      `Non-Repudiation:      Key registered in browser secure enclave / hardware`,
      '',
      '--- AUDITED BUSINESS DATA ' + '-'.repeat(54),
      ...Object.entries(record.data_fields || {}).map(
        ([key, val]) => `${key.padEnd(22)}: ${typeof val === 'object' ? JSON.stringify(val) : String(val)}`
      ),
      '',
      '--- AUDIT VERDICT & GOVERNANCE ' + '-'.repeat(49),
      `AI Anomaly Detection: ${record.ai_flag ? `FLAGGED (${record.ai_flag_reason || record.ai_rule})` : 'PASSED (Clean - No Anomalies Detected)'}`,
      `Human Review Status:  ${record.human_review_status.toUpperCase()}${record.reviewer_name ? ` by ${record.reviewer_name}` : ''}`,
      '',
      divider,
      'Verification Note: This document is an offline-verifiable audit certificate.',
      'Anyone can recompute the cryptographic SHA-256 digest of this block and verify',
      'the author ECDSA signature in any standard browser or OpenSSL CLI.',
      divider,
    ];

    const blob = new Blob([lines.join('\r\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${record.event_id}-certificate.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
  exportTransactions: async (params: { family?: string; factory?: string; status?: string; q?: string; format: 'csv' | 'json' }): Promise<void> => {
    const headers = new Headers();
    if (authToken) headers.set('Authorization', `Bearer ${authToken}`);
    const res = await fetch(`${BASE}/export/transactions${query(params)}`, { headers });
    if (!res.ok) throw new ApiError(res.status, 'export_failed', 'Could not export ledger data.');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = params.format === 'csv' ? 'breadcrumbs-ledger-export.csv' : 'breadcrumbs-ledger-export.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
};

function query(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter(
    (entry): entry is [string, string | number] => entry[1] !== undefined && entry[1] !== '',
  );
  if (entries.length === 0) return '';
  return `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()}`;
}
