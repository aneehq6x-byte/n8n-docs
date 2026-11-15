import "server-only";
import { cookies } from "next/headers";
import { DICTS, isLocale, LOCALE_COOKIE, type Dict, type Locale } from "./i18n";

export async function getLocale(): Promise<Locale> {
  const v = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(v) ? v : "ar";
}


export async function getI18n(): Promise<{ locale: Locale; d: Dict }> {
  const locale = await getLocale();
  return { locale, d: DICTS[locale] };
}
