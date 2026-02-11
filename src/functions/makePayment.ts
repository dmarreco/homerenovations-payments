import type { APIGatewayProxyHandler } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import { getConfig } from '../lib/config';
import { createStripeServiceClient } from '../adapters/stripeServiceClient';
import { getItem } from '../lib/dynamodb';
import { paymentMethodPk, paymentMethodSk } from '../types/tables';
import { initiatePayment } from '../domain/payments/payments';
import { rebuildState } from '../domain/ledger/ledger';

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
  if (!config.stripeServiceUrl) {
    return { statusCode: 503, body: JSON.stringify({ error: 'Stripe service not configured' }) };
  }
  const state = await rebuildState(residentId, { tableName: config.ledgerTableName });
  if (state.balance <= 0) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'No balance due' }),
    };
  }
  const amount = Math.round(body.amount);
  if (amount > state.balance) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Amount exceeds current balance', balance: state.balance }),
    };
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
  try {
    const stripe = createStripeServiceClient(config.stripeServiceUrl, config.stripeServiceApiKey);
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
        maxRetries: config.defaultPaymentMaxRetries,
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
        currentBalance: state.balance,
        balanceAfterPayment: state.balance - amount,
      }),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Payment failed';
    console.error('makePayment', err);
    return { statusCode: 500, body: JSON.stringify({ error: message }) };
  }
};
