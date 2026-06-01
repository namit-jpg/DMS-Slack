# Returns and claims skill

## Goal

Help users use Slackbot to monitor return orders, inspect approval status, file new claims, and follow up on credit-note outcomes.

This skill mirrors the app's returns-and-claims workflows: list returns, open a return, review related claims and credit notes, and create a new claim from Slack.

## Use this skill when the user asks to

- show return orders or claim records
- inspect a specific return
- file a claim tied to a return or shipment issue
- update or summarize claim status
- check whether a return was approved
- review issued credit notes

## Expected Salesforce data

Typical mappings from this app:

- `Return_Order__c`
- `Claim__c`
- `Credit_Note__c`
- related approvals, files, comments, or shipment references if available

## How Slackbot should handle the request

### A. Return visibility

1. If the user asks for returns generally, summarize by status and value first.
2. Offer a filtered list for:
   - open returns
   - approved returns
   - returns awaiting approval
   - returns with related claims
3. If the user opens a single return, show:
   - return number
   - status
   - type
   - amount
   - approval state
   - linked claims
   - linked credit notes

### B. File a claim

1. Identify the exact return or shipment issue the claim belongs to.
2. Collect the minimum required details:
   - claim type
   - claim amount
   - short business description
   - optional supporting details such as damaged quantity or invoice reference
3. Build a draft claim preview that shows what will be created.
4. Ask for approval before writing to Salesforce.
5. After approval, return the claim number, current status, and any recommended next step.

### C. Claim status follow-up

1. If the user asks about claims broadly, summarize by status and amount.
2. If the user asks about a single claim, show owner, status, amount, linked return, and most recent update if available.
3. If the user wants action recommendations, explain what is blocked, what is waiting on approval, and what appears resolved.

### D. Credit note follow-up

1. When a return or claim has a related credit note, surface the note number, amount, and status.
2. If no credit note exists, say that clearly rather than implying one should exist.

## Guardrails

- Never file a claim without a clear parent return or shipment context unless the org explicitly allows standalone claims.
- Do not guess claim type or amount. Ask if either is missing.
- Always preview the new claim before creating it.
- If approval submission is not enabled in the org, explain that the user can still view approval status.
- If the user asks Slackbot to attach evidence, confirm which file should be attached and to which record before asking for approval.

## Example user prompts

- "Show all open returns for my distributor."
- "Open return order RO-2026-0001."
- "What claims are still unresolved this month?"
- "File a damaged goods claim for RO-2026-0001 for Rs 1,500. Description: 12 cartons leaked in transit."
- "Show approval status for RO-2026-0001."
- "Which returns have issued credit notes already?"
- "Summarize claims by type for the last 30 days."
- "Attach this image to claim CLM-2026-0012 as supporting evidence."

## Example response shape for a claim write

### Claim preview

- Parent return or shipment reference
- Claim type
- Claim amount
- Description
- Any supporting references or attachments
- Confirmation question

### Claim confirmation

- Claim number
- Current claim status
- Related return reference
- Suggested next step

## Useful follow-up prompts

- "Only show claims above Rs 5,000."
- "Group returns by approval status."
- "Which approved returns still do not have a credit note?"
- "Summarize the top claim reasons this quarter."

## App parity notes

This skill is strongly aligned with the current app's returns, claims, approval-status, and credit-note visibility. In the repository today, claim creation is available, while approval submission and some attachment workflows are environment-dependent. The production skill should match whatever approval and file-attachment actions are actually enabled in Salesforce.
