import type { APIGatewayProxyHandler } from 'aws-lambda';
import { getConfig } from '../lib/config';
import { appendEvent, ensureLedgerInitialized } from '../domain/ledger/ledger';

export const handler: APIGatewayProxyHandler = async (event) => {
  const residentId = event.pathParameters?.residentId;
  if (!residentId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing residentId' }) };
  }
  let body: { amount: number; chargeType: string; description?: string; dueDate?: string; propertyId?: string; state?: string };
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }
  if (body.amount == null || body.amount <= 0 || !body.chargeType) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Body must include amount and chargeType (RENT|DEPOSIT|UTILITY|LATE_FEE|OTHER)' }) };
  }
  const config = getConfig();
  try {
    await ensureLedgerInitialized(residentId, { tableName: config.ledgerTableName });
    const { version } = await appendEvent(
      residentId,
      {
        eventType: 'CHARGE_POSTED',
        amount: body.amount,
        chargeType: body.chargeType as any,
        description: body.description,
        propertyId: body.propertyId,
        state: body.state,
      },
      { tableName: config.ledgerTableName }
    );
    return {
      statusCode: 201,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version, message: 'Charge posted' }),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to post charge';
    console.error('postCharge', err);
    return { statusCode: 500, body: JSON.stringify({ error: message }) };
  }
};
