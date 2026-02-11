import type { APIGatewayProxyHandler } from 'aws-lambda';
import { getConfig } from '../lib/config';
import { createStripeServiceClient } from '../adapters/stripeServiceClient';
import { getPayment, refundPayment as refundPaymentDomain } from '../domain/payments/payments';
import { appendEvent } from '../domain/ledger/ledger';

export const handler: APIGatewayProxyHandler = async (event) => {
  const residentId = event.pathParameters?.residentId;
  const paymentId = event.pathParameters?.paymentId;
  if (!residentId || !paymentId) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Missing residentId or paymentId' }),
    };
  }

  const config = getConfig();
  if (!config.stripeServiceUrl) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Stripe service not configured' }),
    };
  }

  const paymentsConfig = { tableName: config.paymentsTableName };
  const ledgerConfig = { tableName: config.ledgerTableName };

  const payment = await getPayment(paymentId, paymentsConfig);
  if (!payment) {
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Payment not found' }),
    };
  }
  if (payment.residentId !== residentId) {
    return {
      statusCode: 403,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Forbidden' }),
    };
  }
  if (payment.status !== 'SETTLED') {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Payment is not settled; only settled payments can be refunded' }),
    };
  }
  const paymentIntentId = payment.stripePaymentIntentId;
  if (!paymentIntentId) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Payment has no Stripe payment intent' }),
    };
  }

  let body: { amount?: number } = {};
  try {
    if (event.body) body = JSON.parse(event.body) as { amount?: number };
  } catch {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid JSON body' }),
    };
  }

  const stripe = createStripeServiceClient(config.stripeServiceUrl, config.stripeServiceApiKey);
  let refundResult;
  try {
    refundResult = await stripe.createRefund(paymentIntentId, body.amount);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('createRefund failed', err);
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: `Refund failed: ${message}` }),
    };
  }

  try {
    await refundPaymentDomain(paymentId, paymentsConfig);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('ConditionalCheckFailed') || message.includes('condition')) {
      return {
        statusCode: 409,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Payment was already refunded or status changed' }),
      };
    }
    throw err;
  }

  await appendEvent(
    payment.residentId,
    {
      eventType: 'REFUND_APPLIED',
      amount: refundResult.amount,
      referenceId: paymentId,
      propertyId: (payment as { propertyId?: string }).propertyId,
      state: (payment as { state?: string }).state,
    },
    ledgerConfig
  );

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      paymentId,
      refundId: refundResult.refundId,
      status: refundResult.status,
      amount: refundResult.amount,
    }),
  };
};
