# Tone Guide

Personalization rules for meow-comms. Apply these rules at Step 4 (PERSONALIZE) after generating raw message content.

---

## Core Brand Voice: Meow Mobile

Meow Mobile is friendly, direct, and competent. We're a small team that genuinely cares. We don't hide behind corporate language. We own mistakes. We use plain English.

**Voice pillars:**
- **Warm but not cutesy** — Friendly, human, approachable. No baby talk, no excessive exclamation marks.
- **Direct but not cold** — Say what's happening clearly. Don't bury the lede in apologies.
- **Competent but not robotic** — Show we know what we're doing without sounding like a template.
- **Honest but not alarming** — Acknowledge issues without catastrophizing.

---

## Tone Calibration by Touch Count

The customer's touch count (total interactions across Zendesk + Mochi in the last 14 days) determines the emotional register of the message.

| Touch Count | Customer State | Our Tone | Key Phrases |
|---|---|---|---|
| **0 (proactive, no contact)** | Unaware of issue | Helpful, casual | "We noticed...", "Quick heads up...", "Just checking in..." |
| **1** | Neutral, first touch | Professional, proactive | "We detected...", "Here's what's happening...", "Here's how to fix it..." |
| **2** | Slightly frustrated | Empathetic, specific | "I understand this is frustrating...", "Let me explain exactly what happened..." |
| **3** | Frustrated | Apologetic, solution-focused | "I'm sorry this is taking so long...", "Here's what we're doing right now..." |
| **4+** | Angry or dejected | Ownership, executive empathy, concrete commitment | "I sincerely apologize...", "I'm personally taking ownership...", "You won't need to explain this again..." |

### Touch Count Lookup

```sql
-- Count touches in last 14 days across all channels
SELECT
  (SELECT COUNT(*) FROM zendesk_tickets zt
   WHERE zt.requester_email = :customer_email
   AND zt.created_at > DATEADD(DAY, -14, CURRENT_TIMESTAMP())) AS ticket_touches,
  (SELECT COUNT(*) FROM conversations c
   WHERE c.user_email = :customer_email
   AND c.created_at > DATEADD(DAY, -14, CURRENT_TIMESTAMP())) AS mochi_touches
```

`total_touches = ticket_touches + mochi_touches`

---

## Severity-Based Language Rules

### CRITICAL — Direct and Urgent

- Lead with the issue, not a greeting
- State what happened, what we're doing, and when they'll hear back
- Include specific timeline ("within 15 minutes", not "soon")
- No filler phrases, no excessive empathy padding

**Do:**
> "We detected a technical issue with your eSIM activation and our team is already on it. You'll receive a new QR code within 15 minutes."

**Don't:**
> "Hi there! Hope you're having a great day. We just wanted to let you know that there might be a tiny issue with your eSIM. Don't worry though!"

### HIGH — Empathetic and Actionable

- Acknowledge the situation with empathy
- Explain what happened in plain language
- Give a clear next step (either for us or for them)
- Include a timeline

**Do:**
> "We tried to transfer your phone number to Meow Mobile, but your previous carrier flagged an issue. This is common and usually fixable. Here's what to do next..."

**Don't:**
> "URGENT: Your port-in has FAILED. Please take action immediately or you may lose your number."

### MEDIUM — Helpful and Informative

- Casual, friendly tone
- Position as helpful, not alarming
- Soft CTA ("if you need help, we're here")
- No urgency language

**Do:**
> "We noticed your recent payment didn't go through. This sometimes happens with bank security checks — it's usually an easy fix."

**Don't:**
> "Your payment has FAILED. Your account may be suspended if you don't resolve this immediately."

### LOW — Light Touch

- Brief, conversational
- Optional — only send if it adds value
- No action required from customer

**Do:**
> "Just a heads up: we've improved eSIM installation speeds. If you had trouble before, it should be smoother now."

**Don't:**
> "We are writing to inform you of a system enhancement to our eSIM provisioning infrastructure."

---

## Variable Substitution Reference

All customer-facing messages use these template variables. Always resolve before dispatch.

| Variable | Source | Example | Fallback |
|---|---|---|---|
| `{{customer_name}}` | customer_data.first_name | "Jane" | "there" (as in "Hi there") |
| `{{customer_email}}` | customer_data.email | "jane@example.com" | Required, no fallback |
| `{{order_id}}` | order.order_id | "#19345" | Omit reference |
| `{{order_status}}` | order.status | "INPROGRESS" | "being processed" |
| `{{days_since_payment}}` | DATEDIFF(NOW, payment_completed_at) | "3" | Omit reference |
| `{{esim_status}}` | esim.status | "PENDING" | "processing" |
| `{{carrier_name}}` | portin.carrier | "AT&T" | "your previous carrier" |
| `{{masked_phone}}` | portin.phone (last 4) | "***-***-1234" | Omit reference |
| `{{agent_name}}` | assigned_agent.name | "Alex" | "The Meow Mobile Team" |
| `{{ticket_id}}` | zendesk.ticket_id | "#54321" | Omit reference |
| `{{resolution_eta}}` | calculated from severity + signal | "within 1 hour" | "as quickly as possible" |
| `{{touch_count}}` | calculated (see above) | "4" | "multiple" |
| `{{airvet_appointment_date}}` | airvet.next_appointment | "Feb 10, 2026" | "your upcoming appointment" |

### Variable Resolution Rules

1. **Never show raw template variables** — if a variable can't be resolved, use its fallback
2. **Never expose internal IDs** — order_id displays as "#19345", never as UUID
3. **Dates in customer timezone** — always convert timestamps to customer's local time
4. **Phone numbers always masked** — show last 4 digits only

---

## Internal vs. External Tone

### Internal Messages (Slack, Zendesk internal notes, JIRA, PagerDuty)

- **Factual and dense** — pack maximum information into minimum space
- **Use signal IDs** — "SIG-002 fired for jane@example.com"
- **Include raw data** — API responses, status codes, timestamps
- **Action-oriented** — "SIM swap needed", "Escalate to port team"
- **No customer-facing polish** — direct, technical, abbreviations OK

**Example Slack message:**
```
:rotating_light: *CRITICAL — SIG-002 eSIM FAILED*
Customer: Jane Doe <jane@example.com>
Order: #19345 | eSIM: FAILED (PROFILE_DOWNLOAD_FAILED) | Paid: 3d ago
Touches: 7 (5 Mochi + 2 ZD) | Sentiment: HIGH RISK
Action: SIM swap needed. Proactive email sent.
Zendesk: #54321 | PagerDuty: #pg_789
```

### External Messages (Email, SMS, Push)

- **Human and warm** — sounds like a real person wrote it
- **No jargon** — never say "provisioning", "SIG-002", "API failure"
- **Plain language translations:**

| Internal Term | Customer-Facing Translation |
|---|---|
| eSIM provisioning failed | "a technical issue with your eSIM activation" |
| API failure | "a system error on our end" |
| Port-in rejected | "your previous carrier flagged an issue with the transfer" |
| SIM swap | "we're preparing a fresh eSIM profile for you" |
| Retry loop | "we're seeing repeated errors and investigating" |
| Systemic pattern | "we're aware of an issue affecting some customers" |
| Signal detected | "we noticed..." |
| SLA breach | (never reference to customer) |

---

## Pet Care Alert Tone (Airvet)

Airvet-related communications require special sensitivity. Pet health is emotional.

- **Urgent but reassuring** — "We want to make sure your pet's appointment goes smoothly"
- **Never minimize** — pet care concerns are always valid
- **Include Airvet contact info** — always provide a direct path to Airvet support
- **Reference the pet by name** if available in customer_data

**Do:**
> "Hi Jane, we noticed an issue with your upcoming Airvet appointment for Whiskers on Feb 10. We've flagged this with the Airvet team and they're working to confirm your slot. We'll update you within 2 hours."

**Don't:**
> "There was a system error with your pet care service. Please contact Airvet directly."

---

## Message Signature Rules

| Channel | Signature |
|---|---|
| Email (agent assigned) | "Best,\n{agent_name}\nMeow Mobile Support" |
| Email (no agent / automated) | "Best,\nThe Meow Mobile Team" |
| SMS | "- Meow Mobile" |
| Push notification | No signature (app context is implicit) |
| Slack (internal) | No signature |
| Zendesk internal note | "— meow-comms (automated)" |

---

## Forbidden Patterns

Never use these in customer-facing communications:

- "Per our records..." (robotic)
- "Please be advised..." (legal tone)
- "We regret to inform you..." (obituary tone)
- "Kindly..." (patronizing in US English)
- "ASAP" (vague urgency)
- "Unfortunately, at this time..." (corporate filler)
- "Your call is important to us" (cliche)
- ALL CAPS for emphasis (use bold in email, never in SMS)
- Multiple exclamation marks ("Great news!!!")
- Emoji in email or SMS (save for in-app/push only, sparingly)
- Blame language ("you failed to...", "you didn't...")
- Technical jargon without translation (see table above)
