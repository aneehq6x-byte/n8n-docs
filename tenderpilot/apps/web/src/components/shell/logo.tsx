import { Compass } from "lucide-react";
import { getTranslations } from "next-intl/server";

export async function Logo() {
  const t = await getTranslations("common");
  return (
    <span className="flex items-center gap-2 font-semibold">
      <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
        <Compass className="size-4" />
      </span>
      {t("appName")}
    </span>
  );
}
