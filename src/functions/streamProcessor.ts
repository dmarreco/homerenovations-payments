import type { DynamoDBStreamEvent } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import { getConfig } from '../lib/config';
import { publishEvent } from '../lib/eventbridge';
import { putRecord } from '../lib/firehose';
import type { DomainEvent } from '../types/events';
import { ledgerEventTypeToDomainEventType } from '../types/events';
import type { LedgerEventRecord, LedgerSnapshotRecord } from '../types/tables';
import type { PaymentRecord } from '../types/tables';
import { withMiddy } from '../lib/middyMiddlewares';

function ledgerRecordToDomainEvent(
  newImage: Record<string, any>,
  source: string
): DomainEvent | null {
  if (newImage.type === 'SNAPSHOT') return null;
  const ev = newImage as LedgerEventRecord;
  const eventType = ledgerEventTypeToDomainEventType(ev.eventType);
  return {
    eventId: uuidv4(),
    eventType,
    source: source,
    timestamp: ev.timestamp ?? new Date().toISOString(),
    version: '1.0',
    data: {
      residentId: (ev.PK ?? '').replace('RESIDENT#', ''),
      propertyId: ev.propertyId,
      state: ev.state,
      amount: ev.amount ?? 0,
      currency: 'USD',
      chargeType: ev.chargeType,
      description: ev.description,
      referenceId: ev.referenceId,
    },
  };
}

function paymentRecordToDomainEvent(newImage: Record<string, any>): DomainEvent | null {
  const p = newImage as PaymentRecord;
  let eventType: DomainEvent['eventType'] = 'payment.initiated';
  if (p.status === 'SETTLED') eventType = 'payment.settled';
  else if (p.status === 'FAILED') eventType = 'payment.failed';
  else return null;
  return {
    eventId: uuidv4(),
    eventType,
    source: 'sfr3.payments',
    timestamp: p.createdAt ?? new Date().toISOString(),
    version: '1.0',
    data: {
      residentId: p.residentId,
      amount: p.amount,
      currency: p.currency ?? 'USD',
      paymentMethod: p.paymentMethodType,
      failureReason: p.failureReason,
      stripeRef: p.stripePaymentIntentId,
      paymentId: (p.PK ?? '').replace('PAYMENT#', ''),
    },
  };
}

async function streamProcessorHandler(event: DynamoDBStreamEvent): Promise<void> {
  const config = getConfig();
  const events: DomainEvent[] = [];
  for (const record of event.Records ?? []) {
    if (record.eventName !== 'INSERT' && record.eventName !== 'MODIFY') continue;
    const newImage = record.dynamodb?.NewImage;
    if (!newImage) continue;
    const unmarshalled = unmarshall(newImage);
    const tableArn = record.eventSourceARN ?? '';
    let domainEvent: DomainEvent | null = null;
    if (tableArn.includes('ledger')) {
      domainEvent = ledgerRecordToDomainEvent(unmarshalled, 'sfr3.ledger');
    } else if (tableArn.includes('payments')) {
      domainEvent = paymentRecordToDomainEvent(unmarshalled);
    }
    if (domainEvent) events.push(domainEvent);
  }
  for (const ev of events) {
    try {
      if (config.eventBusName) await publishEvent(ev, config.eventBusName);
    } catch (err) {
      console.error('streamProcessor publishEvent', err);
    }
    try {
      if (config.firehoseStreamName) await putRecord(ev, config.firehoseStreamName);
    } catch (err) {
      console.error('streamProcessor putRecord', err);
    }
  }
}

export const handler = withMiddy(streamProcessorHandler, 'streamProcessor');

function unmarshall(attr: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(attr)) {
    if (v?.S != null) out[k] = v.S;
    else if (v?.N != null) out[k] = parseFloat(v.N);
    else if (v?.BOOL != null) out[k] = v.BOOL;
    else if (v?.M != null) out[k] = unmarshall(v.M);
    else if (v?.L != null) out[k] = v.L.map((i: any) => (i.M ? unmarshall(i.M) : i));
  }
  return out;
}
