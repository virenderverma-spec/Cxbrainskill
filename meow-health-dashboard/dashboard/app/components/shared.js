// Shared utilities for the dashboard

export function formatAge(isoDate) {
  if (!isoDate) return '—';
  const ms = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(ms / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${mins % 60}m`;
  return `${mins}m`;
}

export function formatHours(hours) {
  if (!hours && hours !== 0) return '—';
  const h = Math.round(hours);
  if (h >= 24) {
    const days = Math.floor(h / 24);
    const rem = h % 24;
    return `${days}d ${rem}h`;
  }
  return `${h}h`;
}

export function slaBorderColor(slaStatus) {
  switch (slaStatus) {
    case 'breached': return 'border-l-sla-breached';
    case 'critical': return 'border-l-sla-critical';
    case 'warning': return 'border-l-orange-500/60';
    default: return 'border-l-dark-border';
  }
}

export function slaBadge(slaStatus) {
  switch (slaStatus) {
    case 'breached':
      return { label: 'SLA BREACHED', cls: 'bg-[#450A0A] text-sla-breached border-red-800/50' };
    case 'critical':
      return { label: 'SLA CRITICAL', cls: 'bg-[#451A03] text-sla-critical border-amber-800/50' };
    default:
      return null;
  }
}

export const TAG_COLORS = {
  'eSIM Failed': 'bg-blue-900/30 text-blue-400 border-blue-800/30',
  'MNP Stuck': 'bg-indigo-900/30 text-indigo-400 border-indigo-800/30',
  'MNP Conflict': 'bg-indigo-900/40 text-indigo-300 border-indigo-800/40',
  'Payment Stuck': 'bg-orange-900/30 text-orange-400 border-orange-800/30',
  'Silent Stuck': 'bg-pink-900/30 text-pink-400 border-pink-800/30',
  'Churn Risk': 'bg-pink-900/30 text-pink-400 border-pink-800/30',
  'Unhappy': 'bg-red-900/20 text-red-300 border-red-800/20',
  'Frustrated': 'bg-amber-900/20 text-amber-300 border-amber-800/20',
  'Refund Pending': 'bg-amber-900/30 text-amber-400 border-amber-800/30',
  'Double Charged': 'bg-red-900/30 text-red-400 border-red-800/30',
  'No Network': 'bg-cyan-900/30 text-cyan-400 border-cyan-800/30',
  'Login Issue': 'bg-purple-900/30 text-purple-400 border-purple-800/30',
  'Device Incompatible': 'bg-violet-900/30 text-violet-400 border-violet-800/30',
  'Call Drops': 'bg-red-900/20 text-red-300 border-red-800/20',
};

export const JOURNEY_STAGES = [
  { id: 'order_created', label: 'Order Created', order: 1 },
  { id: 'payment', label: 'Payment', order: 2 },
  { id: 'number_selection', label: 'Number Selection', order: 3 },
  { id: 'esim_activation', label: 'eSIM Activation', order: 4 },
  { id: 'nw_enabled', label: 'NW Enabled', order: 5 },
  { id: 'airvet_account', label: 'Airvet Account', order: 6 },
];

export const ZENDESK_BASE = 'https://rockstarautomations.zendesk.com';

export const ONBOARDING_STATUS_MAP = {
  'ORDERING': 'Order Created',
  'PAYING': 'Payment',
  'SELECTING_NUMBER': 'Number Selection',
  'IMEI_CHECKING': 'eSIM Activation',
  'ACTIVATING': 'eSIM Activation',
  'FILLING_PET_INSURANCE': 'Airvet Account',
  'COMPLETED': 'Completed',
};

// --- CIS (Customer Issue Scenarios) mapping ---

export const CIS_JOURNEY_STAGES = [
  { id: 'pre_onboarding', label: 'Pre-Onboarding' },
  { id: 'onboarding', label: 'Onboarding' },
  { id: 'post_onboarding', label: 'Post Onboarding' },
  { id: 'others', label: 'Others' },
];

export const CIS_MILESTONES = {
  pre_onboarding: [
    { id: 'pre_purchase', label: 'Pre Purchase' },
  ],
  onboarding: [
    { id: 'payment', label: 'Payment' },
    { id: 'device_compatibility', label: 'Device Compatibility' },
    { id: 'number_selection', label: 'Number Selection' },
    { id: 'app_web', label: 'App/Web Related' },
    { id: 'esim_activation', label: 'eSIM Activation' },
    { id: 'order_created', label: 'Order Created' },
  ],
  post_onboarding: [
    { id: 'service_issues', label: 'Service Issues' },
    { id: 'activation', label: 'Activation' },
  ],
  others: [],
};

export const CIS_ISSUE_BUCKETS = {
  // Pre-Onboarding
  'Website Visit':           { color: 'bg-slate-800/40 text-slate-300 border-slate-700/50' },
  'Gmail/Apple ID Signup':   { color: 'bg-slate-800/40 text-slate-300 border-slate-700/50' },
  // Onboarding — Payment
  'Payment not completed':   { color: 'bg-orange-900/30 text-orange-400 border-orange-800/30' },
  'No Payment Confirmation': { color: 'bg-amber-900/30 text-amber-400 border-amber-800/30' },
  // Onboarding — Device Compatibility
  'Device Not Compatible':   { color: 'bg-violet-900/30 text-violet-400 border-violet-800/30' },
  'Check Device Compatibility': { color: 'bg-violet-900/30 text-violet-300 border-violet-800/30' },
  // Onboarding — Number Selection
  'New Number / Port-In':    { color: 'bg-indigo-900/30 text-indigo-400 border-indigo-800/30' },
  // Onboarding — App/Web
  'App Download & Signup':   { color: 'bg-purple-900/30 text-purple-400 border-purple-800/30' },
  // Onboarding — eSIM Activation
  'eSIM not Downloaded':     { color: 'bg-blue-900/30 text-blue-400 border-blue-800/30' },
  'eSIM as primary':         { color: 'bg-blue-900/30 text-blue-300 border-blue-800/30' },
  'eSIM Activation Stuck':   { color: 'bg-red-900/30 text-red-400 border-red-800/40' },
  // Onboarding — Order Created
  'Order Abandoned':         { color: 'bg-pink-900/30 text-pink-400 border-pink-800/30' },
  'Silent Churn':            { color: 'bg-pink-900/40 text-pink-300 border-pink-800/40' },
  // Post Onboarding — Service Issues
  'Calls & Data':            { color: 'bg-cyan-900/30 text-cyan-400 border-cyan-800/30' },
  'SMS':                     { color: 'bg-cyan-900/30 text-cyan-300 border-cyan-800/30' },
  'Voicemail':               { color: 'bg-cyan-900/30 text-cyan-300 border-cyan-800/30' },
  'Call Drops':              { color: 'bg-red-900/20 text-red-300 border-red-800/20' },
  'Network Throttling / FUP': { color: 'bg-amber-900/30 text-amber-300 border-amber-800/30' },
  'Service Resumed but Not Working': { color: 'bg-red-900/30 text-red-400 border-red-800/30' },
  // Post Onboarding — Activation
  'Incomplete Activation':   { color: 'bg-yellow-900/30 text-yellow-400 border-yellow-800/30' },
  // Fallback
  'Uncategorized':           { color: 'bg-gray-800/50 text-gray-400 border-gray-700/50' },
};

/**
 * Assign a CIS scenario to a customer based on their data signals.
 * Returns { journeyStage, milestone, issueBucket, cisNumber }
 */
export function assignCisScenario(customer) {
  const stuckAt = customer.stuckAt;
  const stuckHours = customer.stuckHours || 0;
  const esimStatus = customer.esimStatus;
  const portinStatus = customer.portinStatus;
  const telcoStatus = customer.telcoStatus;
  const issueTags = customer.issueTags || [];
  const isSilent = issueTags.includes('Silent Stuck') || (customer.isSilent && stuckHours > 720);

  // --- Post-onboarding customers (stuckAt === 'completed') ---
  if (stuckAt === 'completed') {
    if (!telcoStatus || telcoStatus === 'NULL') {
      return { journeyStage: 'post_onboarding', milestone: 'activation', issueBucket: 'Incomplete Activation', cisNumber: 31 };
    }
    if (telcoStatus === 'Suspended') {
      return { journeyStage: 'post_onboarding', milestone: 'service_issues', issueBucket: 'Service Resumed but Not Working', cisNumber: 27 };
    }
    if (telcoStatus === 'Cancelled') {
      return { journeyStage: 'post_onboarding', milestone: 'service_issues', issueBucket: 'Service Resumed but Not Working', cisNumber: 28 };
    }
    if (issueTags.includes('Call Drops')) {
      return { journeyStage: 'post_onboarding', milestone: 'service_issues', issueBucket: 'Call Drops', cisNumber: 24 };
    }
    return { journeyStage: 'others', milestone: null, issueBucket: 'Uncategorized', cisNumber: null };
  }

  // --- Onboarding customers ---

  // Order Created stage
  if (stuckAt === 'order_created') {
    if (isSilent || stuckHours > 720) {
      return { journeyStage: 'onboarding', milestone: 'order_created', issueBucket: 'Silent Churn', cisNumber: 30 };
    }
    return { journeyStage: 'onboarding', milestone: 'order_created', issueBucket: 'Order Abandoned', cisNumber: 29 };
  }

  // Payment stage
  if (stuckAt === 'payment') {
    return { journeyStage: 'onboarding', milestone: 'payment', issueBucket: 'Payment not completed', cisNumber: 6 };
  }

  // Number Selection stage
  if (stuckAt === 'number_selection') {
    if (portinStatus === 'CONFLICT' || portinStatus === 'REVIEWING') {
      return { journeyStage: 'onboarding', milestone: 'number_selection', issueBucket: 'New Number / Port-In', cisNumber: 10 };
    }
    return { journeyStage: 'onboarding', milestone: 'number_selection', issueBucket: 'New Number / Port-In', cisNumber: 11 };
  }

  // eSIM Activation stage
  if (stuckAt === 'esim_activation') {
    if (portinStatus === 'CONFLICT') {
      return { journeyStage: 'onboarding', milestone: 'number_selection', issueBucket: 'New Number / Port-In', cisNumber: 10 };
    }
    if (esimStatus === 'ERROR' || esimStatus === 'FAILED') {
      return { journeyStage: 'onboarding', milestone: 'esim_activation', issueBucket: 'eSIM Activation Stuck', cisNumber: 16 };
    }
    return { journeyStage: 'onboarding', milestone: 'esim_activation', issueBucket: 'eSIM not Downloaded', cisNumber: 14 };
  }

  // NW Enabled stage
  if (stuckAt === 'nw_enabled') {
    return { journeyStage: 'onboarding', milestone: 'esim_activation', issueBucket: 'eSIM Activation Stuck', cisNumber: 16 };
  }

  // Airvet Account stage
  if (stuckAt === 'airvet_account') {
    if (esimStatus === 'ERROR' || esimStatus === 'FAILED') {
      return { journeyStage: 'onboarding', milestone: 'esim_activation', issueBucket: 'eSIM Activation Stuck', cisNumber: 16 };
    }
    return { journeyStage: 'others', milestone: null, issueBucket: 'Uncategorized', cisNumber: null };
  }

  // Fallback — Others
  return { journeyStage: 'others', milestone: null, issueBucket: 'Uncategorized', cisNumber: null };
}
