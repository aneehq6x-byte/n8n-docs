import { Clock } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import type { OpportunityStatus } from "@tenderpilot/core/domain";
import { Badge } from "@/components/ui/misc";
import { daysUntil } from "@/lib/i18n-utils";

const STATUS_VARIANT: Record<OpportunityStatus, "default" | "secondary" | "success" | "warning" | "destructive" | "outline"> = {
  new: "default",
  reviewing: "secondary",
  pursuing: "warning",
  submitted: "outline",
  won: "success",
  lost: "destructive",
  dismissed: "secondary",
};

export function OpportunityStatusBadge({ status }: { status: OpportunityStatus }) {
  const t = useTranslations("enums.opportunityStatus");
  return <Badge variant={STATUS_VARIANT[status]}>{t(status)}</Badge>;
}

/** Deadline date + urgency (≤ 3 days is urgent, ≤ 7 is soon). */
export function DeadlineCell({ deadline, now }: { deadline: Date; now: Date }) {
  const format = useFormatter();
  const t = useTranslations("opportunity");
  const days = daysUntil(deadline, now);
  const passed = deadline <= now;
  const variant = passed ? "secondary" : days <= 3 ? "destructive" : days <= 7 ? "warning" : "outline";
  return (
    <div className="flex flex-col items-start gap-1">
      <span className="text-sm tabular-nums">{format.dateTime(deadline, "short")}</span>
      <Badge variant={variant} className="font-normal">
        <Clock className="size-3" />
        {passed ? t("closed") : t("daysLeft", { days })}
      </Badge>
    </div>
  );
}
