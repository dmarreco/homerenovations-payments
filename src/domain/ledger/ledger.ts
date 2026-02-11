/**
 * Event-sourced ledger: append, snapshot, rebuild (Burning Monk pattern).
 * Optimistic locking via attribute_not_exists(SK).
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { LedgerEventRecord, LedgerSnapshotRecord, LedgerRecord, OutstandingLedgerItem } from '../../types/tables';
import { ledgerPk, ledgerSk } from '../../types/tables';
import { getConfig } from '../../lib/config';
import { createSnapshotRecord } from './events';

export interface LedgerState {
  balance: number;
  version: number;
  outstandingItems: OutstandingLedgerItem[];
}

export interface LedgerConfig {
  tableName: string;
  client?: DynamoDBClient;
}

let docClient: DynamoDBDocumentClient | null = null;

function getClient(config: LedgerConfig): DynamoDBDocumentClient {
  if (docClient) return docClient;
  const client = config.client ?? new DynamoDBClient({});
  docClient = DynamoDBDocumentClient.from(client, {
    marshallOptions: { convertEmptyValues: false, removeUndefinedValues: true },
  });
  return docClient;
}

/**
 * Get current version for a resident (max SK in partition).
 * Query last item by SK descending.
 */
export async function getVersion(residentId: string, config: LedgerConfig): Promise<number> {
  const client = getClient(config);
  const pk = ledgerPk(residentId);
  const result = await client.send(
    new QueryCommand({
      TableName: config.tableName,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': pk },
      ScanIndexForward: false,
      Limit: 1,
      ProjectionExpression: 'SK',
    })
  );
  const item = result.Items?.[0];
  if (!item?.SK) return 0;
  const match = (item.SK as string).match(/^v(\d+)$/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Rebuild current state: find latest snapshot, then apply events after it.
 */
export async function rebuildState(residentId: string, config: LedgerConfig): Promise<LedgerState> {
  const client = getClient(config);
  const pk = ledgerPk(residentId);
  const snapshotInterval = getConfig().ledgerSnapshotInterval;
  // Fetch last N items (guaranteed to include at least one snapshot)
  const result = await client.send(
    new QueryCommand({
      TableName: config.tableName,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': pk },
      ScanIndexForward: false,
      Limit: snapshotInterval + 1,
    })
  );
  const items = (result.Items ?? []) as LedgerRecord[];
  if (items.length === 0) {
    return { balance: 0, version: 0, outstandingItems: [] };
  }

  let snapshotVersion = 0;
  let balance = 0;
  let outstandingItems: OutstandingLedgerItem[] = [];

  for (const item of items) {
    if (item.type === 'SNAPSHOT') {
      snapshotVersion = parseInt((item.SK as string).replace('v', ''), 10);
      balance = (item as LedgerSnapshotRecord).balance;
      outstandingItems = (item as LedgerSnapshotRecord).outstandingItems ?? [];
      break;
    }
  }

  // Apply events after snapshot (items are in reverse order, so we reverse for chronological)
  const eventsAfterSnapshot = items.filter(
    (i) => i.type === 'EVENT' && parseInt((i.SK as string).replace('v', ''), 10) > snapshotVersion
  );
  eventsAfterSnapshot.reverse(); // chronological order

  for (const item of eventsAfterSnapshot) {
    const ev = item as LedgerEventRecord;
    balance += ev.amount;
    if (ev.eventType === 'CHARGE_POSTED' || ev.eventType === 'LATE_FEE_APPLIED' || ev.eventType === 'CHARGEBACK_APPLIED') {
      outstandingItems = [...outstandingItems, {
        version: ev.SK,
        eventType: ev.eventType,
        amount: ev.amount,
        chargeType: ev.chargeType,
        description: ev.description,
      }];
    }
    if (ev.eventType === 'PAYMENT_APPLIED' || ev.eventType === 'CREDIT_APPLIED' || ev.eventType === 'REFUND_APPLIED') {
      const payAmount = Math.abs(ev.amount);
      let remaining = payAmount;
      outstandingItems = outstandingItems
        .map((o) => {
          if (remaining <= 0) return o;
          const deduct = Math.min(o.amount, remaining);
          remaining -= deduct;
          if (deduct >= o.amount) return null;
          return { ...o, amount: o.amount - deduct };
        })
        .filter((o): o is OutstandingLedgerItem => o !== null);
    }
  }

  const lastVersion = items[0]?.SK ? parseInt((items[0].SK as string).replace('v', ''), 10) : 0;
  return { balance, version: lastVersion, outstandingItems };
}

/**
 * Append an event with optimistic locking. Write snapshot every SNAPSHOT_INTERVAL.
 */
export async function appendEvent(
  residentId: string,
  event: Omit<LedgerEventRecord, 'PK' | 'SK' | 'type' | 'timestamp'>,
  config: LedgerConfig
): Promise<{ version: number }> {
  const client = getClient(config);
  const pk = ledgerPk(residentId);
  const appConfig = getConfig();
  const maxRetries = appConfig.ledgerAppendMaxRetries;
  const snapshotInterval = appConfig.ledgerSnapshotInterval;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const currentVersion = await getVersion(residentId, config);
    const nextVersion = currentVersion + 1;
    const sk = ledgerSk(nextVersion);
    const now = new Date().toISOString();

    const eventRecord: LedgerEventRecord = {
      PK: pk,
      SK: sk,
      type: 'EVENT',
      timestamp: now,
      ...event,
    };

    try {
      await client.send(
        new PutCommand({
          TableName: config.tableName,
          Item: eventRecord as unknown as Record<string, unknown>,
          ConditionExpression: 'attribute_not_exists(SK)',
        })
      );
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) {
        continue; // concurrent write, retry
      }
      throw err;
    }

    // Snapshot every snapshotInterval events
    if (nextVersion % snapshotInterval === 0) {
      const state = await rebuildState(residentId, config);
      const snapshot = createSnapshotRecord(residentId, nextVersion, state.balance, state.outstandingItems);
      await client.send(
        new PutCommand({
          TableName: config.tableName,
          Item: snapshot as unknown as Record<string, unknown>,
        })
      );
    }

    return { version: nextVersion };
  }

  throw new Error('Ledger append failed after optimistic locking retries');
}

/**
 * Ensure ledger has initial snapshot for a new resident (version 0).
 */
export async function ensureLedgerInitialized(residentId: string, config: LedgerConfig): Promise<void> {
  const v = await getVersion(residentId, config);
  if (v > 0) return;
  const client = getClient(config);
  const snapshot = createSnapshotRecord(residentId, 0, 0, []);
  await client.send(
    new PutCommand({
      TableName: config.tableName,
      Item: snapshot as unknown as Record<string, unknown>,
      ConditionExpression: 'attribute_not_exists(SK)',
    })
  );
}
