"use client";

/**
 * Minimal SVG charts following the data-viz specs: single y-axis, recessive hairline grid,
 * columns ≤24px with 4px rounded data-ends, 2px lines, ≥8px end markers with a surface ring,
 * area wash ~10%, hover tooltip/crosshair, and a table view so values are never colour- or
 * hover-gated. Time runs left→right in both locales (financial convention).
 */

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { fmtCompact, fmtNumber, fmtR } from "@/lib/format";
import type { Locale } from "@/lib/i18n";

export type ValueKind = "stars" | "count" | "r";

function formatters(kind: ValueKind, locale: Locale) {
  const format = (n: number) =>
    kind === "stars" ? `${fmtNumber(n, locale)} ⭐` : kind === "r" ? fmtR(n, locale) : fmtNumber(n, locale);
  const compact = (n: number) => (kind === "r" ? `${fmtNumber(n, locale, { maximumFractionDigits: 1 })}R` : fmtCompact(n, locale));
  return { format, compact };
}

export interface Point { x: string; y: number; label?: string }

function useWidth<T extends HTMLElement>(fallback = 640) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setW(Math.max(240, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) {
    const pad = Math.abs(min) || 1;
    min -= pad;
    max += pad;
  }
  const span = max - min;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? raw;
  const start = Math.floor(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 0.5; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

const PAD = { top: 16, right: 16, bottom: 28, left: 48 };

function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const left = Math.min(Math.max(x, 8), width - 8);
  const flip = left > width * 0.66;
  return (
    <div
      className="pointer-events-none absolute z-10 whitespace-nowrap rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-ink shadow-lg"
      style={{ top: Math.max(0, y - 52), left, transform: flip ? "translateX(calc(-100% - 10px))" : "translateX(10px)" }}
    >
      {children}
    </div>
  );
}

function DataTable({ points, format, labels }: { points: Point[]; format: (n: number) => string; labels: { x: string; y: string; caption: string; toggle: string } }) {
  return (
    <details className="mt-2 text-xs text-ink-2">
      <summary className="cursor-pointer select-none text-muted hover:text-ink">{labels.toggle}</summary>
      <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-line">
        <table className="w-full text-xs">
          <caption className="sr-only">{labels.caption}</caption>
          <thead>
            <tr><th className="px-3 py-1.5 text-start font-medium text-muted">{labels.x}</th><th className="px-3 py-1.5 text-end font-medium text-muted">{labels.y}</th></tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.x} className="border-t border-line">
                <td className="px-3 py-1.5 tnum">{p.label ?? p.x}</td>
                <td className="px-3 py-1.5 text-end tnum">{format(p.y)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export interface ChartLabels { x: string; y: string; caption: string; toggle: string }

export function ColumnChart({ points, kind, locale, height = 200, labels, ariaLabel }: {
  points: Point[]; kind: ValueKind; locale: Locale; height?: number; labels: ChartLabels; ariaLabel: string;
}) {
  const { format, compact } = formatters(kind, locale);
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const clip = useId();
  const max = Math.max(0, ...points.map((p) => p.y));
  const ticks = niceTicks(0, max || 1);
  const top = ticks[ticks.length - 1] ?? 1;
  const iw = width - PAD.left - PAD.right;
  const ih = height - PAD.top - PAD.bottom;
  const band = iw / Math.max(points.length, 1);
  const bw = Math.min(24, Math.max(2, band - 2));
  const y = (v: number) => PAD.top + ih - (v / top) * ih;
  const every = Math.ceil(points.length / Math.max(2, Math.floor(iw / 72)));
  const h = hover !== null ? points[hover] : undefined;

  return (
    <div>
      <div ref={ref} className="relative" dir="ltr">
        <svg width={width} height={height} role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
          <defs><clipPath id={clip}><rect x={PAD.left} y={PAD.top} width={iw} height={ih} /></clipPath></defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--baseline)" : "var(--grid)"} strokeWidth={1} />
              <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--muted)" className="tnum">{compact(t)}</text>
            </g>
          ))}
          {points.map((p, i) => {
            const cx = PAD.left + band * i + band / 2;
            const yy = y(Math.max(0, p.y));
            const hh = PAD.top + ih - yy;
            const r = Math.min(4, bw / 2, hh);
            return (
              <g key={p.x}>
                {hh > 0 ? (
                  <path
                    d={`M${cx - bw / 2},${PAD.top + ih} V${yy + r} Q${cx - bw / 2},${yy} ${cx - bw / 2 + r},${yy} H${cx + bw / 2 - r} Q${cx + bw / 2},${yy} ${cx + bw / 2},${yy + r} V${PAD.top + ih} Z`}
                    fill="var(--series-1)"
                    opacity={hover === null || hover === i ? 1 : 0.45}
                  />
                ) : null}
                {i % every === 0 ? (
                  <text x={cx} y={height - 8} textAnchor="middle" fontSize={11} fill="var(--muted)" className="tnum">{p.label ?? p.x}</text>
                ) : null}
                <rect x={PAD.left + band * i} y={PAD.top} width={band} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} />
              </g>
            );
          })}
        </svg>
        {h && hover !== null ? (
          <Tooltip x={PAD.left + band * hover + band / 2} y={y(Math.max(0, h.y))} width={width}>
            <div className="text-muted">{h.label ?? h.x}</div>
            <div className="font-semibold tnum">{format(h.y)}</div>
          </Tooltip>
        ) : null}
      </div>
      <DataTable points={points} format={format} labels={labels} />
    </div>
  );
}

export function LineChart({ points, kind, locale, height = 200, labels, ariaLabel, zeroLine = false, area = true }: {
  points: Point[]; kind: ValueKind; locale: Locale; height?: number; labels: ChartLabels; ariaLabel: string;
  zeroLine?: boolean; area?: boolean;
}) {
  const { format, compact } = formatters(kind, locale);
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const ys = points.map((p) => p.y);
  const lo = Math.min(zeroLine ? 0 : Math.min(...ys, 0), ...ys);
  const hi = Math.max(...ys, zeroLine ? 0 : 1);
  const ticks = niceTicks(lo, hi);
  const tmin = ticks[0] ?? 0;
  const tmax = ticks[ticks.length - 1] ?? 1;
  const iw = width - PAD.left - PAD.right;
  const ih = height - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length <= 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v: number) => PAD.top + ih - ((v - tmin) / (tmax - tmin || 1)) * ih;
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.y)}`).join(" ");
  const base = y(Math.max(tmin, Math.min(0, tmax)));
  const areaPath = points.length ? `${path} L${x(points.length - 1)},${base} L${x(0)},${base} Z` : "";
  const every = Math.ceil(points.length / Math.max(2, Math.floor(iw / 72)));
  const last = points[points.length - 1];
  const h = hover !== null ? points[hover] : undefined;

  function onMove(e: React.MouseEvent<SVGRectElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - box.left) / box.width;
    setHover(Math.round(rel * (points.length - 1)));
  }

  return (
    <div>
      <div ref={ref} className="relative" dir="ltr">
        <svg width={width} height={height} role="img" aria-label={ariaLabel}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--baseline)" : "var(--grid)"} strokeWidth={1} />
              <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--muted)" className="tnum">{compact(t)}</text>
            </g>
          ))}
          {area && points.length > 1 ? <path d={areaPath} fill="var(--series-1)" opacity={0.1} /> : null}
          {points.length > 1 ? <path d={path} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" /> : null}
          {points.map((p, i) => (i % every === 0 ? (
            <text key={p.x} x={x(i)} y={height - 8} textAnchor="middle" fontSize={11} fill="var(--muted)" className="tnum">{p.label ?? p.x}</text>
          ) : null))}
          {h && hover !== null ? (
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + ih} stroke="var(--baseline)" strokeWidth={1} />
          ) : null}
          {last ? (
            <circle cx={x(points.length - 1)} cy={y(last.y)} r={4} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />
          ) : null}
          {h && hover !== null ? (
            <circle cx={x(hover)} cy={y(h.y)} r={4.5} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />
          ) : null}
          <rect x={PAD.left} y={PAD.top} width={iw} height={ih} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
        </svg>
        {h && hover !== null ? (
          <Tooltip x={x(hover)} y={y(h.y)} width={width}>
            <div className="text-muted">{h.label ?? h.x}</div>
            <div className="font-semibold tnum">{format(h.y)}</div>
          </Tooltip>
        ) : null}
      </div>
      <DataTable points={points} format={format} labels={labels} />
    </div>
  );
}

/** Horizontal diverging bars for signed values (e.g. expectancy in R per group). */
export function DivergingBars({ rows, kind, locale }: { rows: { label: string; value: number; sub?: string }[]; kind: ValueKind; locale: Locale }) {
  const { format } = formatters(kind, locale);
  const max = Math.max(0.0001, ...rows.map((r) => Math.abs(r.value)));
  return (
    <ul className="flex flex-col gap-2.5" dir="ltr">
      {rows.map((r) => {
        const w = (Math.abs(r.value) / max) * 50;
        const pos = r.value >= 0;
        return (
          <li key={r.label} className="grid grid-cols-[minmax(6rem,9rem)_1fr_4.5rem] items-center gap-3 text-xs">
            <span className="truncate text-ink-2" title={r.label}>{r.label}{r.sub ? <span className="ms-1 text-muted">{r.sub}</span> : null}</span>
            <span className="relative h-3.5">
              <span className="absolute inset-y-0 left-1/2 w-px bg-[var(--baseline)]" aria-hidden />
              <span
                className="absolute inset-y-0.5"
                style={{
                  left: pos ? "calc(50% + 1px)" : `calc(${50 - w}% - 1px)`,
                  width: `${w}%`,
                  background: pos ? "var(--series-1)" : "var(--series-neg)",
                  borderRadius: pos ? "0 4px 4px 0" : "4px 0 0 4px",
                }}
              />
            </span>
            <span className="text-end font-medium text-ink tnum">{format(r.value)}</span>
          </li>
        );
      })}
    </ul>
  );
}
