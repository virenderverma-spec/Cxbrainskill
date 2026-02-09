# Script: De-Duplicate Communications

Run the four de-duplication checks before any message is dispatched. Returns a verdict for each message.

---

## Input

```json
{
  "recipient": "jane@example.com",
  "channel": "email",
  "signal_type": "SIG-002",
  "severity": "CRITICAL",
  "message_payload": { "subject": "...", "body": "..." },
  "root_cause_id": "esim_provisioning_failure"
}
```

## Output

One of four verdicts:
- `SEND` — dispatch the message
- `SUPPRESS` — drop the message, log suppression
- `HOLD_FOR_REVIEW` — flag in #comms-review for human decision
- `MERGE` — combine with a queued message, re-run dedup on merged version

---

## Check 1: 30-Minute Window

Query the comms_log for recent messages to this recipient.

```sql
SELECT signal_type, channel, dispatched_at, root_cause_id, message_id
FROM comms_log
WHERE recipient = :recipient
  AND channel = :channel
  AND dispatched_at > DATEADD(MINUTE, -30, CURRENT_TIMESTAMP())
ORDER BY dispatched_at DESC
LIMIT 5
```

### Decision Logic

```
IF matching rows exist WHERE signal_type = :signal_type OR root_cause_id = :root_cause_id:
  IF :severity = 'CRITICAL':
    verdict = SEND  (CRITICAL bypasses window)
    log: "30min_window_bypass_critical"
  ELSE:
    verdict = SUPPRESS
    log: "30min_window_dedup", reference_message_id = {existing.message_id}

ELSE:
  Continue to Check 2
```

---

## Check 2: Contradiction Check

Compare the new message against the most recent message sent to this recipient in the last 24 hours.

```sql
SELECT message_payload, signal_type, severity, dispatched_at
FROM comms_log
WHERE recipient = :recipient
  AND dispatched_at > DATEADD(HOUR, -24, CURRENT_TIMESTAMP())
ORDER BY dispatched_at DESC
LIMIT 1
```

### Contradiction Patterns

| Pattern | Detection Rule | Example |
|---|---|---|
| Status regression | Prior message said "resolved"/"fixed", new message says "investigating"/"issue detected" | Sent "your eSIM is fixed" 2h ago, now sending "we detected an eSIM issue" |
| Timeline conflict | Prior message promised resolution in X time, new message extends or restarts | Sent "within 1 hour" 20 min ago, now sending "we're still working on it" |
| Severity flip | Prior message was low urgency, new message is high urgency (or vice versa) on same issue | Sent "just checking in" 1h ago, now sending "urgent action needed" on same signal |

### Decision Logic

```
IF contradiction_detected:
  verdict = HOLD_FOR_REVIEW
  post to #comms-review:
    "Contradiction detected for {recipient}:
     Prior ({dispatched_at}): {prior_message_summary}
     New: {new_message_summary}
     Contradiction type: {pattern_name}
     Action needed: Approve, edit, or suppress the new message."

ELSE:
  Continue to Check 3
```

---

## Check 3: Channel Saturation Guard

Count total messages sent to this customer across ALL channels in the last 24 hours.

```sql
SELECT channel, COUNT(*) as count, MAX(dispatched_at) as last_sent
FROM comms_log
WHERE recipient = :recipient
  AND dispatched_at > DATEADD(HOUR, -24, CURRENT_TIMESTAMP())
  AND outcome != 'SUPPRESSED'
GROUP BY channel

UNION ALL

SELECT 'TOTAL' as channel, COUNT(*) as count, MAX(dispatched_at) as last_sent
FROM comms_log
WHERE recipient = :recipient
  AND dispatched_at > DATEADD(HOUR, -24, CURRENT_TIMESTAMP())
  AND outcome != 'SUPPRESSED'
```

### Decision Logic

```
IF total_count >= 3:
  IF :severity = 'CRITICAL':
    verdict = SEND  (CRITICAL bypasses saturation)
    log: "saturation_bypass_critical"
  ELSE:
    Convert message to digest format:
      - Channel: email only (no SMS/push)
      - Subject: "Updates on your Meow Mobile account"
      - Body: Consolidate all pending messages into bullet points
      - SET next_eligible_outreach = NOW() + 6 hours
    verdict = SEND (as digest)
    log: "saturation_consolidated"

ELSE:
  Continue to Check 4
```

---

## Check 4: Signal Merge

Look for other pending (not yet dispatched) messages for the same customer in the outbound queue.

```sql
SELECT signal_type, severity, message_payload, channel, queued_at
FROM outbound_queue
WHERE recipient = :recipient
  AND status = 'PENDING'
  AND queued_at > DATEADD(MINUTE, -15, CURRENT_TIMESTAMP())
ORDER BY queued_at ASC
```

### Decision Logic

```
IF pending_messages exist:
  merged_severity = MAX(all severities including current)
  merged_signals = [all signal_types including current]

  Build merged message using generate-external.md#merged-signals template
  Remove individual pending messages from queue

  verdict = MERGE
  Re-run dedup checks 1-3 on the merged message

ELSE:
  verdict = SEND
```

---

## Dedup Flow Summary

```
Message enters dedup pipeline
       |
       v
  [Check 1: 30-min window]
       |
  match found? ──yes──> CRITICAL? ──yes──> continue
       |                    |
       no                   no──> SUPPRESS
       |
       v
  [Check 2: Contradiction]
       |
  contradiction? ──yes──> HOLD_FOR_REVIEW
       |
       no
       |
       v
  [Check 3: Saturation]
       |
  3+ msgs in 24h? ──yes──> CRITICAL? ──yes──> continue
       |                        |
       no                       no──> consolidate to digest
       |
       v
  [Check 4: Signal merge]
       |
  pending msgs? ──yes──> MERGE (then re-run checks 1-3)
       |
       no
       |
       v
     SEND
```

---

## Logging Suppressed Messages

Even suppressed messages must be logged for audit and graph updates.

```json
{
  "message_id": "{generated_uuid}",
  "recipient": "{email}",
  "channel": "{channel}",
  "signal_type": "{signal_type}",
  "severity": "{severity}",
  "outcome": "SUPPRESSED",
  "suppression_reason": "{30min_window_dedup | saturation_consolidated | contradiction_hold}",
  "reference_message_id": "{id of message that caused suppression}",
  "timestamp": "{current_timestamp}"
}
```
