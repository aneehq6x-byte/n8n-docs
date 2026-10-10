import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { z } from "zod";
import { confirmCheckout, getCheckoutForOrg, getDb } from "@tenderpilot/db";
import { getPaymentGateway } from "@tenderpilot/payments";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { requireOrgContext } from "@/server/org-context";

export const dynamic = "force-dynamic";

/**
 * Landing page after the hosted payment. Query parameters from the gateway are
 * ignored: we look up *our* checkout (scoped to the caller's org) and verify it
 * with the gateway server-side.
 */
export default async function BillingReturnPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: AppLocale }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("billing.return");
  const { membership } = await requireOrgContext(locale);
  const id = z.uuid().safeParse((await searchParams).checkout);
  const db = getDb();
  const gateway = getPaymentGateway();

  let state: "paid" | "pending" | "failed" | "expired" | "notFound" = "notFound";
  if (id.success && gateway && (await getCheckoutForOrg(db, membership.orgId, id.data))) {
    try {
      state = (await confirmCheckout(db, gateway, { checkoutId: id.data }))?.status ?? "notFound";
    } catch (err) {
      console.error("checkout confirmation failed", err);
      state = "pending";
    }
  }
  const Icon = state === "paid" ? CheckCircle2 : state === "pending" ? Clock : XCircle;
  const tone = state === "paid" ? "text-success" : state === "pending" ? "text-warning" : "text-destructive";

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 py-10">
      <Card>
        <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
          <Icon className={`size-12 ${tone}`} />
          <p role="status" className="text-lg font-medium">
            {t(state)}
          </p>
          {state === "pending" && <meta httpEquiv="refresh" content="5" />}
          <Link href="/billing" className={buttonVariants({ variant: state === "paid" ? "default" : "outline" })}>
            {t("back")}
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
