# Mochi Handoff & Channel Transitions

Handle transitions between Mochi (AI chatbot) and human agents, email thread continuity, and cross-channel context preservation.

## Description

This skill defines how to handle tickets that escalated from Mochi to human agents, how to manage email threads with history, and how to ensure smooth handoffs across all channels. Customers should never have to repeat themselves regardless of how they contact us.

## Triggers

- "Mochi escalation"
- "from the chatbot"
- "customer was talking to Mochi"
- "bot couldn't help"
- "transferred from Mochi"
- "chat history"
- "what did Mochi try"
- "continue from Mochi"
- "email thread"
- "previous conversation"
- "follow up on ticket"
- "customer emailed again"

## Mochi Overview

**What is Mochi?**
- AI-powered customer support chatbot
- First line of support in the Meow Mobile app
- Handles FAQs, simple lookups, guided troubleshooting
- Escalates to human agents when needed

**Mochi's capabilities:**
- Answer product questions
- Check order/account status
- Guide through basic troubleshooting
- Collect information for complex issues
- Create support tickets
- Escalate to human agents

**Mochi's limitations:**
- Cannot perform account changes
- Cannot process refunds
- Cannot override system states
- Cannot handle complex multi-step issues
- Cannot make judgment calls on exceptions

## Mochi Escalation Reasons

When Mochi escalates, it tags the reason:

| Tag | Meaning | Agent Action |
|-----|---------|--------------|
| `mochi_escalation_requested` | Customer asked for human | Greet warmly, review context |
| `mochi_escalation_complex` | Issue too complex for bot | Review what Mochi tried |
| `mochi_escalation_failed` | Mochi couldn't resolve | Check error/failure point |
| `mochi_escalation_sentiment` | Customer frustrated | Lead with empathy |
| `mochi_escalation_loop` | Customer stuck in loop | Break the pattern, direct help |

## Reading Mochi History

### How to Access Mochi Conversation

```
Query Databricks:
SELECT m.role, m.content, m.created_at
FROM `rds-prod_catalog`.cj_prod.messages m
JOIN `rds-prod_catalog`.cj_prod.conversations c
  ON m.conversation_id = c.conversation_id
WHERE c.user_id = '[customer_email]'
ORDER BY m.created_at DESC
LIMIT 50
```

**Message roles:**
- `user` - Customer messages
- `assistant` - Mochi responses
- `system` - System events (escalation, etc.)
- `human_agent` - Human agent messages (if previously escalated)

### Quick Context Summary

When a ticket comes from Mochi, quickly scan for:

1. **What did customer ask for?** (First few user messages)
2. **What did Mochi try?** (Assistant responses, any tool calls)
3. **Where did it fail?** (Last exchange before escalation)
4. **Customer sentiment?** (Frustrated? Confused? Angry?)

## Handling Mochi Escalations

### Step 1: Acknowledge the Handoff

**DO NOT** make customer repeat everything. Start with:

```
Hi [Name]! I'm [Agent], a human taking over from Mochi.

I can see you've been trying to [summarize issue from Mochi history]. Let me take a closer look and get this sorted for you.

[If Mochi collected useful info:]
I see you already provided [info]. That's helpful - I won't need to ask for that again.

Give me just a moment to review everything...
```

### Step 2: Review Mochi's Attempts

Check what Mochi already tried:

| Mochi Action | Visible In | Agent Should |
|--------------|------------|--------------|
| Status lookup | Mochi showed order/account status | Verify if still current |
| Troubleshooting | Mochi walked through steps | Don't repeat same steps |
| Info collection | Customer provided account details | Use that info, don't re-ask |
| FAQ answer | Mochi provided standard answer | Address why it didn't help |

### Step 3: Pick Up Where Mochi Left Off

**If Mochi was on the right track:**
```
Mochi was heading in the right direction. Let me continue from where we left off.

[Continue troubleshooting from the point Mochi stopped]
```

**If Mochi was stuck/wrong:**
```
I see Mochi tried [X], but let me take a different approach that should work better for your situation.

[Start appropriate troubleshooting path]
```

**If customer just wanted a human:**
```
No problem - sometimes it's just easier to talk to a real person! I'm happy to help.

Now, let me look at [issue]...
```

---

## Escalation Scenarios

### Scenario 1: Customer Requested Human

Customer said "talk to a human" or "real person please"

```
Agent response:
Hi [Name]! You've got a real human now - I'm [Agent].

I see you were asking about [issue from history]. Let me help you with that directly.

[Address their original question]
```

### Scenario 2: Mochi Couldn't Resolve

Mochi tried but the issue is beyond its capabilities.

```
Agent response:
Hi [Name], I'm [Agent] taking over.

I can see Mochi tried to help with [issue] but hit a wall. This is exactly the kind of thing that needs a human touch.

Let me dig into this properly...

[Run appropriate diagnostic]
```

### Scenario 3: Customer Was Frustrated

Sentiment detection triggered escalation (customer expressed frustration).

```
Agent response:
Hi [Name], I'm [Agent] - a real person here to help.

I can see this has been frustrating, and I'm sorry the bot couldn't get this sorted for you. Let me take over and make this right.

[Summarize what you understand the issue to be]

Is that correct, or is there more to it?
```

### Scenario 4: Mochi Loop

Customer kept getting the same unhelpful responses.

```
Agent response:
Hi [Name]! I'm [Agent], stepping in because I can see you were going in circles with Mochi.

Let me break that loop and actually solve this. Looking at your conversation, it seems like [issue].

[Take direct action rather than asking more questions]
```

---

## What Mochi Should Include in Escalation

When Mochi hands off to a human, it should pass:

```
## Mochi Escalation Summary

**Customer:** [name] ([email])
**Issue:** [one-line summary]
**Escalation reason:** [requested / complex / failed / sentiment]

### Conversation Summary
- Customer asked about: [topic]
- Mochi attempted: [what was tried]
- Stuck at: [where it failed]

### Information Collected
- [Any account details provided]
- [Any troubleshooting already done]
- [Customer preferences mentioned]

### Customer Sentiment
[Neutral / Frustrated / Angry / Confused]

### Suggested Next Steps
[What Mochi thinks agent should try]
```

## Agent-to-Mochi Handback

Sometimes an issue is resolved and customer has follow-up questions Mochi can handle.

**When to hand back to Mochi:**
- Original issue resolved
- Customer has new, simple question
- FAQ-type follow-up

**How to hand back (Chat):**
```
Great, I'm glad we got that sorted!

If you have any other questions, Mochi in the app can help with most things instantly. But if you need a human again, just ask and we'll be here.

Take care! 🐱
```

---

## Email Thread Continuity

When handling email tickets with prior history, context preservation is equally important.

### Reading Email History

Before responding to any email:

1. **Read the full thread** - Scroll to the bottom/oldest message
2. **Note previous agent responses** - What was promised? What was tried?
3. **Check for unresolved points** - Did prior response miss anything?
4. **Look for sentiment shift** - Is customer getting more frustrated?

### Continuing an Email Thread

**If picking up from another agent:**
```
Subject: Re: [Original Subject]

Hi [Name],

I'm [Agent], picking up from my colleague [Previous Agent] on your case.

I've reviewed our conversation and see that [summary of where things stand].

[Continue with resolution / next steps]

Best,
[Agent Name]
Meow Mobile Support
```

**If customer replied to your own email:**
```
Subject: Re: [Original Subject]

Hi [Name],

Thanks for getting back to me!

[Address their reply directly]

[Provide resolution / next steps]

Best,
[Agent Name]
Meow Mobile Support
```

**If customer emails again about a "resolved" issue:**
```
Subject: Re: [Original Subject] - Reopening your case

Hi [Name],

I'm sorry to hear this issue came back. Let me take another look.

[Don't make them re-explain - reference what you know]

I see from your previous emails that [summary]. It sounds like [current problem].

[New troubleshooting / escalation]

Best,
[Agent Name]
Meow Mobile Support
```

### Cross-Channel Context

Sometimes customers contact us through multiple channels. Always check for related tickets:

```
Query Zendesk:
Search for other tickets from same email address
Check for Mochi conversations
Look for social media interactions
```

**If you find related context:**
```
Hi [Name],

I see you also [chatted with Mochi / emailed earlier / messaged us on Instagram] about this. Let me pull all of that together so we can get this fully resolved.

[Unified response addressing the full picture]
```

## Common Mochi Escalation Issues

### Issue: Mochi Couldn't Find Account

**What happened:** Customer provided email but Mochi couldn't match it.

**Agent action:**
1. Search with variations (typos, alternate emails)
2. Search by phone number
3. Search by name + other identifiers
4. If new customer, they may not have an account yet

### Issue: Mochi Gave Wrong Information

**What happened:** Mochi's response was incorrect or outdated.

**Agent action:**
1. Apologize for the confusion
2. Provide correct information
3. Report the issue for Mochi training improvement
4. Don't blame Mochi directly to customer

```
Agent response:
I see Mochi mentioned [incorrect info] - let me clarify that. Actually, [correct info].

Sorry for any confusion! Let me make sure you have the right information...
```

### Issue: Mochi Repeated Itself

**What happened:** Customer asked same thing multiple ways, Mochi kept giving same answer.

**Agent action:**
1. Understand WHY the standard answer didn't work
2. Address the underlying concern
3. Provide more nuanced/specific help

```
Agent response:
I see Mochi kept giving you the same answer, which clearly wasn't what you needed. Let me understand your specific situation better...

[Ask targeted clarifying question OR take direct action]
```

---

## Mochi Training Feedback

If you notice Mochi consistently failing on certain issues, report for improvement:

```
## Mochi Feedback Report

**Issue pattern:** [What Mochi is getting wrong]
**Frequency:** [How often you see this]
**Customer impact:** [Frustration level, extra handling time]

**Example tickets:** [2-3 ticket IDs]

**Suggested improvement:**
[What Mochi should do differently]
```

Submit to: #mochi-feedback Slack channel or mochi-feedback@meowmobile.com

## Metrics to Track

For Mochi escalations, note:

| Metric | Why It Matters |
|--------|----------------|
| Time in Mochi before escalation | Long time = customer frustration |
| Escalation reason | Patterns reveal Mochi gaps |
| Resolution after escalation | Did human actually help? |
| Customer effort | How much did customer repeat? |

## Parameters

- `customer_email`: Required - Customer's email
- `conversation_id`: Optional - Specific Mochi conversation
- `include_full_transcript`: Default false - Include all messages
- `escalation_reason`: Optional - Why Mochi escalated

## Example Usage

```
Agent: "Customer transferred from Mochi, what were they asking about?"

LLM:
1. Queries Mochi conversation history for customer
2. Summarizes: Customer asked about eSIM not working
3. Notes: Mochi tried basic troubleshooting, suggested restart
4. Shows: Customer got frustrated after 3rd "try restarting"
5. Recommends: Skip basic steps, go straight to diagnostic
```

```
Agent: "How do I respond to this Mochi escalation?"

LLM:
1. Reads escalation reason: sentiment (frustrated)
2. Reads conversation: Customer stuck for 2 days, Mochi unhelpful
3. Drafts empathetic opening acknowledging frustration
4. Summarizes issue so customer doesn't repeat
5. Recommends immediate action vs. more questions
```
