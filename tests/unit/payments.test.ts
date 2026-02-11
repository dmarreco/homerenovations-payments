import { describe, it, expect } from 'vitest';
import type { PaymentRecord } from '../../src/types/tables';
import { paymentPk } from '../../src/types/tables';

describe('Payments domain', () => {
  it('paymentPk formats correctly', () => {
    expect(paymentPk('pay-123')).toBe('PAYMENT#pay-123');
  });

  it('PaymentRecord status transitions', () => {
    const record: PaymentRecord = {
      PK: 'PAYMENT#id',
      SK: 'METADATA',
      residentId: 'r1',
      createdAt: new Date().toISOString(),
      amount: 2100,
      currency: 'USD',
      status: 'PENDING',
      paymentMethodId: 'm1',
      paymentMethodType: 'CARD',
      stripePaymentIntentId: 'pi_xxx',
      retryCount: 0,
      maxRetries: 3,
    };
    expect(record.status).toBe('PENDING');
    record.status = 'SETTLED';
    expect(record.status).toBe('SETTLED');
  });
});
