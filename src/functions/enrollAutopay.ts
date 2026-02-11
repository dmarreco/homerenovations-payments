import type { APIGatewayProxyHandler } from 'aws-lambda';
import { getConfig } from '../lib/config';
import { putItem } from '../lib/dynamodb';

const AUTOPAY_PK_PREFIX = 'RESIDENT#';

export const handler: APIGatewayProxyHandler = async (event) => {
  const residentId = event.pathParameters?.residentId;
  if (!residentId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing residentId' }) };
  }
  let body: { paymentMethodId: string; chargeDay: number };
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }
  if (!body.paymentMethodId || body.chargeDay == null || body.chargeDay < 1 || body.chargeDay > 28) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Body must include paymentMethodId and chargeDay (1-28)' }) };
  }
  const config = getConfig();
  if (!config.autopayTableName) {
    return { statusCode: 503, body: JSON.stringify({ error: 'Autopay not configured' }) };
  }
  const now = new Date().toISOString();
  await putItem(config.autopayTableName, {
    PK: `${AUTOPAY_PK_PREFIX}${residentId}`,
    SK: 'AUTOPAY',
    paymentMethodId: body.paymentMethodId,
    chargeDay: body.chargeDay,
    sweepGroup: 'AUTOPAY_ACTIVE',
    status: 'ACTIVE',
    createdAt: now,
  });
  return {
    statusCode: 201,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Autopay enrolled', chargeDay: body.chargeDay }),
  };
};
