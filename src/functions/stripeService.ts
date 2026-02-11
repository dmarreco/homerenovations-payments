/**
 * Dedicated Stripe service Lambda. Only this function talks to the Stripe API.
 * Invoked by other Lambdas with { action, params }; dispatches to StripeAdapter.
 */

import type { Handler } from 'aws-lambda';
import { createStripeAdapter } from '../adapters/stripeAdapter';
import type {
  CreateCustomerParams,
  CustomerResult,
  MethodResult,
  PaymentIntentParams,
  PaymentIntentResult,
  DateRangeParams,
  BalanceTransaction,
  Evidence,
} from '../ports/paymentProvider';

const secretKey = process.env.STRIPE_SECRET_KEY ?? '';

function getAdapter() {
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY not set');
  return createStripeAdapter(secretKey);
}

export interface StripeServiceInvokePayload {
  action: string;
  params: Record<string, unknown>;
}

export interface StripeServiceSuccessResponse<T = unknown> {
  success: true;
  data: T;
}

export interface StripeServiceErrorResponse {
  success: false;
  error: string;
}

export type StripeServiceResponse = StripeServiceSuccessResponse | StripeServiceErrorResponse;

export const handler: Handler<StripeServiceInvokePayload, StripeServiceResponse> = async (event) => {
  const { action, params } = event;
  if (!action || typeof params !== 'object' || params === null) {
    return { success: false, error: 'Missing action or params' };
  }
  try {
    switch (action) {
      case 'createCustomer': {
        const stripe = getAdapter();
        const data = await stripe.createCustomer(params as unknown as CreateCustomerParams);
        return { success: true, data };
      }
      case 'attachPaymentMethod': {
        const { customerId, paymentMethodId } = params as { customerId: string; paymentMethodId: string };
        if (!customerId || !paymentMethodId) {
          return { success: false, error: 'attachPaymentMethod requires customerId and paymentMethodId' };
        }
        const stripe = getAdapter();
        const data = await stripe.attachPaymentMethod(customerId, paymentMethodId);
        return { success: true, data };
      }
      case 'detachPaymentMethod': {
        const { paymentMethodId } = params as { paymentMethodId: string };
        if (!paymentMethodId) return { success: false, error: 'detachPaymentMethod requires paymentMethodId' };
        const stripe = getAdapter();
        await stripe.detachPaymentMethod(paymentMethodId);
        return { success: true, data: undefined };
      }
      case 'createPaymentIntent': {
        const stripe = getAdapter();
        const data = await stripe.createPaymentIntent(params as unknown as PaymentIntentParams);
        return { success: true, data };
      }
      case 'getPaymentIntent': {
        const { paymentIntentId } = params as { paymentIntentId: string };
        if (!paymentIntentId) return { success: false, error: 'getPaymentIntent requires paymentIntentId' };
        const stripe = getAdapter();
        const data = await stripe.getPaymentIntent(paymentIntentId);
        return { success: true, data: data ?? null };
      }
      case 'getBalanceTransactions': {
        const stripe = getAdapter();
        const data = await stripe.getBalanceTransactions(params as unknown as DateRangeParams);
        return { success: true, data };
      }
      case 'submitDisputeEvidence': {
        const { disputeId, evidence } = params as { disputeId: string; evidence: Evidence };
        if (!disputeId || !evidence) {
          return { success: false, error: 'submitDisputeEvidence requires disputeId and evidence' };
        }
        const stripe = getAdapter();
        await stripe.submitDisputeEvidence(disputeId, evidence);
        return { success: true, data: undefined };
      }
      case 'verifyWebhookSignature': {
        const { payload, signature } = params as { payload: string; signature: string };
        if (payload === undefined || signature === undefined) {
          return { success: false, error: 'verifyWebhookSignature requires payload and signature' };
        }
        const stripe = getAdapter();
        const valid = await stripe.verifyWebhookSignature(payload, signature);
        return { success: true, data: { valid } };
      }
      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('stripeService', action, err);
    return { success: false, error: message };
  }
};
