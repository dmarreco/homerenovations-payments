/**
 * Client that implements PaymentProviderPort by calling the dedicated Stripe service over HTTP.
 */

import type {
  PaymentProviderPort,
  CreateCustomerParams,
  CustomerResult,
  MethodResult,
  PaymentIntentParams,
  PaymentIntentResult,
  RefundResult,
  DateRangeParams,
  BalanceTransaction,
  Evidence,
} from '../ports/paymentProvider';

export class StripeServiceClient implements PaymentProviderPort {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey?: string
  ) {}

  private async request<T>(action: string, params: Record<string, unknown>): Promise<T> {
    const url = this.baseUrl.replace(/\/$/, '');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['X-Api-Key'] = this.apiKey;
    }
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action, params }),
    });
    const body = (await res.json()) as {
      success: boolean;
      data?: T;
      error?: string;
    };
    if (!res.ok) {
      throw new Error(body.error ?? `Stripe service error: ${res.status}`);
    }
    if (!body.success) {
      throw new Error(body.error ?? 'Stripe service failed');
    }
    return body.data as T;
  }

  async createCustomer(params: CreateCustomerParams): Promise<CustomerResult> {
    return this.request<CustomerResult>('createCustomer', params as unknown as Record<string, unknown>);
  }

  async attachPaymentMethod(customerId: string, paymentMethodId: string): Promise<MethodResult> {
    return this.request<MethodResult>('attachPaymentMethod', { customerId, paymentMethodId });
  }

  async detachPaymentMethod(paymentMethodId: string): Promise<void> {
    await this.request<undefined>('detachPaymentMethod', { paymentMethodId });
  }

  async createPaymentIntent(params: PaymentIntentParams): Promise<PaymentIntentResult> {
    return this.request<PaymentIntentResult>('createPaymentIntent', params as unknown as Record<string, unknown>);
  }

  async getPaymentIntent(paymentIntentId: string): Promise<{ status: string; amount: number } | null> {
    return this.request<{ status: string; amount: number } | null>('getPaymentIntent', {
      paymentIntentId,
    });
  }

  async createRefund(paymentIntentId: string, amount?: number): Promise<RefundResult> {
    return this.request<RefundResult>('createRefund', { paymentIntentId, amount });
  }

  async getBalanceTransactions(params: DateRangeParams): Promise<BalanceTransaction[]> {
    return this.request<BalanceTransaction[]>('getBalanceTransactions', params as unknown as Record<string, unknown>);
  }

  async submitDisputeEvidence(disputeId: string, evidence: Evidence): Promise<void> {
    await this.request<undefined>('submitDisputeEvidence', { disputeId, evidence });
  }

  async verifyWebhookSignature(payload: string, signature: string): Promise<boolean> {
    const data = await this.request<{ valid: boolean }>('verifyWebhookSignature', {
      payload,
      signature,
    });
    return data.valid;
  }
}

export function createStripeServiceClient(baseUrl: string, apiKey?: string): PaymentProviderPort {
  return new StripeServiceClient(baseUrl, apiKey);
}
