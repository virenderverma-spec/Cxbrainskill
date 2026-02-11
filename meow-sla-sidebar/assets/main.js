/**
 * Meow SLA Sidebar — Zendesk App
 * Shows SLA status for the current ticket based on assigned team.
 */

var client;
var ticketData = {};
var escalationHistory = null;
var expanded = false;
var refreshInterval = null;
var mttrCache = null; // cached MTTR so we don't re-fetch every 60s

// ─── SLA Matrix (all values in minutes) ────────────────────────
var SLA_MATRIX = {
  L0: {
    urgent: { firstResponse: 30, resolution: 60 },
    high:   { firstResponse: 30, resolution: 60 },
    normal: { firstResponse: 60, resolution: 120 },
    low:    { firstResponse: 60, resolution: 120 }
  },
  'L1-L3': {
    urgent: { firstResponse: 60, resolution: 240 },
    high:   { firstResponse: 60, resolution: 240 },
    normal: { firstResponse: 60, resolution: 240 },
    low:    { firstResponse: 60, resolution: 240 }
  },
  ConnectX: {
    urgent: { firstResponse: 120, resolution: 480 },
    high:   { firstResponse: 240, resolution: 960 },
    normal: { firstResponse: 480, resolution: 1440 },
    low:    { firstResponse: 480, resolution: 2880 }
  },
  'AT&T': {
    urgent: { firstResponse: 120, resolution: 480 },
    high:   { firstResponse: 240, resolution: 960 },
    normal: { firstResponse: 480, resolution: 1440 },
    low:    { firstResponse: 720, resolution: 2880 }
  },
  Airvet: {
    urgent: { firstResponse: 60, resolution: 240 },
    high:   { firstResponse: 120, resolution: 480 },
    normal: { firstResponse: 240, resolution: 1440 },
    low:    { firstResponse: 480, resolution: 2880 }
  }
};

// ─── Init ──────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function() {
  client = ZAFClient.init();
  client.invoke('resize', { width: '100%', height: '450px' });
  loadTicket();

  // Auto-refresh every 60 seconds
  refreshInterval = setInterval(function() {
    renderCurrentView();
  }, 60000);

  // Re-load on ticket update (group change, priority change)
  client.on('ticket.assignee.group.name.changed', function() {
    loadTicket();
  });
  client.on('ticket.priority.changed', function() {
    loadTicket();
  });
});

// ─── Load Ticket ───────────────────────────────────────────────

// "Escalated to" custom field ID
var ESCALATED_TO_FIELD_ID = 46476040962203;

// Map field option values to team names
var ESCALATED_TO_MAP = {
  'at_t': 'AT&T',
  'connectx': 'ConnectX',
  'airvet': 'Airvet'
};


function loadTicket() {
  client.get([
    'ticket.id',
    'ticket.subject',
    'ticket.priority',
    'ticket.status',
    'ticket.assignee.group.name',
    'ticket.createdAt',
    'ticket.requester.name',
    'ticket.tags',
    'ticket.customField:custom_field_' + ESCALATED_TO_FIELD_ID
  ]).then(function(data) {
    var escalatedToValue = data['ticket.customField:custom_field_' + ESCALATED_TO_FIELD_ID] || null;

    ticketData = {
      id: data['ticket.id'],
      subject: data['ticket.subject'],
      priority: (function(p){ var v = (p||'').toLowerCase(); return ({'urgent':1,'high':1,'normal':1,'low':1})[v] ? v : 'normal'; })(data['ticket.priority']),
      status: data['ticket.status'],
      groupName: data['ticket.assignee.group.name'] || '',
      createdAt: data['ticket.createdAt'],
      requesterName: data['ticket.requester.name'],
      tags: data['ticket.tags'] || [],
      escalatedTo: escalatedToValue,
      escalatedToTeam: ESCALATED_TO_MAP[escalatedToValue] || null
    };

    // Get app settings for group mappings
    client.metadata().then(function(metadata) {
      ticketData.settings = metadata.settings || {};
      detectTeamAndLoad();
    }).catch(function() {
      ticketData.settings = {};
      detectTeamAndLoad();
    });
  }).catch(function(err) {
    console.error('Failed to load ticket:', err);
    showError('Failed to load ticket data.');
  });
}

// ─── Detect Team from group name (all teams, matching dashboard logic) ──

function detectTeam(groupName, settings) {
  if (!groupName) return 'L0';
  var lower = groupName.toLowerCase();

  // Check settings-based keywords for each team (partner teams first, then internal)
  var teamChecks = [
    { key: 'connectx_groups', team: 'ConnectX' },
    { key: 'att_groups', team: 'AT&T' },
    { key: 'airvet_groups', team: 'Airvet' },
    { key: 'l1l3_groups', team: 'L1-L3' },
    { key: 'l0_groups', team: 'L0' }
  ];
  for (var i = 0; i < teamChecks.length; i++) {
    var keywords = (settings[teamChecks[i].key] || '').split(',');
    for (var j = 0; j < keywords.length; j++) {
      var kw = keywords[j].trim().toLowerCase();
      if (kw && lower.indexOf(kw) !== -1) return teamChecks[i].team;
    }
  }

  // Fallback regex patterns (same as dashboard GROUP_RULES)
  if (/connectx/i.test(groupName)) return 'ConnectX';
  if (/at.?t|network/i.test(groupName)) return 'AT&T';
  if (/airvet|vet|pet.?care/i.test(groupName)) return 'Airvet';
  if (/l1|l2|l3|specialist|engineering|tier.?[123]/i.test(groupName)) return 'L1-L3';
  if (/l0|frontline|tier.?0/i.test(groupName)) return 'L0';

  return 'L0';
}

function detectTeamAndLoad() {
  // Detect team from group name only (matching dashboard logic exactly)
  ticketData.team = detectTeam(ticketData.groupName, ticketData.settings);
  ticketData.internalTeam = ticketData.team;
  ticketData.partner = null;
  ticketData.slaTargets = getSlaTargets(ticketData.team, ticketData.priority);
  mttrCache = null; // reset cache on team/ticket change

  // Fetch first response, group assignment, and MTTR in parallel
  Promise.all([
    fetchFirstResponseTime(),
    fetchCurrentGroupAssignment(),
    fetchMTTR()
  ]).then(function(results) {
    var frData = results[0];
    ticketData.firstResponseAt = frData.respondedAt;
    ticketData.firstResponseMet = frData.met;
    ticketData.assignedAt = results[1];
    ticketData.mttr = results[2];
    renderCurrentView();
  }).catch(function() {
    renderCurrentView();
  });
}

// ─── SLA Targets ───────────────────────────────────────────────

function getSlaTargets(team, priority) {
  var teamMatrix = SLA_MATRIX[team] || SLA_MATRIX.L0;
  var targets = teamMatrix[priority] || teamMatrix.normal;
  return {
    firstResponse: targets.firstResponse * 60000, // convert to ms
    resolution: targets.resolution * 60000
  };
}

// ─── Fetch First Response ──────────────────────────────────────

function fetchFirstResponseTime() {
  return client.request({
    url: '/api/v2/tickets/' + ticketData.id + '/comments.json?sort_order=asc',
    type: 'GET',
    dataType: 'json'
  }).then(function(data) {
    var comments = data.comments || [];

    // Also fetch the ticket to get requester_id
    return client.request({
      url: '/api/v2/tickets/' + ticketData.id + '.json',
      type: 'GET',
      dataType: 'json'
    }).then(function(ticketResp) {
      var requesterId = ticketResp.ticket.requester_id;

      // Find first public agent comment
      for (var i = 0; i < comments.length; i++) {
        var c = comments[i];
        if (c.author_id !== requesterId && c.public !== false) {
          return { met: true, respondedAt: new Date(c.created_at).getTime() };
        }
      }
      return { met: false, respondedAt: null };
    });
  }).catch(function() {
    return { met: false, respondedAt: null };
  });
}

// ─── Fetch Current Group Assignment Time ───────────────────────

function fetchCurrentGroupAssignment() {
  return client.request({
    url: '/api/v2/tickets/' + ticketData.id + '/audits.json',
    type: 'GET',
    dataType: 'json'
  }).then(function(data) {
    var audits = data.audits || [];
    var lastGroupChange = null;

    for (var i = audits.length - 1; i >= 0; i--) {
      var events = audits[i].events || [];
      for (var j = 0; j < events.length; j++) {
        if (events[j].field_name === 'group_id') {
          lastGroupChange = new Date(audits[i].created_at).getTime();
          break;
        }
      }
      if (lastGroupChange) break;
    }

    return lastGroupChange || new Date(ticketData.createdAt).getTime();
  }).catch(function() {
    return new Date(ticketData.createdAt).getTime();
  });
}

// ─── Fetch MTTR (Mean Time To Resolution) ─────────────────────

function fetchMTTR() {
  if (mttrCache !== null) {
    return Promise.resolve(mttrCache);
  }

  // First get the group_id for the current ticket
  return client.request({
    url: '/api/v2/tickets/' + ticketData.id + '.json',
    type: 'GET',
    dataType: 'json'
  }).then(function(ticketResp) {
    var groupId = ticketResp.ticket.group_id;

    // Build search query — scope to group if available, otherwise all solved tickets
    var query = 'type:ticket status:solved';
    if (groupId) {
      query += ' group_id:' + groupId;
    }

    return client.request({
      url: '/api/v2/search.json?query=' + encodeURIComponent(query) + '&sort_by=updated_at&sort_order=desc&per_page=100',
      type: 'GET',
      dataType: 'json'
    });
  }).then(function(searchData) {
    if (!searchData || !searchData.results || searchData.results.length === 0) return null;

    var tickets = searchData.results;
    var resolutionTimes = [];

    for (var i = 0; i < tickets.length; i++) {
      var t = tickets[i];
      var created = new Date(t.created_at).getTime();
      // Use updated_at as a proxy for solved time (Zendesk updates it when solved)
      var solved = new Date(t.updated_at).getTime();
      var resMs = solved - created;
      if (resMs > 0) {
        resolutionTimes.push(resMs);
      }
    }

    if (resolutionTimes.length === 0) return null;

    // Calculate mean
    var sum = 0;
    for (var j = 0; j < resolutionTimes.length; j++) {
      sum += resolutionTimes[j];
    }
    var mean = sum / resolutionTimes.length;

    // Also calculate median for a more robust metric
    resolutionTimes.sort(function(a, b) { return a - b; });
    var median;
    var mid = Math.floor(resolutionTimes.length / 2);
    if (resolutionTimes.length % 2 === 0) {
      median = (resolutionTimes[mid - 1] + resolutionTimes[mid]) / 2;
    } else {
      median = resolutionTimes[mid];
    }

    var result = {
      mean: mean,
      median: median,
      sampleSize: resolutionTimes.length,
      scope: ticketData.groupName ? ticketData.team : 'All Teams'
    };
    mttrCache = result;
    return result;
  }).catch(function(err) {
    console.error('Failed to fetch MTTR:', err);
    return null;
  });
}

// ─── Fetch Escalation History ──────────────────────────────────

function fetchEscalationHistory() {
  return client.request({
    url: '/api/v2/tickets/' + ticketData.id + '/audits.json',
    type: 'GET',
    dataType: 'json'
  }).then(function(auditData) {
    var audits = auditData.audits || [];
    var groupChanges = [];
    var groupIds = new Set();

    // Collect all group_id change events
    for (var i = 0; i < audits.length; i++) {
      var events = audits[i].events || [];
      for (var j = 0; j < events.length; j++) {
        var evt = events[j];
        if (evt.field_name === 'group_id') {
          groupChanges.push({
            timestamp: new Date(audits[i].created_at).getTime(),
            previousGroupId: evt.previous_value,
            newGroupId: evt.value
          });
          if (evt.previous_value) groupIds.add(evt.previous_value);
          if (evt.value) groupIds.add(evt.value);
        }
      }
    }

    if (groupChanges.length === 0) return [];

    // Fetch group names for all group IDs
    var groupIdArray = Array.from(groupIds);
    var groupNameMap = {};

    var promises = groupIdArray.map(function(gid) {
      return client.request({
        url: '/api/v2/groups/' + gid + '.json',
        type: 'GET',
        dataType: 'json'
      }).then(function(gData) {
        groupNameMap[gid] = gData.group.name;
      }).catch(function() {
        groupNameMap[gid] = 'Group ' + gid;
      });
    });

    return Promise.all(promises).then(function() {
      // Build timeline: each tier stint
      var stints = [];
      var createdAt = new Date(ticketData.createdAt).getTime();

      // First stint: from creation to first group change
      if (groupChanges.length > 0) {
        var firstChange = groupChanges[0];
        var firstGroupName = firstChange.previousGroupId ? groupNameMap[firstChange.previousGroupId] : (ticketData.groupName || 'Unassigned');
        stints.push({
          groupName: firstGroupName,
          team: detectTeam(firstGroupName, ticketData.settings),
          startTime: createdAt,
          endTime: firstChange.timestamp
        });
      }

      // Subsequent stints
      for (var k = 0; k < groupChanges.length; k++) {
        var gc = groupChanges[k];
        var gName = gc.newGroupId ? groupNameMap[gc.newGroupId] : 'Unassigned';
        var endTime = (k < groupChanges.length - 1) ? groupChanges[k + 1].timestamp : null; // null = current
        stints.push({
          groupName: gName,
          team: detectTeam(gName, ticketData.settings),
          startTime: gc.timestamp,
          endTime: endTime
        });
      }

      // Exclude the current stint (last one) — that's shown in the main view
      var previousStints = stints.slice(0, stints.length - 1);
      // Reverse: latest assignment on top, first assigned at bottom
      previousStints.reverse();
      return previousStints;
    });
  }).catch(function(err) {
    console.error('Failed to fetch escalation history:', err);
    return [];
  });
}

// ─── Render ────────────────────────────────────────────────────

function renderCurrentView() {
  var now = Date.now();
  var createdAt = new Date(ticketData.createdAt).getTime();
  var assignedAt = ticketData.assignedAt || createdAt;
  var targets = ticketData.slaTargets;
  var team = ticketData.team;
  var priority = ticketData.priority;

  // Calculate First Response SLA
  var frElapsed, frStatus, frRemaining, frMet;
  if (ticketData.firstResponseMet) {
    frElapsed = ticketData.firstResponseAt - createdAt;
    frMet = true;
    frStatus = frElapsed <= targets.firstResponse ? 'healthy' : 'breached';
  } else {
    frElapsed = now - createdAt;
    frMet = false;
    frRemaining = targets.firstResponse - frElapsed;
    if (frElapsed >= targets.firstResponse) {
      frStatus = 'breached';
    } else if (frElapsed >= targets.firstResponse * 0.75) {
      frStatus = 'nearing';
    } else {
      frStatus = 'healthy';
    }
  }

  // Calculate Resolution SLA
  var resElapsed = now - createdAt;
  var resRemaining = targets.resolution - resElapsed;
  var resStatus;
  var isSolved = ticketData.status === 'solved' || ticketData.status === 'closed';
  if (isSolved) {
    resStatus = 'healthy';
  } else if (resElapsed >= targets.resolution) {
    resStatus = 'breached';
  } else if (resElapsed >= targets.resolution * 0.75) {
    resStatus = 'nearing';
  } else {
    resStatus = 'healthy';
  }

  // Total time since created
  var totalTime = now - createdAt;

  // Time since assigned to current group
  var timeAtGroup = now - assignedAt;

  // Build HTML
  var html = '';

  // ── Header section ──
  html += '<div class="sla-header">';
  html += '<div class="sla-header-row">';
  html += '<div class="sla-header-left">';
  html += '<span class="sla-label">Assigned team</span>';
  html += '<span class="sla-team-name">' + escapeHtml(ticketData.team) + '</span>';
  html += '<span class="sla-group-name">' + escapeHtml(ticketData.groupName || 'Unassigned') + '</span>';
  html += '</div>';
  html += '<div class="sla-header-right">';
  html += '<span class="sla-overall-badge sla-badge-' + worstStatus(frStatus, resStatus) + '">' + badgeLabel(worstStatus(frStatus, resStatus)) + '</span>';
  html += '</div>';
  html += '</div>';
  html += '</div>';

  // ── Meta row ──
  html += '<div class="sla-meta-row">';
  html += '<div class="sla-meta-item">';
  html += '<span class="sla-meta-label">Assigned at</span>';
  html += '<span class="sla-meta-value">' + formatTime(assignedAt) + '</span>';
  html += '</div>';
  html += '<div class="sla-meta-item">';
  html += '<span class="sla-meta-label">Time here</span>';
  html += '<span class="sla-meta-value sla-mono">' + formatDuration(timeAtGroup) + '</span>';
  html += '</div>';
  html += '<div class="sla-meta-item">';
  html += '<span class="sla-meta-label">Priority</span>';
  html += '<span class="sla-meta-value sla-priority-' + priority + '">' + capitalize(priority) + '</span>';
  html += '</div>';
  html += '</div>';

  // ── First Response SLA ──
  html += '<div class="sla-section">';
  html += '<div class="sla-section-header">';
  html += '<span class="sla-section-title">First Response</span>';
  html += '<span class="sla-badge sla-badge-' + frStatus + '">' + badgeLabel(frStatus) + '</span>';
  html += '</div>';
  var frPct = Math.min((frElapsed / targets.firstResponse) * 100, 100);
  html += '<div class="sla-progress-bar"><div class="sla-progress-fill sla-fill-' + frStatus + '" style="width:' + frPct + '%"></div></div>';
  if (frMet) {
    var frLabel = frElapsed <= targets.firstResponse ? 'Responded in ' + formatDuration(frElapsed) : 'Responded late (' + formatDuration(frElapsed) + ')';
    html += '<div class="sla-section-detail"><span>' + frLabel + '</span><span>Target: ' + formatDurationShort(targets.firstResponse) + '</span></div>';
  } else {
    var frTimeLabel = frStatus === 'breached' ? 'Overdue by ' + formatDuration(frElapsed - targets.firstResponse) : formatDuration(frRemaining) + ' left';
    html += '<div class="sla-section-detail"><span class="sla-mono">' + frTimeLabel + '</span><span>Target: ' + formatDurationShort(targets.firstResponse) + '</span></div>';
  }
  html += '</div>';

  // ── Resolution SLA ──
  html += '<div class="sla-section">';
  html += '<div class="sla-section-header">';
  html += '<span class="sla-section-title">Resolution</span>';
  html += '<span class="sla-badge sla-badge-' + resStatus + '">' + badgeLabel(resStatus) + '</span>';
  html += '</div>';
  var resPct = Math.min((resElapsed / targets.resolution) * 100, 100);
  html += '<div class="sla-progress-bar"><div class="sla-progress-fill sla-fill-' + resStatus + '" style="width:' + resPct + '%"></div></div>';
  if (isSolved) {
    html += '<div class="sla-section-detail"><span>Resolved in ' + formatDuration(resElapsed) + '</span><span>Target: ' + formatDurationShort(targets.resolution) + '</span></div>';
  } else {
    var resTimeLabel = resStatus === 'breached' ? 'Overdue by ' + formatDuration(resElapsed - targets.resolution) : formatDuration(resRemaining) + ' left';
    html += '<div class="sla-section-detail"><span class="sla-mono">' + resTimeLabel + '</span><span>Target: ' + formatDurationShort(targets.resolution) + '</span></div>';
  }
  html += '</div>';

  // ── MTTR Section ──
  if (ticketData.mttr) {
    var mttr = ticketData.mttr;
    // Compare current ticket age vs team MTTR
    var mttrPct = Math.min((resElapsed / mttr.mean) * 100, 150);
    var mttrStatus = resElapsed > mttr.mean ? 'over' : 'under';

    html += '<div class="sla-mttr-section">';
    html += '<div class="sla-section-header">';
    html += '<span class="sla-section-title">MTTR <span class="sla-mttr-scope">' + escapeHtml(mttr.scope) + '</span></span>';
    html += '<span class="sla-mttr-badge sla-mttr-' + mttrStatus + '">' + (mttrStatus === 'over' ? 'Above Avg' : 'Below Avg') + '</span>';
    html += '</div>';

    // MTTR bar: shows current ticket time vs team average
    html += '<div class="sla-mttr-bar-wrapper">';
    html += '<div class="sla-progress-bar sla-progress-mttr">';
    html += '<div class="sla-progress-fill sla-fill-mttr" style="width:' + Math.min(mttrPct, 100) + '%"></div>';
    // Marker line at 100% (the average)
    html += '<div class="sla-mttr-marker" style="left:' + Math.min(100 / (mttrPct > 100 ? mttrPct / 100 : 1), 100) + '%"></div>';
    html += '</div>';
    html += '</div>';

    html += '<div class="sla-mttr-details">';
    html += '<div class="sla-mttr-stat">';
    html += '<span class="sla-mttr-stat-label">Team Avg</span>';
    html += '<span class="sla-mttr-stat-value sla-mono">' + formatDuration(mttr.mean) + '</span>';
    html += '</div>';
    html += '<div class="sla-mttr-stat">';
    html += '<span class="sla-mttr-stat-label">Median</span>';
    html += '<span class="sla-mttr-stat-value sla-mono">' + formatDuration(mttr.median) + '</span>';
    html += '</div>';
    html += '<div class="sla-mttr-stat">';
    html += '<span class="sla-mttr-stat-label">This Ticket</span>';
    html += '<span class="sla-mttr-stat-value sla-mono">' + formatDuration(resElapsed) + '</span>';
    html += '</div>';
    html += '</div>';
    html += '<div class="sla-mttr-sample">Based on ' + mttr.sampleSize + ' resolved ticket' + (mttr.sampleSize !== 1 ? 's' : '') + '</div>';
    html += '</div>';
  }

  // ── Divider + Total time ──
  html += '<div class="sla-divider"></div>';
  html += '<div class="sla-total-row">';
  html += '<span>Total time since created</span>';
  html += '<span class="sla-mono">' + formatDuration(totalTime) + '</span>';
  html += '</div>';

  // ── Escalation history toggle ──
  if (expanded && escalationHistory) {
    html += renderEscalationSection(escalationHistory);
    html += '<div class="sla-toggle" id="toggle-history">';
    html += '<span class="sla-toggle-icon">&#9650;</span> Hide escalation history';
    html += '</div>';
  } else {
    html += '<div class="sla-toggle" id="toggle-history">';
    html += '<span class="sla-toggle-icon">&#9660;</span> View escalation history';
    html += '</div>';
  }

  document.getElementById('app').innerHTML = html;

  // Bind toggle click
  var toggle = document.getElementById('toggle-history');
  if (toggle) {
    toggle.addEventListener('click', function() {
      if (expanded) {
        expanded = false;
        escalationHistory = null;
        client.invoke('resize', { width: '100%', height: '450px' });
        renderCurrentView();
      } else {
        toggle.innerHTML = '<div class="sla-loading-inline"><div class="spinner-small"></div> Loading history...</div>';
        fetchEscalationHistory().then(function(history) {
          escalationHistory = history;
          expanded = true;
          var expandedHeight = 450 + Math.max(history.length * 120, 50) + 80;
          client.invoke('resize', { width: '100%', height: expandedHeight + 'px' });
          renderCurrentView();
        });
      }
    });
  }
}

// ─── Render Escalation History ─────────────────────────────────

function renderEscalationSection(history) {
  if (!history || history.length === 0) {
    return '<div class="sla-escalation-empty">No previous escalations found.</div>';
  }

  var html = '<div class="sla-escalation-section">';
  html += '<div class="sla-escalation-title">Escalation History</div>';

  for (var i = 0; i < history.length; i++) {
    var stint = history[i];
    var duration = (stint.endTime || Date.now()) - stint.startTime;
    var targets = getSlaTargets(stint.team, ticketData.priority);

    // Calculate SLA progress for that stint
    var frPct = Math.min((duration / targets.firstResponse) * 100, 100);
    var resPct = Math.min((duration / targets.resolution) * 100, 100);
    var frStatus = duration >= targets.firstResponse ? 'breached' : (duration >= targets.firstResponse * 0.75 ? 'nearing' : 'healthy');
    var resStatus = duration >= targets.resolution ? 'breached' : (duration >= targets.resolution * 0.75 ? 'nearing' : 'healthy');

    html += '<div class="sla-escalation-card">';
    html += '<div class="sla-escalation-card-header">';
    html += '<strong>' + escapeHtml(stint.team) + '</strong>';
    html += '<span class="sla-escalation-group">' + escapeHtml(stint.groupName) + '</span>';
    html += '</div>';
    html += '<div class="sla-escalation-card-detail">Assigned ' + formatTime(stint.startTime) + ' &middot; ' + formatDuration(duration) + ' spent</div>';

    html += '<div class="sla-escalation-bars">';
    html += '<div class="sla-escalation-bar-group">';
    html += '<span class="sla-escalation-bar-label">Resp: ' + formatDurationShort(duration) + '/' + formatDurationShort(targets.firstResponse) + '</span>';
    html += '<div class="sla-progress-bar sla-progress-small"><div class="sla-progress-fill sla-fill-' + frStatus + '" style="width:' + frPct + '%"></div></div>';
    html += '</div>';
    html += '<div class="sla-escalation-bar-group">';
    html += '<span class="sla-escalation-bar-label">Resol: ' + formatDurationShort(duration) + '/' + formatDurationShort(targets.resolution) + '</span>';
    html += '<div class="sla-progress-bar sla-progress-small"><div class="sla-progress-fill sla-fill-' + resStatus + '" style="width:' + resPct + '%"></div></div>';
    html += '</div>';
    html += '</div>';

    html += '</div>';
  }

  // Time at each tier bar (chronological: oldest left, newest right)
  // history is reversed (latest first), so we reverse back for the timeline
  var chronological = history.slice().reverse();
  html += '<div class="sla-tier-timeline">';
  html += '<div class="sla-tier-timeline-label">Time at each tier</div>';
  html += '<div class="sla-tier-bar-container">';
  var totalDuration = 0;
  for (var t = 0; t < chronological.length; t++) {
    totalDuration += (chronological[t].endTime || Date.now()) - chronological[t].startTime;
  }
  // Add current stint
  var currentStintDuration = Date.now() - (ticketData.assignedAt || new Date(ticketData.createdAt).getTime());
  totalDuration += currentStintDuration;

  for (var t = 0; t < chronological.length; t++) {
    var d = (chronological[t].endTime || Date.now()) - chronological[t].startTime;
    var pct = totalDuration > 0 ? (d / totalDuration) * 100 : 0;
    html += '<div class="sla-tier-bar-segment" style="width:' + pct + '%" title="' + escapeHtml(chronological[t].team) + ': ' + formatDuration(d) + '">';
    html += '<span>' + escapeHtml(chronological[t].team) + ' ' + formatDurationShort(d) + '</span>';
    html += '</div>';
  }
  // Current
  var curPct = totalDuration > 0 ? (currentStintDuration / totalDuration) * 100 : 0;
  html += '<div class="sla-tier-bar-segment sla-tier-current" style="width:' + curPct + '%" title="' + escapeHtml(ticketData.team) + ': ' + formatDuration(currentStintDuration) + '">';
  html += '<span>' + escapeHtml(ticketData.team) + ' ' + formatDurationShort(currentStintDuration) + '</span>';
  html += '</div>';

  html += '</div></div>';
  html += '</div>';
  return html;
}

// ─── Helpers ───────────────────────────────────────────────────

function formatDuration(ms) {
  var totalMin = Math.floor(Math.abs(ms) / 60000);
  var d = Math.floor(totalMin / 1440);
  var h = Math.floor((totalMin % 1440) / 60);
  var m = totalMin % 60;
  if (d > 0) return d + 'd ' + h + 'h ' + m + 'm';
  if (h > 0) return h + 'h ' + m + 'm';
  return m + 'm';
}

function formatDurationShort(ms) {
  var totalMin = Math.floor(Math.abs(ms) / 60000);
  if (totalMin >= 1440) return Math.floor(totalMin / 1440) + 'd ' + Math.floor((totalMin % 1440) / 60) + 'h';
  if (totalMin >= 60) return Math.floor(totalMin / 60) + 'h';
  return totalMin + 'm';
}

function formatTime(timestamp) {
  var d = new Date(timestamp);
  var hours = d.getHours();
  var minutes = d.getMinutes();
  var ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return hours + ':' + (minutes < 10 ? '0' : '') + minutes + ' ' + ampm;
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function escapeHtml(text) {
  var div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

function worstStatus(a, b) {
  var order = { breached: 3, nearing: 2, healthy: 1 };
  return (order[a] || 0) >= (order[b] || 0) ? a : b;
}

function badgeLabel(status) {
  if (status === 'breached') return 'Breached';
  if (status === 'nearing') return 'Nearing';
  return 'Healthy';
}

function showError(msg) {
  document.getElementById('app').innerHTML = '<div class="sla-error">' + escapeHtml(msg) + '</div>';
}
