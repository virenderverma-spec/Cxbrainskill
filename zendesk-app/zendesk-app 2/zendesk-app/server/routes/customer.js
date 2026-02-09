const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { bossApi } = require('../lib/boss-api');
const { databricksQuery } = require('../lib/databricks');
const { zendeskSearch, zendeskTicketComments, zendeskHelpCenterSearch } = require('../lib/zendesk-api');
const { getSkillGuidance, skillsAvailable, loadSkill, skillsForProblemType, detectRelevantSkills } = require('../lib/skill-loader');

const router = express.Router();

// Anthropic (optional — for AI fallback in agent brief)
let anthropic = null;
if (process.env.ANTHROPIC_API_KEY) {
  try {
    anthropic = new (Anthropic.default || Anthropic)({ apiKey: process.env.ANTHROPIC_API_KEY });
  } catch (e) { /* skip */ }
}

// ── POST /api/customer/search ────────────────────────────────

router.post('/search', async (req, res) => {
  const { search } = req.body;
  if (!search) return res.status(400).json({ error: 'search term required' });

  try {
    const result = await bossApi('get', `/customer/search/${encodeURIComponent(search)}`);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Shared customer lookup logic ─────────────────────────────

async function performCustomerLookup(email) {
  const safeEmail = email.replace(/'/g, "''").trim().toLowerCase();
  console.log(`  → Customer lookup: ${safeEmail}`);

  const mainQuery = await databricksQuery(`
    SELECT sc.user_id, sc.customer_email, sc.customer_name, sc.customer_phone,
      sc.individual_id, sc.stripe_customer_id,
      o.order_id, o.status AS order_status, o.esim_status,
      o.select_number_type, o.portin_response, o.created_at AS order_created_at,
      uf.payment_completed_time, uf.activation_completed_time,
      uf.order_completed_time, uf.number_selection_completed_time,
      uf.imei_checking_completed_time, uf.pet_insurance_completed_time,
      uf.completed_time AS onboarding_completed_time
    FROM \`rds-prod_catalog\`.cj_prod.stripe_customers sc
    LEFT JOIN \`rds-prod_catalog\`.cj_prod.mvno_order o ON sc.user_id = o.user_id
    LEFT JOIN \`rds-prod_catalog\`.cj_prod.user_onboarding_flow uf
      ON sc.user_id = uf.user_id AND o.order_id = uf.order_id
    WHERE LOWER(sc.customer_email) = '${safeEmail}'
    ORDER BY o.created_at DESC
  `);

  if (mainQuery.error || (!mainQuery.rows && !mainQuery.columns)) {
    return { found: false, error: mainQuery.message || 'Query failed' };
  }
  if (!mainQuery.rows || mainQuery.rows.length === 0) {
    return { found: false };
  }

  const cols = mainQuery.columns;
  const toObj = (row) => { const o = {}; cols.forEach((c, i) => { o[c] = row[i]; }); return o; };
  const allRows = mainQuery.rows.map(toObj);
  const first = allRows[0];

  // Deduplicate orders
  const orderMap = new Map();
  for (const row of allRows) {
    if (row.order_id && !orderMap.has(row.order_id)) {
      orderMap.set(row.order_id, {
        orderId: row.order_id,
        status: row.order_status,
        esimStatus: row.esim_status,
        selectNumberType: row.select_number_type,
        portinResponse: row.portin_response,
        createdAt: row.order_created_at,
        paymentCompleted: row.payment_completed_time,
        activationCompleted: row.activation_completed_time,
        orderCompleted: row.order_completed_time,
        numberSelectionCompleted: row.number_selection_completed_time,
        imeiCheckingCompleted: row.imei_checking_completed_time,
        petInsuranceCompleted: row.pet_insurance_completed_time,
        onboardingCompleted: row.onboarding_completed_time,
      });
    }
  }

  const result = {
    found: true,
    customer: {
      userId: first.user_id,
      email: first.customer_email,
      name: first.customer_name,
      phone: first.customer_phone,
      individualId: first.individual_id,
      stripeCustomerId: first.stripe_customer_id,
    },
    orders: Array.from(orderMap.values()),
    individual: null,
    simProducts: null,
    portStatus: null,
    mochi: null,
  };

  // Parallel — Boss API (individual, SIM) + Databricks (Mochi)
  const tasks = [];

  if (first.individual_id) {
    tasks.push(
      bossApi('get', `/individual/${first.individual_id}`)
        .then(d => { if (!d.error) result.individual = d; })
        .catch(() => {})
    );
    tasks.push(
      bossApi('get', `/individual/${first.individual_id}/simProducts`)
        .then(d => { if (!d.error) result.simProducts = d; })
        .catch(() => {})
    );
  }

  if (first.user_id) {
    tasks.push(
      databricksQuery(`
        SELECT conversation_id, title, message_count, created_at,
          get_json_object(metadata, '$.human_escalated') AS escalated,
          get_json_object(metadata, '$.main_category') AS category
        FROM \`rds-prod_catalog\`.cj_prod.conversations
        WHERE user_id = '${first.user_id.replace(/'/g, "''")}'
        ORDER BY created_at DESC LIMIT 5
      `).then(d => {
        if (!d.error && d.rows && d.rows.length > 0) {
          result.mochi = d.rows.map(row => {
            const o = {}; d.columns.forEach((c, i) => { o[c] = row[i]; }); return o;
          });
        }
      }).catch(() => {})
    );
  }

  await Promise.allSettled(tasks);

  // Port-in check (needs MSISDN from individual)
  const ind = result.individual;
  const msisdn = ind?.msisdn || (Array.isArray(ind) ? ind[0]?.msisdn : null);
  if (msisdn) {
    result.msisdn = msisdn;
    const hasPortIn = result.orders.some(o =>
      o.selectNumberType === 'PORTIN' ||
      (o.portinResponse && o.portinResponse.includes('PortInMSISDN'))
    );
    if (hasPortIn) {
      try {
        const p = await bossApi('get', `/order/getportstatus/${msisdn}`);
        if (!p.error) result.portStatus = p;
      } catch (e) { /* skip */ }
    }
  }

  console.log(`  ✓ Lookup: ${result.orders.length} order(s), individual: ${!!result.individual}, mochi: ${result.mochi?.length || 0}`);
  return result;
}

// ── POST /api/customer/lookup ────────────────────────────────

router.post('/lookup', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email required' });

  try {
    const result = await performCustomerLookup(email);
    res.json(result);
  } catch (err) {
    console.error('Customer lookup error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Agent Brief: synthesis helpers ────────────────────────────

function deriveSearchTopic(mochi, tickets) {
  if (mochi && mochi.length > 0) {
    const cat = mochi[0].category;
    if (cat && cat !== 'null') return cat.replace(/_/g, ' ');
  }
  if (tickets && tickets.length > 0) {
    const subj = tickets[0].subject;
    if (subj) return subj.replace(/\[.*?\]/g, '').trim().slice(0, 60);
  }
  return 'Meow Mobile help';
}

function buildPreviousContacts(tickets, mochi) {
  const contacts = [];
  if (tickets) {
    for (const t of tickets) {
      contacts.push({
        channel: 'Email',
        reason: t.subject || 'Support ticket',
        date: t.created_at,
        id: t.id,
        status: t.status,
      });
    }
  }
  if (mochi) {
    for (const m of mochi) {
      contacts.push({
        channel: 'Mochi',
        reason: m.title || m.category || 'Chat conversation',
        date: m.created_at,
        escalated: m.escalated === 'true',
        category: m.category,
      });
    }
  }
  contacts.sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : 0;
    const db = b.date ? new Date(b.date).getTime() : 0;
    return db - da;
  });
  return contacts;
}

function identifyCurrentProblem(lookup) {
  if (!lookup || !lookup.found) return null;

  const orders = lookup.orders || [];
  const mochi = lookup.mochi || [];

  // eSIM ERROR/FAILED from order
  for (const o of orders) {
    const es = String(o.esimStatus || '').toUpperCase();
    if (es === 'ERROR' || es === 'FAILED') {
      return { problem: 'eSIM activation failed on order ' + o.orderId, confidence: 'high', type: 'esim' };
    }
  }

  // Port-in FAILED
  for (const o of orders) {
    if (o.portinResponse && o.portinResponse.includes('FAILED')) {
      return { problem: 'Port-in failed for order ' + o.orderId, confidence: 'high', type: 'portin' };
    }
  }
  if (lookup.portStatus) {
    const ps = String(lookup.portStatus.status || lookup.portStatus.portStatus || '').toUpperCase();
    if (ps.includes('FAIL') || ps.includes('REJECT')) {
      return { problem: 'Port-in failed — status: ' + (lookup.portStatus.status || lookup.portStatus.portStatus), confidence: 'high', type: 'portin' };
    }
  }

  // Mochi escalated
  if (mochi.length > 0 && mochi[0].escalated === 'true') {
    return { problem: 'Escalated from Mochi chatbot — ' + (mochi[0].title || mochi[0].category || 'unresolved issue'), confidence: 'high', type: 'mochi_escalation' };
  }

  // Order FAILED
  for (const o of orders) {
    if (String(o.status || '').toUpperCase() === 'FAILED') {
      return { problem: 'Order processing failure — order ' + o.orderId + ' is FAILED', confidence: 'high', type: 'order_failure' };
    }
  }

  // Payment not completed + order exists
  if (orders.length > 0 && !orders[0].paymentCompleted) {
    const st = String(orders[0].status || '').toUpperCase();
    if (st !== 'COMPLETED' && st !== 'DONE') {
      return { problem: 'Payment not completed for latest order', confidence: 'medium', type: 'payment' };
    }
  }

  return null;
}

function extractInfoFromComments(commentArrays) {
  const info = {};
  const allText = [];
  for (const comments of commentArrays) {
    if (Array.isArray(comments)) {
      for (const c of comments) {
        if (c.body) allText.push(c.body);
      }
    }
  }
  const text = allText.join('\n');

  const deviceMatch = text.match(/\b(iPhone\s*\d{1,2}(?:\s*Pro(?:\s*Max)?)?|Samsung\s+Galaxy\s+\S+|Google\s+Pixel\s+\S+|iPad\s*(?:Pro|Air|Mini)?)/i);
  if (deviceMatch) info.Device = deviceMatch[0];
  else if (/android/i.test(text) && !/iphone|ipad/i.test(text)) info.Device = 'Android device';
  else if (/iphone/i.test(text)) info.Device = 'iPhone';

  const browserMatch = text.match(/\b(Chrome|Safari|Firefox|Edge|Opera)\b/i);
  if (browserMatch) info.Browser = browserMatch[0];

  const iosMatch = text.match(/iOS\s*([\d.]+)/i);
  if (iosMatch) info['OS Version'] = 'iOS ' + iosMatch[1];
  const androidMatch = text.match(/Android\s*([\d.]+)/i);
  if (androidMatch) info['OS Version'] = 'Android ' + androidMatch[1];

  const errorMatch = text.match(/(?:error|failed|failure)[:\s]+(.{10,80})/i);
  if (errorMatch) info['Error Message'] = errorMatch[1].trim();

  return info;
}

function buildNextSteps(problem, kbArticles, lookup, customerName) {
  const steps = [];
  if (!problem) {
    // Auto-resolve: show customer summary instead of generic investigate step
    const orderCount = (lookup && lookup.orders) ? lookup.orders.length : 0;
    const contactCount = (lookup && lookup.mochi) ? lookup.mochi.length : 0;
    const latestStatus = orderCount > 0 ? lookup.orders[0].status : 'none';
    steps.push({
      type: 'ai_done',
      text: 'Customer History',
      result: orderCount + ' order(s), ' + contactCount + ' Mochi chat(s), latest order: ' + (latestStatus || 'N/A'),
      status: orderCount > 0 ? 'info' : 'info',
    });
    if (kbArticles && kbArticles.length > 0) {
      steps.push({ type: 'kb_article', text: 'Relevant: ' + kbArticles[0].title, url: kbArticles[0].html_url });
    }
    return steps;
  }

  switch (problem.type) {
    case 'esim': {
      // Auto-resolve: show actual eSIM status from lookup
      const esimOrder = (lookup && lookup.orders) ? lookup.orders[0] : null;
      const esimStatus = esimOrder ? esimOrder.esimStatus : null;
      const simInfo = lookup && lookup.simProducts;
      let esimResult = esimStatus ? ('eSIM status: ' + esimStatus) : 'eSIM status unknown';
      if (simInfo) {
        const items = Array.isArray(simInfo) ? simInfo : (simInfo.content || [simInfo]);
        const first = items[0];
        if (first && first.status) esimResult += ' — SIM product: ' + first.status;
      }
      const esimOk = esimStatus && ['INSTALLED', 'ACTIVE', 'RELEASED'].includes(String(esimStatus).toUpperCase());
      steps.push({ type: 'ai_done', text: 'eSIM Profile Status', result: esimResult, status: esimOk ? 'ok' : 'issue' });
      steps.push({ type: 'ask_info', text: 'Ask customer for device model and whether they scanned the QR code', sla: { minutes: 15, label: 'Within 15 min' } });
      steps.push({ type: 'customer_action', text: 'Guide customer through manual eSIM installation if QR failed', sla: { minutes: 30, label: 'Within 30 min' } });
      break;
    }
    case 'payment': {
      // Auto-resolve: show payment status from lookup
      const payOrder = (lookup && lookup.orders) ? lookup.orders[0] : null;
      const payDone = payOrder ? payOrder.paymentCompleted : null;
      const payResult = payDone ? ('Payment completed at ' + payDone) : 'Payment NOT completed';
      steps.push({ type: 'ai_done', text: 'Payment Status', result: payResult, status: payDone ? 'ok' : 'issue' });
      steps.push({ type: 'customer_action', text: 'Suggest customer retry with a different payment method', sla: { minutes: 30, label: 'Within 30 min' } });
      break;
    }
    case 'portin': {
      // Auto-resolve: show port status from lookup
      const portData = lookup ? lookup.portStatus : null;
      let portResult = 'Port status unavailable';
      let portOk = 'info';
      if (portData) {
        const ps = portData.status || portData.portStatus || 'unknown';
        portResult = 'Port-in status: ' + ps;
        const upper = String(ps).toUpperCase();
        if (upper.includes('COMPLETE') || upper.includes('SUCCESS')) portOk = 'ok';
        else if (upper.includes('FAIL') || upper.includes('REJECT')) portOk = 'issue';
      }
      steps.push({ type: 'ai_done', text: 'Port-in Status', result: portResult, status: portOk });
      steps.push({ type: 'ask_info', text: 'Confirm account number and PIN with the customer', sla: { minutes: 15, label: 'Within 15 min' } });
      steps.push({ type: 'customer_action', text: 'If rejected, ask customer to contact previous carrier for correct details', sla: { minutes: 30, label: 'Within 30 min' } });
      break;
    }
    case 'mochi_escalation': {
      // Auto-resolve: show Mochi conversation details from lookup
      const mochiData = (lookup && lookup.mochi) ? lookup.mochi[0] : null;
      let mochiResult = 'No Mochi data available';
      if (mochiData) {
        mochiResult = (mochiData.category || 'Unknown category') + ' — ' + (mochiData.title || 'No title');
        if (mochiData.escalated === 'true') mochiResult += ' (escalated)';
      }
      steps.push({ type: 'ai_done', text: 'Mochi Conversation', result: mochiResult, status: 'info' });
      steps.push({ type: 'customer_action', text: 'Address the specific issue the chatbot could not resolve', sla: { minutes: 30, label: 'Within 30 min' } });
      break;
    }
    case 'order_failure': {
      // Auto-resolve: show order status and error info from lookup
      const failedOrder = (lookup && lookup.orders) ? lookup.orders.find(o => String(o.status || '').toUpperCase() === 'FAILED') || lookup.orders[0] : null;
      let orderResult = 'No order data available';
      if (failedOrder) {
        orderResult = 'Order ' + String(failedOrder.orderId).slice(0, 12) + '... — Status: ' + (failedOrder.status || 'unknown');
        if (failedOrder.esimStatus) orderResult += ', eSIM: ' + failedOrder.esimStatus;
        if (failedOrder.portinResponse && failedOrder.portinResponse.includes('FAILED')) orderResult += ', Port-in: FAILED';
      }
      steps.push({ type: 'ai_done', text: 'Order Status', result: orderResult, status: 'issue' });
      steps.push({ type: 'ai_done', text: 'Execution Timeline', result: failedOrder ? ('Created: ' + (failedOrder.createdAt || 'unknown') + ', Payment: ' + (failedOrder.paymentCompleted || 'not completed')) : 'No timeline data', status: 'info' });
      break;
    }
    default: {
      // Auto-resolve: show general customer summary
      const defOrders = (lookup && lookup.orders) ? lookup.orders.length : 0;
      const defMochi = (lookup && lookup.mochi) ? lookup.mochi.length : 0;
      steps.push({ type: 'ai_done', text: 'Customer Summary', result: defOrders + ' order(s), ' + defMochi + ' Mochi chat(s)', status: 'info' });
    }
  }

  if (kbArticles && kbArticles.length > 0) {
    for (const a of kbArticles.slice(0, 2)) {
      steps.push({ type: 'kb_article', text: a.title, url: a.html_url });
    }
  }

  // Attach email drafts to customer-facing steps
  for (const step of steps) {
    if (step.type === 'customer_action' || step.type === 'ask_info') {
      step.emailDraft = buildEmailDraft(problem.type, step.type, step.text, customerName);
    }
  }

  return steps;
}

function buildEmailDraft(problemType, stepType, stepText, customerName) {
  const name = customerName || 'there';
  const greeting = `Hi ${name},\n\n`;
  const signoff = '\n\nIf you have any questions, just reply to this email.\n\nBest,\nMeow Mobile Support';

  const templates = {
    'esim:customer_action': `${greeting}We noticed your eSIM may need to be set up manually. Here's how:\n\n1. Go to Settings > Cellular > Add eSIM\n2. Select "Enter Details Manually"\n3. Enter the activation details from your confirmation email\n4. Restart your device after setup\n\nIf you need help finding your activation details, just let us know!${signoff}`,
    'esim:ask_info': `${greeting}To help resolve your eSIM issue, could you please reply with:\n\n- Your device model (e.g., iPhone 15, Samsung Galaxy S24)\n- Whether you tried scanning the QR code or entering details manually\n- Any error messages you saw\n\nThis will help us get things sorted quickly.${signoff}`,
    'payment:customer_action': `${greeting}It looks like your recent payment didn't go through. Here are a few things to try:\n\n1. Double-check your card details are up to date\n2. Try a different payment method\n3. Make sure your bank isn't blocking the transaction\n\nYou can retry your payment in the Meow Mobile app or on our website.${signoff}`,
    'portin:ask_info': `${greeting}To complete your number transfer, we need to verify a few details. Could you please confirm:\n\n- Your account number with your previous carrier\n- Your account PIN or password\n- The billing name on your previous account\n\nYou can usually find these in your old carrier's app or by calling them.${signoff}`,
    'portin:customer_action': `${greeting}Your number transfer needs a small update. Please contact your previous carrier and:\n\n1. Confirm your account number and PIN are correct\n2. Make sure your account is active (not suspended)\n3. Remove any port-out blocks on your line\n\nOnce that's done, let us know and we'll retry the transfer right away.${signoff}`,
    'mochi_escalation:customer_action': `${greeting}Thanks for your patience. I've reviewed your conversation with our chatbot and I'm here to personally help resolve this.\n\nI'm looking into your issue now and will follow up shortly with next steps.${signoff}`,
  };

  const key = `${problemType}:${stepType}`;
  if (templates[key]) return templates[key];

  // Generic fallback
  return `${greeting}${stepText}\n\nPlease let us know if you need any help with this.${signoff}`;
}

function buildTimeline(lookup, payments, tickets, mochi) {
  const events = [];

  if (lookup && lookup.orders && lookup.orders.length > 0) {
    const o = lookup.orders[0];
    if (o.createdAt) events.push({ type: 'order', label: 'Order created', date: o.createdAt, status: o.status });
    if (o.paymentCompleted) events.push({ type: 'onboarding', label: 'Payment completed', date: o.paymentCompleted });
    if (o.numberSelectionCompleted) events.push({ type: 'onboarding', label: 'Number selected', date: o.numberSelectionCompleted });
    if (o.imeiCheckingCompleted) events.push({ type: 'onboarding', label: 'IMEI checked', date: o.imeiCheckingCompleted });
    if (o.activationCompleted) events.push({ type: 'onboarding', label: 'eSIM activated', date: o.activationCompleted });
    if (o.petInsuranceCompleted) events.push({ type: 'onboarding', label: 'Pet insurance step', date: o.petInsuranceCompleted });
    if (o.onboardingCompleted) events.push({ type: 'onboarding', label: 'Onboarding completed', date: o.onboardingCompleted });
  }

  if (payments && Array.isArray(payments)) {
    for (const p of payments.slice(0, 10)) {
      events.push({ type: 'payment', label: 'Payment: ' + (p.name || p.status || 'attempt'), date: p.payment_date || p.paymentDate || p.created_at, status: p.status });
    }
  }

  if (mochi) {
    for (const m of mochi) {
      events.push({ type: 'mochi', label: 'Mochi: ' + (m.category || m.title || 'conversation'), date: m.created_at, escalated: m.escalated === 'true' });
    }
  }

  if (tickets && tickets.tickets) {
    for (const t of tickets.tickets) {
      events.push({ type: 'zendesk', label: 'Ticket: ' + (t.subject || '#' + t.id), date: t.created_at, status: t.status });
    }
  }

  events.sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : 0;
    const db = b.date ? new Date(b.date).getTime() : 0;
    return db - da;
  });

  return events;
}

// ── Timer computation ────────────────────────────────────────

function computeTimers(lookup, previousContacts, zendeskTickets) {
  const timers = {};

  // 1. Onboarding stall timer — find last completed step and next pending step
  if (lookup && lookup.orders && lookup.orders.length > 0) {
    const o = lookup.orders[0];
    const steps = [
      { name: 'Order', date: o.createdAt },
      { name: 'Payment', date: o.paymentCompleted },
      { name: 'Number selection', date: o.numberSelectionCompleted },
      { name: 'IMEI check', date: o.imeiCheckingCompleted },
      { name: 'eSIM activation', date: o.activationCompleted },
      { name: 'Pet insurance', date: o.petInsuranceCompleted },
      { name: 'Onboarding', date: o.onboardingCompleted },
    ];

    let lastCompleted = null;
    let nextPending = null;
    for (const step of steps) {
      if (step.date) {
        lastCompleted = step;
      } else if (!nextPending) {
        nextPending = step;
      }
    }

    if (lastCompleted && nextPending) {
      timers.onboarding = {
        label: nextPending.name + ' incomplete',
        since: lastCompleted.date,
        lastStep: lastCompleted.name,
      };
    } else if (lastCompleted && !nextPending) {
      timers.onboarding = {
        label: 'Onboarding complete',
        since: lastCompleted.date,
        complete: true,
      };
    }
  }

  // 2. Last correspondence timer
  if (previousContacts && previousContacts.length > 0) {
    const latest = previousContacts[0]; // sorted newest first
    timers.lastContact = {
      label: 'Last ' + latest.channel + ' contact',
      since: latest.date,
      channel: latest.channel,
    };
  }

  // 3. Ticket age timer — oldest open ticket
  if (zendeskTickets && zendeskTickets.length > 0) {
    const openTickets = zendeskTickets.filter(t =>
      t.status === 'open' || t.status === 'pending' || t.status === 'new'
    );
    if (openTickets.length > 0) {
      const oldest = openTickets[openTickets.length - 1];
      timers.ticketAge = {
        label: 'Ticket #' + oldest.id + ' open',
        since: oldest.created_at,
        status: oldest.status,
        ticketId: oldest.id,
      };
    }
  }

  return timers;
}

// ── POST /api/customer/agent-brief ───────────────────────────

router.post('/agent-brief', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email required' });

  console.log(`  → Agent brief: ${email}`);

  try {
    // Phase 1: parallel — customer lookup + Zendesk tickets
    const [lookup, zendeskResult] = await Promise.all([
      performCustomerLookup(email),
      zendeskSearch(`type:ticket requester:${email}`),
    ]);

    if (!lookup.found) {
      return res.json({ found: false });
    }

    // Phase 2: parallel — ticket comments (top 3) + Help Center search + Boss API payments
    const searchTopic = deriveSearchTopic(lookup.mochi, zendeskResult.tickets);
    const ticketIds = (zendeskResult.tickets || []).slice(0, 3).map(t => t.id);

    const phase2 = [];
    const commentArrays = [];
    for (const tid of ticketIds) {
      phase2.push(
        zendeskTicketComments(tid)
          .then(c => { if (!c.error) commentArrays.push(c); })
          .catch(() => {})
      );
    }

    let kbArticles = [];
    phase2.push(
      zendeskHelpCenterSearch(searchTopic)
        .then(a => { if (!a.error) kbArticles = a; })
        .catch(() => {})
    );

    let payments = null;
    if (lookup.customer.userId) {
      phase2.push(
        bossApi('get', '/payment', { customerId: lookup.customer.userId })
          .then(d => { if (!d.error) payments = d; })
          .catch(() => {})
      );
    }

    await Promise.allSettled(phase2);

    // Phase 3: synthesis (rule-based)
    const previousContacts = buildPreviousContacts(zendeskResult.tickets, lookup.mochi);
    let currentProblem = identifyCurrentProblem(lookup);
    const infoCollected = extractInfoFromComments(commentArrays);
    const timeline = buildTimeline(lookup, payments, zendeskResult, lookup.mochi);

    // Phase 4: Claude AI fallback if no clear problem
    if (!currentProblem && anthropic) {
      try {
        const ctx = [];
        if (lookup.orders.length > 0) ctx.push(`Latest order: ${lookup.orders[0].status}`);
        if (lookup.mochi && lookup.mochi.length > 0) ctx.push(`Last Mochi: ${lookup.mochi[0].title || lookup.mochi[0].category}`);
        if (zendeskResult.tickets && zendeskResult.tickets.length > 0) ctx.push(`Last ticket: ${zendeskResult.tickets[0].subject}`);

        const aiResp = await anthropic.messages.create({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 500,
          messages: [{
            role: 'user',
            content: `A customer (${email}) is contacting support. Based on this data, what is likely their problem in one sentence?\n\n${ctx.join('\n')}\n\nRespond with ONLY the problem statement, nothing else.`,
          }],
        });

        const aiText = (aiResp.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
        if (aiText) {
          currentProblem = { problem: aiText.trim(), confidence: 'ai', type: 'ai_synthesized' };
        }
      } catch (e) {
        console.warn('  ⚠ AI fallback failed:', e.message);
      }
    }

    const customerName = lookup.customer.name ? lookup.customer.name.split(' ')[0] : null;
    const nextSteps = buildNextSteps(currentProblem, kbArticles, lookup, customerName);

    // Phase 5: Skill-based troubleshooting guidance
    let skillGuidance = [];
    if (skillsAvailable()) {
      try {
        skillGuidance = getSkillGuidance(currentProblem, lookup);
      } catch (e) {
        console.warn('  ⚠ Skill guidance failed:', e.message);
      }
    }

    // Phase 6: Compute elapsed-time timers
    const timers = computeTimers(lookup, previousContacts, zendeskResult.tickets);

    console.log(`  ✓ Agent brief: ${previousContacts.length} contacts, problem: ${currentProblem ? currentProblem.type : 'none'}, ${skillGuidance.length} skills, ${timeline.length} timeline events`);
    res.json({
      found: true,
      customerName,
      timers,
      previousContacts,
      currentProblem,
      infoCollected,
      nextSteps,
      skillGuidance,
      timeline,
      kbArticles,
    });
  } catch (err) {
    console.error('Agent brief error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/customer/ticket-assist ──────────────────────────

router.post('/ticket-assist', async (req, res) => {
  const { email, ticketId, ticketSubject, ticketDescription } = req.body;
  if (!email) return res.status(400).json({ error: 'email required' });

  console.log(`  → Ticket assist: ${email}, ticket #${ticketId || 'N/A'}`);

  try {
    // Phase 1: parallel — customer lookup + ticket comments + all Zendesk tickets for this email
    const phase1 = [
      performCustomerLookup(email),
      ticketId ? zendeskTicketComments(ticketId) : Promise.resolve([]),
      zendeskSearch(`type:ticket requester:${email}`),
    ];
    const [lookup, comments, zendeskResult] = await Promise.allSettled(phase1).then(results =>
      results.map(r => r.status === 'fulfilled' ? r.value : null)
    );

    if (!lookup || !lookup.found) {
      return res.json({
        ticketContext: 'No customer record found for ' + email + '. This may be a new or unregistered customer.',
        nextAction: 'Verify customer identity and confirm their email address',
        steps: ['Ask the customer to confirm their email address', 'Check if they used a different email to register', 'If new customer, assist with their inquiry directly'],
        followUp: { timing: '24 hours', reason: 'Follow up if customer hasn\'t replied with correct email' },
        suggestedResponse: 'Hi there,\n\nThank you for reaching out to Meow Mobile! I\'d be happy to help you.\n\nCould you please confirm the email address associated with your Meow Mobile account? This will help me pull up your information and assist you more quickly.\n\nBest,\nMeow Mobile Support',
      });
    }

    // Phase 2: identify problem + load skill content
    const currentProblem = identifyCurrentProblem(lookup);

    // Gather relevant skill content
    let skillContent = '';
    if (skillsAvailable()) {
      let skillNames = [];
      if (currentProblem && currentProblem.type) {
        skillNames = skillsForProblemType(currentProblem.type);
      }
      // Also detect from ticket subject/description
      const ticketText = [ticketSubject, ticketDescription].filter(Boolean).join(' ');
      if (ticketText) {
        const detected = detectRelevantSkills(ticketText);
        for (const s of detected) {
          if (!skillNames.includes(s)) skillNames.push(s);
        }
      }
      skillNames = skillNames.slice(0, 2);
      for (const name of skillNames) {
        const content = loadSkill(name);
        if (content) {
          skillContent += '\n--- Skill: ' + name + ' ---\n' + content.slice(0, 2000) + '\n';
        }
      }
    }

    // Build context for Claude
    const customer = lookup.customer;
    const orders = lookup.orders || [];
    const latestOrder = orders[0];
    const commentText = Array.isArray(comments) && !comments.error
      ? comments.map(c => (c.public ? '[Customer]' : '[Agent]') + ' ' + (c.body || '').slice(0, 300)).join('\n')
      : '';

    // Build recent tickets summary
    const allTickets = (zendeskResult && zendeskResult.tickets) || [];
    const mochiChats = lookup.mochi || [];
    const zendeskTouchCount = allTickets.length;
    const mochiTouchCount = mochiChats.length;
    const totalTouches = zendeskTouchCount + mochiTouchCount;

    let recentTicketsSummary = '';
    if (allTickets.length > 0) {
      recentTicketsSummary = allTickets.slice(0, 5).map(t =>
        '- Ticket #' + t.id + ' [' + (t.status || 'unknown') + ']: ' + (t.subject || 'No subject') + ' (' + (t.created_at || '') + ')'
      ).join('\n');
    }

    let mochiSummary = '';
    if (mochiChats.length > 0) {
      mochiSummary = mochiChats.slice(0, 3).map(m =>
        '- Mochi chat: ' + (m.category || m.title || 'conversation') +
        (m.escalated === 'true' ? ' (ESCALATED)' : '') +
        ' — ' + (m.message_count || '?') + ' messages (' + (m.created_at || '') + ')'
      ).join('\n');
    }

    const customerSummary = [
      'Name: ' + (customer.name || 'Unknown'),
      'Email: ' + (customer.email || email),
      'Individual ID: ' + (customer.individualId || 'N/A'),
      'Orders: ' + orders.length,
      'TOTAL CONTACT TOUCHES: ' + totalTouches + ' (' + zendeskTouchCount + ' Zendesk tickets + ' + mochiTouchCount + ' Mochi chats)',
    ];
    if (latestOrder) {
      customerSummary.push('Latest order ID: ' + (latestOrder.orderId || 'unknown'));
      customerSummary.push('Latest order status: ' + (latestOrder.status || 'unknown'));
      customerSummary.push('eSIM status: ' + (latestOrder.esimStatus || 'unknown'));
      customerSummary.push('Payment: ' + (latestOrder.paymentCompleted ? 'completed' : 'not completed'));
      if (latestOrder.selectNumberType === 'PORTIN') customerSummary.push('Type: Port-in');
    }
    if (lookup.portStatus) {
      customerSummary.push('Port-in status: ' + (lookup.portStatus.status || lookup.portStatus.portStatus || 'unknown'));
    }
    if (lookup.mochi && lookup.mochi.length > 0) {
      const m = lookup.mochi[0];
      customerSummary.push('Last Mochi chat: ' + (m.category || m.title || 'conversation') + (m.escalated === 'true' ? ' (ESCALATED)' : ''));
    }
    if (currentProblem) {
      customerSummary.push('Detected problem: ' + currentProblem.problem + ' [' + currentProblem.type + ']');
    }

    // Phase 3: Call Claude for structured response
    if (!anthropic) {
      // Fallback: build response without AI
      const customerName = customer.name ? customer.name.split(' ')[0] : 'there';
      const problemText = currentProblem
        ? currentProblem.problem
        : 'Customer is contacting support. Review ticket details to identify their needs.';

      let fallbackSteps = ['Review the ticket details and customer history'];
      let fallbackSummary = 'Investigate and respond';
      let fallbackResponse = 'Hi ' + customerName + ',\n\nThank you for reaching out to Meow Mobile! I\'m looking into this for you and will follow up shortly.\n\nBest,\nMeow Mobile Support';

      if (currentProblem) {
        const guidance = skillsAvailable() ? getSkillGuidance(currentProblem, lookup) : [];
        if (guidance.length > 0 && guidance[0].troubleshootingSteps.length > 0) {
          fallbackSteps = guidance[0].troubleshootingSteps.map(s => s.step);
          fallbackSummary = guidance[0].title || fallbackSummary;
        }
      }

      return res.json({
        ticketContext: problemText,
        nextAction: fallbackSummary,
        steps: fallbackSteps,
        followUp: { timing: '24 hours', reason: 'Follow up to confirm the issue is resolved' },
        suggestedResponse: fallbackResponse,
      });
    }

    const systemPrompt = `You are a CS copilot for Meow Mobile (an eSIM-based mobile carrier). You help support agents handle tickets efficiently.

Analyze the ticket and customer data provided, then respond with EXACTLY this JSON format (no markdown, no code fences):
{
  "ticketContext": "3-4 sentence OVERALL context. Include: what this ticket is about, how it connects to any previous tickets or Mochi chats from this customer, the customer's journey so far, and explicitly state the total number of contacts/touches (e.g. 'This is their 8th contact across all channels'). Paint the full picture.",
  "nextAction": "One clear sentence telling the agent exactly what to do RIGHT NOW (e.g. 'Trigger a SIM swap and send new QR code')",
  "steps": ["Step 1", "Step 2", "Step 3"],
  "actions": [],
  "followUp": {
    "timing": "Specific timeframe (e.g. '24 hours', '48 hours', '2 hours')",
    "reason": "What to check on follow-up if customer hasn't confirmed resolution"
  },
  "suggestedResponse": "Full draft reply to send to the customer. Write like a real human support agent, NOT like an AI. Specifically: NEVER use em dashes (—), use commas or periods instead. NEVER use semicolons, break into two sentences. Avoid formal phrases like 'I sincerely apologize', 'please don't hesitate', 'rest assured', 'I want to assure you'. Use casual alternatives like 'sorry about that', 'just reply here', etc. Use contractions (I'm, you'll, don't, can't, won't, we've). Keep sentences short. Vary length naturally. Don't start multiple sentences with 'I'. Sound like a helpful coworker, not a corporate bot. No exclamation marks after apologies or acknowledgments. Address them by first name. Include specific, actionable instructions."
}

The "actions" array should contain ConnectX actions the agent can execute with one click. Only include actions that are RELEVANT to this specific ticket. Each action object must have:
- "type": one of "sim_swap", "suspend", "resume", "cancel_order"
- "label": human-readable button text (e.g. "Swap eSIM", "Suspend Line", "Resume Service", "Cancel Order")
- "reason": why this action is needed (1 sentence)
- "params": object with the IDs needed:
  - sim_swap: { "individualId": "..." }
  - suspend: { "individualId": "..." }
  - resume: { "individualId": "..." }
  - cancel_order: { "orderId": "..." }

AVAILABLE ACTIONS and when to suggest them:
- sim_swap: When eSIM is in ERROR/FAILED state, or customer needs a new eSIM profile
- suspend: When account needs to be temporarily suspended (fraud, lost device, customer request)
- resume: When a suspended account needs to be reactivated
- cancel_order: When an order is stuck/failed and needs to be cancelled before retry

IMPORTANT: Only include actions where you have the required IDs from the customer data. Do NOT include actions if the IDs are missing. If no actions are needed, return an empty array [].

Guidelines:
- ticketContext MUST mention: (a) current ticket issue, (b) related previous tickets/chats if any, (c) total touch count across all channels, (d) whether this is a recurring/escalating issue or first contact
- If the customer has contacted multiple times about the same or related issue, highlight this — it signals urgency and frustration
- Be specific, not generic. Reference actual data (order status, eSIM state, ticket subjects, etc.)
- nextAction must be a single, direct instruction — the ONE thing to do now
- Steps are the detailed breakdown of how to execute that action (3-5 steps)
- followUp.timing should be realistic: use 2h for urgent issues, 24h for standard, 48h for carrier-dependent
- followUp.reason should say what to verify (e.g. "Confirm eSIM activated and customer has service")
- The suggested response should be ready to send with minimal editing`;

    const userMessage = `CURRENT TICKET:
Subject: ${ticketSubject || 'No subject'}
Description: ${ticketDescription || 'No description'}
Ticket ID: ${ticketId || 'Unknown'}

CURRENT TICKET COMMENTS:
${commentText || 'No comments yet'}

CUSTOMER DATA:
${customerSummary.join('\n')}

ALL RECENT ZENDESK TICKETS BY THIS CUSTOMER (${zendeskTouchCount} total):
${recentTicketsSummary || 'No previous tickets found'}

MOCHI CHATBOT CONVERSATIONS (${mochiTouchCount} total):
${mochiSummary || 'No Mochi conversations found'}

${skillContent ? 'RELEVANT SKILL GUIDES:\n' + skillContent : ''}

Provide the JSON response:`;

    const aiResp = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1500,
      messages: [{ role: 'user', content: userMessage }],
      system: systemPrompt,
    });

    const aiText = (aiResp.content || []).filter(b => b.type === 'text').map(b => b.text).join('');

    // Parse the JSON response
    let parsed;
    try {
      // Try to extract JSON from the response (handle potential markdown fences)
      const jsonMatch = aiText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : aiText);
    } catch (parseErr) {
      console.warn('  ⚠ Failed to parse AI response as JSON, using raw text');
      parsed = {
        ticketContext: aiText.slice(0, 300),
        nextAction: 'Review the AI response and respond to customer',
        steps: ['The AI response could not be structured automatically'],
        followUp: { timing: '24 hours', reason: 'Follow up to confirm resolution' },
        suggestedResponse: 'Hi there,\n\nThank you for contacting Meow Mobile. I\'m reviewing your request and will follow up shortly.\n\nBest,\nMeow Mobile Support',
      };
    }

    console.log(`  ✓ Ticket assist complete for ${email}`);
    res.json({
      ticketContext: parsed.ticketContext || '',
      nextAction: parsed.nextAction || '',
      steps: parsed.steps || [],
      actions: parsed.actions || [],
      followUp: parsed.followUp || { timing: '24 hours', reason: 'Follow up to confirm resolution' },
      suggestedResponse: parsed.suggestedResponse || '',
    });
  } catch (err) {
    console.error('Ticket assist error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/customer/action — Execute ConnectX actions ─────

router.post('/action', async (req, res) => {
  const { type, params, ticketId, email } = req.body;
  if (!type) return res.status(400).json({ error: 'action type required' });

  console.log(`  → Action: ${type}, ticket #${ticketId || 'N/A'}, email: ${email || 'N/A'}`);

  const actionMap = {
    sim_swap: {
      method: 'post',
      endpoint: (p) => `/individual/${p.individualId}/simswap`,
      body: (p) => ({ reason: p.reason || 'eSIM provisioning failed — agent-initiated swap' }),
      label: 'SIM Swap',
    },
    suspend: {
      method: 'post',
      endpoint: (p) => `/individual/${p.individualId}/suspend`,
      body: (p) => ({ reason: p.reason || 'Agent-initiated suspension' }),
      label: 'Suspend',
    },
    resume: {
      method: 'post',
      endpoint: (p) => `/individual/${p.individualId}/resume`,
      body: (p) => ({ reason: p.reason || 'Agent-initiated resume' }),
      label: 'Resume',
    },
    cancel_order: {
      method: 'post',
      endpoint: (p) => `/order/${p.orderId}/cancel`,
      body: (p) => ({ reason: p.reason || 'Agent-initiated cancellation' }),
      label: 'Cancel Order',
    },
  };

  const action = actionMap[type];
  if (!action) return res.status(400).json({ error: 'Unknown action type: ' + type });

  try {
    const endpoint = action.endpoint(params || {});
    const body = action.body(params || {});

    const result = await bossApi(action.method, endpoint, body);

    if (result.error) {
      console.warn(`  ⚠ Action ${type} failed:`, result.message);
      return res.json({
        success: false,
        action: type,
        label: action.label,
        error: result.message || 'Action failed in ConnectX',
      });
    }

    console.log(`  ✓ Action ${type} completed successfully`);
    res.json({
      success: true,
      action: type,
      label: action.label,
      result: result,
      message: action.label + ' completed successfully via ConnectX',
    });
  } catch (err) {
    console.error(`  ✗ Action ${type} error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
