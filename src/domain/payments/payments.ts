/**
 * Payment lifecycle: initiate, settle, fail.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { PaymentRecord } from '../../types/tables';
import { paymentPk } from '../../types/tables';

export interface InitiatePaymentParams {
  paymentId: string;
  residentId: string;
  amount: number;
  currency: string;
  paymentMethodId: string;
  paymentMethodType: string;
  stripePaymentIntentId: string;
  maxRetries?: number;
}

export interface PaymentRepositoryConfig {
  tableName: string;
  client?: DynamoDBClient;
}

let docClient: DynamoDBDocumentClient | null = null;

function getClient(config: PaymentRepositoryConfig): DynamoDBDocumentClient {
  if (docClient) return docClient;
  const client = config.client ?? new DynamoDBClient({});
  docClient = DynamoDBDocumentClient.from(client, {
    marshallOptions: { convertEmptyValues: false, removeUndefinedValues: true },
  });
  return docClient;
}

export async function initiatePayment(
  params: InitiatePaymentParams,
  config: PaymentRepositoryConfig
): Promise<PaymentRecord> {
  const client = getClient(config);
  const now = new Date().toISOString();
  const record: PaymentRecord = {
    PK: paymentPk(params.paymentId),
    SK: 'METADATA',
    residentId: params.residentId,
    createdAt: now,
    amount: params.amount,
    currency: params.currency,
    status: 'PENDING',
    paymentMethodId: params.paymentMethodId,
    paymentMethodType: params.paymentMethodType as 'ACH' | 'CARD' | 'WALLET',
    stripePaymentIntentId: params.stripePaymentIntentId,
    retryCount: 0,
    maxRetries: params.maxRetries ?? 3,
  };
  await client.send(
    new PutCommand({
      TableName: config.tableName,
      Item: record as unknown as Record<string, unknown>,
      ConditionExpression: 'attribute_not_exists(PK)',
    })
  );
  return record;
}

export async function getPayment(paymentId: string, config: PaymentRepositoryConfig): Promise<PaymentRecord | null> {
  const client = getClient(config);
  const result = await client.send(
    new GetCommand({
      TableName: config.tableName,
      Key: { PK: paymentPk(paymentId), SK: 'METADATA' },
    })
  );
  return (result.Item as PaymentRecord) ?? null;
}

export async function settlePayment(paymentId: string, config: PaymentRepositoryConfig): Promise<void> {
  const client = getClient(config);
  await client.send(
    new UpdateCommand({
      TableName: config.tableName,
      Key: { PK: paymentPk(paymentId), SK: 'METADATA' },
      UpdateExpression: 'SET #status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'SETTLED', ':pending': 'PENDING' },
      ConditionExpression: 'attribute_exists(PK) AND #status = :pending',
    })
  );
}

export async function failPayment(
  paymentId: string,
  reason: string,
  config: PaymentRepositoryConfig
): Promise<{ retryCount: number }> {
  const client = getClient(config);
  const payment = await getPayment(paymentId, config);
  if (!payment) throw new Error('Payment not found');
  const newRetryCount = (payment.retryCount ?? 0) + 1;
  await client.send(
    new UpdateCommand({
      TableName: config.tableName,
      Key: { PK: paymentPk(paymentId), SK: 'METADATA' },
      UpdateExpression: 'SET #status = :status, retryCount = :retryCount, failureReason = :reason',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': 'FAILED',
        ':retryCount': newRetryCount,
        ':reason': reason,
      },
      ConditionExpression: 'attribute_exists(PK)',
    })
  );
  return { retryCount: newRetryCount };
}

export async function setReceiptUrl(paymentId: string, receiptUrl: string, config: PaymentRepositoryConfig): Promise<void> {
  const client = getClient(config);
  await client.send(
    new UpdateCommand({
      TableName: config.tableName,
      Key: { PK: paymentPk(paymentId), SK: 'METADATA' },
      UpdateExpression: 'SET receiptUrl = :url',
      ExpressionAttributeValues: { ':url': receiptUrl },
      ConditionExpression: 'attribute_exists(PK)',
    })
  );
}
