# Inventory and replenishment skill

## Goal

Help users use Slackbot to inspect stock position, spot low-inventory risk, prepare replenishment actions, and manage ARS-like replenishment settings where the org supports them.

This skill mirrors the app's inventory dashboard, low-stock visibility, replenish-order shortcuts, and ARS-style threshold management.

## Use this skill when the user asks to

- show current stock by product, batch, location, or warehouse
- identify low-stock or overstocked SKUs
- surface products at risk of causing order delays
- create a replenishment draft for items below threshold
- review auto-replenishment settings
- update minimum or maximum stock thresholds

## Expected Salesforce data

Typical mappings from this app:

- `Inventory_Batch__c`
- product master data from `Product2`
- replenishment-policy or ARS-style custom objects if the org has them
- primary-order objects used to create follow-on replenishment drafts

## How Slackbot should handle the request

### A. Stock visibility

1. Confirm the scope:
   - location or warehouse
   - distributor or account
   - product family or specific SKUs
2. Summarize current stock by exception first:
   - below minimum
   - close to stockout
   - expired or near expiry if those fields exist
   - above maximum if relevant
3. Offer drill-down detail by SKU, batch, or location.

### B. Replenishment suggestions

1. Identify products below threshold or user-specified target quantities.
2. Show a replenishment recommendation with:
   - current stock
   - threshold or target
   - recommended reorder quantity
3. If the user wants action, convert the recommendation into a draft primary order and ask for approval before creating anything.

### C. ARS or threshold updates

1. Use this only if the org exposes replenishment-policy records or fields that can be updated safely.
2. Collect the exact product and the proposed threshold values.
3. Show current vs proposed settings in a preview.
4. Ask for approval before writing the change.
5. After the update, summarize how the policy changed and what orders may be affected.

## Guardrails

- Never guess which warehouse or inventory pool the user means if multiple locations exist.
- Always distinguish actual on-hand stock from recommended reorder quantities.
- Do not write threshold or ARS policy changes unless the underlying records and fields are clearly available in the org.
- If ARS-like policy data is unavailable, fall back to a read-only inventory summary and recommend a draft replenishment order instead.
- If lot, batch, or expiry data is incomplete, say so before making any recommendation.

## Example user prompts

- "Show low-stock items for Nairobi DC."
- "Which SKUs are below minimum stock for my distributor right now?"
- "Summarize inventory by product family for the last warehouse snapshot."
- "Create a replenishment draft for all SKUs below minimum stock."
- "How many cases of Beverage Pack A do I have across all locations?"
- "Raise the minimum stock for Dairy Pack C to 50 crates and the maximum to 120."
- "Show ARS-triggered replenishment activity from this month."
- "Which low-stock items are most likely to block pending retailer orders?"

## Example response shape

### Inventory summary

- Scope used: location, account, timeframe
- Low-stock items
- Items at healthy stock
- Items with special attention required
- Suggested next actions

### Replenishment draft preview

- Products to reorder
- Current stock and target stock
- Recommended quantities
- Whether a primary order draft will be created
- Confirmation question

### Threshold update preview

- Product or SKU
- Current min and max
- Proposed min and max
- Impact summary
- Confirmation question

## Useful follow-up prompts

- "Only show products below 7 days of cover."
- "Group that by warehouse."
- "Turn the low-stock list into a draft purchase order."
- "Exclude products already on an open replenishment order."

## App parity notes

Inventory visibility is one of the stronger live-aligned areas in the current app. ARS configuration and AI-generated threshold advice are much more mock-heavy today, so production Slackbot skills should treat policy writes as optional and only enable them after the real custom objects, fields, and approval paths are verified.
