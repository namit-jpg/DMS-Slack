# Dashboard and insights skill

## Goal

Help users ask Slackbot for distributor health summaries, trend analysis, operational risk signals, and report-style insights without leaving Slack.

This skill mirrors the current app's dashboard, KPI cards, pending-work summaries, claims breakdowns, inventory alerts, and chart-style business insights.

## Use this skill when the user asks for

- a business summary for an account, distributor, territory, or channel
- monthly, weekly, quarterly, or custom-period trends
- pending orders, returns, claims, unpaid invoices, or aging work
- inventory risk or low-stock summaries
- a comparison such as primary vs secondary sales
- a summary of a Salesforce report, dashboard, or saved list

## Expected Salesforce data

Use whichever objects and reports are available in the org. Typical mappings from this app are:

- `PurchaseOrder__c`
- `Return_Order__c`
- `Claim__c`
- `Invoice__c`
- `Inventory_Batch__c`
- `Credit_Note__c`
- relevant Salesforce reports or custom report types

## How Slackbot should handle the request

1. Confirm the business scope if the prompt does not clearly identify the distributor, account, territory, or timeframe.
2. Gather the minimum filters needed to answer correctly:
   - who or what business unit
   - timeframe
   - whether the user wants a summary, trend, risks, or detailed records
3. Query the relevant Salesforce records or report data.
4. Return a concise summary first, then the key supporting numbers.
5. If useful, separate the answer into:
   - what is going well
   - what needs attention
   - recommended next steps
6. If the user asks a follow-up such as "show me the oldest orders" or "drill into claims", continue with the same scope unless the user changes it.

## Output style

- Lead with a one-paragraph summary.
- Then show short bullets with the most important numbers.
- Include timeframe and record count where possible.
- If something is a risk, explain why it matters.
- Do not present estimates as facts.

## Guardrails

- Never invent KPIs if the query returns incomplete data.
- If there are multiple matching accounts or distributors, ask the user to choose one.
- If a metric definition is unclear, say how you interpreted it.
- If the org does not expose one of the requested insights, say what you can show instead.
- Treat write requests separately. This skill is primarily for read-only insights.

## Example user prompts

- "Give me a health summary for Demo Distributors for this month."
- "Show my primary vs secondary sales trend for the last 90 days."
- "What orders, returns, and claims need attention this week?"
- "Summarize unpaid invoices older than 30 days for my account."
- "Which products are below minimum stock and likely to affect retailer fulfillment?"
- "Summarize report 00OXXXXXXXXXXXX and tell me the top three risks."
- "Compare this month to last month for order volume, returns, and claim value."
- "What are the biggest blockers in my distributor operations right now?"

## Example response shape

### Health summary

- Revenue trend: show current-period value and change vs prior period.
- Order flow: show counts for draft, pending, approved, delivered, and aging orders.
- Returns and claims: show open counts, value at risk, and any overdue items.
- Inventory: list low-stock or out-of-policy items.
- Actionable next steps: suggest the next two or three actions.

### Report summary

- Report name and timeframe
- Top findings
- Outliers or exceptions
- Recommended follow-ups

## Follow-up prompts Slackbot should handle well

- "Drill into the oldest pending orders."
- "Show only approved returns."
- "Break that down by retailer."
- "Turn that into a short executive summary."
- "What changed since last week?"

## App parity notes

This skill aligns closely with the current app's dashboard, reports, and business insight flows. In the existing app, some advanced AI-style recommendations are mock-heavy, so a production Slackbot skill should only promise insights backed by real reports, records, or configured analytics.
