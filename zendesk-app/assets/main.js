/**
 * Zendesk Sidebar App - CS Copilot
 *
 * Two main functions:
 * 1. Analyze Ticket - Read conversation, perform diagnostic actions, provide context
 * 2. Generate Response - Draft response AFTER actions are done (including interim responses if waiting)
 */

// Configuration - Update this to your server URL
const SERVER_URL = 'http://localhost:3000';

// ZAF Client
var client;
var currentTicket = {};
var ticketComments = [];
var analysisResult = null;
var actionsPerformed = [];
var pendingActions = [];
var generatedResponseText = '';
var slaTimerInterval = null;

// Initialize app when Zendesk is ready
document.addEventListener('DOMContentLoaded', async function() {
  client = ZAFClient.init();
  client.invoke('resize', { width: '100%', height: '600px' });

  // Load ticket data
  await loadTicketData();

  // Load SLA data
  loadSlaData();
});

/**
 * Load all ticket data from Zendesk
 */
async function loadTicketData() {
  try {
    // Get ticket metadata
    var ticketData = await client.get([
      'ticket.id',
      'ticket.subject',
      'ticket.status',
      'ticket.priority',
      'ticket.type',
      'ticket.requester.email',
      'ticket.requester.name',
      'ticket.via.channel',
      'ticket.tags',
      'ticket.description'
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
      description: ticketData['ticket.description']
    };

    // Get all comments/conversation
    var commentsData = await client.get('ticket.comments');
    ticketComments = commentsData['ticket.comments'] || [];

  } catch (error) {
    console.error('Error loading ticket data:', error);
    showNotification('Failed to load ticket data', 'error');
  }
}

/**
 * Format channel name for display
 */
function formatChannel(channel) {
  var channelNames = {
    'email': 'Email',
    'web': 'Web Form',
    'sunshine_conversations_api': 'Mochi Chat',
    'sunshine_conversations_facebook_messenger': 'Facebook Messenger',
    'instagram_dm': 'Instagram DM',
    'voice': 'Phone',
    'chat': 'Live Chat',
    'api': 'API'
  };
  return channelNames[channel] || channel;
}

/**
 * Build conversation text from comments
 */
function buildConversationText() {
  if (!ticketComments || ticketComments.length === 0) {
    return currentTicket.description || 'No conversation available';
  }

  return ticketComments.map(function(comment) {
    var author = comment.author ? comment.author.name : 'Unknown';
    var role = (comment.author && (comment.author.role === 'agent' || comment.author.role === 'admin')) ? 'Agent' : 'Customer';
    var timestamp = new Date(comment.created_at).toLocaleString();
    var body = comment.value || comment.body || '';

    return '[' + timestamp + '] ' + role + ' (' + author + '):\n' + body;
  }).join('\n\n---\n\n');
}

/**
 * BUTTON 1: Analyze Ticket
 * Reads conversation, PERFORMS ACTIONS (diagnostic API calls), and provides context
 */
async function analyzeTicket() {
  showLoading('Reading ticket and performing diagnostics...');
  disableButtons();

  var conversationText = buildConversationText();

  var prompt = `You are a CS agent assistant for Meow Mobile. Analyze this ticket and PERFORM ALL NECESSARY DIAGNOSTIC ACTIONS.

## Ticket Information
- **Ticket ID:** ${currentTicket.ticketId}
- **Subject:** ${currentTicket.subject}
- **Customer:** ${currentTicket.customerName} (${currentTicket.customerEmail})
- **Channel:** ${formatChannel(currentTicket.channel)}
- **Status:** ${currentTicket.status}
- **Tags:** ${currentTicket.tags.join(', ') || 'None'}

## Conversation:
${conversationText}

---

## YOUR TASK - DO THESE IN ORDER:

### STEP 1: Identify Issue Type
Determine what the customer's issue is and classify it.

### STEP 2: PERFORM DIAGNOSTIC ACTIONS
You MUST call the relevant tools to get real data:

**For ALL tickets:**
- Call get_customer_by_email to get customer account status

**Based on issue type, also call:**
- eSIM issues → get_esim_status (check provisioning state)
- Payment issues → get_payment_status (check payment history)
- Port-In issues → get_portin_status (check port request)
- Network issues → get_network_outages (check for outages in customer's area)
- Order issues → get_orders_by_email (check order status)

### STEP 3: Based on results, determine ACTIONS NEEDED
After getting the data, determine what actions are required:

**Possible actions:**
- send_esim_instructions - If customer needs help installing eSIM
- trigger_sim_swap - If eSIM needs to be reprovisioned (CONFIRM FIRST)
- Process refund - If duplicate charge or eligible for refund
- Escalate to L2 - If issue requires backend intervention
- Escalate to Carrier - If port-in stuck or carrier issue
- Wait for process - If something is in progress (port-in, provisioning)

### STEP 4: Provide Analysis Summary

Format your response as:

## Issue Summary
[2-3 sentences about the problem]

## Customer Data Retrieved
| Data Point | Value | Status |
|------------|-------|--------|
| Account Status | [value] | [OK/Issue] |
| eSIM Status | [value] | [OK/Issue] |
| Payment Status | [value] | [OK/Issue] |
| etc. | | |

## Diagnosis
[What's actually wrong based on the data]

## Actions Performed
- [Action 1] - [Result]
- [Action 2] - [Result]

## Actions Still Needed
- [ ] [Action requiring agent confirmation]
- [ ] [Action requiring customer info]

## Waiting Period (if any)
[If something is in progress, note the expected wait time]

## Customer Sentiment
[Frustrated/Neutral/Satisfied] - [brief note]

## Ready for Response
[Yes - can send final resolution / No - need interim update / Need more info from customer]

BE THOROUGH. Call all relevant tools. The agent needs complete information.`;

  try {
    var response = await callServer(prompt, 'analyze');

    analysisResult = response;
    displayAnalysis(response);

  } catch (error) {
    console.error('Analysis error:', error);
    displayError('Failed to analyze ticket. Please try again.');
  }

  hideLoading();
  enableButtons();
}

/**
 * BUTTON 2: Generate Response
 * Creates response AFTER actions are done - handles both final and interim responses
 */
async function generateResponse() {
  showLoading('Generating response based on completed actions...');
  disableButtons();

  var conversationText = buildConversationText();
  var channelType = currentTicket.channel;
  var isEmail = channelType === 'email' || channelType === 'web';

  // Analysis is required before generating response
  if (!analysisResult) {
    displayError('Please click "Analyze Ticket" first to perform diagnostic actions.');
    hideLoading();
    enableButtons();
    return;
  }

  var prompt = `You are a CS agent assistant for Meow Mobile. Generate the appropriate response based on the analysis and actions already performed.

## Ticket Information
- **Customer:** ${currentTicket.customerName} (${currentTicket.customerEmail})
- **Channel:** ${formatChannel(currentTicket.channel)} ${isEmail ? '(EMAIL FORMAT)' : '(CHAT FORMAT)'}

## Conversation:
${conversationText}

## Analysis & Actions Already Performed:
${analysisResult}

---

## YOUR TASK: Generate the RIGHT type of response

Based on the analysis above, determine which response type is needed:

### IF issue is FULLY RESOLVED:
Generate a **final resolution response** that:
- Confirms what was done
- Explains the fix
- Sets expectations
- Offers further help

### IF there's a WAITING PERIOD (port-in in progress, eSIM provisioning, etc.):
Generate an **interim update response** that:
- Acknowledges their issue
- Explains what's happening behind the scenes
- Gives specific timeline (e.g., "Port-ins typically complete within 24-48 hours")
- Sets expectations for next update
- Provides interim workaround if available

### IF we need MORE INFORMATION from customer:
Generate an **information request response** that:
- Acknowledges the issue
- Explains what we've checked
- Lists SPECIFIC information needed (not vague)
- Explains why we need it

### IF issue requires ESCALATION:
Generate an **escalation notification response** that:
- Acknowledges the complexity
- Explains it's being escalated to specialists
- Sets timeline expectation (e.g., "within 24 hours")
- Assures them they won't need to re-explain

---

## Response Format for ${isEmail ? 'EMAIL' : 'CHAT'}:

${isEmail ? `
EMAIL FORMAT:
- Start with "Hi [Name],"
- Professional but warm tone
- Use numbered lists for steps
- Complete and self-contained
- End with "Best, [Agent Name]\\nMeow Mobile Support"
` : `
CHAT FORMAT:
- Conversational and friendly
- Concise (can go back-and-forth)
- Simple language
- Light emoji okay if appropriate
`}

---

GENERATE ONLY THE RESPONSE TEXT. No additional commentary or explanation.
The response should directly reflect the actions that were performed in the analysis.`;

  try {
    var response = await callServer(prompt, 'respond');

    generatedResponseText = response;
    displayResponse(response);

  } catch (error) {
    console.error('Response generation error:', error);
    displayError('Failed to generate response. Please try again.');
  }

  hideLoading();
  enableButtons();
}

/**
 * Call the backend server
 */
async function callServer(prompt, action) {
  var response = await fetch(SERVER_URL + '/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: prompt,
      ticketId: currentTicket.ticketId,
      customerEmail: currentTicket.customerEmail,
      channel: currentTicket.channel,
      subject: currentTicket.subject,
      status: currentTicket.status,
      action: action
    })
  });

  if (!response.ok) {
    throw new Error('Server error: ' + response.status);
  }

  var data = await response.json();

  if (data.error) {
    throw new Error(data.error);
  }

  return data.response;
}

/**
 * Display analysis results
 */
function displayAnalysis(content) {
  var container = document.getElementById('results-container');
  var emptyState = document.getElementById('empty-state');

  emptyState.style.display = 'none';

  var formattedContent = formatMarkdown(content);

  container.innerHTML =
    '<div class="result-card">' +
      '<div class="card-header">' +
        '<span>📋 Ticket Analysis & Actions</span>' +
        '<span class="status-badge channel">' + formatChannel(currentTicket.channel) + '</span>' +
      '</div>' +
      '<div class="card-body">' +
        formattedContent +
      '</div>' +
      '<div class="card-footer" style="padding: 12px 16px; background: #edf7ff; border-top: 1px solid #d8dcde;">' +
        '<p style="margin: 0; font-size: 12px; color: #1f73b7;">✓ Analysis complete. Click <strong>Generate Response</strong> to create a reply based on these findings.</p>' +
      '</div>' +
    '</div>';
}

/**
 * Display generated response
 */
function displayResponse(content) {
  var container = document.getElementById('results-container');
  var emptyState = document.getElementById('empty-state');

  emptyState.style.display = 'none';

  // Keep analysis visible, add response below
  var existingAnalysis = container.querySelector('.result-card');
  var analysisHtml = existingAnalysis ? existingAnalysis.outerHTML : '';

  container.innerHTML = analysisHtml +
    '<div class="result-card" style="border-color: #038153;">' +
      '<div class="card-header" style="background: #edf8f4;">' +
        '<span>✍️ Response Ready</span>' +
        '<button class="copy-btn" onclick="copyResponse()">📋 Copy</button>' +
      '</div>' +
      '<div class="card-body">' +
        '<pre style="background: #fff; color: #2f3941; white-space: pre-wrap; font-family: inherit; padding: 0; margin: 0;">' + escapeHtml(content) + '</pre>' +
        '<button class="insert-btn" onclick="insertResponse()">📝 Insert into Reply Editor</button>' +
      '</div>' +
    '</div>';
}

/**
 * Display error
 */
function displayError(message) {
  var container = document.getElementById('results-container');
  var emptyState = document.getElementById('empty-state');

  emptyState.style.display = 'none';

  container.innerHTML =
    '<div class="result-card" style="border-color: #e35b66;">' +
      '<div class="card-header" style="background: #fff0f1; color: #8c232c;">' +
        '<span>⚠️ Error</span>' +
      '</div>' +
      '<div class="card-body">' +
        '<p>' + message + '</p>' +
        '<p style="color: #68737d; font-size: 12px;">Please check your server connection and try again.</p>' +
      '</div>' +
    '</div>';
}

/**
 * Copy response to clipboard
 */
function copyResponse() {
  var text = generatedResponseText;

  navigator.clipboard.writeText(text).then(function() {
    var btn = document.querySelector('.copy-btn');
    btn.textContent = '✓ Copied!';
    btn.classList.add('copied');

    setTimeout(function() {
      btn.textContent = '📋 Copy';
      btn.classList.remove('copied');
    }, 2000);
  }).catch(function(err) {
    console.error('Copy failed:', err);
    showNotification('Failed to copy', 'error');
  });
}

/**
 * Insert response into Zendesk reply editor
 */
async function insertResponse() {
  var text = generatedResponseText;

  try {
    await client.invoke('ticket.editor.insert', text);
    showNotification('Response inserted into reply!');
  } catch (error) {
    console.error('Insert failed:', error);
    showNotification('Failed to insert. Please copy and paste manually.', 'error');
  }
}

/**
 * Format markdown to HTML
 */
function formatMarkdown(content) {
  var html = content
    // Tables
    .replace(/\|(.+)\|/g, function(match) {
      var cells = match.split('|').filter(function(c) { return c.trim(); });
      return '<tr>' + cells.map(function(c) { return '<td style="padding: 4px 8px; border: 1px solid #d8dcde;">' + c.trim() + '</td>'; }).join('') + '</tr>';
    })
    // Headers
    .replace(/^### (.+)$/gm, '<h4 style="margin: 16px 0 8px 0; color: #03363d;">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 style="margin: 16px 0 8px 0; color: #1f73b7; border-bottom: 1px solid #d8dcde; padding-bottom: 4px;">$1</h3>')
    // Checkboxes
    .replace(/- \[ \] (.+)$/gm, '<div style="margin: 4px 0;"><input type="checkbox" disabled> $1</div>')
    .replace(/- \[x\] (.+)$/gm, '<div style="margin: 4px 0;"><input type="checkbox" checked disabled> $1</div>')
    // Bold
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // Lists
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    // Code
    .replace(/`([^`]+)`/g, '<code style="background: #f5f5f5; padding: 2px 6px; border-radius: 3px;">$1</code>')
    // Line breaks
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');

  // Wrap in paragraph
  html = '<p>' + html + '</p>';

  // Wrap consecutive li elements in ul
  html = html.replace(/(<li>.*?<\/li>)+/g, '<ul style="margin: 8px 0; padding-left: 20px;">$&</ul>');

  // Wrap tables
  html = html.replace(/(<tr>.*?<\/tr>)+/g, '<table style="border-collapse: collapse; margin: 8px 0; font-size: 12px;">$&</table>');

  return html;
}

/**
 * Escape HTML for safe display
 */
function escapeHtml(text) {
  var div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Show/hide loading state
 */
function showLoading(message) {
  document.getElementById('loading').classList.add('active');
  document.querySelector('.loading-text').textContent = message || 'Loading...';
  document.getElementById('empty-state').style.display = 'none';
}

function hideLoading() {
  document.getElementById('loading').classList.remove('active');
}

/**
 * Enable/disable buttons
 */
function disableButtons() {
  document.getElementById('analyze-btn').disabled = true;
  document.getElementById('respond-btn').disabled = true;
}

function enableButtons() {
  document.getElementById('analyze-btn').disabled = false;
  document.getElementById('respond-btn').disabled = false;
}

/**
 * Show notification toast
 */
function showNotification(message, type) {
  var notification = document.createElement('div');
  notification.className = 'notification';
  notification.style.background = type === 'error' ? '#e35b66' : '#038153';
  notification.textContent = message;
  document.body.appendChild(notification);

  setTimeout(function() {
    notification.remove();
  }, 2500);
}

// ─── SLA Engine ───────────────────────────────────────────────

var SLA_TARGETS = {
  L0: {
    urgent: { firstResponse: 60, nextResponse: 240, resolution: 480 },
    high:   { firstResponse: 60, nextResponse: 480, resolution: 1440 },
    normal: { firstResponse: 60, nextResponse: 720, resolution: 2880 },
    low:    { firstResponse: 60, nextResponse: 1440, resolution: 4320 }
  },
  L1: {
    urgent: { firstResponse: 120, nextResponse: 240, resolution: 1440, internalHandoff: 120 },
    high:   { firstResponse: 120, nextResponse: 480, resolution: 2880, internalHandoff: 240 },
    normal: { firstResponse: 120, nextResponse: 720, resolution: 5760, internalHandoff: 480 },
    low:    { firstResponse: 120, nextResponse: 1440, resolution: 10080, internalHandoff: 1440 }
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
    airvet: {
      weekday: { resolution: 1440 },
      weekend: { resolution: 2880 }
    },
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

function getSlaTargets(tier, priority) {
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
  if (m.met) return 'Met' + (m.elapsedMs > 0 ? ' (' + formatDuration(m.elapsedMs) + ')' : '');
  if (m.elapsedMs >= m.targetMs) return 'BREACHED ' + formatDuration(m.elapsedMs - m.targetMs) + ' ago';
  return formatDuration(m.targetMs - m.elapsedMs) + ' left';
}

function computeNextResponse(comments, requesterId) {
  var lastCustomerMsg = null;
  var agentRepliedAfter = false;
  for (var i = comments.length - 1; i >= 0; i--) {
    var c = comments[i];
    // ZAF comments have author.role; API comments have author_id
    var isCustomer = c.author ? (c.author.role === 'end-user' || c.author.role === 'end_user') : (c.author_id === requesterId);
    var isPublic = c.public !== false;
    if (!isPublic) continue;
    if (!lastCustomerMsg && isCustomer) {
      lastCustomerMsg = c;
      agentRepliedAfter = false;
    } else if (lastCustomerMsg && !isCustomer) {
      agentRepliedAfter = true;
      break;
    }
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

/**
 * Full SLA data load — fetches ticket, metrics, comments, group, partner field
 */
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

    // Detect group & tier
    var groupName = '';
    if (ticket.group_id) {
      try {
        var gData = await client.request({ url: '/api/v2/groups/' + ticket.group_id + '.json', type: 'GET', dataType: 'json' });
        groupName = gData.group.name || '';
      } catch (e) {}
    }
    var tier = detectTier(groupName);

    // Detect partner
    var partner = null;
    if (partnerFieldId && ticket.custom_fields) {
      for (var fi = 0; fi < ticket.custom_fields.length; fi++) {
        var cf = ticket.custom_fields[fi];
        if (cf.id === partnerFieldId && cf.value) { partner = cf.value.toLowerCase(); break; }
      }
    }
    var partnerName = partner ? (PARTNER_NAMES[partner] || partner) : null;

    // Path
    var path, pathClass;
    var isSolved = ticket.status === 'solved' || ticket.status === 'closed';
    if (isSolved) {
      path = 'Solved'; pathClass = 'sla-badge-green';
    } else if (partner) {
      path = 'Partner \u2192 ' + partnerName; pathClass = 'sla-badge-purple';
    } else if (tier !== 'L0') {
      path = 'Escalated \u2192 ' + tier; pathClass = 'sla-badge-orange';
    } else {
      path = 'L0 Direct'; pathClass = 'sla-badge-blue';
    }

    // Header gradient
    var header = document.getElementById('app-header');
    if (isSolved) {
      header.style.background = 'linear-gradient(135deg, #038153, #025a3a)';
    } else if (partner) {
      header.style.background = 'linear-gradient(135deg, #6a27b8, #4a1a80)';
    } else if (tier !== 'L0') {
      header.style.background = 'linear-gradient(135deg, #c96400, #8f4700)';
    } else {
      header.style.background = 'linear-gradient(135deg, #1f73b7, #144a75)';
    }

    var priority = ticket.priority || 'normal';
    var targets = getSlaTargets(tier, priority);
    var now = Date.now();
    var createdAt = new Date(ticket.created_at).getTime();

    // ── Build SLA metrics ────────────────────────────────

    var slaMetrics = [];

    // 1. First Response
    var replyMetric = metrics ? metrics.reply_time_in_minutes : null;
    if (replyMetric) {
      var replySrc = replyMetric.business || replyMetric.calendar;
      if (replySrc) {
        var frTarget = (targets.firstResponse || 60) * 60000;
        if (replySrc.breach_at) {
          var ba = new Date(replySrc.breach_at).getTime();
          var rem = ba - now;
          slaMetrics.push({ label: '1st Response', targetMs: frTarget, elapsedMs: Math.max(frTarget - Math.max(rem, 0), 0), breachAt: ba, met: false });
        } else if (replySrc.elapsed !== undefined && replySrc.elapsed !== null) {
          slaMetrics.push({ label: '1st Response', targetMs: frTarget, elapsedMs: replySrc.elapsed * 60000, breachAt: null, met: true });
        }
      }
    }
    if (!slaMetrics.length) {
      var frT = (targets.firstResponse || 60) * 60000;
      slaMetrics.push({ label: '1st Response', targetMs: frT, elapsedMs: now - createdAt, breachAt: createdAt + frT, met: false });
    }

    // 2. Next Response
    var nextResp = computeNextResponse(comments, ticket.requester_id);
    var nrTarget = (targets.nextResponse || 720) * 60000;
    if (nextResp) {
      if (nextResp.met) {
        slaMetrics.push({ label: 'Next Response', targetMs: nrTarget, elapsedMs: 0, breachAt: null, met: true });
      } else {
        var nrEl = now - nextResp.since;
        slaMetrics.push({ label: 'Next Response', targetMs: nrTarget, elapsedMs: nrEl, breachAt: nextResp.since + nrTarget, met: false });
      }
    }

    // 3. Resolution
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

    // 4. Internal Handoff (L1-3)
    if (tier !== 'L0' && targets.internalHandoff) {
      var escTs = await findEscalationTimestamp(ticketId);
      if (escTs) {
        var ihTarget = targets.internalHandoff * 60000;
        var ihElapsed = now - escTs;
        var repliedAfterEsc = false;
        for (var ci = 0; ci < comments.length; ci++) {
          var ct = new Date(comments[ci].created_at).getTime();
          var isAgent = comments[ci].author_id !== ticket.requester_id;
          if (ct > escTs && isAgent && comments[ci].public !== false) {
            repliedAfterEsc = true;
            ihElapsed = ct - escTs;
            break;
          }
        }
        slaMetrics.push({ label: tier + ' Handoff', targetMs: ihTarget, elapsedMs: ihElapsed, breachAt: repliedAfterEsc ? null : escTs + ihTarget, met: repliedAfterEsc });
      }
    }

    // 5. Partner SLAs
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

    // ── Render ────────────────────────────────────────────
    renderSlaSection(slaMetrics, groupName || 'Unassigned', path, pathClass, tier, priority, isSolved);

    // ── Live countdown ───────────────────────────────────
    if (slaTimerInterval) clearInterval(slaTimerInterval);
    slaTimerInterval = setInterval(function() {
      var n = Date.now();
      slaMetrics.forEach(function(m) {
        if (m.met || !m.breachAt) return;
        m.elapsedMs = m.targetMs - Math.max(m.breachAt - n, 0);
        if (m.elapsedMs > m.targetMs) m.elapsedMs = n - (m.breachAt - m.targetMs);
      });
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

  html += '<div class="sla-group-line">Assigned to: <strong>' + groupName + '</strong></div>';

  html += '<div class="sla-badges">' +
    '<span class="sla-badge ' + pathClass + '">' + path + '</span>' +
    '<span class="sla-badge sla-badge-gray">' + (priority || 'normal').toUpperCase() + '</span>' +
    '<span class="sla-badge sla-badge-gray">SLA: ' + (tier === 'L0' ? '1h' : '2h') + '</span>' +
    (isSolved ? '<span class="sla-badge sla-badge-green">SOLVED</span>' : '') +
  '</div>';

  var coreLabels = { '1st Response': 1, 'Next Response': 1, 'Resolution': 1 };
  var coreDone = false;

  metrics.forEach(function(m) {
    if (!coreLabels[m.label] && !coreDone) {
      html += '<div class="sla-divider"></div>';
      coreDone = true;
    }
    if (m.placeholder) {
      html += '<div class="sla-metric" data-label="' + m.label + '"><div class="sla-metric-header">' +
        '<span class="sla-metric-label">' + m.label + '</span>' +
        '<span class="sla-metric-time" style="color:#87929d">Not configured</span>' +
      '</div></div>';
      return;
    }
    var st = m.met ? 'met' : slaStatus(m.elapsedMs, m.targetMs);
    var p = m.met ? 100 : slaPct(m.elapsedMs, m.targetMs);
    html += '<div class="sla-metric sla-status-' + st + '" data-label="' + m.label + '">' +
      '<div class="sla-metric-header">' +
        '<span class="sla-metric-label">' + m.label + '</span>' +
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
    var st = m.met ? 'met' : slaStatus(m.elapsedMs, m.targetMs);
    el.className = 'sla-metric sla-status-' + st;
    el.querySelector('.sla-metric-time').textContent = slaTimeText(m);
    el.querySelector('.sla-bar-fill').style.width = (m.met ? 100 : slaPct(m.elapsedMs, m.targetMs)) + '%';
  });
}
