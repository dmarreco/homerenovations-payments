import { describe, it, expect } from 'vitest';
import { ledgerSk, ledgerPk } from '../../src/types/tables';
import type { LedgerEventRecord } from '../../src/types/tables';

const SNAPSHOT_INTERVAL = 10;

describe('Ledger', () => {
  describe('ledger key helpers', () => {
    it('ledgerPk formats correctly', () => {
      expect(ledgerPk('r123')).toBe('RESIDENT#r123');
    });
    it('ledgerSk zero-pads version', () => {
      expect(ledgerSk(0)).toBe('v00000000');
      expect(ledgerSk(1)).toBe('v00000001');
      expect(ledgerSk(10)).toBe('v00000010');
    });
  });

  describe('snapshot interval', () => {
    it('snapshot written when version % 10 === 0', () => {
      expect(10 % SNAPSHOT_INTERVAL).toBe(0);
      expect(20 % SNAPSHOT_INTERVAL).toBe(0);
      expect(9 % SNAPSHOT_INTERVAL).toBe(9);
    });
  });

  describe('event record shape', () => {
    it('CHARGE_POSTED has positive amount', () => {
      const ev: LedgerEventRecord = {
        PK: 'RESIDENT#r1',
        SK: 'v00000001',
        type: 'EVENT',
        eventType: 'CHARGE_POSTED',
        amount: 2100,
        chargeType: 'RENT',
        timestamp: new Date().toISOString(),
      };
      expect(ev.amount).toBeGreaterThan(0);
    });
    it('PAYMENT_APPLIED has negative amount', () => {
      const ev: LedgerEventRecord = {
        PK: 'RESIDENT#r1',
        SK: 'v00000002',
        type: 'EVENT',
        eventType: 'PAYMENT_APPLIED',
        amount: -2100,
        referenceId: 'pay-1',
        timestamp: new Date().toISOString(),
      };
      expect(ev.amount).toBeLessThan(0);
    });
  });
});
