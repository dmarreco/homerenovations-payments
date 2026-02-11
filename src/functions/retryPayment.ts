import type { SQSHandler } from 'aws-lambda';
import { getConfig } from '../lib/config';
import { getPayment } from '../domain/payments/payments';
import { getItem } from '../lib/dynamodb';
import { paymentMethodPk, paymentMethodSk } from '../types/tables';
import { createStripeServiceClient } from '../adapters/stripeServiceClient';
import { initiatePayment } from '../domain/payments/payments';
import { v4 as uuidv4 } from 'uuid';

export const handler: SQSHandler = async (event) => {
  const config = getConfig();
  if (!config.stripeServiceUrl) return;
  const stripe = createStripeServiceClient(config.stripeServiceUrl, config.stripeServiceApiKey);
  for (const record of event.Records ?? []) {
    let body: { paymentId: string };
    try {
      body = JSON.parse(record.body);
    } catch {
      console.error('retryPayment invalid message body', record.body);
      continue;
    }
    const payment = await getPayment(body.paymentId, { tableName: config.paymentsTableName });
    if (!payment || payment.status !== 'FAILED') continue;
    if ((payment.retryCount ?? 0) >= (payment.maxRetries ?? 3)) continue;
    const methodRecord = await getItem<{ stripePaymentMethodId: string; type: string }>(
      config.paymentMethodsTableName,
      { PK: paymentMethodPk(payment.residentId), SK: paymentMethodSk(payment.paymentMethodId!) }
    );
    if (!methodRecord) continue;
    const customerRecord = await getItem<{ stripeCustomerId: string }>(
      config.paymentMethodsTableName,
      { PK: paymentMethodPk(payment.residentId), SK: 'CUSTOMER' }
    );
    const newPaymentId = uuidv4();
    try {
      const intent = await stripe.createPaymentIntent({
        amount: payment.amount,
        currency: payment.currency,
        paymentMethodId: methodRecord.stripePaymentMethodId,
        customerId: customerRecord?.stripeCustomerId,
        idempotencyKey: newPaymentId,
        metadata: { paymentId: newPaymentId, residentId: payment.residentId, retryOf: body.paymentId },
      });
      await initiatePayment(
        {
          paymentId: newPaymentId,
          residentId: payment.residentId,
          amount: payment.amount,
          currency: payment.currency,
          paymentMethodId: payment.paymentMethodId!,
          paymentMethodType: methodRecord.type as 'ACH' | 'CARD' | 'WALLET',
          stripePaymentIntentId: intent.paymentIntentId,
          maxRetries: payment.maxRetries,
        },
        { tableName: config.paymentsTableName }
      );
    } catch (err) {
      console.error('retryPayment failed', body.paymentId, err);
      throw err;
    }
  }
};
