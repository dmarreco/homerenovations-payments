import type { APIGatewayProxyHandler } from 'aws-lambda';
import { getConfig } from '../lib/config';
import { deleteItem } from '../lib/dynamodb';

const AUTOPAY_PK_PREFIX = 'RESIDENT#';

export const handler: APIGatewayProxyHandler = async (event) => {
  const residentId = event.pathParameters?.residentId;
  if (!residentId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing residentId' }) };
  }
  const config = getConfig();
  if (!config.autopayTableName) {
    return { statusCode: 503, body: JSON.stringify({ error: 'Autopay not configured' }) };
  }
  await deleteItem(config.autopayTableName, {
    PK: `${AUTOPAY_PK_PREFIX}${residentId}`,
    SK: 'AUTOPAY',
  });
  return { statusCode: 204, body: '' };
};
