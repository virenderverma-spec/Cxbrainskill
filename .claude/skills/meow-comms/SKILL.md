---
name: meow-comms
description: Generates and dispatches internal (L0 Slack/Zendesk, L1-2 JIRA, Ops PagerDuty) and external (customer email/SMS/push) communications when the Proactive Detection Engine fires a friction signal. Triggers on: API failures, retry loops, journey stalls, sentiment drops, systemic patterns, pet care alerts. Use when any friction event is detected and communications need to be generated, personalized, de-duplicated, and dispatched to the right recipients through the right channels.
---

# Meow Comms

Orchestrate all internal and external communications triggered by the Proactive Detection Engine. One signal in, correct messages out to the right people through the right channels.

## Workflow Overview

```
Signal Received (from Detection Engine)
       |
       v
+------------------+
| 1. CLASSIFY      |  Identify signal_type, severity, affected customer(s)
+--------+---------+
         |
         v
+------------------+
| 2. ROUTE         |  Determine recipients: internal teams + external customer
+--------+---------+  --> Read references/routing-rules.md
         |
         v
+------------------+
| 3. GENERATE      |  Build message payloads per recipient and channel
+--------+---------+  --> Use scripts/generate-internal.md & scripts/generate-external.md
         |
         v
+------------------+
| 4. PERSONALIZE   |  Apply tone, merge customer variables, adjust by touch count
+--------+---------+  --> Read references/tone-guide.md
         |
         v
+------------------+
| 5. DE-DUPLICATE  |  30-min window check, contradiction check, saturation guard
+--------+---------+  --> Use scripts/deduplicate.md
         |
         v
+------------------+
| 6. DISPATCH      |  Send via Slack, Zendesk, JIRA, PagerDuty, email, SMS, push
+--------+---------+  --> Use scripts/dispatch.md
         |
         v
+------------------+
| 7. LOG           |  Write event to customer graph for future context
+------------------+  --> Use scripts/log-to-graph.md
```

---

## Quick Reference: Signal Type -> Who Gets What

| Signal Type | Internal Recipients | Internal Channel | External Recipient | External Channel | Timing |
|---|---|---|---|---|---|
| **API failure** (SIG-002) | L1 agent, L2 eng | Slack #cs-urgent + Zendesk ticket | Customer | Email + SMS | Immediate |
| **Retry loop** (3+ failed attempts) | L1 agent, Ops | Slack #cs-alerts + JIRA | Customer | Email | Within 1h |
| **Journey stall** (SIG-001/005/006) | L1 agent | Zendesk ticket | Customer | Email | Within 4h |
| **Sentiment drop** (SIG-008) | L1 agent, CS lead | Slack #cs-escalations + Zendesk | Customer | Email (ownership msg) | Within 2h |
| **Systemic pattern** (3+ customers) | L2 eng, Ops | Slack #incidents + PagerDuty + JIRA | Affected customers | Email batch | Within 1h |
| **Pet care alert** (Airvet) | L1 agent | Zendesk ticket | Customer | Email + Push | Within 4h |

> For the full routing matrix including severity overrides and escalation paths, read **references/routing-rules.md**.

---

## Routing and Personalization References

### Routing Rules

Read **references/routing-rules.md** for:
- Complete signal-to-recipient mapping with severity overrides
- Channel selection matrix (severity x has_open_ticket x customer_preference)
- Escalation ladder: when L1 alerts promote to L2/Eng/PagerDuty
- Audience definitions for each tier (L0 Mochi, L1 CS, L2 Eng, Ops)
- PagerDuty trigger criteria and on-call rotation rules
- JIRA ticket creation rules and field mappings

### Tone and Personalization

Read **references/tone-guide.md** for:
- Tone calibration by customer touch count (1st contact = helpful, 4th+ = executive empathy)
- Severity-based language rules (CRITICAL = direct/urgent, LOW = casual/friendly)
- Brand voice guidelines (Meow Mobile personality)
- Variable substitution reference (`{{customer_name}}`, `{{order_id}}`, etc.)
- Do/don't examples for each severity level
- Internal vs. external tone differences

---

## Decision Matrix: Internal-Only vs. External-Only vs. Both

Use this matrix to decide which communication streams to activate.

### Send INTERNAL-ONLY when:

| Condition | Rationale |
|---|---|
| Severity = LOW | Not worth disturbing the customer |
| Signal is a systemic hypothesis (unconfirmed) | Don't alarm customers until confirmed |
| Customer has an open ticket AND agent is actively working it | Agent will communicate directly |
| Signal is an operational metric (e.g., Mochi escalation spike) | Internal ops concern, not customer-facing |
| Customer opted out of proactive outreach | Respect preferences; still alert internally |

### Send EXTERNAL-ONLY when:

| Condition | Rationale |
|---|---|
| Issue is self-service resolvable AND no agent needed | Nudge email (e.g., eSIM install reminder) |
| Scheduled maintenance notification | Informational, no internal action needed beyond logging |
| Post-resolution follow-up ("Your issue is fixed") | Customer closure, team already done |

### Send BOTH when:

| Condition | Rationale |
|---|---|
| Severity = CRITICAL or HIGH | Customer needs to know AND team needs to act |
| Customer has contacted 2+ times about this issue | Ownership message to customer + internal escalation |
| API failure or provisioning error | Customer impacted now; team must fix |
| Port-in rejected | Customer action required + agent must coordinate |
| Pet care alert (Airvet appointment issue) | Time-sensitive for pet; team must verify resolution |
| Systemic pattern confirmed (3+ customers) | Batch customer email + engineering incident |

### Override Rules

1. **CRITICAL severity always sends BOTH** regardless of other conditions
2. **Customer preference = no-contact** overrides external (internal-only)
3. **Active agent on ticket** downgrades external to internal note (agent handles outreach)
4. **Business hours check**: external SMS/push only during 8am-9pm customer local time; email anytime

---

## De-Duplication Rules

All outbound messages pass through de-duplication before dispatch.

### Rule 1: 30-Minute Window

```
IF a message was sent to the SAME recipient
   on the SAME channel
   about the SAME signal_type (or same root_cause)
   within the last 30 minutes
THEN suppress the new message
LOG suppression event with reason "30min_window_dedup"
```

**Exception:** CRITICAL severity bypasses the 30-minute window. Always send.

### Rule 2: Contradiction Check

```
IF a new message would CONTRADICT a recently sent message
   (e.g., "your issue is being investigated" followed by "no issues detected")
THEN hold the new message for human review
FLAG in Slack #comms-review with both messages side by side
```

Contradiction patterns to detect:
- Status regression: "resolved" followed by "investigating"
- Timeline conflict: promised "within 1 hour" but sending "still working on it" at 20 min
- Severity flip: "urgent action needed" followed by "just a heads up"

### Rule 3: Channel Saturation Guard

```
IF the same customer has received 3+ messages across ALL channels
   within a rolling 24-hour window
THEN consolidate into a single digest-style message
ROUTE through email only (no SMS/push)
SET next_eligible_outreach = current_time + 6 hours
```

**Exception:** CRITICAL severity bypasses saturation guard.

### Rule 4: Signal Merge

```
IF multiple signals fire for the SAME customer within a 15-minute window
THEN merge into a single communication that addresses all signals
PICK the highest severity among them
USE the merged template (see scripts/generate-external.md#merged-signals)
```

Example: SIG-002 (eSIM failed) + SIG-008 (repeat contact) = one email addressing both the technical fix AND the frustration acknowledgment.

---

## Scripts Reference

### scripts/generate-internal.md

Generates internal alert payloads for each audience tier.

**When to use:** After routing determines internal recipients (Step 3).

**Input:** `signal_type`, `severity`, `customer_data`, `audience_list`
**Output:** Formatted messages for Slack, Zendesk internal note, JIRA ticket body, PagerDuty alert

**Key sections:**
- Slack message builder (emoji severity prefix, structured blocks)
- Zendesk ticket/note creator (subject line format, tag assignment, group routing)
- JIRA issue creator (project key, issue type, priority mapping, labels)
- PagerDuty event trigger (routing key selection, dedup key, severity mapping)

Read **scripts/generate-internal.md** for full payload formats and field mappings.

---

### scripts/generate-external.md

Generates customer-facing message content per channel.

**When to use:** After routing determines external channels (Step 3).

**Input:** `signal_type`, `severity`, `customer_data`, `channel`
**Output:** Personalized message body for email, SMS, or push notification

**Key sections:**
- Email builder (subject line, body, CTA button)
- SMS builder (160-char limit, link shortening, opt-out footer)
- Push notification builder (title + body, deep link target)
- Merged signal template (when multiple signals combine)

Read **scripts/generate-external.md** for templates per signal type and channel.

---

### scripts/deduplicate.md

Runs the four de-duplication rules before dispatch.

**When to use:** After personalization, before dispatch (Step 5).

**Input:** `recipient`, `channel`, `signal_type`, `message_payload`
**Output:** `SEND`, `SUPPRESS`, `HOLD_FOR_REVIEW`, or `MERGE`

**Key sections:**
- Window check query (comms_log lookup, 30-min filter)
- Contradiction detector (semantic comparison against recent messages)
- Saturation counter (24h rolling window per customer)
- Signal merger (15-min window, severity picker, template combiner)

Read **scripts/deduplicate.md** for implementation details and query patterns.

---

### scripts/dispatch.md

Sends finalized messages through each channel's API.

**When to use:** After de-duplication passes (Step 6).

**Input:** `recipient`, `channel`, `message_payload`, `priority`
**Output:** `dispatch_receipt` (channel, timestamp, message_id, status)

**Key sections:**
- Slack: webhook POST with blocks payload
- Zendesk: ticket create or comment via API
- JIRA: issue create via REST API
- PagerDuty: events v2 API trigger
- Email: SendGrid/SES dispatch with template ID
- SMS: Twilio message create with opt-out check
- Push: Firebase Cloud Messaging with deep link

Read **scripts/dispatch.md** for API payloads, auth patterns, and retry logic.

---

### scripts/log-to-graph.md

Records the communication event in the customer graph.

**When to use:** After every dispatch, including suppressions (Step 7).

**Input:** `customer_id`, `signal_type`, `channels_used`, `messages_sent`, `outcome`
**Output:** Graph node written with edges to signal, ticket, and agent

**Key sections:**
- Event schema (what fields to log)
- Graph node creation (customer -> comms_event -> signal)
- Suppression logging (why it was suppressed, for audit)
- Retrieval patterns (how downstream consumers query comms history)

Read **scripts/log-to-graph.md** for the schema and query patterns.

---

## Parameters

| Parameter | Required | Type | Description |
|---|---|---|---|
| `signal_type` | Yes | string | Signal ID (SIG-001 through SIG-010) or category (api_failure, retry_loop, journey_stall, sentiment_drop, systemic_pattern, pet_care_alert) |
| `severity` | Yes | enum | CRITICAL, HIGH, MEDIUM, LOW |
| `customer_email` | Yes | string | Primary customer identifier |
| `customer_data` | Yes | object | Hydrated customer profile (name, order, journey state, touch count) |
| `order_id` | No | string | Relevant order if applicable |
| `ticket_id` | No | string | Existing Zendesk ticket to attach to |
| `individual_id` | No | string | ConnectX individual ID for API actions |
| `override_channel` | No | string[] | Force specific channels, bypassing routing rules |
| `skip_dedup` | No | boolean | Bypass de-duplication (use for CRITICAL manual overrides only) |
| `dry_run` | No | boolean | Generate messages without dispatching (for review) |

---

## Example: End-to-End Flow

```
Event: eSIM provisioning FAILED for customer jane@example.com (SIG-002, CRITICAL)

1. CLASSIFY
   signal_type: api_failure (SIG-002)
   severity: CRITICAL
   customer: Jane Doe, paid 3 days ago, 5 Mochi chats, 2 Zendesk tickets

2. ROUTE (references/routing-rules.md)
   Internal: L1 agent (Zendesk ticket) + L2 eng (Slack #cs-urgent) + Ops (PagerDuty)
   External: Email + SMS (CRITICAL = immediate multi-channel)

3. GENERATE (scripts/generate-internal.md + scripts/generate-external.md)
   Slack: ":rotating_light: CRITICAL — eSIM FAILED — Jane Doe..."
   Zendesk: "[PROACTIVE] eSIM Provisioning Failed — Jane Doe"
   PagerDuty: trigger event, severity=critical, dedup_key=jane-sig002
   Email: "Action needed: We're fixing your eSIM activation"
   SMS: "Meow Mobile: We detected an issue with your eSIM and are fixing it now. Check email for details."

4. PERSONALIZE (references/tone-guide.md)
   Touch count = 7 (5 Mochi + 2 Zendesk) -> apologetic/ownership tone
   Merge {{customer_name}} = "Jane", {{days_since_payment}} = "3"

5. DE-DUPLICATE (scripts/deduplicate.md)
   CRITICAL severity -> bypass 30-min window
   No contradictions found
   Saturation check: 1 prior message -> OK to send
   No other signals in 15-min window -> no merge needed
   Result: SEND all

6. DISPATCH (scripts/dispatch.md)
   Slack: sent -> msg_id=sl_abc123
   Zendesk: ticket #54321 created
   PagerDuty: incident #pg_789 triggered
   Email: sent -> msg_id=sg_def456
   SMS: sent -> msg_id=tw_ghi789

7. LOG (scripts/log-to-graph.md)
   customer_graph.comms_events += {
     customer: jane@example.com,
     signal: SIG-002,
     severity: CRITICAL,
     channels: [slack, zendesk, pagerduty, email, sms],
     dispatched_at: 2026-02-07T14:32:00Z,
     ticket_id: 54321,
     suppressed: false
   }
```
