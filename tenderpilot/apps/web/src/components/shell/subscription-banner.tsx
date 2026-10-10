import { AlertTriangle, Clock } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Entitlements } from "@tenderpilot/core/billing";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/** Trial ending / past-due / inactive notice. Renders nothing for healthy subscriptions. */
export function SubscriptionBanner({ entitlements: e }: { entitlements: Entitlements }) {
  const t = useTranslations("billing.banner");
  if (e.active && !e.warn) return null;
  const message = !e.active ? t("inactive") : e.status === "past_due" ? t("pastDue") : t("trialEnding", { days: e.daysLeft });
  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-sm md:px-6",
        e.active ? "bg-warning/15" : "bg-destructive/10 text-destructive",
      )}
    >
      {e.active ? <Clock className="size-4 shrink-0" /> : <AlertTriangle className="size-4 shrink-0" />}
      <span className="flex-1">{message}</span>
      <Link href="/billing" className="font-medium underline underline-offset-4">
        {t("cta")}
      </Link>
    </div>
  );
}
