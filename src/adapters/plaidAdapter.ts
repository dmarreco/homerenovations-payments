/**
 * Plaid adapter for ACH bank account verification.
 */

import { PlaidApi, PlaidEnvironments, Configuration } from 'plaid';

export interface PlaidAccountDetails {
  accountId: string;
  mask?: string;
  name?: string;
  subtype?: string;
}

export interface PlaidAdapterConfig {
  clientId: string;
  secret: string;
  env?: 'sandbox' | 'development' | 'production';
}

let plaidClient: PlaidApi | null = null;

function getClient(config: PlaidAdapterConfig): PlaidApi {
  if (plaidClient) return plaidClient;
  const env = config.env ?? 'sandbox';
  const configuration = new Configuration({
    basePath: env === 'production' ? PlaidEnvironments.production : PlaidEnvironments.sandbox,
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': config.clientId,
        'PLAID-SECRET': config.secret,
      },
    },
  });
  plaidClient = new PlaidApi(configuration);
  return plaidClient;
}

/**
 * Exchange Plaid public_token for access_token.
 */
export async function exchangePublicToken(
  publicToken: string,
  config: PlaidAdapterConfig
): Promise<{ accessToken: string }> {
  const client = getClient(config);
  const response = await client.itemPublicTokenExchange({
    public_token: publicToken,
  });
  return { accessToken: response.data.access_token };
}

/**
 * Get account details for the first checking/savings account (for display and Stripe token).
 */
export async function getAccountDetails(
  accessToken: string,
  config: PlaidAdapterConfig
): Promise<PlaidAccountDetails[]> {
  const client = getClient(config);
  const response = await client.accountsGet({
    access_token: accessToken,
  });
  return (response.data.accounts ?? []).map((a) => ({
    accountId: a.account_id,
    mask: a.mask ?? undefined,
    name: a.name,
    subtype: a.subtype ?? undefined,
  }));
}
