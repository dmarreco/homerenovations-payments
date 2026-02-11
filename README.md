# SFR3 Payment System

Serverless payment system for SFR3 rent collection (Stripe, DynamoDB, EventBridge, Firehose). Built with Serverless Framework and TypeScript.

## Prerequisites

- Node.js 20+
- AWS CLI configured
- Stripe account (test mode for dev)
## Setup

```bash
npm install
```

## Environment (for deploy)

Stripe access is centralized in the **stripeService** Lambda. Only that Lambda needs Stripe credentials; other Lambdas call it over **HTTP** (POST to `/internal/stripe` with body `{ action, params }`). Set Stripe secrets in AWS Systems Manager Parameter Store so the stripeService function can read them:

- `/sfr3/<stage>/STRIPE_SECRET_KEY` – Stripe secret key (test for dev)
- `/sfr3/<stage>/STRIPE_WEBHOOK_SECRET` – From Stripe Dashboard > Webhooks (after creating endpoint)

The framework sets `STRIPE_SERVICE_URL` (and optionally `STRIPE_SERVICE_API_KEY`) for all Lambdas so they can call the stripeService over HTTP. No other Lambda needs Stripe keys.

- `FROM_EMAIL` – Verified SES sender address (for all Lambdas that send email)

Optional (env vars with defaults; override per stage as needed):

- `LATE_FEE_GRACE_DAYS` – Days after charge due date before late fee is applied (default: 5)
- `LATE_FEE_AMOUNT_CENTS` – Late fee amount in cents (default: 75)
- `LEDGER_SNAPSHOT_INTERVAL` – Write a ledger snapshot every N events (default: 10)
- `LEDGER_APPEND_MAX_RETRIES` – Optimistic-lock retries for ledger append (default: 5)
- `DEFAULT_PAYMENT_MAX_RETRIES` – Default retry attempts for failed payments (default: 3)
- `PAYMENT_RETRY_BASE_DELAY_SEC` – Base delay in seconds for first retry (default: 300)
- `PAYMENT_RETRY_MAX_DELAY_SEC` – Max delay in seconds for retry backoff (default: 900)
- `RECEIPT_URL_EXPIRES_SEC` – Presigned receipt URL expiry in seconds (default: 300)
- `FIREHOSE_BATCH_SIZE` – Batch size for Firehose putRecords (default: 500)
- `GET_HISTORY_DEFAULT_LIMIT` – Default page size for payment history (default: 50)
- `GET_HISTORY_MAX_LIMIT` – Max page size for payment history (default: 100)
- `LOG_LEVEL` – Logging level: `info` (default) logs only static entry/exit messages; `trace` also logs full event and response payloads. Set to `trace` for debugging; leave `info` in production to avoid PII and noise.

## Observability (Lambda middleware)

All Lambdas use [Middy](https://middy.js.org) for:

- **Correlation ID** – Propagated from request header `X-Correlation-Id` or generated. Stored in context and returned in HTTP response header `X-Correlation-Id` for API routes so you can trace a request across logs.
- **Structured logging** – Entry and exit are logged at INFO with function name and correlation ID. With `LOG_LEVEL=trace`, the full event and response are logged (use only for debugging).
- **HTTP error handling** – For API Gateway handlers, uncaught errors are converted to a consistent JSON error response.

See [architecture.md](./architecture.md) section 10.5 for details.

## Deploy

### Deploy to your AWS account (using `~/.aws/` credentials)

1. **Ensure AWS CLI uses your account**
   ```bash
   aws sts get-caller-identity
   ```
   If you use a named profile (e.g. in `~/.aws/credentials`), set it before deploy:
   ```bash
   export AWS_PROFILE=your-profile-name
   ```

2. **Create Stripe parameters in SSM** (required for stripeService)
   Use Stripe test keys for dev. In [Stripe Dashboard](https://dashboard.stripe.com/test/apikeys) copy the **Secret key** (e.g. `sk_test_...`). Then create the webhook in step 5 below and use its **Signing secret**.
   ```bash
   aws ssm put-parameter --name "/sfr3/dev/STRIPE_SECRET_KEY" --value "sk_test_YOUR_KEY" --type SecureString --overwrite
   aws ssm put-parameter --name "/sfr3/dev/STRIPE_WEBHOOK_SECRET" --value "whsec_YOUR_SECRET" --type SecureString --overwrite
   ```
   Replace `dev` with your stage if you deploy with a different one (e.g. `--stage prod`).

3. **Install dependencies and deploy**
   ```bash
   cd tmp-prompts/SFR3/sfr3-payments   # or your repo path
   npm install
   npm run deploy:dev
   ```
   Or with a specific region/profile:
   ```bash
   AWS_PROFILE=myprofile npx serverless deploy --stage dev --region us-east-1
   ```

4. **Note on email (optional)**  
   Notifications use SES. In SES sandbox you must verify the sender email. Set it via SSM so Lambdas get it:
   ```bash
   aws ssm put-parameter --name "/sfr3/dev/FROM_EMAIL" --value "noreply@yourdomain.com" --type String --overwrite
   ```
   Then add `FROM_EMAIL: ${ssm:/sfr3/${self:provider.stage}/FROM_EMAIL~true}` to `provider.environment` in `serverless.yml` if you want it from SSM, or set the env var in your shell before deploy. (The app already reads `process.env.FROM_EMAIL` with default `noreply@example.com`.)

5. **After first deploy: Stripe webhook**  
   Deploy outputs `ApiEndpoint`. Add a webhook in Stripe Dashboard → Developers → Webhooks: URL `https://<ApiEndpoint>/dev/webhooks/stripe`, events `payment_intent.succeeded`, `payment_intent.payment_failed`. Copy the **Signing secret** and update SSM:
   ```bash
   aws ssm put-parameter --name "/sfr3/dev/STRIPE_WEBHOOK_SECRET" --value "whsec_..." --type SecureString --overwrite
   ```
   Redeploy so the stripeService Lambda picks up the new secret (or leave as placeholder until you have the real secret).

---

**Quick deploy (no SSM yet)**  
You can run `npm run deploy:dev` before creating SSM parameters. The stack will deploy, but the stripeService Lambda will fail on first Stripe call until `/sfr3/dev/STRIPE_SECRET_KEY` (and optionally `STRIPE_WEBHOOK_SECRET`) exist. Create them and redeploy, or create them first then deploy.

Deploy creates: API Gateway, Lambdas, DynamoDB (Ledger, Payments, Payment Methods), EventBridge bus, Firehose, S3 buckets, Cognito pools, Glue DB/table.

## End-to-end verification (Stripe test mode)

1. Get the API base URL from deploy output: `ApiEndpoint`.
2. **Enroll payment method** (card): use Stripe test token `pm_card_visa` or Stripe Elements on frontend; POST `/residents/{residentId}/payment-methods` with `{ "type": "card", "paymentMethodId": "pm_xxx" }`.
3. **Post a charge**: POST `/residents/{residentId}/charges` with `{ "amount": 2100, "chargeType": "RENT", "description": "Rent" }`.
4. **Make payment**: POST `/residents/{residentId}/payments` with `{ "amount": 2100, "paymentMethodId": "<methodId from step 1>" }`. Residents can make **partial payments**: send any `amount` (cents) up to the current balance; multiple payments toward the same balance are supported. The API returns 400 with `{ "error": "Amount exceeds current balance", "balance": <cents> }` when amount exceeds balance, or `{ "error": "No balance due" }` when balance is zero or negative. The 202 response includes `currentBalance` and `balanceAfterPayment` for display.
5. **Stripe webhook**: In Stripe Dashboard add webhook endpoint `https://<api>/dev/webhooks/stripe` for `payment_intent.succeeded` and `payment_intent.payment_failed`; store the signing secret in SSM at `/sfr3/<stage>/STRIPE_WEBHOOK_SECRET` (used by stripeService).
6. **Balance**: GET `/residents/{residentId}/balance` – should reflect payment after webhook.
7. **History**: GET `/residents/{residentId}/payments`.
8. **Refund a payment**: POST `/residents/{residentId}/payments/{paymentId}/refund` (no body for full refund; optional `{ "amount": <cents> }` for partial refund). Payment must be SETTLED.
9. **Events**: Check S3 bucket (events lake) for Firehose data; query with Athena using Glue table `sfr3_events_dev.events`.

## Tests

```bash
npm run test
```

Integration test (ledger round-trip) runs only when `DDB_TABLE_LEDGER` is set (e.g. to your deployed Ledger table name).

## Project structure

- `src/functions/` – Lambda handlers
- `src/domain/` – Ledger (event sourcing), payments
- `src/ports/` – Interfaces (payment provider, notification)
- `src/adapters/` – Stripe (adapter + stripeServiceClient), SES
- `src/lib/` – DynamoDB, EventBridge, Firehose, config, Middy middlewares
- `src/types/` – Tables, domain events
- `tests/` – Unit and integration tests

## Architecture

See [`architecture.md`](./architecture.md) for full design (event-sourced ledger, flows, analytics pipeline).

## Product Backlog

See [`product-backlog.md`](./product-backlog.md) for the product roadmap and feature backlog.
