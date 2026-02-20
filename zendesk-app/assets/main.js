/**
 * CS Copilot Sidebar v2 — Zero-click contextual copilot
 *
 * Auto-loads full customer context on ticket open.
 * Surfaces proactive alerts with executable actions.
 * Generates humanized responses calibrated by touch count.
 */

// ── Configuration ──
var client;
var currentTicket = {};
var copilotContext = null;
var generatedDraft = '';
var diagnosisNoteAdded = false;
var slaTimerInterval = null;

function getServerUrl() {
  // Try ZAF setting first (set in manifest.json), fallback to localhost
  if (client) {
    try {
      return client.context().then(function(ctx) {
        return ctx['ticket_sidebar.serverUrl'] || 'http://localhost:3000';
      }).catch(function() {
        return 'http://localhost:3000';
      });
    } catch (e) { /* fallback */ }
  }
  return Promise.resolve('http://localhost:3000');
}

// ── ZAF-safe HTTP (proxy through Zendesk to avoid mixed content) ──

function zafFetch(url, options) {
  if (!client) return fetch(url, options);
  return client.request({
    url: url,
    type: (options && options.method) || 'GET',
    contentType: 'application/json',
    data: options && options.body ? options.body : undefined,
    httpCompleteResponse: true,
  }).then(function(response) {
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: function() { return Promise.resolve(typeof response.responseJSON !== 'undefined' ? response.responseJSON : JSON.parse(response.responseText)); },
    };
  });
}

// ── Initialize ──

document.addEventListener('DOMContentLoaded', async function() {
  client = ZAFClient.init();
  client.invoke('resize', { width: '100%', height: '600px' });

  // Load ticket data then auto-fetch copilot context
  await loadTicketData();
  loadSlaData();
  fetchCopilotContext();

  // Re-fetch when agent navigates between tickets
  client.on('ticket.id.changed', async function() {
    copilotContext = null;
    diagnosisNoteAdded = false;
    generatedDraft = '';
    document.getElementById('draft-area').classList.remove('active');
    showLoading('Loading customer context...');
    await loadTicketData();
    loadSlaData();
    fetchCopilotContext();
  });
});

// ── Load ticket metadata from ZAF ──

async function loadTicketData() {
  try {
    var ticketData = await client.get([
      'ticket.id', 'ticket.subject', 'ticket.status',
      'ticket.priority', 'ticket.type',
      'ticket.requester.email', 'ticket.requester.name',
      'ticket.via.channel', 'ticket.tags', 'ticket.description'
    ]);

    currentTicket = {
      ticketId: ticketData['ticket.id'],
      subject: ticketData['ticket.subject'],
      status: ticketData['ticket.status'],
      priority: ticketData['ticket.priority'],
      type: ticketData['ticket.type'],
      customerEmail: ticketData['ticket.requester.email'],
      customerName: ticketData['ticket.requester.name'],
      channel: ticketData['ticket.via.channel'],
      tags: ticketData['ticket.tags'] || [],
      description: ticketData['ticket.description'],
    };
  } catch (error) {
    console.error('Error loading ticket data:', error);
  }
}

// ── Fetch copilot context from server ──

async function fetchCopilotContext() {
  showLoading('Loading customer context...');

  try {
    var serverUrl = await getServerUrl();
    var response = await zafFetch(serverUrl + '/api/copilot/context', {
      method: 'POST',
      body: JSON.stringify({
        email: currentTicket.customerEmail,
        ticketId: currentTicket.ticketId,
      }),
    });

    if (!response.ok) throw new Error('Server error: ' + response.status);

    copilotContext = await response.json();
    renderAll(copilotContext);

    // Auto-add diagnosis note (skip if already added within 30 min)
    if (!diagnosisNoteAdded) {
      autoAddDiagnosisNote(copilotContext);
    }

  } catch (error) {
    console.error('Copilot context error:', error);
    hideLoading();
    document.getElementById('alerts-container').innerHTML =
      '<div class="error-card"><p>Failed to load customer context</p>' +
      '<p class="detail">' + escapeHtml(error.message) + '</p></div>';
  }
}

// ── Render all sections ──

function renderAll(ctx) {
  hideLoading();
  renderCustomerCard(ctx);
  renderAlerts(ctx.signals || []);
  renderContextAccordion(ctx);
  renderKbSuggestions(ctx.kbArticles || []);
}

// ── Customer Card ──

function renderCustomerCard(ctx) {
  var card = document.getElementById('customer-card');
  var c = ctx.customer || {};
  var touchCount = ctx.touchCount || 0;
  var touchClass = touchCount >= 4 ? 'badge-touch-4' : touchCount >= 3 ? 'badge-touch-3' : touchCount >= 2 ? 'badge-touch-2' : 'badge-touch-1';
  var sentimentClass = ctx.sentiment === 'positive' ? 'badge-sentiment-positive' : ctx.sentiment === 'negative' ? 'badge-sentiment-negative' : 'badge-sentiment-neutral';

  var channelNames = {
    'email': 'Email', 'web': 'Web', 'sunshine_conversations_api': 'Mochi',
    'sunshine_conversations_facebook_messenger': 'FB', 'instagram_dm': 'IG',
    'voice': 'Phone', 'chat': 'Chat', 'api': 'API'
  };
  var channelLabel = channelNames[ctx.ticket?.channel] || ctx.ticket?.channel || '';

  card.innerHTML =
    '<p class="customer-name">' + escapeHtml(c.name || 'Unknown Customer') + '</p>' +
    '<p class="customer-email">' + escapeHtml(c.email || '') + '</p>' +
    '<div class="customer-badges">' +
      '<span class="badge ' + touchClass + '">' + touchCount + ' touch' + (touchCount !== 1 ? 'es' : '') + '</span>' +
      (ctx.issueType && ctx.issueType !== 'general' ? '<span class="badge badge-issue">' + escapeHtml(ctx.issueType) + '</span>' : '') +
      (ctx.sentiment && ctx.sentiment !== 'unknown' ? '<span class="badge ' + sentimentClass + '">' + escapeHtml(ctx.sentiment) + '</span>' : '') +
      (channelLabel ? '<span class="badge badge-channel">' + escapeHtml(channelLabel) + '</span>' : '') +
    '</div>';
}

// ── Alerts ──

function renderAlerts(signals) {
  var container = document.getElementById('alerts-container');
  if (!signals || signals.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = '<div class="section-header">Alerts</div>' +
    signals.slice(0, 3).map(function(sig) {
      var severityClass = sig.severity === 'CRITICAL' ? 'critical' : sig.severity === 'HIGH' ? 'high' : 'medium';

      // Find matching action
      var action = (copilotContext?.actions || []).find(function(a) {
        return (sig.id === 'SIG-002' && a.id === 'resend_esim') ||
               (sig.id === 'SIG-001' && a.id === 'resend_esim') ||
               (sig.id === 'SIG-005' && a.id === 'retry_port_in') ||
               (sig.id === 'SIG-004' && a.id === 'retry_port_in');
      });

      var actionBtn = action
        ? '<button class="alert-action-btn" onclick="executeAction(\'' + action.id + '\', ' + escapeHtml(JSON.stringify(action.params || {})) + ')">' + escapeHtml(action.label) + '</button>'
        : '';

      return '<div class="alert-card ' + severityClass + '">' +
        '<div class="alert-header">' +
          '<span class="alert-severity">' + sig.severity + '</span>' +
          '<span class="alert-label">' + escapeHtml(sig.label) + '</span>' +
        '</div>' +
        '<div class="alert-detail">' + escapeHtml(sig.detail || '') + '</div>' +
        actionBtn +
      '</div>';
    }).join('');
}

// ── Context Accordion ──

function renderContextAccordion(ctx) {
  var container = document.getElementById('context-accordion');
  var rows = [];
  var order = ctx.order || {};

  // Order Status
  var orderStatus = order.status || 'N/A';
  var orderDot = /completed/i.test(orderStatus) ? 'dot-green' : /error|failed|cancelled/i.test(orderStatus) ? 'dot-red' : 'dot-amber';
  rows.push(buildAccordionRow('Order Status', orderStatus, orderDot,
    '<strong>Order ID:</strong> ' + escapeHtml(order.id || 'N/A') + '<br>' +
    '<strong>Status:</strong> ' + escapeHtml(orderStatus) +
    (ctx.rca ? '<br><strong>RCA:</strong> ' + escapeHtml(JSON.stringify(ctx.rca).substring(0, 200)) : '')
  ));

  // eSIM Status
  var esimStatus = order.esimStatus || 'N/A';
  var esimDot = /active|installed/i.test(esimStatus) ? 'dot-green' : /error|failed/i.test(esimStatus) ? 'dot-red' : /pending/i.test(esimStatus) ? 'dot-amber' : 'dot-gray';
  rows.push(buildAccordionRow('eSIM Status', esimStatus, esimDot,
    '<strong>eSIM Profile:</strong> ' + escapeHtml(esimStatus)
  ));

  // Port-In Status
  var portStatus = order.portinStatus || 'N/A';
  var portDot = /completed|active/i.test(portStatus) ? 'dot-green' : /conflict|failed|rejected/i.test(portStatus) ? 'dot-red' : /pending|submitted/i.test(portStatus) ? 'dot-amber' : 'dot-gray';
  var portDetail = '<strong>Status:</strong> ' + escapeHtml(portStatus);
  if (order.portinConflict && order.portinConflict.code) {
    portDetail += '<br><strong>Conflict ' + escapeHtml(order.portinConflict.code) + ':</strong> ' + escapeHtml(order.portinConflict.reason) +
      '<br><strong>Action:</strong> ' + escapeHtml(order.portinConflict.action);
  }
  rows.push(buildAccordionRow('Port-In', portStatus, portDot, portDetail));

  // Payment
  var paymentLabel = order.payments && order.payments.length > 0
    ? 'Paid $' + (order.payments[0].amount || '?')
    : (order.paymentStatus || 'N/A');
  var paymentDot = order.payments && order.payments.length > 0 ? 'dot-green' : 'dot-gray';
  rows.push(buildAccordionRow('Payment', paymentLabel, paymentDot,
    order.payments && order.payments.length > 0
      ? order.payments.slice(0, 3).map(function(p) { return escapeHtml(p.status || 'N/A') + ' - $' + escapeHtml(String(p.amount || '?')); }).join('<br>')
      : 'No payment data available'
  ));

  // Tickets
  var th = ctx.ticketHistory || {};
  rows.push(buildAccordionRow('Tickets', th.open + ' open / ' + th.total + ' total', th.open > 0 ? 'dot-amber' : 'dot-green',
    (th.tickets || []).map(function(t) {
      return '#' + t.id + ' ' + escapeHtml(t.subject || '') + ' <em>(' + t.status + ')</em>';
    }).join('<br>') || 'No open tickets'
  ));

  container.innerHTML = '<div class="section-header">Context</div>' + rows.join('');
}

function buildAccordionRow(label, value, dotClass, bodyHtml) {
  return '<div class="accordion-row" onclick="toggleAccordion(this)">' +
    '<div class="accordion-header">' +
      '<span class="accordion-label">' + escapeHtml(label) + '</span>' +
      '<span class="accordion-value"><span class="status-dot ' + dotClass + '"></span> ' + escapeHtml(value) + ' <span class="accordion-chevron">&#x25B6;</span></span>' +
    '</div>' +
    '<div class="accordion-body">' + bodyHtml + '</div>' +
  '</div>';
}

function toggleAccordion(el) {
  el.classList.toggle('open');
}

// ── KB Suggestions ──

function renderKbSuggestions(articles) {
  var container = document.getElementById('kb-container');
  if (!articles || articles.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = '<div class="section-header">KB Articles</div>' +
    articles.map(function(a) {
      var url = a.url || '#';
      return '<a class="kb-link" href="' + escapeHtml(url) + '" target="_blank">' +
        escapeHtml(a.title) +
        (a.snippet ? '<div class="kb-snippet">' + escapeHtml(a.snippet.substring(0, 80)) + '</div>' : '') +
      '</a>';
    }).join('');
}

// ── Action Execution ──

async function executeAction(actionId, params) {
  if (!confirm('Execute: ' + actionId + '?')) return;

  showNotification('Executing action...');

  try {
    var serverUrl = await getServerUrl();
    var response = await zafFetch(serverUrl + '/api/actions', {
      method: 'POST',
      body: JSON.stringify({
        action: actionId,
        params: params,
        customerId: copilotContext?.customer?.customerId,
      }),
    });

    var result = await response.json();

    if (result.success) {
      showNotification('Action completed');

      // Auto-add internal note
      var noteText = '[CS Copilot] Action: ' + actionId + '\n' +
        'Time: ' + new Date().toISOString() + '\n' +
        'Result: Success\n' +
        'Params: ' + JSON.stringify(params);
      await addInternalNote(noteText);

      // Refresh context
      fetchCopilotContext();
    } else {
      showNotification('Action failed: ' + (result.error || 'Unknown error'), 'error');
    }
  } catch (error) {
    console.error('Action error:', error);
    showNotification('Action failed: ' + error.message, 'error');
  }
}

// ── Draft Generation ──

async function generateDraft() {
  if (!copilotContext) {
    showNotification('Context not loaded yet', 'error');
    return;
  }

  document.getElementById('draft-btn').disabled = true;
  showNotification('Generating draft...');

  try {
    var serverUrl = await getServerUrl();
    var response = await zafFetch(serverUrl + '/api/copilot/generate', {
      method: 'POST',
      body: JSON.stringify({
        context: copilotContext,
        channel: currentTicket.channel,
        ticketId: currentTicket.ticketId,
      }),
    });

    if (!response.ok) throw new Error('Server error: ' + response.status);

    var data = await response.json();
    generatedDraft = data.draft || '';

    // Show draft
    var draftArea = document.getElementById('draft-area');
    var draftBody = document.getElementById('draft-body');
    var toneBadge = document.getElementById('draft-tone-badge');
    draftBody.textContent = generatedDraft;
    toneBadge.textContent = (copilotContext.toneGuide?.tone || 'helpful');
    draftArea.classList.add('active');

    // Auto-add internal note with diagnosis
    if (data.internalNote) {
      await addInternalNote(data.internalNote);
    }

    showNotification('Draft ready');
  } catch (error) {
    console.error('Draft error:', error);
    showNotification('Draft generation failed: ' + error.message, 'error');
  }

  document.getElementById('draft-btn').disabled = false;
}

// ── Insert draft into Zendesk reply editor ──

async function insertDraft() {
  if (!generatedDraft) return;
  try {
    await client.invoke('ticket.editor.insert', generatedDraft);
    showNotification('Inserted into reply');
  } catch (error) {
    console.error('Insert failed:', error);
    showNotification('Insert failed. Please copy instead.', 'error');
  }
}

// ── Copy draft ──

function copyDraft() {
  if (!generatedDraft) return;
  navigator.clipboard.writeText(generatedDraft).then(function() {
    var btn = document.getElementById('copy-btn');
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(function() {
      btn.textContent = 'Copy';
      btn.classList.remove('copied');
    }, 2000);
  }).catch(function(err) {
    console.error('Copy failed:', err);
    showNotification('Copy failed', 'error');
  });
}

// ── Internal Note ──

async function addInternalNote(text) {
  try {
    await client.request({
      url: '/api/v2/tickets/' + currentTicket.ticketId + '.json',
      type: 'PUT',
      contentType: 'application/json',
      data: JSON.stringify({
        ticket: { comment: { body: text, public: false } }
      }),
    });
  } catch (error) {
    console.error('Internal note error:', error);
  }
}

// ── Auto-diagnosis note ──

async function autoAddDiagnosisNote(ctx) {
  if (diagnosisNoteAdded || !ctx || !currentTicket.ticketId) return;
  diagnosisNoteAdded = true;

  var signals = (ctx.signals || []).map(function(s) { return s.id + ' ' + s.severity; }).join(', ') || 'None';
  var actions = (ctx.actions || []).map(function(a) { return a.label; }).join(', ') || 'None';

  var note = '[CS Copilot] Auto-diagnosis:\n' +
    '- Issue: ' + (ctx.issueType || 'general') + '\n' +
    '- Touch count: ' + (ctx.touchCount || 0) + (ctx.touchCount >= 3 ? ' (frustrated)' : '') + '\n' +
    '- Signals: ' + signals + '\n' +
    '- Suggested: ' + actions + '\n' +
    '- Order: ' + (ctx.order?.status || 'N/A') + '\n' +
    '- eSIM: ' + (ctx.order?.esimStatus || 'N/A') + '\n' +
    '- Port-In: ' + (ctx.order?.portinStatus || 'N/A');

  await addInternalNote(note);
}

// ── Manual diagnosis note button ──

async function addDiagnosisNote() {
  if (!copilotContext) {
    showNotification('Context not loaded yet', 'error');
    return;
  }
  diagnosisNoteAdded = false;
  await autoAddDiagnosisNote(copilotContext);
  showNotification('Diagnosis note added');
}

// ── Refresh ──

function refreshContext() {
  copilotContext = null;
  diagnosisNoteAdded = false;
  document.getElementById('draft-area').classList.remove('active');
  showLoading('Refreshing...');
  fetchCopilotContext();
}

// ── Helpers ──

function escapeHtml(text) {
  if (!text) return '';
  var div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

function showLoading(message) {
  var el = document.getElementById('loading');
  el.classList.add('active');
  el.querySelector('.loading-text').textContent = message || 'Loading...';
}

function hideLoading() {
  document.getElementById('loading').classList.remove('active');
}

function showNotification(message, type) {
  var n = document.createElement('div');
  n.className = 'notification';
  n.style.background = type === 'error' ? '#e35b66' : '#038153';
  n.textContent = message;
  document.body.appendChild(n);
  setTimeout(function() { n.remove(); }, 2500);
}

function formatChannel(channel) {
  var names = {
    'email': 'Email', 'web': 'Web Form', 'sunshine_conversations_api': 'Mochi Chat',
    'voice': 'Phone', 'chat': 'Live Chat', 'api': 'API'
  };
  return names[channel] || channel;
}

// ═══════════════════════════════════════════════
// SLA Engine (preserved from v1, compact rendering)
// ═══════════════════════════════════════════════

var SLA_TARGETS = {
  L0: {
    urgent: { firstResponse: 30, nextResponse: 240, resolution: 60 },
    high:   { firstResponse: 30, nextResponse: 480, resolution: 60 },
    normal: { firstResponse: 60, nextResponse: 720, resolution: 120 },
    low:    { firstResponse: 60, nextResponse: 1440, resolution: 120 }
  },
  L1: {
    urgent: { firstResponse: 60, nextResponse: 240, resolution: 240, internalHandoff: 120 },
    high:   { firstResponse: 60, nextResponse: 480, resolution: 240, internalHandoff: 240 },
    normal: { firstResponse: 60, nextResponse: 720, resolution: 240, internalHandoff: 480 },
    low:    { firstResponse: 60, nextResponse: 1440, resolution: 240, internalHandoff: 1440 }
  },
  L2: null,
  L3: null,
  partner: {
    connectx: {
      urgent: { partnerResponse: 15, resolution: 60 },
      high:   { partnerResponse: 30, resolution: 240 },
      normal: { partnerResponse: 240, resolution: 4320 },
      low:    { partnerResponse: 480, resolution: null }
    },
    airvet: { weekday: { resolution: 1440 }, weekend: { resolution: 2880 } },
    att: {
      urgent: { partnerResponse: null, resolution: null },
      high:   { partnerResponse: null, resolution: null },
      normal: { partnerResponse: null, resolution: null },
      low:    { partnerResponse: null, resolution: null }
    }
  }
};

var GROUP_TIER_KEYWORDS = {
  'l0': 'L0', 'tier 0': 'L0', 'tier0': 'L0', 'level 0': 'L0',
  'l1': 'L1', 'tier 1': 'L1', 'tier1': 'L1', 'level 1': 'L1',
  'l2': 'L2', 'tier 2': 'L2', 'tier2': 'L2', 'level 2': 'L2',
  'l3': 'L3', 'tier 3': 'L3', 'tier3': 'L3', 'level 3': 'L3', 'engineering': 'L3'
};

var PARTNER_NAMES = { att: 'AT&T', connectx: 'ConnectX', airvet: 'Airvet' };

function detectTier(groupName) {
  if (!groupName) return 'L0';
  var lower = groupName.toLowerCase();
  var keys = Object.keys(GROUP_TIER_KEYWORDS);
  for (var i = 0; i < keys.length; i++) {
    if (lower.indexOf(keys[i]) !== -1) return GROUP_TIER_KEYWORDS[keys[i]];
  }
  return 'L0';
}

function getSlaTargets(tier, priority, groupName) {
  if (!groupName) return SLA_TARGETS.L0.high;
  var p = (priority || 'normal').toLowerCase();
  var t = SLA_TARGETS[tier] || SLA_TARGETS.L1 || SLA_TARGETS.L0;
  return t[p] || t.normal;
}

function getPartnerTargets(partner, priority) {
  var cfg = SLA_TARGETS.partner[partner];
  if (!cfg) return null;
  if (cfg.weekday || cfg.weekend) {
    var day = new Date().getDay();
    return (day === 0 || day === 6) ? cfg.weekend : cfg.weekday;
  }
  var p = (priority || 'normal').toLowerCase();
  return cfg[p] || cfg.normal || null;
}

function formatDuration(ms) {
  var totalSec = Math.floor(Math.abs(ms) / 1000);
  var d = Math.floor(totalSec / 86400);
  var h = Math.floor((totalSec % 86400) / 3600);
  var m = Math.floor((totalSec % 3600) / 60);
  var s = totalSec % 60;
  if (d > 0) return d + 'd ' + h + 'h ' + m + 'm';
  if (h > 0) return h + 'h ' + m + 'm ' + s + 's';
  return m + 'm ' + s + 's';
}

function slaPct(elapsedMs, targetMs) {
  if (targetMs <= 0) return 100;
  return Math.min((elapsedMs / targetMs) * 100, 100);
}

function slaStatus(elapsedMs, targetMs) {
  if (elapsedMs >= targetMs) return 'breached';
  var p = slaPct(elapsedMs, targetMs);
  if (p > 85) return 'red';
  if (p > 60) return 'amber';
  return 'green';
}

function slaTimeText(m) {
  if (m.immediate) return 'IMMEDIATE';
  if (m.met) {
    var dur = m.elapsedMs > 0 ? formatDuration(m.elapsedMs) : '';
    if (m.label === '1st Response') {
      var within = m.targetMs > 0 && m.elapsedMs <= m.targetMs;
      return (within ? 'Responded' : 'Late') + (dur ? ' (' + dur + ')' : '');
    }
    return 'Met' + (dur ? ' (' + dur + ')' : '');
  }
  if (m.elapsedMs >= m.targetMs) return 'BREACHED ' + formatDuration(m.elapsedMs - m.targetMs) + ' ago';
  return formatDuration(m.targetMs - m.elapsedMs) + ' left';
}

function computeNextResponse(comments, requesterId) {
  var lastCustomerMsg = null;
  var agentRepliedAfter = false;
  for (var i = comments.length - 1; i >= 0; i--) {
    var c = comments[i];
    var isCustomer = c.author ? (c.author.role === 'end-user' || c.author.role === 'end_user') : (c.author_id === requesterId);
    var isPublic = c.public !== false;
    if (!isPublic) continue;
    if (!lastCustomerMsg && isCustomer) { lastCustomerMsg = c; agentRepliedAfter = false; }
    else if (lastCustomerMsg && !isCustomer) { agentRepliedAfter = true; break; }
  }
  if (!lastCustomerMsg) return null;
  if (agentRepliedAfter) return { met: true };
  return { met: false, since: new Date(lastCustomerMsg.created_at).getTime() };
}

async function findPartnerFieldId() {
  try {
    var data = await client.request({ url: '/api/v2/ticket_fields.json?page[size]=100', type: 'GET', dataType: 'json' });
    var fields = data.ticket_fields || [];
    for (var i = 0; i < fields.length; i++) {
      var title = (fields[i].title || '').toLowerCase();
      if (title.indexOf('partner') !== -1 && title.indexOf('escalat') !== -1) return fields[i].id;
      if (title === 'partner escalation') return fields[i].id;
    }
  } catch (e) {}
  return null;
}

async function findEscalationTimestamp(ticketId) {
  try {
    var data = await client.request({ url: '/api/v2/tickets/' + ticketId + '/audits.json?page[size]=100', type: 'GET', dataType: 'json' });
    var audits = data.audits || [];
    for (var i = audits.length - 1; i >= 0; i--) {
      var events = audits[i].events || [];
      for (var j = 0; j < events.length; j++) {
        if (events[j].field_name === 'group_id' && events[j].previous_value) {
          return new Date(audits[i].created_at).getTime();
        }
      }
    }
  } catch (e) {}
  return null;
}

async function loadSlaData() {
  var ticketId = currentTicket.ticketId;
  if (!ticketId) return;

  try {
    var partnerFieldId = await findPartnerFieldId();

    var results = await Promise.all([
      client.request({ url: '/api/v2/tickets/' + ticketId + '.json', type: 'GET', dataType: 'json' }),
      client.request({ url: '/api/v2/tickets/' + ticketId + '/metrics.json', type: 'GET', dataType: 'json' }),
      client.request({ url: '/api/v2/tickets/' + ticketId + '/comments.json?sort_order=asc', type: 'GET', dataType: 'json' })
    ]);

    var ticket = results[0].ticket;
    var metrics = results[1].ticket_metric;
    var comments = results[2].comments || [];

    var groupName = '';
    if (ticket.group_id) {
      try {
        var gData = await client.request({ url: '/api/v2/groups/' + ticket.group_id + '.json', type: 'GET', dataType: 'json' });
        groupName = gData.group.name || '';
      } catch (e) {}
    }
    var tier = detectTier(groupName);

    var partner = null;
    if (partnerFieldId && ticket.custom_fields) {
      for (var fi = 0; fi < ticket.custom_fields.length; fi++) {
        var cf = ticket.custom_fields[fi];
        if (cf.id === partnerFieldId && cf.value) { partner = cf.value.toLowerCase(); break; }
      }
    }
    var partnerName = partner ? (PARTNER_NAMES[partner] || partner) : null;

    var path, pathClass;
    var isSolved = ticket.status === 'solved' || ticket.status === 'closed';
    if (isSolved) { path = 'Solved'; pathClass = 'sla-badge-green'; }
    else if (partner) { path = 'Partner \u2192 ' + partnerName; pathClass = 'sla-badge-purple'; }
    else if (tier !== 'L0') { path = 'Escalated \u2192 ' + tier; pathClass = 'sla-badge-orange'; }
    else { path = 'L0 Direct'; pathClass = 'sla-badge-blue'; }

    // Header gradient
    var header = document.getElementById('app-header');
    if (isSolved) header.style.background = 'linear-gradient(135deg, #038153, #025a3a)';
    else if (partner) header.style.background = 'linear-gradient(135deg, #6a27b8, #4a1a80)';
    else if (tier !== 'L0') header.style.background = 'linear-gradient(135deg, #c96400, #8f4700)';
    else header.style.background = 'linear-gradient(135deg, #1f73b7, #144a75)';

    var priority = ticket.priority || 'normal';
    var targets = getSlaTargets(tier, priority, groupName);
    var now = Date.now();
    var createdAt = new Date(ticket.created_at).getTime();

    var slaMetrics = [];

    // 1st Response
    var frTarget = (targets.firstResponse || 60) * 60000;
    var firstAgentReplyAt = null;
    for (var ci = 0; ci < comments.length; ci++) {
      var c = comments[ci];
      var isAgent = c.author ? (c.author.role !== 'end-user' && c.author.role !== 'end_user') : (c.author_id !== ticket.requester_id);
      if (isAgent && c.public !== false) { firstAgentReplyAt = new Date(c.created_at).getTime(); break; }
    }
    if (firstAgentReplyAt) {
      slaMetrics.push({ label: '1st Response', targetMs: frTarget, elapsedMs: firstAgentReplyAt - createdAt, breachAt: null, met: true });
    } else {
      var replyMetric = metrics ? metrics.reply_time_in_minutes : null;
      var replySrc = replyMetric ? (replyMetric.business || replyMetric.calendar) : null;
      if (replySrc && replySrc.breach_at) {
        var ba = new Date(replySrc.breach_at).getTime();
        slaMetrics.push({ label: '1st Response', targetMs: frTarget, elapsedMs: Math.max(frTarget - Math.max(ba - now, 0), 0), breachAt: ba, met: false });
      } else {
        slaMetrics.push({ label: '1st Response', targetMs: frTarget, elapsedMs: now - createdAt, breachAt: createdAt + frTarget, met: false });
      }
    }

    // Next Response
    var frMetric = slaMetrics[0];
    var frBreached = frMetric && !frMetric.met && (frMetric.elapsedMs >= frMetric.targetMs || (frMetric.targetMs > 0 && frMetric.elapsedMs / frMetric.targetMs >= 0.995));
    var nextResp = computeNextResponse(comments, ticket.requester_id);
    var nrTarget = (targets.nextResponse || 720) * 60000;
    if (frBreached && (!nextResp || !nextResp.met)) {
      slaMetrics.push({ label: 'Next Response', targetMs: 0, elapsedMs: 1, breachAt: now, met: false, immediate: true });
    } else if (nextResp) {
      if (nextResp.met) slaMetrics.push({ label: 'Next Response', targetMs: nrTarget, elapsedMs: 0, breachAt: null, met: true });
      else { var nrEl = now - nextResp.since; slaMetrics.push({ label: 'Next Response', targetMs: nrTarget, elapsedMs: nrEl, breachAt: nextResp.since + nrTarget, met: false }); }
    }

    // Resolution
    var resMetric = metrics ? metrics.full_resolution_time_in_minutes : null;
    var resTarget = (targets.resolution || 2880) * 60000;
    if (resMetric) {
      var resSrc = resMetric.business || resMetric.calendar;
      if (resSrc && resSrc.breach_at) {
        var rba = new Date(resSrc.breach_at).getTime();
        slaMetrics.push({ label: 'Resolution', targetMs: resTarget, elapsedMs: Math.max(resTarget - Math.max(rba - now, 0), 0), breachAt: rba, met: false });
      } else if (resSrc && resSrc.elapsed !== undefined) {
        slaMetrics.push({ label: 'Resolution', targetMs: resTarget, elapsedMs: resSrc.elapsed * 60000, breachAt: null, met: isSolved });
      }
    }
    if (!slaMetrics.find(function(m) { return m.label === 'Resolution'; })) {
      slaMetrics.push({ label: 'Resolution', targetMs: resTarget, elapsedMs: now - createdAt, breachAt: createdAt + resTarget, met: isSolved });
    }

    // Internal Handoff (L1+)
    if (tier !== 'L0' && targets.internalHandoff) {
      var escTs = await findEscalationTimestamp(ticketId);
      if (escTs) {
        var ihTarget = targets.internalHandoff * 60000;
        var ihElapsed = now - escTs;
        var repliedAfterEsc = false;
        for (var ci2 = 0; ci2 < comments.length; ci2++) {
          var ct = new Date(comments[ci2].created_at).getTime();
          var isA = comments[ci2].author_id !== ticket.requester_id;
          if (ct > escTs && isA && comments[ci2].public !== false) { repliedAfterEsc = true; ihElapsed = ct - escTs; break; }
        }
        slaMetrics.push({ label: tier + ' Handoff', targetMs: ihTarget, elapsedMs: ihElapsed, breachAt: repliedAfterEsc ? null : escTs + ihTarget, met: repliedAfterEsc });
      }
    }

    // Partner SLAs
    if (partner && SLA_TARGETS.partner[partner]) {
      var pTargets = getPartnerTargets(partner, priority);
      var pStart = await findEscalationTimestamp(ticketId) || createdAt;
      var pElapsed = now - pStart;
      if (pTargets && pTargets.partnerResponse) {
        var prT = pTargets.partnerResponse * 60000;
        slaMetrics.push({ label: partnerName + ' Response', targetMs: prT, elapsedMs: pElapsed, breachAt: pStart + prT, met: false });
      }
      if (pTargets && pTargets.resolution) {
        var prR = pTargets.resolution * 60000;
        slaMetrics.push({ label: partnerName + ' Resolve', targetMs: prR, elapsedMs: pElapsed, breachAt: pStart + prR, met: isSolved });
      }
      if (pTargets && !pTargets.partnerResponse && !pTargets.resolution) {
        slaMetrics.push({ label: partnerName + ' SLA', targetMs: 0, elapsedMs: 0, breachAt: null, met: false, placeholder: true });
      }
    }

    renderSlaSection(slaMetrics, groupName || 'Unassigned', path, pathClass, tier, priority, isSolved);

    // Live countdown
    if (slaTimerInterval) clearInterval(slaTimerInterval);
    slaTimerInterval = setInterval(function() {
      var n = Date.now();
      slaMetrics.forEach(function(m) {
        if (m.met || m.immediate || !m.breachAt) return;
        m.elapsedMs = m.targetMs - Math.max(m.breachAt - n, 0);
        if (m.elapsedMs > m.targetMs) m.elapsedMs = n - (m.breachAt - m.targetMs);
      });
      var fr = slaMetrics[0];
      if (fr && !fr.met && fr.elapsedMs >= fr.targetMs) {
        var nr = slaMetrics.find(function(m) { return m.label === 'Next Response'; });
        if (nr && !nr.met && !nr.immediate) { nr.immediate = true; nr.targetMs = 0; nr.elapsedMs = 1; nr.breachAt = n; }
      }
      updateSlaBars(slaMetrics);
    }, 1000);

  } catch (err) {
    console.error('SLA load error:', err);
    document.getElementById('sla-content').innerHTML = '<div class="sla-no-policy">Unable to load SLA data</div>';
  }
}

function renderSlaSection(metrics, groupName, path, pathClass, tier, priority, isSolved) {
  var container = document.getElementById('sla-content');
  var html = '';
  html += '<div class="sla-group-line">Assigned to: <strong>' + escapeHtml(groupName) + '</strong></div>';
  html += '<div class="sla-badges">' +
    '<span class="sla-badge ' + pathClass + '">' + path + '</span>' +
    '<span class="sla-badge sla-badge-gray">' + (priority || 'normal').toUpperCase() + '</span>' +
    '<span class="sla-badge sla-badge-gray">SLA: ' + (tier === 'L0' ? '30m' : '1h') + '</span>' +
    (isSolved ? '<span class="sla-badge sla-badge-green">SOLVED</span>' : '') +
  '</div>';

  var coreLabels = { '1st Response': 1, 'Next Response': 1, 'Resolution': 1 };
  var coreDone = false;

  metrics.forEach(function(m) {
    if (!coreLabels[m.label] && !coreDone) { html += '<div class="sla-divider"></div>'; coreDone = true; }
    if (m.placeholder) {
      html += '<div class="sla-metric" data-label="' + m.label + '"><div class="sla-metric-header">' +
        '<span class="sla-metric-label">' + m.label + '</span>' +
        '<span class="sla-metric-time" style="color:#87929d">Not configured</span></div></div>';
      return;
    }
    var metBreached = m.met && m.label === '1st Response' && m.targetMs > 0 && m.elapsedMs > m.targetMs;
    var st = m.immediate ? 'breached' : (metBreached ? 'breached' : (m.met ? 'met' : slaStatus(m.elapsedMs, m.targetMs)));
    var p = m.immediate ? 100 : (m.met ? 100 : slaPct(m.elapsedMs, m.targetMs));
    var statusLabel = '';
    if (m.label === '1st Response' && m.met) {
      statusLabel = (m.targetMs > 0 && m.elapsedMs <= m.targetMs)
        ? ' <span class="sla-status-tag sla-tag-healthy">WITHIN SLA</span>'
        : ' <span class="sla-status-tag sla-tag-breached">BREACHED</span>';
    } else if (m.label === 'Resolution' && !m.met) {
      if (m.elapsedMs >= m.targetMs) statusLabel = ' <span class="sla-status-tag sla-tag-breached">BREACHED</span>';
      else if (slaPct(m.elapsedMs, m.targetMs) > 75) statusLabel = ' <span class="sla-status-tag sla-tag-nearing">NEARING</span>';
      else statusLabel = ' <span class="sla-status-tag sla-tag-healthy">HEALTHY</span>';
    }
    html += '<div class="sla-metric sla-status-' + st + '" data-label="' + m.label + '">' +
      '<div class="sla-metric-header">' +
        '<span class="sla-metric-label">' + m.label + statusLabel + '</span>' +
        '<span class="sla-metric-time">' + slaTimeText(m) + '</span>' +
      '</div>' +
      '<div class="sla-bar-bg"><div class="sla-bar-fill" style="width:' + p + '%"></div></div>' +
    '</div>';
  });

  container.innerHTML = html;
}

function updateSlaBars(metrics) {
  metrics.forEach(function(m) {
    if (m.placeholder) return;
    var el = document.querySelector('.sla-metric[data-label="' + m.label + '"]');
    if (!el) return;
    var metBreached = m.met && m.label === '1st Response' && m.targetMs > 0 && m.elapsedMs > m.targetMs;
    var st = m.immediate ? 'breached' : (metBreached ? 'breached' : (m.met ? 'met' : slaStatus(m.elapsedMs, m.targetMs)));
    el.className = 'sla-metric sla-status-' + st;
    el.querySelector('.sla-metric-time').textContent = slaTimeText(m);
    el.querySelector('.sla-bar-fill').style.width = (m.immediate ? 100 : (m.met ? 100 : slaPct(m.elapsedMs, m.targetMs))) + '%';
    if (m.label === '1st Response' && m.met) {
      var frLabelEl = el.querySelector('.sla-metric-label');
      frLabelEl.innerHTML = '1st Response' + ((m.targetMs > 0 && m.elapsedMs <= m.targetMs)
        ? ' <span class="sla-status-tag sla-tag-healthy">WITHIN SLA</span>'
        : ' <span class="sla-status-tag sla-tag-breached">BREACHED</span>');
    }
    if (m.label === 'Resolution') {
      var labelEl = el.querySelector('.sla-metric-label');
      var tag = '';
      if (!m.met) {
        if (m.elapsedMs >= m.targetMs) tag = ' <span class="sla-status-tag sla-tag-breached">BREACHED</span>';
        else if (slaPct(m.elapsedMs, m.targetMs) > 75) tag = ' <span class="sla-status-tag sla-tag-nearing">NEARING</span>';
        else tag = ' <span class="sla-status-tag sla-tag-healthy">HEALTHY</span>';
      }
      labelEl.innerHTML = 'Resolution' + tag;
    }
  });
}
