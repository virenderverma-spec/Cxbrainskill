require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');
const path = require('path');

const customerRoutes = require('./routes/customer');
const chatRoutes = require('./routes/chat');
const { isAnthropicConfigured } = require('./routes/chat');
const { bossApi, BOSS_API_URL } = require('./lib/boss-api');
const { DATABRICKS_TOKEN } = require('./lib/databricks');
const { ZENDESK_SUBDOMAIN } = require('./lib/zendesk-api');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ── Static files ─────────────────────────────────────────────

// Serve the standalone UI at /
app.use(express.static(path.join(__dirname, '..', 'public')));

// Serve the ZAF sidebar iframe at /app
app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'assets', 'iframe.html'));
});

// ── API routes ───────────────────────────────────────────────

app.use('/api/customer', customerRoutes);
app.use('/api/chat', chatRoutes);

// ── GET /api/network-outages ─────────────────────────────────

app.get('/api/network-outages', async (req, res) => {
  const { zip } = req.query;
  if (!zip) return res.status(400).json({ error: 'zip required' });

  try {
    const result = await bossApi('get', '/networkOutages', { zip });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Health check ─────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    claude: isAnthropicConfigured(),
    databricks: !!DATABRICKS_TOKEN,
    zendesk: !!ZENDESK_SUBDOMAIN,
    bossApi: !!BOSS_API_URL,
  });
});

// ── Catch-all → serve standalone index.html ──────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ── Start server ─────────────────────────────────────────────

app.listen(PORT, () => {
  console.log('');
  console.log('  ╔═══════════════════════════════════════════════╗');
  console.log('  ║   Zendesk Customer Intelligence — Running     ║');
  console.log(`  ║   http://localhost:${PORT}                       ║`);
  console.log('  ╚═══════════════════════════════════════════════╝');
  console.log('');
  console.log(`  Claude API:    ${isAnthropicConfigured() ? '✓ configured' : '○ not set — paste key in .env for AI mode'}`);
  console.log(`  Boss API:      ✓ ${BOSS_API_URL}`);
  console.log(`  Databricks:    ${DATABRICKS_TOKEN ? '✓ configured' : '○ not configured'}`);
  console.log(`  Zendesk:       ${ZENDESK_SUBDOMAIN ? '✓ configured' : '○ not configured'}`);
  console.log(`  Mode:          ${isAnthropicConfigured() ? 'Claude AI (natural language)' : 'Direct (pattern matching)'}`);
  console.log('');
  console.log('  Endpoints:');
  console.log('    GET  /       → Standalone UI');
  console.log('    GET  /app    → ZAF sidebar iframe');
  console.log('    POST /api/chat');
  console.log('    POST /api/customer/lookup');
  console.log('    POST /api/customer/agent-brief');
  console.log('    POST /api/customer/ticket-assist');
  console.log('    POST /api/customer/search');
  console.log('    GET  /api/network-outages?zip=...');
  console.log('    GET  /api/health');
  console.log('');
});
