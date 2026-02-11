import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handler } from '../../src/functions/stripeService';

describe('stripeService', () => {
  const origSecret = process.env.STRIPE_SECRET_KEY;
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
  });
  afterEach(() => {
    process.env.STRIPE_SECRET_KEY = origSecret;
  });

  it('returns error when action or params missing', async () => {
    expect(await handler({ action: '', params: {} } as any)).toEqual({
      success: false,
      error: 'Missing action or params',
    });
    expect(await handler({ action: 'createCustomer', params: null } as any)).toEqual({
      success: false,
      error: 'Missing action or params',
    });
  });

  it('returns error for unknown action', async () => {
    const res = await handler({ action: 'unknownAction', params: {} } as any);
    expect(res).toEqual({ success: false, error: 'Unknown action: unknownAction' });
  });

  it('verifyWebhookSignature requires payload and signature', async () => {
    const res = await handler({
      action: 'verifyWebhookSignature',
      params: {},
    } as any);
    expect(res).toEqual({
      success: false,
      error: 'verifyWebhookSignature requires payload and signature',
    });
  });

  it('returns error when STRIPE_SECRET_KEY not set', async () => {
    const origMock = process.env.STRIPE_MOCK;
    process.env.STRIPE_MOCK = 'false';
    delete process.env.STRIPE_SECRET_KEY;
    try {
      const res = await handler({
        action: 'createCustomer',
        params: { email: 'a@b.com' },
      } as any);
      expect(res).toEqual({ success: false, error: 'STRIPE_SECRET_KEY not set' });
    } finally {
      process.env.STRIPE_SECRET_KEY = origSecret;
      process.env.STRIPE_MOCK = origMock;
    }
  });

  describe('mock mode (STRIPE_MOCK=true)', () => {
    const origMock = process.env.STRIPE_MOCK;
    const origSecret = process.env.STRIPE_SECRET_KEY;

    beforeEach(() => {
      process.env.STRIPE_MOCK = 'true';
      delete process.env.STRIPE_SECRET_KEY;
    });
    afterEach(() => {
      process.env.STRIPE_MOCK = origMock;
      process.env.STRIPE_SECRET_KEY = origSecret;
    });

    it('returns mock createCustomer without Stripe secret', async () => {
      const res = await handler({
        action: 'createCustomer',
        params: { email: 'e2e@test.com' },
      } as any);
      expect(res).toEqual({
        success: true,
        data: { customerId: expect.stringMatching(/^cus_mock_[a-zA-Z0-9]+$/) },
      });
    });

    it('returns mock createPaymentIntent without Stripe secret', async () => {
      const res = await handler({
        action: 'createPaymentIntent',
        params: {
          amount: 1000,
          currency: 'usd',
          paymentMethodId: 'pm_xxx',
          idempotencyKey: 'pay-123',
        },
      } as any);
      expect(res).toEqual({
        success: true,
        data: {
          paymentIntentId: 'pi_mock_pay-123',
          clientSecret: 'secret_mock_pay-123',
          status: 'succeeded',
        },
      });
    });

    it('returns success false for invalid params in mock mode', async () => {
      const res = await handler({
        action: 'createRefund',
        params: {},
      } as any);
      expect(res).toEqual({
        success: false,
        error: 'createRefund requires paymentIntentId',
      });
    });
  });
});
