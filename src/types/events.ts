/**
 * Domain event envelope and payload types (architecture Section 6.3).
 */

import type { LedgerEventType } from './tables';

export type DomainEventType =
  | 'charge.posted'
  | 'payment.initiated'
  | 'payment.settled'
  | 'payment.failed'
  | 'payment.permanently_failed'
  | 'late_fee.applied'
  | 'receipt.generated'
  | 'reconciliation.complete';

export interface DomainEventData {
  residentId: string;
  propertyId?: string;
  state?: string;
  amount: number;
  currency: string;
  paymentMethod?: string;
  failureReason?: string;
  stripeRef?: string;
  paymentId?: string;
  chargeType?: string;
  description?: string;
  [key: string]: unknown;
}

export interface DomainEvent {
  eventId: string;
  eventType: DomainEventType;
  source: string;
  timestamp: string;
  version: string;
  data: DomainEventData;
}

export function ledgerEventTypeToDomainEventType(
  ledgerEventType: LedgerEventType
): DomainEventType {
  const map: Record<LedgerEventType, DomainEventType> = {
    CHARGE_POSTED: 'charge.posted',
    PAYMENT_APPLIED: 'payment.settled',
    LATE_FEE_APPLIED: 'late_fee.applied',
    REFUND_APPLIED: 'payment.failed', // treat as reversal
    CHARGEBACK_APPLIED: 'charge.posted', // charge reinstated
    CREDIT_APPLIED: 'payment.settled', // credit reduces balance
  };
  return map[ledgerEventType] ?? 'charge.posted';
}
