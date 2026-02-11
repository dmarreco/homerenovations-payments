import { describe, it, expect, vi } from 'vitest';
import { StripeAdapter } from '../../src/adapters/stripeAdapter';

describe('StripeAdapter', () => {
  it('verifyWebhookSignature returns false when secret is empty', () => {
    const mockStripe = {
      webhooks: {
        constructEvent: vi.fn(() => {
          throw new Error('bad');
        }),
      },
    } as any;
    const adapter = new StripeAdapter(mockStripe);
    const orig = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET = '';
    expect(adapter.verifyWebhookSignature('body', 'sig')).toBe(false);
    process.env.STRIPE_WEBHOOK_SECRET = orig;
  });
});
