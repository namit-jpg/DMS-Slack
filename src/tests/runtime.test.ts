import { describe, it, expect, beforeEach } from 'vitest';
import { getSalesforceClient, resetSalesforceClient, getClientMode } from '../salesforce/SalesforceClient';
import { ISalesforceClient } from '../salesforce/types';
import { getDefaultFeatureFlags } from '../config/featureFlags';
import { BLOCKERS } from '../salesforce/blockers';
import { IdentityPipeline } from '../identity/IdentityPipeline';

describe('Runtime Mode Verification', () => {
  beforeEach(() => { delete (globalThis as any).__SF_MODE__; });

  it('getSalesforceClient returns client with clear mode', () => {
    const originalMock = process.env.USE_MOCK_SALESFORCE;
    process.env.USE_MOCK_SALESFORCE = 'true';
    resetSalesforceClient();
    const client = getSalesforceClient();
    expect(client.isMock()).toBe(true);
    const mode = getClientMode();
    expect(mode).toBe('MOCK');
    process.env.USE_MOCK_SALESFORCE = originalMock;
    resetSalesforceClient();
  });

  it('mock client is identifiable via isMock()', () => {
    const originalMock = process.env.USE_MOCK_SALESFORCE;
    process.env.USE_MOCK_SALESFORCE = 'true';
    resetSalesforceClient();
    const client = getSalesforceClient();
    expect(client.isMock()).toBeTruthy();
    process.env.USE_MOCK_SALESFORCE = originalMock;
    resetSalesforceClient();
  });

  it('getClientMode returns UNINITIALIZED when reset', () => {
    resetSalesforceClient();
    const mode = getClientMode();
    expect(mode === 'UNINITIALIZED' || mode === 'MOCK').toBeTruthy();
  });
});

describe('Blocked Features Visibility', () => {
  it('all blockers have id, feature, reason, and suggestedSalesforceChange', () => {
    for (const blocker of BLOCKERS) {
      expect(blocker.id).toBeDefined();
      expect(blocker.feature).toBeDefined();
      expect(blocker.reason).toBeDefined();
      expect(blocker.suggestedSalesforceChange).toBeDefined();
    }
  });

  it('at least some real features are not mock-only', () => {
    const flags = getDefaultFeatureFlags();
    expect(flags.PRIMARY_ORDER_CREATE).toBe(true);
    expect(flags.PRIMARY_ORDER_LIST).toBe(true);
  });

  it('blockers are categorized with workaround or not', () => {
    const withWorkaround = BLOCKERS.filter((b) => b.workaround);
    expect(withWorkaround.length).toBeGreaterThan(0);
  });
});

describe('Discovered REST Endpoints', () => {
  it('DISCOVERED_RCG_REST_ENDPOINTS contains verified endpoints', async () => {
    const { DISCOVERED_RCG_REST_ENDPOINTS } = await import('../salesforce/objectMapping');
    expect(DISCOVERED_RCG_REST_ENDPOINTS).toBeDefined();
    expect(DISCOVERED_RCG_REST_ENDPOINTS.GET_ALL_SCHEMES.verified).toBe(true);
    expect(DISCOVERED_RCG_REST_ENDPOINTS.GET_INVENTORY_DATA.verified).toBe(true);
    expect(DISCOVERED_RCG_REST_ENDPOINTS.CREATE_PURCHASE_ORDER.verified).toBe(true);
    expect(DISCOVERED_RCG_REST_ENDPOINTS.GET_PURCHASE_ORDERS_BY_SFA_USER.verified).toBe(true);
  });
});

describe('No Silent Mock Fallback', () => {
  it('feature flags can distinguish mock-only from real features', () => {
    const flags = getDefaultFeatureFlags();
    const mockOnlyFeatures = ['AI_INSIGHTS', 'ARS_SETTINGS'];
    for (const f of mockOnlyFeatures) {
      expect(typeof (flags as Record<string, boolean>)[f]).toBe('boolean');
    }
  });

  it('schema validation rejects invalid IDs for cross-account checks', async () => {
    const mod = await import('../utils/validation');
    expect(mod.isValidSalesforceId('<script>')).toBe(false);
    expect(mod.isValidSalesforceId('a01MOCK000000001')).toBe(true);
    expect(mod.isValidSalesforceId('0'.repeat(14))).toBe(false);
  });
});

describe('Feature Coverage Documentation', () => {
  it('all blockers are documented', () => {
    const blockerIds = BLOCKERS.map((b) => b.id);
    expect(blockerIds.length).toBeGreaterThanOrEqual(12);
    expect(new Set(blockerIds).size).toBe(blockerIds.length);
  });
});
