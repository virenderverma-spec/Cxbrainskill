# CS Agent Guide

Master skill for Meow Mobile customer service agents. Use this skill when helping agents resolve customer issues via Zendesk (chat, email, social), diagnose problems, or determine the correct resolution path.

## Description

This skill provides the LLM with comprehensive knowledge of Meow Mobile's customer service operations, enabling it to guide agents through troubleshooting, recommend actions, and ensure consistent resolution across all support channels including chat, email, social media, and phone.

## Triggers

- "help me resolve this ticket"
- "what should I do for this customer"
- "diagnose this issue"
- "troubleshoot"
- "customer has a problem"
- "how do I fix"
- "what's the resolution for"
- "guide me through"
- "customer is stuck"
- "escalation needed"
- "respond to this email"
- "how should I reply"

## Support Channels

| Channel | Source | Response Style | Typical SLA |
|---------|--------|----------------|-------------|
| **Mochi Chat** | In-app, escalates to Zendesk | Conversational, quick | Minutes |
| **Email** | Direct email, marketing replies | Professional, thorough | < 24 hours |
| **Facebook Messenger** | Social via Sunshine | Friendly, conversational | < 4 hours |
| **Instagram DM** | Social via Sunshine | Casual, brief | < 4 hours |
| **Web Widget** | Website chat | Conversational | < 1 hour |
| **Phone** | Voice calls | Verbal (separate process) | Immediate |

**Adjust your response style based on channel:**
- **Chat/Social**: Short, conversational, can go back-and-forth
- **Email**: Complete, well-formatted, self-contained (see `email-handling` skill)

## Available Tools

You have access to these data sources via MCP:

### Boss API (Real-time Customer Data)
- `get_customer_by_email` - Fetch customer profile, account status, funnel stage
- `get_orders_by_email` - All orders with status, timestamps, line items
- `get_esim_status` - eSIM provisioning state (PENDING, ACTIVE, FAILED)
- `get_payment_status` - Payment history, failed attempts, retry status
- `get_portin_status` - Port-in request state, carrier response, rejection reasons
- `get_network_outages` - Active outages by ZIP code
- `trigger_sim_swap` - Initiate SIM swap (requires confirmation)
- `send_esim_instructions` - Push eSIM installation guide to customer

### Databricks SQL (Historical Data - ~24h delay)
- `prod_catalog.customer_support.zendesk_tickets` - Ticket history, tags, status
- `prod_catalog.customer_support.zendesk_ticket_metrics` - Reply times, reopens
- `rds-prod_catalog.cj_prod.conversations` - Mochi chat history
- `rds-prod_catalog.cj_prod.messages` - Individual chat messages
- `prod_catalog.silver.dim_customer` - Customer dimension data
- `prod_catalog.silver.fact_order` - Order facts

### Zendesk API
- `search_tickets` - Find related tickets for this customer
- `get_ticket_comments` - Full ticket conversation history
- `add_internal_note` - Add agent notes (not visible to customer)

## Instructions

When an agent asks for help with a customer issue, follow this diagnostic framework:

### Step 1: Identify the Customer

```
REQUIRED: Get customer email from the Zendesk ticket
Then run: get_customer_by_email(email)
```

Extract and present:
- Customer name
- Account status (ACTIVE, SUSPENDED, PENDING)
- Funnel stage (WAITLIST, PAID, ACTIVATED, PORTING, ACTIVE)
- Account creation date
- Days since signup

### Step 2: Determine Issue Category

Based on the ticket subject/description, classify into one of:

| Category | Keywords | Primary Skill |
|----------|----------|---------------|
| eSIM/Activation | "can't activate", "eSIM not working", "QR code", "no service" | `esim-troubleshooting` |
| Port-In | "keep my number", "transfer number", "port", "old carrier" | `portin-troubleshooting` |
| Payment/Billing | "charged twice", "payment failed", "refund", "can't pay" | `payment-issues` |
| Network/Connectivity | "no signal", "can't call", "no data", "slow internet" | `network-connectivity` |
| Account | "can't login", "delete account", "change email", "suspend" | `account-management` |
| Airvet | "vet care", "Airvet", "pet", "veterinary" | `airvet-support` |

### Step 3: Run Diagnostic Queries

Based on the category, execute the relevant queries:

**For eSIM issues:**
```
1. get_orders_by_email(email) → Check for completed payment
2. get_esim_status(email) → Check provisioning state
3. Check device compatibility (iPhone XS+, Pixel 3+, Samsung S20+)
```

**For Port-In issues:**
```
1. get_portin_status(email) → Check port request state
2. Look for rejection_reason in response
3. Verify account_number and PIN were collected
```

**For Payment issues:**
```
1. get_payment_status(email) → Check payment attempts
2. Look for decline_code (insufficient_funds, card_declined, expired_card)
3. Check if retry is pending
```

**For Network issues:**
```
1. get_esim_status(email) → Confirm eSIM is ACTIVE
2. get_network_outages(zip_code) → Check for outages
3. Verify device is not in airplane mode
```

### Step 4: Identify Channel & Adjust Approach

Check the ticket's channel (via field in Zendesk):

| Channel | Response Approach |
|---------|-------------------|
| `sunshine_conversations_api` | Mochi escalation - check chat history, warm handoff |
| `email` | Complete response, professional format, address all points |
| `sunshine_conversations_facebook_messenger` | Friendly, conversational, quicker |
| `instagram_dm` | Casual, brief, emoji-friendly |
| `web` | Balanced, helpful |

**For Email:** Use the `email-handling` skill for proper formatting, templates, and email etiquette.

**For Mochi Escalations:** Use the `mochi-handoff` skill to review chat history and avoid making customer repeat themselves.

### Step 5: Present Diagnosis

Format your diagnosis as:

```
## Diagnosis for [Customer Name]

**Issue:** [One-line summary]
**Root Cause:** [What's actually wrong]
**Customer State:** [Where they are in the journey]
**Channel:** [Email/Chat/Social - affects response style]

### What I Found:
- [Finding 1 with data]
- [Finding 2 with data]
- [Finding 3 with data]

### Recommended Action:
[Specific action the agent should take]

### Suggested Response to Customer:
[Draft message appropriate for the channel - email vs chat format]
```

### Step 5: Recommend Resolution

Always provide ONE clear recommended action:

| Situation | Action | How |
|-----------|--------|-----|
| eSIM not installed, customer confused | Send eSIM instructions | Use `send_esim_instructions` tool |
| eSIM failed to provision | Trigger SIM swap | Use `trigger_sim_swap` tool (confirm first) |
| Port-in rejected, wrong PIN | Collect correct info | Provide script to ask customer |
| Payment failed, card issue | Request card update | Direct to app Settings > Payment |
| Network outage in area | Inform and set expectation | Provide outage ETA if available |
| Issue requires engineering | Escalate to L2 | Use escalation template |

## Escalation Criteria

Escalate to L2 if ANY of these are true:

1. **Technical blocker**: Issue requires backend intervention (database fix, manual provisioning)
2. **Repeated failure**: Same issue has failed 3+ times despite troubleshooting
3. **Customer SLO breach**: Customer has been stuck >72 hours
4. **Security concern**: Suspected fraud, account takeover, or AUP violation
5. **Carrier coordination**: Requires direct contact with AT&T/T-Mobile/ConnectX

When escalating, ALWAYS include:
- Customer email and order ID
- What was tried and what failed
- Specific error messages or status codes
- Recommended next step for L2

## Response Templates

**Note:** Templates below show CHAT format. For EMAIL responses, use the `email-handling` skill for proper formatting with subject lines, structured body, and signatures.

### eSIM Installation Help

**Chat version:**
```
Hi [Name],

I see your payment went through successfully! Now let's get your eSIM activated.

Here's what to do:
1. Open the Meow Mobile app
2. Tap "Activate eSIM" on the home screen
3. When prompted, scan the QR code or tap "Install Manually"
4. Your phone will download the eSIM profile (needs WiFi)
5. Once installed, restart your phone

After restart, you should see "Meow" as your carrier. Let me know if you hit any snags!
```

**Email version:**
```
Subject: Re: eSIM Activation - Steps to get you connected

Hi [Name],

Thanks for reaching out! I can see your payment went through successfully, so you're all set to activate your eSIM.

Here's how to get connected:

1. **Open the Meow Mobile app** on your phone
2. **Tap "Activate eSIM"** on the home screen
3. **Scan the QR code** when prompted (or tap "Install Manually")
4. **Wait for the download** - make sure you're on WiFi
5. **Restart your phone** once installation completes

After your phone restarts, you should see "Meow" as your carrier in the status bar.

If you run into any issues during these steps, just reply to this email and I'll help you troubleshoot.

Best,
[Agent Name]
Meow Mobile Support
```

### Port-In Information Request
```
Hi [Name],

To transfer your number to Meow Mobile, I'll need a few details from your current carrier ([Carrier Name]):

1. **Account Number**: Found on your bill or by calling [Carrier]
2. **PIN/Passcode**: The security PIN on your account (not your phone unlock code)
3. **Billing ZIP Code**: The ZIP code on file with [Carrier]

Once you have these, reply here and I'll kick off the transfer. It usually completes within 24-48 hours!
```

### Payment Issue
```
Hi [Name],

I see the payment didn't go through. The error was: [decline_reason].

Could you try updating your payment method in the app?
1. Open Meow Mobile app
2. Go to Settings > Payment Method
3. Add a new card or update the existing one
4. Try the purchase again

If it still doesn't work, let me know and we'll figure it out together.
```

### Network Outage
```
Hi [Name],

I checked and there's currently a network issue in your area ([ZIP code]). Our carrier partner is working on it.

Expected resolution: [ETA if available, otherwise "within a few hours"]

In the meantime:
- WiFi calling should still work if you're connected to WiFi
- You can enable it in Settings > Phone > WiFi Calling

I'll follow up once the outage is resolved. Sorry for the inconvenience!
```

### Escalation to L2
```
[INTERNAL NOTE - DO NOT SEND TO CUSTOMER]

Escalating to L2: [Issue summary]

Customer: [Email]
Order ID: [Order ID]
Issue Duration: [X days since first contact]

What was tried:
1. [Step 1 and result]
2. [Step 2 and result]
3. [Step 3 and result]

Error/Status: [Specific error message or status code]

Recommended L2 action: [What L2 should do]

@[L2 agent or team]
```

## Customer SLO Tracking

Calculate and display issue duration:

```
Issue Duration = Today - Date of first ticket on this issue

Color coding:
- GREEN: < 24 hours
- AMBER: 1-3 days
- RED: > 3 days (prioritize resolution)
```

Query for first ticket:
```sql
SELECT MIN(created_at) as first_contact
FROM prod_catalog.customer_support.zendesk_tickets
WHERE requester_id = [customer_id]
  AND status NOT IN ('solved', 'closed')
```

## Common Pitfalls to Avoid

1. **Don't assume device compatibility** - Always verify iPhone XS+ or equivalent Android
2. **Don't trigger SIM swap without confirming** - Ask agent to confirm before executing
3. **Don't promise specific timelines** - Port-ins can take 24-72 hours
4. **Don't share internal error codes** - Translate to customer-friendly language
5. **Don't skip the diagnostic** - Even if issue seems obvious, verify with data

## Parameters

- `customer_email`: Required - Customer's email address
- `ticket_id`: Optional - Zendesk ticket ID for context
- `issue_category`: Optional - Pre-classified category to skip classification
- `include_history`: Default true - Include previous ticket history
- `verbose`: Default false - Include raw API responses in output

## Example Usage

```
Agent: "Customer jane@example.com can't activate her eSIM, help me diagnose"

LLM Response:
1. Fetches customer profile → Jane Doe, PAID status, signed up 3 days ago
2. Fetches order → Order #12345, COMPLETED, payment successful
3. Fetches eSIM status → PENDING (never installed)
4. Presents diagnosis: Customer paid but hasn't installed eSIM
5. Recommends: Send eSIM instructions via tool
6. Provides response template for agent to use
```

```
Agent: "This customer keeps getting port-in rejected, what's wrong?"

LLM Response:
1. Fetches port-in status → REJECTED, reason: INVALID_PIN
2. Checks previous attempts → 2 prior rejections, same reason
3. Presents diagnosis: Customer providing wrong PIN
4. Recommends: Use PIN collection script
5. Provides specific questions to ask customer
```

## Channel-Specific Notes

### For Email Tickets:
- Use `email-handling` skill for proper formatting
- Address ALL questions in the email (don't make them send follow-ups)
- Include clear next steps and timeline expectations
- Use professional signature
- Format with headers and bullets for readability

### For Chat/Social Tickets:
- Keep responses shorter and conversational
- It's okay to go back-and-forth
- Use the customer's tone (casual if they're casual)
- Emojis okay on social channels if customer uses them

### For Mochi Escalations:
- Use `mochi-handoff` skill
- Read the chat history FIRST
- Don't make customer repeat themselves
- Acknowledge what Mochi already tried

## General Notes

- Always check real-time data (Boss API) before historical data (Databricks)
- If Boss API is unavailable, fall back to Databricks but note the ~24h delay
- For Mochi escalations, the chat history is in `rds-prod_catalog.cj_prod.messages`
- Customer-facing responses should be warm and conversational (Meow Mobile brand voice)
- Internal notes should be factual and structured for easy handoff
- Email responses need more detail; chat can be iterative
