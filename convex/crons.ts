import { anyApi, cronJobs } from 'convex/server';

const crons = cronJobs();

// One daily batched cleanup is sufficient because every operational read also
// applies its expiry boundary. The secondary-order notification poller remains
// disabled until its Salesforce scopes and watermarks pass rehearsal.
crons.daily('cleanup expired operational state', { hourUTC: 2, minuteUTC: 17 }, anyApi.maintenance.cleanupExpiredOperationalState);

// Scheduled actions are at-most-once. This bounded mutation only re-enqueues
// exact overdue reminder boundaries; the claim mutation suppresses duplicates.
crons.hourly('reconcile overdue partial-order reminders', { minuteUTC: 23 }, anyApi.maintenance.reconcileOverduePartialOrderReminders);

// `secondaryOrderPolling.reconcileEnabledScopes` is intentionally NOT
// registered here yet. First configure a scope, seed it with the current
// Salesforce snapshot, rehearse the no-notification path, and obtain accepted
// evidence. Only then should the five-minute cron be added in the approved
// deployment change.

export default crons;
