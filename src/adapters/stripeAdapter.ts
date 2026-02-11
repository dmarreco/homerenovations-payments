/**
 * Stripe adapter implementing PaymentProviderPort.
 */

import Stripe from 'stripe';
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

export class StripeAdapter implements PaymentProviderPort {
  constructor(private stripe: Stripe) {}

  async createCustomer(params: CreateCustomerParams): Promise<CustomerResult> {
    const customer = await this.stripe.customers.create({
      email: params.email,
      name: params.name,
    });
    return { customerId: customer.id };
  }

  async attachPaymentMethod(customerId: string, paymentMethodId: string): Promise<MethodResult> {
    const pm = await this.stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
    const last4 = pm.card?.last4 ?? (pm as { last4?: string }).last4;
    const brand = pm.card?.brand;
    return {
      paymentMethodId: pm.id,
      last4,
      brand,
    };
  }

  async detachPaymentMethod(paymentMethodId: string): Promise<void> {
    await this.stripe.paymentMethods.detach(paymentMethodId);
  }

  async createPaymentIntent(params: PaymentIntentParams): Promise<PaymentIntentResult> {
    const pi = await this.stripe.paymentIntents.create(
      {
        amount: params.amount,
        currency: params.currency.toLowerCase(),
        payment_method: params.paymentMethodId,
        customer: params.customerId,
        confirm: true,
        automatic_payment_methods: { enabled: true },
        metadata: params.metadata ?? {},
      },
      params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : {}
    );
    return {
      paymentIntentId: pi.id,
      clientSecret: pi.client_secret ?? '',
      status: pi.status,
    };
  }

  async getPaymentIntent(paymentIntentId: string): Promise<{ status: string; amount: number } | null> {
    try {
      const pi = await this.stripe.paymentIntents.retrieve(paymentIntentId);
      return { status: pi.status, amount: pi.amount_received ?? pi.amount };
    } catch {
      return null;
    }
  }

  async createRefund(paymentIntentId: string, amount?: number): Promise<RefundResult> {
    const params: { payment_intent: string; amount?: number } = { payment_intent: paymentIntentId };
    if (amount != null && amount > 0) params.amount = amount;
    const refund = await this.stripe.refunds.create(params);
    return {
      refundId: refund.id,
      status: refund.status ?? 'succeeded',
      amount: refund.amount ?? 0,
    };
  }

  async getBalanceTransactions(params: DateRangeParams): Promise<BalanceTransaction[]> {
    const transactions = await this.stripe.balanceTransactions.list({
      created: { gte: params.from, lte: params.to },
      limit: 100,
    });
    return transactions.data.map((t) => ({
      id: t.id,
      amount: t.amount,
      currency: t.currency,
      type: t.type,
      created: t.created,
    }));
  }

  async submitDisputeEvidence(disputeId: string, evidence: Evidence): Promise<void> {
    await this.stripe.disputes.update(disputeId, {
      evidence: {
        receipt: evidence.receipt,
        customer_communication: evidence.customer_communication,
      },
      submit: true,
    });
  }

  async verifyWebhookSignature(payload: string, signature: string): Promise<boolean> {
    try {
      this.stripe.webhooks.constructEvent(
        payload,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET ?? ''
      );
      return true;
    } catch {
      return false;
    }
  }
}

export function createStripeAdapter(secretKey: string): StripeAdapter {
  const stripe = new Stripe(secretKey);
  return new StripeAdapter(stripe);
}
