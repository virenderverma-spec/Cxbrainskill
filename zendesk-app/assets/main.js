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

// Initialize app when Zendesk is ready
document.addEventListener('DOMContentLoaded', async function() {
  client = ZAFClient.init();
  client.invoke('resize', { width: '100%', height: '600px' });

  // Load ticket data
  await loadTicketData();
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
