# NexusB2B — Com.soc Paystack integration (test-mode starter)

## Configuration
- Customer-facing business label in the app: **Com.soc**.
- Currency: **NGN**.
- One receiving merchant account: the eligible account holder's approved Paystack account.
- Payment method: Paystack-hosted checkout; card/payment credentials are not collected by this app.

**Important:** The bank account number is deliberately not stored in this project, HTML, JavaScript, or environment file. The account holder must add and verify the settlement bank account privately in the Paystack dashboard. The name displayed on Paystack checkout/receipts is controlled by the approved Paystack merchant profile and may need provider approval; changing the app label to Com.soc does not itself change Paystack's legal merchant name.

## What this version does
- Adds a **Receive Payment** flow branded **Pay Com.soc**.
- Initializes each checkout on the server and redirects the customer to Paystack-hosted checkout.
- Verifies payment status, reference, exact amount, currency, and customer email on the server before marking a payment successful.
- Accepts signed Paystack webhooks and checks the expected amount and currency.
- Stores payment records in SQLite.
- Protects the payment-history endpoint with an optional server-side dashboard token; it is not publicly readable by default.
- Clearly labels the original company balances and transaction ledger as demo data. They are not bank balances or proof of funds.

## Run locally in test mode
1. Install Node.js 20 or newer.
2. Open this project folder in a terminal and run `npm install`.
3. Copy `.env.example` to `.env`.
4. The authorized adult account holder should obtain a **Paystack TEST secret key** from the Paystack dashboard and place it in `.env` as `PAYSTACK_SECRET_KEY`. Never put a secret key in `public/index.html`, a browser app, or a public repository.
5. Keep `APP_BASE_URL=http://localhost:3000` for local testing.
6. Run `npm start` and open `http://localhost:3000`.
7. Use Paystack's test environment and test payment details only. Do not use a real card or real bank transfer for this local test.

## Webhook setup
For a deployed HTTPS test environment, configure the Paystack webhook URL as:
`https://YOUR-TEST-DOMAIN/api/payments/webhook`

The webhook handler validates `x-paystack-signature` against the raw request body using the configured API secret and matches the transaction reference, amount, and currency against the local pending payment. Keep credentials private.

## Private payment-history endpoint
The `/api/payments` endpoint returns customer email and payment information, so it is disabled unless `PAYMENTS_DASHBOARD_TOKEN` is configured. If configured, requests must include the `x-dashboard-token` header. Keep that token out of the public frontend and never share it in chat. A proper authenticated admin dashboard is still needed before production.

## Before live payments
- The 19-year-old account holder must personally agree to manage the merchant account and complete Paystack's current identity, business, and bank verification requirements. Do not use another person's account without authorization or bypass verification.
- Confirm with Paystack that the Com.soc business activity and the intended use are permitted.
- Add the verified settlement account privately in the approved Paystack dashboard. Do not place the account number in app code.
- Confirm the merchant display/statement name with Paystack; the app's Com.soc label is not proof that the provider profile has been approved under that name.
- Deploy behind HTTPS; use a production database with backups, authentication and role-based access, audit logs, monitoring, privacy/terms/refund policies, and a security review.
- Test webhook delivery, duplicate events, failed payments, pending payments, and refunds before launch.
- Do not use the demo USD treasury figures, demo company directory, or demo transaction actions as real payment records. Never treat a browser redirect alone as proof of payment.

## Limitations
This is an integration starter, not an audited or deployed financial platform. It collects payments for one merchant account in NGN. It does not provide escrow, custody, payouts, multi-merchant split settlement, refunds, chargeback handling, or regulatory authorization. It does not yet include a full merchant login/admin dashboard.
