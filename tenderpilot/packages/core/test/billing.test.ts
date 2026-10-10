import { describe, expect, it } from "vitest";
import { entitlementsFor, extendPeriod, quote, type SubscriptionSnapshot } from "../src";

const NOW = new Date("2026-10-10T12:00:00.000Z");
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
const sub = (over: Partial<SubscriptionSnapshot>): SubscriptionSnapshot => ({
  plan: "trial",
  status: "trialing",
  seats: 3,
  currentPeriodEnd: days(10),
  ...over,
});

describe("quote", () => {
  it("adds 15% VAT in integer halalas", () => {
    expect(quote("starter", "monthly")).toEqual({
      plan: "starter",
      interval: "monthly",
      subtotalHalalas: 99_000,
      vatHalalas: 14_850,
      totalHalalas: 113_850,
    });
  });

  it("charges 10 months for annual billing", () => {
    const q = quote("professional", "annual");
    expect(q.subtotalHalalas).toBe(249_000 * 10);
    expect(Number.isInteger(q.vatHalalas)).toBe(true);
    expect(q.totalHalalas).toBe(q.subtotalHalalas + q.vatHalalas);
  });
});

describe("extendPeriod", () => {
  it("extends from now when the period already ended", () => {
    expect(extendPeriod(days(-30), "monthly", NOW).toISOString()).toBe("2026-11-10T12:00:00.000Z");
  });
  it("stacks on top of remaining paid time", () => {
    expect(extendPeriod(days(5), "annual", NOW).toISOString()).toBe("2027-10-15T12:00:00.000Z");
  });
});

describe("entitlementsFor", () => {
  it("keeps a running trial active and warns in its last 3 days", () => {
    expect(entitlementsFor(sub({}), NOW)).toMatchObject({ active: true, warn: false, daysLeft: 10 });
    expect(entitlementsFor(sub({ currentPeriodEnd: days(2) }), NOW)).toMatchObject({ active: true, warn: true });
  });

  it("deactivates an expired trial", () => {
    expect(entitlementsFor(sub({ currentPeriodEnd: days(-1) }), NOW)).toMatchObject({ active: false, daysLeft: 0 });
  });

  it("gives past-due subscriptions a 7-day grace period", () => {
    expect(entitlementsFor(sub({ status: "past_due", plan: "starter", currentPeriodEnd: days(-3) }), NOW)).toMatchObject({ active: true, warn: true });
    expect(entitlementsFor(sub({ status: "past_due", plan: "starter", currentPeriodEnd: days(-8) }), NOW).active).toBe(false);
  });

  it("never activates a canceled subscription after its period", () => {
    expect(entitlementsFor(sub({ status: "canceled", plan: "starter", currentPeriodEnd: days(-1) }), NOW).active).toBe(false);
  });

  it("exposes plan limits", () => {
    expect(entitlementsFor(sub({ plan: "professional", status: "active", seats: 10 }), NOW)).toMatchObject({ scoutRunsPerDay: 50, seats: 10 });
  });
});
