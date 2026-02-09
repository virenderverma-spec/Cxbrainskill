/**
 * Communications Log (In-Memory)
 *
 * Tracks outbound communications per customer for the
 * outbound gate (15-min window) and dedup checks.
 *
 * In production, replace with a persistent store (Redis, DB).
 */

const commsLog = [];

/**
 * Log a communication event
 */
function logComms({ recipient, channel, source, ticketId, signalType, messageId }) {
  const entry = {
    id: `comms_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    recipient,
    channel,
    source, // 'agent_response', 'proactive', 'system'
    ticket_id: ticketId,
    signal_type: signalType || null,
    dispatched_at: new Date().toISOString(),
    message_id: messageId || null
  };

  commsLog.push(entry);

  // Keep only last 24h of entries
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  while (commsLog.length > 0 && new Date(commsLog[0].dispatched_at).getTime() < cutoff) {
    commsLog.shift();
  }

  return entry;
}

/**
 * Check if a response was sent to a customer within the last N minutes
 */
function getRecentComms(recipient, minutesAgo = 15) {
  const cutoff = new Date(Date.now() - minutesAgo * 60 * 1000).toISOString();
  return commsLog.filter(
    entry => entry.recipient === recipient && entry.dispatched_at > cutoff
  );
}

/**
 * Count total messages to a customer in the last 24 hours
 */
function get24hCount(recipient) {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  return commsLog.filter(
    entry => entry.recipient === recipient && entry.dispatched_at > cutoff
  ).length;
}

/**
 * Check if a proactive message was recently sent
 */
function getRecentProactiveComms(recipient, minutesAgo = 30) {
  const cutoff = new Date(Date.now() - minutesAgo * 60 * 1000).toISOString();
  return commsLog.filter(
    entry => entry.recipient === recipient
      && entry.source === 'proactive'
      && entry.dispatched_at > cutoff
  );
}

module.exports = {
  logComms,
  getRecentComms,
  get24hCount,
  getRecentProactiveComms
};
