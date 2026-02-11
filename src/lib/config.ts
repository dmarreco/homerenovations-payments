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

function parseIntEnv(key: string, defaultValue: number): number {
  const v = process.env[key];
  if (v === undefined || v === '') return defaultValue;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? defaultValue : n;
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
  stripeServiceUrl: string;
  stripeServiceApiKey: string;
  fromEmail: string;
  // Configurable business/operational constants (env with defaults)
  lateFeeGraceDays: number;
  lateFeeAmountCents: number;
  ledgerSnapshotInterval: number;
  ledgerAppendMaxRetries: number;
  defaultPaymentMaxRetries: number;
  paymentRetryBaseDelaySec: number;
  paymentRetryMaxDelaySec: number;
  receiptUrlExpiresSec: number;
  firehoseBatchSize: number;
  getHistoryDefaultLimit: number;
  getHistoryMaxLimit: number;
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
    stripeServiceUrl: getEnv('STRIPE_SERVICE_URL'),
    stripeServiceApiKey: getEnv('STRIPE_SERVICE_API_KEY'),
    fromEmail: getEnv('FROM_EMAIL', 'noreply@example.com'),
    lateFeeGraceDays: parseIntEnv('LATE_FEE_GRACE_DAYS', 5),
    lateFeeAmountCents: parseIntEnv('LATE_FEE_AMOUNT_CENTS', 75),
    ledgerSnapshotInterval: parseIntEnv('LEDGER_SNAPSHOT_INTERVAL', 10),
    ledgerAppendMaxRetries: parseIntEnv('LEDGER_APPEND_MAX_RETRIES', 5),
    defaultPaymentMaxRetries: parseIntEnv('DEFAULT_PAYMENT_MAX_RETRIES', 3),
    paymentRetryBaseDelaySec: parseIntEnv('PAYMENT_RETRY_BASE_DELAY_SEC', 300),
    paymentRetryMaxDelaySec: parseIntEnv('PAYMENT_RETRY_MAX_DELAY_SEC', 900),
    receiptUrlExpiresSec: parseIntEnv('RECEIPT_URL_EXPIRES_SEC', 300),
    firehoseBatchSize: parseIntEnv('FIREHOSE_BATCH_SIZE', 500),
    getHistoryDefaultLimit: parseIntEnv('GET_HISTORY_DEFAULT_LIMIT', 50),
    getHistoryMaxLimit: parseIntEnv('GET_HISTORY_MAX_LIMIT', 100),
  };
}
