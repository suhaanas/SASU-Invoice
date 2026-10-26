/**
 * Small dependency-free charts for the overview. Colors: brand indigo for
 * "Invoiced" and aqua for "Received" (validated as a categorical pair on the
 * white surface; aqua is under 3:1 contrast, so a table view is always offered
 * and values are never conveyed by color alone).
 */
import { useId, useState } from 'react';
import type { DashboardSummary } from '../lib/api';
import { LOCALE, money, monthLabel } from '../lib/format';
import { cn } from './ui';

const SERIES = [
  { key: 'invoicedMinor', label: 'Invoiced', color: '#5b5ef4' },
  { key: 'receivedMinor', label: 'Received', color: '#1baf7a' },
] as const;

function compactMoney(minor: number, currency: string, digits: number): string {
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(minor / 10 ** digits);
}

/** A "nice" axis maximum: 1, 2 or 5 × 10^n at or above the value. */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(value));
  return ([1, 2, 5, 10].find((m) => m * pow >= value) ?? 10) * pow;
}

/** Column with a 4px rounded data end and a square base. */
function column(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, h, w / 2);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

function ViewToggle({ table, onChange }: { table: boolean; onChange: (t: boolean) => void }) {
  return (
    <div
      className="flex rounded-lg border border-field p-0.5 text-xs"
      role="group"
      aria-label="View as"
    >
      {[
        [false, 'Chart'],
        [true, 'Table'],
      ].map(([value, label]) => (
        <button
          key={String(label)}
          type="button"
          aria-pressed={table === value}
          onClick={() => onChange(value as boolean)}
          className={cn(
            'rounded-md px-2.5 py-1 font-medium',
            table === value ? 'bg-brand-wash text-brand-ink' : 'text-graphite hover:text-ink',
          )}
        >
          {label as string}
        </button>
      ))}
    </div>
  );
}

export function MonthlyChart({
  data,
  digits,
  period = 'Last 6 months',
}: {
  data: Pick<DashboardSummary, 'currency' | 'monthly'>;
  digits: number;
  period?: string;
}) {
  const [table, setTable] = useState(false);
  const [activeIndex, setActive] = useState<number | null>(null);
  const titleId = useId();
  const months = data.monthly;
  const max = niceMax(Math.max(...months.flatMap((m) => [m.invoicedMinor, m.receivedMinor])));
  const spansYears = months[0]?.month.slice(0, 4) !== months.at(-1)?.month.slice(0, 4);

  const W = 600;
  const H = 220;
  const pad = { top: 12, right: 8, bottom: 26, left: 56 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const band = plotW / months.length;
  const barW = Math.min(24, (band - 24) / 2);
  const y = (v: number) => pad.top + plotH - (v / max) * plotH;
  const ticks = [0, max / 2, max];
  const active = activeIndex;
  const hovered = active === null ? undefined : months[active];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 id={titleId} className="font-display text-base font-bold">
            Invoiced vs received
          </h3>
          <p className="text-xs text-graphite">
            {period} · {data.currency} · received = recorded payments
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ul className="flex gap-3 text-xs text-graphite" aria-label="Legend">
            {SERIES.map((s) => (
              <li key={s.key} className="flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 rounded-sm"
                  style={{ background: s.color }}
                  aria-hidden
                />
                {s.label}
              </li>
            ))}
          </ul>
          <ViewToggle table={table} onChange={setTable} />
        </div>
      </div>

      {table ? (
        <table className="w-full text-sm" aria-labelledby={titleId}>
          <thead>
            <tr className="border-b border-rule text-left text-xs font-semibold uppercase tracking-wide text-faint">
              <th scope="col" className="py-2">
                Month
              </th>
              <th scope="col" className="py-2 text-right">
                Invoiced
              </th>
              <th scope="col" className="py-2 text-right">
                Received
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {months.map((m) => (
              <tr key={m.month}>
                <th scope="row" className="py-2 text-left font-medium">
                  {monthLabel(m.month, true)}
                </th>
                <td className="py-2 text-right tabular-nums">
                  {money(m.invoicedMinor, data.currency)}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {money(m.receivedMinor, data.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="relative">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full"
            role="img"
            aria-labelledby={titleId}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={pad.left}
                  x2={W - pad.right}
                  y1={y(t)}
                  y2={y(t)}
                  stroke="#e2e5ea"
                  strokeWidth={1}
                />
                <text
                  x={pad.left - 8}
                  y={y(t)}
                  dy="0.32em"
                  textAnchor="end"
                  fontSize={11}
                  fill="#8a909b"
                >
                  {compactMoney(t, data.currency, digits)}
                </text>
              </g>
            ))}
            {months.map((m, i) => {
              const cx = pad.left + band * i + band / 2;
              return (
                <g
                  key={m.month}
                  tabIndex={0}
                  role="button"
                  aria-label={`${monthLabel(m.month, true)}: invoiced ${money(m.invoicedMinor, data.currency)}, received ${money(m.receivedMinor, data.currency)}`}
                  onMouseEnter={() => setActive(i)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  className="outline-none"
                >
                  {/* Hit target bigger than the marks. */}
                  <rect
                    x={cx - band / 2}
                    y={pad.top}
                    width={band}
                    height={plotH}
                    fill={active === i ? '#f2f3f6' : 'transparent'}
                  />
                  {SERIES.map((s, si) => {
                    const v = m[s.key];
                    const h = Math.max(0, pad.top + plotH - y(v));
                    const x = cx - barW - 1 + si * (barW + 2);
                    return v > 0 ? (
                      <path key={s.key} d={column(x, y(v), barW, h)} fill={s.color} />
                    ) : null;
                  })}
                  <text x={cx} y={H - 8} textAnchor="middle" fontSize={11} fill="#5a606b">
                    {monthLabel(m.month, spansYears)}
                  </text>
                </g>
              );
            })}
            <line
              x1={pad.left}
              x2={W - pad.right}
              y1={y(0)}
              y2={y(0)}
              stroke="#d9dde3"
              strokeWidth={1}
            />
          </svg>
          {active !== null && hovered && (
            <div
              className="pointer-events-none absolute top-2 z-10 rounded-lg border border-rule bg-paper px-3 py-2 text-xs shadow-lg"
              style={{
                left: `${((pad.left + band * active + band / 2) / W) * 100}%`,
                transform: active > months.length / 2 ? 'translateX(-105%)' : 'translateX(5%)',
              }}
            >
              <p className="mb-1 font-semibold">{monthLabel(hovered.month, true)}</p>
              {SERIES.map((s) => (
                <p
                  key={s.key}
                  className="flex items-center gap-1.5 whitespace-nowrap text-graphite"
                >
                  <span
                    className="h-2 w-2 rounded-sm"
                    style={{ background: s.color }}
                    aria-hidden
                  />
                  {s.label}
                  <span className="ml-auto pl-3 font-semibold tabular-nums text-ink">
                    {money(hovered[s.key], data.currency)}
                  </span>
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const AGING = [
  { key: 'current', label: 'Not yet due' },
  { key: 'd1_30', label: '1–30 days late' },
  { key: 'd31_60', label: '31–60 days late' },
  { key: 'd61_90', label: '61–90 days late' },
  { key: 'd90_plus', label: 'Over 90 days late' },
] as const;

/** Outstanding balance by days overdue; one series, labelled values, so it reads as its own table. */
export function AgingChart({ data }: { data: DashboardSummary }) {
  const max = Math.max(1, ...AGING.map((a) => data.aging[a.key]));
  return (
    <div>
      <h3 className="font-display text-base font-bold">Outstanding by age</h3>
      <p className="mb-4 text-xs text-graphite">
        {data.currency} · unpaid balance of issued invoices
      </p>
      <dl className="space-y-3">
        {AGING.map((a) => {
          const v = data.aging[a.key];
          return (
            <div key={a.key}>
              <div className="mb-1 flex justify-between text-xs">
                <dt className="text-graphite">{a.label}</dt>
                <dd className="font-semibold tabular-nums">{money(v, data.currency)}</dd>
              </div>
              <div className="h-2 rounded-full bg-hover" aria-hidden>
                <div
                  className="h-2 rounded-full bg-brand"
                  style={{ width: `${(v / max) * 100}%` }}
                />
              </div>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
