const axios = require('axios');

const ZENDESK_SUBDOMAIN = process.env.ZENDESK_SUBDOMAIN || '';
const ZENDESK_EMAIL = process.env.ZENDESK_EMAIL || '';
const ZENDESK_TOKEN = process.env.ZENDESK_TOKEN || '';

async function zendeskSearch(query) {
  if (!ZENDESK_SUBDOMAIN || !ZENDESK_EMAIL || !ZENDESK_TOKEN) {
    return { error: true, message: 'Zendesk not configured. Set ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, ZENDESK_TOKEN in .env' };
  }

  const auth = Buffer.from(`${ZENDESK_EMAIL}/token:${ZENDESK_TOKEN}`).toString('base64');
  try {
    const resp = await axios.get(
      `https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/search.json`,
      {
        params: { query, sort_by: 'created_at', sort_order: 'desc' },
        headers: { Authorization: `Basic ${auth}` },
        timeout: 15000,
      }
    );
    const results = (resp.data.results || []).slice(0, 10).map(t => ({
      id: t.id,
      subject: t.subject,
      status: t.status,
      priority: t.priority,
      type: t.type,
      created_at: t.created_at,
      updated_at: t.updated_at,
    }));
    return { count: resp.data.count, tickets: results };
  } catch (err) {
    return { error: true, message: err.response?.data?.error || err.message };
  }
}

async function zendeskTicketComments(ticketId) {
  if (!ZENDESK_SUBDOMAIN || !ZENDESK_EMAIL || !ZENDESK_TOKEN) {
    return { error: true, message: 'Zendesk not configured' };
  }

  const auth = Buffer.from(`${ZENDESK_EMAIL}/token:${ZENDESK_TOKEN}`).toString('base64');
  try {
    const resp = await axios.get(
      `https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/tickets/${ticketId}/comments.json`,
      {
        headers: { Authorization: `Basic ${auth}` },
        timeout: 15000,
      }
    );
    return (resp.data.comments || []).map(c => ({
      body: c.body,
      author_id: c.author_id,
      created_at: c.created_at,
      public: c.public,
    }));
  } catch (err) {
    return { error: true, message: err.response?.data?.error || err.message };
  }
}

async function zendeskHelpCenterSearch(query) {
  if (!ZENDESK_SUBDOMAIN || !ZENDESK_EMAIL || !ZENDESK_TOKEN) {
    return { error: true, message: 'Zendesk not configured' };
  }

  const auth = Buffer.from(`${ZENDESK_EMAIL}/token:${ZENDESK_TOKEN}`).toString('base64');
  try {
    const resp = await axios.get(
      `https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/help_center/articles/search.json`,
      {
        params: { query, per_page: 5 },
        headers: { Authorization: `Basic ${auth}` },
        timeout: 15000,
      }
    );
    return (resp.data.results || []).map(a => ({
      title: a.title,
      html_url: a.html_url,
      snippet: a.snippet,
    }));
  } catch (err) {
    return { error: true, message: err.response?.data?.error || err.message };
  }
}

module.exports = { zendeskSearch, zendeskTicketComments, zendeskHelpCenterSearch, ZENDESK_SUBDOMAIN };
