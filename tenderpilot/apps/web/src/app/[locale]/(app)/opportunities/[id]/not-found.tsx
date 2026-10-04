import { SearchX } from "lucide-react";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Link } from "@/i18n/navigation";

export default function OpportunityNotFound() {
  const t = useTranslations();
  return (
    <EmptyState
      icon={SearchX}
      title={t("errors.notFoundTitle")}
      description={t("opportunity.notFound")}
      action={
        <Link href="/opportunities" className={buttonVariants({ variant: "outline", size: "sm" })}>
          {t("opportunity.back")}
        </Link>
      }
    />
  );
}
