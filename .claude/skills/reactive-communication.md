# Reactive Communication Engine

Consolidate inbound customer tickets, suppress duplicate auto-acknowledgements, and ensure each customer receives ONE cohesive response covering ALL their open issues — regardless of how many tickets or channels they used.

## Description

This skill is the **inbound/reactive** counterpart to **proactive-communication.md** (which handles system-detected signals). When a customer contacts us via email, chat, or social media, Zendesk auto-generates acknowledgement emails per ticket. If the same customer creates multiple tickets (same or different issues), they get bombarded with fragmented communications. This engine:

1. **Suppresses auto-acknowledgement emails** — only manual agent responses reach the customer
2. **Consolidates all open tickets** from the same customer into the latest ticket
3. **Ensures the agent sends ONE response** covering ALL issues
4. **Gates outbound communication** to prevent duplicates and coordinate with proactive outreach

## Triggers

- Customer creates a new Zendesk ticket (any channel)
- Multiple open tickets detected for the same customer
- Agent is about to respond to a consolidated ticket
- Customer replies to a previously merged ticket
- Cross-channel simultaneous contacts from same customer
- "consolidate tickets"
- "merge tickets"
- "suppress auto-ack"
- "customer has multiple tickets"
- "duplicate ticket"

---

## Section A: Ticket Intake & Suppression Layer

### Auto-Acknowledgement Suppression

When a customer creates a ticket via any channel, suppress the Zendesk auto-acknowledgement email. Only manual agent responses should reach the customer.

#### Zendesk Trigger Configuration

**Trigger: Tag for Suppression (fires on all new tickets)**

```
Name: [REACTIVE] Suppress Auto-Ack — Tag New Tickets
Conditions (ALL):
  - Ticket is Created
  - Channel is ANY of: Email, Chat, Facebook, Instagram, Web Widget, API
Actions:
  - Add tag: suppress_auto_ack
  - Add tag: reactive_intake
```

**Trigger: Skip "Notify Requester" for Tagged Tickets**

```
Name: [REACTIVE] Suppress Auto-Ack — Block Notification
Conditions (ALL):
  - Ticket is Created
  - Tags contain: suppress_auto_ack
Actions:
  - Remove trigger: "Notify requester of received request"
  - (Ensure this trigger runs BEFORE the default Zendesk "Notify requester" trigger by setting priority/position)
```

> **Implementation note:** In Zendesk, reorder triggers so the suppression trigger fires first. Alternatively, modify the default "Notify requester of received request" trigger to add condition: `Tags do not contain suppress_auto_ack` (inverted — since all tickets get tagged, this effectively disables it for reactive tickets).

#### Internal-Only Actions on Intake

When a ticket arrives, the following internal actions fire (invisible to customer):

| Action | Detail |
|--------|--------|
| Tag ticket | `suppress_auto_ack`, `reactive_intake`, `channel_[email/chat/social]` |
| Log intake | Internal note: "Ticket received via [channel] at [timestamp]. Auto-ack suppressed." |
| Trigger consolidation check | Fire Section B consolidation engine |
| Set initial priority | Based on channel: Email = Normal, Chat = Normal, Social = High (public visibility) |

#### Suppression Exceptions

Do NOT suppress auto-ack in these cases:

| Exception | Reason | How to Detect |
|-----------|--------|---------------|
| Customer replies to an active thread | They expect continuity; suppressing reply confirmation feels broken | Ticket status = Open AND last agent response < 24h ago |
| Proactive-engine tickets | These are system-initiated outreach, not customer-initiated | Tags contain `proactive_alert` (from **proactive-communication.md**) |
| Incident tickets | Incident comms have their own playbook | Tags contain `incident_` prefix (from **incident-communication-playbook.md**) |
| Mochi-escalated tickets | Mochi already told the customer a human will follow up | Tags contain `mochi_escalation_*` (from **mochi-handoff.md**) |

---

## Section B: Customer Ticket Consolidation Engine

### Detection: Find All Open Tickets for Same Customer

On every new ticket creation, query for all open/pending tickets from the same requester.

```
QUERY: Consolidation Check

Find all tickets WHERE:
  - requester_email = {new_ticket.requester_email}
  - status IN (new, open, pending)
  - ticket_id != {new_ticket.id}
  - NOT tagged with: merged_source, proactive_alert, incident_*
ORDER BY created_at DESC
```

**Zendesk search syntax:**

```
requester:{customer_email} status<solved -tags:merged_source -tags:proactive_alert
```

### Decision Logic

```
IF open_ticket_count = 0:
  → Single ticket. Proceed normally. Agent responds to this ticket.
  → Auto-ack remains suppressed. Agent sends the first response manually.
  → No consolidation needed.

IF open_ticket_count >= 1:
  → Multiple tickets detected. Initiate consolidation.
  → Wait for 2-minute grace period (see below)
  → Then merge all into the LATEST (newest) ticket.
```

### 2-Minute Grace Period

When multiple tickets are detected, wait 2 minutes before merging. This handles rapid-fire submissions (e.g., customer sends 3 emails in 1 minute about different things).

```
ON new_ticket_created WHERE open_ticket_count >= 1:
  SET merge_scheduled_at = NOW() + 2 minutes
  ADD internal note: "Multiple open tickets detected for this customer. Consolidation scheduled at {merge_scheduled_at}."
  ADD tag: merge_pending

AFTER 2 minutes:
  Re-query open tickets for this customer
  Execute merge strategy (below)
```

### Merge Strategy

All source tickets merge INTO the **latest (newest)** ticket. The latest ticket becomes the **consolidated target**.

#### Step 1: Identify Target and Sources

```
target_ticket = ticket with MAX(created_at) among all open tickets for this customer
source_tickets = all other open tickets for this customer (excluding target)
```

#### Step 2: Copy Comments to Target

For each source ticket, copy all comments (public and internal) as internal notes on the target ticket:

```
Internal Note Format (per source ticket):

---
**[MERGED] From Ticket #{source_ticket.id} ({source_ticket.channel})**
**Subject:** {source_ticket.subject}
**Created:** {source_ticket.created_at}
**Priority:** {source_ticket.priority}

**Conversation History:**
{all comments from source ticket, preserving timestamps and author attribution}
---
```

#### Step 3: Propagate Metadata

| Field | Merge Rule |
|-------|-----------|
| Tags | Union of all tags from source + target (deduplicated) |
| Priority | Escalate to the HIGHEST priority among all tickets (Urgent > High > Normal > Low) |
| Assignee | Most-recently-active agent (agent who last updated any of the tickets). If no agent assigned, leave unassigned for queue routing. |
| Custom fields | Carry forward from source tickets as internal note context |

#### Step 4: Close Source Tickets

```
For each source_ticket:
  - Set status: solved
  - Add tag: merged_source
  - Add tag: merged_into_{target_ticket.id}
  - Add internal note: "This ticket has been merged into #{target_ticket.id} as part of customer ticket consolidation. All conversation history has been copied to the target ticket."
  - Remove from agent queue/views
```

#### Step 5: Tag Target Ticket

```
On target_ticket:
  - Add tag: consolidated_ticket
  - Add tag: merged_count_{N} (where N = number of merged source tickets)
  - Remove tag: merge_pending
  - Remove tag: suppress_auto_ack (agent will now respond manually)
```

### Multi-Issue Tracking

Each merged ticket's issue is classified and tagged on the consolidated target so the agent can see all issues at a glance.

```
For each ticket (source + target), classify the primary issue:

Tag format: issue_thread_{N}_{category}

Examples:
  - issue_thread_1_esim
  - issue_thread_2_payment
  - issue_thread_3_portin
  - issue_thread_4_billing
  - issue_thread_5_network

Categories: esim, payment, portin, billing, network, account, airvet, general
```

Classification is based on ticket subject, body keywords, and existing tags (e.g., if ticket already tagged `esim_issue` from another skill).

### Merge Summary Template

After consolidation completes, add a structured internal note to the target ticket:

```
## Ticket Consolidation Summary

**Consolidated at:** {timestamp}
**Target ticket:** #{target_ticket.id}
**Source tickets merged:** {N}
**Total issues identified:** {M}

### Issues Overview

| # | Issue | Source Ticket | Channel | Priority | Status |
|---|-------|-------------- |---------|----------|--------|
| 1 | {issue description} | #{ticket_id} | Email | High | Open |
| 2 | {issue description} | #{ticket_id} | Chat | Normal | Open |
| 3 | {issue description} | #{ticket_id} | Facebook | Normal | Open |

### Customer Contact History
- {timestamp} — Email: "{subject}" (Ticket #{id})
- {timestamp} — Chat: "{first message}" (Ticket #{id})
- {timestamp} — Facebook: "{post/message}" (Ticket #{id})

### Agent Assignment
- **Primary agent:** {agent_name} (most recently active)
- **Previously involved agents:** {list}

### Action Required
Agent must address ALL {M} issues in a single consolidated response. See Section C for workflow.
```

---

## Section C: Agent Workflow

### Consolidated Ticket Banner

When an agent opens a consolidated ticket, they see a banner (via Zendesk ticket sidebar app or internal note pinned at top):

```
+------------------------------------------------------------------+
|  CONSOLIDATED TICKET — {N} issues from {M} channels              |
|                                                                   |
|  Issues:                                                          |
|  1. [eSIM] eSIM not activating after payment (Email, 2 days ago) |
|  2. [Payment] Double charge on credit card (Chat, 1 hour ago)    |
|  3. [Port-In] Number transfer stuck (Facebook, 30 min ago)       |
|                                                                   |
|  Customer: {name} ({email})                                       |
|  Total contacts: {X} across {channels}                            |
|  Highest priority: {priority}                                     |
|                                                                   |
|  [ ] All issues reviewed                                          |
|  [ ] Response covers all issues                                   |
|  [ ] Response channel selected                                    |
+------------------------------------------------------------------+
```

### Agent Checklist (Auto-Generated Internal Note)

When a consolidated ticket is created, auto-add this internal note:

```
## Agent Pre-Response Checklist

Before responding to this customer, complete the following:

- [ ] Read ALL merged conversation histories (see internal notes below)
- [ ] Identify root cause for EACH issue
- [ ] Check if any issue has a proactive outreach already sent (search for `proactive_alert` tag or recent comms — see **proactive-communication.md**)
- [ ] Determine resolution or next step for EACH issue
- [ ] Draft ONE consolidated response covering ALL issues (see Section E templates)
- [ ] Select response channel (see below)
- [ ] Verify response passes outbound gate (Section D)

### Priority Ordering for Response
Address issues in this order:
1. Service-impacting (no connectivity, can't make calls)
2. Financial (double charges, billing errors)
3. Pending actions (port-in, eSIM activation)
4. Informational (how-to, status updates)

### VIP Check
- Is this a VIP customer? Check tags for `vip`, `influencer`, `high_value`
- If VIP → See Section F: Edge Cases > VIP Customers
```

### Response Channel Selection

| Situation | Primary Channel | Secondary Notification |
|-----------|----------------|----------------------|
| Single issue, single channel | Reply on same channel | None |
| Multi-issue, originated from email | Email | None |
| Multi-issue, originated from chat | Email (detailed response) | Chat: "I've sent you a detailed email covering everything" |
| Multi-issue, originated from social | Email (detailed response) | Social reply: "I've sent you a detailed email at {masked_email}" |
| Multi-issue, cross-channel | Email (detailed response) | Brief notification on each other channel |

> **Rationale:** Email is the best channel for multi-issue responses because it supports structured formatting, doesn't have character limits, and creates a reference document the customer can revisit.

### Agent Lock/Ownership Mechanism

To prevent multiple agents from working on the same consolidated ticket simultaneously:

#### Acquiring Lock

```
ON agent_opens_ticket WHERE tag = consolidated_ticket:
  IF no lock exists:
    SET ticket.assignee = {agent}
    ADD tag: locked_by_{agent_id}
    ADD internal note: "Ticket locked by {agent_name} at {timestamp}"
  IF lock exists AND lock_age < 30 minutes:
    SHOW warning: "This ticket is being worked by {locked_agent}. Coordinate before responding."
  IF lock exists AND lock_age >= 30 minutes:
    RELEASE stale lock
    SET new lock for current agent
    ADD internal note: "Stale lock released. Ticket reassigned to {agent_name}."
```

#### Multi-Agent Coordination on Merge

When tickets are merged, multiple agents may have been working on different source tickets:

```
ON merge_complete:
  primary_agent = agent assigned to target ticket (most recently active)
  other_agents = agents assigned to source tickets (deduplicated, excluding primary)

  FOR each other_agent:
    Send Slack DM:
      "Heads up: Ticket #{source_ticket.id} you were working on has been merged into #{target_ticket.id} (assigned to {primary_agent}). Your ticket conversation has been preserved as internal notes. No action needed from you unless {primary_agent} reaches out."

  ADD internal note to target ticket:
    "Merge notification sent to: {list of other_agents}. Primary agent: {primary_agent}."
```

---

## Section D: Outbound Communication Gate

### 15-Minute Per-Customer Window

After an agent sends a response to a customer, no additional responses can be sent to that same customer for 15 minutes. This prevents rapid-fire responses from different agents or automated systems.

```
ON agent_submits_response:
  CHECK comms_log:
    SELECT COUNT(*) FROM comms_log
    WHERE recipient = {customer_email}
      AND dispatched_at > DATEADD(MINUTE, -15, CURRENT_TIMESTAMP())
      AND source = 'agent_response'

  IF count > 0:
    BLOCK send
    SHOW warning: "A response was sent to this customer {X} minutes ago. Wait {15 - X} minutes or override."
    ALLOW override with reason (agent clicks "Send anyway" + enters justification)
  ELSE:
    ALLOW send
    LOG to comms_log: recipient, channel, timestamp, source='agent_response', ticket_id
```

### Consolidated Response Verification

Before sending, warn the agent if not all issues are addressed:

```
ON agent_submits_response WHERE tag = consolidated_ticket:
  identified_issues = tags matching pattern issue_thread_*
  response_text = agent's draft response

  FOR each issue_tag:
    Check if response_text contains keywords related to the issue category
    (e.g., issue_thread_2_payment → check for "payment", "charge", "refund", "billing")

  IF any issue NOT addressed:
    SHOW warning: "Your response may not address all customer issues:
      - [x] eSIM activation — addressed
      - [ ] Payment double charge — NOT FOUND in response
      - [x] Port-in status — addressed
    Are you sure you want to send? You can edit your response or send anyway."
```

### Meow-Comms De-Duplication Integration

Reactive agent responses pass through the same 4 de-duplication checks defined in **meow-comms/scripts/deduplicate.md**, with reactive-specific adaptations:

#### Check 1: 30-Minute Window (Reactive Adaptation)

```
IF a PROACTIVE message was sent to this customer within the last 30 minutes:
  DO NOT suppress the agent response
  Instead: FLAG for the agent with context:
    "A proactive outreach was sent to this customer {X} min ago:
     Subject: {proactive_message_subject}
     Content summary: {summary}
     Recommendation: Reference the proactive message in your response
     (e.g., 'As mentioned in our earlier email...')"
```

> **Key difference from proactive dedup:** Proactive-to-proactive duplicates are suppressed. But proactive-to-reactive is NOT suppressed — the agent's response should acknowledge and build on the proactive outreach.

#### Check 2: Contradiction Check (Reactive Adaptation)

```
IF agent response CONTRADICTS a recent proactive outreach:
  HOLD the agent response
  SHOW warning:
    "Your response may contradict a proactive message sent {X} hours ago:
     Proactive said: '{summary}'
     Your response says: '{conflicting_part}'
     Please review and align before sending."
  REQUIRE agent acknowledgement to proceed
```

Example: Proactive message said "We're working on your eSIM issue" but agent writes "We don't see any issue with your eSIM."

#### Check 3: Channel Saturation (Reactive Adaptation)

```
Combined count = proactive messages (last 24h) + reactive responses (last 24h)

IF combined_count >= 3:
  IF this is the agent's FIRST response on the consolidated ticket:
    ALLOW send (agent MUST respond at least once)
    LOG: "saturation_override_first_response"
  ELSE:
    CONSOLIDATE into next scheduled response
    LOG: "saturation_deferred"
```

> **Key difference:** Proactive saturation caps at 3 messages / 24h. Combined proactive+reactive caps at 5 / 24h (3 proactive slots + 2 reactive slots, since reactive responses are customer-initiated and expected by the customer).

#### Check 4: Signal Merge (Reactive Adaptation)

```
IF there are PENDING proactive messages in the outbound queue for this customer:
  MERGE the pending proactive content into the agent's response
  CANCEL the pending proactive dispatch
  LOG: "proactive_merged_into_reactive"

  Agent sees:
    "There is a pending proactive outreach for this customer:
     Signal: {signal_type}
     Content: {proactive_message}
     This content has been appended to your response draft. Please review."
```

> **Rationale:** If an agent is already responding, it's better to include the proactive info in the human response than to send a separate automated message.

### When Multiple Responses ARE Allowed

Even with the 15-minute window, multiple responses are permitted when:

| Scenario | Rule |
|----------|------|
| Different severity levels | P1 (Critical) gets immediate response; P4 (Low) is batched. A new P1 bypasses the window. |
| Corrections | Agent needs to correct erroneous information in a prior response. Tag: `correction_response`. |
| Proactive + reactive collision | Customer reaches out about the same issue we proactively messaged about. Agent replies referencing the proactive outreach. |
| Customer escalation request | Customer explicitly asks to speak to a manager or requests escalation. Escalation response bypasses window. |

---

## Section E: Templates

### Template 1: Consolidated Response (Multi-Issue Email)

```
Subject: Update on your Meow Mobile support requests

Hi {customer_name},

Thank you for reaching out to us. I've reviewed all of your recent messages and I want to address everything in one place so you have a clear picture.

{--- Issues listed in priority order ---}

**Regarding your {issue_1_category}:**
{issue_1_response — specific diagnosis, action taken, next steps}

**Regarding your {issue_2_category}:**
{issue_2_response — specific diagnosis, action taken, next steps}

**Regarding your {issue_3_category}:**
{issue_3_response — specific diagnosis, action taken, next steps}

{--- Summary of next steps ---}

Here's a quick summary of what happens next:
{numbered list of pending actions with timelines}

If anything doesn't look right or you have additional questions, just reply to this email — I'm personally handling your case and will make sure everything is resolved.

Best,
{agent_name}
Meow Mobile Support
```

**Internal note after sending:**

```
Consolidated response sent covering {N} issues:
- Issue 1: {category} — {resolution/next_step}
- Issue 2: {category} — {resolution/next_step}
- Issue 3: {category} — {resolution/next_step}
Response channel: Email
Agent: {agent_name}
```

### Template 2: Chat/Social Notification (After Email Sent)

```
Hi {customer_name}! I just sent you a detailed email at {masked_email} covering all the items you've reached out about. Please check your inbox (and spam folder just in case). If you have any quick questions in the meantime, I'm here!
```

### Template 3: Merge Notification (Slack DM to Affected Agents)

```
:link: *Ticket Merge Notification*

Your ticket *#{source_ticket.id}* ("{source_ticket.subject}") has been merged into *#{target_ticket.id}*.

*Why:* Same customer ({customer_email}) has multiple open tickets. All issues are now consolidated.
*Assigned to:* {primary_agent}
*Your action:* None required. Your conversation history has been preserved as internal notes on the target ticket.

If you had context that isn't captured in the ticket, please add an internal note to #{target_ticket.id}.
```

### Template 4: Merge Audit Log (Internal Note on Target Ticket)

```
## Merge Audit Log

**Merge ID:** MRG-{auto_generated}
**Executed at:** {timestamp}
**Trigger:** New ticket #{new_ticket.id} created while {N} open tickets existed

### Tickets Merged

| Source Ticket | Subject | Channel | Created | Priority | Agent |
|--------------|---------|---------|---------|----------|-------|
| #{id} | {subject} | {channel} | {created_at} | {priority} | {assignee} |
| #{id} | {subject} | {channel} | {created_at} | {priority} | {assignee} |

### Metadata Propagation
- **Priority escalated to:** {highest_priority}
- **Tags merged:** {list of unique tags}
- **Assigned to:** {primary_agent} (reason: most recently active)
- **Agents notified:** {list of other agents notified via Slack}

### Issues Classified
{list of issue_thread tags applied}
```

### Template 5: Agent Guidance — Pre-Response Checklist

```
## Quick Response Guide for Consolidated Tickets

1. **Read everything first.** Scroll through ALL internal notes — each merged ticket's history is there.
2. **Check proactive outreach.** Search for `proactive_alert` tag or ask: "Has this customer received any proactive messages?" If yes, reference it: "As we mentioned in our earlier email..."
3. **Address every issue.** The system will warn you if you miss one. Priority order: service-impacting > financial > pending actions > informational.
4. **One email, all answers.** Use the consolidated response template (Template 1). Keep it scannable — bold headers for each issue.
5. **Notify other channels.** If the customer contacted via chat or social, send a brief "check your email" message there (Template 2).
6. **Log your response.** The system auto-logs, but add an internal note if you promised a follow-up or timeline.
```

### Template 6: VIP Customer Guidance

```
## VIP Customer Alert

This is a VIP customer. Apply enhanced handling:

- **Priority:** Automatically set to HIGH (minimum)
- **SLA:** Respond within 2 hours
- **Tone:** Executive-level empathy, acknowledge their loyalty
- **Authority:** You have retention authority — offer service credits up to $50 without L2 approval
- **Follow-up:** Schedule a personal follow-up within 24 hours after resolution
- **Escalation:** If unresolved within 4 hours, auto-escalate to L2 with VIP flag

See **escalation-guide.md** > "VIP/influencer customer" for full escalation path.
```

---

## Section F: Edge Cases

### 1. Customer Replies to an Old Merged Ticket

**Scenario:** Customer receives an email notification from the old (now solved/merged) ticket and replies to it.

```
ON ticket_update WHERE tags contain merged_source:
  target_ticket_id = extract from tag merged_into_{id}

  IF target_ticket EXISTS AND status IN (new, open, pending):
    Copy the customer's reply as internal note on target_ticket
    Add internal note on source ticket: "Customer reply redirected to active ticket #{target_ticket_id}"
    Keep source ticket as solved (do not reopen)
    ADD urgent internal note on target_ticket:
      "Customer replied to a previously merged ticket (#{source_ticket.id}). Their message: '{reply_text}'. This has been added to the consolidated ticket."
  ELSE:
    Reopen the source ticket as a new conversation
    Remove merged_source tag
    Run consolidation check again (Section B)
```

### 2. New Ticket Arrives While Agent Is Drafting

**Scenario:** Agent is writing a response to a consolidated ticket when the customer creates yet another ticket.

```
ON new_ticket_created WHERE customer has consolidated_ticket in progress:
  Merge new ticket into existing consolidated target (Section B merge strategy)
  ADD urgent internal note on target ticket:
    ":warning: NEW TICKET JUST MERGED while you were drafting!
     Ticket: #{new_ticket.id}
     Subject: {new_ticket.subject}
     Channel: {new_ticket.channel}
     Please review before sending your response."

  Send Slack DM to assigned agent:
    ":warning: New ticket from {customer_name} just merged into #{target_ticket.id} which you're currently working on. Check internal notes before sending your response."
```

### 3. VIP Customers

**Scenario:** Customer is tagged as VIP, high-value, or influencer.

```
ON consolidation_complete WHERE customer tags contain vip OR high_value OR influencer:
  SET priority = HIGH (minimum, can be escalated higher)
  ADD tag: vip_handling
  Route to VIP queue (if exists) or priority queue
  SET SLA: 2-hour first response
  ADD VIP guidance template (Template 6) as internal note
  Grant agent retention authority ($50 credit limit without L2 approval)

  IF unresolved after 4 hours:
    Auto-escalate to L2 with VIP flag
    Slack alert to #cs-leads: "VIP customer {name} unresolved after 4h — #{ticket_id}"
```

### 4. Cross-Channel Simultaneous Tickets

**Scenario:** Customer sends an email, starts a chat, AND posts on Facebook — all within minutes.

```
ON multiple_tickets_detected WHERE channels are different:
  Apply standard consolidation (Section B)
  Primary response: Email (multi-issue format, Template 1)
  Secondary notifications: Brief message on each other channel (Template 2)

  Channel-specific notifications:
    Chat: "Hi {name}! I see you've reached out on a few channels — I've sent a comprehensive email to {masked_email} covering everything. Let me know if you need anything else here!"
    Facebook: "Hi {name}, thank you for reaching out! I've sent a detailed response to your email addressing all your questions. Please check your inbox."
    Instagram: (same as Facebook)
```

### 5. Proactive + Reactive Collision

**Scenario:** The proactive engine detected a signal AND the customer contacts us about the same issue.

```
ON new_ticket_created WHERE customer has proactive_alert ticket:
  DO NOT merge reactive ticket into proactive ticket (different workflows)
  Instead:
    Link tickets: Add tag linked_to_{proactive_ticket_id} on reactive ticket
    Add tag linked_to_{reactive_ticket_id} on proactive ticket
    ADD internal note on reactive ticket:
      "This customer also has a proactive alert ticket (#{proactive_ticket_id}) for signal {signal_type}. Proactive outreach [was sent / is pending]. Reference the proactive message in your response."
    ADD internal note on proactive ticket:
      "Customer has now contacted us directly (#{reactive_ticket_id}). Reactive response will reference proactive outreach."

  Agent response should acknowledge proactive outreach:
    "I see we already reached out to you about this — I wanted to follow up personally and give you a full update..."
```

### 6. Duplicate Emails (Same Content Twice)

**Scenario:** Customer accidentally sends the same email twice (identical subject and body).

```
ON new_ticket_created:
  Check for duplicate content:
    SELECT ticket_id FROM tickets
    WHERE requester = {customer_email}
      AND subject = {new_ticket.subject}
      AND created_at > DATEADD(MINUTE, -10, {new_ticket.created_at})
      AND ticket_id != {new_ticket.id}

  IF duplicate found AND body_similarity > 90%:
    SET new_ticket status = solved
    ADD tag: silent_duplicate_close
    ADD internal note: "Duplicate of #{original_ticket.id} — same subject and body within 10 minutes. Silently closed."
    DO NOT notify customer
    DO NOT merge (nothing new to merge)
```

### 7. Customer Replies "Thanks" / Confirmation

**Scenario:** Customer replies with a short acknowledgement ("thanks", "got it", "perfect").

```
ON ticket_update WHERE requester replied:
  IF reply_length < 50 characters AND contains_gratitude_keyword(reply):
    SET ticket status = pending
    ADD internal note: "Customer acknowledged with: '{reply}'. Auto-set to pending."
    Send brief thank-you:
      "You're welcome, {name}! If anything else comes up, don't hesitate to reach out. Have a great day!"
    Schedule auto-solve: 24 hours from now
      "IF status still = pending after 24h → set status = solved, add tag: auto_solved_ack"

  gratitude_keywords = ["thanks", "thank you", "got it", "perfect", "great", "awesome", "appreciate it", "that works", "all good"]
```

---

## Section G: Orchestration Rules & Integration Points

### De-Duplication Summary Table (Reactive-Specific)

| Check | Proactive Behavior (meow-comms) | Reactive Behavior (this skill) |
|-------|--------------------------------|-------------------------------|
| 30-min window | Suppress duplicate proactive messages | Do NOT suppress agent response; flag proactive context instead |
| Contradiction | Hold for human review in #comms-review | Hold and warn agent directly in-ticket before send |
| Channel saturation | Cap at 3 messages / 24h (CRITICAL bypasses) | Combined proactive+reactive cap at 5 / 24h; agent's first response always allowed |
| Signal merge | Merge multiple proactive signals into one message | Merge pending proactive messages INTO the agent's response |

### Integration Map

This skill interacts with the following existing skills:

| Skill | Integration Point |
|-------|------------------|
| **proactive-communication.md** | Collision handling (Section F.5). Reactive tickets linked to proactive alerts. Agent references proactive outreach in response. Pending proactive messages merged into reactive response (Section D, Check 4). |
| **meow-comms/SKILL.md** | De-duplication engine shared (Section D). Reactive responses pass through same 4 checks with adaptations. Comms logged to same customer graph via **meow-comms/scripts/log-to-graph.md**. |
| **meow-comms/scripts/deduplicate.md** | Direct integration — reactive adaptations of all 4 checks (Section D). |
| **incident-communication-playbook.md** | Incident tickets excluded from reactive consolidation (Section A suppression exceptions). Incident tickets have their own communication cadence. |
| **escalation-guide.md** | VIP escalation path (Section F.3). L2 auto-escalation after 4h for VIP. Consolidated tickets that stall follow standard escalation tiers. |
| **email-handling.md** | Email is the primary channel for consolidated multi-issue responses. Formatting follows email-handling.md standards (headers, structure, signature). |
| **mochi-handoff.md** | Mochi-escalated tickets excluded from auto-ack suppression (Section A). If a Mochi escalation is part of a consolidation, Mochi conversation history is included in the merge summary. |

### Communication Flow: Reactive vs. Proactive

```
PROACTIVE FLOW (proactive-communication.md + meow-comms):
  Signal detected → Classify → Route → Generate → Personalize → Dedup → Dispatch → Log
  (System-initiated, no customer action needed)

REACTIVE FLOW (this skill):
  Customer contacts us → Suppress auto-ack → Consolidate tickets → Agent reviews
  → Agent drafts ONE response → Outbound gate (dedup + verification) → Send → Log
  (Customer-initiated, agent-mediated)

COLLISION (both flows active for same customer):
  Proactive message sent/pending + Customer contacts us
  → Link tickets (don't merge)
  → Agent references proactive outreach in reactive response
  → Pending proactive messages folded into agent response
  → Single cohesive communication reaches customer
```

---

## Parameters

| Parameter | Required | Type | Description |
|-----------|----------|------|-------------|
| `customer_email` | Yes | string | Customer email — used for consolidation lookup |
| `ticket_id` | Yes | string | The triggering ticket ID |
| `channel` | Yes | enum | email, chat, facebook, instagram, web_widget, api |
| `suppress_auto_ack` | No | boolean | Override auto-ack suppression (default: true) |
| `skip_consolidation` | No | boolean | Skip ticket consolidation (e.g., for one-off follow-ups) |
| `force_merge` | No | boolean | Force immediate merge without 2-min grace period |
| `override_15min_window` | No | boolean | Allow agent to bypass the 15-min outbound gate |
| `vip` | No | boolean | Force VIP handling regardless of tags |

---

## Example Usage

### Scenario 1: Single Ticket, No Consolidation Needed

```
Customer: sarah@example.com emails about eSIM not activating.

1. Ticket #201 created via email.
2. Auto-ack SUPPRESSED (tag: suppress_auto_ack).
3. Consolidation check: No other open tickets for sarah@example.com.
4. suppress_auto_ack tag removed (single ticket, normal flow).
5. Agent picks up ticket, responds normally via email.
6. Response logged to comms_log.
```

### Scenario 2: Multi-Ticket, Same Issue

```
Customer: mike@example.com sends 2 emails about the same port-in issue (10 minutes apart).

1. Ticket #301 created via email. Auto-ack suppressed.
2. Consolidation check: No other tickets. suppress_auto_ack removed.
3. Ticket #302 created via email (10 min later). Auto-ack suppressed.
4. Consolidation check: Ticket #301 is open for same customer.
5. 2-minute grace period starts.
6. After 2 minutes: Merge #301 INTO #302 (newest).
   - #301 comments copied as internal notes on #302.
   - #301 set to solved, tagged merged_source, merged_into_302.
   - #302 tagged consolidated_ticket, issue_thread_1_portin.
7. Agent opens #302, sees merge summary and checklist.
8. Agent sends ONE response about the port-in issue.
9. Response passes outbound gate (no recent sends, all issues addressed).
```

### Scenario 3: Multi-Ticket, Different Issues, Cross-Channel

```
Customer: lisa@example.com sends an email about a payment issue, starts a chat about eSIM, posts on Facebook about port-in — all within 5 minutes.

1. Ticket #401 (email, payment). Auto-ack suppressed. No other tickets yet.
2. Ticket #402 (chat, eSIM). Auto-ack suppressed. Consolidation detects #401.
3. Ticket #403 (Facebook, port-in). Auto-ack suppressed. Consolidation detects #401, #402.
4. 2-minute grace period starts (from first detection).
5. After 2 minutes: Merge #401, #402 INTO #403 (newest).
   - All comments copied to #403 as internal notes.
   - #401, #402 solved and tagged merged_source.
   - #403 tagged: consolidated_ticket, issue_thread_1_payment, issue_thread_2_esim, issue_thread_3_portin.
   - Priority: HIGH (Facebook = public visibility).
6. Agent opens #403, sees banner with 3 issues across 3 channels.
7. Agent drafts consolidated email (Template 1) addressing payment, eSIM, and port-in.
8. Outbound gate: All 3 issues addressed? Yes. 15-min window clear? Yes. Send.
9. Consolidated email sent to lisa@example.com.
10. Brief notification sent on chat: "I've sent you a detailed email covering everything!"
11. Brief reply on Facebook: "Hi Lisa, I've sent a detailed response to your email!"
```

### Scenario 4: Proactive + Reactive Collision

```
Customer: alex@example.com
- Proactive engine detected SIG-002 (eSIM failed) 1 hour ago.
- Proactive email sent: "We detected an issue with your eSIM activation..."
- Now: Alex emails us: "My eSIM isn't working, what's going on?"

1. Ticket #501 created (reactive, email). Auto-ack suppressed.
2. Consolidation check: Proactive ticket #490 exists (tagged proactive_alert).
3. DO NOT merge (proactive and reactive have different workflows).
4. Link: #501 tagged linked_to_490, #490 tagged linked_to_501.
5. Internal note on #501: "Proactive alert ticket #490 exists. Proactive email was sent 1h ago."
6. Agent opens #501, sees proactive context flag.
7. Check 1 (30-min window): Proactive email sent 1h ago — flag context, don't suppress.
8. Check 4 (signal merge): No pending proactive messages (already sent).
9. Agent responds: "Hi Alex, I see we already reached out to you about this — I wanted to follow up personally. Here's the latest on your eSIM..."
10. Response sent. Both tickets updated. Comms logged.
```
