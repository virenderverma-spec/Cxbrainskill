/**
 * Zendesk API Client
 *
 * Shared client for all Zendesk API operations used by
 * the reactive communication engine.
 */

const ZENDESK_SUBDOMAIN = process.env.ZENDESK_SUBDOMAIN || 'rockstarautomations1766495393';
const ZENDESK_EMAIL = process.env.ZENDESK_EMAIL || 'virender.verma@rockstar-automations.com';
const ZENDESK_TOKEN = process.env.ZENDESK_TOKEN;

const BASE_URL = `https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2`;

function getAuthHeader() {
  const credentials = Buffer.from(`${ZENDESK_EMAIL}/token:${ZENDESK_TOKEN}`).toString('base64');
  return `Basic ${credentials}`;
}

async function zendeskRequest(endpoint, method = 'GET', body = null) {
  const url = `${BASE_URL}${endpoint}`;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': getAuthHeader()
    }
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Zendesk API ${method} ${endpoint} failed (${response.status}): ${errorText}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

/**
 * Search tickets by requester email
 */
async function searchTicketsByRequester(email, excludeStatuses = ['solved', 'closed']) {
  const statusFilter = excludeStatuses.map(s => `-status:${s}`).join(' ');
  const query = encodeURIComponent(`requester:${email} ${statusFilter} -tags:merged_source -tags:proactive_alert`);
  const data = await zendeskRequest(`/search.json?query=${query}&sort_by=created_at&sort_order=desc`);
  return data.results || [];
}

/**
 * Get a single ticket
 */
async function getTicket(ticketId) {
  const data = await zendeskRequest(`/tickets/${ticketId}.json`);
  return data.ticket;
}

/**
 * Get all comments on a ticket
 */
async function getTicketComments(ticketId) {
  const data = await zendeskRequest(`/tickets/${ticketId}/comments.json`);
  return data.comments || [];
}

/**
 * Update a ticket
 */
async function updateTicket(ticketId, updates) {
  const data = await zendeskRequest(`/tickets/${ticketId}.json`, 'PUT', { ticket: updates });
  return data.ticket;
}

/**
 * Add an internal note to a ticket
 */
async function addInternalNote(ticketId, body) {
  return updateTicket(ticketId, {
    comment: {
      body,
      public: false
    }
  });
}

/**
 * Add a public comment to a ticket
 */
async function addPublicComment(ticketId, body) {
  return updateTicket(ticketId, {
    comment: {
      body,
      public: true
    }
  });
}

/**
 * Bulk update tickets (for closing merged sources)
 */
async function bulkUpdateTickets(ticketIds, updates) {
  const ids = ticketIds.join(',');
  return zendeskRequest(`/tickets/update_many.json?ids=${ids}`, 'PUT', { ticket: updates });
}

/**
 * Get ticket tags
 */
function getTicketTags(ticket) {
  return ticket.tags || [];
}

/**
 * Merge tags from multiple tickets (union, deduplicated)
 */
function mergeTags(...tagArrays) {
  const merged = new Set();
  for (const tags of tagArrays) {
    for (const tag of tags) {
      merged.add(tag);
    }
  }
  return Array.from(merged);
}

/**
 * Determine highest priority among tickets
 * Priority order: urgent > high > normal > low > null
 */
function getHighestPriority(tickets) {
  const priorityOrder = { urgent: 4, high: 3, normal: 2, low: 1 };
  let highest = null;
  let highestScore = 0;

  for (const ticket of tickets) {
    const score = priorityOrder[ticket.priority] || 0;
    if (score > highestScore) {
      highestScore = score;
      highest = ticket.priority;
    }
  }

  return highest || 'normal';
}

/**
 * Find the most recently active agent among tickets
 */
function getMostRecentAgent(tickets) {
  let latestAgent = null;
  let latestUpdate = null;

  for (const ticket of tickets) {
    if (ticket.assignee_id) {
      const updated = new Date(ticket.updated_at);
      if (!latestUpdate || updated > latestUpdate) {
        latestUpdate = updated;
        latestAgent = ticket.assignee_id;
      }
    }
  }

  return latestAgent;
}

module.exports = {
  zendeskRequest,
  searchTicketsByRequester,
  getTicket,
  getTicketComments,
  updateTicket,
  addInternalNote,
  addPublicComment,
  bulkUpdateTickets,
  getTicketTags,
  mergeTags,
  getHighestPriority,
  getMostRecentAgent,
  BASE_URL
};
