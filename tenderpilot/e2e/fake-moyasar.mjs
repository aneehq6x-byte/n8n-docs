/**
 * Minimal stand-in for the Moyasar invoices API, for end-to-end tests only.
 * Run: PORT=3200 node fake-moyasar.mjs  — then point the app at it with
 *      MOYASAR_API_URL=http://localhost:3200/v1 MOYASAR_SECRET_KEY=sk_test_fake
 *
 * Implements: POST /v1/invoices, GET /v1/invoices/:id (Basic auth required),
 * GET /pay/:id (hosted page), POST /pay/:id (pay → callback → redirect to success_url).
 */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.PORT ?? 3200);
const KEY = process.env.FAKE_MOYASAR_KEY ?? "sk_test_fake";
const invoices = new Map();

const authorized = (req) => req.headers.authorization === `Basic ${Buffer.from(`${KEY}:`).toString("base64")}`;
const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const readBody = (req) =>
  new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === "/favicon.ico") {
    res.writeHead(204);
    return res.end();
  }
  const payMatch = url.pathname.match(/^\/pay\/([\w-]+)$/);
  const invMatch = url.pathname.match(/^\/v1\/invoices\/([\w-]+)$/);

  if (req.method === "POST" && url.pathname === "/v1/invoices") {
    if (!authorized(req)) return json(res, 401, { type: "authentication_error", message: "Invalid authorization credentials" });
    const body = JSON.parse((await readBody(req)) || "{}");
    if (!Number.isInteger(body.amount) || body.amount < 100) return json(res, 400, { type: "invalid_request_error", message: "Amount is invalid" });
    const id = `inv_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    const inv = {
      id,
      status: "initiated",
      amount: body.amount,
      currency: body.currency,
      description: body.description,
      url: `http://localhost:${PORT}/pay/${id}`,
      metadata: body.metadata ?? {},
      success_url: body.success_url,
      back_url: body.back_url,
      callback_url: body.callback_url,
    };
    invoices.set(id, inv);
    return json(res, 201, inv);
  }

  if (req.method === "GET" && invMatch) {
    if (!authorized(req)) return json(res, 401, { type: "authentication_error", message: "Invalid authorization credentials" });
    const inv = invoices.get(invMatch[1]);
    return inv ? json(res, 200, inv) : json(res, 404, { type: "not_found", message: "Object not found" });
  }

  if (payMatch) {
    const inv = invoices.get(payMatch[1]);
    if (!inv) return json(res, 404, { message: "Object not found" });
    if (req.method === "GET") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(`<!doctype html><title>Fake Moyasar</title><h1>Pay ${(inv.amount / 100).toFixed(2)} ${inv.currency}</h1>
<p>${inv.description}</p><form method="post"><button name="outcome" value="paid">Pay now</button>
<button name="outcome" value="failed">Decline</button></form>`);
    }
    const outcome = new URLSearchParams(await readBody(req)).get("outcome") === "failed" ? "failed" : "paid";
    inv.status = outcome;
    if (inv.callback_url) {
      fetch(inv.callback_url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(inv) }).catch(() => undefined);
    }
    res.writeHead(302, { location: `${inv.success_url}${inv.success_url.includes("?") ? "&" : "?"}id=${inv.id}&status=${outcome}` });
    return res.end();
  }

  json(res, 404, { message: "not found" });
}).listen(PORT, () => console.log(`fake moyasar on :${PORT}`));
