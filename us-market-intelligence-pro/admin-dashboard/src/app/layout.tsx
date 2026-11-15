import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic, Noto_Kufi_Arabic } from "next/font/google";
import { getLocale } from "@/lib/prefs";
import "./globals.css";

const plex = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex",
  display: "swap",
});

// Headings per the Rainr guide: Noto Kufi Arabic, weight 800 (SIL OFL 1.1).
const kufi = Noto_Kufi_Arabic({ subsets: ["arabic", "latin"], weight: ["800"], variable: "--font-kufi", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Rainr · لوحة الإدارة", template: "%s · Rainr" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html
      lang={locale}
      dir={locale === "ar" ? "rtl" : "ltr"}
      className={`${plex.variable} ${kufi.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
