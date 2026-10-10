import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../src/client";
import { syncReferenceData } from "../src/reference-data";
import { auditLog, orgs, subscriptions, users } from "../src/schema";
import {
  confirmCheckout,
  getOrgEntitlements,
  listActiveOrgIds,
  startCheckout,
  type GatewayInvoice,
  type PaymentGateway,
} from "../src/services/billing";
import { createOrgWithOwner, createUser } from "../src/services/identity";

const url = process.env.DATABASE_URL;

/** In-memory gateway: tests decide what the "provider" reports. */
class FakeGateway implements PaymentGateway {
  readonly name = "fake";
  invoices = new Map<string, GatewayInvoice>();
  private seq = 0;
  async createInvoice(input: Parameters<PaymentGateway["createInvoice"]>[0]): Promise<GatewayInvoice> {
    const id = `inv_${++this.seq}_${crypto.randomUUID().slice(0, 6)}`;
    const inv = { id, status: "initiated", amount: input.amountHalalas, currency: "SAR", url: `https://pay.test/${id}`, metadata: input.metadata };
    this.invoices.set(id, inv);
    return inv;
  }
  async fetchInvoice(id: string): Promise<GatewayInvoice> {
    const inv = this.invoices.get(id);
    if (!inv) throw new Error("not found");
    return inv;
  }
  set(id: string, patch: Partial<GatewayInvoice>) {
    const inv = this.invoices.get(id);
    if (inv) this.invoices.set(id, { ...inv, ...patch });
  }
}

describe.skipIf(!url)("billing (Postgres)", () => {
  let handle: DbHandle;
  const orgIds: string[] = [];
  let userId = "";

  async function newOrg() {
    const o = await handle.db.transaction((tx) =>
      createOrgWithOwner(tx, userId, { nameAr: "منشأة", nameEn: "Org", sectors: ["construction"], maxContractValue: 1_000_000 }),
    );
    orgIds.push(o.id);
    return o.id;
  }

  async function checkout(gw: FakeGateway, orgId: string) {
    const res = await startCheckout(handle.db, gw, {
      orgId,
      plan: "starter",
      interval: "monthly",
      actorUserId: userId,
      description: "TenderPilot Starter",
      urls: (id) => ({ successUrl: `https://app/s/${id}`, backUrl: "https://app/b", callbackUrl: "https://app/c" }),
    });
    const invoiceId = [...gw.invoices.values()].find((i) => i.metadata.checkout_id === res.checkoutId)?.id ?? "";
    return { ...res, invoiceId };
  }

  beforeAll(async () => {
    handle = createDb(url ?? "", { max: 2 });
    await syncReferenceData(handle.db);
    userId = (await createUser(handle.db, { name: "Billing", email: `billing-${crypto.randomUUID()}@x.test`, password: "Passw0rd!x", locale: "ar" })).id;
  });

  afterAll(async () => {
    for (const id of orgIds) await handle.db.delete(orgs).where(eq(orgs.id, id));
    await handle.db.delete(users).where(eq(users.id, userId));
    await handle.close();
  });

  it("charges the VAT-inclusive quote and activates exactly once on payment", async () => {
    const gw = new FakeGateway();
    const orgId = await newOrg();
    const c = await checkout(gw, orgId);
    expect(gw.invoices.get(c.invoiceId)?.amount).toBe(113_850);

    expect(await confirmCheckout(handle.db, gw, { checkoutId: c.checkoutId })).toMatchObject({ status: "pending", activated: false });

    gw.set(c.invoiceId, { status: "paid" });
    // redirect and webhook race each other — only one may activate
    const results = await Promise.all([
      confirmCheckout(handle.db, gw, { checkoutId: c.checkoutId }),
      confirmCheckout(handle.db, gw, { providerInvoiceId: c.invoiceId }),
    ]);
    expect(results.filter((r) => r?.activated)).toHaveLength(1);

    const ent = await getOrgEntitlements(handle.db, orgId);
    expect(ent).toMatchObject({ plan: "starter", status: "active", active: true, seats: 3 });
    expect(ent.daysLeft).toBeGreaterThanOrEqual(28);
    const succeeded = await handle.db.select().from(auditLog).where(eq(auditLog.orgId, orgId));
    expect(succeeded.filter((a) => a.action === "billing.payment_succeeded")).toHaveLength(1);
  });

  it("refuses to activate when the provider reports a different amount", async () => {
    const gw = new FakeGateway();
    const orgId = await newOrg();
    const c = await checkout(gw, orgId);
    gw.set(c.invoiceId, { status: "paid", amount: 100 }); // someone paid 1 SAR
    expect(await confirmCheckout(handle.db, gw, { checkoutId: c.checkoutId })).toMatchObject({ activated: false, reason: "mismatch:amount" });
    expect((await getOrgEntitlements(handle.db, orgId)).plan).toBe("trial");
  });

  it("refuses an invoice whose metadata points at another checkout", async () => {
    const gw = new FakeGateway();
    const orgId = await newOrg();
    const c = await checkout(gw, orgId);
    gw.set(c.invoiceId, { status: "paid", metadata: { checkout_id: "someone-else" } });
    expect(await confirmCheckout(handle.db, gw, { checkoutId: c.checkoutId })).toMatchObject({ activated: false, reason: "mismatch:metadata" });
  });

  it("marks failed and expired invoices without activating", async () => {
    const gw = new FakeGateway();
    const orgId = await newOrg();
    const a = await checkout(gw, orgId);
    gw.set(a.invoiceId, { status: "failed" });
    expect(await confirmCheckout(handle.db, gw, { checkoutId: a.checkoutId })).toMatchObject({ status: "failed", activated: false });
    const b = await checkout(gw, orgId);
    gw.set(b.invoiceId, { status: "expired" });
    expect(await confirmCheckout(handle.db, gw, { checkoutId: b.checkoutId })).toMatchObject({ status: "expired", activated: false });
  });

  it("returns null for unknown checkouts (webhook probing)", async () => {
    expect(await confirmCheckout(handle.db, new FakeGateway(), { providerInvoiceId: "inv_nope" })).toBeNull();
  });

  it("excludes expired trials from scheduled sweeps", async () => {
    const live = await newOrg();
    const expired = await newOrg();
    await handle.db.update(subscriptions).set({ currentPeriodEnd: new Date(Date.now() - 86_400_000) }).where(eq(subscriptions.orgId, expired));
    const active = await listActiveOrgIds(handle.db);
    expect(active).toContain(live);
    expect(active).not.toContain(expired);
    expect((await getOrgEntitlements(handle.db, expired)).active).toBe(false);
  });
});
