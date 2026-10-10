import { z } from "zod";
import { confirmCheckout, getDb } from "@tenderpilot/db";
import { rateLimit } from "@tenderpilot/jobs";
import { getPaymentGateway } from "@tenderpilot/payments";
import { clientIpFrom } from "@/server/security";

/**
 * Moyasar status callback. The body is treated as a *hint* only: we extract an
 * invoice id and re-fetch that invoice from Moyasar with our secret key before
 * changing anything, so a forged callback can't activate a subscription.
 */
const nestedHint = z.object({ data: z.object({ invoice_id: z.string() }) });
const invoiceHint = z.object({ invoice_id: z.string() });
const idHint = z.object({ id: z.string() });

/** Accepts the invoice object itself or an event wrapper; most specific shape wins. */
function invoiceIdFrom(body: unknown): string | null {
  const nested = nestedHint.safeParse(body);
  const direct = invoiceHint.safeParse(body);
  const plain = idHint.safeParse(body);
  const id = nested.success ? nested.data.data.invoice_id : direct.success ? direct.data.invoice_id : plain.success ? plain.data.id : null;
  return id && /^[A-Za-z0-9_-]{1,100}$/.test(id) ? id : null;
}

export async function POST(req: Request) {
  const gateway = getPaymentGateway();
  if (!gateway) return Response.json({ ok: false }, { status: 404 });
  const ip = clientIpFrom(req.headers.get("x-forwarded-for"));
  if (!(await rateLimit(`billing:callback:${ip}`, 60, 60)).allowed) return Response.json({ ok: false }, { status: 429 });

  const body: unknown = await req.json().catch(() => null);
  const invoiceId = invoiceIdFrom(body);
  if (!invoiceId) return Response.json({ ok: false }, { status: 400 });

  try {
    const outcome = await confirmCheckout(getDb(), gateway, { providerInvoiceId: invoiceId });
    if (!outcome) return Response.json({ ok: false }, { status: 404 });
    return Response.json({ ok: true, status: outcome.status });
  } catch (err) {
    console.error("billing callback failed", err);
    // 5xx so the gateway retries later.
    return Response.json({ ok: false }, { status: 502 });
  }
}
