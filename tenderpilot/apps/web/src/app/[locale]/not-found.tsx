import { FileQuestion } from "lucide-react";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

export default function NotFound() {
  const t = useTranslations("errors");
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <FileQuestion className="size-10 text-muted-foreground" />
        <h1 className="text-xl font-semibold">{t("notFoundTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("notFoundDescription")}</p>
        <Link href="/dashboard" className={buttonVariants()}>
          {t("goHome")}
        </Link>
      </div>
    </main>
  );
}
