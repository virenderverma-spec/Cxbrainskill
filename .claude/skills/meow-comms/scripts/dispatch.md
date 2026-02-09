# Script: Dispatch Communications

Send finalized messages through each channel's API. Handle retries and capture receipts.

---

## Input

```json
{
  "recipient": "jane@example.com",
  "channel": "slack",
  "message_payload": { ... },
  "priority": "CRITICAL"
}
```

## Output

```json
{
  "dispatch_receipt": {
    "channel": "slack",
    "timestamp": "2026-02-07T14:32:00Z",
    "message_id": "sl_abc123",
    "status": "sent",
    "retry_count": 0
  }
}
```

---

## Channel: Slack

**API:** Incoming Webhook or Slack Web API (`chat.postMessage`)

**Payload:**
```json
{
  "channel": "{target_channel_id}",
  "text": "{fallback_text}",
  "blocks": [
    {
      "type": "section",
      "text": { "type": "mrkdwn", "text": "{formatted_message}" }
    }
  ],
  "unfurl_links": false
}
```

**Channel routing:** See references/routing-rules.md > Slack Channel Routing

**Auth:** `SLACK_BOT_TOKEN` in environment
**Endpoint:** `https://slack.com/api/chat.postMessage`

**Retry:** 3 attempts, exponential backoff (1s, 3s, 9s). On final failure, log error and continue.

---

## Channel: Zendesk

### Create Ticket

**API:** Zendesk Tickets API

```json
{
  "ticket": {
    "subject": "{subject}",
    "comment": { "body": "{body}", "public": false },
    "priority": "{priority}",
    "tags": "{tags_array}",
    "group_id": "{group_id}",
    "type": "incident",
    "requester": { "email": "{customer_email}" }
  }
}
```

**Auth:** `ZENDESK_API_TOKEN` + `ZENDESK_EMAIL` in environment
**Endpoint:** `https://{subdomain}.zendesk.com/api/v2/tickets.json`

### Add Internal Note (existing ticket)

```json
{
  "ticket": {
    "comment": {
      "body": "{note_body}",
      "public": false
    },
    "additional_tags": "{new_tags}"
  }
}
```

**Endpoint:** `https://{subdomain}.zendesk.com/api/v2/tickets/{ticket_id}.json` (PUT)

**Retry:** 3 attempts. If 429 (rate limit), respect `Retry-After` header.

---

## Channel: JIRA

**API:** JIRA REST API v3

```json
{
  "fields": {
    "project": { "key": "{project_key}" },
    "issuetype": { "name": "{issue_type}" },
    "summary": "{summary}",
    "description": {
      "type": "doc",
      "version": 1,
      "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "{description}" }] }]
    },
    "priority": { "name": "{priority}" },
    "labels": "{labels_array}"
  }
}
```

**Auth:** `JIRA_API_TOKEN` + `JIRA_EMAIL` in environment
**Endpoint:** `https://{domain}.atlassian.net/rest/api/3/issue`

**Retry:** 3 attempts, exponential backoff.

---

## Channel: PagerDuty

**API:** PagerDuty Events API v2

```json
{
  "routing_key": "{routing_key}",
  "event_action": "trigger",
  "dedup_key": "{dedup_key}",
  "payload": {
    "summary": "{summary}",
    "source": "meow-comms",
    "severity": "{severity}",
    "timestamp": "{iso8601_timestamp}",
    "custom_details": { ... }
  },
  "links": [
    { "href": "{zendesk_ticket_url}", "text": "Zendesk Ticket" }
  ]
}
```

**Auth:** Routing key per service (no separate auth needed for Events v2)
**Endpoint:** `https://events.pagerduty.com/v2/enqueue`

**Retry:** 5 attempts (PagerDuty is critical path). Exponential backoff (1s, 2s, 4s, 8s, 16s).

**Dedup key format:** `{customer_email}-{signal_type}-{YYYY-MM-DD}`
This ensures PagerDuty groups related alerts into one incident per customer per signal per day.

---

## Channel: Email (SendGrid)

**API:** SendGrid Mail Send v3

```json
{
  "personalizations": [
    {
      "to": [{ "email": "{customer_email}", "name": "{customer_name}" }],
      "subject": "{subject}"
    }
  ],
  "from": { "email": "support@meowmobile.com", "name": "Meow Mobile Support" },
  "reply_to": { "email": "support@meowmobile.com" },
  "content": [
    { "type": "text/plain", "value": "{plain_text_body}" },
    { "type": "text/html", "value": "{html_body}" }
  ],
  "tracking_settings": {
    "open_tracking": { "enable": true },
    "click_tracking": { "enable": true }
  },
  "categories": ["proactive_alert", "{signal_type}"]
}
```

**Auth:** `SENDGRID_API_KEY` in environment
**Endpoint:** `https://api.sendgrid.com/v3/mail/send`

**Important:**
- Always include both plain text and HTML versions
- Reply-to must point to monitored support inbox
- Include unsubscribe link in HTML footer (CAN-SPAM)

**Retry:** 3 attempts. On 429, respect rate limit headers.

---

## Channel: SMS (Twilio)

**API:** Twilio Messages API

```json
{
  "To": "{customer_phone}",
  "From": "{twilio_number}",
  "Body": "{sms_body}",
  "StatusCallback": "{webhook_url}/sms/status"
}
```

**Auth:** `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` in environment
**Endpoint:** `https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json`

**Pre-dispatch checks:**
1. Customer phone number exists and is valid
2. Customer has not opted out (check Twilio opt-out list)
3. Within business hours (8am-9pm customer local time) — unless CRITICAL

**Retry:** 2 attempts only (SMS costs money per message).

---

## Channel: Push Notification (Firebase)

**API:** Firebase Cloud Messaging (FCM) v1

```json
{
  "message": {
    "token": "{device_fcm_token}",
    "notification": {
      "title": "{push_title}",
      "body": "{push_body}"
    },
    "data": {
      "deep_link": "{deep_link_url}",
      "signal_type": "{signal_type}"
    },
    "android": { "priority": "high" },
    "apns": { "payload": { "aps": { "sound": "default" } } }
  }
}
```

**Auth:** Firebase service account JSON
**Endpoint:** `https://fcm.googleapis.com/v1/projects/{project_id}/messages:send`

**Pre-dispatch checks:**
1. Customer has a valid FCM token
2. Within business hours (8am-10pm) — unless CRITICAL
3. Customer has not disabled push notifications

**Retry:** 2 attempts. If token is invalid (410 response), remove token from database.

---

## Retry Policy Summary

| Channel | Max Retries | Backoff | On Final Failure |
|---|---|---|---|
| Slack | 3 | Exponential (1s, 3s, 9s) | Log error, continue |
| Zendesk | 3 | Respect Retry-After | Log error, alert #comms-review |
| JIRA | 3 | Exponential (1s, 3s, 9s) | Log error, continue |
| PagerDuty | 5 | Exponential (1s-16s) | Log error, fallback to Slack @oncall |
| Email | 3 | Respect rate limits | Queue for retry in 15 min |
| SMS | 2 | 5s fixed | Log error, fallback to email |
| Push | 2 | 3s fixed | Log error, no fallback |

---

## Dispatch Receipt Logging

Every dispatch (success or failure) must be logged to `comms_log`.

```json
{
  "message_id": "{uuid}",
  "recipient": "{email}",
  "channel": "{channel}",
  "signal_type": "{signal_type}",
  "severity": "{severity}",
  "outcome": "SENT | FAILED | RETRYING",
  "dispatched_at": "{timestamp}",
  "response_id": "{channel-specific message ID}",
  "retry_count": 0,
  "error": null
}
```
