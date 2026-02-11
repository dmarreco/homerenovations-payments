/**
 * Notification sender port.
 */

export interface SendEmailParams {
  to: string;
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
}

export interface NotificationSenderPort {
  sendEmail(params: SendEmailParams): Promise<void>;
}
