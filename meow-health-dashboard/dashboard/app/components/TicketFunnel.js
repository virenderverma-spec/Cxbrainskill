'use client';

import { formatHours, ZENDESK_BASE } from './shared';

function urgencyLevel(hours) {
  if (hours >= 72) return 'critical';
  if (hours >= 48) return 'high';
  return 'warning';
}

function urgencyBorder(level) {
  switch (level) {
    case 'critical': return 'border-l-red-500';
    case 'high': return 'border-l-amber-500';
    default: return 'border-l-yellow-500';
  }
}

function urgencyBadge(level) {
  switch (level) {
    case 'critical':
      return { label: 'CRITICAL', cls: 'bg-red-900/40 text-red-400 border-red-800/40' };
    case 'high':
      return { label: 'HIGH', cls: 'bg-amber-900/40 text-amber-400 border-amber-800/40' };
    default:
      return { label: 'WARNING', cls: 'bg-yellow-900/40 text-yellow-400 border-yellow-800/40' };
  }
}

function statusBadge(status) {
  const map = {
    new: 'bg-blue-900/30 text-blue-400 border-blue-800/30',
    open: 'bg-green-900/30 text-green-400 border-green-800/30',
    hold: 'bg-purple-900/30 text-purple-400 border-purple-800/30',
  };
  return map[status] || 'bg-gray-900/30 text-gray-400 border-gray-800/30';
}

export default function TicketFunnel({ unrespondedTickets = [] }) {
  const criticalCount = unrespondedTickets.filter(t => t.waitingSinceHours >= 72).length;
  const highCount = unrespondedTickets.filter(t => t.waitingSinceHours >= 48 && t.waitingSinceHours < 72).length;
  const warningCount = unrespondedTickets.filter(t => t.waitingSinceHours < 48).length;

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="bg-dark-card border border-dark-border rounded-xl p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-lg font-semibold text-white">{unrespondedTickets.length}</span>
            <span className="text-sm text-gray-400">tickets awaiting agent response</span>
          </div>
          <div className="flex gap-3 text-xs">
            {criticalCount > 0 && (
              <span className="px-2 py-1 rounded border bg-red-900/40 text-red-400 border-red-800/40">
                {criticalCount} critical (&gt;72h)
              </span>
            )}
            {highCount > 0 && (
              <span className="px-2 py-1 rounded border bg-amber-900/40 text-amber-400 border-amber-800/40">
                {highCount} high (&gt;48h)
              </span>
            )}
            {warningCount > 0 && (
              <span className="px-2 py-1 rounded border bg-yellow-900/40 text-yellow-400 border-yellow-800/40">
                {warningCount} warning (&gt;24h)
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Ticket list */}
      {unrespondedTickets.length === 0 ? (
        <div className="bg-dark-card border border-dark-border rounded-xl p-8 text-center text-gray-500">
          No unresponded tickets found. All tickets have been responded to within 24 hours.
        </div>
      ) : (
        unrespondedTickets.map(ticket => {
          const level = urgencyLevel(ticket.waitingSinceHours);
          const badge = urgencyBadge(level);
          const border = urgencyBorder(level);

          return (
            <a
              key={ticket.id}
              href={`${ZENDESK_BASE}/agent/tickets/${ticket.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className={`block bg-dark-card border border-dark-border rounded-xl p-4 border-l-4 ${border} hover:bg-dark-hover transition cursor-pointer`}
            >
              <div className="flex items-start justify-between gap-4">
                {/* Left side */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-mono text-gray-400">ZD-{ticket.id}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium uppercase ${statusBadge(ticket.status)}`}>
                      {ticket.status}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${badge.cls}`}>
                      {badge.label}
                    </span>
                    {ticket.priority && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded border bg-gray-800/50 text-gray-400 border-gray-700/50 uppercase">
                        {ticket.priority}
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-white truncate mb-1">{ticket.subject}</div>
                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    {ticket.requesterEmail && (
                      <span>{ticket.requesterEmail}</span>
                    )}
                    <span>
                      {ticket.hasAgentResponse ? 'Customer replied — awaiting agent' : 'No agent response yet'}
                    </span>
                  </div>
                </div>

                {/* Right side — waiting time */}
                <div className="text-right shrink-0">
                  <div className={`text-lg font-mono font-bold ${
                    level === 'critical' ? 'text-red-400' : level === 'high' ? 'text-amber-400' : 'text-yellow-400'
                  }`}>
                    {formatHours(ticket.waitingSinceHours)}
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5">waiting</div>
                </div>
              </div>

              {/* Bottom row — tags */}
              {ticket.tags && ticket.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2 pt-2 border-t border-dark-border">
                  {ticket.tags
                    .filter(tag => !tag.startsWith('inquiry____') && !tag.startsWith('intent__') && !tag.startsWith('sentiment__') && !tag.startsWith('language__') && !tag.includes('confidence'))
                    .slice(0, 5)
                    .map(tag => (
                      <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800/50 text-gray-500 border border-gray-700/30">
                        {tag}
                      </span>
                    ))}
                </div>
              )}
            </a>
          );
        })
      )}
    </div>
  );
}
