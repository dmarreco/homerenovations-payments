import type { EventBridgeEvent } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import PDFDocument from 'pdfkit';
import { getConfig } from '../lib/config';
import { setReceiptUrl } from '../domain/payments/payments';
import type { DomainEvent } from '../types/events';
import { withMiddy } from '../lib/middyMiddlewares';

async function generateReceiptHandler(event: EventBridgeEvent<string, DomainEvent>): Promise<void> {
  const detail = event.detail;
  const paymentId = detail.data?.paymentId;
  const residentId = detail.data?.residentId;
  const amount = detail.data?.amount;
  const currency = detail.data?.currency ?? 'USD';
  if (!paymentId || !residentId || amount == null) {
    console.warn('generateReceipt: missing paymentId, residentId or amount', detail);
    return;
  }
  const config = getConfig();
  if (!config.filesBucketName) return;
  const key = `receipts/${residentId}/${paymentId}.pdf`;
  const s3 = new S3Client({});
  const doc = new PDFDocument({ size: 'A4' });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(20).text('Payment Receipt', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Payment ID: ${paymentId}`);
    doc.text(`Resident ID: ${residentId}`);
    doc.text(`Amount: ${currency} ${(amount / 100).toFixed(2)}`);
    doc.text(`Date: ${new Date().toISOString()}`);
    doc.end();
  });
  await s3.send(
    new PutObjectCommand({
      Bucket: config.filesBucketName,
      Key: key,
      Body: pdfBuffer,
      ContentType: 'application/pdf',
    })
  );
  await setReceiptUrl(paymentId, key, { tableName: config.paymentsTableName });
}

export const handler = withMiddy(generateReceiptHandler, 'generateReceipt');
