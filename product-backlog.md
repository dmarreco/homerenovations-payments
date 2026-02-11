# SFR3 Payment System -- Product Backlog

> SFR3 manages 10,500+ single-family rental homes across 20 states, collecting over $150M annually in rent. This backlog captures the core capabilities needed for a production-ready resident payment system.

---

## Personas

| Persona | Description |
|---|---|
| **Resident** | A tenant living in an SFR3 home who needs to make payments |
| **Property Manager** | SFR3 staff responsible for managing properties and resident accounts |
| **Finance Analyst** | SFR3 staff responsible for reconciliation, reporting, and financial oversight |

---

## User Stories

### 1. Enroll a Payment Method

**As a** resident,
**I want to** link a payment method (bank account, credit/debit card, or digital wallet) to my account,
**so that** I can use it to make payments toward my lease obligations.

**Acceptance Criteria:**
- Resident can add an ACH bank account via Stripe ACH Direct Debit.
- Resident can add a credit or debit card.
- Payment method details are tokenized and never stored in plaintext.
- Resident can remove or replace a previously linked payment method.

---

### 2. Make a One-Time Payment

**As a** resident,
**I want to** make a one-time payment for a specific charge on my account (e.g., security deposit, first month's rent),
**so that** I can fulfill my financial obligations on my own schedule.

**Acceptance Criteria:**
- Resident can select an outstanding charge and pay it using any enrolled payment method.
- A payment confirmation with a reference number is displayed immediately after submission.
- The transaction is recorded in the resident's payment history.
- The charge balance is updated to reflect the payment once it settles.

---

### 3. Set Up Autopay for Recurring Rent

**As a** resident,
**I want to** enroll in automatic monthly rent payments,
**so that** I never miss a rent due date.

**Acceptance Criteria:**
- Resident can choose a payment method and a preferred charge date for autopay.
- The system automatically initiates payment on the scheduled date each month.
- Resident receives a notification (email) at least 3 days before each scheduled charge.
- Resident can cancel or modify their autopay enrollment at any time before the next charge date.

---

### 4. Post Charges to a Resident Ledger

**As a** property manager,
**I want to** post charges (rent, late fees, utilities, move-in deposits) to a resident's ledger,
**so that** the resident has a clear, itemized record of what they owe.

**Acceptance Criteria:**
- Property manager can create one-time or recurring charges on a resident's account.
- Each charge includes a type, amount, description, and due date.
- Charges appear on the resident's ledger and are visible in the resident portal.
- Recurring charges are automatically posted on their scheduled cadence.

---

### 5. Apply Late Fees Automatically

**As a** property manager,
**I want** late fees to be automatically assessed when rent is not paid by the grace period deadline,
**so that** the policy is applied consistently across all properties.

**Acceptance Criteria:**
- A configurable grace period (e.g., 5 days past due) exists per property or lease.
- A late fee charge is automatically posted to the resident's ledger when the grace period expires and the balance is still outstanding.
- The late fee amount is configurable (flat fee or percentage of rent).
- Late fee assessment is logged with a timestamp for audit purposes.

---

### 6. Retry Failed Payments

**As a** property manager,
**I want** failed payments to be automatically retried on a configurable schedule,
**so that** transient failures (insufficient funds, network issues) are resolved without manual intervention.

**Acceptance Criteria:**
- Failed payments are retried up to a configurable number of attempts (e.g., 3) with increasing intervals.
- The resident is notified via email after each failed attempt.
- After all retry attempts are exhausted, the payment is marked as failed and the property manager is alerted.
- Each retry attempt and its outcome are recorded in the transaction log.

---

### 7. Handle Chargebacks and Disputes

**As a** finance analyst,
**I want to** receive, track, and respond to payment chargebacks and disputes,
**so that** SFR3 can protect its revenue and maintain accurate financial records.

**Acceptance Criteria:**
- Chargeback notifications from the payment provider are ingested via webhook and recorded.
- Each dispute is assigned a status (open, under review, won, lost) and linked to the original transaction.
- The finance analyst can upload evidence and submit a response to the payment provider.
- When a dispute is lost, the original charge is reinstated on the resident's ledger.

---

### 8. Reconcile Daily Transactions

**As a** finance analyst,
**I want** a daily reconciliation process that matches settled transactions from the payment provider against internal records,
**so that** discrepancies are identified and resolved promptly.

**Acceptance Criteria:**
- A reconciliation job runs daily, comparing payment provider settlement reports with internal transaction records.
- Matched transactions are marked as reconciled.
- Mismatches (amount differences, missing transactions) are flagged for manual review.
- A reconciliation summary report is generated and accessible to the finance team.

---

### 9. View Payment History and Receipts

**As a** resident,
**I want to** view my full payment history and download receipts for past payments,
**so that** I have records for my personal accounting and tax purposes.

**Acceptance Criteria:**
- Resident can view a chronological list of all payments with status (pending, settled, failed, refunded).
- Resident can filter payment history by date range and payment method.
- Resident can download a receipt (PDF) for any settled payment.
- Payment history is retained for the duration of the lease plus a configurable retention period.

---

### 10. Monitor Payment Health

**As a** finance analyst,
**I want** a dashboard showing real-time payment success rates, failure reasons, and processing volumes,
**so that** I can detect systemic issues early and measure collection performance.

**Acceptance Criteria:**
- Dashboard displays current-day and trailing 30-day payment success/failure rates.
- Failed payments are categorized by failure reason (insufficient funds, expired card, provider error, etc.).
- Alerts are triggered when the failure rate exceeds a configurable threshold.
- Dashboard shows total volume collected vs. total outstanding across the portfolio.

---

## Story Map Overview

The stories above follow a natural delivery sequence:

```
Foundation          Collection           Operations
-----------         -----------          -----------
1. Enroll           3. Autopay           8. Reconciliation
   Payment Method   4. Post Charges      9. Payment History
2. One-Time         5. Late Fees        10. Monitor Health
   Payment          6. Retry Failed
                    7. Chargebacks
```

**Release 1 (MVP + Observability):** Stories 1, 2, 4, 9, and 10 -- residents can link a payment method, pay charges posted by property managers, and view their history. Finance team gets a payment health dashboard from day one. This also builds the full event pipeline (event-sourced ledger, DynamoDB Streams, EventBridge, Firehose, S3, Athena, QuickSight) as foundational infrastructure.

**Release 2 (Automation):** Stories 3, 5, and 6 -- adding autopay enrollment, automatic late fees, and payment retry with backoff to reduce manual work and improve collection rates.

**Release 3 (Financial Operations):** Stories 7 and 8 -- completing the operational backbone with chargeback/dispute management and daily reconciliation against Stripe.
