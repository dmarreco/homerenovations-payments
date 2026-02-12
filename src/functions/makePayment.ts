import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { getConfig } from '../lib/config';
import { createStripeServiceClient } from '../adapters/stripeServiceClient';
import { getItem } from '../lib/dynamodb';
import { paymentMethodPk, paymentMethodSk } from '../types/tables';
import { initiatePayment } from '../domain/payments/payments';
import { rebuildState } from '../domain/ledger/ledger';
import { withMiddyHttp } from '../lib/middyMiddlewares';

async function makePaymentHandler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
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

    // When STRIPE_MOCK=true, fire a fake webhook so Ledger gets PAYMENT_APPLIED (e2e demo)
    const stripeMock = process.env.STRIPE_MOCK === 'true' || process.env.STRIPE_MOCK === '1';
    const webhookHandlerName = process.env.STRIPE_WEBHOOK_HANDLER_NAME;
    if (stripeMock && webhookHandlerName) {
      const fakeStripeEvent = {
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: intent.paymentIntentId,
            metadata: { paymentId, residentId },
          },
        },
      };
      const webhookPayload = {
        body: JSON.stringify(fakeStripeEvent),
        headers: { 'Stripe-Signature': 'mock', 'stripe-signature': 'mock' },
      };
      try {
        const lambda = new LambdaClient({});
        await lambda.send(
          new InvokeCommand({
            FunctionName: webhookHandlerName,
            InvocationType: 'RequestResponse',
            Payload: JSON.stringify(webhookPayload),
          })
        );
      } catch (err) {
        console.error('makePayment: mock webhook invoke failed', err);
      }
    }

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
}

export const handler = withMiddyHttp(makePaymentHandler, 'makePayment');
