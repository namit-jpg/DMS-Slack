## Slackbot skill drafts for DMS/SFA workflows

This folder contains markdown drafts that can be adapted into Slackbot Skills or shared as user prompt playbooks. They are designed to mirror the main workflows already present in this repository's Slack app:

- dashboard and business insights
- primary order management
- secondary order and invoicing workflows
- returns and claims
- inventory and replenishment

## Why these files exist

Slackbot Skills are reusable instruction sets that help Slackbot respond consistently to a class of requests. Recent Slack and Salesforce documentation indicates that Slackbot can:

- use Skills to guide how it handles relevant prompts
- read, create, and update Salesforce records in Slack
- show a draft or preview before making a change
- respect the user's existing Salesforce permissions

These markdown files are written so a team can:

1. copy the content into a Slackbot Skill canvas
2. adapt the object names and fields to the connected Salesforce org
3. publish the skill to a group or catalog
4. give users concrete prompt examples that align with the current DMS/SFA experience

## Design principles used in every file

- Scope all reads and writes to the authenticated distributor, account, or territory context when possible.
- Never invent Salesforce data. If records or metrics are missing, say so clearly.
- For writes, prepare a clear draft that shows which record will change and which fields will be updated before asking for approval.
- If the user's prompt is ambiguous, ask a narrow follow-up instead of guessing.
- Prefer business language in the response, but mention record IDs and object names when they help the user verify the action.
- If a workflow depends on fields or objects that are not available in the org, explain the limitation and offer the closest supported read-only alternative.

## Files in this folder

| File | Purpose | Closest app capability |
| --- | --- | --- |
| `01-dashboard-and-insights.md` | Summaries, KPIs, trends, risk flags, report-style answers | Dashboard, reports, business insights |
| `02-primary-order-operations.md` | Create and manage primary orders, delivery updates, GRN capture | Primary orders, delivery, GRN |
| `03-secondary-order-operations.md` | Retailer orders, invoicing, dispatch, partial fulfillment follow-up | Secondary orders and invoicing |
| `04-returns-and-claims.md` | Return visibility, claim filing, credit note follow-up | Returns and claims |
| `05-inventory-and-replenishment.md` | Stock visibility, reorder suggestions, replenishment drafts, ARS-like policies | Inventory and ARS |

## Notes on app parity

These drafts are grounded in the current app, but not every workflow has the same live Salesforce maturity:

- Strongest parity: order visibility, return and claim visibility, inventory visibility, basic record updates.
- Partial parity: primary order creation, GRN creation, invoice creation, dispatch updates.
- Mock-heavy in the current app: ARS configuration, AI-only recommendations, some advanced secondary-order detail flows.

If you are turning these into production Slackbot Skills, validate each skill against the connected org's real objects, fields, flows, and approval rules.

## Recommended way to use them

For each business job, create one Slackbot Skill and paste in the relevant file with light edits:

- replace example object names if your org labels differ
- add exact field names if the skill should write data
- add channel or notification rules if the skill should post to shared channels
- remove sections for flows your org has not enabled yet

The files are intentionally written in a copy-ready format: they tell Slackbot how to behave and also include example prompts a user can send.
