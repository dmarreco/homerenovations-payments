import type { APIGatewayProxyHandler } from 'aws-lambda';
import Stripe from 'stripe';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { getConfig } from '../lib/config';
import { createStripeServiceClient } from '../adapters/stripeServiceClient';
import { getPayment, settlePayment, failPayment } from '../domain/payments/payments';
import { appendEvent } from '../domain/ledger/ledger';

export const handler: APIGatewayProxyHandler = async (event) => {
  const config = getConfig();
  const signature = event.headers['Stripe-Signature'] ?? event.headers['stripe-signature'] ?? '';
  const payload = event.body ?? '';
  if (!config.stripeServiceUrl) {
    console.error('Stripe service not configured');
    return { statusCode: 500, body: '' };
  }
  const stripe = createStripeServiceClient(config.stripeServiceUrl, config.stripeServiceApiKey);
  const valid = await stripe.verifyWebhookSignature(payload, signature);
  if (!valid) {
    return { statusCode: 400, body: 'Invalid signature' };
  }
  let parsed: Stripe.Event;
  try {
    parsed = JSON.parse(payload) as Stripe.Event;
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }
  const ledgerConfig = { tableName: config.ledgerTableName };
  const paymentsConfig = { tableName: config.paymentsTableName };

  try {
    switch (parsed.type) {
      case 'payment_intent.succeeded': {
        const pi = parsed.data.object as Stripe.PaymentIntent;
        const paymentId = pi.metadata?.paymentId;
        if (!paymentId) {
          console.warn('payment_intent.succeeded without paymentId in metadata', pi.id);
          return { statusCode: 200, body: 'OK' };
        }
        const payment = await getPayment(paymentId, paymentsConfig);
        if (!payment) {
          console.warn('Payment not found', paymentId);
          return { statusCode: 200, body: 'OK' };
        }
        if (payment.status === 'SETTLED') {
          return { statusCode: 200, body: 'OK' };
        }
        await settlePayment(paymentId, paymentsConfig);
        await appendEvent(
          payment.residentId,
          {
            eventType: 'PAYMENT_APPLIED',
            amount: -Math.abs(payment.amount),
            referenceId: paymentId,
            propertyId: (payment as any).propertyId,
            state: (payment as any).state,
          },
          ledgerConfig
        );
        break;
      }
      case 'payment_intent.payment_failed': {
        const pi = parsed.data.object as Stripe.PaymentIntent;
        const paymentId = pi.metadata?.paymentId;
        if (!paymentId) {
          return { statusCode: 200, body: 'OK' };
        }
        const declineMessage = (pi as any).last_payment_error?.message ?? 'Payment failed';
        const { retryCount } = await failPayment(paymentId, declineMessage, paymentsConfig);
        const payment = await getPayment(paymentId, paymentsConfig);
        const maxRetries = payment?.maxRetries ?? config.defaultPaymentMaxRetries;
        if (config.paymentRetryQueueUrl && retryCount < maxRetries) {
          const sqs = new SQSClient({});
          const delaySec = Math.min(config.paymentRetryMaxDelaySec, retryCount * config.paymentRetryBaseDelaySec);
          await sqs.send(
            new SendMessageCommand({
              QueueUrl: config.paymentRetryQueueUrl,
              MessageBody: JSON.stringify({ paymentId }),
              DelaySeconds: delaySec,
            })
          );
        }
        break;
      }
      case 'charge.dispute.created': {
        if (!config.disputesTableName) break;
        const dispute = parsed.data.object as Stripe.Dispute;
        const { putItem } = await import('../lib/dynamodb');
        await putItem(config.disputesTableName, {
          PK: `DISPUTE#${dispute.id}`,
          SK: 'METADATA',
          stripeDisputeId: dispute.id,
          residentId: (dispute.metadata as any)?.residentId ?? '',
          paymentId: (dispute.metadata as any)?.paymentId ?? '',
          status: 'OPEN',
          amount: dispute.amount,
          createdAt: new Date().toISOString(),
        });
        break;
      }
      case 'charge.dispute.closed': {
        if (!config.disputesTableName) break;
        const dispute = parsed.data.object as Stripe.Dispute;
        const { getItem, updateItem } = await import('../lib/dynamodb');
        const existing = await getItem<{ residentId: string }>(
          config.disputesTableName,
          { PK: `DISPUTE#${dispute.id}`, SK: 'METADATA' }
        );
        const status = dispute.status === 'won' ? 'WON' : 'LOST';
        await updateItem(
          config.disputesTableName,
          { PK: `DISPUTE#${dispute.id}`, SK: 'METADATA' },
          'SET #status = :status, resolvedAt = :now',
          { '#status': 'status' },
          { ':status': status, ':now': new Date().toISOString() }
        );
        if (status === 'LOST' && existing?.residentId) {
          await appendEvent(
            existing.residentId,
            {
              eventType: 'CHARGEBACK_APPLIED',
              amount: dispute.amount,
              referenceId: dispute.id,
            },
            ledgerConfig
          );
        }
        break;
      }
      default:
        break;
    }
    return { statusCode: 200, body: 'OK' };
  } catch (err) {
    console.error('stripeWebhookHandler', err);
    return { statusCode: 500, body: '' };
  }
};
