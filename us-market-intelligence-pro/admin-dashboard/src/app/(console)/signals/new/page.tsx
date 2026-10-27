import { ArrowLeft, ArrowRight } from "lucide-react";
import Link from "next/link";
import { Card, CardBody, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/guard";
import { getI18n } from "@/lib/prefs";
import { ManualSignalForm } from "./manual-form";

export const metadata = { title: "New signal" };

export default async function NewSignalPage() {
  await requireRole("analyst");
  const { locale, d } = await getI18n();
  const Back = locale === "ar" ? ArrowRight : ArrowLeft;
  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/signals" className="mb-4 inline-flex items-center gap-1.5 text-xs text-ink-2 hover:text-ink"><Back className="size-3.5" />{d.signals.title}</Link>
      <PageHeader title={d.signals.form.title} subtitle={d.signals.form.subtitle} />
      <Card><CardBody className="py-6"><ManualSignalForm s={d.signals} f={d.signals.form} saved={d.common.saved} /></CardBody></Card>
    </div>
  );
}
