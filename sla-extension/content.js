/**
 * Zendesk SLA Sidebar — Chrome Extension Content Script
 *
 * Auto-runs on every Zendesk ticket page. Detects ticket ID from URL,
 * fetches SLA metrics, and renders a floating sidebar panel.
 *
 * Detection:
 *   Tier    → ticket assigned group name (L0 / L1 / L2 / L3)
 *   Partner → custom ticket field "Partner Escalation" (ConnectX / Airvet / AT&T)
 */
(function() {
  'use strict';

  // ─── CONFIGURATION ──────────────────────────────────────────

  var PARTNER_FIELD_ID = null; // Set to your custom field ID, or leave null for auto-detect

  var GROUP_TIER_KEYWORDS = {
    'l0': 'L0', 'tier 0': 'L0', 'tier0': 'L0', 'level 0': 'L0',
    'l1': 'L1', 'tier 1': 'L1', 'tier1': 'L1', 'level 1': 'L1',
    'l2': 'L2', 'tier 2': 'L2', 'tier2': 'L2', 'level 2': 'L2',
    'l3': 'L3', 'tier 3': 'L3', 'tier3': 'L3', 'level 3': 'L3', 'engineering': 'L3'
  };

  var SLA_TARGETS = {
    // L0: 30m first response for urgent/high, 60m for normal/low
    L0: {
      urgent: { firstResponse: 30, nextResponse: 240,  resolution: 60 },
      high:   { firstResponse: 30, nextResponse: 480,  resolution: 60 },
      normal: { firstResponse: 60, nextResponse: 720,  resolution: 120 },
      low:    { firstResponse: 60, nextResponse: 1440, resolution: 120 }
    },
    // L1-3: 60m first response, 4h resolution across all priorities
    L1: {
      urgent: { firstResponse: 60, nextResponse: 240,  resolution: 240,  internalHandoff: 120 },
      high:   { firstResponse: 60, nextResponse: 480,  resolution: 240,  internalHandoff: 240 },
      normal: { firstResponse: 60, nextResponse: 720,  resolution: 240,  internalHandoff: 480 },
      low:    { firstResponse: 60, nextResponse: 1440, resolution: 240,  internalHandoff: 1440 }
    },
    L2: null, // inherits L1
    L3: null, // inherits L1

    partner: {
      connectx: {
        urgent: { partnerResponse: 15,   resolution: 60    },
        high:   { partnerResponse: 30,   resolution: 240   },
        normal: { partnerResponse: 240,  resolution: 4320  },
        low:    { partnerResponse: 480,  resolution: null   }
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

  var PARTNER_NAMES = {
    att: 'AT&T', connectx: 'ConnectX', airvet: 'Airvet'
  };

  // ─── STATE ─────────────────────────────────────────────────

  var _slaInterval = null;
  var _currentTicketId = null;
  var _urlCheckInterval = null;

  // ─── HELPERS ───────────────────────────────────────────────

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
    return 'L0';
  }

  function getTargets(tier, priority, groupName) {
    // Unassigned tickets follow L0 high priority SLA
    if (!groupName) return SLA_TARGETS.L0.high;
    var p = (priority || 'normal').toLowerCase();
    var tierTargets = SLA_TARGETS[tier] || SLA_TARGETS.L1 || SLA_TARGETS.L0;
    return tierTargets[p] || tierTargets.normal;
  }

  function isWeekend() {
    var day = new Date().getDay();
    return day === 0 || day === 6;
  }

  function getPartnerTargets(partner, priority) {
    var cfg = SLA_TARGETS.partner[partner];
    if (!cfg) return null;
    if (cfg.weekday || cfg.weekend) {
      return isWeekend() ? cfg.weekend : cfg.weekday;
    }
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

  function slaStatus(elapsedMs, targetMs) {
    var p = pct(elapsedMs, targetMs);
    if (elapsedMs >= targetMs) return 'breached';
    if (p > 85) return 'red';
    if (p > 60) return 'amber';
    return 'green';
  }

  // ─── PARTNER FIELD DETECTION ───────────────────────────────

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
        if (title.indexOf('partner') !== -1 && title.indexOf('escalat') !== -1) return fields[i].id;
        if (title === 'partner escalation') return fields[i].id;
      }
    } catch (e) { /* field not created yet */ }
    return null;
  }

  // ─── NEXT RESPONSE CALCULATION ─────────────────────────────

  function computeNextResponse(comments, requesterId) {
    var lastCustomerMsg = null;
    var agentRepliedAfter = false;

    for (var i = comments.length - 1; i >= 0; i--) {
      var c = comments[i];
      var isRequester = (c.author_id === requesterId);
      if (c.public === false) continue;

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
    return { met: false, since: new Date(lastCustomerMsg.created_at).getTime() };
  }

  // ─── ESCALATION TIMESTAMP ─────────────────────────────────

  async function findEscalationTimestamp(ticketId) {
    try {
      var data = await apiGet('/api/v2/tickets/' + ticketId + '/audits.json?page[size]=100');
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

  // ─── CLEANUP ───────────────────────────────────────────────

  function cleanup() {
    if (_slaInterval) { clearInterval(_slaInterval); _slaInterval = null; }
    var existing = document.getElementById('sla-sidebar-widget');
    if (existing) existing.remove();
  }

  // ─── MAIN ─────────────────────────────────────────────────

  async function loadSla(ticketId) {
    cleanup();
    _currentTicketId = ticketId;

    var panel = createPanel();
    panel.querySelector('.sla-w-body').innerHTML = '<div class="sla-w-loading">Loading SLA data...</div>';

    try {
      var partnerFieldId = await findPartnerFieldId();

      var results = await Promise.all([
        apiGet('/api/v2/tickets/' + ticketId + '.json'),
        apiGet('/api/v2/tickets/' + ticketId + '/metrics.json'),
        apiGet('/api/v2/tickets/' + ticketId + '/comments.json?sort_order=asc')
      ]);

      // Bail if user navigated away during fetch
      if (getTicketId() !== ticketId) { cleanup(); return; }

      var ticket = results[0].ticket;
      var metrics = results[1].ticket_metric;
      var comments = results[2].comments || [];

      // Detect tier from group
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

      var path;
      if (partner) {
        path = 'Partner \u2192 ' + partnerName;
      } else if (tier !== 'L0') {
        path = 'Escalated \u2192 ' + tier;
      } else {
        path = 'L0 Direct';
      }

      var priority = ticket.priority || 'normal';
      var targets = getTargets(tier, priority, groupName);
      var now = Date.now();
      var createdAt = new Date(ticket.created_at).getTime();
      var displayGroupName = groupName || 'Unassigned';

      // ── Build SLA metrics ──────────────────────────────

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
            slaMetrics.push({ label: '1st Response', targetMs: targetMs, elapsedMs: Math.max(elapsed, 0), breachAt: breachAt, met: false });
          } else if (replySrc.elapsed !== undefined && replySrc.elapsed !== null) {
            slaMetrics.push({ label: '1st Response', targetMs: targetMs, elapsedMs: replySrc.elapsed * 60000, breachAt: null, met: true });
          }
        }
      }
      if (slaMetrics.length === 0) {
        var frTargetMs = (targets.firstResponse || 480) * 60000;
        slaMetrics.push({ label: '1st Response', targetMs: frTargetMs, elapsedMs: now - createdAt, breachAt: createdAt + frTargetMs, met: false });
      }

      // 2. Next Response
      var frMetric = slaMetrics[0];
      // Treat as breached if elapsed >= 99.5% of target (covers ms-level race)
      var frBreached = frMetric && !frMetric.met && (frMetric.elapsedMs >= frMetric.targetMs || (frMetric.targetMs > 0 && frMetric.elapsedMs / frMetric.targetMs >= 0.995));
      var nextResp = computeNextResponse(comments, ticket.requester_id);
      var nrTargetMs = (targets.nextResponse || 720) * 60000;
      if (frBreached && (!nextResp || !nextResp.met)) {
        // 1st response breached → next response is IMMEDIATE
        slaMetrics.push({ label: 'Next Response', targetMs: 0, elapsedMs: 1, breachAt: now, met: false, immediate: true });
      } else if (nextResp) {
        if (nextResp.met) {
          slaMetrics.push({ label: 'Next Response', targetMs: nrTargetMs, elapsedMs: 0, breachAt: null, met: true });
        } else {
          var nrElapsed = now - nextResp.since;
          slaMetrics.push({ label: 'Next Response', targetMs: nrTargetMs, elapsedMs: nrElapsed, breachAt: nextResp.since + nrTargetMs, met: false });
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
          slaMetrics.push({ label: 'Resolution', targetMs: resTargetMs, elapsedMs: Math.max(resElapsed, 0), breachAt: resBreachAt, met: false });
        } else if (resSrc && resSrc.elapsed !== undefined) {
          slaMetrics.push({ label: 'Resolution', targetMs: resTargetMs, elapsedMs: resSrc.elapsed * 60000, breachAt: null, met: ticket.status === 'solved' || ticket.status === 'closed' });
        }
      }
      if (!slaMetrics.find(function(m) { return m.label === 'Resolution'; })) {
        slaMetrics.push({ label: 'Resolution', targetMs: resTargetMs, elapsedMs: now - createdAt, breachAt: createdAt + resTargetMs, met: ticket.status === 'solved' || ticket.status === 'closed' });
      }

      // 4. Internal Handoff (L1-3)
      if (tier !== 'L0' && targets.internalHandoff) {
        var escTimestamp = await findEscalationTimestamp(ticketId);
        if (escTimestamp) {
          var ihTargetMs = targets.internalHandoff * 60000;
          var ihElapsed = now - escTimestamp;
          var repliedAfterEsc = false;
          for (var ci = 0; ci < comments.length; ci++) {
            var ct = new Date(comments[ci].created_at).getTime();
            if (ct > escTimestamp && comments[ci].author_id !== ticket.requester_id && comments[ci].public !== false) {
              repliedAfterEsc = true;
              ihElapsed = ct - escTimestamp;
              break;
            }
          }
          slaMetrics.push({ label: tier + ' Handoff', targetMs: ihTargetMs, elapsedMs: ihElapsed, breachAt: repliedAfterEsc ? null : escTimestamp + ihTargetMs, met: repliedAfterEsc });
        }
      }

      // 5. Partner SLAs
      if (partner && SLA_TARGETS.partner[partner]) {
        var pTargets = getPartnerTargets(partner, priority);
        var pStart = await findEscalationTimestamp(ticketId) || createdAt;
        var pElapsed = now - pStart;

        if (pTargets && pTargets.partnerResponse) {
          var prTargetMs = pTargets.partnerResponse * 60000;
          slaMetrics.push({ label: partnerName + ' Response', targetMs: prTargetMs, elapsedMs: pElapsed, breachAt: pStart + prTargetMs, met: false });
        }
        if (pTargets && pTargets.resolution) {
          var pResTargetMs = pTargets.resolution * 60000;
          slaMetrics.push({ label: partnerName + ' Resolve', targetMs: pResTargetMs, elapsedMs: pElapsed, breachAt: pStart + pResTargetMs, met: ticket.status === 'solved' || ticket.status === 'closed' });
        }
        if (pTargets && !pTargets.partnerResponse && !pTargets.resolution) {
          slaMetrics.push({ label: partnerName + ' SLA', targetMs: 0, elapsedMs: 0, breachAt: null, met: false, placeholder: true });
        }
      }

      // ── Render ────────────────────────────────────────
      renderMetrics(panel, slaMetrics, path, tier, priority, ticket.status, displayGroupName);

      // ── Live countdown ────────────────────────────────
      _slaInterval = setInterval(function() {
        if (getTicketId() !== ticketId) { cleanup(); return; }
        var n = Date.now();
        slaMetrics.forEach(function(m) {
          if (m.met || m.immediate || !m.breachAt) return;
          m.elapsedMs = m.targetMs - Math.max(m.breachAt - n, 0);
          if (m.elapsedMs > m.targetMs) m.elapsedMs = n - (m.breachAt - m.targetMs);
        });
        // If 1st response just crossed into breach, flip Next Response to IMMEDIATE
        var fr = slaMetrics[0];
        if (fr && !fr.met && fr.elapsedMs >= fr.targetMs) {
          for (var si = 0; si < slaMetrics.length; si++) {
            if (slaMetrics[si].label === 'Next Response' && !slaMetrics[si].met && !slaMetrics[si].immediate) {
              slaMetrics[si].immediate = true;
              slaMetrics[si].targetMs = 0;
              slaMetrics[si].elapsedMs = 1;
              slaMetrics[si].breachAt = n;
              break;
            }
          }
        }
        renderBars(panel, slaMetrics);
      }, 1000);

    } catch (err) {
      console.error('SLA Extension Error:', err);
      var body = panel.querySelector('.sla-w-body');
      if (body) {
        body.innerHTML = '<div style="color:#cc3340;padding:12px;text-align:center"><strong>Error loading SLA</strong><br>' + (err.message || err) + '</div>';
      }
    }
  }

  // ─── RENDERING ─────────────────────────────────────────────

  function createPanel() {
    var panel = document.createElement('div');
    panel.id = 'sla-sidebar-widget';
    panel.innerHTML =
      '<div class="sla-w-header">' +
        '<span class="sla-w-title">SLA Status</span>' +
        '<button class="sla-w-close" id="sla-close-btn">&times;</button>' +
      '</div>' +
      '<div class="sla-w-body"></div>';
    document.body.appendChild(panel);

    document.getElementById('sla-close-btn').addEventListener('click', function() {
      cleanup();
      // Don't reload until next navigation
      _currentTicketId = '__dismissed__';
    });

    return panel;
  }

  function renderMetrics(panel, metrics, path, tier, priority, ticketStatus, groupName) {
    var body = panel.querySelector('.sla-w-body');
    var header = panel.querySelector('.sla-w-header');
    var html = '';

    // Color the header gradient based on ticket path
    var isSolved = ticketStatus === 'solved' || ticketStatus === 'closed';
    var isPartner = path.indexOf('Partner') === 0;
    var isEscalated = tier !== 'L0';

    if (isSolved) {
      header.style.background = 'linear-gradient(135deg, #038153, #025a3a)';
    } else if (isPartner) {
      header.style.background = 'linear-gradient(135deg, #6a27b8, #4a1a80)';
    } else if (isEscalated) {
      header.style.background = 'linear-gradient(135deg, #c96400, #8f4700)';
    } else {
      header.style.background = 'linear-gradient(135deg, #1f73b7, #144a75)';
    }

    // Current location: group name
    html += '<div style="margin-bottom:10px;font-size:11px;color:#68737d;">' +
      'Assigned to: <strong style="color:#2f3941;">' + (groupName || 'Unassigned') + '</strong>' +
    '</div>';

    var pathClass = tier === 'L0' ? 'sla-w-badge-blue' : (isPartner ? 'sla-w-badge-purple' : 'sla-w-badge-orange');
    html += '<div class="sla-w-meta">' +
      '<span class="sla-w-badge ' + pathClass + '">' + path + '</span>' +
      '<span class="sla-w-badge sla-w-badge-gray">' + priority.toUpperCase() + '</span>' +
      '<span class="sla-w-badge sla-w-badge-gray">SLA: ' + (tier === 'L0' ? '30m' : '1h') + '</span>' +
      (isSolved ? '<span class="sla-w-badge sla-w-badge-green">SOLVED</span>' : '') +
    '</div>';

    var coreLabels = { '1st Response': 1, 'Next Response': 1, 'Resolution': 1 };
    var coreDone = false;

    metrics.forEach(function(m) {
      if (!coreLabels[m.label] && !coreDone) {
        html += '<div class="sla-w-divider"></div>';
        coreDone = true;
      }

      if (m.placeholder) {
        html += '<div class="sla-w-metric" data-label="' + m.label + '">' +
          '<div class="sla-w-metric-hdr">' +
            '<span class="sla-w-metric-lbl">' + m.label + '</span>' +
            '<span class="sla-w-metric-time" style="color:#87929d">Not configured</span>' +
          '</div></div>';
        return;
      }

      var st = m.immediate ? 'breached' : (m.met ? 'met' : slaStatus(m.elapsedMs, m.targetMs));
      var p = m.immediate ? 100 : (m.met ? 100 : pct(m.elapsedMs, m.targetMs));
      var timeText = getTimeText(m);
      // Resolution status tag
      var statusTag = '';
      if (m.label === 'Resolution' && !m.met) {
        if (m.elapsedMs >= m.targetMs) statusTag = ' <span style="display:inline-block;padding:1px 5px;border-radius:3px;font-size:8px;font-weight:700;background:#fce4e6;color:#8c232c;vertical-align:middle;margin-left:3px">BREACHED</span>';
        else if (pct(m.elapsedMs, m.targetMs) > 75) statusTag = ' <span style="display:inline-block;padding:1px 5px;border-radius:3px;font-size:8px;font-weight:700;background:#fff6e5;color:#ad5e00;vertical-align:middle;margin-left:3px">NEARING BREACH</span>';
        else statusTag = ' <span style="display:inline-block;padding:1px 5px;border-radius:3px;font-size:8px;font-weight:700;background:#edf8f4;color:#038153;vertical-align:middle;margin-left:3px">HEALTHY</span>';
      }

      html += '<div class="sla-w-metric sla-w-st-' + st + '" data-label="' + m.label + '">' +
        '<div class="sla-w-metric-hdr">' +
          '<span class="sla-w-metric-lbl">' + m.label + statusTag + '</span>' +
          '<span class="sla-w-metric-time">' + timeText + '</span>' +
        '</div>' +
        '<div class="sla-w-bar-bg">' +
          '<div class="sla-w-bar-fill" style="width:' + p + '%"></div>' +
        '</div></div>';
    });

    body.innerHTML = html;
  }

  function renderBars(panel, metrics) {
    metrics.forEach(function(m) {
      if (m.placeholder) return;
      var el = panel.querySelector('[data-label="' + m.label + '"]');
      if (!el) return;

      var st = m.immediate ? 'breached' : (m.met ? 'met' : slaStatus(m.elapsedMs, m.targetMs));
      var p = m.immediate ? 100 : (m.met ? 100 : pct(m.elapsedMs, m.targetMs));

      el.className = 'sla-w-metric sla-w-st-' + st;
      el.querySelector('.sla-w-metric-time').textContent = getTimeText(m);
      el.querySelector('.sla-w-bar-fill').style.width = p + '%';
      // Update resolution status tag
      if (m.label === 'Resolution') {
        var lblEl = el.querySelector('.sla-w-metric-lbl');
        var tag = '';
        if (!m.met) {
          if (m.elapsedMs >= m.targetMs) tag = ' <span style="display:inline-block;padding:1px 5px;border-radius:3px;font-size:8px;font-weight:700;background:#fce4e6;color:#8c232c;vertical-align:middle;margin-left:3px">BREACHED</span>';
          else if (pct(m.elapsedMs, m.targetMs) > 75) tag = ' <span style="display:inline-block;padding:1px 5px;border-radius:3px;font-size:8px;font-weight:700;background:#fff6e5;color:#ad5e00;vertical-align:middle;margin-left:3px">NEARING BREACH</span>';
          else tag = ' <span style="display:inline-block;padding:1px 5px;border-radius:3px;font-size:8px;font-weight:700;background:#edf8f4;color:#038153;vertical-align:middle;margin-left:3px">HEALTHY</span>';
        }
        lblEl.innerHTML = 'Resolution' + tag;
      }
    });
  }

  function getTimeText(m) {
    if (m.immediate) return 'IMMEDIATE \u2014 respond now';
    if (m.met) return 'Met' + (m.elapsedMs > 0 ? ' (' + formatDuration(m.elapsedMs) + ')' : '');
    if (m.elapsedMs >= m.targetMs) return 'BREACHED ' + formatDuration(m.elapsedMs - m.targetMs) + ' ago';
    return formatDuration(m.targetMs - m.elapsedMs) + ' left';
  }

  // ─── SPA NAVIGATION WATCHER ────────────────────────────────
  // Zendesk is a SPA — URL changes without page reload.
  // Poll for ticket ID changes and reload SLA when navigating between tickets.

  function watchNavigation() {
    _urlCheckInterval = setInterval(function() {
      var ticketId = getTicketId();

      if (ticketId && ticketId !== _currentTicketId) {
        loadSla(ticketId);
      } else if (!ticketId && _currentTicketId && _currentTicketId !== '__dismissed__') {
        cleanup();
        _currentTicketId = null;
      }
    }, 1500);
  }

  // ─── INIT ──────────────────────────────────────────────────

  var ticketId = getTicketId();
  if (ticketId) {
    loadSla(ticketId);
  }
  watchNavigation();

})();
