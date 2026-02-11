/**
 * Ledger event constructors - factory functions for typed ledger records.
 */

import type { LedgerEventRecord, LedgerSnapshotRecord, OutstandingLedgerItem } from '../../types/tables';
import { ledgerPk, ledgerSk } from '../../types/tables';

export function createChargePostedEvent(
  residentId: string,
  version: number,
  params: {
    amount: number;
    chargeType: string;
    description?: string;
    referenceId?: string;
    propertyId?: string;
    state?: string;
  }
): LedgerEventRecord {
  const now = new Date().toISOString();
  return {
    PK: ledgerPk(residentId),
    SK: ledgerSk(version),
    type: 'EVENT',
    eventType: 'CHARGE_POSTED',
    amount: params.amount,
    chargeType: params.chargeType as 'RENT' | 'DEPOSIT' | 'UTILITY' | 'LATE_FEE' | 'OTHER',
    description: params.description,
    referenceId: params.referenceId,
    propertyId: params.propertyId,
    state: params.state,
    timestamp: now,
  };
}

export function createPaymentAppliedEvent(
  residentId: string,
  version: number,
  params: {
    amount: number;
    referenceId: string;
    propertyId?: string;
    state?: string;
    paymentMethod?: string;
  }
): LedgerEventRecord {
  const now = new Date().toISOString();
  return {
    PK: ledgerPk(residentId),
    SK: ledgerSk(version),
    type: 'EVENT',
    eventType: 'PAYMENT_APPLIED',
    amount: -Math.abs(params.amount),
    referenceId: params.referenceId,
    propertyId: params.propertyId,
    state: params.state,
    timestamp: now,
  };
}

export function createRefundAppliedEvent(
  residentId: string,
  version: number,
  params: {
    amount: number;
    referenceId: string;
    propertyId?: string;
    state?: string;
  }
): LedgerEventRecord {
  const now = new Date().toISOString();
  return {
    PK: ledgerPk(residentId),
    SK: ledgerSk(version),
    type: 'EVENT',
    eventType: 'REFUND_APPLIED',
    amount: Math.abs(params.amount),
    referenceId: params.referenceId,
    propertyId: params.propertyId,
    state: params.state,
    timestamp: now,
  };
}

export function createLateFeeAppliedEvent(
  residentId: string,
  version: number,
  params: {
    amount: number;
    description?: string;
    propertyId?: string;
    state?: string;
  }
): LedgerEventRecord {
  const now = new Date().toISOString();
  return {
    PK: ledgerPk(residentId),
    SK: ledgerSk(version),
    type: 'EVENT',
    eventType: 'LATE_FEE_APPLIED',
    amount: params.amount,
    chargeType: 'LATE_FEE',
    description: params.description ?? 'Late fee',
    propertyId: params.propertyId,
    state: params.state,
    timestamp: now,
  };
}

export function createSnapshotRecord(
  residentId: string,
  version: number,
  balance: number,
  outstandingItems?: OutstandingLedgerItem[]
): LedgerSnapshotRecord {
  const now = new Date().toISOString();
  return {
    PK: ledgerPk(residentId),
    SK: ledgerSk(version),
    type: 'SNAPSHOT',
    balance,
    outstandingItems: outstandingItems ?? [],
    timestamp: now,
  };
}
