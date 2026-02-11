/**
 * Integration tests for ledger (require DynamoDB Local or real table).
 * Skip in CI unless DDB_TABLE_LEDGER is set.
 */
import { describe, it, expect } from 'vitest';

const tableName = process.env.DDB_TABLE_LEDGER;

describe('Ledger integration', () => {
  it.skipIf(!tableName)('appendEvent and rebuildState round-trip', async () => {
    const { appendEvent, rebuildState, ensureLedgerInitialized } = await import('../../src/domain/ledger/ledger');
    const residentId = `test-${Date.now()}`;
    const config = { tableName: tableName! };
    await ensureLedgerInitialized(residentId, config);
    await appendEvent(
      residentId,
      { eventType: 'CHARGE_POSTED', amount: 100, chargeType: 'RENT', description: 'Rent' },
      config
    );
    const state = await rebuildState(residentId, config);
    expect(state.balance).toBe(100);
  });
});
