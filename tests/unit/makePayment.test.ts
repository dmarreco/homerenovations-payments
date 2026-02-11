import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from '../../src/functions/makePayment';

const mockRebuildState = vi.fn();
const mockGetConfig = vi.fn();
const mockGetItem = vi.fn();
const mockCreatePaymentIntent = vi.fn();
const mockInitiatePayment = vi.fn();

vi.mock('../../src/domain/ledger/ledger', () => ({
  rebuildState: (...args: unknown[]) => mockRebuildState(...args),
}));
vi.mock('../../src/lib/config', () => ({
  getConfig: () => mockGetConfig(),
}));
vi.mock('../../src/lib/dynamodb', () => ({
  getItem: (...args: unknown[]) => mockGetItem(...args),
}));
vi.mock('../../src/adapters/stripeServiceClient', () => ({
  createStripeServiceClient: () => ({
    createPaymentIntent: (params: unknown) => mockCreatePaymentIntent(params),
  }),
}));
vi.mock('../../src/domain/payments/payments', () => ({
  initiatePayment: (...args: unknown[]) => mockInitiatePayment(...args),
}));

describe('makePayment', () => {
  const baseConfig = {
    stripeServiceUrl: 'https://stripe.example.com',
    stripeServiceApiKey: '',
    ledgerTableName: 'Ledger',
    paymentMethodsTableName: 'Methods',
    paymentsTableName: 'Payments',
    defaultPaymentMaxRetries: 3,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfig.mockReturnValue(baseConfig);
    mockRebuildState.mockResolvedValue({ balance: 2000, version: 1, outstandingItems: [] });
    mockGetItem.mockImplementation((_table: string, key: { PK: string; SK: string }) => {
      if (key.SK?.startsWith('METHOD#')) {
        return Promise.resolve({ stripePaymentMethodId: 'pm_123', type: 'CARD' });
      }
      if (key.SK === 'CUSTOMER') {
        return Promise.resolve({ stripeCustomerId: 'cus_123' });
      }
      return Promise.resolve(null);
    });
    mockCreatePaymentIntent.mockResolvedValue({
      paymentIntentId: 'pi_xxx',
      clientSecret: 'secret',
      status: 'requires_payment_method',
    });
    mockInitiatePayment.mockResolvedValue({});
  });

  it('returns 400 when balance <= 0', async () => {
    mockRebuildState.mockResolvedValueOnce({ balance: 0, version: 0, outstandingItems: [] });
    const res = await handler({
      pathParameters: { residentId: 'r1' },
      body: JSON.stringify({ amount: 1000, paymentMethodId: 'm1' }),
    } as any);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body!)).toEqual({ error: 'No balance due' });
    expect(mockCreatePaymentIntent).not.toHaveBeenCalled();
  });

  it('returns 400 when amount exceeds current balance', async () => {
    mockRebuildState.mockResolvedValueOnce({ balance: 2000, version: 1, outstandingItems: [] });
    const res = await handler({
      pathParameters: { residentId: 'r1' },
      body: JSON.stringify({ amount: 3000, paymentMethodId: 'm1' }),
    } as any);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body!)).toEqual({
      error: 'Amount exceeds current balance',
      balance: 2000,
    });
    expect(mockCreatePaymentIntent).not.toHaveBeenCalled();
  });

  it('returns 202 when amount <= balance and proceeds to Stripe', async () => {
    const res = await handler({
      pathParameters: { residentId: 'r1' },
      body: JSON.stringify({ amount: 1500, paymentMethodId: 'm1' }),
    } as any);
    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body!);
    expect(body.paymentId).toBeDefined();
    expect(body.reference).toBe('pi_xxx');
    expect(body.currentBalance).toBe(2000);
    expect(body.balanceAfterPayment).toBe(500);
    expect(mockCreatePaymentIntent).toHaveBeenCalledTimes(1);
    expect(mockInitiatePayment).toHaveBeenCalledTimes(1);
  });

  it('returns 202 when amount equals balance (full payment)', async () => {
    const res = await handler({
      pathParameters: { residentId: 'r1' },
      body: JSON.stringify({ amount: 2000, paymentMethodId: 'm1' }),
    } as any);
    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body!);
    expect(body.balanceAfterPayment).toBe(0);
  });
});
