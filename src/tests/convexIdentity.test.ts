import { describe, expect, it } from 'vitest';
import { contextFromAccount, developmentFallbackEmail, slackUserInfoArguments } from '../../convex/identity';

const identity = {
  slackUserId: 'U1', slackTeamId: 'T1', slackEnterpriseId: null, email: 'distributor@example.test', displayName: 'Distributor',
};

describe('Convex distributor identity mapping', () => {
  it('keeps the Salesforce account identifier in the resolver path, not Slack payload state', () => {
    expect(contextFromAccount(identity, {
      Id: '001-account', Name: 'Demo Distributor', IsPartner: true, Type: 'Partner', Business_Type__c: 'Distributor',
    }, 'ContactEmail')).toMatchObject({
      salesforceAccountId: '001-account', slackUserId: 'U1', mappingSource: 'ContactEmail', isActive: true,
    });
  });

  it('does not authorize non-partner Accounts', () => {
    expect(contextFromAccount(identity, { Id: '001-not-partner', Name: 'Not a distributor', IsPartner: false }, 'AccountEmail')).toBeNull();
  });

  it('uses the verified source workspace for Enterprise Grid Slack user lookups', () => {
    expect(slackUserInfoArguments('E-grid', 'U1', 'T-child')).toEqual({ user: 'U1', team_id: 'T-child' });
    expect(slackUserInfoArguments('T1', 'U1', 'T1')).toEqual({ user: 'U1' });
  });

  it('permits the temporary fallback only for the explicit development user and Slack user_not_found', () => {
    const fallback = { enabled: 'true', email: 'namit@warpdrivetech.in', slackUserId: 'U-dev' };
    expect(developmentFallbackEmail('U-dev', 'user_not_found', fallback)).toBe('namit@warpdrivetech.in');
    expect(developmentFallbackEmail('U-other', 'user_not_found', fallback)).toBeNull();
    expect(developmentFallbackEmail('U-dev', 'missing_scope', fallback)).toBeNull();
    expect(developmentFallbackEmail('U-dev', 'user_not_found', { ...fallback, enabled: 'false' })).toBeNull();
  });
});
