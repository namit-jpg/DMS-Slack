import { anyApi, internalActionGeneric } from 'convex/server';

export const cleanupExpiredOperationalState = internalActionGeneric({
  args: {},
  handler: async (ctx) => {
    let deleted = 0;
    while (true) {
      const batch = await ctx.runMutation(anyApi.operationalState.cleanupExpired, { now: Date.now(), limit: 500 });
      deleted += batch;
      if (batch < 500) break;
    }
    return { deleted };
  },
});

export const reconcileOverduePartialOrderReminders = internalActionGeneric({
  args: {},
  handler: async (ctx) => ctx.runMutation(anyApi.operationalState.reconcileOverduePartialOrderReminders, {
    now: Date.now(),
    limit: 100,
  }),
});
