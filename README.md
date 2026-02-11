# SFR3 Payment System

Serverless payment system for SFR3 rent collection (Stripe, DynamoDB, EventBridge, Firehose). Built with Serverless Framework and TypeScript.

## Prerequisites

- Node.js 20+
- AWS CLI configured
- Stripe account (test mode for dev)
- Optional: Plaid account for ACH

## Setup

```bash
npm install
```

## Environment (for deploy)

Set before `serverless deploy` or in AWS Parameter Store (e.g. `/sfr3/dev/STRIPE_SECRET_KEY`):

- `STRIPE_SECRET_KEY` – Stripe secret key (test for dev)
- `STRIPE_WEBHOOK_SECRET` – From Stripe Dashboard > Webhooks (after creating endpoint)
- `FROM_EMAIL` – Verified SES sender address
- Optional: `PLAID_CLIENT_ID`, `PLAID_SECRET` for ACH

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
4. **Make payment**: POST `/residents/{residentId}/payments` with `{ "amount": 2100, "paymentMethodId": "<methodId from step 1>" }`.
5. **Stripe webhook**: In Stripe Dashboard add webhook endpoint `https://<api>/dev/webhooks/stripe` for `payment_intent.succeeded` and `payment_intent.payment_failed`; use the signing secret as `STRIPE_WEBHOOK_SECRET` (or set in SSM).
6. **Balance**: GET `/residents/{residentId}/balance` – should reflect payment after webhook.
7. **History**: GET `/residents/{residentId}/payments`.
8. **Events**: Check S3 bucket (events lake) for Firehose data; query with Athena using Glue table `sfr3_events_dev.events`.

## Tests

```bash
npm run test
```

Integration test (ledger round-trip) runs only when `DDB_TABLE_LEDGER` is set (e.g. to your deployed Ledger table name).

## Project structure

- `src/functions/` – Lambda handlers
- `src/domain/` – Ledger (event sourcing), payments
- `src/ports/` – Interfaces (payment provider, notification)
- `src/adapters/` – Stripe, Plaid, SES
- `src/lib/` – DynamoDB, EventBridge, Firehose, config
- `src/types/` – Tables, domain events
- `tests/` – Unit and integration tests

## Architecture

See `tmp-prompts/SFR3/architecture.md` in the parent repo for full design (event-sourced ledger, flows, analytics pipeline).
