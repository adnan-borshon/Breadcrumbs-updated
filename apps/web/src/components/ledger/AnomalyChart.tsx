/**
 * AnomalyChart — Inline Gaussian distribution curve rendered in pure SVG.
 *
 * Shows:
 *  - A bell curve for the factory's historical baseline
 *  - The mean (μ) and ±2.5σ boundary markers
 *  - The current submission's position on the distribution
 *  - A human-readable sigma distance label
 *
 * No external charting library. All math is standard normal PDF.
 */

import { cx } from '../ui/primitives.tsx';

interface AnomalyChartProps {
  /** The submission value (e.g. units produced). */
  value: number;
  /** Historical mean (μ). */
  mean: number;
  /** Standard deviation (σ). Estimated if not provided. */
  stdDev?: number;
  /** Label for the value axis (e.g. "units"). */
  unit?: string;
  className?: string;
}

/* ----------------------------------------------------------------- helpers */

function normalPdf(x: number, mean: number, std: number): number {
  const z = (x - mean) / std;
  return Math.exp(-0.5 * z * z) / (std * Math.sqrt(2 * Math.PI));
}

function sigmaLabel(sigma: number): { text: string; tone: string } {
  const abs = Math.abs(sigma);
  if (abs < 1.5) return { text: `${sigma.toFixed(1)}σ — within normal range`, tone: 'text-teal' };
  if (abs < 2.5) return { text: `${sigma.toFixed(1)}σ — elevated, monitor closely`, tone: 'text-[#8a6d24]' };
  return { text: `${sigma.toFixed(1)}σ — anomaly threshold exceeded`, tone: 'text-clay' };
}

/* ------------------------------------------------------------------ chart */

export function AnomalyChart({
  value,
  mean,
  stdDev,
  unit = 'units',
  className,
}: AnomalyChartProps) {
  // If stdDev not given, estimate as 15% of mean (typical manufacturing variance)
  const std = stdDev ?? Math.max(mean * 0.15, 1);
  const sigma = (value - mean) / std;
  const { text: sigText, tone } = sigmaLabel(sigma);

  // Chart parameters
  const W = 500;
  const H = 100;
  const PAD = 20;
  const plotW = W - PAD * 2;

  // x range: μ ± 4σ
  const xMin = mean - 4 * std;
  const xMax = mean + 4 * std;

  const toX = (v: number) => PAD + ((v - xMin) / (xMax - xMin)) * plotW;
  const toY = (pdf: number, maxPdf: number) => H - 10 - (pdf / maxPdf) * (H - 20);

  const maxPdf = normalPdf(mean, mean, std);

  // Build the curve path
  const steps = 100;
  const points: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const x = xMin + (i / steps) * (xMax - xMin);
    const y = normalPdf(x, mean, std);
    points.push([toX(x), toY(y, maxPdf)]);
  }

  const pathD =
    `M ${points[0][0]},${H - 10} ` +
    `L ${points[0][0]},${points[0][1]} ` +
    points.slice(1).map(([x, y]) => `L ${x},${y}`).join(' ') +
    ` L ${points[points.length - 1][0]},${H - 10} Z`;

  // Key x positions
  const xMean = toX(mean);
  const xSigPos = toX(mean + 2.5 * std);
  const xSigNeg = toX(mean - 2.5 * std);
  const xValue = toX(Math.min(Math.max(value, xMin), xMax));
  const yValue = toY(normalPdf(value, mean, std), maxPdf);

  const valueInRange = value >= xMin && value <= xMax;

  return (
    <div className={cx('space-y-2', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[0.72rem] font-medium uppercase tracking-wide text-ink-muted">
          Anomaly baseline distribution
        </p>
        <p className={cx('text-[0.76rem] font-semibold', tone)}>{sigText}</p>
      </div>

      <div className="rounded-md border border-hairline bg-parchment/60 p-2">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          role="img"
          aria-label={`Statistical distribution chart. Current value is ${sigma.toFixed(1)} standard deviations from the mean.`}
        >
          {/* Shaded area under curve */}
          <path d={pathD} fill="#0F2540" fillOpacity="0.07" />

          {/* Curve outline */}
          <path
            d={
              `M ${points[0][0]},${points[0][1]} ` +
              points.slice(1).map(([x, y]) => `L ${x},${y}`).join(' ')
            }
            fill="none"
            stroke="#0F2540"
            strokeWidth="1.5"
            strokeOpacity="0.4"
          />

          {/* ±2.5σ boundaries */}
          <line
            x1={xSigNeg} y1={10} x2={xSigNeg} y2={H - 10}
            stroke="#C9A24B" strokeWidth="1" strokeDasharray="3,2" strokeOpacity="0.7"
          />
          <line
            x1={xSigPos} y1={10} x2={xSigPos} y2={H - 10}
            stroke="#C9A24B" strokeWidth="1" strokeDasharray="3,2" strokeOpacity="0.7"
          />

          {/* Mean line */}
          <line
            x1={xMean} y1={12} x2={xMean} y2={H - 10}
            stroke="#0F2540" strokeWidth="1.5" strokeOpacity="0.35"
          />

          {/* Mean label */}
          <text x={xMean} y={10} textAnchor="middle" fontSize="7" fill="#0F2540" fillOpacity="0.6">μ</text>

          {/* σ boundary labels */}
          <text x={xSigNeg} y={H - 2} textAnchor="middle" fontSize="6" fill="#8a6d24" fillOpacity="0.8">−2.5σ</text>
          <text x={xSigPos} y={H - 2} textAnchor="middle" fontSize="6" fill="#8a6d24" fillOpacity="0.8">+2.5σ</text>

          {/* Current value marker */}
          {valueInRange && (
            <>
              <line
                x1={xValue} y1={yValue - 4} x2={xValue} y2={H - 10}
                stroke={Math.abs(sigma) >= 2.5 ? '#B44' : '#0F2540'}
                strokeWidth="2"
              />
              <circle
                cx={xValue} cy={yValue - 4} r="4"
                fill={Math.abs(sigma) >= 2.5 ? '#B44' : '#0F2540'}
              />
            </>
          )}

          {/* Out-of-range arrow */}
          {!valueInRange && (
            <text
              x={sigma > 0 ? W - PAD - 4 : PAD + 4}
              y={H / 2}
              fontSize="12"
              fill="#B44"
              textAnchor={sigma > 0 ? 'end' : 'start'}
            >
              {sigma > 0 ? '→' : '←'}
            </text>
          )}
        </svg>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-md border border-hairline bg-surface px-2 py-1.5">
          <p className="text-[0.6rem] uppercase tracking-wide text-ink-faint">Mean (μ)</p>
          <p className="text-[0.78rem] font-semibold text-navy tabular">
            {mean.toLocaleString('en-US')} {unit}
          </p>
        </div>
        <div className="rounded-md border border-hairline bg-surface px-2 py-1.5">
          <p className="text-[0.6rem] uppercase tracking-wide text-ink-faint">Std Dev (σ)</p>
          <p className="text-[0.78rem] font-semibold text-navy tabular">
            ±{std.toLocaleString('en-US', { maximumFractionDigits: 0 })} {unit}
          </p>
        </div>
        <div className={cx(
          'rounded-md border px-2 py-1.5',
          Math.abs(sigma) >= 2.5 ? 'border-clay/30 bg-clay-soft' : 'border-hairline bg-surface',
        )}>
          <p className="text-[0.6rem] uppercase tracking-wide text-ink-faint">This submission</p>
          <p className={cx(
            'text-[0.78rem] font-semibold tabular',
            Math.abs(sigma) >= 2.5 ? 'text-clay' : 'text-navy',
          )}>
            {value.toLocaleString('en-US')} {unit}
          </p>
        </div>
      </div>
    </div>
  );
}
