"use client";

import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { NativeSelect } from "@/components/ui/form";
import { useRouter } from "@/i18n/navigation";
import { setActiveOrgAction } from "./org-actions";

export function OrgSwitcher({ orgs, activeOrgId }: { orgs: { id: string; name: string }[]; activeOrgId: string }) {
  const t = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <NativeSelect
      aria-label={t("organization")}
      value={activeOrgId}
      disabled={pending}
      className="h-8 text-xs"
      onChange={(e) => {
        const orgId = e.target.value;
        startTransition(async () => {
          if (await setActiveOrgAction(orgId)) {
            router.replace("/dashboard");
            router.refresh();
          }
        });
      }}
    >
      {orgs.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </NativeSelect>
  );
}
