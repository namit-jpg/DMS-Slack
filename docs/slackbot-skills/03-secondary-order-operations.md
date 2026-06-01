# Secondary order operations skill

## Goal

Help users use Slackbot to inspect retailer-facing orders, prepare invoices, manage dispatch updates, and follow up on partially fulfilled secondary orders.

This skill mirrors the app's secondary-order flows: list secondary orders, inspect details, process invoices, mark delivery, and track remaining quantities.

## Use this skill when the user asks to

- list retailer or outlet orders
- inspect a specific secondary order
- create a full or partial invoice
- review stock availability before invoicing
- mark a dispatch as delivered
- check what is still partially fulfilled
- follow up on uninvoiced or partially invoiced orders

## Expected Salesforce data

Typical mappings from this app:

- secondary-order records or custom retailer-order records
- `Invoice__c`
- invoice line items
- `Dispatch_Request__c`
- inventory or batch records used to validate fulfillment

## How Slackbot should handle the request

### A. List or summarize secondary orders

1. Confirm the scope if the user does not specify a retailer, route, territory, or timeframe.
2. Summarize by status first, then offer record-level detail.
3. Highlight orders that are pending invoice, partially fulfilled, or blocked by stock.

### B. Show a single order in detail

1. Use the order number if provided.
2. If the user only gives a retailer name, return likely matches and ask which record to open.
3. Summarize:
   - retailer or outlet
   - order date
   - fulfillment state
   - invoiced vs uninvoiced quantities
   - any active dispatch or delivery records

### C. Create an invoice

1. Identify the exact order.
2. Gather the user's intent:
   - full invoice
   - partial invoice based on available stock
   - invoice specific lines only
3. If stock validation data exists, show what can be fulfilled.
4. Present a draft invoice preview:
   - order number
   - lines to invoice
   - quantities
   - whether the invoice is full or partial
5. Ask for approval before creating the record in Salesforce.
6. After approval, confirm the invoice number and what still remains open.

### D. Mark delivery or dispatch updates

1. Identify the correct dispatch or linked order.
2. Show the current dispatch state and the new state to be written.
3. Ask for approval before updating the record.
4. After updating, offer a goods-receipt or follow-up workflow if the business process requires one.

## Guardrails

- Never invoice against the wrong retailer order. Resolve ambiguity first.
- If stock availability is uncertain, say so explicitly and ask whether to proceed with a manual partial invoice draft.
- Always show which quantities will be invoiced before writing anything.
- For delivery updates, identify the exact dispatch record if more than one exists.
- If line-item detail is not exposed in the org, provide the best available header summary and say what could not be verified.

## Example user prompts

- "Show my uninvoiced retailer orders for this week."
- "Open secondary order SO-2026-0001."
- "Can I fully invoice SO-2026-0001 with current stock?"
- "Create a partial invoice for SO-2026-0001 using only available stock."
- "Invoice only the Beverage Pack A lines on SO-2026-0001."
- "Mark the dispatch for SO-2026-0001 as delivered."
- "Which secondary orders are still partially fulfilled after invoicing?"
- "Summarize new retailer orders created today."

## Example response shape for invoicing

### Invoice preview

- Secondary order number
- Retailer or outlet
- Fulfillable quantities by line
- Proposed invoice type: full or partial
- Remaining quantities after invoice
- Confirmation question

### Delivery update preview

- Dispatch or order reference
- Current delivery state
- Proposed new state
- Confirmation question

## Useful follow-up prompts

- "Only show orders for Wakanda General Store."
- "Sort by oldest pending invoice first."
- "After invoicing, tell me what remains to fulfill."
- "Show me only orders blocked by stock shortages."

## App parity notes

This skill reflects the app's secondary-order menu, invoice processing, and dispatch actions. In the current repository, some secondary-order detail and line-level live behavior is partial or mock-heavy, so the production version of this skill should be validated carefully against the real retailer-order objects and invoice endpoints available in the org.
