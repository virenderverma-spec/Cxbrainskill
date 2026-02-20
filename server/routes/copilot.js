/**
 * Copilot Route — Zero-click contextual data for the Zendesk sidebar
 *
 * POST /api/copilot/context   — Fetch all customer context (no Claude)
 * POST /api/copilot/generate  — Generate humanized draft response (Claude)
 * GET  /api/copilot/kb-search — Search KB articles
 */

const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');

const { runSQL } = require('../lib/databricks');
const boss = require('../lib/boss-api');
const zendesk = require('../lib/zendesk-client');
const { searchKB } = require('../lib/kb-search');
const { humanizeText } = require('../lib/humanize');
const { detectRelevantSkills, loadSelectedSkills } = require('../lib/skill-loader');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Issue classification (shared with reactive.js) ──

const ISSUE_CATEGORIES = {
  esim: ['esim', 'e-sim', 'activation', 'qr code', 'sim', 'provisioning'],
  payment: ['payment', 'charge', 'refund', 'billing', 'card', 'declined', 'invoice', 'double charge'],
  portin: ['port', 'transfer number', 'keep my number', 'porting', 'number transfer'],
  network: ['signal', 'network', 'data', 'coverage', 'no service', 'outage', 'slow'],
  account: ['login', 'password', 'account', 'email change', 'cancel', 'suspend'],
  billing: ['bill', 'subscription', 'plan', 'upgrade', 'downgrade', 'renewal'],
  airvet: ['airvet', 'vet', 'pet', 'veterinary'],
  general: [],
};

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

// ── Port-in conflict codes (shared with health.js) ──

const CONFLICT_CODES = {
  '6B': { reason: 'Transfer PIN required or incorrect', action: 'Ask customer for the correct transfer PIN from their previous carrier.' },
  '6P': { reason: 'Port protection / account locked at original carrier', action: 'Customer must remove the port lock at their original carrier.' },
  '8A': { reason: 'Account number required or incorrect', action: 'Verify the account number with the customer.' },
  '8D': { reason: 'Zip code required or incorrect', action: 'Verify the billing zip code on the previous carrier account.' },
  '7C': { reason: 'Name mismatch on account', action: 'Verify the authorized name on the previous carrier account.' },
  '7T': { reason: 'Telephone number not eligible for porting', action: 'Confirm the number is active and eligible for transfer.' },
  '9E': { reason: 'Zip code mismatch', action: 'Verify the billing zip code on the previous carrier account.' },
};

function parseConflictInfo(raw) {
  if (!raw) return null;
  let parsed = null;
  try { parsed = typeof raw === 'string' && raw.startsWith('{') ? JSON.parse(raw) : null; } catch (e) { /* */ }
  const code = parsed?.statusReasonCode || parsed?.code || parsed?.conflictCode || null;
  const desc = parsed?.statusReasonDescription || parsed?.description || null;
  const msg = parsed?.message || null;
  const lookup = code && CONFLICT_CODES[code] ? CONFLICT_CODES[code] : null;
  return {
    code: code || null,
    reason: lookup ? lookup.reason : (desc || msg || 'Unknown conflict'),
    action: lookup ? lookup.action : 'Investigate the port-in status in ConnectX.',
  };
}

// ── Signal detection (proactive-communication skill framework) ──

function detectProactiveSignals(ctx) {
  const signals = [];
  const { customer360, bossData } = ctx;

  // SIG-002: eSIM provisioning FAILED
  const esimStatus = bossData.esim?.data?.status || customer360?.latest_order_esim_status;
  if (esimStatus && /error|failed/i.test(esimStatus)) {
    signals.push({
      id: 'SIG-002', severity: 'CRITICAL', label: 'eSIM provisioning FAILED',
      detail: `eSIM status: ${esimStatus}`,
    });
  }

  // SIG-001: eSIM stuck PENDING > 48h
  if (esimStatus && /pending/i.test(esimStatus)) {
    const paymentAt = customer360?.onboarding_payment_completed_at;
    if (paymentAt && (Date.now() - new Date(paymentAt).getTime()) > 48 * 3600000) {
      signals.push({
        id: 'SIG-001', severity: 'HIGH', label: 'eSIM stuck in PENDING > 48h',
        detail: `Payment completed at ${paymentAt}, eSIM still PENDING`,
      });
    }
  }

  // SIG-004: Port-in rejected / FAILED
  const portStatus = bossData.port?.data?.status || customer360?.latest_order_portin_status;
  if (portStatus && /failed|rejected/i.test(portStatus)) {
    signals.push({
      id: 'SIG-004', severity: 'HIGH', label: 'Port-in REJECTED',
      detail: `Port-in status: ${portStatus}`,
    });
  }

  // SIG-005: Port-in CONFLICT
  if (portStatus && /conflict/i.test(portStatus)) {
    const ci = parseConflictInfo(
      bossData.port?.data?.conflictInfo || customer360?.portin_conflict_info
    );
    signals.push({
      id: 'SIG-005', severity: 'HIGH',
      label: `Port-in CONFLICT${ci?.code ? ` ${ci.code}` : ''}`,
      detail: ci?.reason || 'Port-in has conflicts',
      action: ci?.action,
    });
  }

  // SIG-003: Payment failed
  const payments = bossData.payments?.data;
  if (Array.isArray(payments) && payments.some(p => /failed|declined/i.test(p.status || ''))) {
    signals.push({
      id: 'SIG-003', severity: 'MEDIUM', label: 'Payment FAILED',
      detail: 'One or more payment attempts failed or were declined',
    });
  }

  // SIG-008: Repeat contact (3+ touches)
  if ((ctx.touchCount || 0) >= 3) {
    signals.push({
      id: 'SIG-008', severity: 'HIGH', label: `Repeat contact (${ctx.touchCount} touches)`,
      detail: 'Customer has contacted support 3+ times',
    });
  }

  // SIG-006: Order stuck > 24h
  if (customer360?.latest_order_status && !/completed|cancelled/i.test(customer360.latest_order_status)) {
    const orderCreated = customer360?.latest_order_created_at;
    if (orderCreated && (Date.now() - new Date(orderCreated).getTime()) > 24 * 3600000) {
      signals.push({
        id: 'SIG-006', severity: 'MEDIUM', label: 'Order stuck > 24h',
        detail: `Order status: ${customer360.latest_order_status}, created ${orderCreated}`,
      });
    }
  }

  // Sort by severity: CRITICAL > HIGH > MEDIUM > LOW
  const severityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  signals.sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9));

  return signals.slice(0, 5); // max 5 signals
}

// ── Action suggestions ──

function suggestActions(ctx) {
  const actions = [];
  const { customer360, bossData, signals } = ctx;

  for (const sig of signals) {
    switch (sig.id) {
      case 'SIG-002': // eSIM FAILED
      case 'SIG-001': // eSIM stuck PENDING
        if (customer360?.individual_id) {
          actions.push({
            id: 'resend_esim',
            label: 'Re-issue eSIM (SIM Swap)',
            severity: sig.severity,
            params: { individualId: customer360.individual_id },
            confirm: true,
          });
        }
        break;

      case 'SIG-004': // Port-in REJECTED
      case 'SIG-005': // Port-in CONFLICT
        // Suggest retry if we have a decision ID
        const execution = bossData.execution?.data;
        const decisionId = execution?.decisions?.find(d => /port/i.test(d.type || ''))?.id;
        if (decisionId) {
          actions.push({
            id: 'retry_port_in',
            label: 'Retry Port-In',
            severity: sig.severity,
            params: { decisionId },
            confirm: true,
          });
        }
        actions.push({
          id: 'contact_customer',
          label: 'Contact Customer for Port Info',
          severity: sig.severity,
          params: {},
          confirm: false,
        });
        break;

      case 'SIG-003': // Payment FAILED
        actions.push({
          id: 'contact_customer',
          label: 'Request Updated Payment Method',
          severity: sig.severity,
          params: {},
          confirm: false,
        });
        break;
    }
  }

  return actions;
}

// ── Tone calibration ──

function getToneGuide(touchCount) {
  if (touchCount <= 1) return { tone: 'helpful', instruction: 'Friendly and efficient. First contact - be clear and thorough.' };
  if (touchCount === 2) return { tone: 'empathetic', instruction: 'Acknowledge they had to reach out again. Show you understand the hassle.' };
  if (touchCount === 3) return { tone: 'apologetic', instruction: 'Directly apologize for the repeated contacts. Take ownership. Be specific about what you are doing differently this time.' };
  return { tone: 'executive_empathy', instruction: 'This customer has contacted us 4+ times. Use executive empathy. Acknowledge the failure explicitly. Offer concrete resolution with timeline. Offer service credit or escalation path.' };
}

// ═══════════════════════════════════════════════
// ENDPOINT 1: POST /api/copilot/context
// Fetch all customer context — pure data, no Claude
// ═══════════════════════════════════════════════

router.post('/context', async (req, res) => {
  try {
    const { email, ticketId } = req.body;
    if (!email) return res.status(400).json({ error: 'email is required' });

    console.log(`[COPILOT] Context fetch for ${email}, ticket #${ticketId || 'N/A'}`);

    // ── Parallel data fetch ──
    const [
      customer360Result,
      bossSearchResult,
      ticketHistoryResult,
      currentCommentsResult,
    ] = await Promise.allSettled([
      // Databricks: customer_360 by email
      runSQL(`
        SELECT * FROM prod_catalog.silver.customer_360
        WHERE LOWER(stripe_email) = LOWER('${email.replace(/'/g, "''")}')
        LIMIT 1
      `),
      // BOSS API: search customer by email
      boss.searchCustomer(email),
      // Zendesk: ticket history for requester
      zendesk.searchTicketsByRequester(email, []),
      // Zendesk: current ticket comments
      ticketId ? zendesk.getTicketComments(ticketId) : Promise.resolve([]),
    ]);

    const customer360 = customer360Result.status === 'fulfilled' && customer360Result.value.length > 0
      ? customer360Result.value[0] : null;
    const bossSearch = bossSearchResult.status === 'fulfilled' ? bossSearchResult.value : null;

    // All tickets (including solved) for touch count
    const allTickets = ticketHistoryResult.status === 'fulfilled' ? ticketHistoryResult.value : [];
    const currentComments = currentCommentsResult.status === 'fulfilled' ? currentCommentsResult.value : [];

    // ── BOSS API deep fetch (parallel, using customer data) ──
    const orderId = customer360?.latest_order_id;
    const individualId = customer360?.individual_id;
    const customerId = customer360?.customer_id;
    const iccid = customer360?.latest_esim_iccid;
    const msisdn = customer360?.phone_number;

    const bossResults = await Promise.allSettled([
      orderId ? boss.getOrderById(orderId) : Promise.resolve(null),
      orderId ? boss.getOrderExecution(orderId) : Promise.resolve(null),
      orderId ? boss.getOrderRca(orderId) : Promise.resolve(null),
      msisdn ? boss.getPortStatus(msisdn) : Promise.resolve(null),
      iccid ? boss.getEsimProfile(iccid) : Promise.resolve(null),
      customerId ? boss.getPayments(customerId) : Promise.resolve(null),
    ]);

    const bossData = {
      search: bossSearch?.data || null,
      order: bossResults[0].status === 'fulfilled' ? bossResults[0].value : null,
      execution: bossResults[1].status === 'fulfilled' ? bossResults[1].value : null,
      rca: bossResults[2].status === 'fulfilled' ? bossResults[2].value : null,
      port: bossResults[3].status === 'fulfilled' ? bossResults[3].value : null,
      esim: bossResults[4].status === 'fulfilled' ? bossResults[4].value : null,
      payments: bossResults[5].status === 'fulfilled' ? bossResults[5].value : null,
    };

    // ── Compute touch count ──
    // Count distinct customer contacts (public comments where author is requester)
    let touchCount = allTickets.length; // baseline: each ticket = 1 touch

    // ── Classify issue ──
    const currentTicket = allTickets.find(t => String(t.id) === String(ticketId));
    const issueText = currentTicket
      ? `${currentTicket.subject || ''} ${currentTicket.description || ''}`
      : '';
    const issueType = classifyIssue(issueText);

    // ── Detect sentiment from tags ──
    const tags = currentTicket?.tags || [];
    const sentimentTag = tags.find(t => typeof t === 'string' && t.startsWith('sentiment__'));
    const sentiment = sentimentTag ? sentimentTag.replace('sentiment__', '') : 'unknown';

    // ── Signals & actions ──
    const ctxForSignals = { customer360, bossData, touchCount };
    const signals = detectProactiveSignals(ctxForSignals);
    const actionsCtx = { customer360, bossData, signals };
    const suggestedActions = suggestActions(actionsCtx);

    // ── KB search ──
    const issueKeywords = issueType !== 'general' ? issueType : (currentTicket?.subject || '');
    const kbArticles = searchKB(issueKeywords, issueType !== 'general' ? issueType : null, 3);

    // ── Open ticket summary ──
    const openTickets = allTickets.filter(t => !['solved', 'closed'].includes(t.status));

    // ── Build response ──
    const context = {
      customer: {
        name: customer360
          ? `${customer360.given_name || ''} ${customer360.family_name || ''}`.trim()
          : currentTicket?.requester?.name || email,
        email,
        phone: customer360?.phone_number || null,
        individualId: customer360?.individual_id || null,
        customerId: customer360?.customer_id || null,
        onboardingStatus: customer360?.onboarding_status || null,
        telcoStatus: customer360?.telco_customer_status || null,
      },
      ticket: currentTicket ? {
        id: currentTicket.id,
        subject: currentTicket.subject,
        status: currentTicket.status,
        priority: currentTicket.priority,
        channel: currentTicket.via?.channel || 'unknown',
        createdAt: currentTicket.created_at,
        tags,
      } : null,
      issueType,
      sentiment,
      touchCount,
      toneGuide: getToneGuide(touchCount),
      order: {
        id: orderId,
        status: bossData.order?.data?.status || customer360?.latest_order_status || null,
        esimStatus: bossData.esim?.data?.status || customer360?.latest_order_esim_status || null,
        portinStatus: bossData.port?.data?.status || customer360?.latest_order_portin_status || null,
        portinConflict: parseConflictInfo(
          bossData.port?.data?.conflictInfo || customer360?.portin_conflict_info
        ),
        paymentStatus: bossData.payments?.data ? 'fetched' : null,
        payments: bossData.payments?.data || null,
      },
      rca: bossData.rca?.data || null,
      signals,
      actions: suggestedActions,
      kbArticles,
      ticketHistory: {
        total: allTickets.length,
        open: openTickets.length,
        tickets: openTickets.slice(0, 10).map(t => ({
          id: t.id, subject: t.subject, status: t.status,
          priority: t.priority, createdAt: t.created_at,
        })),
      },
      fetchedAt: new Date().toISOString(),
    };

    res.json(context);

  } catch (error) {
    console.error('[COPILOT] Context error:', error);
    res.status(500).json({ error: 'Failed to fetch context', details: error.message });
  }
});

// ═══════════════════════════════════════════════
// ENDPOINT 2: POST /api/copilot/generate
// Generate humanized draft response via Claude
// ═══════════════════════════════════════════════

router.post('/generate', async (req, res) => {
  try {
    const { context, channel, ticketId } = req.body;
    if (!context) return res.status(400).json({ error: 'context is required' });

    console.log(`[COPILOT] Generate draft for ticket #${ticketId || 'N/A'}`);

    const isEmail = channel === 'email' || channel === 'web';
    const toneGuide = context.toneGuide || getToneGuide(context.touchCount || 0);

    // Load relevant skills
    const issueText = `${context.ticket?.subject || ''} ${context.issueType || ''}`;
    const relevantSkillNames = detectRelevantSkills(issueText);
    // Always include humanize-ai-text if it exists
    if (!relevantSkillNames.includes('humanize-ai-text')) {
      relevantSkillNames.push('humanize-ai-text');
    }
    const skillsContent = loadSelectedSkills(relevantSkillNames);

    // Build Claude prompt
    const systemPrompt = `You are a customer service assistant for Meow Mobile. Generate a response for the agent to send to the customer.

## Tone Calibration
Touch count: ${context.touchCount || 0}
Tone: ${toneGuide.tone}
Instruction: ${toneGuide.instruction}

## Channel: ${isEmail ? 'EMAIL' : 'CHAT'}
${isEmail
  ? 'Format as a complete email. Start with "Hi [Name],". Use numbered lists for steps. End with "Thanks,\\n[Agent Name]\\nMeow Mobile Support".'
  : 'Format as conversational chat. Keep it concise and friendly. No formal sign-off needed.'}

## Rules
- Write like a real American person. Use contractions. No em dashes. No semicolons.
- Be specific about what you did and what happens next.
- If signals show CRITICAL or HIGH issues, lead with those.
- Reference KB articles naturally (don't dump links).
- Also produce an INTERNAL NOTE summarizing the diagnosis and actions for other agents.

## Skills & Knowledge
${skillsContent}
`;

    // Build the user message with pre-fetched context
    const userMessage = `## Customer Context (pre-fetched — DO NOT call any tools)

**Customer:** ${context.customer?.name || 'Unknown'} (${context.customer?.email})
**Issue Type:** ${context.issueType || 'general'}
**Sentiment:** ${context.sentiment || 'unknown'}
**Touch Count:** ${context.touchCount || 0}
**Ticket:** ${context.ticket ? `#${context.ticket.id} — ${context.ticket.subject} (${context.ticket.status})` : 'N/A'}

**Order Status:** ${context.order?.status || 'N/A'}
**eSIM Status:** ${context.order?.esimStatus || 'N/A'}
**Port-In Status:** ${context.order?.portinStatus || 'N/A'}
${context.order?.portinConflict?.code ? `**Port-In Conflict:** ${context.order.portinConflict.code} — ${context.order.portinConflict.reason}` : ''}

**Signals Detected:**
${context.signals?.length > 0
  ? context.signals.map(s => `- [${s.severity}] ${s.label}: ${s.detail}`).join('\n')
  : '- No critical signals detected'}

**Suggested Actions:**
${context.actions?.length > 0
  ? context.actions.map(a => `- ${a.label}`).join('\n')
  : '- No actions suggested'}

**Relevant KB Articles:**
${context.kbArticles?.length > 0
  ? context.kbArticles.map(a => `- ${a.title} (${a.url || 'no link'})`).join('\n')
  : '- No matching articles'}

**Open Tickets:** ${context.ticketHistory?.open || 0} of ${context.ticketHistory?.total || 0} total

---

Generate TWO outputs separated by "---INTERNAL_NOTE---":

1. **CUSTOMER RESPONSE** — the draft the agent will send
2. **INTERNAL NOTE** — a brief summary for the ticket (diagnosis, signals, actions taken/suggested, tone used)
`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const rawText = response.content.find(b => b.type === 'text')?.text || '';

    // Split into draft + internal note
    const parts = rawText.split(/---INTERNAL_NOTE---/i);
    let draft = (parts[0] || '').trim();
    let internalNote = (parts[1] || '').trim();

    // Humanize the customer-facing draft
    draft = humanizeText(draft);

    // Determine which KB articles were referenced
    const kbCited = (context.kbArticles || []).filter(a =>
      draft.toLowerCase().includes(a.title.toLowerCase().substring(0, 20))
    );

    res.json({
      draft,
      internalNote: internalNote || `[CS Copilot] Draft generated. Issue: ${context.issueType}. Touch count: ${context.touchCount}. Tone: ${toneGuide.tone}.`,
      kbCited,
    });

  } catch (error) {
    console.error('[COPILOT] Generate error:', error);
    res.status(500).json({ error: 'Failed to generate response', details: error.message });
  }
});

// ═══════════════════════════════════════════════
// ENDPOINT 3: GET /api/copilot/kb-search
// ═══════════════════════════════════════════════

router.get('/kb-search', (req, res) => {
  const { q, category } = req.query;
  if (!q) return res.status(400).json({ error: 'q query parameter is required' });

  const results = searchKB(q, category || null, 5);
  res.json({ query: q, category: category || null, results });
});

module.exports = router;
