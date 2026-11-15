import { SearchX } from "lucide-react";
import { LinkButton } from "@/components/ui";
import { getI18n } from "@/lib/prefs";

export default async function NotFound() {
  const { d } = await getI18n();
  return (
    <div className="mx-auto mt-16 max-w-md rounded-2xl border border-line bg-surface p-6 text-center">
      <SearchX className="mx-auto size-8 text-muted" strokeWidth={1.5} />
      <h1 className="mt-3 text-base font-semibold text-ink">{d.common.notFound}</h1>
      <p className="mt-1 text-sm text-ink-2">{d.common.notFoundBody}</p>
      <LinkButton href="/" className="mt-5">{d.common.home}</LinkButton>
    </div>
  );
}
