/**
 * Reactive Communication Engine — Server Routes
 *
 * Handles:
 * 1. Webhook: New ticket created → consolidation check
 * 2. Webhook: Ticket updated (reply to merged ticket) → redirect
 * 3. Outbound gate: Pre-send verification
 * 4. Manual: Force merge / force send
 *
 * Triggered by Zendesk webhooks or called by the Zendesk sidebar app.
 */

const express = require('express');
const router = express.Router();
const zendesk = require('../lib/zendesk-client');
const commsLog = require('../lib/comms-log');

// In-memory store for pending merges (grace period)
const pendingMerges = new Map();

// In-memory store for agent locks
const agentLocks = new Map();

// Issue category keywords for classification
const ISSUE_CATEGORIES = {
  esim: ['esim', 'e-sim', 'activation', 'qr code', 'sim', 'provisioning'],
  payment: ['payment', 'charge', 'refund', 'billing', 'card', 'declined', 'invoice', 'double charge'],
  portin: ['port', 'transfer number', 'keep my number', 'porting', 'number transfer'],
  network: ['signal', 'network', 'data', 'coverage', 'no service', 'outage', 'slow'],
  account: ['login', 'password', 'account', 'email change', 'cancel', 'suspend'],
  billing: ['bill', 'subscription', 'plan', 'upgrade', 'downgrade', 'renewal'],
  airvet: ['airvet', 'vet', 'pet', 'veterinary'],
  general: []
};

// Gratitude keywords for auto-ack detection
const GRATITUDE_KEYWORDS = [
  'thanks', 'thank you', 'got it', 'perfect', 'great',
  'awesome', 'appreciate', 'that works', 'all good', 'wonderful'
];

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

/**
 * Classify issue category from ticket subject + description
 */
function classifyIssue(text) {
  const lower = (text || '').toLowerCase();
  for (const [category, keywords] of Object.entries(ISSUE_CATEGORIES)) {
    if (category === 'general') continue;
    for (const kw of keywords) {
      if (lower.includes(kw)) return category;
    }
  }
  return 'general';
}

/**
 * Check if text is a short gratitude/acknowledgement
 */
function isGratitudeReply(text) {
  if (!text || text.length > 50) return false;
  const lower = text.toLowerCase().trim();
  return GRATITUDE_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Build merge summary internal note
 */
function buildMergeSummary(targetTicket, sourceTickets, issueThreads) {
  const timestamp = new Date().toISOString();
  const rows = sourceTickets.map((t, i) => {
    const issue = issueThreads[t.id] || 'general';
    return `| ${i + 1} | ${t.subject || 'N/A'} | #${t.id} | ${t.via?.channel || 'unknown'} | ${t.priority || 'normal'} | ${issue} |`;
  }).join('\n');

  return `## Ticket Consolidation Summary

**Consolidated at:** ${timestamp}
**Target ticket:** #${targetTicket.id}
**Source tickets merged:** ${sourceTickets.length}
**Total issues identified:** ${Object.keys(issueThreads).length}

### Issues Overview

| # | Subject | Source Ticket | Channel | Priority | Issue |
|---|---------|--------------|---------|----------|-------|
${rows}

### Action Required
Agent must address ALL issues in a single consolidated response.
Use the consolidated response template from reactive-communication skill (Section E, Template 1).`;
}

/**
 * Build agent checklist internal note
 */
function buildAgentChecklist(issueCount) {
  return `## Agent Pre-Response Checklist

Before responding to this customer, complete the following:

- [ ] Read ALL merged conversation histories (see internal notes below)
- [ ] Identify root cause for EACH issue (${issueCount} issues found)
- [ ] Check if any issue has a proactive outreach already sent (look for proactive_alert tag)
- [ ] Determine resolution or next step for EACH issue
- [ ] Draft ONE consolidated response covering ALL issues
- [ ] Select response channel (email for multi-issue)
- [ ] Verify response passes outbound gate

### Priority Ordering for Response
1. Service-impacting (no connectivity, can't make calls)
2. Financial (double charges, billing errors)
3. Pending actions (port-in, eSIM activation)
4. Informational (how-to, status updates)`;
}

// ─────────────────────────────────────────────
// ROUTE 1: Webhook — New Ticket Created
// POST /api/reactive/ticket-created
// ─────────────────────────────────────────────

router.post('/ticket-created', async (req, res) => {
  try {
    const { ticket_id, requester_email } = req.body;

    if (!ticket_id || !requester_email) {
      return res.status(400).json({ error: 'ticket_id and requester_email are required' });
    }

    console.log(`[REACTIVE] New ticket #${ticket_id} from ${requester_email}`);

    // Step 1: Search for other open tickets from same requester
    const openTickets = await zendesk.searchTicketsByRequester(requester_email);

    // Filter out the current ticket
    const otherTickets = openTickets.filter(t => String(t.id) !== String(ticket_id));

    if (otherTickets.length === 0) {
      // Single ticket — no consolidation needed
      console.log(`[REACTIVE] Single ticket for ${requester_email}. No consolidation.`);
      return res.json({
        action: 'none',
        message: 'Single ticket, no consolidation needed',
        ticket_id
      });
    }

    // Step 2: Multiple tickets detected — schedule merge with 2-min grace period
    console.log(`[REACTIVE] ${otherTickets.length} other open ticket(s) found for ${requester_email}. Scheduling merge.`);

    // Add internal note to the new ticket
    await zendesk.addInternalNote(ticket_id,
      `Multiple open tickets detected for this customer (${otherTickets.length + 1} total). Consolidation scheduled in 2 minutes.`
    );

    // Tag the ticket as merge pending
    const currentTicket = await zendesk.getTicket(ticket_id);
    const currentTags = zendesk.getTicketTags(currentTicket);
    await zendesk.updateTicket(ticket_id, {
      tags: [...new Set([...currentTags, 'merge_pending'])]
    });

    // Schedule merge after 2-minute grace period
    const mergeKey = requester_email;
    if (pendingMerges.has(mergeKey)) {
      clearTimeout(pendingMerges.get(mergeKey).timer);
    }

    const timer = setTimeout(async () => {
      try {
        await executeMerge(requester_email);
      } catch (err) {
        console.error(`[REACTIVE] Merge failed for ${requester_email}:`, err.message);
      }
      pendingMerges.delete(mergeKey);
    }, 2 * 60 * 1000); // 2 minutes

    pendingMerges.set(mergeKey, { timer, scheduledAt: new Date().toISOString() });

    res.json({
      action: 'merge_scheduled',
      message: `Merge scheduled in 2 minutes for ${requester_email}`,
      ticket_count: otherTickets.length + 1,
      ticket_ids: [ticket_id, ...otherTickets.map(t => t.id)]
    });

  } catch (error) {
    console.error('[REACTIVE] ticket-created error:', error);
    res.status(500).json({ error: 'Failed to process new ticket', details: error.message });
  }
});

// ─────────────────────────────────────────────
// ROUTE 2: Force Merge (skip grace period)
// POST /api/reactive/merge
// ─────────────────────────────────────────────

router.post('/merge', async (req, res) => {
  try {
    const { requester_email } = req.body;

    if (!requester_email) {
      return res.status(400).json({ error: 'requester_email is required' });
    }

    // Cancel any pending merge timer
    if (pendingMerges.has(requester_email)) {
      clearTimeout(pendingMerges.get(requester_email).timer);
      pendingMerges.delete(requester_email);
    }

    const result = await executeMerge(requester_email);
    res.json(result);

  } catch (error) {
    console.error('[REACTIVE] merge error:', error);
    res.status(500).json({ error: 'Merge failed', details: error.message });
  }
});

/**
 * Execute the ticket merge for a customer.
 * Merges ALL open tickets into the newest one regardless of issue type.
 * Each issue is classified and tagged so the agent's response addresses every issue separately.
 */
async function executeMerge(requesterEmail) {
  console.log(`[REACTIVE] Executing merge for ${requesterEmail}`);

  // Re-query open tickets (state may have changed during grace period)
  const allTickets = await zendesk.searchTicketsByRequester(requesterEmail);

  if (allTickets.length <= 1) {
    console.log(`[REACTIVE] Only ${allTickets.length} ticket(s) found. No merge needed.`);
    return { action: 'none', message: 'Not enough tickets to merge' };
  }

  // Target = newest ticket (first in list, sorted desc by created_at)
  const targetTicket = allTickets[0];
  const sourceTickets = allTickets.slice(1);

  console.log(`[REACTIVE] Merging ${sourceTickets.length} ticket(s) into #${targetTicket.id}`);

  // Classify issues for all tickets
  const issueThreads = {};
  let threadNum = 1;
  for (const ticket of allTickets) {
    const category = classifyIssue(`${ticket.subject} ${ticket.description}`);
    issueThreads[ticket.id] = category;
    threadNum++;
  }

  // Identify unique issues for the agent checklist
  const uniqueIssues = [...new Set(Object.values(issueThreads))];

  // Copy comments from each source ticket as internal notes on target
  for (const source of sourceTickets) {
    const comments = await zendesk.getTicketComments(source.id);
    const category = issueThreads[source.id] || 'general';

    const commentHistory = comments.map(c => {
      const author = c.author_id === source.requester_id ? 'Customer' : 'Agent';
      const time = new Date(c.created_at).toLocaleString();
      return `[${time}] ${author}: ${c.body}`;
    }).join('\n\n');

    await zendesk.addInternalNote(targetTicket.id,
      `---\n**[MERGED] From Ticket #${source.id} (${source.via?.channel || 'unknown'})**\n**Subject:** ${source.subject}\n**Created:** ${source.created_at}\n**Issue:** ${category}\n\n**Conversation History:**\n${commentHistory}\n---`
    );
  }

  // Build issue thread tags
  const issueThreadTags = [];
  let idx = 1;
  for (const [ticketId, category] of Object.entries(issueThreads)) {
    issueThreadTags.push(`issue_thread_${idx}_${category}`);
    idx++;
  }

  // Merge metadata on target
  const allTags = zendesk.mergeTags(
    ...allTickets.map(t => zendesk.getTicketTags(t))
  );
  const highestPriority = zendesk.getHighestPriority(allTickets);
  const assignee = zendesk.getMostRecentAgent(allTickets);

  // Remove transient tags, add consolidation tags
  const finalTags = allTags
    .filter(t => t !== 'merge_pending' && t !== 'suppress_auto_ack')
    .concat(['consolidated_ticket', `merged_count_${sourceTickets.length}`])
    .concat(issueThreadTags);

  await zendesk.updateTicket(targetTicket.id, {
    tags: [...new Set(finalTags)],
    priority: highestPriority,
    assignee_id: assignee
  });

  // Add merge summary and agent checklist to target
  await zendesk.addInternalNote(targetTicket.id, buildMergeSummary(targetTicket, sourceTickets, issueThreads));
  await zendesk.addInternalNote(targetTicket.id, buildAgentChecklist(uniqueIssues.length));

  // If multiple different issues exist, add explicit guidance
  if (uniqueIssues.length > 1) {
    const issueList = uniqueIssues.map((issue, i) => `${i + 1}. **${issue}**`).join('\n');
    await zendesk.addInternalNote(targetTicket.id,
      `## IMPORTANT: Multiple Different Issues Detected

This customer has ${uniqueIssues.length} distinct issues across their tickets:
${issueList}

Your response MUST address each issue in its own section. Use the consolidated response template:

> **Regarding your [issue 1]:**
> [diagnosis + resolution]
>
> **Regarding your [issue 2]:**
> [diagnosis + resolution]

The outbound gate will verify that all issues are addressed before allowing send.`
    );
  }

  // Close source tickets
  for (const source of sourceTickets) {
    const sourceTags = zendesk.getTicketTags(source);
    await zendesk.updateTicket(source.id, {
      status: 'solved',
      tags: [...new Set([...sourceTags, 'merged_source', `merged_into_${targetTicket.id}`])],
      comment: {
        body: `This ticket has been merged into #${targetTicket.id} as part of customer ticket consolidation. All conversation history has been copied to the target ticket.`,
        public: false
      }
    });
  }

  console.log(`[REACTIVE] Merge complete. Target: #${targetTicket.id}, Sources: ${sourceTickets.map(t => t.id).join(', ')}, Issues: ${uniqueIssues.join(', ')}`);

  return {
    action: 'merged',
    target_ticket: targetTicket.id,
    source_tickets: sourceTickets.map(t => t.id),
    issues: issueThreads,
    unique_issues: uniqueIssues,
    priority: highestPriority,
    assignee: assignee
  };
}

// ─────────────────────────────────────────────
// ROUTE 3: Webhook — Reply to Merged Ticket
// POST /api/reactive/ticket-updated
// ─────────────────────────────────────────────

router.post('/ticket-updated', async (req, res) => {
  try {
    const { ticket_id } = req.body;

    if (!ticket_id) {
      return res.status(400).json({ error: 'ticket_id is required' });
    }

    const ticket = await zendesk.getTicket(ticket_id);
    const tags = zendesk.getTicketTags(ticket);

    // Edge Case 1: Reply to a merged (solved) source ticket
    if (tags.includes('merged_source')) {
      const mergedIntoTag = tags.find(t => t.startsWith('merged_into_'));
      if (mergedIntoTag) {
        const targetId = mergedIntoTag.replace('merged_into_', '');

        // Get the latest comment (the customer's reply)
        const comments = await zendesk.getTicketComments(ticket_id);
        const latestComment = comments[comments.length - 1];

        // Copy reply to active target ticket
        await zendesk.addInternalNote(targetId,
          `:warning: **Customer replied to merged ticket #${ticket_id}.**\nTheir message: "${latestComment?.body || '(empty)'}"\nThis has been redirected here from the closed source ticket.`
        );

        // Keep source ticket solved
        await zendesk.addInternalNote(ticket_id,
          `Customer reply redirected to active ticket #${targetId}.`
        );

        return res.json({
          action: 'redirected',
          source_ticket: ticket_id,
          target_ticket: targetId,
          message: 'Reply redirected to active consolidated ticket'
        });
      }
    }

    // Edge Case 7: Customer replies with gratitude/acknowledgement
    if (tags.includes('consolidated_ticket') || !tags.includes('merged_source')) {
      const comments = await zendesk.getTicketComments(ticket_id);
      const latestComment = comments[comments.length - 1];

      if (latestComment && latestComment.author_id === ticket.requester_id) {
        if (isGratitudeReply(latestComment.body)) {
          await zendesk.updateTicket(ticket_id, { status: 'pending' });
          await zendesk.addInternalNote(ticket_id,
            `Customer acknowledged with: "${latestComment.body}". Auto-set to pending. Will auto-solve in 24h if no further replies.`
          );

          return res.json({
            action: 'auto_pending',
            ticket_id,
            message: 'Gratitude reply detected. Ticket set to pending.'
          });
        }
      }
    }

    // Edge Case 2: New reply while agent is drafting on a consolidated ticket
    if (tags.includes('consolidated_ticket')) {
      const lockKey = String(ticket_id);
      if (agentLocks.has(lockKey)) {
        await zendesk.addInternalNote(ticket_id,
          `:warning: **NEW CUSTOMER REPLY arrived while you were working on this ticket!** Please review the latest comment before sending your response.`
        );

        return res.json({
          action: 'agent_notified',
          ticket_id,
          message: 'Agent working on ticket notified of new reply'
        });
      }
    }

    res.json({ action: 'none', ticket_id });

  } catch (error) {
    console.error('[REACTIVE] ticket-updated error:', error);
    res.status(500).json({ error: 'Failed to process ticket update', details: error.message });
  }
});

// ─────────────────────────────────────────────
// ROUTE 4: Outbound Communication Gate
// POST /api/reactive/outbound-gate
// ─────────────────────────────────────────────

router.post('/outbound-gate', async (req, res) => {
  try {
    const { ticket_id, requester_email, agent_response, override } = req.body;

    if (!ticket_id || !requester_email) {
      return res.status(400).json({ error: 'ticket_id and requester_email are required' });
    }

    const warnings = [];
    let allow = true;

    // Check 1: 15-minute per-customer window
    const recentComms = commsLog.getRecentComms(requester_email, 15);
    if (recentComms.length > 0 && !override) {
      const lastSent = recentComms[recentComms.length - 1];
      const minutesAgo = Math.round((Date.now() - new Date(lastSent.dispatched_at).getTime()) / 60000);
      warnings.push({
        type: '15min_window',
        message: `A response was sent to this customer ${minutesAgo} min ago. Wait ${15 - minutesAgo} more minutes or override.`,
        last_sent: lastSent.dispatched_at
      });
      allow = false;
    }

    // Check 2: Consolidated response verification
    const ticket = await zendesk.getTicket(ticket_id);
    const tags = zendesk.getTicketTags(ticket);

    if (tags.includes('consolidated_ticket') && agent_response) {
      const issueThreadTags = tags.filter(t => t.startsWith('issue_thread_'));
      const missedIssues = [];

      for (const tag of issueThreadTags) {
        const category = tag.split('_').slice(3).join('_'); // e.g. "esim" from "issue_thread_1_esim"
        const keywords = ISSUE_CATEGORIES[category] || [];
        const responseLower = agent_response.toLowerCase();
        const addressed = keywords.some(kw => responseLower.includes(kw));

        if (!addressed && category !== 'general') {
          missedIssues.push({ tag, category });
        }
      }

      if (missedIssues.length > 0) {
        warnings.push({
          type: 'missed_issues',
          message: `Your response may not address all customer issues.`,
          missed: missedIssues.map(i => i.category),
          issue_count: issueThreadTags.length,
          addressed_count: issueThreadTags.length - missedIssues.length
        });
      }
    }

    // Check 3: Proactive message collision
    const recentProactive = commsLog.getRecentProactiveComms(requester_email, 30);
    if (recentProactive.length > 0) {
      warnings.push({
        type: 'proactive_collision',
        message: `A proactive outreach was sent to this customer ${Math.round((Date.now() - new Date(recentProactive[0].dispatched_at).getTime()) / 60000)} min ago. Reference it in your response.`,
        proactive_details: recentProactive[0]
      });
      // Don't block — just warn
    }

    // Check 4: Channel saturation (24h count)
    const count24h = commsLog.get24hCount(requester_email);
    if (count24h >= 5 && !override) {
      warnings.push({
        type: 'saturation',
        message: `Customer has received ${count24h} messages in the last 24h (combined proactive+reactive cap is 5). Override required to send.`,
        count: count24h
      });
      allow = false;
    }

    // If allowed (or override), log the communication
    if (allow || override) {
      commsLog.logComms({
        recipient: requester_email,
        channel: 'email',
        source: 'agent_response',
        ticketId: ticket_id
      });
    }

    res.json({
      allow: allow || !!override,
      warnings,
      ticket_id,
      override_used: !!override
    });

  } catch (error) {
    console.error('[REACTIVE] outbound-gate error:', error);
    res.status(500).json({ error: 'Outbound gate check failed', details: error.message });
  }
});

// ─────────────────────────────────────────────
// ROUTE 5: Agent Lock Management
// POST /api/reactive/lock
// ─────────────────────────────────────────────

router.post('/lock', async (req, res) => {
  try {
    const { ticket_id, agent_id } = req.body;

    if (!ticket_id || !agent_id) {
      return res.status(400).json({ error: 'ticket_id and agent_id are required' });
    }

    const lockKey = String(ticket_id);
    const now = Date.now();

    if (agentLocks.has(lockKey)) {
      const existing = agentLocks.get(lockKey);
      const lockAge = (now - existing.locked_at) / 60000; // minutes

      if (lockAge < 30 && existing.agent_id !== agent_id) {
        return res.json({
          locked: false,
          message: `Ticket is being worked by agent ${existing.agent_id} (${Math.round(lockAge)} min ago). Coordinate before responding.`,
          locked_by: existing.agent_id,
          lock_age_minutes: Math.round(lockAge)
        });
      }
      // Stale lock or same agent — reassign
    }

    agentLocks.set(lockKey, { agent_id, locked_at: now });

    await zendesk.addInternalNote(ticket_id,
      `Ticket locked by agent ${agent_id} at ${new Date().toISOString()}.`
    );

    res.json({ locked: true, agent_id, ticket_id });

  } catch (error) {
    console.error('[REACTIVE] lock error:', error);
    res.status(500).json({ error: 'Lock failed', details: error.message });
  }
});

// ─────────────────────────────────────────────
// ROUTE 6: VIP Check
// POST /api/reactive/vip-check
// ─────────────────────────────────────────────

router.post('/vip-check', async (req, res) => {
  try {
    const { ticket_id } = req.body;

    if (!ticket_id) {
      return res.status(400).json({ error: 'ticket_id is required' });
    }

    const ticket = await zendesk.getTicket(ticket_id);
    const tags = zendesk.getTicketTags(ticket);
    const isVip = tags.some(t => ['vip', 'high_value', 'influencer'].includes(t));

    if (isVip) {
      // Ensure priority is at least HIGH
      if (!ticket.priority || ticket.priority === 'low' || ticket.priority === 'normal') {
        await zendesk.updateTicket(ticket_id, { priority: 'high' });
      }

      // Add VIP tags and guidance
      if (!tags.includes('vip_handling')) {
        await zendesk.updateTicket(ticket_id, {
          tags: [...new Set([...tags, 'vip_handling'])]
        });

        await zendesk.addInternalNote(ticket_id,
          `## VIP Customer Alert

This is a VIP customer. Apply enhanced handling:

- **Priority:** Automatically set to HIGH (minimum)
- **SLA:** Respond within 2 hours
- **Tone:** Executive-level empathy, acknowledge their loyalty
- **Authority:** You have retention authority — offer service credits up to $50 without L2 approval
- **Follow-up:** Schedule a personal follow-up within 24 hours after resolution
- **Escalation:** If unresolved within 4 hours, auto-escalate to L2 with VIP flag`
        );
      }

      return res.json({ is_vip: true, ticket_id, priority: 'high' });
    }

    res.json({ is_vip: false, ticket_id });

  } catch (error) {
    console.error('[REACTIVE] vip-check error:', error);
    res.status(500).json({ error: 'VIP check failed', details: error.message });
  }
});

// ─────────────────────────────────────────────
// ROUTE 7: Duplicate Detection
// POST /api/reactive/check-duplicate
// ─────────────────────────────────────────────

router.post('/check-duplicate', async (req, res) => {
  try {
    const { ticket_id, requester_email, subject } = req.body;

    if (!ticket_id || !requester_email) {
      return res.status(400).json({ error: 'ticket_id and requester_email required' });
    }

    const openTickets = await zendesk.searchTicketsByRequester(requester_email);
    const otherTickets = openTickets.filter(t => String(t.id) !== String(ticket_id));

    // Check for exact duplicate (same subject within 10 minutes)
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
    const duplicate = otherTickets.find(t => {
      const sameSubject = t.subject && subject &&
        t.subject.toLowerCase().trim() === subject.toLowerCase().trim();
      const recent = new Date(t.created_at) > tenMinAgo;
      return sameSubject && recent;
    });

    if (duplicate) {
      // Silently close the duplicate
      await zendesk.updateTicket(ticket_id, {
        status: 'solved',
        tags: ['silent_duplicate_close'],
        comment: {
          body: `Duplicate of #${duplicate.id} — same subject within 10 minutes. Silently closed.`,
          public: false
        }
      });

      return res.json({
        is_duplicate: true,
        closed_ticket: ticket_id,
        original_ticket: duplicate.id
      });
    }

    res.json({ is_duplicate: false, ticket_id });

  } catch (error) {
    console.error('[REACTIVE] check-duplicate error:', error);
    res.status(500).json({ error: 'Duplicate check failed', details: error.message });
  }
});

// ─────────────────────────────────────────────
// ROUTE 8: Status / Health
// GET /api/reactive/status
// ─────────────────────────────────────────────

router.get('/status', (req, res) => {
  res.json({
    status: 'ok',
    pending_merges: pendingMerges.size,
    active_locks: agentLocks.size,
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
