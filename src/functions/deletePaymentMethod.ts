import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getConfig } from '../lib/config';
import { createStripeServiceClient } from '../adapters/stripeServiceClient';
import { getItem, deleteItem } from '../lib/dynamodb';
import { paymentMethodPk, paymentMethodSk } from '../types/tables';
import { withMiddyHttp } from '../lib/middyMiddlewares';

async function deletePaymentMethodHandler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const residentId = event.pathParameters?.residentId;
  const methodId = event.pathParameters?.methodId;
  if (!residentId || !methodId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing residentId or methodId' }) };
  }
  const config = getConfig();
  if (!config.stripeServiceUrl) {
    return { statusCode: 503, body: JSON.stringify({ error: 'Stripe service not configured' }) };
  }
  const record = await getItem<{ stripePaymentMethodId: string }>(
    config.paymentMethodsTableName,
    { PK: paymentMethodPk(residentId), SK: paymentMethodSk(methodId) }
  );
  if (!record) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Payment method not found' }) };
  }
  try {
    const stripe = createStripeServiceClient(config.stripeServiceUrl, config.stripeServiceApiKey);
    await stripe.detachPaymentMethod(record.stripePaymentMethodId);
    await deleteItem(config.paymentMethodsTableName, {
      PK: paymentMethodPk(residentId),
      SK: paymentMethodSk(methodId),
    });
    return { statusCode: 204, body: '' };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to remove payment method';
    console.error('deletePaymentMethod', err);
    return { statusCode: 500, body: JSON.stringify({ error: message }) };
  }
}

export const handler = withMiddyHttp(deletePaymentMethodHandler, 'deletePaymentMethod');
