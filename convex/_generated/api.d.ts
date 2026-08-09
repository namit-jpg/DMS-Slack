/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as crons from "../crons.js";
import type * as grnFollowups from "../grnFollowups.js";
import type * as health from "../health.js";
import type * as http from "../http.js";
import type * as identity from "../identity.js";
import type * as maintenance from "../maintenance.js";
import type * as operationalState from "../operationalState.js";
import type * as reminders from "../reminders.js";
import type * as salesforce from "../salesforce.js";
import type * as salesforceDomain from "../salesforceDomain.js";
import type * as secondaryOrderPolling from "../secondaryOrderPolling.js";
import type * as slackApi from "../slackApi.js";
import type * as slackDispatch from "../slackDispatch.js";
import type * as slackHandlers from "../slackHandlers.js";
import type * as slackIngress from "../slackIngress.js";
import type * as slackRouteCatalog from "../slackRouteCatalog.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  crons: typeof crons;
  grnFollowups: typeof grnFollowups;
  health: typeof health;
  http: typeof http;
  identity: typeof identity;
  maintenance: typeof maintenance;
  operationalState: typeof operationalState;
  reminders: typeof reminders;
  salesforce: typeof salesforce;
  salesforceDomain: typeof salesforceDomain;
  secondaryOrderPolling: typeof secondaryOrderPolling;
  slackApi: typeof slackApi;
  slackDispatch: typeof slackDispatch;
  slackHandlers: typeof slackHandlers;
  slackIngress: typeof slackIngress;
  slackRouteCatalog: typeof slackRouteCatalog;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
