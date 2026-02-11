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
    delete process.env.STRIPE_SECRET_KEY;
    try {
      const res = await handler({
        action: 'createCustomer',
        params: { email: 'a@b.com' },
      } as any);
      expect(res).toEqual({ success: false, error: 'STRIPE_SECRET_KEY not set' });
    } finally {
      process.env.STRIPE_SECRET_KEY = origSecret;
    }
  });
});
