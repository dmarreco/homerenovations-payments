import type { ScheduledHandler } from 'aws-lambda';
import { getConfig } from '../lib/config';
import { appendEvent, rebuildState } from '../domain/ledger/ledger';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';

export const handler: ScheduledHandler = async () => {
  const config = getConfig();
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const today = new Date().toISOString().slice(0, 10);
  const result = await client.send(
    new ScanCommand({
      TableName: config.ledgerTableName,
      FilterExpression: 'type = :ev AND eventType = :ct',
      ExpressionAttributeValues: { ':ev': 'EVENT', ':ct': 'RENT' },
      ProjectionExpression: 'PK, #v, amount, timestamp',
      ExpressionAttributeNames: { '#v': 'SK' },
    })
  );
  const byResident = new Map<string, { amount: number; dueDate: string }[]>();
  for (const item of result.Items ?? []) {
    const pk = item.PK as string;
    if (!pk.startsWith('RESIDENT#')) continue;
    const residentId = pk.replace('RESIDENT#', '');
    if (!byResident.has(residentId)) byResident.set(residentId, []);
    byResident.get(residentId)!.push({
      amount: item.amount as number,
      dueDate: (item.timestamp as string).slice(0, 10),
    });
  }
  for (const [residentId, charges] of byResident) {
    const state = await rebuildState(residentId, { tableName: config.ledgerTableName });
    if (state.balance <= 0) continue;
    const hasRentDue = charges.some((c) => {
      const due = new Date(c.dueDate);
      due.setDate(due.getDate() + config.lateFeeGraceDays);
      return due.toISOString().slice(0, 10) < today;
    });
    if (hasRentDue) {
      await appendEvent(
        residentId,
        {
          eventType: 'LATE_FEE_APPLIED',
          amount: config.lateFeeAmountCents,
          chargeType: 'LATE_FEE',
          description: 'Late fee',
        },
        { tableName: config.ledgerTableName }
      );
    }
  }
};
