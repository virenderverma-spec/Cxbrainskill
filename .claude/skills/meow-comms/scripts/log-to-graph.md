# Script: Log to Customer Graph

Record every communication event (sent, suppressed, merged) in the customer graph for audit, context, and downstream consumers.

---

## Input

```json
{
  "customer_id": "jane@example.com",
  "signal_type": "SIG-002",
  "severity": "CRITICAL",
  "channels_used": ["slack", "zendesk", "pagerduty", "email", "sms"],
  "messages_sent": [
    { "channel": "email", "message_id": "sg_def456", "status": "sent" },
    { "channel": "sms", "message_id": "tw_ghi789", "status": "sent" },
    { "channel": "slack", "message_id": "sl_abc123", "status": "sent" },
    { "channel": "zendesk", "ticket_id": "54321", "status": "sent" },
    { "channel": "pagerduty", "incident_id": "pg_789", "status": "sent" }
  ],
  "outcome": "dispatched",
  "dedup_result": "SEND",
  "suppressed": false
}
```

## Output

Graph node written with edges to signal, ticket, and agent.

---

## Event Schema

### comms_event Node

```json
{
  "event_id": "{uuid}",
  "event_type": "proactive_communication",
  "customer_email": "{customer_id}",
  "signal_type": "{signal_type}",
  "signal_label": "{human-readable signal name}",
  "severity": "{severity}",
  "detected_at": "{signal detection timestamp}",
  "dispatched_at": "{dispatch timestamp}",
  "channels": "{channels_used array}",
  "messages": "{messages_sent array with IDs and statuses}",
  "outcome": "{dispatched | suppressed | held_for_review | merged}",
  "dedup_result": "{SEND | SUPPRESS | HOLD_FOR_REVIEW | MERGE}",
  "suppression_reason": "{reason if suppressed, null otherwise}",
  "reference_event_id": "{linked event if merge/suppression, null otherwise}",
  "zendesk_ticket_id": "{ticket_id if created/updated}",
  "pagerduty_incident_id": "{incident_id if triggered}",
  "jira_issue_key": "{issue_key if created}",
  "agent_id": "{assigned agent ID if applicable}",
  "customer_touch_count_at_time": "{touch count when event fired}",
  "customer_journey_state": "{snapshot of journey at event time}",
  "metadata": {
    "dry_run": false,
    "override_channel": null,
    "skip_dedup": false,
    "meow_comms_version": "1.0"
  }
}
```

---

## Graph Node Creation

### Step 1: Upsert Customer Node

Ensure the customer node exists. If this is the first comms event, create it.

```sql
INSERT INTO customer_graph.customers (email, first_event_at, last_event_at, total_comms_events)
VALUES (:email, :now, :now, 1)
ON CONFLICT (email)
DO UPDATE SET
  last_event_at = :now,
  total_comms_events = customer_graph.customers.total_comms_events + 1
```

### Step 2: Insert Comms Event

```sql
INSERT INTO customer_graph.comms_events (
  event_id, customer_email, signal_type, severity,
  detected_at, dispatched_at, channels, outcome,
  dedup_result, suppression_reason, zendesk_ticket_id,
  pagerduty_incident_id, jira_issue_key, touch_count,
  journey_state_snapshot, metadata
) VALUES (
  :event_id, :customer_email, :signal_type, :severity,
  :detected_at, :dispatched_at, :channels, :outcome,
  :dedup_result, :suppression_reason, :zendesk_ticket_id,
  :pagerduty_incident_id, :jira_issue_key, :touch_count,
  :journey_state_snapshot, :metadata
)
```

### Step 3: Create Edges

```sql
-- Edge: customer -> comms_event
INSERT INTO customer_graph.edges (from_type, from_id, to_type, to_id, edge_type, created_at)
VALUES ('customer', :customer_email, 'comms_event', :event_id, 'received_communication', :now);

-- Edge: comms_event -> signal
INSERT INTO customer_graph.edges (from_type, from_id, to_type, to_id, edge_type, created_at)
VALUES ('comms_event', :event_id, 'signal', :signal_type, 'triggered_by', :now);

-- Edge: comms_event -> zendesk_ticket (if ticket created/updated)
INSERT INTO customer_graph.edges (from_type, from_id, to_type, to_id, edge_type, created_at)
SELECT 'comms_event', :event_id, 'zendesk_ticket', :ticket_id, 'created_ticket', :now
WHERE :ticket_id IS NOT NULL;

-- Edge: comms_event -> agent (if agent assigned)
INSERT INTO customer_graph.edges (from_type, from_id, to_type, to_id, edge_type, created_at)
SELECT 'comms_event', :event_id, 'agent', :agent_id, 'assigned_to', :now
WHERE :agent_id IS NOT NULL;
```

---

## Suppression Logging

Suppressed messages are logged with the same schema but with `outcome = 'suppressed'` and the reason field populated.

This is critical for:
- **Audit:** Proving we detected an issue even if we didn't send a duplicate message
- **Context:** Downstream consumers (Mochi, agents) can see "we already sent a message about this 20 min ago"
- **Debugging:** Understanding why a customer didn't receive a message

---

## Retrieval Patterns

### Get all comms for a customer (for agent context)

```sql
SELECT event_id, signal_type, severity, outcome, channels, dispatched_at
FROM customer_graph.comms_events
WHERE customer_email = :email
ORDER BY dispatched_at DESC
LIMIT 20
```

### Check if customer was recently contacted about a signal (for dedup)

```sql
SELECT event_id, dispatched_at, outcome
FROM customer_graph.comms_events
WHERE customer_email = :email
  AND signal_type = :signal_type
  AND outcome = 'dispatched'
  AND dispatched_at > DATEADD(MINUTE, -30, CURRENT_TIMESTAMP())
LIMIT 1
```

### Get comms history for a ticket (for internal context)

```sql
SELECT ce.event_id, ce.signal_type, ce.severity, ce.channels, ce.outcome, ce.dispatched_at
FROM customer_graph.comms_events ce
JOIN customer_graph.edges e ON e.from_id = ce.event_id
WHERE e.to_type = 'zendesk_ticket'
  AND e.to_id = :ticket_id
ORDER BY ce.dispatched_at ASC
```

### Daily comms volume (for monitoring)

```sql
SELECT
  DATE(dispatched_at) as date,
  signal_type,
  outcome,
  COUNT(*) as count
FROM customer_graph.comms_events
WHERE dispatched_at > DATEADD(DAY, -7, CURRENT_TIMESTAMP())
GROUP BY DATE(dispatched_at), signal_type, outcome
ORDER BY date DESC, count DESC
```

### Find customers with high comms volume (saturation monitor)

```sql
SELECT customer_email, COUNT(*) as comms_count
FROM customer_graph.comms_events
WHERE outcome = 'dispatched'
  AND dispatched_at > DATEADD(HOUR, -24, CURRENT_TIMESTAMP())
GROUP BY customer_email
HAVING COUNT(*) >= 3
ORDER BY comms_count DESC
```
