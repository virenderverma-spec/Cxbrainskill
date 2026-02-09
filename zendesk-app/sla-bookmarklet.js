/**
 * SLA Sidebar Bookmarklet — Paste in browser console on any Zendesk ticket page
 *
 * Detection:
 *   Tier  → ticket assigned group name (L0 / L1 / L2 / L3)
 *   Partner → custom ticket field "Partner Escalation" (AT&T / ConnectX / Airvet)
 *
 * SLA Clocks:
 *   1. First Response   — time until first agent reply
 *   2. Next Response     — time since last unanswered customer message
 *   3. Resolution        — total time to solve
 *   4. Internal Handoff  — (L1-3 only) time for escalated team to pick up
 *   5. Partner Response  — (Partner only) time waiting on partner
 *
 * SETUP: Create a custom ticket dropdown field in Zendesk called "Partner Escalation"
 *        with values: att, connectx, airvet
 *        Then set PARTNER_FIELD_ID below to that field's ID.
 *        (Or leave null — the script will search by field title automatically.)
 */
(function() {
  'use strict';

  // ─── CONFIGURATION ──────────────────────────────────────────
  // Set this to your custom field ID, or leave null for auto-detect by title
  var PARTNER_FIELD_ID = null;

  // Group-name-to-tier mapping (matched case-insensitively against group name)
  // Add your actual Zendesk group names here
  var GROUP_TIER_KEYWORDS = {
    'l0': 'L0', 'tier 0': 'L0', 'tier0': 'L0', 'level 0': 'L0',
    'l1': 'L1', 'tier 1': 'L1', 'tier1': 'L1', 'level 1': 'L1',
    'l2': 'L2', 'tier 2': 'L2', 'tier2': 'L2', 'level 2': 'L2',
    'l3': 'L3', 'tier 3': 'L3', 'tier3': 'L3', 'level 3': 'L3', 'engineering': 'L3'
  };

  // SLA targets in MINUTES per tier and priority
  var SLA_TARGETS = {
    L0: {
      urgent: { firstResponse: 60,   nextResponse: 240,  resolution: 480 },
      high:   { firstResponse: 240,  nextResponse: 480,  resolution: 1440 },
      normal: { firstResponse: 480,  nextResponse: 720,  resolution: 2880 },
      low:    { firstResponse: 1440, nextResponse: 1440, resolution: 4320 }
    },
    L1: {
      urgent: { firstResponse: 60,   nextResponse: 240,  resolution: 1440,  internalHandoff: 120 },
      high:   { firstResponse: 240,  nextResponse: 480,  resolution: 2880,  internalHandoff: 240 },
      normal: { firstResponse: 480,  nextResponse: 720,  resolution: 5760,  internalHandoff: 480 },
      low:    { firstResponse: 1440, nextResponse: 1440, resolution: 10080, internalHandoff: 1440 }
    },
    // L2/L3 inherit L1 targets (override below if needed)
    L2: null,
    L3: null,

    // Partner-specific SLAs (in minutes)
    // ConnectX: severity mapped from ticket priority (urgent→S1, high→S2, normal→S3, low→S4)
    //   S1/S2 = 24x7, S3/S4 = business hours (6AM-6PM GMT Mon-Fri) — computed as calendar for now
    partner: {
      connectx: {
        urgent: { partnerResponse: 15,   resolution: 60    },  // S1: 15min response, 1h restore
        high:   { partnerResponse: 30,   resolution: 240   },  // S2: 30min response, 4h restore
        normal: { partnerResponse: 240,  resolution: 4320  },  // S3: 4h response, 3d restore (biz hrs)
        low:    { partnerResponse: 480,  resolution: null   }   // S4: 8h response, no restore SLA (biz hrs)
      },
      // Airvet: email-only, weekday/weekend aware (resolved via isWeekend helper)
      airvet: {
        weekday: { resolution: 1440 },  // 24 hours
        weekend: { resolution: 2880 }   // 48 hours
      },
      // AT&T: placeholder — fill in when SLA is available
      att: {
        urgent: { partnerResponse: null, resolution: null },
        high:   { partnerResponse: null, resolution: null },
        normal: { partnerResponse: null, resolution: null },
        low:    { partnerResponse: null, resolution: null }
      }
    }
  };

  // Partner display names
  var PARTNER_NAMES = {
    att: 'AT&T', connectx: 'ConnectX', airvet: 'Airvet'
  };

  // ─── HELPERS ────────────────────────────────────────────────

  function getTicketId() {
    var match = window.location.href.match(/\/agent\/tickets\/(\d+)/);
    return match ? match[1] : null;
  }

  function apiGet(path) {
    return fetch(path, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin'
    }).then(function(r) {
      if (!r.ok) throw new Error('API ' + r.status + ': ' + path);
      return r.json();
    });
  }

  function detectTier(groupName) {
    if (!groupName) return 'L0';
    var lower = groupName.toLowerCase();
    var keys = Object.keys(GROUP_TIER_KEYWORDS);
    for (var i = 0; i < keys.length; i++) {
      if (lower.indexOf(keys[i]) !== -1) return GROUP_TIER_KEYWORDS[keys[i]];
    }
    return 'L0'; // default
  }

  function getTargets(tier, priority) {
    var p = (priority || 'normal').toLowerCase();
    var tierTargets = SLA_TARGETS[tier] || SLA_TARGETS.L1 || SLA_TARGETS.L0;
    return tierTargets[p] || tierTargets.normal;
  }

  function isWeekend() {
    var day = new Date().getDay();
    return day === 0 || day === 6;
  }

  /**
   * Get partner-specific SLA targets, handling per-partner config shapes:
   *   ConnectX → keyed by priority (urgent/high/normal/low)
   *   Airvet   → keyed by weekday/weekend
   *   AT&T     → keyed by priority (placeholder)
   */
  function getPartnerTargets(partner, priority) {
    var cfg = SLA_TARGETS.partner[partner];
    if (!cfg) return null;

    // Airvet: weekday/weekend
    if (cfg.weekday || cfg.weekend) {
      return isWeekend() ? cfg.weekend : cfg.weekday;
    }

    // ConnectX / AT&T: priority-based
    var p = (priority || 'normal').toLowerCase();
    return cfg[p] || cfg.normal || null;
  }

  function formatDuration(ms) {
    var abs = Math.abs(ms);
    var totalSec = Math.floor(abs / 1000);
    var d = Math.floor(totalSec / 86400);
    var h = Math.floor((totalSec % 86400) / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    if (d > 0) return d + 'd ' + h + 'h ' + m + 'm';
    if (h > 0) return h + 'h ' + m + 'm ' + s + 's';
    return m + 'm ' + s + 's';
  }

  function pct(elapsedMs, targetMs) {
    if (targetMs <= 0) return 100;
    return Math.min((elapsedMs / targetMs) * 100, 100);
  }

  function status(elapsedMs, targetMs) {
    var p = pct(elapsedMs, targetMs);
    if (elapsedMs >= targetMs) return 'breached';
    if (p > 85) return 'red';
    if (p > 60) return 'amber';
    return 'green';
  }

  // ─── FIND PARTNER FIELD ─────────────────────────────────────

  function detectPartner(ticket, fieldId) {
    if (!ticket.custom_fields) return null;
    for (var i = 0; i < ticket.custom_fields.length; i++) {
      var f = ticket.custom_fields[i];
      if (fieldId && f.id === fieldId && f.value) return f.value.toLowerCase();
    }
    return null;
  }

  async function findPartnerFieldId() {
    if (PARTNER_FIELD_ID) return PARTNER_FIELD_ID;
    try {
      var data = await apiGet('/api/v2/ticket_fields.json?page[size]=100');
      var fields = data.ticket_fields || [];
      for (var i = 0; i < fields.length; i++) {
        var title = (fields[i].title || '').toLowerCase();
        if (title.indexOf('partner') !== -1 && title.indexOf('escalat') !== -1) {
          return fields[i].id;
        }
        if (title === 'partner escalation') return fields[i].id;
      }
    } catch (e) { /* field not created yet */ }
    return null;
  }

  // ─── COMPUTE NEXT RESPONSE ─────────────────────────────────

  function computeNextResponse(comments, requesterId) {
    // Walk backwards through comments to find last customer message
    // that has no agent reply after it
    var lastCustomerMsg = null;
    var agentRepliedAfter = false;

    for (var i = comments.length - 1; i >= 0; i--) {
      var c = comments[i];
      var isRequester = (c.author_id === requesterId);
      var isPublic = c.public !== false;

      if (!isPublic) continue; // skip internal notes

      if (!lastCustomerMsg && isRequester) {
        lastCustomerMsg = c;
        agentRepliedAfter = false;
      } else if (lastCustomerMsg && !isRequester) {
        agentRepliedAfter = true;
        break;
      }
    }

    if (!lastCustomerMsg) return null;
    if (agentRepliedAfter) return { met: true, elapsed: 0 };

    return {
      met: false,
      since: new Date(lastCustomerMsg.created_at).getTime()
    };
  }

  // ─── FIND ESCALATION TIMESTAMP ─────────────────────────────

  async function findEscalationTimestamp(ticketId) {
    // Look at audits for group change events
    try {
      var data = await apiGet('/api/v2/tickets/' + ticketId + '/audits.json?page[size]=100');
      var audits = data.audits || [];

      // Walk newest to oldest, find the most recent group_id change
      for (var i = audits.length - 1; i >= 0; i--) {
        var events = audits[i].events || [];
        for (var j = 0; j < events.length; j++) {
          if (events[j].field_name === 'group_id' && events[j].previous_value) {
            return new Date(audits[i].created_at).getTime();
          }
        }
      }
    } catch (e) { /* audits not accessible */ }
    return null;
  }

  // ─── MAIN ──────────────────────────────────────────────────

  async function run() {
    var ticketId = getTicketId();
    if (!ticketId) {
      alert('SLA Widget: Not on a Zendesk ticket page.\nNavigate to /agent/tickets/{id}');
      return;
    }

    // Remove existing widget if re-running
    var existing = document.getElementById('sla-sidebar-widget');
    if (existing) existing.remove();
    var existingStyle = document.getElementById('sla-sidebar-style');
    if (existingStyle) existingStyle.remove();

    // Show loading indicator
    injectStyles();
    var panel = createPanel();
    panel.querySelector('.sla-w-body').innerHTML = '<div class="sla-w-loading">Loading SLA data...</div>';

    // Fetch data in parallel
    var partnerFieldId = await findPartnerFieldId();

    var results = await Promise.all([
      apiGet('/api/v2/tickets/' + ticketId + '.json'),
      apiGet('/api/v2/tickets/' + ticketId + '/metrics.json'),
      apiGet('/api/v2/tickets/' + ticketId + '/comments.json?sort_order=asc')
    ]);

    var ticket = results[0].ticket;
    var metrics = results[1].ticket_metric;
    var comments = (results[2].comments || []);

    // Detect group / tier
    var groupName = '';
    if (ticket.group_id) {
      try {
        var gData = await apiGet('/api/v2/groups/' + ticket.group_id + '.json');
        groupName = gData.group.name || '';
      } catch (e) {}
    }
    var tier = detectTier(groupName);

    // Detect partner
    var partner = detectPartner(ticket, partnerFieldId);
    var partnerName = partner ? (PARTNER_NAMES[partner] || partner) : null;

    // Determine path
    var path;
    if (partner) {
      path = 'Partner → ' + partnerName;
    } else if (tier !== 'L0') {
      path = 'Escalated → ' + tier;
    } else {
      path = 'L0 Direct';
    }

    var priority = ticket.priority || 'normal';
    var targets = getTargets(tier, priority);
    var now = Date.now();
    var createdAt = new Date(ticket.created_at).getTime();

    // ─── Build SLA metric objects ────────────────────────

    var slaMetrics = [];

    // 1. First Response
    var replyMetric = metrics ? metrics.reply_time_in_minutes : null;
    if (replyMetric) {
      var replySrc = replyMetric.business || replyMetric.calendar;
      if (replySrc) {
        var targetMs = (targets.firstResponse || 480) * 60000;
        if (replySrc.breach_at) {
          var breachAt = new Date(replySrc.breach_at).getTime();
          var remaining = breachAt - now;
          var elapsed = targetMs - Math.max(remaining, 0);
          slaMetrics.push({
            label: '1st Response',
            targetMs: targetMs,
            elapsedMs: Math.max(elapsed, 0),
            breachAt: breachAt,
            met: false
          });
        } else if (replySrc.elapsed !== undefined && replySrc.elapsed !== null) {
          slaMetrics.push({
            label: '1st Response',
            targetMs: targetMs,
            elapsedMs: replySrc.elapsed * 60000,
            breachAt: null,
            met: true
          });
        }
      }
    }
    if (slaMetrics.length === 0) {
      // Fallback: compute from created_at
      var frTargetMs = (targets.firstResponse || 480) * 60000;
      slaMetrics.push({
        label: '1st Response',
        targetMs: frTargetMs,
        elapsedMs: now - createdAt,
        breachAt: createdAt + frTargetMs,
        met: false
      });
    }

    // 2. Next Response
    var nextResp = computeNextResponse(comments, ticket.requester_id);
    var nrTargetMs = (targets.nextResponse || 720) * 60000;
    if (nextResp) {
      if (nextResp.met) {
        slaMetrics.push({
          label: 'Next Response',
          targetMs: nrTargetMs,
          elapsedMs: 0,
          breachAt: null,
          met: true
        });
      } else {
        var nrElapsed = now - nextResp.since;
        slaMetrics.push({
          label: 'Next Response',
          targetMs: nrTargetMs,
          elapsedMs: nrElapsed,
          breachAt: nextResp.since + nrTargetMs,
          met: false
        });
      }
    }

    // 3. Resolution
    var resMetric = metrics ? metrics.full_resolution_time_in_minutes : null;
    var resTargetMs = (targets.resolution || 2880) * 60000;
    if (resMetric) {
      var resSrc = resMetric.business || resMetric.calendar;
      if (resSrc && resSrc.breach_at) {
        var resBreachAt = new Date(resSrc.breach_at).getTime();
        var resRemaining = resBreachAt - now;
        var resElapsed = resTargetMs - Math.max(resRemaining, 0);
        slaMetrics.push({
          label: 'Resolution',
          targetMs: resTargetMs,
          elapsedMs: Math.max(resElapsed, 0),
          breachAt: resBreachAt,
          met: false
        });
      } else if (resSrc && resSrc.elapsed !== undefined) {
        slaMetrics.push({
          label: 'Resolution',
          targetMs: resTargetMs,
          elapsedMs: resSrc.elapsed * 60000,
          breachAt: null,
          met: ticket.status === 'solved' || ticket.status === 'closed'
        });
      }
    }
    if (!slaMetrics.find(function(m) { return m.label === 'Resolution'; })) {
      slaMetrics.push({
        label: 'Resolution',
        targetMs: resTargetMs,
        elapsedMs: now - createdAt,
        breachAt: createdAt + resTargetMs,
        met: ticket.status === 'solved' || ticket.status === 'closed'
      });
    }

    // 4. Internal Handoff (L1-3 only)
    if (tier !== 'L0' && targets.internalHandoff) {
      var escTimestamp = await findEscalationTimestamp(ticketId);
      if (escTimestamp) {
        var ihTargetMs = targets.internalHandoff * 60000;
        var ihElapsed = now - escTimestamp;
        // Check if there's been an agent reply from the new group after escalation
        var repliedAfterEsc = false;
        for (var ci = 0; ci < comments.length; ci++) {
          var ct = new Date(comments[ci].created_at).getTime();
          if (ct > escTimestamp && comments[ci].author_id !== ticket.requester_id && comments[ci].public !== false) {
            repliedAfterEsc = true;
            ihElapsed = ct - escTimestamp;
            break;
          }
        }
        slaMetrics.push({
          label: tier + ' Handoff',
          targetMs: ihTargetMs,
          elapsedMs: ihElapsed,
          breachAt: repliedAfterEsc ? null : escTimestamp + ihTargetMs,
          met: repliedAfterEsc
        });
      }
    }

    // 5. Partner SLAs (if partner escalation)
    if (partner && SLA_TARGETS.partner[partner]) {
      var pTargets = getPartnerTargets(partner, priority);
      var pStart = await findEscalationTimestamp(ticketId) || createdAt;
      var pElapsed = now - pStart;

      // Partner Initial Response SLA (ConnectX / AT&T)
      if (pTargets && pTargets.partnerResponse) {
        var prTargetMs = pTargets.partnerResponse * 60000;
        slaMetrics.push({
          label: partnerName + ' Response',
          targetMs: prTargetMs,
          elapsedMs: pElapsed,
          breachAt: pStart + prTargetMs,
          met: false
        });
      }

      // Partner Resolution / Restore SLA (all partners)
      if (pTargets && pTargets.resolution) {
        var pResTargetMs = pTargets.resolution * 60000;
        slaMetrics.push({
          label: partnerName + ' Resolve',
          targetMs: pResTargetMs,
          elapsedMs: pElapsed,
          breachAt: pStart + pResTargetMs,
          met: ticket.status === 'solved' || ticket.status === 'closed'
        });
      }

      // AT&T placeholder — show notice if no targets configured yet
      if (pTargets && !pTargets.partnerResponse && !pTargets.resolution) {
        slaMetrics.push({
          label: partnerName + ' SLA',
          targetMs: 0,
          elapsedMs: 0,
          breachAt: null,
          met: false,
          placeholder: true
        });
      }
    }

    // ─── Render ──────────────────────────────────────────
    renderMetrics(panel, slaMetrics, path, tier, priority, ticket.status);

    // ─── Live countdown ─────────────────────────────────
    if (window._slaInterval) clearInterval(window._slaInterval);
    window._slaInterval = setInterval(function() {
      var n = Date.now();
      slaMetrics.forEach(function(m) {
        if (m.met || !m.breachAt) return;
        m.elapsedMs = m.targetMs - Math.max(m.breachAt - n, 0);
        if (m.elapsedMs > m.targetMs) m.elapsedMs = n - (m.breachAt - m.targetMs);
      });
      renderBars(panel, slaMetrics);
    }, 1000);
  }

  // ─── RENDERING ─────────────────────────────────────────────

  function createPanel() {
    var panel = document.createElement('div');
    panel.id = 'sla-sidebar-widget';
    panel.innerHTML =
      '<div class="sla-w-header">' +
        '<span class="sla-w-title">SLA Status</span>' +
        '<button class="sla-w-close" onclick="document.getElementById(\'sla-sidebar-widget\').remove();clearInterval(window._slaInterval);">&times;</button>' +
      '</div>' +
      '<div class="sla-w-body"></div>';
    document.body.appendChild(panel);
    return panel;
  }

  function renderMetrics(panel, metrics, path, tier, priority, ticketStatus) {
    var body = panel.querySelector('.sla-w-body');
    var html = '';

    // Path badge
    var pathClass = tier === 'L0' ? 'sla-w-badge-blue' : (path.indexOf('Partner') === 0 ? 'sla-w-badge-purple' : 'sla-w-badge-orange');
    html += '<div class="sla-w-meta">' +
      '<span class="sla-w-badge ' + pathClass + '">' + path + '</span>' +
      '<span class="sla-w-badge sla-w-badge-gray">' + priority.toUpperCase() + '</span>' +
      (ticketStatus === 'solved' || ticketStatus === 'closed' ? '<span class="sla-w-badge sla-w-badge-green">SOLVED</span>' : '') +
    '</div>';

    // Separator between core SLAs and internal/partner SLAs
    var coreDone = false;

    var coreLabels = { '1st Response': 1, 'Next Response': 1, 'Resolution': 1 };

    metrics.forEach(function(m) {
      if (!coreLabels[m.label] && !coreDone) {
        html += '<div class="sla-w-divider"></div>';
        coreDone = true;
      }

      // AT&T placeholder — no SLA configured yet
      if (m.placeholder) {
        html +=
          '<div class="sla-w-metric" data-label="' + m.label + '">' +
            '<div class="sla-w-metric-hdr">' +
              '<span class="sla-w-metric-lbl">' + m.label + '</span>' +
              '<span class="sla-w-metric-time" style="color:#87929d">Not configured</span>' +
            '</div>' +
          '</div>';
        return;
      }

      var st = m.met ? 'met' : status(m.elapsedMs, m.targetMs);
      var p = m.met ? 100 : pct(m.elapsedMs, m.targetMs);
      var timeText;

      if (m.met) {
        timeText = 'Met' + (m.elapsedMs > 0 ? ' (' + formatDuration(m.elapsedMs) + ')' : '');
      } else if (m.elapsedMs >= m.targetMs) {
        timeText = 'BREACHED ' + formatDuration(m.elapsedMs - m.targetMs) + ' ago';
      } else {
        timeText = formatDuration(m.targetMs - m.elapsedMs) + ' left';
      }

      html +=
        '<div class="sla-w-metric sla-w-st-' + st + '" data-label="' + m.label + '">' +
          '<div class="sla-w-metric-hdr">' +
            '<span class="sla-w-metric-lbl">' + m.label + '</span>' +
            '<span class="sla-w-metric-time">' + timeText + '</span>' +
          '</div>' +
          '<div class="sla-w-bar-bg">' +
            '<div class="sla-w-bar-fill" style="width:' + p + '%"></div>' +
          '</div>' +
        '</div>';
    });

    body.innerHTML = html;
  }

  function renderBars(panel, metrics) {
    metrics.forEach(function(m) {
      var el = panel.querySelector('[data-label="' + m.label + '"]');
      if (!el) return;

      var st = m.met ? 'met' : status(m.elapsedMs, m.targetMs);
      var p = m.met ? 100 : pct(m.elapsedMs, m.targetMs);
      var timeText;

      if (m.met) {
        timeText = 'Met' + (m.elapsedMs > 0 ? ' (' + formatDuration(m.elapsedMs) + ')' : '');
      } else if (m.elapsedMs >= m.targetMs) {
        timeText = 'BREACHED ' + formatDuration(m.elapsedMs - m.targetMs) + ' ago';
      } else {
        timeText = formatDuration(m.targetMs - m.elapsedMs) + ' left';
      }

      el.className = 'sla-w-metric sla-w-st-' + st;
      el.querySelector('.sla-w-metric-time').textContent = timeText;
      el.querySelector('.sla-w-bar-fill').style.width = p + '%';
    });
  }

  // ─── STYLES ────────────────────────────────────────────────

  function injectStyles() {
    var style = document.createElement('style');
    style.id = 'sla-sidebar-style';
    style.textContent =
      '#sla-sidebar-widget {' +
        'position:fixed;top:60px;right:16px;width:300px;z-index:999999;' +
        'background:#fff;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.18);' +
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:13px;color:#2f3941;' +
        'overflow:hidden;' +
      '}' +
      '.sla-w-header {' +
        'display:flex;justify-content:space-between;align-items:center;' +
        'padding:12px 16px;background:linear-gradient(135deg,#1f73b7,#144a75);color:#fff;' +
      '}' +
      '.sla-w-title{font-weight:700;font-size:14px}' +
      '.sla-w-close{background:none;border:none;color:#fff;font-size:20px;cursor:pointer;padding:0 4px;line-height:1;opacity:.8}' +
      '.sla-w-close:hover{opacity:1}' +
      '.sla-w-body{padding:14px 16px;max-height:70vh;overflow-y:auto}' +
      '.sla-w-loading{text-align:center;padding:20px;color:#68737d}' +
      '.sla-w-meta{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}' +
      '.sla-w-badge{font-size:10px;padding:3px 8px;border-radius:10px;font-weight:600}' +
      '.sla-w-badge-blue{background:#edf7ff;color:#1f73b7}' +
      '.sla-w-badge-orange{background:#fff5e6;color:#c96400}' +
      '.sla-w-badge-purple{background:#f3e8ff;color:#6a27b8}' +
      '.sla-w-badge-gray{background:#f0f2f3;color:#68737d}' +
      '.sla-w-badge-green{background:#edf8f4;color:#038153}' +
      '.sla-w-divider{height:1px;background:#e9ebed;margin:12px 0}' +
      '.sla-w-metric{margin-bottom:12px}' +
      '.sla-w-metric:last-child{margin-bottom:0}' +
      '.sla-w-metric-hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:4px}' +
      '.sla-w-metric-lbl{font-size:11px;font-weight:500;color:#68737d}' +
      '.sla-w-metric-time{font-size:11px;font-weight:700;font-variant-numeric:tabular-nums}' +
      '.sla-w-bar-bg{height:6px;background:#e9ebed;border-radius:3px;overflow:hidden}' +
      '.sla-w-bar-fill{height:100%;border-radius:3px;transition:width 1s linear;min-width:2px}' +
      '.sla-w-st-green .sla-w-bar-fill{background:#038153}' +
      '.sla-w-st-green .sla-w-metric-time{color:#038153}' +
      '.sla-w-st-amber .sla-w-bar-fill{background:#c96400}' +
      '.sla-w-st-amber .sla-w-metric-time{color:#c96400}' +
      '.sla-w-st-red .sla-w-bar-fill{background:#cc3340}' +
      '.sla-w-st-red .sla-w-metric-time{color:#cc3340}' +
      '.sla-w-st-breached .sla-w-bar-fill{background:#cc3340}' +
      '.sla-w-st-breached .sla-w-metric-time{color:#cc3340;animation:sla-pulse 1.5s infinite}' +
      '.sla-w-st-breached .sla-w-metric-lbl{color:#cc3340;font-weight:600}' +
      '.sla-w-st-met .sla-w-bar-fill{background:#038153}' +
      '.sla-w-st-met .sla-w-metric-time{color:#038153}' +
      '@keyframes sla-pulse{0%,100%{opacity:1}50%{opacity:.5}}';
    document.head.appendChild(style);
  }

  // ─── GO ────────────────────────────────────────────────────
  run().catch(function(err) {
    console.error('SLA Widget Error:', err);
    var panel = document.getElementById('sla-sidebar-widget');
    if (panel) {
      panel.querySelector('.sla-w-body').innerHTML =
        '<div style="color:#cc3340;padding:12px;text-align:center">' +
          '<strong>Error loading SLA</strong><br>' + (err.message || err) +
        '</div>';
    }
  });

})();
