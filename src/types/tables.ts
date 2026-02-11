/**
 * DynamoDB record types for all tables (architecture Section 4).
 */

export type LedgerRecordType = 'EVENT' | 'SNAPSHOT';

export type LedgerEventType =
  | 'CHARGE_POSTED'
  | 'PAYMENT_APPLIED'
  | 'LATE_FEE_APPLIED'
  | 'REFUND_APPLIED'
  | 'CHARGEBACK_APPLIED'
  | 'CREDIT_APPLIED';

export type ChargeType = 'RENT' | 'DEPOSIT' | 'UTILITY' | 'LATE_FEE' | 'OTHER';

export interface LedgerEventRecord {
  PK: string; // RESIDENT#<residentId>
  SK: string; // v<version> zero-padded
  type: 'EVENT';
  eventType: LedgerEventType;
  amount: number;
  chargeType?: ChargeType;
  description?: string;
  referenceId?: string;
  propertyId?: string;
  state?: string;
  timestamp: string;
  ttl?: number;
}

export interface LedgerSnapshotRecord {
  PK: string;
  SK: string;
  type: 'SNAPSHOT';
  balance: number;
  outstandingItems?: OutstandingLedgerItem[];
  timestamp: string;
  ttl?: number;
}

export type LedgerRecord = LedgerEventRecord | LedgerSnapshotRecord;

export interface OutstandingLedgerItem {
  version: string;
  eventType: LedgerEventType;
  amount: number;
  chargeType?: ChargeType;
  description?: string;
  dueDate?: string;
}

export type PaymentStatus = 'PENDING' | 'SETTLED' | 'FAILED' | 'REFUNDED';

export type PaymentMethodType = 'ACH' | 'CARD' | 'WALLET';

export interface PaymentRecord {
  PK: string; // PAYMENT#<paymentId>
  SK: string; // METADATA
  residentId: string;
  createdAt: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  paymentMethodId?: string;
  paymentMethodType?: PaymentMethodType;
  stripePaymentIntentId?: string;
  retryCount?: number;
  maxRetries?: number;
  failureReason?: string;
  reconciledAt?: string;
  receiptUrl?: string;
}

export interface PaymentMethodRecord {
  PK: string; // RESIDENT#<residentId>
  SK: string; // METHOD#<methodId>
  type: PaymentMethodType;
  stripePaymentMethodId: string;
  last4?: string;
  label?: string;
  isDefault?: boolean;
  createdAt: string;
}

export function ledgerPk(residentId: string): string {
  return `RESIDENT#${residentId}`;
}

export function ledgerSk(version: number): string {
  return `v${String(version).padStart(8, '0')}`;
}

export function paymentPk(paymentId: string): string {
  return `PAYMENT#${paymentId}`;
}

export function paymentMethodPk(residentId: string): string {
  return `RESIDENT#${residentId}`;
}

export function paymentMethodSk(methodId: string): string {
  return `METHOD#${methodId}`;
}
