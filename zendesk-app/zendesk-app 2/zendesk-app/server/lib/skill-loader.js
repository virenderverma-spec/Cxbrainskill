/**
 * Skill Loader for Zendesk Agent Brief
 *
 * Loads CS skill markdown files from the cs-skills project and extracts
 * structured troubleshooting guidance for the agent brief.
 */

const fs = require('fs');
const path = require('path');

// Skills live in the sibling cs-skills project
const DEFAULT_SKILLS_DIR = path.join(__dirname, '..', '..', '..', 'cs-skills', '.claude', 'skills');

/**
 * Detect which skills are relevant based on issue text
 */
function detectRelevantSkills(issueText) {
  const text = (issueText || '').toLowerCase();
  const relevant = [];

  const skillKeywords = {
    'esim-troubleshooting': ['esim', 'e-sim', 'activation', 'qr code', "can't activate", 'no service', 'sim', 'profile download'],
    'portin-troubleshooting': ['port', 'transfer number', 'keep my number', 'old carrier', 'porting'],
    'payment-issues': ['payment', 'charge', 'refund', 'billing', 'card', 'declined', 'invoice'],
    'network-connectivity': ['signal', 'network', 'data', 'call', 'text', 'sms', 'no service', 'slow'],
    'account-management': ['login', 'password', 'account', 'email', 'delete', 'cancel', 'suspend'],
    'airvet-support': ['airvet', 'vet', 'pet', 'veterinary', 'animal'],
    'escalation-guide': ['escalate', 'manager', 'supervisor', 'complaint'],
    'email-handling': [],  // Only used for email channel context
    'mochi-handoff': ['mochi', 'bot', 'chatbot', 'transferred', 'escalat'],
  };

  for (const [skill, keywords] of Object.entries(skillKeywords)) {
    for (const keyword of keywords) {
      if (text.includes(keyword)) {
        relevant.push(skill);
        break;
      }
    }
  }

  return relevant;
}

/**
 * Map problem type to skill name(s)
 */
function skillsForProblemType(problemType) {
  const map = {
    'esim': ['esim-troubleshooting'],
    'payment': ['payment-issues'],
    'portin': ['portin-troubleshooting'],
    'mochi_escalation': ['mochi-handoff', 'escalation-guide'],
    'order_failure': ['escalation-guide'],
    'network': ['network-connectivity'],
    'account': ['account-management'],
    'airvet': ['airvet-support'],
    'ai_synthesized': [],  // Will use detectRelevantSkills instead
  };
  return map[problemType] || [];
}

/**
 * Load a single skill file
 */
function loadSkill(skillName, skillsDir = DEFAULT_SKILLS_DIR) {
  const filePath = path.join(skillsDir, `${skillName}.md`);
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf-8');
    }
  } catch (e) { /* ignore */ }
  return null;
}

/**
 * Extract ## sections from markdown content
 */
function extractSections(content) {
  const sections = {};
  let currentSection = null;
  let currentContent = [];

  for (const line of content.split('\n')) {
    if (line.startsWith('## ')) {
      if (currentSection) {
        sections[currentSection] = currentContent.join('\n').trim();
      }
      currentSection = line.replace('## ', '').trim();
      currentContent = [];
    } else if (currentSection) {
      currentContent.push(line);
    }
  }
  if (currentSection) {
    sections[currentSection] = currentContent.join('\n').trim();
  }

  return sections;
}

/**
 * Extract the title (# heading) from skill content
 */
function extractTitle(content) {
  const match = content.match(/^#\s+(.+)/m);
  return match ? match[1].trim() : 'Unknown Skill';
}

/**
 * Extract diagnostic steps as structured array from a "Diagnostic Flow" section
 */
function extractDiagnosticSteps(flowText) {
  if (!flowText) return [];
  const steps = [];
  const stepRegex = /###\s+Step\s+\d+:\s*(.+)/gi;
  let match;
  while ((match = stepRegex.exec(flowText)) !== null) {
    steps.push(match[1].trim());
  }
  return steps;
}

/**
 * Extract escalation criteria from an "Escalation Triggers" section
 */
function extractEscalationCriteria(escText) {
  if (!escText) return [];
  const criteria = [];
  const lines = escText.split('\n');
  for (const line of lines) {
    const m = line.match(/^\d+\.\s+\*\*(.+?)\*\*\s*[-–—]\s*(.+)/);
    if (m) {
      criteria.push({ condition: m[1].trim(), action: m[2].trim() });
    }
  }
  return criteria;
}

/**
 * Extract state reference table
 */
function extractStateTable(content, sectionName) {
  const sections = extractSections(content);
  const tableSection = sections[sectionName];
  if (!tableSection) return [];

  const rows = [];
  const lines = tableSection.split('\n');
  let headers = null;

  for (const line of lines) {
    if (line.includes('|') && !line.match(/^\|[\s-|]+\|$/)) {
      const cells = line.split('|').map(c => c.trim()).filter(c => c);
      if (!headers) {
        headers = cells;
      } else {
        const row = {};
        headers.forEach((h, i) => { row[h] = cells[i] || ''; });
        rows.push(row);
      }
    }
  }
  return rows;
}

/**
 * Build structured skill guidance for the agent brief
 */
function getSkillGuidance(problem, lookup, skillsDir = DEFAULT_SKILLS_DIR) {
  const guidance = [];

  // Determine which skills to load
  let skillNames = [];
  if (problem && problem.type) {
    skillNames = skillsForProblemType(problem.type);
  }

  // Also detect from problem text
  if (problem && problem.problem) {
    const detected = detectRelevantSkills(problem.problem);
    for (const s of detected) {
      if (!skillNames.includes(s)) skillNames.push(s);
    }
  }

  // Also detect from lookup data
  if (lookup) {
    const contextParts = [];
    if (lookup.mochi && lookup.mochi.length > 0) {
      contextParts.push(lookup.mochi[0].category || '');
      contextParts.push(lookup.mochi[0].title || '');
      if (lookup.mochi[0].escalated === 'true') contextParts.push('mochi escalated');
    }
    const detected = detectRelevantSkills(contextParts.join(' '));
    for (const s of detected) {
      if (!skillNames.includes(s)) skillNames.push(s);
    }
  }

  // Limit to 3 most relevant skills
  skillNames = skillNames.slice(0, 3);

  for (const skillName of skillNames) {
    const content = loadSkill(skillName, skillsDir);
    if (!content) continue;

    const title = extractTitle(content);
    const sections = extractSections(content);

    // Extract diagnostic steps
    const diagnosticSteps = extractDiagnosticSteps(sections['Diagnostic Flow'] || '');

    // Extract escalation criteria
    const escalationCriteria = extractEscalationCriteria(
      sections['Escalation Triggers'] || sections['Escalation Criteria'] || ''
    );

    // Build specific troubleshooting steps based on problem type and skill
    const troubleshootingSteps = buildTroubleshootingFromSkill(skillName, problem, lookup, sections);

    guidance.push({
      skillName,
      title,
      diagnosticSteps,
      escalationCriteria,
      troubleshootingSteps,
    });
  }

  return guidance;
}

/**
 * Build specific troubleshooting steps by parsing skill content
 * relative to the identified problem state
 */
function buildTroubleshootingFromSkill(skillName, problem, lookup, sections) {
  const steps = [];

  switch (skillName) {
    case 'esim-troubleshooting': {
      // Determine eSIM state and provide state-specific guidance
      const esimStatus = lookup?.esimProfile?.status || '';
      const esimOrderStatus = lookup?.orders?.[0]?.esimStatus || '';
      const state = (esimStatus || esimOrderStatus || '').toUpperCase();

      if (state === 'FAILED' || state === 'ERROR') {
        steps.push({ step: 'Check error code in ConnectX for specific failure reason', priority: 'high' });
        steps.push({ step: 'Confirm with agent before triggering SIM swap', priority: 'high' });
        steps.push({ step: 'After SIM swap, new QR code ready in ~5 minutes', priority: 'medium' });
      } else if (state === 'PENDING') {
        steps.push({ step: 'eSIM is ready — customer needs to scan QR code from Settings (not camera)', priority: 'high' });
        steps.push({ step: 'Verify device is eSIM-compatible (iPhone XS+, Pixel 3+, Samsung S20+)', priority: 'medium' });
        steps.push({ step: 'Send eSIM installation instructions via app notification', priority: 'medium' });
      } else if (state === 'ACTIVE') {
        steps.push({ step: 'eSIM is ACTIVE — check if line is enabled in device settings', priority: 'high' });
        steps.push({ step: 'Try airplane mode toggle (ON → 30s → OFF)', priority: 'medium' });
        steps.push({ step: 'Check for network outages in customer ZIP code', priority: 'medium' });
        steps.push({ step: 'Last resort: reset network settings (warns: forgets WiFi passwords)', priority: 'low' });
      } else if (state === 'PROVISIONING' || state === 'NOT_PROVISIONED') {
        steps.push({ step: 'eSIM not ready yet — if <5 min since payment, ask customer to wait', priority: 'medium' });
        steps.push({ step: 'If >10 min and still provisioning, escalate to L2 (backend issue)', priority: 'high' });
      } else {
        steps.push({ step: 'Check eSIM provisioning state via Boss API', priority: 'high' });
        steps.push({ step: 'Verify payment completed and order status', priority: 'high' });
      }
      break;
    }

    case 'portin-troubleshooting': {
      const portStatus = lookup?.portStatus;
      const portState = (portStatus?.status || portStatus?.portStatus || '').toUpperCase();

      if (portState.includes('REJECT') || portState.includes('FAIL')) {
        steps.push({ step: 'Check rejection reason code in port response', priority: 'high' });
        steps.push({ step: 'Common causes: wrong account number, wrong PIN, name mismatch, carrier freeze', priority: 'high' });
        steps.push({ step: 'Ask customer to verify account details with old carrier', priority: 'medium' });
        steps.push({ step: 'For Verizon: customer may need "Transfer PIN" (different from account PIN)', priority: 'medium' });
      } else if (portState.includes('PENDING') || portState.includes('SUBMITTED')) {
        steps.push({ step: 'Port in progress — typically takes 1-3 business days', priority: 'medium' });
        steps.push({ step: 'If >48 hours with no update, escalate to carrier team', priority: 'high' });
      } else if (portState.includes('FOC')) {
        steps.push({ step: 'Port approved — inform customer of scheduled completion date', priority: 'medium' });
        steps.push({ step: 'Remind: keep old carrier active until port completes', priority: 'medium' });
      } else {
        steps.push({ step: 'Verify port-in status and check for rejection reasons', priority: 'high' });
        steps.push({ step: 'Collect: account number, PIN, billing ZIP, account holder name', priority: 'high' });
      }
      break;
    }

    case 'payment-issues': {
      const orders = lookup?.orders || [];
      const latestOrder = orders[0];

      if (latestOrder && !latestOrder.paymentCompleted) {
        steps.push({ step: 'Check Stripe for payment attempt and decline code', priority: 'high' });
        steps.push({ step: 'Common declines: insufficient funds, expired card, bank fraud block', priority: 'medium' });
        steps.push({ step: 'Guide customer to update payment method in app: Settings > Payment Method', priority: 'medium' });
        steps.push({ step: 'For "do not honor" — customer should call their bank about "Meow Mobile" / "Gather Inc."', priority: 'medium' });
      } else {
        steps.push({ step: 'Review payment history for duplicates or failed attempts', priority: 'high' });
        steps.push({ step: 'Pending charges from failed attempts drop off in 3-5 business days', priority: 'medium' });
      }
      break;
    }

    case 'network-connectivity': {
      steps.push({ step: 'Verify eSIM is ACTIVE (not a provisioning issue)', priority: 'high' });
      steps.push({ step: 'Check for network outages in customer ZIP code', priority: 'high' });
      steps.push({ step: 'Verify eSIM line is enabled and set as default in device settings', priority: 'medium' });
      steps.push({ step: 'Try airplane mode toggle (ON → 30s → OFF)', priority: 'medium' });
      steps.push({ step: 'Ensure Data Roaming is ON (needed even domestically for MVNO)', priority: 'medium' });
      steps.push({ step: 'Last resort: reset network settings', priority: 'low' });
      break;
    }

    case 'mochi-handoff': {
      steps.push({ step: 'Review Mochi conversation history — do NOT make customer repeat themselves', priority: 'high' });
      steps.push({ step: 'Check what Mochi already tried and skip those steps', priority: 'high' });
      steps.push({ step: 'Acknowledge the handoff warmly and summarize the issue', priority: 'medium' });
      break;
    }

    case 'account-management': {
      const ind = lookup?.individual;
      const status = (ind?.status || '').toUpperCase();

      if (status === 'SUSPENDED') {
        steps.push({ step: 'Check suspension reason: PAYMENT / AUP / FRAUD', priority: 'high' });
        steps.push({ step: 'Payment suspension: guide to update payment method in app', priority: 'medium' });
        steps.push({ step: 'AUP/Fraud suspension: escalate to Trust & Safety (do NOT share flag details)', priority: 'high' });
      } else {
        steps.push({ step: 'Verify account status and identify the specific request', priority: 'high' });
        steps.push({ step: 'For password reset: trigger reset email, check spam folder', priority: 'medium' });
      }
      break;
    }

    case 'airvet-support': {
      steps.push({ step: 'Verify Meow Mobile account is ACTIVE (required for Airvet)', priority: 'high' });
      steps.push({ step: 'Ensure customer uses same email for Airvet as Meow Mobile', priority: 'medium' });
      steps.push({ step: 'New accounts: Airvet sync can take up to 24 hours', priority: 'medium' });
      break;
    }

    case 'escalation-guide': {
      steps.push({ step: 'Document what was tried and failed before escalating', priority: 'high' });
      steps.push({ step: 'Include: customer email, order ID, error codes, timeline', priority: 'high' });
      steps.push({ step: 'Set customer expectation: L2 = 24h, Engineering = 48h, Carrier = 24-72h', priority: 'medium' });
      break;
    }
  }

  return steps;
}

/**
 * Check if skills directory exists
 */
function skillsAvailable(skillsDir = DEFAULT_SKILLS_DIR) {
  return fs.existsSync(skillsDir);
}

module.exports = {
  detectRelevantSkills,
  skillsForProblemType,
  loadSkill,
  getSkillGuidance,
  skillsAvailable,
  DEFAULT_SKILLS_DIR,
};
