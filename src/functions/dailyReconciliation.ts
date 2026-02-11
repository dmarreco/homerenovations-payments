import type { ScheduledEvent } from 'aws-lambda';
import { getConfig } from '../lib/config';
import { createStripeServiceClient } from '../adapters/stripeServiceClient';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { withMiddy } from '../lib/middyMiddlewares';

async function dailyReconciliationHandler(_event: ScheduledEvent): Promise<void> {
  const config = getConfig();
  if (!config.stripeServiceUrl || !config.filesBucketName) return;
  const stripe = createStripeServiceClient(config.stripeServiceUrl, config.stripeServiceApiKey);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dayStr = yesterday.toISOString().slice(0, 10);
  const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const scanResult = await docClient.send(
    new ScanCommand({
      TableName: config.paymentsTableName,
      FilterExpression: '.#status = :status AND begins_with(createdAt, :day)',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': 'SETTLED',
        ':day': dayStr,
      },
    })
  );
  const internalPayments = (scanResult.Items ?? []).filter((i) => i.SK === 'METADATA');
  const matched: string[] = [];
  const mismatches: string[] = [];
  for (const p of internalPayments) {
    const stripeId = p.stripePaymentIntentId as string | undefined;
    if (!stripeId) continue;
    const st = await stripe.getPaymentIntent(stripeId);
    if (st && st.status === 'succeeded' && st.amount === p.amount) {
      matched.push(p.PK as string);
      await docClient.send(
        new UpdateCommand({
          TableName: config.paymentsTableName,
          Key: { PK: p.PK, SK: p.SK },
          UpdateExpression: 'SET reconciledAt = :t',
          ExpressionAttributeValues: { ':t': new Date().toISOString() },
        })
      );
    } else if (st && st.amount !== p.amount) {
      mismatches.push(`${p.PK}: amount ${p.amount} vs Stripe ${st.amount}`);
    } else {
      mismatches.push(`${p.PK}: not found or not succeeded in Stripe`);
    }
  }
  const report = [
    `Reconciliation ${dayStr}`,
    `Matched: ${matched.length}`,
    `Mismatches: ${mismatches.length}`,
    ...mismatches,
  ].join('\n');
  const s3 = new S3Client({});
  await s3.send(
    new PutObjectCommand({
      Bucket: config.filesBucketName,
      Key: `reconciliation/${dayStr}.txt`,
      Body: report,
      ContentType: 'text/plain',
    })
  );
}

export const handler = withMiddy(dailyReconciliationHandler, 'dailyReconciliation');
