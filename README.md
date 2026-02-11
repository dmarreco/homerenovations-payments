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
## Deploy

```bash
npm run deploy:dev
# or
npx serverless deploy --stage dev
```

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
- `src/lib/` – DynamoDB, EventBridge, Firehose, config
- `src/types/` – Tables, domain events
- `tests/` – Unit and integration tests

## Architecture

See [`architecture.md`](./architecture.md) for full design (event-sourced ledger, flows, analytics pipeline).

## Product Backlog

See [`product-backlog.md`](./product-backlog.md) for the product roadmap and feature backlog.
