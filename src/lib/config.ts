/**
 * Environment config with validation.
 */

function getEnv(key: string, defaultValue?: string): string {
  return process.env[key] ?? defaultValue ?? '';
}

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env: ${key}`);
  return v;
}

export interface Config {
  stage: string;
  ledgerTableName: string;
  paymentsTableName: string;
  paymentMethodsTableName: string;
  autopayTableName: string;
  paymentRetryQueueUrl: string;
  disputesTableName: string;
  eventBusName: string;
  firehoseStreamName: string;
  filesBucketName: string;
  stripeServiceFunctionName: string;
  fromEmail: string;
}

export function getConfig(): Config {
  return {
    stage: getEnv('STAGE', 'dev'),
    ledgerTableName: requireEnv('LEDGER_TABLE'),
    paymentsTableName: requireEnv('PAYMENTS_TABLE'),
    paymentMethodsTableName: requireEnv('PAYMENT_METHODS_TABLE'),
    autopayTableName: getEnv('AUTOPAY_TABLE'),
    paymentRetryQueueUrl: getEnv('PAYMENT_RETRY_QUEUE_URL'),
    disputesTableName: getEnv('DISPUTES_TABLE'),
    eventBusName: getEnv('EVENT_BUS_NAME'),
    firehoseStreamName: getEnv('FIREHOSE_STREAM_NAME'),
    filesBucketName: getEnv('FILES_BUCKET'),
    stripeServiceFunctionName: getEnv('STRIPE_SERVICE_FUNCTION_NAME'),
    fromEmail: getEnv('FROM_EMAIL', 'noreply@example.com'),
  };
}
