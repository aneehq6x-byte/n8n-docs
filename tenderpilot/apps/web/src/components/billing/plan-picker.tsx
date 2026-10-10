"use client";

import { useMutation } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { Check, Loader2 } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import type { BillingInterval, PlanId, PriceQuote, PurchasablePlan } from "@tenderpilot/core/billing";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldError } from "@/components/ui/form";
import { Badge } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";

export interface PlanOption {
  id: PurchasablePlan;
  seats: number;
  scoutRunsPerDay: number;
  monthly: PriceQuote;
  annual: PriceQuote;
}

const ERROR_KEYS = ["CHECKOUT_DISABLED", "GATEWAY_ERROR"] as const;

export function PlanPicker({
  plans,
  currentPlan,
  currentActive,
  canManage,
  checkoutEnabled,
}: {
  plans: PlanOption[];
  currentPlan: PlanId;
  currentActive: boolean;
  canManage: boolean;
  checkoutEnabled: boolean;
}) {
  const t = useTranslations("billing");
  const format = useFormatter();
  const locale = useLocale();
  const trpc = useTRPC();
  const [interval, setInterval] = useState<BillingInterval>("monthly");
  const [redirecting, setRedirecting] = useState(false);
  const checkout = useMutation(
    trpc.billing.checkout.mutationOptions({
      onSuccess: ({ paymentUrl }) => {
        setRedirecting(true);
        // Full navigation to the gateway's hosted, PCI-compliant payment page.
        window.location.assign(paymentUrl);
      },
    }),
  );
  const sar = (halalas: number) => format.number(halalas / 100, "sarExact");
  const errorKey = checkout.error instanceof TRPCClientError ? ERROR_KEYS.find((k) => k === checkout.error?.message) : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div role="radiogroup" aria-label={t("title")} className="inline-flex w-fit rounded-lg border bg-card p-1 text-sm">
        {(["monthly", "annual"] as const).map((i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={interval === i}
            onClick={() => setInterval(i)}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-1.5 font-medium transition-colors",
              interval === i ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(i)}
            {i === "annual" && <span className={cn("text-xs", interval === i ? "opacity-90" : "text-success")}>{t("annualSave")}</span>}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {plans.map((p) => {
          const q = interval === "annual" ? p.annual : p.monthly;
          const isCurrent = currentActive && currentPlan === p.id;
          return (
            <Card key={p.id} className={cn(p.id === "professional" && "border-primary/50")}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-lg">{t(`plans.${p.id}`)}</CardTitle>
                  {isCurrent && <Badge>{t("currentBadge")}</Badge>}
                </div>
                <CardDescription>{t(`planBlurb.${p.id}`)}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                  <span className="flex items-baseline gap-1.5">
                    <span className="text-3xl font-semibold">{sar(q.subtotalHalalas)}</span>
                    <span className="text-sm text-muted-foreground">{interval === "annual" ? t("perYear") : t("perMonth")}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{t("vatLine", { vat: sar(q.vatHalalas), total: sar(q.totalHalalas) })}</span>
                </div>
                <ul className="flex flex-col gap-2 text-sm">
                  <li className="flex items-center gap-2">
                    <Check className="size-4 text-success" />
                    {t("seatsLimit", { seats: p.seats })}
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="size-4 text-success" />
                    {t("runsLimit", { runs: p.scoutRunsPerDay })}
                  </li>
                </ul>
                {canManage && checkoutEnabled && (
                  <Button
                    variant={p.id === "professional" ? "default" : "outline"}
                    disabled={checkout.isPending || redirecting}
                    onClick={() => checkout.mutate({ plan: p.id, interval, locale: locale === "en" ? "en" : "ar" })}
                  >
                    {(checkout.isPending || redirecting) && checkout.variables?.plan === p.id && <Loader2 className="animate-spin" />}
                    {redirecting && checkout.variables?.plan === p.id ? t("redirecting") : t("choose", { plan: t(`plans.${p.id}`) })}
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
      <FieldError message={checkout.isError ? t(`errors.${errorKey ?? "generic"}`) : undefined} />
    </div>
  );
}
