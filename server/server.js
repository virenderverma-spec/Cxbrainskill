/**
 * CS Intelligence Server
 *
 * Express server that powers the Zendesk Copilot sidebar app
 * with Claude AI and skill-based knowledge.
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const path = require('path');
const chatRouter = require('./routes/chat');
const reactiveRouter = require('./routes/reactive');
const slaDashboardRouter = require('./routes/sla-dashboard');
const healthRouter = require('./routes/health');
const bossRouter = require('./routes/boss');
const actionsRouter = require('./routes/actions');
const copilotRouter = require('./routes/copilot');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// Static files (SLA dashboard HTML + Zendesk app preview)
app.use(express.static(path.join(__dirname, 'public')));
app.use('/preview', express.static(path.join(__dirname, '..', 'zendesk-app', 'assets')));

// Routes
app.use('/api/chat', chatRouter);
app.use('/api/reactive', reactiveRouter);
app.use('/api/sla', slaDashboardRouter);
app.use('/api/health', healthRouter);
app.use('/api/boss', bossRouter);
app.use('/api/actions', actionsRouter);
app.use('/api/copilot', copilotRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Skills info endpoint
app.get('/api/skills', (req, res) => {
  const { listAvailableSkills } = require('./lib/skill-loader');
  const skills = listAvailableSkills();
  res.json({
    count: skills.length,
    skills: skills
  });
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`CS Intelligence Server running on port ${PORT}`);
  console.log(`Skills loaded from: ${require('./lib/skill-loader').DEFAULT_SKILLS_DIR}`);

  // List loaded skills on startup
  const { listAvailableSkills } = require('./lib/skill-loader');
  const skills = listAvailableSkills();
  console.log(`Available skills (${skills.length}):`, skills.join(', '));
});

module.exports = app;
