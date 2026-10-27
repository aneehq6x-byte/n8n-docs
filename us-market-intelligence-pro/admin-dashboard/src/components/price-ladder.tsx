import { fmtPrice } from "@/lib/format";
import type { Locale } from "@/lib/i18n";

/**
 * Plan geometry on one price axis: stop, entry zone, reference, T1, T2.
 * Loss side is drawn in the critical hue, reward side in the accent hue; every level is
 * also labelled with its name and price (never colour alone).
 */
export function PriceLadder({ o, locale, labels }: {
  o: { stop: number; entry_low: number; entry_high: number; target1: number; target2: number; reference_price: number; direction: "long" | "short" };
  locale: Locale; labels: { stop: string; entry: string; t1: string; t2: string; ref: string };
}) {
  const vals = [o.stop, o.entry_low, o.entry_high, o.target1, o.target2];
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pad = (hi - lo) * 0.06 || 1;
  const W = 640, H = 72, L = 16, R = 16, Y = 40;
  const x = (v: number) => L + ((v - (lo - pad)) / (hi + pad - (lo - pad))) * (W - L - R);
  const mid = (o.entry_low + o.entry_high) / 2;
  const marks = [
    { v: o.stop, label: labels.stop, color: "var(--critical)" },
    { v: o.target1, label: labels.t1, color: "var(--series-1)" },
    { v: o.target2, label: labels.t2, color: "var(--series-1)" },
  ];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full [direction:ltr]" role="img"
      aria-label={`${labels.stop} ${o.stop}, ${labels.entry} ${o.entry_low}–${o.entry_high}, ${labels.t1} ${o.target1}, ${labels.t2} ${o.target2}`}>
      <line x1={L} x2={W - R} y1={Y} y2={Y} stroke="var(--baseline)" strokeWidth={1} />
      <rect x={Math.min(x(o.stop), x(mid))} y={Y - 3} width={Math.abs(x(mid) - x(o.stop))} height={6} rx={3} fill="var(--critical)" opacity={0.35} />
      <rect x={Math.min(x(mid), x(o.target2))} y={Y - 3} width={Math.abs(x(o.target2) - x(mid))} height={6} rx={3} fill="var(--series-1)" opacity={0.3} />
      <rect x={x(o.entry_low) - 2} y={Y - 8} width={Math.max(6, x(o.entry_high) - x(o.entry_low) + 4)} height={16} rx={4}
        fill="var(--surface)" stroke="var(--ink)" strokeWidth={2} />
      <text x={x(mid)} y={Y - 16} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--ink)">{labels.entry}</text>
      <text x={x(mid)} y={Y + 26} textAnchor="middle" fontSize={11} fill="var(--ink-2)" className="tnum">{fmtPrice(o.entry_low, locale)}–{fmtPrice(o.entry_high, locale)}</text>
      {marks.map((m) => (
        <g key={m.label}>
          <circle cx={x(m.v)} cy={Y} r={5} fill={m.color} stroke="var(--surface)" strokeWidth={2} />
          <text x={x(m.v)} y={Y - 14} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--ink)">{m.label}</text>
          <text x={x(m.v)} y={Y + 24} textAnchor="middle" fontSize={11} fill="var(--ink-2)" className="tnum">{fmtPrice(m.v, locale)}</text>
        </g>
      ))}
    </svg>
  );
}
