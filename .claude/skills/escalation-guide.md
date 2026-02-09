# Escalation Guide

Determine when and how to escalate customer issues to the appropriate team, with what information, and what to tell the customer.

## Description

This skill defines escalation criteria, routing rules, and handoff procedures for issues that cannot be resolved at L1. It ensures consistent escalation with proper context preservation.

## Triggers

- "need to escalate"
- "this needs L2"
- "I can't resolve this"
- "who handles this"
- "manager needed"
- "engineering issue"
- "carrier problem"
- "escalate to"
- "handoff"

## Escalation Tiers

| Tier | Role | Handles | Response Time |
|------|------|---------|---------------|
| **L0** | Mochi Bot | FAQs, simple lookups, routine requests | Instant |
| **L1** | CS Agents | Standard troubleshooting, most issues | < 4 hours |
| **L2** | Senior CS | Complex issues, account exceptions | < 24 hours |
| **Engineering** | Backend team | System bugs, provisioning failures | < 48 hours |
| **Trust & Safety** | T&S team | Fraud, AUP, security | < 24 hours |
| **Carrier** | ConnectX/AT&T | Network issues, port-in escalations | 24-72 hours |

## When to Escalate

### DO Escalate If:

| Condition | Escalate To |
|-----------|-------------|
| Issue persists after all troubleshooting steps | L2 |
| Customer stuck >72 hours | L2 (priority) |
| System error/bug identified | Engineering |
| Payment refund >$100 | L2 (approval required) |
| Account suspension appeal | Trust & Safety |
| Fraud suspected | Trust & Safety |
| Network outage affecting multiple users | Engineering + Carrier |
| Port-in rejected 3+ times | Carrier team |
| Legal/compliance request | Legal |
| VIP/influencer customer | L2 (special handling) |
| Customer threatening legal action | L2 + Legal |
| Data breach or security incident | Trust & Safety (urgent) |

### DO NOT Escalate If:

- You haven't tried all applicable troubleshooting steps
- Customer just wants to speak to a manager (offer solution first)
- Issue can be resolved with available tools
- You need more information from the customer (ask them first)
- It's a known issue with a documented workaround

## Escalation Paths

### Path 1: L1 → L2 (Senior CS)

**When:**
- Complex billing disputes
- Account exceptions needed
- Multi-ticket issues spanning weeks
- Customer SLO breach (>72 hours)
- Retention offers needed
- Refunds >$100

**How:**
```
1. Add comprehensive internal note (see template below)
2. Change ticket status to "Escalated"
3. Assign to L2 group/queue
4. Inform customer of escalation and timeline
```

**Customer message (Chat):**
```
I'm bringing in a senior specialist to help with this. They'll review everything we've discussed and follow up within 24 hours.

You don't need to explain again - I've documented everything so they can pick up right where we left off.

Is there anything else you'd like me to note before I hand this over?
```

**Customer message (Email):**
```
Subject: Re: [Issue] - Escalated to specialist team

Hi [Name],

Thank you for your patience on this issue.

I've escalated your case to a senior specialist on our team who handles [type of issue]. They have more tools and authority to resolve this properly.

Here's what to expect:
- You'll hear back within 24 hours at this email address
- You won't need to re-explain anything - I've documented our entire conversation
- Your reference number is: [Ticket ID]

If anything urgent comes up in the meantime, just reply to this email.

Best,
[Agent Name]
Meow Mobile Support
```

---

### Path 2: L1 → Engineering

**When:**
- eSIM provisioning stuck in backend
- SIM swap failing repeatedly
- API errors in customer tools
- System-wide issue affecting multiple customers
- Data inconsistency between systems
- App crashes preventing customer action

**How:**
```
1. Collect all error messages and timestamps
2. Document exact repro steps
3. Create engineering ticket (Jira or internal tool)
4. Link Zendesk ticket to engineering ticket
5. Set customer expectation (48-72 hours)
```

**Engineering escalation note:**
```
## Engineering Escalation

**Issue:** [One-line summary]
**Customer Impact:** [What customer can't do]
**Urgency:** P1 / P2 / P3

### Environment
- Customer ID: [id]
- Device: [model]
- App Version: [version]
- OS Version: [iOS/Android version]

### Repro Steps
1. [Step 1]
2. [Step 2]
3. [Step 3]
Expected: [what should happen]
Actual: [what happens]

### Error Details
- Error message: [exact text]
- Error code: [if any]
- Timestamp: [when it occurred]

### What Was Tried
- [Step 1] → [Result]
- [Step 2] → [Result]
```

**Customer message:**
```
I've identified this as a technical issue that needs our engineering team to investigate.

I've created a priority ticket for them with all the details. They typically respond within 48 hours, but I'll personally follow up to make sure this moves along.

In the meantime, is there anything else I can help with?
```

---

### Path 3: L1 → Trust & Safety

**When:**
- Account suspension appeal
- Fraud investigation
- AUP violation review
- Account takeover/security breach
- Harassment or abuse
- Identity theft claim

**How:**
```
1. Do NOT share details of why account was flagged
2. Collect customer's statement/explanation
3. Forward to T&S queue with context
4. Set expectation: 24-48 hours for review
5. Do NOT make promises about outcome
```

**T&S escalation note:**
```
## Trust & Safety Escalation

**Case Type:** Suspension Appeal / Fraud Review / Security Incident / AUP Review
**Customer:** [email]
**Account Status:** [current status]

### Reason for Escalation
[Why T&S review is needed]

### Customer's Statement
"[Customer's explanation in their own words]"

### Agent Observations
- [Relevant context]
- [Conversation tone]
- [Red flags if any]

### Verification Completed
- Identity verified via: [method] OR
- Unable to verify because: [reason]
```

**Customer message:**
```
I've submitted your case to our specialized review team. They handle these situations with extra care.

You'll hear back at [email] within 24-48 hours. Please check your inbox and spam folder.

I've included everything you've shared with me in the review request.
```

---

### Path 4: L1 → Carrier (ConnectX/AT&T)

**When:**
- Port-in rejected 3+ times with correct info
- Network provisioning failure on carrier side
- Widespread network outage
- SIM activation rejected by carrier
- Number not releasing from old carrier

**How:**
```
1. Document all attempts with timestamps
2. Collect specific error codes/reasons
3. File carrier escalation via internal tool
4. Response time: 24-72 business hours
```

**Carrier escalation note:**
```
## Carrier Escalation

**Issue:** Port-In Stuck / Activation Failure / Network Issue
**Carrier:** AT&T / T-Mobile / [Original carrier]
**Customer:** [email]

### Details
- Phone Number: [number]
- Account Number (old carrier): [masked]
- Port Request ID: [if applicable]

### Timeline
- [Date]: Initial attempt - [result]
- [Date]: Retry - [result]
- [Date]: Current status

### Error from Carrier
- Rejection Code: [code]
- Rejection Reason: [full text]

### Request
[What we need carrier to do]
```

**Customer message:**
```
This issue requires coordination with [carrier name]. I've filed a request with our carrier team who will work directly with them.

Carrier issues typically take 2-3 business days to resolve. I'll check in daily and update you as soon as there's movement.

Your current service will continue normally in the meantime.
```

---

### Path 5: Urgent/Critical Escalation

**When (escalate immediately):**
- Customer reports emergency/safety risk
- Widespread service outage (>10 customers)
- Security breach or data leak
- Legal/regulatory deadline
- Media/press inquiry
- Executive customer complaint

**How:**
```
1. Slack #cs-urgent immediately with @channel
2. Include: Customer email, issue summary, urgency reason
3. Page on-call if after hours (security/outage)
4. DO NOT wait for normal queue processing
```

**Urgent alert format:**
```
@channel URGENT ESCALATION

Customer: [email]
Issue: [one line]
Why urgent: [reason]
Immediate risk: [what could happen if delayed]

Need triage NOW.
```

---

## Escalation Note Template

Use this for ANY escalation:

```
## ESCALATION NOTE

### Summary
[2-3 sentence summary]

### Customer
- Email: [email]
- Account ID: [id]
- Customer since: [date]
- Account status: [status]

### Issue Details
- Category: eSIM / Port-In / Payment / Network / Account / Other
- First reported: [date]
- Issue duration: [X days]
- Related tickets: [IDs]

### What Customer Wants
[Specific desired outcome]

### What Was Tried
1. [Step] → [Result]
2. [Step] → [Result]
3. [Step] → [Result]

### Why Escalating
[Specific reason]

### Recommended Resolution
[Your suggestion]

### Urgency
- [ ] Low (standard queue)
- [ ] Medium (within 24h)
- [ ] High (within 4h)
- [ ] Critical (immediate)

### Customer Sentiment
Frustrated / Angry / Understanding / Neutral
```

## What to Tell Customers

### DO Say:
- "I'm bringing in a specialist who handles these types of issues"
- "I've documented everything so you won't need to repeat yourself"
- "You'll hear back within [realistic timeframe]"
- "I'll personally follow up to make sure this moves forward"

### DON'T Say:
- "There's nothing I can do"
- "That's not my department"
- "You'll have to wait"
- "I don't know when you'll hear back"

## After Escalation

**Add ticket tags:**
- `escalated_l2` / `escalated_engineering` / `escalated_ts` / `escalated_carrier`
- `slo_at_risk` (if customer stuck >48h)
- `priority_high` (if critical)

**Set follow-up reminders:**
- L2 issues: 24 hours
- Engineering: 48 hours
- Carrier: 72 hours

**Follow-up message if no response within SLA:**
```
Hi [Name], just checking in on your case.

I see it's still with our [team] team. Let me ping them again to make sure it's moving along.

I'll update you as soon as I hear back. Thanks for your patience!
```

## Parameters

- `issue_type`: Required - Category of issue
- `urgency`: Required - Low/Medium/High/Critical
- `escalation_target`: Required - L2/Engineering/T&S/Carrier/Legal
- `customer_email`: Required - Customer identifier

## Example Usage

```
Agent: "Customer's port-in has failed 4 times, we've verified everything"

LLM:
1. Recognizes carrier escalation criteria (3+ failures)
2. Generates carrier escalation note
3. Provides customer message about timeline
4. Suggests escalated_carrier tag
5. Sets 72-hour follow-up reminder
```

```
Agent: "Customer furious, stuck for 5 days, nothing working"

LLM:
1. Recognizes SLO breach (>72 hours)
2. Flags as priority L2 escalation
3. Compiles full history
4. Generates comprehensive note
5. Provides empathetic customer message
```
