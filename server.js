import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import Database from "better-sqlite3";
import crypto from "node:crypto";
import dotenv from "dotenv";

dotenv.config();
const app = express();
const PORT = Number(process.env.PORT || 3000);
const SECRET = process.env.PAYSTACK_SECRET_KEY;
const CURRENCY = "NGN";
const DISPLAY_NAME = "Com.soc";
const DASHBOARD_TOKEN = process.env.PAYMENTS_DASHBOARD_TOKEN;
const db = new Database(process.env.DB_FILE || "payments.sqlite");
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS payments (
    reference TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    amount_kobo INTEGER NOT NULL,
    memo TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    paid_at TEXT
  )
`);
const insertPayment = db.prepare(
  "INSERT INTO payments(reference,email,amount_kobo,memo,status) VALUES(?,?,?,?, 'pending')"
);
const getPayment = db.prepare("SELECT * FROM payments WHERE reference = ?");
const markPaid = db.prepare(
  "UPDATE payments SET status='success', paid_at=CURRENT_TIMESTAMP WHERE reference=? AND status!='success'"
);
const deletePending = db.prepare("DELETE FROM payments WHERE reference=? AND status='pending'");

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.static("public"));
app.use("/api/", rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false }));

// Webhook needs the exact raw request bytes for signature validation.
app.post("/api/payments/webhook", express.raw({ type: "application/json" }), (req, res) => {
  if (!SECRET) return res.sendStatus(503);
  const signature = req.get("x-paystack-signature") || "";
  const expected = crypto.createHmac("sha512", SECRET).update(req.body).digest("hex");
  const a = Buffer.from(signature, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.sendStatus(401);

  let event;
  try { event = JSON.parse(req.body.toString("utf8")); } catch { return res.sendStatus(400); }
  if (event.event === "charge.success" && event.data?.reference) {
    const row = getPayment.get(event.data.reference);
    // Never trust a webhook alone: match the expected amount and currency too.
    if (row && Number(event.data.amount) === row.amount_kobo && event.data.currency === CURRENCY) {
      markPaid.run(row.reference);
    }
  }
  return res.sendStatus(200);
});

app.use(express.json({ limit: "20kb" }));

app.post("/api/payments/initialize", async (req, res) => {
  try {
    if (!SECRET) return res.status(503).json({ error: "Server payment credentials are not configured." });
    const email = String(req.body.email || "").trim().toLowerCase();
    const memo = String(req.body.memo || "").trim();
    const amount = Number(req.body.amount);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !memo || memo.length > 120 ||
        !Number.isSafeInteger(amount) || amount < 100 || amount > 5_000_000) {
      return res.status(400).json({ error: "Enter a valid email, description and amount between NGN 100 and NGN 5,000,000." });
    }

    const reference = "NEXUS-" + crypto.randomUUID().replaceAll("-", "");
    const amountKobo = amount * 100;
    insertPayment.run(reference, email, amountKobo, memo);

    const gatewayResponse = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        email, amount: amountKobo, currency: CURRENCY, reference,
        callback_url: `${process.env.APP_BASE_URL}/?payment=return`,
        metadata: {
          display_name: DISPLAY_NAME,
          custom_fields: [
            { display_name: "Business", variable_name: "business_name", value: DISPLAY_NAME },
            { display_name: "Payment description", variable_name: "payment_description", value: memo }
          ]
        }
      })
    });
    const gateway = await gatewayResponse.json();
    if (!gatewayResponse.ok || !gateway.status || !gateway.data?.authorization_url) {
      deletePending.run(reference);
      return res.status(502).json({ error: gateway.message || "Payment provider could not initialize checkout." });
    }
    return res.json({ authorization_url: gateway.data.authorization_url, reference });
  } catch (error) {
    console.error("Payment initialization error:", error.message);
    return res.status(500).json({ error: "Unable to initialize payment." });
  }
});

app.get("/api/payments/verify/:reference", async (req, res) => {
  try {
    if (!SECRET) return res.status(503).json({ error: "Payment credentials are not configured." });
    const reference = String(req.params.reference);
    if (!/^[A-Za-z0-9.=\\-_]{1,100}$/.test(reference)) return res.status(400).json({ error: "Invalid reference." });
    const row = getPayment.get(reference);
    if (!row) return res.status(404).json({ error: "Payment reference not found." });

    const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${SECRET}` }
    });
    const result = await response.json();
    if (!response.ok || !result.status) return res.status(502).json({ error: "Could not verify with payment provider." });

    const payment = result.data;
    const valid = payment.status === "success" &&
      Number(payment.amount) === row.amount_kobo &&
      payment.currency === CURRENCY &&
      payment.reference === row.reference &&
      payment.customer?.email?.toLowerCase() === row.email;
    if (valid) markPaid.run(reference);
    const latest = getPayment.get(reference);
    return res.json({ reference, status: latest.status, amount: latest.amount_kobo / 100, currency: CURRENCY });
  } catch (error) {
    console.error("Payment verification error:", error.message);
    return res.status(500).json({ error: "Unable to verify payment." });
  }
});

// Payment history is private. Configure a long random dashboard token server-side.
// Do not expose this token in public frontend code; use it only from a protected admin tool.
app.get("/api/payments", (req, res) => {
  if (!DASHBOARD_TOKEN) return res.sendStatus(404);
  const supplied = req.get("x-dashboard-token") || "";
  const a = Buffer.from(supplied, "utf8");
  const b = Buffer.from(DASHBOARD_TOKEN, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.sendStatus(401);
  const rows = db.prepare("SELECT reference,email,amount_kobo,memo,status,created_at,paid_at FROM payments ORDER BY created_at DESC LIMIT 100").all();
  res.json(rows.map(p => ({ ...p, amount: p.amount_kobo / 100, currency: CURRENCY })));
});

app.get("/health", (_req, res) => res.json({ ok: true }));
app.listen(PORT, () => console.log(`NexusB2B server listening on port ${PORT}`));
