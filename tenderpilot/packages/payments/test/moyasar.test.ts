import { describe, expect, it } from "vitest";
import { MoyasarError, MoyasarGateway } from "../src";

const invoice = {
  id: "inv_123",
  status: "initiated",
  amount: 113_850,
  currency: "SAR",
  url: "https://checkout.moyasar.com/invoices/inv_123",
  metadata: { checkout_id: "c1", nested: { ignored: true } },
  extra_field: "ignored",
};

function gateway(handler: (url: string, init: RequestInit | undefined) => Response) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  };
  return { gw: new MoyasarGateway({ secretKey: "sk_test_abc", apiUrl: "https://api.moyasar.com/v1/", fetchImpl }), calls };
}

describe("MoyasarGateway", () => {
  it("creates an invoice with Basic auth and snake_case fields", async () => {
    const { gw, calls } = gateway(() => Response.json(invoice, { status: 201 }));
    const res = await gw.createInvoice({
      amountHalalas: 113_850,
      currency: "SAR",
      description: "TenderPilot Starter (monthly)",
      successUrl: "https://app/s",
      backUrl: "https://app/b",
      callbackUrl: "https://app/c",
      metadata: { checkout_id: "c1" },
    });
    expect(calls[0]?.url).toBe("https://api.moyasar.com/v1/invoices");
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get("authorization")).toBe(`Basic ${Buffer.from("sk_test_abc:").toString("base64")}`);
    const sent = JSON.parse(String(calls[0]?.init?.body));
    expect(sent).toMatchObject({ amount: 113_850, currency: "SAR", success_url: "https://app/s", callback_url: "https://app/c" });
    expect(res).toEqual({ id: "inv_123", status: "initiated", amount: 113_850, currency: "SAR", url: invoice.url, metadata: { checkout_id: "c1" } });
  });

  it("surfaces API errors with their status", async () => {
    const { gw } = gateway(() => Response.json({ type: "invalid_request_error", message: "Amount is invalid" }, { status: 400 }));
    const err = await gw.fetchInvoice("inv_1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MoyasarError);
    expect((err as MoyasarError).status).toBe(400);
    expect((err as MoyasarError).message).toMatch(/Amount is invalid/);
  });

  it("refuses path-injection in invoice ids", async () => {
    const { gw, calls } = gateway(() => Response.json(invoice));
    await expect(gw.fetchInvoice("../payments")).rejects.toThrow(/invalid invoice id/);
    expect(calls).toHaveLength(0);
  });

  it("rejects malformed responses instead of guessing", async () => {
    const { gw } = gateway(() => Response.json({ id: "x", status: "paid", amount: "1000" }));
    await expect(gw.fetchInvoice("x")).rejects.toThrow();
  });
});
