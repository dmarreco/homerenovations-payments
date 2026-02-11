import type { ScheduledHandler } from 'aws-lambda';
import { getConfig } from '../lib/config';
import { queryItems } from '../lib/dynamodb';
import { rebuildState } from '../domain/ledger/ledger';
import { createStripeAdapter } from '../adapters/stripeAdapter';
import { getItem } from '../lib/dynamodb';
import { paymentMethodPk, paymentMethodSk } from '../types/tables';
import { initiatePayment } from '../domain/payments/payments';
import { v4 as uuidv4 } from 'uuid';

export const handler: ScheduledHandler = async () => {
  const config = getConfig();
  if (!config.autopayTableName || !config.stripeSecretKey) return;
  const dayOfMonth = new Date().getDate();
  const { items } = await queryItems<{ PK: string; paymentMethodId: string; status: string }>(
    config.autopayTableName,
    'sweepGroup = :sg AND chargeDay = :day',
    { ':sg': 'AUTOPAY_ACTIVE', ':day': dayOfMonth },
    { indexName: 'bySweepDay' }
  );
  const stripe = createStripeAdapter(config.stripeSecretKey);
  for (const enrollment of items.filter((i) => i.status === 'ACTIVE')) {
    const residentId = (enrollment.PK ?? '').replace('RESIDENT#', '');
    const state = await rebuildState(residentId, { tableName: config.ledgerTableName });
    if (state.balance <= 0) continue;
    const methodRecord = await getItem<{ stripePaymentMethodId: string; type: string }>(
      config.paymentMethodsTableName,
      { PK: enrollment.PK, SK: paymentMethodSk(enrollment.paymentMethodId) }
    );
    if (!methodRecord) continue;
    const customerRecord = await getItem<{ stripeCustomerId: string }>(
      config.paymentMethodsTableName,
      { PK: paymentMethodPk(residentId), SK: 'CUSTOMER' }
    );
    const paymentId = uuidv4();
    try {
      const intent = await stripe.createPaymentIntent({
        amount: state.balance,
        currency: 'usd',
        paymentMethodId: methodRecord.stripePaymentMethodId,
        customerId: customerRecord?.stripeCustomerId,
        idempotencyKey: paymentId,
        metadata: { paymentId, residentId, source: 'autopay' },
      });
      await initiatePayment(
        {
          paymentId,
          residentId,
          amount: state.balance,
          currency: 'usd',
          paymentMethodId: enrollment.paymentMethodId,
          paymentMethodType: methodRecord.type as 'ACH' | 'CARD' | 'WALLET',
          stripePaymentIntentId: intent.paymentIntentId,
        },
        { tableName: config.paymentsTableName }
      );
    } catch (err) {
      console.error('autopaySweep payment failed', residentId, err);
    }
  }
};
