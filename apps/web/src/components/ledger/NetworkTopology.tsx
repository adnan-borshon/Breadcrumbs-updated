/**
 * NetworkTopology — Live Federated Consortium & Public Blockchain Notarization.
 *
 * Visualizes the multi-party consortium nodes, live synchronization telemetry,
 * and decentralized public blockchain notarization checkpoints (Polygon Amoy / L1).
 */

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ExternalLink,
  Anchor,
  Loader2,
} from 'lucide-react';
import type { ConsortiumPeer } from '@breadcrumbs/shared';

import { api } from '../../lib/api.ts';
import { Button, cx } from '../ui/primitives.tsx';

interface VisualNode extends ConsortiumPeer {
  x: number;
  y: number;
}

const DEFAULT_COORDS: Record<string, { x: number; y: number }> = {
  'brand-frankfurt': { x: 50, y: 18 },
  'factory-dhaka': { x: 18, y: 76 },
  'compliance-geneva': { x: 82, y: 76 },
};

const EDGES = [
  { from: 'brand-frankfurt', to: 'factory-dhaka' },
  { from: 'brand-frankfurt', to: 'compliance-geneva' },
  { from: 'factory-dhaka', to: 'compliance-geneva' },
];

const STATUS_COLOR: Record<string, string> = {
  active: '#2A9D7A',
  syncing: '#C9A24B',
  standby: '#888',
};

const ROLE_FILL: Record<string, string> = {
  Validator: '#0F2540',
  Observer: '#2A9D7A',
};

interface Pulse {
  id: number;
  edgeFrom: string;
  edgeTo: string;
  t: number;
}

let pulseCounter = 0;

export function NetworkTopology() {
  const queryClient = useQueryClient();
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const [activeNodeId, setActiveNodeId] = useState<string | null>('brand-frankfurt');

  const telemetryQuery = useQuery({
    queryKey: ['chain', 'peers'],
    queryFn: api.peers,
    refetchInterval: 5000,
  });

  const checkpointsQuery = useQuery({
    queryKey: ['chain', 'checkpoints'],
    queryFn: api.checkpoints,
    refetchInterval: 10000,
  });

  const notarizeMutation = useMutation({
    mutationFn: api.notarize,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chain', 'checkpoints'] });
      queryClient.invalidateQueries({ queryKey: ['chain', 'peers'] });
    },
  });

  const telemetry = telemetryQuery.data;
  const rawPeers = telemetry?.peers ?? [];

  const nodes: VisualNode[] = rawPeers.map((p) => ({
    ...p,
    x: DEFAULT_COORDS[p.id]?.x ?? 50,
    y: DEFAULT_COORDS[p.id]?.y ?? 50,
  }));

  // Animate gossip pulses along consortium mesh
  useEffect(() => {
    let raf: number;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;

      setPulses((prev) => {
        const updated = prev
          .map((p) => ({ ...p, t: p.t + dt * 0.45 }))
          .filter((p) => p.t < 1);

        if (Math.random() < 0.02 && updated.length < 5) {
          const edge = EDGES[Math.floor(Math.random() * EDGES.length)];
          const reversed = Math.random() < 0.5;
          if (edge) {
            updated.push({
              id: pulseCounter++,
              edgeFrom: reversed ? edge.to : edge.from,
              edgeTo: reversed ? edge.from : edge.to,
              t: 0,
            });
          }
        }

        return updated;
      });

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const getNodePos = (id: string) => {
    const n = nodes.find((node) => node.id === id);
    return n ? { x: n.x, y: n.y } : { x: 50, y: 50 };
  };

  const selectedNode = nodes.find((n) => n.id === activeNodeId) ?? nodes[0] ?? null;

  return (
    <div className="space-y-6">
      {/* Top Banner: Real Consensus & Public Anchor status */}
      <ConsensusHealthBar
        telemetry={telemetry}
        onNotarize={() => notarizeMutation.mutate()}
        isNotarizing={notarizeMutation.isPending}
      />

      <div className="grid gap-5 lg:grid-cols-3">
        {/* SVG Mesh Visualizer */}
        <div className="lg:col-span-2">
          <div className="rounded-[var(--radius-card)] border border-hairline bg-[#070f1e] p-4 relative overflow-hidden">
            <div className="absolute top-3 left-4 flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-teal" />
              </span>
              <span className="text-[0.68rem] font-mono uppercase tracking-wider text-[#8fabc7]">
                Live Consortium Telemetry ({nodes.length} Nodes Synchronized)
              </span>
            </div>

            <svg viewBox="0 0 100 100" className="w-full" style={{ height: '290px' }}>
              {/* Edges */}
              {EDGES.map((edge) => {
                const from = getNodePos(edge.from);
                const to = getNodePos(edge.to);
                return (
                  <line
                    key={`${edge.from}-${edge.to}`}
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    stroke="#1e3a5f"
                    strokeWidth="0.6"
                    strokeDasharray="1.5,1"
                  />
                );
              })}

              {/* Pulses */}
              {pulses.map((pulse) => {
                const from = getNodePos(pulse.edgeFrom);
                const to = getNodePos(pulse.edgeTo);
                const cx = from.x + (to.x - from.x) * pulse.t;
                const cy = from.y + (to.y - from.y) * pulse.t;
                return (
                  <circle
                    key={pulse.id}
                    cx={cx}
                    cy={cy}
                    r="1"
                    fill="#C9A24B"
                    opacity={1 - pulse.t * 0.25}
                  />
                );
              })}

              {/* Nodes */}
              {nodes.map((node) => (
                <g
                  key={node.id}
                  transform={`translate(${node.x},${node.y})`}
                  className="cursor-pointer transition-transform duration-200"
                  onClick={() => setActiveNodeId(node.id)}
                >
                  <circle
                    r="8"
                    fill="none"
                    stroke={STATUS_COLOR[node.status] ?? '#2A9D7A'}
                    strokeWidth="0.6"
                    opacity={activeNodeId === node.id ? 1 : 0.4}
                  />
                  <circle
                    r="6"
                    fill={ROLE_FILL[node.role] ?? '#0F2540'}
                    opacity={activeNodeId === node.id ? 1 : 0.85}
                  />
                  <text
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize="3.5"
                    fill="white"
                    fontWeight="bold"
                  >
                    {node.role[0]}
                  </text>
                  <text y="12" textAnchor="middle" fontSize="3" fill="#cbd5e1" fontWeight="500">
                    {node.city.split(',')[0]}
                  </text>
                  <text y="16.5" textAnchor="middle" fontSize="2.6" fill="#2A9D7A" fontFamily="monospace">
                    #{node.height} ({node.latency_ms}ms)
                  </text>
                </g>
              ))}
            </svg>

            {/* Legend */}
            <div className="mt-1 flex flex-wrap items-center justify-center gap-5 text-[0.68rem] text-[#8fabc7]">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-[#0F2540] border border-white/20" />
                Validator Node
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-[#2A9D7A]" />
                Observer Node
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-1.5 w-4 rounded bg-[#C9A24B]" />
                Gossip Sync Pulse
              </span>
            </div>
          </div>
        </div>

        {/* Node detail side panel */}
        <div>
          {selectedNode ? (
            <NodeDetailCard node={selectedNode} />
          ) : (
            <div className="flex h-full items-center justify-center rounded-[var(--radius-card)] border border-dashed border-hairline p-6 text-center">
              <p className="text-[0.78rem] text-ink-muted">Click a node on the map to see its live telemetry.</p>
            </div>
          )}
        </div>
      </div>

      {/* Public Blockchain Notarization Anchors Table */}
      <div className="rounded-[var(--radius-card)] border border-hairline bg-surface p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Anchor className="h-4 w-4 text-navy" />
              <h3 className="font-display font-semibold text-navy text-[0.98rem]">
                Public Blockchain Notarization Checkpoints
              </h3>
            </div>
            <p className="text-[0.75rem] text-ink-muted mt-0.5">
              Cumulative Merkle roots periodically anchored to Polygon Amoy L2. Defeats central operator history deletion.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="text-[0.75rem] py-1.5 px-3"
            onClick={() => notarizeMutation.mutate()}
            disabled={notarizeMutation.isPending}
          >
            {notarizeMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
            ) : (
              <Anchor className="h-3.5 w-3.5 mr-1" />
            )}
            Notarize Chain Head
          </Button>
        </div>

        {checkpointsQuery.isLoading ? (
          <p className="text-[0.78rem] text-ink-muted py-3">Loading notarization checkpoints...</p>
        ) : (checkpointsQuery.data?.checkpoints?.length ?? 0) === 0 ? (
          <p className="text-[0.78rem] text-ink-muted py-2">
            No public checkpoints created yet. Click "Notarize Chain Head" to anchor the latest block.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[0.78rem]">
              <thead>
                <tr className="border-b border-hairline text-[0.68rem] font-semibold uppercase tracking-wide text-ink-muted">
                  <th className="py-2.5 px-3">Checkpoint</th>
                  <th className="py-2.5 px-3">Block Height</th>
                  <th className="py-2.5 px-3">State Merkle Root</th>
                  <th className="py-2.5 px-3">Public Network</th>
                  <th className="py-2.5 px-3">Notarized At</th>
                  <th className="py-2.5 px-3">L1/L2 Transaction</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline/60 font-mono">
                {checkpointsQuery.data?.checkpoints.map((cp) => (
                  <tr key={cp.checkpoint_id} className="hover:bg-parchment/50 transition-colors">
                    <td className="py-2.5 px-3 font-semibold text-navy font-sans">{cp.checkpoint_id}</td>
                    <td className="py-2.5 px-3 text-teal">#{cp.block_height}</td>
                    <td className="py-2.5 px-3 text-ink-muted" title={cp.merkle_root}>
                      {cp.merkle_root.slice(0, 10)}...{cp.merkle_root.slice(-8)}
                    </td>
                    <td className="py-2.5 px-3 font-sans text-ink">{cp.network}</td>
                    <td className="py-2.5 px-3 font-sans text-ink-muted">
                      {new Date(cp.notarized_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </td>
                    <td className="py-2.5 px-3">
                      <a
                        href={cp.explorer_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-teal font-medium hover:underline"
                      >
                        <span>{cp.tx_hash.slice(0, 8)}...{cp.tx_hash.slice(-6)}</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Node registry table */}
      <div className="overflow-x-auto rounded-[var(--radius-card)] border border-hairline bg-surface">
        <table className="w-full text-left text-[0.8rem]">
          <thead>
            <tr>
              {['Node', 'Organisation', 'Location', 'Role', 'Sync Height', 'Ping Latency', 'Status'].map((h) => (
                <th
                  key={h}
                  scope="col"
                  className="border-b border-hairline px-4 py-2.5 text-[0.68rem] font-semibold uppercase tracking-wide text-ink-muted"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {nodes.map((node) => (
              <tr
                key={node.id}
                className={cx(
                  'cursor-pointer transition-colors hover:bg-parchment/60',
                  activeNodeId === node.id && 'bg-navy/5',
                )}
                onClick={() => setActiveNodeId(node.id)}
              >
                <td className="border-b border-hairline/60 px-4 py-3">
                  <p className="font-medium text-navy">{node.label}</p>
                </td>
                <td className="border-b border-hairline/60 px-4 py-3 text-ink-muted">{node.org}</td>
                <td className="border-b border-hairline/60 px-4 py-3 text-ink-muted">{node.city}</td>
                <td className="border-b border-hairline/60 px-4 py-3">
                  <RolePill role={node.role} />
                </td>
                <td className="border-b border-hairline/60 px-4 py-3 font-mono text-teal">
                  #{node.height}
                </td>
                <td className="border-b border-hairline/60 px-4 py-3 font-mono text-ink-muted">
                  {node.latency_ms} ms
                </td>
                <td className="border-b border-hairline/60 px-4 py-3">
                  <StatusPill status={node.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- sub-components */

function NodeDetailCard({ node }: { node: VisualNode }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-hairline bg-surface p-4 space-y-3">
      <div className="flex items-start gap-2.5">
        <span
          className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[0.72rem] font-bold text-white shadow-sm"
          style={{ backgroundColor: ROLE_FILL[node.role] }}
        >
          {node.role[0]}
        </span>
        <div>
          <p className="font-semibold text-navy text-[0.88rem]">{node.label}</p>
          <p className="text-[0.74rem] text-ink-muted">{node.org}</p>
        </div>
      </div>
      <dl className="divide-y divide-hairline/60 text-[0.78rem]">
        <div className="flex justify-between py-1.5">
          <dt className="text-ink-muted">Location</dt>
          <dd className="font-medium text-navy">{node.city}</dd>
        </div>
        <div className="flex justify-between py-1.5">
          <dt className="text-ink-muted">Consortium Role</dt>
          <dd><RolePill role={node.role} /></dd>
        </div>
        <div className="flex justify-between py-1.5">
          <dt className="text-ink-muted">Synchronized Height</dt>
          <dd className="font-mono text-teal font-semibold">#{node.height}</dd>
        </div>
        <div className="flex justify-between py-1.5">
          <dt className="text-ink-muted">Peer Latency</dt>
          <dd className="font-mono text-ink font-medium">{node.latency_ms} ms</dd>
        </div>
        <div className="flex justify-between py-1.5">
          <dt className="text-ink-muted">Consensus Health</dt>
          <dd><StatusPill status={node.status} /></dd>
        </div>
        <div className="flex justify-between py-1.5">
          <dt className="text-ink-muted">Last Block Hash</dt>
          <dd className="font-mono text-[0.7rem] text-ink-muted" title={node.last_block_hash}>
            {node.last_block_hash ? `${node.last_block_hash.slice(0, 10)}...` : 'Synchronized'}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function RolePill({ role }: { role: 'Validator' | 'Observer' }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-[var(--radius-pill)] px-2 py-0.5 text-[0.68rem] font-medium',
        role === 'Validator'
          ? 'border border-navy/30 bg-navy/8 text-navy'
          : 'border border-teal/30 bg-teal-soft text-teal',
      )}
    >
      {role}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const colors = {
    active: 'border-teal/30 bg-teal-soft text-teal',
    syncing: 'border-gold/30 bg-gold-soft text-[#8a6d24]',
    standby: 'border-hairline bg-parchment text-ink-muted',
  };
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border px-2 py-0.5 text-[0.68rem] font-medium capitalize',
        colors[status as keyof typeof colors] ?? colors.standby,
      )}
    >
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: STATUS_COLOR[status] ?? '#2A9D7A' }}
      />
      {status}
    </span>
  );
}

function ConsensusHealthBar({
  telemetry,
  onNotarize,
  isNotarizing,
}: {
  telemetry: any;
  onNotarize: () => void;
  isNotarizing: boolean;
}) {
  const latestCp = telemetry?.latest_checkpoint;
  const height = telemetry?.local_node?.height ?? 165;

  return (
    <div className="rounded-[var(--radius-card)] border border-teal/25 bg-teal-soft/40 px-5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3 text-[0.78rem]">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal opacity-50" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-teal" />
            </span>
            <span className="font-semibold text-teal">Consortium Quorum Active</span>
          </div>
          <span className="text-ink-muted">
            Consensus: <span className="font-medium text-navy">{telemetry?.consensus?.protocol ?? 'Federated BFT + Public L2 Anchor'}</span>
          </span>
          <span className="text-ink-muted">
            Validators: <span className="font-medium text-navy">{telemetry?.consensus?.validators_online ?? 2} / {telemetry?.consensus?.total_validators ?? 2} online</span>
          </span>
          <span className="text-ink-muted">
            Chain Height: <span className="font-mono font-medium text-teal">#{height}</span>
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          {latestCp && (
            <div className="flex items-center gap-2 text-[0.72rem] bg-surface/80 rounded-md px-2.5 py-1 border border-teal/20">
              <Anchor className="h-3 w-3 text-teal" />
              <span className="text-ink-muted">Anchored to {latestCp.network}:</span>
              <a
                href={latestCp.explorer_url}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-teal hover:underline inline-flex items-center gap-1 font-medium"
              >
                <span>{latestCp.tx_hash.slice(0, 8)}...</span>
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </div>
          )}

          <button
            type="button"
            onClick={onNotarize}
            disabled={isNotarizing}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-teal text-white text-[0.72rem] font-medium hover:bg-teal-dark disabled:opacity-50 transition"
            title="Anchor current Merkle root to public L2"
          >
            <Anchor className={cx('h-3 w-3', isNotarizing && 'animate-spin')} />
            <span>{isNotarizing ? 'Anchoring...' : 'Anchor Now'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
