import type { APIGatewayProxyHandler } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import { getConfig } from '../lib/config';
import { createStripeAdapter } from '../adapters/stripeAdapter';
import { getItem } from '../lib/dynamodb';
import { paymentMethodPk, paymentMethodSk } from '../types/tables';
import { initiatePayment } from '../domain/payments/payments';

export const handler: APIGatewayProxyHandler = async (event) => {
  const residentId = event.pathParameters?.residentId;
  if (!residentId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing residentId' }) };
  }
  let body: { amount: number; currency?: string; paymentMethodId: string };
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }
  if (body.amount == null || body.amount <= 0 || !body.paymentMethodId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Body must include amount (cents) and paymentMethodId' }) };
  }
  const config = getConfig();
  if (!config.stripeSecretKey) {
    return { statusCode: 503, body: JSON.stringify({ error: 'Stripe not configured' }) };
  }
  const methodRecord = await getItem<{ stripePaymentMethodId: string; type: string }>(
    config.paymentMethodsTableName,
    { PK: paymentMethodPk(residentId), SK: paymentMethodSk(body.paymentMethodId) }
  );
  if (!methodRecord) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Payment method not found' }) };
  }
  const paymentId = uuidv4();
  const currency = (body.currency ?? 'usd').toLowerCase();
  const amount = Math.round(body.amount);
  try {
    const stripe = createStripeAdapter(config.stripeSecretKey);
    const customerRecord = await getItem<{ stripeCustomerId: string }>(
      config.paymentMethodsTableName,
      { PK: paymentMethodPk(residentId), SK: 'CUSTOMER' }
    );
    const intent = await stripe.createPaymentIntent({
      amount,
      currency,
      paymentMethodId: methodRecord.stripePaymentMethodId,
      customerId: customerRecord?.stripeCustomerId,
      idempotencyKey: paymentId,
      metadata: { paymentId, residentId },
    });
    await initiatePayment(
      {
        paymentId,
        residentId,
        amount,
        currency,
        paymentMethodId: body.paymentMethodId,
        paymentMethodType: methodRecord.type as 'ACH' | 'CARD' | 'WALLET',
        stripePaymentIntentId: intent.paymentIntentId,
      },
      { tableName: config.paymentsTableName }
    );
    return {
      statusCode: 202,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paymentId,
        reference: intent.paymentIntentId,
        status: intent.status,
        clientSecret: intent.clientSecret,
      }),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Payment failed';
    console.error('makePayment', err);
    return { statusCode: 500, body: JSON.stringify({ error: message }) };
  }
};
