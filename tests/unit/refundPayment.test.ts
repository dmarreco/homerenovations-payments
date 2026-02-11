import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from '../../src/functions/refundPayment';

const mockGetConfig = vi.fn();
const mockGetPayment = vi.fn();
const mockCreateRefund = vi.fn();
const mockRefundPaymentDomain = vi.fn();
const mockAppendEvent = vi.fn();

vi.mock('../../src/lib/config', () => ({
  getConfig: () => mockGetConfig(),
}));
vi.mock('../../src/domain/payments/payments', () => ({
  getPayment: (id: string, _config: unknown) => mockGetPayment(id),
  refundPayment: (...args: unknown[]) => mockRefundPaymentDomain(...args),
}));
vi.mock('../../src/adapters/stripeServiceClient', () => ({
  createStripeServiceClient: () => ({
    createRefund: (paymentIntentId: string, amount?: number) =>
      mockCreateRefund(paymentIntentId, amount),
  }),
}));
vi.mock('../../src/domain/ledger/ledger', () => ({
  appendEvent: (...args: unknown[]) => mockAppendEvent(...args),
}));

describe('refundPayment', () => {
  const settledPayment = {
    PK: 'PAYMENT#pay-1',
    SK: 'METADATA',
    residentId: 'r1',
    amount: 2100,
    currency: 'USD',
    status: 'SETTLED',
    stripePaymentIntentId: 'pi_xxx',
    paymentMethodId: 'pm_1',
    paymentMethodType: 'CARD' as const,
    createdAt: new Date().toISOString(),
    retryCount: 0,
    maxRetries: 3,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfig.mockReturnValue({
      stripeServiceUrl: 'https://stripe.example.com',
      stripeServiceApiKey: 'key',
      paymentsTableName: 'Payments',
      ledgerTableName: 'Ledger',
    });
    mockGetPayment.mockResolvedValue(settledPayment);
    mockCreateRefund.mockResolvedValue({
      refundId: 're_123',
      status: 'succeeded',
      amount: 2100,
    });
    mockRefundPaymentDomain.mockResolvedValue(undefined);
    mockAppendEvent.mockResolvedValue({ version: 2 });
  });

  it('returns 200 and refunds when payment is SETTLED', async () => {
    const res = await handler({
      pathParameters: { residentId: 'r1', paymentId: 'pay-1' },
      body: undefined,
    } as any);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body).toEqual({
      paymentId: 'pay-1',
      refundId: 're_123',
      status: 'succeeded',
      amount: 2100,
    });
    expect(mockGetPayment).toHaveBeenCalledWith('pay-1');
    expect(mockCreateRefund).toHaveBeenCalledWith('pi_xxx', undefined);
    expect(mockRefundPaymentDomain).toHaveBeenCalledWith('pay-1', { tableName: 'Payments' });
    expect(mockAppendEvent).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({
        eventType: 'REFUND_APPLIED',
        amount: 2100,
        referenceId: 'pay-1',
      }),
      { tableName: 'Ledger' }
    );
  });

  it('calls Stripe createRefund with optional partial amount when body provided', async () => {
    await handler({
      pathParameters: { residentId: 'r1', paymentId: 'pay-1' },
      body: JSON.stringify({ amount: 1000 }),
    } as any);
    expect(mockCreateRefund).toHaveBeenCalledWith('pi_xxx', 1000);
  });

  it('returns 400 when residentId or paymentId missing', async () => {
    const res1 = await handler({
      pathParameters: { paymentId: 'pay-1' },
      body: undefined,
    } as any);
    expect(res1.statusCode).toBe(400);
    expect(JSON.parse(res1.body!).error).toContain('Missing');

    const res2 = await handler({
      pathParameters: { residentId: 'r1' },
      body: undefined,
    } as any);
    expect(res2.statusCode).toBe(400);
    expect(mockCreateRefund).not.toHaveBeenCalled();
  });

  it('returns 404 when payment not found', async () => {
    mockGetPayment.mockResolvedValueOnce(null);
    const res = await handler({
      pathParameters: { residentId: 'r1', paymentId: 'pay-1' },
      body: undefined,
    } as any);
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body!).error).toBe('Payment not found');
    expect(mockCreateRefund).not.toHaveBeenCalled();
  });

  it('returns 403 when residentId does not match payment', async () => {
    const res = await handler({
      pathParameters: { residentId: 'r2', paymentId: 'pay-1' },
      body: undefined,
    } as any);
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body!).error).toBe('Forbidden');
    expect(mockCreateRefund).not.toHaveBeenCalled();
  });

  it('returns 400 when payment is not SETTLED', async () => {
    mockGetPayment.mockResolvedValueOnce({ ...settledPayment, status: 'PENDING' });
    const res = await handler({
      pathParameters: { residentId: 'r1', paymentId: 'pay-1' },
      body: undefined,
    } as any);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body!).error).toContain('not settled');
    expect(mockCreateRefund).not.toHaveBeenCalled();
  });

  it('returns 400 when payment is already REFUNDED', async () => {
    mockGetPayment.mockResolvedValueOnce({ ...settledPayment, status: 'REFUNDED' });
    const res = await handler({
      pathParameters: { residentId: 'r1', paymentId: 'pay-1' },
      body: undefined,
    } as any);
    expect(res.statusCode).toBe(400);
    expect(mockCreateRefund).not.toHaveBeenCalled();
  });

  it('returns 409 when domain refundPayment fails (e.g. already refunded)', async () => {
    mockRefundPaymentDomain.mockRejectedValueOnce(new Error('ConditionalCheckFailedException'));
    const res = await handler({
      pathParameters: { residentId: 'r1', paymentId: 'pay-1' },
      body: undefined,
    } as any);
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body!).error).toMatch(/already refunded|status changed/);
  });

  it('returns 500 when stripeServiceUrl is not configured', async () => {
    mockGetConfig.mockReturnValueOnce({
      ...mockGetConfig(),
      stripeServiceUrl: '',
    });
    const res = await handler({
      pathParameters: { residentId: 'r1', paymentId: 'pay-1' },
      body: undefined,
    } as any);
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body!).error).toContain('not configured');
  });

  it('returns 502 when Stripe createRefund throws', async () => {
    mockCreateRefund.mockRejectedValueOnce(new Error('Stripe error'));
    const res = await handler({
      pathParameters: { residentId: 'r1', paymentId: 'pay-1' },
      body: undefined,
    } as any);
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body!).error).toContain('Refund failed');
  });
});
