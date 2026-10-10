"use client";

import { Building2, CreditCard, FileUp, LayoutDashboard, ListChecks, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/dashboard", key: "dashboard", icon: LayoutDashboard },
  { href: "/opportunities", key: "opportunities", icon: ListChecks },
  { href: "/import", key: "import", icon: FileUp },
  { href: "/profile", key: "profile", icon: Building2 },
  { href: "/team", key: "team", icon: Users },
  { href: "/billing", key: "billing", icon: CreditCard },
] as const;

export function NavLinks({ orientation = "vertical" }: { orientation?: "vertical" | "horizontal" }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  return (
    <nav className={cn("flex gap-1", orientation === "vertical" ? "flex-col" : "flex-row overflow-x-auto")}>
      {ITEMS.map(({ href, key, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}
