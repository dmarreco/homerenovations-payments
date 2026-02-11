import type { APIGatewayProxyHandler } from 'aws-lambda';
import { getConfig } from '../lib/config';
import { getItem, updateItem } from '../lib/dynamodb';
import { createStripeServiceClient } from '../adapters/stripeServiceClient';

export const handler: APIGatewayProxyHandler = async (event) => {
  const disputeId = event.pathParameters?.disputeId;
  if (!disputeId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing disputeId' }) };
  }
  let body: { evidenceUrl?: string; submit?: boolean };
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }
  const config = getConfig();
  if (!config.disputesTableName || !config.stripeServiceFunctionName) {
    return { statusCode: 503, body: JSON.stringify({ error: 'Disputes not configured' }) };
  }
  const record = await getItem<{ stripeDisputeId: string; status: string }>(
    config.disputesTableName,
    { PK: `DISPUTE#${disputeId}`, SK: 'METADATA' }
  );
  if (!record) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Dispute not found' }) };
  }
  if (body.evidenceUrl) {
    await updateItem(
      config.disputesTableName,
      { PK: `DISPUTE#${disputeId}`, SK: 'METADATA' },
      'SET evidenceUrl = :url, #status = :status',
      { '#status': 'status' },
      { ':url': body.evidenceUrl, ':status': 'UNDER_REVIEW' }
    );
  }
  if (body.submit) {
    const stripe = createStripeServiceClient(config.stripeServiceFunctionName);
    await stripe.submitDisputeEvidence(record.stripeDisputeId, {
      customer_communication: body.evidenceUrl,
    });
    await updateItem(
      config.disputesTableName,
      { PK: `DISPUTE#${disputeId}`, SK: 'METADATA' },
      'SET #status = :status',
      { '#status': 'status' },
      { ':status': 'UNDER_REVIEW' }
    );
  }
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ disputeId, message: 'Updated' }),
  };
};
