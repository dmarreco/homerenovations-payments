import type { APIGatewayProxyHandler } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import { getConfig } from '../lib/config';
import { createStripeServiceClient } from '../adapters/stripeServiceClient';
import { putItem, getItem } from '../lib/dynamodb';
import { paymentMethodPk, paymentMethodSk } from '../types/tables';
import { ensureLedgerInitialized } from '../domain/ledger/ledger';

export const handler: APIGatewayProxyHandler = async (event) => {
  const residentId = event.pathParameters?.residentId;
  if (!residentId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing residentId' }) };
  }
  let body: { type: 'ach' | 'card'; paymentMethodId: string };
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }
  if (!body.paymentMethodId || !body.type) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Body must include type and paymentMethodId (from Stripe Elements)' }) };
  }
  const config = getConfig();
  if (!config.stripeServiceFunctionName) {
    return { statusCode: 503, body: JSON.stringify({ error: 'Stripe service not configured' }) };
  }
  const stripe = createStripeServiceClient(config.stripeServiceFunctionName);
  const now = new Date().toISOString();
  const methodId = uuidv4();

  try {
    let customerId: string;
    const customerRecord = await getItem<{ stripeCustomerId: string }>(
      config.paymentMethodsTableName,
      { PK: paymentMethodPk(residentId), SK: 'CUSTOMER' }
    );
    if (customerRecord?.stripeCustomerId) {
      customerId = customerRecord.stripeCustomerId;
    } else {
      const created = await stripe.createCustomer({ email: `${residentId}@resident.sfr3` });
      customerId = created.customerId;
      await putItem(config.paymentMethodsTableName, {
        PK: paymentMethodPk(residentId),
        SK: 'CUSTOMER',
        stripeCustomerId: customerId,
      });
    }
    const attached = await stripe.attachPaymentMethod(customerId, body.paymentMethodId);
    await putItem(config.paymentMethodsTableName, {
      PK: paymentMethodPk(residentId),
      SK: paymentMethodSk(methodId),
      type: body.type === 'ach' ? 'ACH' : 'CARD',
      stripePaymentMethodId: attached.paymentMethodId,
      last4: attached.last4,
      label: attached.brand ? `${attached.brand} ****${attached.last4}` : `****${attached.last4}`,
      isDefault: true,
      createdAt: now,
    });
    await ensureLedgerInitialized(residentId, { tableName: config.ledgerTableName });
    return {
      statusCode: 201,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ methodId, message: 'Payment method added' }),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to add payment method';
    console.error('enrollPaymentMethod', err);
    return { statusCode: 500, body: JSON.stringify({ error: message }) };
  }
};
