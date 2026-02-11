/**
 * Firehose put helper for analytics event stream.
 */

import { FirehoseClient, PutRecordCommand } from '@aws-sdk/client-firehose';
import type { DomainEvent } from '../types/events';

const client = new FirehoseClient({});

export async function putRecord(event: DomainEvent, deliveryStreamName: string): Promise<void> {
  const data = Buffer.from(JSON.stringify(event) + '\n', 'utf-8');
  await client.send(
    new PutRecordCommand({
      DeliveryStreamName: deliveryStreamName,
      Record: { Data: data },
    })
  );
}

export async function putRecords(
  events: DomainEvent[],
  deliveryStreamName: string,
  batchSize: number = 500
): Promise<void> {
  if (events.length === 0) return;
  const { PutRecordBatchCommand } = await import('@aws-sdk/client-firehose');
  const records = events.map((event) => ({
    Data: Buffer.from(JSON.stringify(event) + '\n', 'utf-8'),
  }));
  for (let i = 0; i < records.length; i += batchSize) {
    const chunk = records.slice(i, i + batchSize);
    await client.send(
      new PutRecordBatchCommand({
        DeliveryStreamName: deliveryStreamName,
        Records: chunk,
      })
    );
  }
}
