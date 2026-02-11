import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getConfig } from '../lib/config';
import { rebuildState } from '../domain/ledger/ledger';
import { withMiddyHttp } from '../lib/middyMiddlewares';

async function getBalanceHandler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const residentId = event.pathParameters?.residentId;
  if (!residentId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing residentId' }) };
  }
  const config = getConfig();
  try {
    const state = await rebuildState(residentId, { tableName: config.ledgerTableName });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        balance: state.balance,
        version: state.version,
        outstandingItems: state.outstandingItems,
      }),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to get balance';
    console.error('getBalance', err);
    return { statusCode: 500, body: JSON.stringify({ error: message }) };
  }
}

export const handler = withMiddyHttp(getBalanceHandler, 'getBalance');
