/**
 * EventBridge publish helper for domain events.
 */

import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import type { DomainEvent } from '../types/events';

const client = new EventBridgeClient({});

export async function publishEvent(event: DomainEvent, eventBusName: string): Promise<void> {
  await client.send(
    new PutEventsCommand({
      Entries: [
        {
          Source: event.source,
          DetailType: event.eventType,
          Detail: JSON.stringify(event),
          EventBusName: eventBusName,
        },
      ],
    })
  );
}

export async function publishEvents(events: DomainEvent[], eventBusName: string): Promise<void> {
  if (events.length === 0) return;
  await client.send(
    new PutEventsCommand({
      Entries: events.map((event) => ({
        Source: event.source,
        DetailType: event.eventType,
        Detail: JSON.stringify(event),
        EventBusName: eventBusName,
      })),
    })
  );
}
