# Routing Rules

Detailed signal-to-recipient mapping, channel selection, and escalation logic for meow-comms.

---

## Audience Definitions

### L0 — Mochi (Automated Bot Layer)

- **Who:** Mochi chatbot context injection
- **Channel:** API context push (in-memory)
- **Purpose:** Arm Mochi with proactive context so if the customer chats in, Mochi already knows the issue
- **Response time:** Immediate (automated)
- **When to notify:** All signals where the customer has used Mochi in the last 14 days

### L1 — CS Agents

- **Who:** Customer support agents in Zendesk
- **Channel:** Zendesk ticket (auto-created or updated) + Slack #cs-alerts
- **Purpose:** Actionable alert with diagnosis, recommended steps, and draft customer message
- **Response time:** Per severity SLA (see below)
- **When to notify:** All signals that require human action or customer outreach

### L2 — Engineering / Specialists

- **Who:** eSIM specialists, port-in team, engineering on-call
- **Channel:** Slack #cs-urgent or #cs-escalations + JIRA ticket
- **Purpose:** Technical investigation, carrier coordination, system fixes
- **Response time:** Per severity SLA
- **When to notify:** CRITICAL signals, unresolved HIGH after 4h, systemic patterns, failed ConnectX actions

### Ops — Operations / Incident Management

- **Who:** Ops on-call, CS leads, engineering leads
- **Channel:** PagerDuty + Slack #incidents
- **Purpose:** Incident coordination, multi-customer triage, executive awareness
- **Response time:** Immediate for pages, 1h for Slack
- **When to notify:** CRITICAL signals, systemic patterns (3+ customers), SLA breaches

---

## Signal-to-Recipient Matrix (Full)

| Signal | Severity | L0 Mochi | L1 Agent | L2 Eng | Ops | Customer Email | Customer SMS | Customer Push |
|---|---|---|---|---|---|---|---|---|
| SIG-001: eSIM stuck PENDING >48h | HIGH | Yes | Zendesk ticket | - | - | Yes (install guide) | - | Yes (deep link) |
| SIG-002: eSIM provisioning FAILED | CRITICAL | Yes | Zendesk ticket | Slack + JIRA | PagerDuty | Yes (we're fixing it) | Yes (status alert) | Yes |
| SIG-003: Payment failed >2h | MEDIUM | Yes | Zendesk ticket | - | - | Yes (retry instructions) | - | - |
| SIG-004: Port-in rejected | HIGH | Yes | Zendesk ticket | Slack (port team) | - | Yes (info needed) | - | - |
| SIG-005: Port-in stalled >72h | MEDIUM | Yes | Zendesk ticket | Slack (port team) | - | Yes (status update) | - | - |
| SIG-006: Order stuck >24h | MEDIUM | Yes | Zendesk ticket | Slack #cs-alerts | - | - (internal first) | - | - |
| SIG-007: Mochi escalation abandoned | HIGH | Yes (update) | Zendesk ticket | - | - | Yes (follow-up) | - | - |
| SIG-008: Repeat contact (3+ in 7d) | HIGH | Yes | Zendesk ticket (priority) | - | Slack #cs-escalations | Yes (ownership msg) | - | - |
| SIG-009: Silent churn risk | MEDIUM | Yes | Zendesk ticket | - | - | Yes (setup help) | - | Yes (nudge) |
| SIG-010: Network outage impact | HIGH | Yes | Zendesk ticket | Slack #incidents | PagerDuty (if >50 affected) | Yes (service alert) | Yes | Yes |
| Systemic: 3+ customers same signal | CRITICAL | Yes (all) | Zendesk tickets (batch) | Slack + JIRA (incident) | PagerDuty | Yes (batch, staggered) | Conditional | - |
| Pet care: Airvet appointment issue | HIGH | Yes | Zendesk ticket | - | - | Yes (appointment status) | - | Yes (deep link) |
| Retry loop: 3+ failed API calls | MEDIUM | Yes | Zendesk ticket | Slack + JIRA | - | Yes (we're looking into it) | - | - |

---

## Severity-Based Response SLAs

| Severity | Internal Alert | L1 First Action | L2 Engagement | Customer Outreach | Resolution Target |
|---|---|---|---|---|---|
| CRITICAL | Immediate | < 30 min | Immediate | Immediate | 4 hours |
| HIGH | < 15 min | < 2 hours | If unresolved at 4h | Within 4 hours | 24 hours |
| MEDIUM | < 1 hour | < 8 hours | On request | Within 24 hours | 72 hours |
| LOW | Best effort | Best effort | N/A | Optional | Best effort |

---

## Channel Selection Matrix

Use this matrix to select the customer-facing channel based on severity and ticket state.

| Severity | Has Open Ticket? | Customer Preference | Primary Channel | Secondary Channel |
|---|---|---|---|---|
| CRITICAL | Yes | Any | Reply on ticket + SMS | Push notification |
| CRITICAL | No | Any | Email + SMS | Push notification |
| HIGH | Yes | Any | Reply on ticket | - |
| HIGH | No | Email preferred | Email | Push notification |
| HIGH | No | SMS preferred | SMS | Email |
| MEDIUM | Yes | Any | Internal note (agent follows up manually) | - |
| MEDIUM | No | Any | Email | - |
| LOW | Any | Any | In-app notification or none | - |

### Business Hours Constraint

- **Email:** Anytime (no restriction)
- **SMS:** 8:00 AM - 9:00 PM customer local time only
- **Push notification:** 8:00 AM - 10:00 PM customer local time only
- **If outside hours:** Queue for next eligible window. Exception: CRITICAL sends immediately regardless.

### Customer Preference Lookup

```
Query customer_preferences table:
  - preferred_channel: email | sms | push | none
  - opt_out_proactive: boolean
  - quiet_hours: {start, end, timezone}
  - language: en | es (for future i18n)
```

If `opt_out_proactive = true`: send internal alerts only, skip all external channels.

---

## Escalation Ladder

### Auto-Escalation Triggers

```
L1 -> L2 Escalation:
  IF signal severity = HIGH
  AND no agent action within 4 hours of alert
  THEN auto-escalate to L2 via Slack #cs-escalations + JIRA

L2 -> Ops/PagerDuty Escalation:
  IF signal severity = CRITICAL
  AND no resolution within 2 hours
  THEN page Ops via PagerDuty

  OR IF signal affects 3+ customers (systemic)
  THEN immediately page Ops via PagerDuty

L1 -> L2 (Action Failure):
  IF L1 agent triggers a ConnectX action (SIM swap, cancel, resume)
  AND the action returns an error
  THEN auto-escalate to L2 with error details
```

### PagerDuty Routing

| Condition | Routing Key | On-Call Team |
|---|---|---|
| eSIM CRITICAL (SIG-002) | `esim-critical` | eSIM Engineering |
| Port-in CRITICAL (SIG-004 escalated) | `portin-critical` | Port-in Team |
| Systemic pattern (3+ customers) | `systemic-incident` | Ops On-Call |
| Network outage (SIG-010, >50 affected) | `network-outage` | Network Ops |
| Unresolved CRITICAL after 2h | `unresolved-critical` | Engineering Lead |

### JIRA Ticket Rules

| Trigger | Project | Issue Type | Priority | Labels |
|---|---|---|---|---|
| L2 escalation (technical) | CS-ENG | Bug | Maps from severity | `proactive-alert`, `signal-{id}` |
| Systemic pattern | CS-ENG | Incident | Critical | `systemic`, `multi-customer` |
| ConnectX action failure | CS-ENG | Bug | High | `connectx-failure`, `action-error` |
| Unresolved after SLA | CS-OPS | Task | High | `sla-breach`, `escalation` |

---

## Slack Channel Routing

| Channel | When to Post | Who Monitors |
|---|---|---|
| `#cs-alerts` | All HIGH/MEDIUM signals, single customer | L1 agents |
| `#cs-urgent` | All CRITICAL signals | L1 leads + L2 |
| `#cs-escalations` | Auto-escalations (L1 -> L2) | L2 specialists |
| `#incidents` | Systemic patterns, multi-customer | Ops + Engineering leads |
| `#comms-review` | Messages flagged by contradiction check | Comms team |

---

## Zendesk Ticket Routing

### Auto-Created Ticket Properties

| Field | Value |
|---|---|
| Subject | `[PROACTIVE] {signal_label} — {customer_name} ({email})` |
| Priority | CRITICAL -> Urgent, HIGH -> High, MEDIUM -> Normal, LOW -> Low |
| Tags | `proactive_alert`, `signal_{id}`, `severity_{level}`, `meow_comms` |
| Group | Signal-based: eSIM signals -> eSIM Specialists, Port-in -> Port Team, Payment -> Billing, Default -> General CS |
| Type | `incident` (single customer) or `problem` (systemic) |
| Internal note | Full diagnostic context: API responses, journey state, timestamps, recommended action |

### Existing Ticket Handling

```
IF customer has an open ticket about the same issue:
  DO NOT create a new ticket
  ADD internal note to existing ticket with proactive alert context
  UPDATE ticket priority if new severity is higher
  ADD tags: proactive_alert, signal_{id}

IF customer has a solved ticket from <7 days ago on same issue:
  CREATE follow-up ticket linked to original
  REFERENCE prior resolution in internal note
```
