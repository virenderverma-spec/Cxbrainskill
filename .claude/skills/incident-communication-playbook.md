# Incident Communication Playbook

Complete communication framework for internal teams, partners, and vendors — covering incident creation, follow-up loops, and close-loop resolution communications.

## Description

This skill orchestrates all communications when incidents or Zendesk tickets are created. It ensures every stakeholder — internal teams, partners (ConnectX/AT&T), and vendors — receives timely, structured updates throughout the incident lifecycle: **Detection → Creation → Investigation → Follow-Up → Resolution → Closure**.

## Triggers

- Zendesk ticket created (manual or proactive)
- Incident declared (P1/P2/P3/P4)
- Proactive signal detected (SIG-001 through SIG-010)
- Partner/vendor action required
- Escalation initiated
- SLA breach approaching
- Issue resolved or ticket closed

---

## Part 1: Incident Lifecycle & Communication Flow

```
DETECTION          CREATION           INVESTIGATION       FOLLOW-UP          RESOLUTION         CLOSURE
   |                  |                    |                  |                  |                 |
Signal/Report → Create Ticket    → Assign & Investigate → Scheduled       → Fix Deployed    → Confirm
   |           + Internal Alert      + Partner Notify      Updates to:       + Verify          w/ Customer
   |           + Severity Tag        + Vendor Notify       - Internal        + Notify All    → Post-Mortem
   |                                                       - Customer        Stakeholders    → Close Ticket
   |                                                       - Partner                        → Archive
   v                                                       - Vendor
[Proactive                                                   |
 Communication                                          Loop every:
 Engine]                                                CRITICAL = 2h
                                                        HIGH = 8h
                                                        MEDIUM = 24h
```

---

## Part 2: Internal Communications — Incident Creation

### 2A. Zendesk Ticket Creation (Standard Incident)

**When:** A new incident is identified — either from proactive detection, customer contact, or internal discovery.

**Template: Zendesk Ticket — Internal Incident**

```
Subject: [INCIDENT] [P1/P2/P3/P4] [Signal/Category] — [Customer Name] ([email])

## Incident Summary
- **Incident ID:** INC-[auto-generated]
- **Priority:** P1 (Critical) / P2 (High) / P3 (Medium) / P4 (Low)
- **Signal:** [SIG-XXX] (if proactive) or [REPORTED] (if customer-reported)
- **Category:** eSIM / Port-In / Payment / Network / Account / Billing
- **Created:** [timestamp]
- **Created by:** [Agent name / System / Proactive Engine]

## What Happened
[2-3 sentences: plain-language description of the issue]

## Customer Impact
- **Customer:** [Name] ([email])
- **Account ID:** [id]
- **Service status:** Active / No Service / Degraded / Pending Activation
- **Impact duration:** [X hours/days] since issue began
- **Financial impact:** $[amount] paid, service [delivered/not delivered]
- **Has customer contacted us?** Yes ([X] times) / No
- **Customer sentiment:** Neutral / Frustrated / Angry / Unknown

## Journey Snapshot
| Milestone       | Status      | Timestamp           |
|-----------------|-------------|---------------------|
| Order created   | [status]    | [datetime]          |
| Payment         | [status]    | [datetime]          |
| eSIM provision  | [status]    | [datetime]          |
| Activation      | [status]    | [datetime]          |
| Port-in         | [status]    | [datetime]          |

## Root Cause (If Known)
[Description or "Under investigation"]

## Immediate Actions Required
1. [Action 1 — who, what, by when]
2. [Action 2 — who, what, by when]
3. [Action 3 — who, what, by when]

## Dependencies
- **Partner action needed?** Yes / No — [details]
- **Vendor action needed?** Yes / No — [details]
- **Engineering action needed?** Yes / No — [details]

## SLA Commitment
- **First response to customer:** [timestamp — based on severity]
- **Next internal update:** [timestamp]
- **Target resolution:** [timestamp]

## Tags
proactive_alert, signal_[id], severity_[level], incident, [category]
```

**Ticket Properties:**
| Priority | Severity | First Response | Resolution Target |
|----------|----------|----------------|-------------------|
| P1       | CRITICAL | 30 min         | 4 hours           |
| P2       | HIGH     | 2 hours        | 24 hours          |
| P3       | MEDIUM   | 8 hours        | 72 hours          |
| P4       | LOW      | 24 hours       | 5 business days   |

---

### 2B. Slack Notification — Internal Team Alert

**When:** Ticket is created. Slack alert is sent to the appropriate channel.

**Template: Slack — Incident Created**

```
:ticket: *NEW INCIDENT — [P1/P2/P3/P4]*

*Incident:* INC-[id]
*Signal:* [SIG-XXX] [description]
*Customer:* [name] <[email]>
*Impact:* [one-line impact statement]
*Category:* [eSIM / Port-In / Payment / Network]

*Key Facts:*
- Order: `[orderId]` — [status]
- Service: [Active / No Service / Degraded]
- Duration: [X hours/days] since issue started
- Customer contacts: [X] in last [Y] days

*Owner:* [Assigned agent / Unassigned — needs pickup]
*Action Required:* [what needs to happen immediately]
*Zendesk:* [ticket link]
*SLA:* First response by [time] | Resolve by [time]

cc: @[team-handle]
```

**Channel Routing:**

| Category     | Slack Channel       | Who Gets Pinged    |
|-------------|--------------------|--------------------|
| P1 (any)    | #cs-urgent         | @channel           |
| eSIM        | #esim-support      | @esim-specialists  |
| Port-in     | #portin-support    | @port-team         |
| Payment     | #billing-support   | @billing-team      |
| Network     | #network-ops       | @network-team      |
| Systemic    | #incidents         | @engineering @cs-leads |

---

### 2C. Internal Escalation Communication

**When:** Issue requires escalation from L1 to L2/Engineering/Carrier.

**Template: Slack — Escalation Alert**

```
:arrow_up: *ESCALATION — [P1/P2/P3/P4]*

*From:* [L1 Agent name]
*To:* [L2 / Engineering / Carrier / T&S]
*Reason:* [Why this needs escalation — one line]

*Incident:* INC-[id] | Zendesk: [link]
*Customer:* [name] <[email]>
*Issue:* [Summary]
*Duration:* [X hours/days]
*Attempts:* [What has been tried]

*What's Needed:*
[Specific ask — e.g., "SIM swap failing via ConnectX API, need backend investigation"]

*Customer Expecting:*
- Next update: [time]
- Resolution: [time]
- Has been told: "[summary of what customer was told]"

cc: @[escalation-owner]
```

---

## Part 3: Partner & Vendor Communications

### 3A. Partner Communication — ConnectX / AT&T / Carrier Partners

**When:** Incident requires carrier/partner action (port-in issues, network provisioning failures, SIM activation failures, network outages).

---

#### Initial Partner Notification

**Template: Email — Partner Incident Notification**

```
Subject: [URGENT/HIGH/STANDARD] Incident INC-[id] — [Issue Type] — Action Required

Dear [Partner Team / ConnectX Support / AT&T Wholesale Operations],

We are writing to notify you of an active incident that requires your review and action.

INCIDENT DETAILS
- Incident ID: INC-[id]
- Priority: [P1/P2/P3/P4]
- Category: [Port-In Failure / SIM Activation Failure / Network Provisioning / Service Outage]
- Date/Time Detected: [timestamp UTC]
- Customers Affected: [count] ([single customer / multiple / systemic])

ISSUE DESCRIPTION
[Clear, factual description of the issue in 3-5 sentences. Include specific error codes, rejection reasons, and relevant identifiers.]

AFFECTED CUSTOMER(S)
| Customer Ref | Phone Number | Order/Port ID     | Error Code | Status      |
|-------------|-------------|-------------------|-----------|-------------|
| CUST-[id]   | [masked]    | [order/port ID]   | [code]    | [status]    |

WHAT WE HAVE TRIED
1. [Action 1] — Result: [outcome]
2. [Action 2] — Result: [outcome]
3. [Action 3] — Result: [outcome]

ACTION REQUESTED
[Specific, clear ask — e.g., "Please investigate rejection code R12 on port request PR-12345 and advise on corrective steps."]

TIMELINE
- We request acknowledgment within: [2 hours / 4 hours / 1 business day]
- Customer-committed resolution window: [date/time]
- Next scheduled update from our side: [date/time]

Please respond to this email or contact [internal escalation contact] at [email/phone].

Thank you for your prompt attention.

Best regards,
[Agent Name]
Meow Mobile — Operations Team
Incident Reference: INC-[id]
```

---

#### Partner Follow-Up Communication

**Template: Email — Partner Follow-Up (Loop)**

```
Subject: RE: [URGENT/HIGH/STANDARD] Incident INC-[id] — Follow-Up [#X]

Dear [Partner Team],

This is follow-up #[X] regarding Incident INC-[id], originally reported on [date].

CURRENT STATUS
- Incident Status: Open — [Awaiting Partner Response / Under Partner Investigation / Partial Resolution]
- Time Since Initial Report: [X hours/days]
- Customer Impact: [Ongoing / Mitigated / Worsening]

UPDATE SINCE LAST COMMUNICATION
[Summary of any new information, additional troubleshooting, or changes in scope]

OUTSTANDING ACTIONS
| # | Action Item                        | Owner          | Due       | Status    |
|---|------------------------------------|----------------|-----------|-----------|
| 1 | [Investigate error code X]         | [Partner]      | [date]    | [Pending] |
| 2 | [Provide alternative routing]      | [Partner]      | [date]    | [Pending] |
| 3 | [Re-attempt SIM activation]        | [Meow Mobile]  | [date]    | [Done]    |

CUSTOMER IMPACT UPDATE
- Affected customers: [count]
- Customer-facing SLA at risk: [Yes — breaches at [time] / No]
- Escalation: [Will escalate to partner management if unresolved by [time]]

NEXT STEPS
We request an update by [date/time]. If we do not receive a response, we will escalate to [partner escalation contact / partner management].

Thank you,
[Agent Name]
Meow Mobile — Operations Team
```

---

#### Partner Escalation Communication

**Template: Email — Partner Escalation**

```
Subject: [ESCALATION] Incident INC-[id] — Unresolved After [X] Hours/Days

Dear [Partner Manager / Escalation Contact],

We are escalating Incident INC-[id] due to lack of resolution within the committed timeframe.

ESCALATION SUMMARY
- Original Report Date: [date]
- Follow-Ups Sent: [X] (dates: [list])
- Responses Received: [X] (summary: [brief])
- Current Status: Unresolved
- Time Open: [X hours/days]

CUSTOMER IMPACT
- [X] customers without service for [X hours/days]
- [X] customers have contacted support [Y] times total
- Revenue at risk: $[amount]
- Churn risk: [High — customers expressing frustration]

HISTORY OF ATTEMPTS
[Chronological timeline of all communications and actions]

REQUESTED RESOLUTION
[Specific ask with clear deadline]

We appreciate your immediate attention. Please acknowledge receipt and provide an estimated resolution time.

Regards,
[Manager Name]
Meow Mobile — Operations Management
CC: [internal-stakeholders]
```

---

### 3B. Vendor Communication — Third-Party Service Providers

**When:** Incident involves third-party vendors (payment processors, SMS gateway, email delivery, app infrastructure, etc.)

---

#### Initial Vendor Notification

**Template: Email — Vendor Incident Notification**

```
Subject: [PRIORITY] Support Request — [Issue Type] — Meow Mobile Account [account-id]

Dear [Vendor Support Team],

We are experiencing an issue with [service name] that is impacting our customers.

INCIDENT DETAILS
- Our Incident ID: INC-[id]
- Your Service: [Service/Product name]
- Our Account/Tenant ID: [account-id]
- Environment: Production
- Priority: [Critical / High / Medium]
- Date/Time Detected: [timestamp UTC]
- Impact Scope: [X customers affected / X transactions failed / service degraded]

ISSUE DESCRIPTION
[Precise technical description. Include API endpoints, error responses, status codes, request IDs, and any relevant logs.]

EXAMPLE FAILURE
- Request: [API endpoint or action]
- Request ID: [id]
- Timestamp: [time]
- Expected Response: [what should happen]
- Actual Response: [what happened — include error code/message]

WHAT WE HAVE VERIFIED
1. [Our system is sending correct payloads — verified at [time]]
2. [Issue reproduces consistently / intermittently since [time]]
3. [No changes on our side in last [X] days]
4. [Checked status page — [shows normal / shows incident]]

ACTION REQUESTED
[Specific ask — e.g., "Investigate failed API calls for our tenant between [time] and [time]"]

BUSINESS IMPACT
- Customer-facing service: [Description of what's broken for end users]
- SLA reference: [If applicable — your contract SLA terms]

Please acknowledge receipt and provide an incident number.

Thank you,
[Name]
Meow Mobile — Engineering/Operations
```

---

#### Vendor Follow-Up Communication

**Template: Email — Vendor Follow-Up (Loop)**

```
Subject: RE: [PRIORITY] Support Request — Follow-Up [#X] — Your Ticket [vendor-ticket-id]

Dear [Vendor Support],

Following up on our open support request (Your Ref: [vendor-ticket-id] / Our Ref: INC-[id]).

STATUS CHECK
- Days Since Report: [X]
- Current Impact: [Unchanged / Worsening / Partially mitigated]
- Workaround in Place: [Yes — describe / No]

ADDITIONAL INFORMATION
[Any new data points, logs, or findings since last update]

QUESTIONS
1. [Specific question about root cause]
2. [Specific question about ETA]
3. [Specific question about workaround]

Please provide an update by [date/time]. Our customer-facing SLA commitments are at risk.

Thank you,
[Name]
Meow Mobile
```

---

#### Vendor Escalation Communication

**Template: Email — Vendor Escalation**

```
Subject: [ESCALATION] Your Ticket [vendor-ticket-id] — Unresolved After [X] Days

Dear [Vendor Account Manager / Escalation Team],

We are escalating support request [vendor-ticket-id] (our ref: INC-[id]) due to unresolved status beyond our contractual SLA.

ESCALATION SUMMARY
- Original Report Date: [date]
- Follow-Ups Sent: [X]
- Current Status: Unresolved
- Time Open: [X days]
- Business Impact: [X customers affected, $[amount] revenue at risk]

CONTRACT REFERENCE
- SLA Tier: [your tier]
- Committed Response Time: [X hours]
- Committed Resolution Time: [X hours]
- Actual Response Time: [X hours]
- SLA Status: BREACHED

We require immediate escalation to your engineering team and a resolution timeline within 4 hours of this email.

Regards,
[Manager Name]
Meow Mobile — Operations Management
```

---

## Part 4: Follow-Up Communication Loops

### 4A. Follow-Up Cadence Matrix

| Severity | Internal Update | Customer Update | Partner/Vendor Update | Escalation Trigger       |
|----------|----------------|-----------------|----------------------|--------------------------|
| P1/CRITICAL | Every 2 hours | Every 4 hours | Every 2 hours | No response in 4 hours → Escalate |
| P2/HIGH     | Every 8 hours | Every 12 hours | Every 8 hours | No response in 24 hours → Escalate |
| P3/MEDIUM   | Every 24 hours | Every 48 hours | Every 24 hours | No response in 72 hours → Escalate |
| P4/LOW      | Every 48 hours | Every 72 hours | Every 48 hours | No response in 5 days → Escalate |

---

### 4B. Internal Follow-Up Templates

#### Slack — Incident Status Update (Recurring)

```
:arrows_counterclockwise: *INCIDENT UPDATE — INC-[id] — Update #[X]*

*Priority:* [P1/P2/P3/P4]
*Status:* [Investigating / Waiting on Partner / Waiting on Vendor / Fix in Progress / Monitoring]
*Time Open:* [X hours/days]
*Customer:* [name] <[email]>

*Since Last Update:*
- [What changed or what was done]
- [New information discovered]
- [Response received from partner/vendor (if any)]

*Blockers:*
- [What is blocking resolution — e.g., "Awaiting ConnectX response on error code R12"]

*Next Steps:*
1. [Action — who — by when]
2. [Action — who — by when]

*Next Update:* [timestamp]
*SLA Status:* :green_circle: On Track / :yellow_circle: At Risk / :red_circle: Breached

cc: @[owner]
```

---

#### Zendesk — Internal Note Follow-Up

```
## Internal Follow-Up Note — Update #[X]
**Timestamp:** [datetime]
**Updated by:** [agent/system]

### Status
[Current status and what has changed since last update]

### Actions Taken Since Last Update
1. [Action] — [Result]
2. [Action] — [Result]

### Pending Items
- [ ] [Item 1 — owner — due date]
- [ ] [Item 2 — owner — due date]

### Partner/Vendor Status
- ConnectX/Carrier: [Last response date] — [Summary]
- Vendor: [Last response date] — [Summary]

### Next Customer Communication
- Due: [timestamp]
- Channel: [Email / SMS / Ticket reply]
- Draft: [Brief summary of what to tell customer]

### Risk Assessment
- SLA: [On track / At risk / Breached]
- Churn risk: [Low / Medium / High]
- Escalation needed: [Yes — to whom / No]
```

---

### 4C. Customer Follow-Up Templates

#### Follow-Up #1 — Investigation In Progress

```
Subject: Update on your case — [Ticket ID]

Hi [Name],

I wanted to give you an update on your [issue type].

Here's where we stand:
- [What we've done since last contact]
- [What we're currently working on or waiting for]
- [What happens next]

Expected timeline: [When they should expect the next update or resolution]

You don't need to do anything right now. I'll reach out again by [date/time] with another update.

Thank you for your patience!

Best,
[Agent Name]
Meow Mobile Support
Reference: [Ticket ID]
```

---

#### Follow-Up #2 — Waiting on External Party

```
Subject: Update on your case — We're working with our partners

Hi [Name],

Quick update on your [issue type]:

We've identified that this requires coordination with [our network partner / our carrier partner / a third-party provider]. We've already reached out to them and are awaiting their response.

What this means for you:
- Your case is actively being worked on — it's not stuck in a queue
- Resolution depends on [partner/vendor] completing [action]
- We're following up with them [every X hours] to keep things moving

I'll update you again by [date/time], or sooner if there's good news.

Thank you for bearing with us — I know waiting is frustrating.

Best,
[Agent Name]
Meow Mobile Support
Reference: [Ticket ID]
```

---

#### Follow-Up #3 — Extended Delay Apology

```
Subject: Sincere apology — Update on your ongoing case

Hi [Name],

I owe you an update and an apology. Your [issue type] has taken longer than it should, and I'm sorry about that.

Here's the honest status:
- [What's causing the delay]
- [What we've done to try to resolve it]
- [What is still outstanding]

What I'm doing about it:
- I've escalated this to [senior team / partner management / engineering leadership]
- I've set a hard deadline of [date] for resolution
- I will personally update you by [date/time] — no later

[If applicable:]
As a gesture of goodwill, I've [applied a credit / extended your service / waived the charge].

I understand this experience hasn't met your expectations, and I'm committed to getting this resolved for you.

Best,
[Agent Name]
Meow Mobile Support
Reference: [Ticket ID]
```

---

#### Follow-Up — Checking In (No Customer Response)

```
Subject: Checking in — Do you still need help?

Hi [Name],

I reached out [X days] ago about [issue summary] and wanted to check if you still need help with this.

[If we took action:]
We [action taken — e.g., "sent a new QR code" / "re-submitted your port request"]. Were you able to [expected customer action — e.g., "install the eSIM" / "verify your number transferred"]?

[If waiting on customer info:]
To move forward, we still need [specific info]. Could you reply with that when you get a chance?

If everything is working now, great — no need to reply! I'll close this case in [3 days] if I don't hear back.

Best,
[Agent Name]
Meow Mobile Support
Reference: [Ticket ID]
```

---

## Part 5: Resolution & Close-Loop Communications

### 5A. Internal Resolution Communications

#### Zendesk — Resolution Internal Note

```
## RESOLVED — INC-[id]
**Resolved at:** [timestamp]
**Resolved by:** [agent/team]
**Time to Resolution:** [X hours/days]

### Resolution Summary
[What fixed the issue — be specific]

### Root Cause
[What caused the issue]

### Actions Taken
1. [Action 1] — [timestamp]
2. [Action 2] — [timestamp]
3. [Final fix] — [timestamp]

### Verification
- [How resolution was confirmed — e.g., "Customer confirmed service restored"]
- [System check — e.g., "eSIM status now ACTIVE in ConnectX"]
- [Monitoring — e.g., "No further errors in 2 hours"]

### Customer Communication
- Resolution email sent: [Yes/No] — [timestamp]
- Customer confirmed satisfied: [Yes/No/Pending]

### Follow-Up Required
- [ ] 48-hour check: Verify issue doesn't recur
- [ ] Billing adjustment needed: [Yes — details / No]
- [ ] Process improvement identified: [Yes — details / No]

### Prevention
[What should be done to prevent recurrence — for post-mortem]
```

---

#### Slack — Incident Resolved

```
:white_check_mark: *INCIDENT RESOLVED — INC-[id]*

*Priority:* [P1/P2/P3/P4]
*Duration:* [X hours/days]
*Customer:* [name] <[email]>

*Root Cause:* [One-line root cause]
*Fix:* [One-line resolution]
*Resolved by:* [agent/team]

*Key Metrics:*
- Time to detect: [X min/hours]
- Time to first response: [X min/hours]
- Time to resolution: [X hours/days]
- Customer contacts during incident: [X]
- SLA met: :green_circle: Yes / :red_circle: No

*Post-mortem needed:* [Yes — scheduled for [date] / No]
*Prevention:* [Brief note on what to improve]

cc: @[team-handle]
```

---

#### Slack — Systemic Incident Resolved

```
:white_check_mark: *SYSTEMIC INCIDENT RESOLVED*

*Incident:* INC-[id]
*Duration:* [X hours/days]
*Customers Affected:* [count]
*Customers Resolved:* [count]

*Root Cause:*
[2-3 sentence explanation]

*Resolution:*
[What was done to fix it]

*Impact Summary:*
| Metric                    | Value           |
|--------------------------|-----------------|
| Total customers affected | [X]             |
| Avg time without service | [X hours]       |
| Support tickets generated| [X]             |
| Estimated revenue impact | $[amount]       |
| SLA breaches             | [X]             |

*Immediate Actions Completed:*
1. [Action] — [Done]
2. [Action] — [Done]

*Preventive Actions (Scheduled):*
1. [Action — owner — deadline]
2. [Action — owner — deadline]

*Post-Mortem:* Scheduled for [date/time]
*Post-Mortem Doc:* [link]

cc: @engineering @cs-leads @management
```

---

### 5B. Customer Resolution Communications

#### Resolution — Issue Fixed (Proactive)

```
Subject: Good news — Your [issue type] is resolved!

Hi [Name],

Great news — the issue with your [specific issue] has been resolved!

What happened:
[1-2 sentence explanation in plain language — e.g., "There was a technical glitch in our eSIM system that prevented your activation. Our engineering team fixed it."]

What we did:
[Specific action — e.g., "We've activated a fresh eSIM profile for you. You should now have full service."]

What you should check:
1. [Verification step — e.g., "Restart your phone"]
2. [Verification step — e.g., "Check that you see 'Meow Mobile' as your carrier"]
3. [Verification step — e.g., "Try making a test call"]

[If applicable:]
We've also [applied a $[X] credit to your account / extended your plan by [X] days] for the inconvenience.

If anything still doesn't look right, just reply to this email — I'm personally monitoring your case for the next 48 hours.

Thanks for your patience, [Name]!

Best,
[Agent Name]
Meow Mobile Support
Reference: [Ticket ID]
```

---

#### Resolution — Issue Fixed (After Multiple Contacts)

```
Subject: Your issue is FINALLY resolved — and a personal apology

Hi [Name],

I'm happy to tell you that your [issue type] has been fully resolved.

I also want to personally apologize for how long this took. You reached out [X] times, and that's [X-1] times too many. You deserved a faster resolution, and I'm sorry we didn't deliver that.

Here's what was fixed:
[Clear explanation of what was wrong and what was done]

Here's what you should see now:
- [Expected behavior 1]
- [Expected behavior 2]

To make this right, we've [specific goodwill gesture — credit, free month, etc.].

I'll check in with you in 48 hours to make sure everything is still working perfectly. If you notice anything off before then, reply directly to this email — it comes straight to me.

Thank you for sticking with us, [Name]. We appreciate your patience more than you know.

Best,
[Agent Name]
Meow Mobile Support
Reference: [Ticket ID]
```

---

#### Resolution — Network/Service Outage Restored

```
Subject: Service restored in your area

Hi [Name],

The service disruption in your area has been resolved. Full service was restored at [time].

What happened:
[Brief, honest explanation — e.g., "A network configuration issue at our carrier partner caused intermittent connectivity in [region]."]

What we did:
[Resolution — e.g., "Our network team worked with our carrier partner to reconfigure the affected cells."]

If you're still experiencing issues:
1. Toggle Airplane Mode off and on
2. Restart your phone
3. If issues persist after 30 minutes, reply to this email

We've identified steps to prevent this from happening again and are implementing them with our network partner.

Sorry for the disruption, and thanks for your patience!

Meow Mobile Support
Reference: [Ticket ID]
```

---

### 5C. Partner Resolution Communications

#### Partner — Resolution Confirmation

```
Subject: RE: Incident INC-[id] — RESOLVED — Thank You

Dear [Partner Team],

We are pleased to confirm that Incident INC-[id] has been resolved.

RESOLUTION DETAILS
- Incident ID: INC-[id]
- Resolved At: [timestamp UTC]
- Root Cause: [description]
- Resolution: [what fixed it]
- Duration: [total time from detection to resolution]

AFFECTED CUSTOMERS — FINAL STATUS
| Customer Ref | Status Before | Status After | Confirmed |
|-------------|---------------|-------------|-----------|
| CUST-[id]   | [Failed]      | [Active]    | [Yes/No]  |

LESSONS LEARNED / PROCESS IMPROVEMENT
[If applicable — e.g., "We recommend adding monitoring for error code X to catch this earlier."]

FOLLOW-UP ITEMS
- [ ] [Any remaining action items between us]
- [ ] [Scheduled review call if needed]

Thank you for your support in resolving this. Please confirm receipt and that you consider this incident closed on your end.

Best regards,
[Name]
Meow Mobile — Operations Team
```

---

### 5D. Vendor Resolution Communications

#### Vendor — Resolution Confirmation

```
Subject: RE: Support Request [vendor-ticket-id] — Resolved — Please Close

Dear [Vendor Support],

Confirming that the issue reported under your ticket [vendor-ticket-id] (our ref: INC-[id]) has been resolved.

RESOLUTION SUMMARY
- Issue: [brief description]
- Root Cause: [as identified]
- Fix Applied: [by whom — vendor fix / our workaround / joint effort]
- Verified: [how — e.g., "Tested in production, X transactions processed successfully"]

REQUEST
Please close this ticket on your end. If there are any follow-up actions or preventive measures you recommend, we'd appreciate hearing them.

Thank you for your assistance.

Best regards,
[Name]
Meow Mobile
```

---

## Part 6: Ticket Closure Protocol

### Pre-Closure Checklist

Before closing any incident ticket, verify:

```
## Closure Checklist — INC-[id]

### Resolution Verified
- [ ] Root cause identified and documented
- [ ] Fix applied and confirmed working
- [ ] System status verified (eSIM active, port complete, payment processed, etc.)
- [ ] No recurrence in monitoring window (48h for P1/P2, 24h for P3/P4)

### Stakeholders Notified
- [ ] Customer notified of resolution (email/SMS sent)
- [ ] Customer confirmed satisfaction OR 72h passed with no response
- [ ] Internal team updated (Slack resolution posted)
- [ ] Partner notified and confirmed closure (if involved)
- [ ] Vendor notified and confirmed closure (if involved)

### Financials
- [ ] Billing adjustments applied (if needed)
- [ ] Credits/refunds processed (if promised)
- [ ] No outstanding financial discrepancies

### Documentation
- [ ] Resolution internal note added to Zendesk
- [ ] Tags updated (add: resolved, remove: in_progress)
- [ ] Post-mortem scheduled (if P1/P2 or systemic)
- [ ] Knowledge base updated (if new issue/resolution)

### Follow-Up
- [ ] 48-hour post-resolution check scheduled
- [ ] Preventive action items logged
```

---

### Auto-Close Rules

| Condition | Action | Customer Message |
|-----------|--------|-----------------|
| Resolved + customer confirmed | Close immediately | Thank you confirmation |
| Resolved + no customer response in 72h | Auto-close | "Closing as resolved" email |
| Waiting on customer info for 7 days | Auto-close as pending | "We'll reopen if you reply" email |
| Customer explicitly says "all good" | Close immediately | Brief thank you |

---

#### Auto-Close Notification — Resolved, No Response

```
Subject: Closing your case — [Ticket ID]

Hi [Name],

We reached out [X days] ago to let you know your [issue type] was resolved. Since we haven't heard back, we're assuming everything is working well and closing this case.

If you need anything in the future — or if this issue comes back — just reply to this email and we'll reopen your case immediately. No need to start over.

Thanks for being a Meow Mobile customer!

Best,
Meow Mobile Support
Reference: [Ticket ID]
```

---

#### Auto-Close Notification — Waiting on Customer

```
Subject: Closing your case for now — Reply anytime to reopen

Hi [Name],

We've been waiting to hear back from you about [issue / information needed]. Since it's been [X] days, we're closing this case for now.

No worries — if you still need help, just reply to this email and your case will reopen with all your history intact. You won't have to start from scratch.

We're here whenever you're ready!

Best,
Meow Mobile Support
Reference: [Ticket ID]
```

---

#### Thank You — Final Closure (Customer Confirmed)

```
Subject: Glad we could help!

Hi [Name],

Happy to hear everything is working! Your case is now closed.

Quick reminder: if you ever need help, you can:
- Reply to any of our emails
- Chat with us in the Meow Mobile app
- Visit meowmobile.com/support

Thanks for being part of the Meow Mobile family!

Best,
[Agent Name]
Meow Mobile Support
```

---

## Part 7: Communication Orchestration Rules

### De-Duplication
- Never send more than one proactive + one follow-up message within the same 24h window for the same root cause
- Merge related signals into a single communication (e.g., SIG-002 + SIG-008 = one email addressing both)
- If customer contacts us after we sent proactive outreach, reference our earlier message

### Follow-Up Loop Automation

```
Incident Created
    |
    +---> Schedule follow-up based on severity
    |         |
    |         +---> [P1] Internal: 2h | Customer: 4h | Partner: 2h
    |         +---> [P2] Internal: 8h | Customer: 12h | Partner: 8h
    |         +---> [P3] Internal: 24h | Customer: 48h | Partner: 24h
    |         +---> [P4] Internal: 48h | Customer: 72h | Partner: 48h
    |
    +---> After each follow-up:
              |
              +---> Issue resolved? → Go to Resolution Flow
              +---> Response received? → Update, reschedule next follow-up
              +---> No response? → Escalate (see escalation triggers above)
              +---> Loop continues until RESOLVED or CLOSED
```

### Escalation Triggers Within Loops

| Scenario | Trigger | Action |
|----------|---------|--------|
| Partner silent | No response after 2 follow-ups | Escalate to partner management |
| Vendor silent | No response after 2 follow-ups | Escalate via contract SLA terms |
| Customer silent (resolved) | No response 72h post-resolution | Auto-close with notification |
| Customer silent (unresolved) | No response 7 days | Auto-close as pending |
| SLA breach imminent | <2h before SLA deadline | Alert #cs-urgent + escalate one tier |

### Tone Escalation by Follow-Up Number

| Follow-Up # | Internal Tone | Customer Tone | Partner/Vendor Tone |
|-------------|---------------|---------------|---------------------|
| 1st | Informational | Reassuring, proactive | Professional, clear |
| 2nd | Flagging concern | Empathetic, transparent | Firm, requesting timeline |
| 3rd | Urgent, SLA-focused | Apologetic, taking ownership | Escalation warning |
| 4th+ | Escalation-required | Executive empathy, concrete commitments | Formal escalation |

---

## Part 8: Post-Mortem Communication (P1/P2 and Systemic Incidents)

### Internal Post-Mortem Template

```
## Post-Mortem — INC-[id]
**Date:** [date]
**Attendees:** [names/teams]
**Severity:** [P1/P2]
**Duration:** [X hours/days]

### Timeline
| Time (UTC)  | Event                                    |
|------------|------------------------------------------|
| [time]     | Issue first detected by [signal/report]  |
| [time]     | Internal alert sent                      |
| [time]     | Customer notified                        |
| [time]     | Partner/vendor engaged                   |
| [time]     | Root cause identified                    |
| [time]     | Fix applied                              |
| [time]     | Resolution verified                      |
| [time]     | All stakeholders notified                |
| [time]     | Ticket closed                            |

### What Went Well
- [Item 1]
- [Item 2]

### What Went Wrong
- [Item 1]
- [Item 2]

### Action Items
| # | Action                  | Owner    | Deadline  | Status  |
|---|-------------------------|----------|-----------|---------|
| 1 | [Preventive action]     | [name]   | [date]    | Open    |
| 2 | [Process improvement]   | [name]   | [date]    | Open    |
| 3 | [Monitoring addition]   | [name]   | [date]    | Open    |
```

---

## Parameters

- `incident_id`: Required — Incident identifier
- `severity`: Required — P1/P2/P3/P4
- `signal_id`: Optional — Proactive signal reference
- `customer_email`: Required — Customer identifier
- `communication_type`: Required — "internal" / "customer" / "partner" / "vendor"
- `communication_stage`: Required — "creation" / "follow_up" / "escalation" / "resolution" / "closure"
- `follow_up_number`: Optional — Which follow-up iteration (1, 2, 3...)
- `partner_name`: Optional — ConnectX / AT&T / other
- `vendor_name`: Optional — Payment processor / SMS gateway / other
- `ticket_id`: Optional — Zendesk ticket reference

## Example Usage

```
Event: eSIM provisioning fails for customer jane@example.com

CREATION:
1. Zendesk ticket created with [INCIDENT] P1 tag and full context
2. Slack alert sent to #esim-support and #cs-urgent
3. Mochi context injected for proactive greeting
4. Partner email sent to ConnectX requesting investigation
5. Customer email sent: "We detected an issue and are already working on it"

FOLLOW-UP LOOP (P1 cadence):
6. +2h: Internal Slack update — "Waiting on ConnectX response"
7. +2h: Partner follow-up #1 — "Requesting update"
8. +4h: Customer follow-up #1 — "Still working on it, coordinating with partner"
9. +6h: Partner follow-up #2 — "Escalation warning"
10. +8h: Internal escalation — "No ConnectX response, paging engineering"

RESOLUTION:
11. ConnectX resolves provisioning issue
12. Agent verifies eSIM is ACTIVE
13. Customer email: "Good news — your eSIM is resolved!"
14. Internal Slack: "RESOLVED" notification with metrics
15. Partner email: "Resolved — please confirm closure"

CLOSURE:
16. Customer confirms "it works!" → Thank you email → Close ticket
17. OR: 72h no response → Auto-close notification → Close ticket
18. Post-mortem scheduled for systemic review
19. Knowledge base updated
```
