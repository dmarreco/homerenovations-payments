import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StripeServiceClient } from '../../src/adapters/stripeServiceClient';

const mockSend = vi.fn();

vi.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: vi.fn().mockImplementation(() => ({ send: mockSend })),
  InvokeCommand: vi.fn(),
}));

describe('StripeServiceClient', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it('createCustomer invokes Lambda with createCustomer action and returns data', async () => {
    mockSend.mockResolvedValue({
      Payload: new TextEncoder().encode(
        JSON.stringify({ success: true, data: { customerId: 'cus_123' } })
      ),
    });
    const client = new StripeServiceClient('my-stripe-service');
    const result = await client.createCustomer({ email: 'a@b.com' });
    expect(result).toEqual({ customerId: 'cus_123' });
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('verifyWebhookSignature invokes Lambda and returns valid', async () => {
    mockSend.mockResolvedValue({
      Payload: new TextEncoder().encode(
        JSON.stringify({ success: true, data: { valid: true } })
      ),
    });
    const client = new StripeServiceClient('my-stripe-service');
    const result = await client.verifyWebhookSignature('body', 'sig');
    expect(result).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('throws when service returns success: false', async () => {
    mockSend.mockResolvedValue({
      Payload: new TextEncoder().encode(
        JSON.stringify({ success: false, error: 'Stripe error' })
      ),
    });
    const client = new StripeServiceClient('my-stripe-service');
    await expect(client.createCustomer({ email: 'a@b.com' })).rejects.toThrow('Stripe error');
  });

  it('getPaymentIntent returns null when data is null', async () => {
    mockSend.mockResolvedValue({
      Payload: new TextEncoder().encode(JSON.stringify({ success: true, data: null })),
    });
    const client = new StripeServiceClient('my-stripe-service');
    const result = await client.getPaymentIntent('pi_xxx');
    expect(result).toBeNull();
  });
});
