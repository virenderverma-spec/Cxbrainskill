/**
 * LOB Resolver — Detection chain for identifying which Line of Business
 * a customer belongs to.
 *
 * Chain:
 *   0. Databricks brand column (if available)
 *   1. Boss API planName from individual.products[].productCharacteristic[]
 *   2. Fallback: Zendesk ticket tag lob:* prefix
 *   3. Fallback: return null (frontend shows LOB picker)
 */

const { LOB_REGISTRY, getAllLobs, getDefaultLob } = require('../config/lob-registry');

/**
 * Resolve LOB from Databricks brand, Boss API lookup data, and/or Zendesk ticket.
 *
 * @param {Object} lookup - Customer lookup result from performCustomerLookup()
 * @param {Object} [zendeskTicket] - Most recent Zendesk ticket (optional)
 * @returns {{ lobId, displayName, shortName, color, icon }|null}
 */
function resolveLob(lookup, zendeskTicket) {
  // 0. Try Databricks brand column (highest priority when available)
  const lobFromBrand = resolveLobFromBrand(lookup);
  if (lobFromBrand) return lobFromBrand;

  // 1. Try Boss API: extract planName from individual products
  const lobFromPlan = resolveLobFromPlan(lookup);
  if (lobFromPlan) return lobFromPlan;

  // 2. Fallback: check Zendesk ticket tags for lob:* prefix
  const lobFromTags = resolveLobFromTicketTags(zendeskTicket);
  if (lobFromTags) return lobFromTags;

  // 3. No detection — return null (frontend shows picker)
  return null;
}

/**
 * Match Databricks brand value against LOB registry brandNames array.
 */
function resolveLobFromBrand(lookup) {
  if (!lookup || !lookup.databricksBrand) return null;

  const brand = lookup.databricksBrand.toLowerCase().trim();
  for (const lob of getAllLobs()) {
    const names = lob.brandNames || [];
    for (const name of names) {
      if (brand === name.toLowerCase()) {
        return formatLobResult(lob);
      }
    }
  }
  return null;
}

/**
 * Extract planName from Boss API individual.products[].productCharacteristic[]
 * and match against LOB registry planPrefixes.
 */
function resolveLobFromPlan(lookup) {
  if (!lookup) return null;

  // Check individual → products → productCharacteristic for planName
  const individual = lookup.individual;
  if (!individual) return null;

  // individual could be an object or array
  const ind = Array.isArray(individual) ? individual[0] : individual;
  if (!ind) return null;

  // Look for planName in products
  const products = ind.products || ind.product || [];
  const productList = Array.isArray(products) ? products : [products];

  for (const product of productList) {
    const characteristics = product.productCharacteristic || product.characteristic || [];
    const charList = Array.isArray(characteristics) ? characteristics : [characteristics];

    for (const char of charList) {
      if (char.name === 'planName' || char.name === 'plan_name' || char.name === 'plan') {
        const planName = (char.value || '').toUpperCase();
        if (planName) {
          const matched = matchPlanToLob(planName);
          if (matched) return matched;
        }
      }
    }

    // Also check product.name directly
    const productName = (product.name || product.productName || '').toUpperCase();
    if (productName) {
      const matched = matchPlanToLob(productName);
      if (matched) return matched;
    }
  }

  // Also check individual-level plan fields
  const planName = (ind.planName || ind.plan_name || ind.plan || '').toUpperCase();
  if (planName) {
    const matched = matchPlanToLob(planName);
    if (matched) return matched;
  }

  return null;
}

/**
 * Match a plan name string against LOB registry planPrefixes.
 */
function matchPlanToLob(planName) {
  for (const lob of getAllLobs()) {
    for (const prefix of lob.planPrefixes) {
      if (planName.startsWith(prefix.toUpperCase())) {
        return formatLobResult(lob);
      }
    }
  }
  return null;
}

/**
 * Check Zendesk ticket tags against LOB registry tagPatterns.
 * Matches: lob:meow_mobile, cs_meow_mobile, meow_mobile, etc.
 */
function resolveLobFromTicketTags(ticket) {
  if (!ticket) return null;

  const tags = ticket.tags || [];
  for (const tag of tags) {
    const tagLower = (typeof tag === 'string' ? tag : '').toLowerCase();
    for (const lob of getAllLobs()) {
      const patterns = lob.tagPatterns || [lob.tagPrefix];
      for (const pattern of patterns) {
        if (tagLower === pattern.toLowerCase()) {
          return formatLobResult(lob);
        }
      }
    }
  }

  return null;
}

/**
 * Format LOB object for API response (subset of full registry entry).
 */
function formatLobResult(lob) {
  return {
    lobId: lob.lobId,
    displayName: lob.displayName,
    shortName: lob.shortName,
    color: lob.color,
    icon: lob.icon,
  };
}

module.exports = { resolveLob, resolveLobFromBrand, resolveLobFromPlan, resolveLobFromTicketTags };
