'use client';

const ZENDESK_BASE = 'https://rockstarautomations.zendesk.com';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'critical', label: 'Critical', dot: 'bg-red-500' },
  { key: 'high', label: 'High', dot: 'bg-orange-500' },
  { key: 'medium', label: 'Medium', dot: 'bg-yellow-500' },
  { key: 'low', label: 'Low', dot: 'bg-green-500' },
  { key: 'healthy', label: 'Healthy', dot: 'bg-emerald-500' },
];

export default function Header({
  severityCounts, total, lastUpdated,
  onRefresh, onExport, searchTerm, onSearchChange, statusFilter, onStatusChange,
  ticketCount,
}) {
  const timeAgo = lastUpdated
    ? `${Math.round((Date.now() - lastUpdated.getTime()) / 60000)}m ago`
    : '...';

  return (
    <div className="mb-6">
      {/* Top row */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold text-white">Customer Health Dashboard</h1>
            <span className="px-2 py-0.5 rounded-md text-sm font-bold bg-accent-blue/15 text-accent-blue border border-accent-blue/30 tabular-nums">
              {total}
            </span>
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-accent-purple/20 text-accent-purple border border-accent-purple/30">
              Databricks
            </span>
          </div>
          <p className="text-xs text-gray-500">
            {total} stuck customers tracked
            {ticketCount > 0 && (
              <a
                href={`${ZENDESK_BASE}/agent/filters`}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-2 text-gray-500 hover:text-accent-blue transition"
              >
                &middot; {ticketCount} open tickets &nearr;
              </a>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Severity badges — clickable, match filter categories */}
          {severityCounts.critical > 0 && (
            <button
              onClick={() => onStatusChange('critical')}
              className="px-2.5 py-1 rounded-md text-xs font-bold bg-[#450A0A] text-sla-breached border border-red-800/50 animate-pulse hover:brightness-125 transition"
            >
              {severityCounts.critical} CRITICAL
            </button>
          )}
          {severityCounts.high > 0 && (
            <button
              onClick={() => onStatusChange('high')}
              className="px-2.5 py-1 rounded-md text-xs font-bold bg-[#451A03] text-sla-critical border border-amber-800/50 hover:brightness-125 transition"
            >
              {severityCounts.high} HIGH
            </button>
          )}
          <span className="text-[11px] text-gray-600">{timeAgo}</span>
          <button onClick={onRefresh} className="px-3 py-1.5 text-xs bg-dark-surface text-gray-400 border border-dark-border rounded-md hover:text-gray-200 hover:bg-dark-hover transition">
            Refresh
          </button>
          <button onClick={onExport} className="px-3 py-1.5 text-xs bg-accent-blue/10 text-accent-blue border border-accent-blue/20 rounded-md hover:bg-accent-blue/20 transition">
            Export CSV
          </button>
        </div>
      </div>

      {/* Filter row */}
      <div className="flex items-center gap-3">
        <div className="flex gap-1">
          {FILTERS.map(f => {
            const count = f.key === 'all' ? null : severityCounts?.[f.key] || 0;
            const isActive = statusFilter === f.key;
            return (
              <button
                key={f.key}
                onClick={() => onStatusChange(f.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition ${
                  isActive
                    ? 'bg-dark-surface text-white border border-gray-600'
                    : 'bg-dark-card text-gray-500 border border-dark-border hover:text-gray-300'
                }`}
              >
                {f.dot && <span className={`w-1.5 h-1.5 rounded-full ${f.dot}`} />}
                {f.label}
                {count != null && count > 0 && (
                  <span className="text-gray-600 ml-0.5">{count}</span>
                )}
              </button>
            );
          })}
        </div>
        <input
          type="text"
          placeholder="Search customers..."
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          className="flex-1 px-3 py-1.5 bg-dark-card border border-dark-border rounded-md text-sm text-gray-300 placeholder-gray-600 focus:outline-none focus:border-accent-blue/40"
        />
      </div>
    </div>
  );
}
