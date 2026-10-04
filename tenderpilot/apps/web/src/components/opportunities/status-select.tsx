"use client";

import { useMutation } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { OPPORTUNITY_STATUSES, opportunityStatusSchema, type OpportunityStatus } from "@tenderpilot/core/domain";
import { Label, NativeSelect } from "@/components/ui/form";
import { useRouter } from "@/i18n/navigation";
import { useTRPC } from "@/trpc/client";

export function StatusSelect({ id, status, canUpdate }: { id: string; status: OpportunityStatus; canUpdate: boolean }) {
  const t = useTranslations("opportunity");
  const tStatus = useTranslations("enums.opportunityStatus");
  const trpc = useTRPC();
  const router = useRouter();
  const [value, setValue] = useState<OpportunityStatus>(status);
  const update = useMutation(
    trpc.opportunities.updateStatus.mutationOptions({
      onSuccess: () => router.refresh(),
      onError: () => setValue(status),
    }),
  );

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="opportunity-status">{t("status")}</Label>
      <div className="flex items-center gap-2">
        <NativeSelect
          id="opportunity-status"
          value={value}
          disabled={!canUpdate || update.isPending}
          onChange={(e) => {
            const next = opportunityStatusSchema.parse(e.target.value);
            setValue(next);
            update.mutate({ id, status: next });
          }}
          className="max-w-56"
        >
          {OPPORTUNITY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {tStatus(s)}
            </option>
          ))}
        </NativeSelect>
        {update.isPending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        {update.isSuccess && !update.isPending && (
          <span role="status" className="flex items-center gap-1 text-xs text-success">
            <Check className="size-3.5" />
            {t("statusSaved")}
          </span>
        )}
        {update.isError && (
          <span role="alert" className="text-xs text-destructive">
            {t("statusError")}
          </span>
        )}
      </div>
    </div>
  );
}
