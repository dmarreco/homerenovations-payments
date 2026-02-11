import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StripeServiceClient } from '../../src/adapters/stripeServiceClient';

const mockFetch = vi.fn();

describe('StripeServiceClient', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
  });

  it('createCustomer calls HTTP endpoint and returns data', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { customerId: 'cus_123' } }),
    });
    const client = new StripeServiceClient('https://api.example.com/internal/stripe');
    const result = await client.createCustomer({ email: 'a@b.com' });
    expect(result).toEqual({ customerId: 'cus_123' });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe('https://api.example.com/internal/stripe');
    expect(mockFetch.mock.calls[0][1].method).toBe('POST');
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
      action: 'createCustomer',
      params: { email: 'a@b.com' },
    });
  });

  it('verifyWebhookSignature calls HTTP and returns valid', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { valid: true } }),
    });
    const client = new StripeServiceClient('https://api.example.com/internal/stripe');
    const result = await client.verifyWebhookSignature('body', 'sig');
    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('sends X-Api-Key header when apiKey provided', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { customerId: 'cus_123' } }),
    });
    const client = new StripeServiceClient('https://api.example.com/internal/stripe', 'secret-key');
    await client.createCustomer({ email: 'a@b.com' });
    expect(mockFetch.mock.calls[0][1].headers['X-Api-Key']).toBe('secret-key');
  });

  it('throws when service returns success: false', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: false, error: 'Stripe error' }),
    });
    const client = new StripeServiceClient('https://api.example.com/internal/stripe');
    await expect(client.createCustomer({ email: 'a@b.com' })).rejects.toThrow('Stripe error');
  });

  it('throws when HTTP response is not ok', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ success: false, error: 'Internal error' }),
    });
    const client = new StripeServiceClient('https://api.example.com/internal/stripe');
    await expect(client.createCustomer({ email: 'a@b.com' })).rejects.toThrow('Internal error');
  });

  it('getPaymentIntent returns null when data is null', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: null }),
    });
    const client = new StripeServiceClient('https://api.example.com/internal/stripe');
    const result = await client.getPaymentIntent('pi_xxx');
    expect(result).toBeNull();
  });
});
