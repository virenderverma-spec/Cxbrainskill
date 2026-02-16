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
