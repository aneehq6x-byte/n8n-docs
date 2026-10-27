import type { Dict } from "@/lib/i18n";
import type { PaymentRow, ResultKind, SignalStatus } from "@/lib/types";
import { Badge, type Tone } from "./ui";

const SIGNAL_TONE: Record<SignalStatus, Tone> = {
  candidate: "neutral", validated: "warning", approved: "accent", published: "accent", active: "accent",
  target1_hit: "good", target2_hit: "good", stopped: "critical", expired: "neutral", cancelled: "neutral",
  rejected: "serious",
};

export function SignalStatusBadge({ status, d }: { status: SignalStatus; d: Dict }) {
  return <Badge tone={SIGNAL_TONE[status]}>{d.signals.status[status]}</Badge>;
}

export function KindBadge({ kind, d }: { kind: ResultKind; d: Dict }) {
  return <Badge tone={kind === "published" ? "accent" : "neutral"} dot={false}>{d.signals.kinds[kind]}</Badge>;
}

const PAY_TONE: Record<PaymentRow["status"], Tone> = { pending: "neutral", paid: "good", refunded: "serious", failed: "critical" };

export function PaymentStatusBadge({ status, d }: { status: PaymentRow["status"]; d: Dict }) {
  return <Badge tone={PAY_TONE[status]}>{d.payments.statuses[status]}</Badge>;
}

export function DirectionTag({ direction, option, d }: { direction: "long" | "short"; option?: boolean; d: Dict }) {
  const label = option ? (direction === "long" ? d.signals.call : d.signals.put) : direction === "long" ? d.signals.long : d.signals.short;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-ink">
      <span aria-hidden className={direction === "long" ? "text-good-text" : "text-critical-text"}>{direction === "long" ? "▲" : "▼"}</span>
      {label}
    </span>
  );
}
