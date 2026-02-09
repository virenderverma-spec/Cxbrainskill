# Proactive Communication Engine

Detect customer journey signals, classify severity, and orchestrate internal + external communications before the customer has to ask for help.

## Description

This skill powers the "Customer-First Proactive Detection Engine." It monitors customer journey events, identifies issues or risk signals, and generates two communication streams: **internal alerts** (to L0/L1/L2 teams for action) and **external outreach** (to customers for transparency and resolution). The goal: the customer should never have to tell us something is broken — we should tell them first.

## Triggers

- Journey event detected (eSIM stuck, payment failed, port-in rejected, order stalled)
- SLA breach risk (customer waiting too long)
- Repeated contact pattern (3+ touches on same issue)
- Mochi escalation with no human follow-up
- System-wide incident affecting multiple customers

---

## Signal Detection Framework

### Journey Signals — What to Watch

| Signal ID | Event | Detection Rule | Severity | Time Window |
|-----------|-------|---------------|----------|-------------|
| `SIG-001` | eSIM stuck in PENDING | eSIM status = PENDING AND payment_completed > 48h ago | HIGH | Check every 15 min |
| `SIG-002` | eSIM provisioning FAILED | eSIM status = ERROR or FAILED | CRITICAL | Real-time on status change |
| `SIG-003` | Payment failed | Order exists, payment_completed = NULL, order_created > 2h ago | MEDIUM | Check every 30 min |
| `SIG-004` | Port-in rejected | portin_response contains FAILED or REJECTED | HIGH | Real-time on status change |
| `SIG-005` | Port-in stalled | Port status = SUBMITTED for > 72h | MEDIUM | Check every 1h |
| `SIG-006` | Order stuck | Order status != COMPLETED AND order_created > 24h | MEDIUM | Check every 1h |
| `SIG-007` | Mochi escalation abandoned | Mochi escalated = true, no Zendesk ticket created within 2h | HIGH | Check every 30 min |
| `SIG-008` | Repeat contact | Same customer, 3+ touches (Zendesk + Mochi) within 7 days | HIGH | On every new contact |
| `SIG-009` | Silent churn risk | Payment completed, eSIM never installed, no contact in 7+ days | MEDIUM | Daily scan |
| `SIG-010` | Network outage impact | Customer in affected ZIP, has open ticket or recent Mochi chat | HIGH | On outage detection |

### Severity Levels

| Level | Meaning | Internal Response Time | Customer Outreach |
|-------|---------|----------------------|-------------------|
| **CRITICAL** | Service broken, customer impacted now | < 30 min | Immediate |
| **HIGH** | Issue will escalate if not addressed | < 2 hours | Within 4 hours |
| **MEDIUM** | Potential issue, customer may not know yet | < 8 hours | Within 24 hours |
| **LOW** | Informational, opportunity to delight | Best effort | Optional |

---

## Communication Architecture

```
Signal Detected
      |
      v
+------------------+
| Signal Classifier |  -- determines severity, affected teams, communication type
+--------+---------+
         |
    +----+----+
    |         |
    v         v
INTERNAL   EXTERNAL
COMMS      COMMS
    |         |
    v         v
+-------+  +--------+
| L0    |  | Email  |
| Mochi |  | SMS    |
| Auto  |  | Push   |
+-------+  | In-App |
    |      +--------+
    v
+-------+
| L1    |
| Agent |
| Alert |
+-------+
    |
    v
+-------+
| L2    |
| Eng   |
| Ops   |
+-------+
```

---

## Internal Communications

### Audience: L0 — Mochi (Automated)

**Purpose:** Arm Mochi with context so if the customer reaches out to the chatbot, Mochi already knows the issue and can proactively address it instead of asking "How can I help?"

**Format: Mochi Context Injection**

```
{
  "customer_email": "[email]",
  "proactive_context": {
    "signal": "SIG-002",
    "issue": "eSIM provisioning failed on order #[orderId]",
    "detected_at": "[timestamp]",
    "customer_impact": "Customer has no service despite paying [X] days ago",
    "resolution_status": "SIM swap initiated by L1 agent",
    "what_to_tell_customer": "We detected an issue with your eSIM and our team is already working on it. A new eSIM profile is being prepared."
  }
}
```

**Mochi Behavior When Context Exists:**
- Greet with: "Hi [Name], I see we're already working on your eSIM issue. Let me give you an update..."
- Skip diagnostic questions — go straight to status update
- If resolution is pending: "Our team is on it. You should receive your new QR code within [timeframe]."
- If resolved: "Great news — your issue has been fixed! Here's what to do next..."

---

### Audience: L1 — CS Agents (Zendesk Alert)

**Purpose:** Create a prioritized ticket with full context so the agent knows exactly what happened, what to do, and what to tell the customer.

**Format: Proactive Alert Ticket**

```
Subject: [PROACTIVE] [Signal Label] — [Customer Name] ([email])

## Proactive Detection Alert

**Signal:** [SIG-XXX] [Signal name]
**Severity:** [CRITICAL / HIGH / MEDIUM]
**Detected:** [timestamp]
**Customer:** [name] ([email])

### What Happened
[2-3 sentences explaining the issue in plain language]

### Customer Impact
- Service status: [Active / No service / Degraded]
- Days since payment: [X]
- Has customer contacted us? [Yes — X times / No]
- Customer sentiment risk: [Low / Medium / High — based on touch count and issue duration]

### Customer Journey Snapshot
- Order: [orderId] — [status]
- eSIM: [status]
- Payment: [completed/pending] — [date]
- Port-in: [status if applicable]
- Last contact: [channel] — [date] — [topic]
- Total touches: [X] across [channels]

### Recommended Action
[Specific action — e.g., "Trigger SIM swap and send new QR code"]

### Steps
1. [Step 1]
2. [Step 2]
3. [Step 3]

### Draft Customer Message
[Pre-written message ready to send — see External Communications section]

### ConnectX Actions Available
- [ ] Swap eSIM (individualId: [id])
- [ ] Cancel Order (orderId: [id])
- [ ] Resume Service (individualId: [id])

### SLA
- Respond to customer within: [X hours]
- Follow up to confirm resolution: [X hours]
```

**Ticket Properties:**
- Priority: Mapped from severity (CRITICAL=Urgent, HIGH=High, MEDIUM=Normal)
- Tags: `proactive_alert`, `signal_[id]`, `severity_[level]`
- Group: Auto-assign based on signal type (eSIM → eSIM specialists, Port-in → Port team)
- Internal note: Full diagnostic data (API responses, timestamps, journey state)

---

### Audience: L2 / Engineering / Ops (Slack + Zendesk)

**Purpose:** Escalation-ready context for complex or systemic issues. Triggered when signal is CRITICAL or when multiple customers are affected.

**Format: Slack Alert**

```
:rotating_light: *PROACTIVE ALERT — [SEVERITY]*

*Signal:* [SIG-XXX] [Description]
*Customer:* [name] <[email]>
*Impact:* [one-line impact statement]

*Key Data:*
- Order: `[orderId]` — [status]
- eSIM: [status] since [timestamp]
- Touches: [X] in last [Y] days
- Duration: [X] days since issue started

*Action Needed:* [what L2/Eng needs to do]
*Zendesk:* [ticket link]

cc: @[team-handle]
```

**When to Alert L2/Eng:**
- CRITICAL signals always
- HIGH signals if unresolved after 4 hours
- Any signal affecting 3+ customers simultaneously (systemic)
- When L1-recommended ConnectX action fails

**Format: Systemic Issue Alert (Multi-Customer)**

```
:warning: *SYSTEMIC ISSUE DETECTED*

*Pattern:* [X] customers with [signal type] in last [timeframe]
*Affected customers:*
| Customer | Order | Status | Duration |
|----------|-------|--------|----------|
| [email1] | [id]  | [state]| [Xh]    |
| [email2] | [id]  | [state]| [Xh]    |
| [email3] | [id]  | [state]| [Xh]    |

*Common Factor:* [e.g., all port-ins from Verizon, all orders after 2pm EST]
*Root Cause Hypothesis:* [if detectable]

*Recommended:*
1. [Immediate action]
2. [Investigation needed]
3. [Customer communication plan]

cc: @engineering @cs-leads
```

---

## External Communications

### Principles

1. **Acknowledge before they ask** — "We noticed an issue" beats "We're sorry you're experiencing"
2. **Be specific** — Reference their actual order, actual status, actual timeline
3. **Give a timeline** — Always include when they'll hear back or when it will be fixed
4. **One action max** — If they need to do something, make it one clear thing
5. **Match the channel** — Email for detailed updates, SMS/push for urgent alerts, in-app for status changes

### Channel Selection Matrix

| Severity | Has Open Ticket? | Channel | Timing |
|----------|-----------------|---------|--------|
| CRITICAL | Yes | Reply on ticket + SMS | Immediate |
| CRITICAL | No | Email + SMS + Push | Immediate |
| HIGH | Yes | Reply on ticket | Within 4h |
| HIGH | No | Email | Within 4h |
| MEDIUM | Yes | Internal note (agent follows up) | Within 24h |
| MEDIUM | No | Email (soft touch) | Within 24h |
| LOW | Any | In-app notification or none | Best effort |

---

### Signal-Specific Customer Messages

#### SIG-001: eSIM Stuck in PENDING (>48h)

**Subject:** Your Meow Mobile eSIM is ready to install

```
Hi [Name],

We noticed you completed your payment [X] days ago but haven't installed your eSIM yet. Your eSIM profile is ready and waiting for you!

Here's how to get set up (takes about 2 minutes):

1. Open Settings on your phone
2. Tap Cellular (iPhone) or Network & Internet (Android)
3. Tap "Add eSIM" or "Add Cellular Plan"
4. Scan the QR code from your confirmation email

If you can't find your QR code, just reply to this email and I'll resend it right away.

Need help? We're here — just reply to this email or chat with us in the Meow Mobile app.

Best,
[Agent Name]
Meow Mobile Support
```

**Internal note:** Proactive outreach sent. Customer has not installed eSIM [X] days after payment. QR code was sent on [date]. Monitor for response within 48h.

---

#### SIG-002: eSIM Provisioning FAILED

**Subject:** Action needed: We're fixing your eSIM activation

```
Hi [Name],

We detected a technical issue with your eSIM activation and our team is already on it.

Here's what happened: Your payment was processed successfully, but the eSIM profile hit a provisioning error. This is a system-side issue — nothing you did wrong.

What we're doing: We're generating a fresh eSIM profile for you right now. You'll receive a new QR code at this email within [15 minutes / 1 hour].

What you'll need to do: Once you get the new QR code, just scan it to install your eSIM. We'll include step-by-step instructions.

I'll follow up personally to make sure everything is working. Sorry for the hiccup!

Best,
[Agent Name]
Meow Mobile Support
```

**Internal note:** CRITICAL proactive alert — eSIM FAILED for [email]. SIM swap [initiated/needed]. Follow up in 2h to confirm resolution.

---

#### SIG-003: Payment Failed

**Subject:** Quick update on your Meow Mobile order

```
Hi [Name],

We noticed your recent payment for Meow Mobile didn't go through. This sometimes happens with bank security checks — it's usually an easy fix.

Here are a few things to try:
- Make sure your card details are up to date in the app
- Try a different payment method
- Check with your bank that they're not blocking "Meow Mobile" or "Gather Inc."

You can retry your payment in the Meow Mobile app: Settings > Payment Method.

If you're still having trouble, just reply here and I'll help you sort it out.

Best,
Meow Mobile Support
```

---

#### SIG-004: Port-in Rejected

**Subject:** Your number transfer needs a quick update

```
Hi [Name],

We tried to transfer your phone number ([masked number]) to Meow Mobile, but your previous carrier flagged an issue. This is common and usually fixable.

The most likely causes:
- Account number or PIN doesn't match their records
- Your old account has a port-out block
- The name on file doesn't match exactly

To fix this, please:
1. Contact [old carrier] and verify your account number and transfer PIN
2. Ask them to remove any port-out restrictions
3. Reply to this email with the confirmed details

Once we have the right info, we can reattempt the transfer — it usually completes within 24-48 hours after that.

We're here to help if you need anything!

Best,
[Agent Name]
Meow Mobile Support
```

---

#### SIG-007: Mochi Escalation Abandoned

**Subject:** Following up on your chat with us

```
Hi [Name],

I noticed you were chatting with our support bot earlier about [topic from Mochi]. It looks like we didn't get a chance to fully resolve your issue.

I've reviewed your conversation and here's what I can see: [brief summary of issue].

[If actionable:]
I've gone ahead and [action taken — e.g., "checked your eSIM status and it looks like..."]. Here's what I'd recommend: [next step].

[If needs more info:]
To help get this sorted, could you reply with [specific info needed]?

Either way, you have a real human on this now. I'll make sure it gets resolved.

Best,
[Agent Name]
Meow Mobile Support
```

---

#### SIG-008: Repeat Contact (3+ touches)

**Subject:** Re: Your ongoing issue — I'm taking ownership

```
Hi [Name],

I can see you've reached out [X] times about this issue, and I want to sincerely apologize that it's taken this long. That's not the experience you should have with us.

Here's what I know:
- [Summary of the issue across all contacts]
- [What's been tried so far]
- [Current status]

I'm personally taking ownership of your case. Here's my plan:
1. [Immediate action]
2. [Next step with timeline]
3. [When they'll hear back]

You won't need to explain this again to anyone else. I'll see it through to resolution and check in with you [specific follow-up time].

Thank you for your patience, [Name].

Best,
[Agent Name]
Meow Mobile Support
```

**Internal note:** HIGH PRIORITY — Repeat contact customer ([X] touches). Agent [name] taking ownership. Issue: [summary]. Must resolve within [SLA].

---

#### SIG-009: Silent Churn Risk

**Subject:** Need help setting up your Meow Mobile?

```
Hi [Name],

Welcome to Meow Mobile! I noticed you signed up [X] days ago but haven't activated your eSIM yet. Wanted to check in and see if you need any help getting started.

Setting up takes about 2 minutes:
1. Check your email for the QR code we sent on [date]
2. On your phone: Settings > Cellular > Add eSIM > Scan QR code
3. That's it! Your Meow Mobile line will appear in about 30 seconds

If you're having trouble or have questions about anything, just reply to this email. We're happy to walk you through it.

Looking forward to getting you connected!

Best,
Meow Mobile Support
```

---

#### SIG-010: Network Outage Impact

**Subject:** Service alert for your area

```
Hi [Name],

We're aware of a service disruption in your area that may be affecting your Meow Mobile service. Our network team is actively working to restore full coverage.

What we know:
- Area affected: [region/ZIP]
- Started: [time]
- Estimated restoration: [time or "we're working on it"]
- Impact: [calls/data/texts affected]

What you can try in the meantime:
- Toggle Airplane Mode on and off
- If urgent, connect to WiFi for WiFi Calling

We'll send another update when service is fully restored. No need to contact us — we're on it.

Sorry for the inconvenience!

Meow Mobile Support
```

---

## Communication Orchestration Rules

### De-duplication
- Don't send multiple proactive messages for the same root cause within 24h
- If customer contacts us AFTER we send proactive outreach, reference our message: "I see we reached out to you earlier about this..."
- Merge signals: if SIG-002 (eSIM failed) + SIG-008 (repeat contact), send ONE message addressing both

### Escalation Ladder
```
Signal detected
    |
    +---> [MEDIUM] Internal alert only. Agent follows up if customer contacts.
    |
    +---> [HIGH] Internal alert + customer email within 4h.
    |         |
    |         +---> No response in 24h? Follow up.
    |         +---> Issue persists 48h? Escalate to L2.
    |
    +---> [CRITICAL] Internal alert + immediate customer contact + Slack L2/Eng.
              |
              +---> No resolution in 2h? Page engineering.
              +---> No customer response in 4h? SMS/call.
```

### Tone Calibration
| Touch Count | Customer Tone | Our Tone |
|------------|---------------|----------|
| 1st contact | Neutral | Helpful, proactive |
| 2nd contact | Slightly frustrated | Empathetic, specific |
| 3rd contact | Frustrated | Apologetic, ownership |
| 4th+ contact | Angry/dejected | Urgent, executive-level empathy, concrete commitment |

---

## Implementation: Databricks Detection Queries

### SIG-001: eSIM Stuck in PENDING >48h

```sql
SELECT sc.customer_email, sc.customer_name, o.order_id, o.esim_status,
       uf.payment_completed_time,
       DATEDIFF(HOUR, uf.payment_completed_time, CURRENT_TIMESTAMP()) as hours_since_payment
FROM `rds-prod_catalog`.cj_prod.stripe_customers sc
JOIN `rds-prod_catalog`.cj_prod.mvno_order o ON sc.user_id = o.user_id
JOIN `rds-prod_catalog`.cj_prod.user_onboarding_flow uf ON o.order_id = uf.order_id
WHERE UPPER(o.esim_status) = 'PENDING'
  AND uf.payment_completed_time IS NOT NULL
  AND uf.activation_completed_time IS NULL
  AND DATEDIFF(HOUR, uf.payment_completed_time, CURRENT_TIMESTAMP()) > 48
ORDER BY hours_since_payment DESC
```

### SIG-002: eSIM Failed

```sql
SELECT sc.customer_email, sc.customer_name, o.order_id, o.esim_status, o.status as order_status,
       o.created_at as order_date
FROM `rds-prod_catalog`.cj_prod.stripe_customers sc
JOIN `rds-prod_catalog`.cj_prod.mvno_order o ON sc.user_id = o.user_id
WHERE UPPER(o.esim_status) IN ('ERROR', 'FAILED')
  AND o.created_at > DATEADD(DAY, -7, CURRENT_TIMESTAMP())
ORDER BY o.created_at DESC
```

### SIG-008: Repeat Contacts (3+ in 7 days)

```sql
WITH touches AS (
  SELECT sc.customer_email, sc.customer_name,
    (SELECT COUNT(*) FROM prod_catalog.customer_support.zendesk_tickets zt
     WHERE zt.requester_id IN (SELECT id FROM prod_catalog.customer_support.zendesk_users zu WHERE zu.email = sc.customer_email)
     AND zt.created_at > DATEADD(DAY, -7, CURRENT_TIMESTAMP())) as ticket_count,
    (SELECT COUNT(*) FROM `rds-prod_catalog`.cj_prod.conversations c
     WHERE c.user_id = sc.user_id
     AND c.created_at > DATEADD(DAY, -7, CURRENT_TIMESTAMP())) as mochi_count
  FROM `rds-prod_catalog`.cj_prod.stripe_customers sc
)
SELECT *, (ticket_count + mochi_count) as total_touches
FROM touches
WHERE (ticket_count + mochi_count) >= 3
ORDER BY total_touches DESC
```

### SIG-009: Silent Churn Risk

```sql
SELECT sc.customer_email, sc.customer_name, o.order_id,
       uf.payment_completed_time,
       DATEDIFF(DAY, uf.payment_completed_time, CURRENT_TIMESTAMP()) as days_since_payment
FROM `rds-prod_catalog`.cj_prod.stripe_customers sc
JOIN `rds-prod_catalog`.cj_prod.mvno_order o ON sc.user_id = o.user_id
JOIN `rds-prod_catalog`.cj_prod.user_onboarding_flow uf ON o.order_id = uf.order_id
WHERE uf.payment_completed_time IS NOT NULL
  AND uf.activation_completed_time IS NULL
  AND DATEDIFF(DAY, uf.payment_completed_time, CURRENT_TIMESTAMP()) >= 7
  AND NOT EXISTS (
    SELECT 1 FROM `rds-prod_catalog`.cj_prod.conversations c
    WHERE c.user_id = sc.user_id
    AND c.created_at > DATEADD(DAY, -3, CURRENT_TIMESTAMP())
  )
ORDER BY days_since_payment DESC
```

---

## Parameters

- `signal_id`: Required — Which signal was detected (SIG-001 through SIG-010)
- `customer_email`: Required — Customer identifier
- `severity`: Required — CRITICAL / HIGH / MEDIUM / LOW
- `order_id`: Optional — Relevant order
- `individual_id`: Optional — For ConnectX actions
- `ticket_id`: Optional — Existing Zendesk ticket to attach to
- `internal_audience`: Required — Array of ["mochi", "l1", "l2", "engineering"]
- `external_channel`: Required — Array of ["email", "sms", "push", "in_app", "none"]

## Example Usage

```
Event: eSIM status changes to FAILED for customer jodi@example.com

Engine:
1. Classifies as SIG-002 (CRITICAL)
2. Loads customer data: Jodi, 3 days since payment, 5 Mochi chats
3. Internal: Creates Zendesk ticket with [PROACTIVE] tag, alerts #cs-urgent Slack
4. Internal: Injects context into Mochi so it knows Jodi's issue if she chats
5. External: Sends email "We detected an issue with your eSIM..."
6. Action: Triggers SIM swap automatically (or queues for agent confirmation)
7. Follow-up: Schedules 2h check to confirm resolution
```

```
Event: Daily scan finds 12 customers with PENDING eSIM >48h

Engine:
1. Classifies as SIG-001 (HIGH) x 12 — also flags as systemic
2. Internal: Slack alert to @engineering — "12 customers with stuck eSIMs, possible provisioning pipeline issue"
3. Internal: Creates 12 Zendesk tickets, auto-assigned to eSIM specialist queue
4. External: Sends personalized "Your eSIM is ready to install" email to each customer
5. Follow-up: 48h check — if still not installed, escalate to phone call
```
