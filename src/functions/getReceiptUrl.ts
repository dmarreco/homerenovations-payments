import type { APIGatewayProxyHandler } from 'aws-lambda';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getConfig } from '../lib/config';
import { getPayment } from '../domain/payments/payments';
import { paymentPk } from '../types/tables';

export const handler: APIGatewayProxyHandler = async (event) => {
  const residentId = event.pathParameters?.residentId;
  const paymentId = event.pathParameters?.paymentId;
  if (!residentId || !paymentId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing residentId or paymentId' }) };
  }
  const config = getConfig();
  const payment = await getPayment(paymentId, { tableName: config.paymentsTableName });
  if (!payment) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Payment not found' }) };
  }
  if (payment.residentId !== residentId) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
  }
  if (payment.status !== 'SETTLED' || !payment.receiptUrl) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Receipt not available' }) };
  }
  const key = payment.receiptUrl.startsWith('s3://')
    ? payment.receiptUrl.replace(`s3://${config.filesBucketName}/`, '')
    : payment.receiptUrl;
  const s3 = new S3Client({});
  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: config.filesBucketName, Key: key }),
    { expiresIn: 300 }
  );
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ receiptUrl: url, expiresIn: 300 }),
  };
};
