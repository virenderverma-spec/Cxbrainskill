# Script: Generate Internal Communications

Build internal alert payloads for each audience tier (L0 Mochi, L1 Agent, L2 Eng, Ops).

---

## Input

```json
{
  "signal_type": "SIG-002",
  "severity": "CRITICAL",
  "customer_data": { "email": "...", "name": "...", "order": {...}, "esim": {...}, "touches": 7 },
  "audience_list": ["mochi", "l1_agent", "l2_eng", "ops"]
}
```

## Output

One formatted payload per audience member, ready for dispatch.

---

## Step 1: Build Base Context Block

Every internal message starts with the same data block. Build this first, then format per channel.

```
signal_id:        {signal_type}
signal_label:     {lookup from signal registry}
severity:         {severity}
detected_at:      {current_timestamp}
customer_name:    {customer_data.name}
customer_email:   {customer_data.email}
order_id:         {customer_data.order.order_id}
order_status:     {customer_data.order.status}
esim_status:      {customer_data.esim.status}
payment_status:   {customer_data.order.payment_status}
days_since_payment: {calculated}
touch_count:      {customer_data.touches.total}
touch_breakdown:  {zendesk: X, mochi: Y}
has_open_ticket:  {boolean}
existing_ticket:  {ticket_id if exists}
```

---

## Step 2: Generate Slack Message

### Format

```
{severity_emoji} *{severity} — {signal_label}*

*Customer:* {name} <{email}>
*Impact:* {one_line_impact}

*Key Data:*
- Order: `{order_id}` — {order_status}
- eSIM: {esim_status} since {timestamp}
- Payment: {payment_status} ({days_since_payment}d ago)
- Touches: {touch_count} in last 14d ({breakdown})
- Duration: {days_since_issue_start}d since issue started

*Recommended Action:* {action_summary}
*Zendesk:* {ticket_link or "creating..."}

cc: @{team_handle}
```

### Severity Emoji Map

| Severity | Emoji | Channel |
|---|---|---|
| CRITICAL | `:rotating_light:` | #cs-urgent |
| HIGH | `:warning:` | #cs-alerts |
| MEDIUM | `:large_blue_circle:` | #cs-alerts |
| LOW | `:white_circle:` | #cs-alerts (optional) |

### Systemic Pattern Format (3+ customers)

When signal affects multiple customers, use this format instead:

```
:warning: *SYSTEMIC ISSUE DETECTED*

*Pattern:* {count} customers with {signal_label} in last {timeframe}
*Common Factor:* {detected_commonality or "investigating"}

| Customer | Order | Status | Duration |
|----------|-------|--------|----------|
| {email1} | {id}  | {state}| {Xh}    |
| {email2} | {id}  | {state}| {Xh}    |
| ...      |       |        |          |

*Recommended:*
1. {immediate_action}
2. {investigation_step}
3. {customer_communication_plan}

cc: @engineering @cs-leads
```

---

## Step 3: Generate Zendesk Ticket / Internal Note

### New Ticket (no existing ticket for this customer+signal)

**Subject:** `[PROACTIVE] {signal_label} — {customer_name} ({email})`

**Body:**

```markdown
## Proactive Detection Alert

**Signal:** {signal_id} — {signal_label}
**Severity:** {severity}
**Detected:** {timestamp}
**Customer:** {name} ({email})

### What Happened
{2-3 sentence plain language explanation based on signal_type}

### Customer Impact
- Service status: {active/no_service/degraded}
- Days since payment: {X}
- Has customer contacted us? {Yes — X times / No}
- Sentiment risk: {low/medium/high — based on touch count and duration}

### Customer Journey Snapshot
- Order: {order_id} — {status}
- eSIM: {status}
- Payment: {completed/pending} — {date}
- Port-in: {status if applicable}
- Last contact: {channel} — {date} — {topic}
- Total touches: {X} across {channels}

### Recommended Action
{specific action from signal playbook}

### Steps
1. {step_1}
2. {step_2}
3. {step_3}

### Draft Customer Message
{pre-written message — pull from scripts/generate-external.md output}

### ConnectX Actions Available
- [ ] Swap eSIM (individualId: {id})
- [ ] Cancel Order (orderId: {id})
- [ ] Resume Service (individualId: {id})
```

**Ticket properties:**
- Priority: `{severity_to_priority_map}`
- Tags: `["proactive_alert", "signal_{id}", "severity_{level}", "meow_comms"]`
- Group: `{signal_to_group_map}` (see routing-rules.md)
- Type: `incident`

### Internal Note (existing ticket found)

```markdown
--- meow-comms proactive alert ---
Signal: {signal_id} — {signal_label} | Severity: {severity}
Detected: {timestamp}

{brief context update — what changed since last note}

Recommended action: {action}
Draft customer reply attached above.
--- end meow-comms ---
```

---

## Step 4: Generate JIRA Ticket

Only create when audience_list includes `l2_eng` or signal is systemic.

```json
{
  "project": "CS-ENG",
  "issuetype": "{Bug | Incident}",
  "summary": "[meow-comms] {signal_label} — {customer_email}",
  "description": "{full context block from Step 1, formatted as JIRA markdown}",
  "priority": "{severity_to_jira_priority}",
  "labels": ["proactive-alert", "signal-{id}", "{additional_labels}"],
  "components": ["{signal_to_component_map}"]
}
```

**Priority mapping:** CRITICAL -> Blocker, HIGH -> Critical, MEDIUM -> Major, LOW -> Minor

**Component mapping:**
- SIG-001, SIG-002 -> `esim-provisioning`
- SIG-004, SIG-005 -> `port-in`
- SIG-003 -> `payments`
- SIG-010 -> `network`
- Systemic -> `incident-management`

---

## Step 5: Generate PagerDuty Alert

Only trigger when audience_list includes `ops` or severity = CRITICAL.

```json
{
  "routing_key": "{signal_to_routing_key}",
  "event_action": "trigger",
  "dedup_key": "{customer_email}-{signal_type}-{date}",
  "payload": {
    "summary": "{severity}: {signal_label} for {customer_name} ({email})",
    "source": "meow-comms",
    "severity": "{critical|error|warning|info}",
    "custom_details": {
      "signal_type": "{signal_type}",
      "customer_email": "{email}",
      "order_id": "{order_id}",
      "esim_status": "{status}",
      "touch_count": "{touches}",
      "zendesk_ticket": "{ticket_id}",
      "recommended_action": "{action}"
    }
  }
}
```

**Severity mapping:** CRITICAL -> critical, HIGH -> error, MEDIUM -> warning, LOW -> info

**Routing key selection:** See references/routing-rules.md > PagerDuty Routing table.

**Dedup key format:** `{email}-{signal_type}-{YYYY-MM-DD}` ensures one PD incident per customer per signal per day.

---

## Step 6: Generate Mochi Context Injection

Always generate when customer has used Mochi in last 14 days.

```json
{
  "customer_email": "{email}",
  "proactive_context": {
    "signal": "{signal_type}",
    "issue": "{plain language issue description}",
    "detected_at": "{timestamp}",
    "customer_impact": "{impact statement}",
    "resolution_status": "{what we're doing about it}",
    "what_to_tell_customer": "{1-2 sentence script for Mochi to use}"
  }
}
```

Mochi will use this context to skip diagnostic questions and go straight to a status update when the customer chats in.
