'use client';

import { formatHours, slaBorderColor, slaBadge, TAG_COLORS, ZENDESK_BASE } from './shared';

export default function CustomerCard({ customer, onSelect }) {
  const sla = slaBadge(customer.slaStatus);
  const borderClass = slaBorderColor(customer.slaStatus);

  return (
    <div className={`bg-dark-card rounded-xl border border-dark-border ${borderClass} border-l-[3px] hover:bg-dark-hover transition group`}>
      <div className="p-5">
        {/* Top row: name + stuck time */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="text-[15px] font-semibold text-white truncate">{customer.name}</h3>
            {customer.isS100 && (
              <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold bg-ssc-bg text-ssc-gold border border-ssc-border">
                S100
              </span>
            )}
            {customer.phone && (
              <span className="text-xs text-gray-500 flex-shrink-0">{customer.phone}</span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 ml-3">
            {sla && (
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${sla.cls}`}>
                {sla.label}
              </span>
            )}
            <span className="font-mono text-xl font-bold text-white tabular-nums leading-none">
              {formatHours(customer.stuckHours)}
            </span>
          </div>
        </div>

        {/* Stuck at + tags row */}
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-dark-surface text-gray-300 border border-dark-border">
            <span className="text-gray-500">Stuck at</span> {customer.stuckStage}
          </span>
          {customer.onboardingStatus && (
            <span className="px-2 py-0.5 rounded-md text-[10px] font-mono text-gray-500 bg-dark-surface/50 border border-dark-border/50">
              {customer.onboardingStatus}
            </span>
          )}
          {(customer.issueTags || []).map(tag => (
            <span
              key={tag}
              className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${TAG_COLORS[tag] || 'bg-gray-800/50 text-gray-400 border-gray-700/50'}`}
            >
              {tag}
            </span>
          ))}
        </div>

        {/* Data row: eSIM status, port-in status, order status */}
        <div className="flex items-center gap-4 text-xs text-gray-500 mb-3">
          {customer.esimStatus && (
            <span className={customer.esimStatus === 'ERROR' ? 'text-red-400' : ''}>
              eSIM: {customer.esimStatus}
            </span>
          )}
          {customer.portinStatus && customer.portinStatus !== 'NONE' && (
            <span className={customer.portinStatus === 'CONFLICT' ? 'text-red-400' : ''}>
              Port-in: {customer.portinStatus}
            </span>
          )}
          {customer.latestOrderStatus && (
            <span>Order: {customer.latestOrderStatus}</span>
          )}
          {customer.city && customer.region && (
            <span className="text-gray-600">{customer.city}, {customer.region}</span>
          )}
        </div>

        {/* Bottom row: tickets + view button */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 text-xs text-gray-500">
            {customer.tickets && customer.tickets.length > 0 ? (
              <a
                href={`${ZENDESK_BASE}/agent/tickets/${customer.tickets[0].id}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className="text-gray-500 hover:text-accent-blue transition"
              >
                ZD-{customer.tickets[0].id}
              </a>
            ) : (
              <a
                href={`${ZENDESK_BASE}/agent/search/1?type=ticket&q=${encodeURIComponent(customer.email || customer.name)}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className="text-gray-600 hover:text-accent-blue transition"
              >
                Search in Zendesk &nearr;
              </a>
            )}
            {customer.email && (
              <span className="text-gray-600 truncate max-w-[200px]">{customer.email}</span>
            )}
          </div>
          <button
            onClick={() => onSelect(customer)}
            className="px-3 py-1.5 rounded-md text-xs font-medium bg-accent-blue/10 text-accent-blue border border-accent-blue/20 hover:bg-accent-blue/20 transition opacity-70 group-hover:opacity-100"
          >
            View &rarr;
          </button>
        </div>
      </div>
    </div>
  );
}
