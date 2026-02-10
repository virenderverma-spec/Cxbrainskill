/**
 * SLA Team Dashboard — API Route
 *
 * GET /api/sla/dashboard
 *   Queries Databricks for all active tickets + metrics,
 *   fetches Zendesk groups for tier mapping,
 *   computes SLA status for every ticket,
 *   returns summary + breakdowns + ticket lists.
 */

const express = require('express');
const router = express.Router();

// ─── SLA Targets (same as sidebar engine) ───────────────────

const SLA_TARGETS = {
  L0: {
    urgent: { firstResponse: 30, resolution: 60 },
    high:   { firstResponse: 30, resolution: 60 },
    normal: { firstResponse: 60, resolution: 120 },
    low:    { firstResponse: 60, resolution: 120 }
  },
  L1: {
    urgent: { firstResponse: 60, resolution: 240 },
    high:   { firstResponse: 60, resolution: 240 },
    normal: { firstResponse: 60, resolution: 240 },
    low:    { firstResponse: 60, resolution: 240 }
  }
};

const GROUP_TIER_KEYWORDS = {
  'l0': 'L0', 'tier 0': 'L0', 'tier0': 'L0', 'level 0': 'L0',
  'l1': 'L1', 'tier 1': 'L1', 'tier1': 'L1', 'level 1': 'L1',
  'l2': 'L2', 'tier 2': 'L2', 'tier2': 'L2', 'level 2': 'L2',
  'l3': 'L3', 'tier 3': 'L3', 'tier3': 'L3', 'level 3': 'L3', 'engineering': 'L3'
};

// ─── Zendesk Groups Cache (10 min TTL) ──────────────────────

// Known groups — covers both current Zendesk instance and Databricks-synced IDs
const KNOWN_GROUPS = {
  // Current Zendesk instance
  '44720856231195': 'System Admin',
  '44720856191771': 'L1 Support',
  '44720856123547': 'CH L0',
  '44720845105179': 'L2 Support',
  '44720839962779': 'L3 Support',
  '44720829972123': 'Help Center Admins',
  '44720815775131': 'CH TL',
  '44720795758363': 'Support',
  // Databricks-synced group IDs (production Zendesk)
  '38775024599963': 'L0 Support',
  '38477651961627': 'L1 Support',
  '41929008981403': 'L2 Engineering',
  '37767586963611': 'L1 Support',
  '42890884027163': 'L3 Engineering'
};

let groupsCache = null;
let groupsCacheTime = 0;
const GROUPS_CACHE_TTL = 10 * 60 * 1000;

async function fetchZendeskGroups() {
  const now = Date.now();
  if (groupsCache && (now - groupsCacheTime) < GROUPS_CACHE_TTL) {
    return groupsCache;
  }

  const subdomain = process.env.ZENDESK_SUBDOMAIN || 'rockstarautomations1766495393';
  const email = process.env.ZENDESK_EMAIL || 'virender.verma@rockstar-automations.com';
  const token = process.env.ZENDESK_TOKEN;

  // Start with known groups as baseline
  const map = { ...KNOWN_GROUPS };

  if (token) {
    try {
      const credentials = Buffer.from(`${email}/token:${token}`).toString('base64');
      const url = `https://${subdomain}.zendesk.com/api/v2/groups.json`;
      const resp = await fetch(url, {
        headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/json' }
      });

      if (resp.ok) {
        const data = await resp.json();
        for (const g of (data.groups || [])) {
          map[String(g.id)] = g.name;
        }
        console.log(`[SLA-DASH] Fetched ${data.groups?.length || 0} groups from Zendesk API`);
      } else {
        console.warn(`[SLA-DASH] Zendesk groups API returned ${resp.status}, using known groups fallback`);
      }
    } catch (err) {
      console.warn(`[SLA-DASH] Zendesk groups fetch error: ${err.message}, using known groups fallback`);
    }
  }

  groupsCache = map;
  groupsCacheTime = now;
  return map;
}

// ─── Tier Detection ─────────────────────────────────────────

function detectTier(groupName) {
  if (!groupName) return 'L0';
  const lower = groupName.toLowerCase();
  for (const [keyword, tier] of Object.entries(GROUP_TIER_KEYWORDS)) {
    if (lower.includes(keyword)) return tier;
  }
  return 'L0';
}

function getSlaTargets(tier, priority, groupName) {
  // Unassigned tickets follow L0 high priority SLA
  if (!groupName) return SLA_TARGETS.L0.high;
  const p = (priority || 'normal').toLowerCase();
  // L2/L3 inherit L1 targets
  const tierTargets = SLA_TARGETS[tier] || SLA_TARGETS.L1 || SLA_TARGETS.L0;
  return tierTargets[p] || tierTargets.normal;
}

// ─── Metric JSON Parsing ────────────────────────────────────

function parseMetricMinutes(raw) {
  if (!raw) return null;
  try {
    // Databricks stores as double-escaped JSON string: "\"{\\\"calendar\\\": 0, ...}\""
    let parsed = raw;
    if (typeof parsed === 'string') parsed = JSON.parse(parsed);
    if (typeof parsed === 'string') parsed = JSON.parse(parsed);
    const val = parsed.calendar;
    return (val !== null && val !== undefined) ? val : null;
  } catch {
    return null;
  }
}

// ─── SLA Status Categorization ──────────────────────────────

function categorize(elapsedMin, targetMin) {
  if (targetMin <= 0) return { status: 'healthy', pct: 0 };
  const pct = (elapsedMin / targetMin) * 100;
  if (pct >= 100) return { status: 'breached', pct };
  if (pct > 85)  return { status: 'critical', pct };
  if (pct >= 60) return { status: 'warning', pct };
  return { status: 'healthy', pct };
}

// ─── Databricks SQL Query ───────────────────────────────────

async function queryDatabricks(sql) {
  const host = process.env.DATABRICKS_HOST;
  const token = process.env.DATABRICKS_TOKEN;
  const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID;

  if (!host || !token || !warehouseId) {
    throw new Error('Databricks env vars not configured (DATABRICKS_HOST, DATABRICKS_TOKEN, DATABRICKS_WAREHOUSE_ID)');
  }

  const url = `https://${host}/api/2.0/sql/statements`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      warehouse_id: warehouseId,
      statement: sql,
      wait_timeout: '30s',
      disposition: 'INLINE',
      format: 'JSON_ARRAY'
    })
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Databricks query failed (${resp.status}): ${text}`);
  }

  const data = await resp.json();

  // Handle async execution — poll if needed
  if (data.status?.state === 'PENDING' || data.status?.state === 'RUNNING') {
    return await pollDatabricks(data.statement_id);
  }

  if (data.status?.state !== 'SUCCEEDED') {
    throw new Error(`Databricks query error: ${data.status?.error?.message || data.status?.state}`);
  }

  return parseDatabricksResult(data);
}

async function pollDatabricks(statementId) {
  const host = process.env.DATABRICKS_HOST;
  const token = process.env.DATABRICKS_TOKEN;

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const url = `https://${host}/api/2.0/sql/statements/${statementId}`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await resp.json();
    if (data.status?.state === 'SUCCEEDED') return parseDatabricksResult(data);
    if (data.status?.state === 'FAILED' || data.status?.state === 'CANCELED') {
      throw new Error(`Databricks query ${data.status.state}: ${data.status?.error?.message || ''}`);
    }
  }
  throw new Error('Databricks query timed out after 30s');
}

function parseDatabricksResult(data) {
  const columns = data.manifest?.schema?.columns || [];
  const colNames = columns.map(c => c.name);
  const rows = data.result?.data_array || [];

  return rows.map(row => {
    const obj = {};
    // REST API returns plain arrays: ["val1", "val2", ...]
    for (let i = 0; i < colNames.length; i++) {
      obj[colNames[i]] = row[i] ?? null;
    }
    return obj;
  });
}

// ─── Main Dashboard Endpoint ────────────────────────────────

router.get('/dashboard', async (req, res) => {
  try {
    console.log('[SLA-DASH] Fetching dashboard data...');

    // 1. Query Databricks for active tickets + metrics
    const sql = `
      WITH deduped AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY updated_at DESC) AS rn
        FROM prod_catalog.customer_support.zendesk_tickets
        WHERE status IN ('new', 'open', 'pending', 'hold')
      )
      SELECT
        t.id AS ticket_id,
        t.subject,
        t.status,
        t.priority,
        t.group_id,
        t.created_at,
        t.updated_at,
        t.requester_id,
        t.assignee_id,
        t.tags,
        m.reply_time_in_minutes,
        m.full_resolution_time_in_minutes,
        m.requester_wait_time_in_minutes,
        m.replies
      FROM deduped t
      LEFT JOIN prod_catalog.customer_support.zendesk_ticket_metrics m
        ON t.id = m.ticket_id
      WHERE t.rn = 1
      ORDER BY t.created_at ASC
    `;

    const [tickets, groupMap] = await Promise.all([
      queryDatabricks(sql),
      fetchZendeskGroups()
    ]);

    console.log(`[SLA-DASH] Got ${tickets.length} active tickets, ${Object.keys(groupMap).length} groups`);

    const now = Date.now();

    // 3. Process each ticket
    const summary = { total: 0, breached: 0, critical: 0, warning: 0, healthy: 0 };
    const byPriority = {};
    const byTier = {};
    const byMetric = { firstResponse: { breached: 0, critical: 0, warning: 0, healthy: 0 },
                       resolution: { breached: 0, critical: 0, warning: 0, healthy: 0 } };
    const needsAction = [];
    const atRisk = [];
    const allTickets = [];

    for (const t of tickets) {
      const groupName = groupMap[String(t.group_id)] || null;
      const tier = detectTier(groupName);
      const priority = (t.priority || 'normal').toLowerCase();
      const targets = getSlaTargets(tier, priority, groupName);

      const createdAt = new Date(t.created_at).getTime();
      const ageMin = (now - createdAt) / 60000;

      // First Response
      const replyElapsed = parseMetricMinutes(t.reply_time_in_minutes);
      // If reply_time_in_minutes calendar == 0 and ticket has no replies, use age from creation
      const hasReplied = parseInt(t.replies) > 0;
      const frElapsedMin = (replyElapsed !== null && (replyElapsed > 0 || hasReplied))
        ? replyElapsed
        : ageMin;
      const frTarget = targets.firstResponse;
      const frCat = hasReplied
        ? { status: 'healthy', pct: 0 }  // already replied
        : categorize(frElapsedMin, frTarget);

      // Resolution
      const resElapsed = parseMetricMinutes(t.full_resolution_time_in_minutes);
      const resElapsedMin = (resElapsed !== null && resElapsed > 0) ? resElapsed : ageMin;
      const resTarget = targets.resolution;
      const resCat = categorize(resElapsedMin, resTarget);

      // Requester Wait Time
      const reqWait = parseMetricMinutes(t.requester_wait_time_in_minutes);

      // Overall status = worst of the two
      const statusOrder = { breached: 3, critical: 2, warning: 1, healthy: 0 };
      const worstStatus = statusOrder[frCat.status] >= statusOrder[resCat.status]
        ? frCat.status : resCat.status;
      const worstPct = Math.max(frCat.pct, resCat.pct);

      const ticketData = {
        ticketId: t.ticket_id,
        subject: t.subject,
        status: t.status,
        priority,
        tier,
        groupName: groupName || 'Unassigned',
        createdAt: t.created_at,
        ageMinutes: Math.round(ageMin),
        firstResponse: {
          status: frCat.status,
          pct: Math.round(frCat.pct),
          elapsedMin: Math.round(frElapsedMin),
          targetMin: frTarget,
          replied: hasReplied
        },
        resolution: {
          status: resCat.status,
          pct: Math.round(resCat.pct),
          elapsedMin: Math.round(resElapsedMin),
          targetMin: resTarget
        },
        requesterWaitMin: reqWait !== null ? Math.round(reqWait) : null,
        overallStatus: worstStatus,
        overallPct: Math.round(worstPct)
      };

      // Summary
      summary.total++;
      summary[worstStatus]++;

      // By Priority
      if (!byPriority[priority]) byPriority[priority] = { total: 0, breached: 0, critical: 0, warning: 0, healthy: 0 };
      byPriority[priority].total++;
      byPriority[priority][worstStatus]++;

      // By Tier
      if (!byTier[tier]) byTier[tier] = { total: 0, breached: 0, critical: 0, warning: 0, healthy: 0 };
      byTier[tier].total++;
      byTier[tier][worstStatus]++;

      // By Metric
      byMetric.firstResponse[frCat.status]++;
      byMetric.resolution[resCat.status]++;

      // Needs Action / At Risk lists
      if (worstStatus === 'breached' || worstStatus === 'critical') {
        needsAction.push(ticketData);
      } else if (worstStatus === 'warning') {
        atRisk.push(ticketData);
      }

      allTickets.push(ticketData);
    }

    // Sort needs-action by overdue percentage (highest first)
    needsAction.sort((a, b) => b.overallPct - a.overallPct);
    atRisk.sort((a, b) => b.overallPct - a.overallPct);

    console.log(`[SLA-DASH] Summary: ${summary.total} total, ${summary.breached} breached, ${summary.critical} critical, ${summary.warning} warning, ${summary.healthy} healthy`);

    res.json({
      generatedAt: new Date().toISOString(),
      summary,
      byPriority,
      byTier,
      byMetric,
      needsAction,
      atRisk,
      allTickets
    });

  } catch (error) {
    console.error('[SLA-DASH] Error:', error);
    res.status(500).json({ error: 'Failed to generate SLA dashboard', details: error.message });
  }
});

module.exports = router;
