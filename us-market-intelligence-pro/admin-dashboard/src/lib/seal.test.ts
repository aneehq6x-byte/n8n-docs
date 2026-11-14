import { describe, expect, it } from "vitest";
import { openSession, sealSession } from "./seal";

const SECRET = "test-secret-0123456789abcdef0123456789";
const P = { key: "admin-key-xyz", role: "admin" as const, actor: "admin:admin:-xyz" };

describe("session sealing", () => {
  it("round-trips and hides the key", async () => {
    const t = await sealSession(P, SECRET, 3600);
    expect(t).not.toContain(P.key);
    expect(Buffer.from(t.split(".").join(""), "base64url").toString("latin1")).not.toContain(P.key);
    expect(await openSession(t, SECRET)).toEqual(P);
  });

  it("rejects a different secret, tampering, expiry and garbage", async () => {
    const t = await sealSession(P, SECRET, 3600);
    expect(await openSession(t, "another-secret-0123456789abcdef01234")).toBeNull();
    const parts = t.split(".");
    parts[3] = parts[3]!.slice(0, -2) + (parts[3]!.endsWith("A") ? "BB" : "AA");
    expect(await openSession(parts.join("."), SECRET)).toBeNull();
    const expired = await sealSession(P, SECRET, -10);
    expect(await openSession(expired, SECRET)).toBeNull();
    expect(await openSession("x.y.z", SECRET)).toBeNull();
    expect(await openSession(undefined, SECRET)).toBeNull();
  });

  it("refuses weak secrets", async () => {
    await expect(sealSession(P, "short", 60)).rejects.toThrow(/32/);
  });
});
