/**
 * SES adapter for transactional emails (SES v1 API).
 */

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import type { NotificationSenderPort, SendEmailParams } from '../ports/notificationSender';

export class SesAdapter implements NotificationSenderPort {
  constructor(private client: SESClient, private fromEmail: string) {}

  async sendEmail(params: SendEmailParams): Promise<void> {
    await this.client.send(
      new SendEmailCommand({
        Source: this.fromEmail,
        Destination: { ToAddresses: [params.to] },
        Message: {
          Subject: { Data: params.subject, Charset: 'UTF-8' },
          Body: {
            Text: { Data: params.bodyText ?? params.bodyHtml ?? '', Charset: 'UTF-8' },
            ...(params.bodyHtml && { Html: { Data: params.bodyHtml, Charset: 'UTF-8' } }),
          },
        },
      })
    );
  }
}

export function createSesAdapter(fromEmail: string, region?: string): SesAdapter {
  const client = new SESClient({ region: region ?? process.env.AWS_REGION });
  return new SesAdapter(client, fromEmail);
}
