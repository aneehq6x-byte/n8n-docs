import { z } from "zod";
import { getServerEnv } from "@tenderpilot/config";
import type { GatewayInvoice, PaymentGateway } from "@tenderpilot/db";

/**
 * Moyasar invoices API (hosted payment page). Amounts are in halalas.
 * Responses are parsed leniently (unknown fields ignored) but every field we
 * rely on is validated — and the caller re-verifies amount/currency/metadata.
 */
const invoiceResponseSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  amount: z.number().int(),
  currency: z.string(),
  url: z.string().url().nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
});

function toGatewayInvoice(body: unknown): GatewayInvoice {
  const inv = invoiceResponseSchema.parse(body);
  const metadata: Record<string, string> = {};
  for (const [k, v] of Object.entries(inv.metadata ?? {})) if (typeof v === "string") metadata[k] = v;
  return { id: inv.id, status: inv.status, amount: inv.amount, currency: inv.currency, url: inv.url ?? null, metadata };
}

export class MoyasarError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface MoyasarOptions {
  secretKey: string;
  apiUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class MoyasarGateway implements PaymentGateway {
  readonly name = "moyasar";
  constructor(private readonly opts: MoyasarOptions) {}

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const doFetch = this.opts.fetchImpl ?? fetch;
    const res = await doFetch(`${this.opts.apiUrl.replace(/\/$/, "")}${path}`, {
      ...init,
      headers: {
        // Moyasar uses HTTP Basic auth with the secret key as username and an empty password.
        authorization: `Basic ${Buffer.from(`${this.opts.secretKey}:`).toString("base64")}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 15_000),
    });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const message = typeof body === "object" && body !== null && "message" in body ? String(body.message) : `HTTP ${res.status}`;
      throw new MoyasarError(res.status, `Moyasar: ${message}`);
    }
    return body;
  }

  async createInvoice(input: Parameters<PaymentGateway["createInvoice"]>[0]): Promise<GatewayInvoice> {
    const body = await this.request("/invoices", {
      method: "POST",
      body: JSON.stringify({
        amount: input.amountHalalas,
        currency: input.currency,
        description: input.description,
        success_url: input.successUrl,
        back_url: input.backUrl,
        callback_url: input.callbackUrl,
        metadata: input.metadata,
      }),
    });
    return toGatewayInvoice(body);
  }

  async fetchInvoice(id: string): Promise<GatewayInvoice> {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new MoyasarError(400, "Moyasar: invalid invoice id");
    return toGatewayInvoice(await this.request(`/invoices/${encodeURIComponent(id)}`));
  }
}

/** The configured gateway, or null when online checkout isn't set up (sales-led only). */
export function getPaymentGateway(): PaymentGateway | null {
  const env = getServerEnv();
  if (!env.MOYASAR_SECRET_KEY) return null;
  return new MoyasarGateway({ secretKey: env.MOYASAR_SECRET_KEY, apiUrl: env.MOYASAR_API_URL });
}
