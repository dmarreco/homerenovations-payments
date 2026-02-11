import type { APIGatewayProxyHandler } from 'aws-lambda';
import { getConfig } from '../lib/config';
import { queryItems } from '../lib/dynamodb';
import type { PaymentRecord } from '../types/tables';

export const handler: APIGatewayProxyHandler = async (event) => {
  const residentId = event.pathParameters?.residentId;
  if (!residentId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing residentId' }) };
  }
  const from = event.queryStringParameters?.from;
  const to = event.queryStringParameters?.to;
  const config = getConfig();
  const requestedLimit = parseInt(event.queryStringParameters?.limit ?? String(config.getHistoryDefaultLimit), 10) || config.getHistoryDefaultLimit;
  const limit = Math.min(requestedLimit, config.getHistoryMaxLimit);
  try {
    const { items, lastEvaluatedKey } = await queryItems<PaymentRecord>(
      config.paymentsTableName,
      'residentId = :residentId',
      { ':residentId': residentId },
      {
        indexName: 'byResident',
        scanIndexForward: false,
        limit,
        exclusiveStartKey: event.queryStringParameters?.nextToken
          ? JSON.parse(Buffer.from(event.queryStringParameters.nextToken, 'base64').toString())
          : undefined,
      }
    );
    const nextToken = lastEvaluatedKey
      ? Buffer.from(JSON.stringify(lastEvaluatedKey)).toString('base64')
      : undefined;
    const list = items
      .filter((i) => i.SK === 'METADATA')
      .map((p) => ({
        paymentId: p.PK.replace('PAYMENT#', ''),
        amount: p.amount,
        currency: p.currency,
        status: p.status,
        createdAt: p.createdAt,
        paymentMethodType: p.paymentMethodType,
      }));
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payments: list, nextToken }),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to get history';
    console.error('getHistory', err);
    return { statusCode: 500, body: JSON.stringify({ error: message }) };
  }
};
