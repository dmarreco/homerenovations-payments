/**
 * Dedicated Stripe service Lambda. Only this function talks to the Stripe API.
 * Exposed via HTTP POST (API Gateway); body is { action, params }. Returns JSON { success, data } or { success, error }.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createStripeAdapter } from '../adapters/stripeAdapter';
import type {
  CreateCustomerParams,
  PaymentIntentParams,
  PaymentIntentResult,
  RefundResult,
  DateRangeParams,
  Evidence,
} from '../ports/paymentProvider';
import { withMiddyHttp } from '../lib/middyMiddlewares';

const secretKey = process.env.STRIPE_SECRET_KEY ?? '';
const apiKey = process.env.STRIPE_SERVICE_API_KEY ?? '';

function useMock(): boolean {
  return process.env.STRIPE_MOCK === 'true' || process.env.STRIPE_MOCK === '1';
}

function getAdapter() {
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY not set');
  return createStripeAdapter(secretKey);
}

function shortId(seed?: string): string {
  if (seed) return seed.replaceAll(/[^a-zA-Z0-9]/g, '').slice(0, 12) || 'id';
  return Math.random().toString(36).slice(2, 10);
}

async function handleActionMock(action: string, params: Record<string, unknown>): Promise<StripeServiceResponse> {
  console.log('stripeService mock', action, params);
  switch (action) {
    case 'createCustomer': {
      const email = (params.email as string) ?? 'mock@example.com';
      const customerId = `cus_mock_${shortId(email)}`;
      return { success: true, data: { customerId } };
    }
    case 'attachPaymentMethod': {
      const { customerId: _cid, paymentMethodId } = params as { customerId: string; paymentMethodId: string };
      if (!_cid || !paymentMethodId) {
        return { success: false, error: 'attachPaymentMethod requires customerId and paymentMethodId' };
      }
      return {
        success: true,
        data: { paymentMethodId, last4: '4242', brand: 'visa' },
      };
    }
    case 'detachPaymentMethod': {
      const pmId = params.paymentMethodId as string;
      if (!pmId) return { success: false, error: 'detachPaymentMethod requires paymentMethodId' };
      return { success: true, data: undefined };
    }
    case 'createPaymentIntent': {
      const piParams = params as { idempotencyKey?: string };
      const key = piParams.idempotencyKey ?? shortId();
      return {
        success: true,
        data: {
          paymentIntentId: `pi_mock_${key}`,
          clientSecret: `secret_mock_${key}`,
          status: 'succeeded',
        } as PaymentIntentResult,
      };
    }
    case 'getPaymentIntent': {
      const paymentIntentId = params.paymentIntentId as string;
      if (!paymentIntentId) return { success: false, error: 'getPaymentIntent requires paymentIntentId' };
      return {
        success: true,
        data: { status: 'succeeded', amount: 0 },
      };
    }
    case 'createRefund': {
      const { paymentIntentId, amount } = params as { paymentIntentId: string; amount?: number };
      if (!paymentIntentId) return { success: false, error: 'createRefund requires paymentIntentId' };
      const refundAmount = amount ?? 0;
      return {
        success: true,
        data: {
          refundId: `re_mock_${shortId(paymentIntentId)}`,
          status: 'succeeded',
          amount: refundAmount,
        },
      };
    }
    case 'getBalanceTransactions':
      return { success: true, data: [] };
    case 'submitDisputeEvidence': {
      const { disputeId, evidence } = params as { disputeId: string; evidence: Evidence };
      if (!disputeId || !evidence) {
        return { success: false, error: 'submitDisputeEvidence requires disputeId and evidence' };
      }
      return { success: true, data: undefined };
    }
    case 'verifyWebhookSignature': {
      const payload = params.payload;
      const signature = params.signature;
      if (payload === undefined || signature === undefined) {
        return { success: false, error: 'verifyWebhookSignature requires payload and signature' };
      }
      return { success: true, data: { valid: true } };
    }
    default:
      return { success: false, error: `Unknown action: ${action}` };
  }
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

function isApiGatewayEvent(event: unknown): event is APIGatewayProxyEvent {
  return typeof event === 'object' && event !== null && 'body' in event && 'requestContext' in event;
}

async function handleAction(action: string, params: Record<string, unknown> | null | undefined): Promise<StripeServiceResponse> {
  if (!action || params === null || params === undefined || typeof params !== 'object') {
    return { success: false, error: 'Missing action or params' };
  }
  if (useMock()) {
    return handleActionMock(action, params);
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
      case 'createRefund': {
        const { paymentIntentId, amount } = params as { paymentIntentId: string; amount?: number };
        if (!paymentIntentId) return { success: false, error: 'createRefund requires paymentIntentId' };
        const stripe = getAdapter();
        const data = await stripe.createRefund(paymentIntentId, amount);
        return { success: true, data: data as RefundResult };
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
}

async function stripeServiceHandler(event: APIGatewayProxyEvent | StripeServiceInvokePayload): Promise<APIGatewayProxyResult | StripeServiceResponse> {
  if (isApiGatewayEvent(event)) {
    if (apiKey) {
      const headerKey = event.headers['X-Api-Key'] ?? event.headers['x-api-key'] ?? '';
      if (headerKey !== apiKey) {
        return {
          statusCode: 401,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'Unauthorized' }),
        };
      }
    }
    let body: StripeServiceInvokePayload;
    try {
      body = JSON.parse(event.body ?? '{}') as StripeServiceInvokePayload;
    } catch {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Invalid JSON body' }),
      };
    }
    const { action, params } = body;
    const result = await handleAction(action, params ?? {});
    let statusCode = 200;
    if (!result.success && result.error) {
      statusCode = (result.error.includes('not set') || result.error.includes('STRIPE_')) ? 500 : 400;
    }
    return {
      statusCode,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    };
  }

  const { action, params } = event;
  return handleAction(action, params ?? null);
}

export const handler = withMiddyHttp(stripeServiceHandler as (event: APIGatewayProxyEvent, context: unknown) => Promise<APIGatewayProxyResult | StripeServiceResponse>, 'stripeService');
