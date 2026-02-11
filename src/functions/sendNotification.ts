import type { EventBridgeEvent } from 'aws-lambda';
import { getConfig } from '../lib/config';
import { createSesAdapter } from '../adapters/sesAdapter';
import type { DomainEvent } from '../types/events';
import { withMiddy } from '../lib/middyMiddlewares';

async function sendNotificationHandler(event: EventBridgeEvent<string, DomainEvent>): Promise<void> {
  const detail = event.detail;
  const config = getConfig();
  if (!config.fromEmail) return;
  const ses = createSesAdapter(config.fromEmail);
  const residentId = detail.data?.residentId;
  const to: string = (detail.data?.email as string) ?? `${residentId}@resident.sfr3`;
  let subject = 'SFR3 Payment';
  let bodyText = '';
  switch (detail.eventType) {
    case 'payment.settled':
      subject = 'Payment received';
      bodyText = `Your payment of ${detail.data?.currency ?? 'USD'} ${((detail.data?.amount ?? 0) / 100).toFixed(2)} has been received. Payment ID: ${detail.data?.paymentId ?? 'N/A'}.`;
      break;
    case 'payment.failed':
      subject = 'Payment failed';
      bodyText = `Your payment of ${detail.data?.currency ?? 'USD'} ${((detail.data?.amount ?? 0) / 100).toFixed(2)} could not be processed. Reason: ${detail.data?.failureReason ?? 'Unknown'}. Please update your payment method.`;
      break;
    case 'charge.posted':
      subject = 'New charge on your account';
      bodyText = `A charge of ${detail.data?.currency ?? 'USD'} ${((detail.data?.amount ?? 0) / 100).toFixed(2)} has been posted to your account. ${detail.data?.description ?? ''}`;
      break;
    case 'late_fee.applied':
      subject = 'Late fee applied';
      bodyText = `A late fee of ${detail.data?.currency ?? 'USD'} ${((detail.data?.amount ?? 0) / 100).toFixed(2)} has been applied to your account.`;
      break;
    default:
      return;
  }
  try {
    await ses.sendEmail({ to, subject, bodyText });
  } catch (err) {
    console.error('sendNotification', err);
    throw err;
  }
}

export const handler = withMiddy(sendNotificationHandler, 'sendNotification');
