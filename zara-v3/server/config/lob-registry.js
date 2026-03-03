/**
 * LOB Registry — Single source of truth for all Lines of Business.
 *
 * Adding a new LOB = adding an entry here + content files. Zero code changes.
 */

const LOB_REGISTRY = {
  meow_mobile: {
    lobId: 'meow_mobile',
    displayName: 'Meow Mobile',
    shortName: 'Mobile',
    color: '#6C5CE7',
    icon: '📱',
    planPrefixes: ['MM_', 'MEOW_'],
    brandNames: ['meow_mobile', 'meow mobile', 'mm', 'meow'],
    tagPatterns: ['lob:meow_mobile', 'cs_meow_mobile', 'meow_mobile'],
    kbFile: 'meow-mobile.md',
    funnelSteps: [
      { id: 'signup', label: 'Sign Up', field: null },
      { id: 'payment', label: 'Payment', field: 'paymentCompleted' },
      { id: 'number', label: 'Number', field: 'numberSelectionCompleted' },
      { id: 'esim', label: 'eSIM', field: 'activationCompleted' },
      { id: 'airvet', label: 'Airvet', field: 'petInsuranceCompleted' },
      { id: 'active', label: 'Active', field: 'onboardingCompleted' },
    ],
    nonTelcoProblemTypes: {
      airvet: {
        label: 'Airvet / Pet Insurance',
        keywords: ['airvet', 'vet', 'pet', 'veterinary', 'animal', 'pet insurance', 'televet'],
        vendorTeam: 'Airvet Partner Team',
      },
    },
    ctaTypes: [
      'check_port_status', 'resubmit_port', 'send_esim_qr',
      'check_network_outage', 'generate_portout_pin',
      'suspend_account', 'resume_account', 'run_rca',
      'send_payment_link', 'replace_msisdn',
      'reprovision_esim', 'send_airvet_guide', 'send_referral_invite',
      'check_imei', 'check_network_coverage',
      'check_connectx_provisioning', 'check_device_compatibility',
      'prompt_manual_check',
    ],
    systemPromptOverlay: 'meow-mobile.md',
    escalationTiers: {
      L1: 'Meow Mobile L1 Support',
      L2: 'Meow Mobile Engineering',
      partner: 'Airvet Partner Team',
    },
  },

  meow_pager: {
    lobId: 'meow_pager',
    displayName: 'Meow Pager',
    shortName: 'Pager',
    color: '#E17055',
    icon: '📟',
    planPrefixes: ['PGR_'],
    brandNames: ['meow_pager', 'meow pager', 'pager', 'pgr'],
    tagPatterns: ['lob:meow_pager', 'cs_meow_pager', 'meow_pager'],
    kbFile: 'meow-pager.md',
    funnelSteps: [
      { id: 'account', label: 'Account', field: null },
      { id: 'payment', label: 'Payment', field: 'paymentCompleted' },
      { id: 'device_ship', label: 'Device Shipped', field: 'deviceShipped' },
      { id: 'activation', label: 'Activation', field: 'activationCompleted' },
      { id: 'pager_setup', label: 'Pager Setup', field: 'pagerSetupCompleted' },
    ],
    nonTelcoProblemTypes: {
      pager_device: {
        label: 'Pager Device Issue',
        keywords: ['pager', 'device', 'hardware', 'screen', 'button', 'broken', 'not turning on', 'dead pager'],
        vendorTeam: 'Device Manufacturer',
      },
      pager_messaging: {
        label: 'Pager Messaging Issue',
        keywords: ['page', 'message', 'alert', 'notification', 'not receiving pages', 'missed page', 'delivery'],
        vendorTeam: 'Messaging Gateway Team',
      },
      pager_battery: {
        label: 'Pager Battery Issue',
        keywords: ['battery', 'charge', 'power', 'dying', 'low battery', 'won\'t charge', 'battery life'],
        vendorTeam: 'Device Manufacturer',
      },
    },
    ctaTypes: [
      'check_port_status', 'resubmit_port',
      'check_network_outage', 'generate_portout_pin',
      'suspend_account', 'resume_account', 'run_rca',
      'send_payment_link', 'replace_msisdn',
      'check_network_coverage',
      'replace_pager_battery', 'check_pager_connectivity', 'reset_pager_alerts',
    ],
    systemPromptOverlay: 'meow-pager.md',
    escalationTiers: {
      L1: 'Meow Pager L1 Support',
      L2: 'Meow Pager Engineering',
      partner: 'Device Manufacturer',
    },
  },

  meow_stem: {
    lobId: 'meow_stem',
    displayName: 'Meow STEM+',
    shortName: 'STEM+',
    color: '#00B894',
    icon: '🔬',
    planPrefixes: ['STM_'],
    brandNames: ['meow_stem', 'meow stem', 'stem', 'stem+', 'stm'],
    tagPatterns: ['lob:meow_stem', 'cs_meow_stem', 'meow_stem'],
    kbFile: 'meow-stem.md',
    funnelSteps: [
      { id: 'account', label: 'Account', field: null },
      { id: 'payment', label: 'Payment', field: 'paymentCompleted' },
      { id: 'esim', label: 'eSIM', field: 'activationCompleted' },
      { id: 'course_enroll', label: 'Course Enrolled', field: 'courseEnrolled' },
      { id: 'device_sync', label: 'Device Synced', field: 'deviceSynced' },
      { id: 'active', label: 'Active', field: 'onboardingCompleted' },
    ],
    nonTelcoProblemTypes: {
      course_access: {
        label: 'Course Access Issue',
        keywords: ['course', 'class', 'lesson', 'module', 'can\'t access', 'login', 'content', 'video', 'curriculum'],
        vendorTeam: 'Course Provider',
      },
      device_sync: {
        label: 'Device Sync Issue',
        keywords: ['sync', 'device sync', 'not syncing', 'bluetooth', 'pair', 'connected device', 'wearable'],
        vendorTeam: 'Device Integration Team',
      },
      challenge_tracking: {
        label: 'Challenge / Certification Issue',
        keywords: ['challenge', 'certification', 'badge', 'progress', 'leaderboard', 'score', 'achievement', 'rank'],
        vendorTeam: 'Course Provider',
      },
      stem_subscription: {
        label: 'STEM+ Subscription Issue',
        keywords: ['subscription', 'renew', 'upgrade', 'downgrade', 'tier', 'plan change', 'stem plan'],
        vendorTeam: 'Billing Team',
      },
    },
    ctaTypes: [
      'check_port_status', 'resubmit_port', 'send_esim_qr',
      'check_network_outage', 'generate_portout_pin',
      'suspend_account', 'resume_account', 'run_rca',
      'send_payment_link', 'replace_msisdn',
      'reprovision_esim', 'check_imei', 'check_network_coverage',
      'check_connectx_provisioning', 'check_device_compatibility',
      'reset_course_progress', 'resync_device', 'check_subscription_status',
    ],
    systemPromptOverlay: 'meow-stem.md',
    escalationTiers: {
      L1: 'Meow STEM+ L1 Support',
      L2: 'Meow STEM+ Engineering',
      partner: 'Course Provider',
    },
  },
};

// Shared telco problem types (common across all LOBs)
const SHARED_TELCO_TYPES = new Set([
  'esim', 'portin', 'network', 'order_failure', 'portout', 'voice_sms',
  'payment', 'billing_dispute', 'refund', 'cancellation', 'account',
  'mochi_escalation', 'login_issue', 'suspension', 'general',
]);

function getLob(lobId) {
  return LOB_REGISTRY[lobId] || null;
}

function getAllLobs() {
  return Object.values(LOB_REGISTRY);
}

function getDefaultLob() {
  const defaultId = process.env.DEFAULT_LOB || 'meow_mobile';
  return LOB_REGISTRY[defaultId] || LOB_REGISTRY.meow_mobile;
}

/**
 * Check if a problem type is shared telco (common to all LOBs)
 * vs LOB-specific (only applies to one LOB).
 */
function isSharedTelcoType(problemType) {
  return SHARED_TELCO_TYPES.has(problemType);
}

module.exports = {
  LOB_REGISTRY,
  SHARED_TELCO_TYPES,
  getLob,
  getAllLobs,
  getDefaultLob,
  isSharedTelcoType,
};
