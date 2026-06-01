# Primary order operations skill

## Goal

Help users use Slackbot to create, review, update, and follow up on primary orders, including delivery confirmation and goods receipt capture.

This skill mirrors the app's primary-order flow: browse products, prepare an order, review status, mark an order as delivered, and capture a GRN.

## Use this skill when the user asks to

- find products for replenishment
- create a draft primary order
- review the status or details of an existing purchase order
- mark a primary order as delivered
- record received, damaged, or missing quantities
- check whether an order has a GRN, return, or invoice linked to it

## Expected Salesforce data

Typical objects from this app:

- `Product2`
- `PurchaseOrder__c`
- `Purchase_Order_Item__c`
- `GRN__c`
- related return, invoice, or credit-note records

## How Slackbot should handle the request

### A. Product search or replenishment planning

1. If the user names a product loosely, search by product name, code, or family.
2. Show a short list of matches when there is any ambiguity.
3. Ask for quantities only after the products are confirmed.

### B. Create a draft primary order

1. Confirm the distributor or account scope if needed.
2. Collect:
   - product names or product codes
   - quantities and units
   - requested delivery date if relevant
   - any shipping or note fields required by the org
3. Build a draft order summary that shows:
   - account or distributor
   - each line item
   - quantity per line
   - any available pricing, discount, tax, or total fields
4. Ask for approval before creating the record in Salesforce.
5. After approval, return the created order number, status, and a short next-step summary.

### C. Review order status or details

1. If the user provides an order number, use that first.
2. Otherwise search the distributor's recent primary orders and ask the user to confirm the correct record.
3. Summarize status, approval state, delivery state, line items, and any linked GRN, return, or invoice.

### D. Mark as delivered

1. Identify the exact primary order.
2. Show the current status and the new status that will be written.
3. Ask for approval before updating Salesforce.
4. After the update, offer to start a GRN capture workflow.

### E. Capture a GRN

1. Confirm the order and line items.
2. Collect per-line received, damaged, and missing quantities.
3. Validate that the entered quantities make sense against the original ordered quantity.
4. Show a draft GRN summary before creating the record.
5. After approval, create the GRN and highlight any exceptions that may require a return or claim workflow.

## Guardrails

- Never guess which product the user meant if multiple products match.
- Never create or update an order without identifying the correct distributor context.
- Always preview the final order lines before creating the order.
- Always preview the status change before marking a record delivered.
- Never create a GRN if the quantity math is inconsistent; ask the user to fix the counts.
- If pricing or discount logic is unavailable, say that clearly and create a quantity-only draft if the org allows it.

## Example user prompts

- "Create a draft primary order for Demo Distributors with 20 cases of Beverage Pack A and 10 cans of Oil Can D."
- "Find products for a snack restock order for next week."
- "Show the status of PO-2026-0001."
- "What was fulfilled on my latest primary order?"
- "Mark PO-2026-0007 as delivered."
- "Start a GRN for PO-2026-0007."
- "Record this GRN for PO-2026-0007: Beverage Pack A received 18, damaged 1, missing 1."
- "Which approved primary orders still do not have a GRN?"

## Example response shape for writes

### Draft primary order preview

- Distributor or account
- Proposed order date
- Line items with quantities
- Any available pricing totals
- Records that will be created
- Confirmation question

### Draft delivery update preview

- Order number
- Current delivery status
- Proposed new delivery status
- Confirmation question

### Draft GRN preview

- Order number
- Per-line received, damaged, and missing quantities
- Validation notes
- Whether a follow-up return may be needed
- Confirmation question

## Useful follow-up prompts

- "Add one more line for Spice Mix E, quantity 25."
- "Remove Oil Can D from the draft."
- "Only show orders awaiting delivery."
- "After delivery, help me capture the GRN."

## App parity notes

This skill closely matches the current app's strongest operational flow. In the existing codebase, order creation and GRN capture already exist, but quote calculation and discount logic are partly mock-driven. A production Slackbot skill should only commit pricing or tax values if the connected org can compute them reliably.
