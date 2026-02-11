/**
 * Client that implements PaymentProviderPort by invoking the dedicated Stripe service Lambda.
 */

import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import type {
  PaymentProviderPort,
  CreateCustomerParams,
  CustomerResult,
  MethodResult,
  PaymentIntentParams,
  PaymentIntentResult,
  DateRangeParams,
  BalanceTransaction,
  Evidence,
} from '../ports/paymentProvider';

export class StripeServiceClient implements PaymentProviderPort {
  constructor(
    private readonly functionName: string,
    private readonly lambda: LambdaClient = new LambdaClient({})
  ) {}

  private async invoke<T>(action: string, params: Record<string, unknown>): Promise<T> {
    const payload = JSON.stringify({ action, params });
    const result = await this.lambda.send(
      new InvokeCommand({
        FunctionName: this.functionName,
        InvocationType: 'RequestResponse',
        Payload: new TextEncoder().encode(payload),
      })
    );
    if (result.FunctionError) {
      const err = result.Payload ? new TextDecoder().decode(result.Payload) : result.FunctionError;
      throw new Error(`Stripe service error: ${err}`);
    }
    if (!result.Payload) throw new Error('Stripe service returned empty payload');
    const body = JSON.parse(new TextDecoder().decode(result.Payload)) as {
      success: boolean;
      data?: T;
      error?: string;
    };
    if (!body.success) {
      throw new Error(body.error ?? 'Stripe service failed');
    }
    return body.data as T;
  }

  async createCustomer(params: CreateCustomerParams): Promise<CustomerResult> {
    return this.invoke<CustomerResult>('createCustomer', params as unknown as Record<string, unknown>);
  }

  async attachPaymentMethod(customerId: string, paymentMethodId: string): Promise<MethodResult> {
    return this.invoke<MethodResult>('attachPaymentMethod', { customerId, paymentMethodId });
  }

  async detachPaymentMethod(paymentMethodId: string): Promise<void> {
    await this.invoke<undefined>('detachPaymentMethod', { paymentMethodId });
  }

  async createPaymentIntent(params: PaymentIntentParams): Promise<PaymentIntentResult> {
    return this.invoke<PaymentIntentResult>('createPaymentIntent', params as unknown as Record<string, unknown>);
  }

  async getPaymentIntent(paymentIntentId: string): Promise<{ status: string; amount: number } | null> {
    return this.invoke<{ status: string; amount: number } | null>('getPaymentIntent', {
      paymentIntentId,
    });
  }

  async getBalanceTransactions(params: DateRangeParams): Promise<BalanceTransaction[]> {
    return this.invoke<BalanceTransaction[]>('getBalanceTransactions', params as unknown as Record<string, unknown>);
  }

  async submitDisputeEvidence(disputeId: string, evidence: Evidence): Promise<void> {
    await this.invoke<undefined>('submitDisputeEvidence', { disputeId, evidence });
  }

  async verifyWebhookSignature(payload: string, signature: string): Promise<boolean> {
    const data = await this.invoke<{ valid: boolean }>('verifyWebhookSignature', {
      payload,
      signature,
    });
    return data.valid;
  }
}

export function createStripeServiceClient(functionName: string): PaymentProviderPort {
  return new StripeServiceClient(functionName);
}
