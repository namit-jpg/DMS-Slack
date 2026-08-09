import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * Convex retains operational metadata only. Salesforce business objects are
 * deliberately not represented here.
 */
export default defineSchema({
  slackIngress: defineTable({
    dedupeKey: v.string(),
    kind: v.union(v.literal('command'), v.literal('event'), v.literal('action')),
    // For an Enterprise Grid installation this is the actual workspace Slack
    // delivered from; teamId remains the configured authorized scope.
    sourceTeamId: v.optional(v.string()),
    teamId: v.string(),
    userId: v.string(),
    handlerKey: v.string(),
    payload: v.any(),
    responseUrl: v.optional(v.string()),
    responseUrlExpiresAt: v.optional(v.number()),
    status: v.union(v.literal('accepted'), v.literal('processing'), v.literal('completed'), v.literal('failed')),
    attemptCount: v.number(),
    receivedAt: v.number(),
    updatedAt: v.number(),
    expiresAt: v.number(),
    errorCode: v.optional(v.string()),
  })
    .index('by_dedupe_key', ['dedupeKey'])
    .index('by_status_updated_at', ['status', 'updatedAt'])
    .index('by_expires_at', ['expiresAt']),
  idempotencyKeys: defineTable({
    key: v.string(),
    status: v.union(v.literal('processing'), v.literal('completed'), v.literal('failed')),
    resultReference: v.optional(v.string()),
    errorCode: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    expiresAt: v.number(),
  })
    .index('by_key', ['key'])
    .index('by_expires_at', ['expiresAt']),
  interactionStates: defineTable({
    key: v.string(),
    teamId: v.string(),
    userId: v.string(),
    channelId: v.string(),
    flowKind: v.string(),
    state: v.any(),
    createdAt: v.number(),
    updatedAt: v.number(),
    expiresAt: v.number(),
  })
    .index('by_key', ['key'])
    .index('by_user_flow', ['teamId', 'userId', 'flowKind'])
    .index('by_expires_at', ['expiresAt']),
  orderBuilders: defineTable({
    teamId: v.string(),
    userId: v.string(),
    selected: v.array(v.object({
      productId: v.string(),
      quantity: v.number(),
      schemeDiscount: v.optional(v.number()),
    })),
    selectedCreditNoteIds: v.optional(v.array(v.string())),
    quote: v.optional(v.any()),
    updatedAt: v.number(),
    expiresAt: v.number(),
  })
    .index('by_team_user', ['teamId', 'userId'])
    .index('by_expires_at', ['expiresAt']),
  pendingArsChanges: defineTable({
    teamId: v.string(),
    channelId: v.string(),
    messageTs: v.string(),
    requestingUserId: v.string(),
    requestingUserName: v.string(),
    salesforceAccountId: v.string(),
    accountName: v.string(),
    changes: v.array(v.object({
      productId: v.string(),
      productName: v.string(),
      oldMin: v.number(),
      newMin: v.number(),
      oldMax: v.number(),
      newMax: v.number(),
    })),
    status: v.union(v.literal('pending'), v.literal('approved'), v.literal('rejected'), v.literal('expired')),
    createdAt: v.number(),
    resolvedAt: v.optional(v.number()),
    expiresAt: v.number(),
  })
    .index('by_message_ts', ['teamId', 'channelId', 'messageTs'])
    .index('by_status', ['status'])
    .index('by_expires_at', ['expiresAt']),
  appHomePublishes: defineTable({
    teamId: v.string(),
    userId: v.string(),
    lastPublishedAt: v.number(),
    expiresAt: v.number(),
  })
    .index('by_team_user', ['teamId', 'userId'])
    .index('by_expires_at', ['expiresAt']),
  partialOrderReminders: defineTable({
    salesforceOrderId: v.string(),
    salesforceAccountId: v.string(),
    teamId: v.string(),
    slackUserId: v.string(),
    orderNumber: v.string(),
    retailerCustomer: v.string(),
    pendingItemCount: v.number(),
    active: v.boolean(),
    nextReminderAt: v.number(),
    lastSentAt: v.optional(v.number()),
    lastFailureCode: v.optional(v.string()),
    lastFailureAt: v.optional(v.number()),
    attemptCount: v.number(),
    updatedAt: v.number(),
    expiresAt: v.number(),
  })
    .index('by_order_id', ['salesforceOrderId'])
    .index('by_active_next_reminder', ['active', 'nextReminderAt'])
    .index('by_expires_at', ['expiresAt']),
  /**
   * Short-lived, durable replacement for the legacy in-handler GRN polling
   * loop after delivery confirmation. It retains only the resolved account
   * scope and response destination needed to render the follow-up form.
   */
  grnFollowups: defineTable({
    followupKey: v.string(),
    teamId: v.string(),
    userId: v.string(),
    orderId: v.string(),
    dispatchName: v.string(),
    invoiceId: v.optional(v.string()),
    context: v.object({
      slackUserId: v.string(),
      slackTeamId: v.string(),
      slackEnterpriseId: v.union(v.string(), v.null()),
      slackEmail: v.string(),
      salesforceAccountId: v.string(),
      accountName: v.string(),
      distributorCode: v.union(v.string(), v.null()),
      mappingSource: v.union(v.literal('AccountEmail'), v.literal('ContactEmail'), v.literal('PersonAccountEmail'), v.literal('DistributorObject')),
      resolvedAt: v.string(),
      isActive: v.boolean(),
      accountType: v.string(),
      businessType: v.string(),
    }),
    responseUrl: v.optional(v.string()),
    responseUrlExpiresAt: v.optional(v.number()),
    status: v.union(v.literal('pending'), v.literal('processing'), v.literal('completed'), v.literal('failed')),
    attempt: v.number(),
    nextCheckAt: v.number(),
    lastErrorCode: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    expiresAt: v.number(),
  })
    .index('by_key', ['followupKey'])
    .index('by_status_next_check', ['status', 'nextCheckAt'])
    .index('by_expires_at', ['expiresAt']),
  secondaryOrderWatermarks: defineTable({
    scopeKey: v.string(),
    salesforceAccountId: v.string(),
    slackUserId: v.string(),
    lastSuccessfulPollAt: v.optional(v.number()),
    lastOrderWatermark: v.optional(v.string()),
    lastFailureCode: v.optional(v.string()),
    lastFailureAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index('by_scope_key', ['scopeKey'])
    .index('by_account', ['salesforceAccountId']),
  /**
   * Polling is opt-in per distributor/account and notification destination.
   * New scopes start disabled; an operator must first seed their watermark
   * from Salesforce and explicitly enable them in a separate operation.
   */
  secondaryOrderPollingScopes: defineTable({
    scopeKey: v.string(),
    teamId: v.string(),
    slackUserId: v.string(),
    salesforceAccountId: v.string(),
    notificationChannelId: v.string(),
    notificationsEnabled: v.boolean(),
    configurationVersion: v.number(),
    seedGeneration: v.number(),
    watermarkSeededAt: v.optional(v.number()),
    seedObservedOrderCount: v.optional(v.number()),
    pollLeaseOwner: v.optional(v.string()),
    pollLeaseExpiresAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_scope_key', ['scopeKey'])
    .index('by_enabled', ['notificationsEnabled']),
  /**
   * A durable per-order delivery outcome closes the same-watermark race and
   * gives operators a review record for a failed or ambiguous Slack post.
   */
  secondaryOrderNotifications: defineTable({
    scopeKey: v.string(),
    salesforceOrderId: v.string(),
    orderWatermark: v.string(),
    status: v.union(v.literal('processing'), v.literal('sent'), v.literal('failed'), v.literal('skipped')),
    attemptStartedAt: v.number(),
    sentAt: v.optional(v.number()),
    failureCode: v.optional(v.string()),
    resolvedAt: v.optional(v.number()),
    resolutionNote: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_scope_order', ['scopeKey', 'salesforceOrderId'])
    .index('by_scope_status', ['scopeKey', 'status']),
  integrationStatus: defineTable({
    component: v.union(
      v.literal('slackIngress'),
      v.literal('salesforce'),
      v.literal('reminders'),
      v.literal('secondaryOrderPoller'),
    ),
    status: v.union(v.literal('not_configured'), v.literal('healthy'), v.literal('degraded')),
    lastAttemptAt: v.optional(v.number()),
    lastSuccessAt: v.optional(v.number()),
    lastFailureAt: v.optional(v.number()),
    consecutiveFailureCount: v.number(),
    errorCode: v.optional(v.string()),
    updatedAt: v.number(),
  }).index('by_component', ['component']),
});
