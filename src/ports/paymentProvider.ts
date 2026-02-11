/**
 * Payment provider port (architecture Section 8.1).
 */

export interface CreateCustomerParams {
  email: string;
  name?: string;
}

export interface CustomerResult {
  customerId: string;
}

export interface MethodResult {
  paymentMethodId: string;
  last4?: string;
  brand?: string;
}

export interface PaymentIntentParams {
  amount: number; // cents
  currency: string;
  paymentMethodId: string;
  customerId?: string;
  idempotencyKey?: string;
  metadata?: Record<string, string>;
}

export interface PaymentIntentResult {
  paymentIntentId: string;
  clientSecret: string;
  status: string;
}

export interface DateRangeParams {
  from: number; // Unix timestamp
  to: number;
}

export interface BalanceTransaction {
  id: string;
  amount: number;
  currency: string;
  type: string;
  created: number;
}

export interface Evidence {
  receipt?: string;
  customer_communication?: string;
  [key: string]: string | undefined;
}

export interface PaymentProviderPort {
  createCustomer(params: CreateCustomerParams): Promise<CustomerResult>;
  attachPaymentMethod(customerId: string, paymentMethodId: string): Promise<MethodResult>;
  detachPaymentMethod(paymentMethodId: string): Promise<void>;
  createPaymentIntent(params: PaymentIntentParams): Promise<PaymentIntentResult>;
  getBalanceTransactions(params: DateRangeParams): Promise<BalanceTransaction[]>;
  getPaymentIntent(paymentIntentId: string): Promise<{ status: string; amount: number } | null>;
  submitDisputeEvidence(disputeId: string, evidence: Evidence): Promise<void>;
  verifyWebhookSignature(payload: string, signature: string): Promise<boolean>;
}
