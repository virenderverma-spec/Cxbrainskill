'use client';

import CustomerCard from './CustomerCard';

export default function PriorityQueue({ customers, journeyFunnel, onSelect }) {
  // Sort by health score ascending (most critical first), then by stuck hours descending
  const sorted = [...customers].sort((a, b) =>
    (a.healthScore ?? 100) - (b.healthScore ?? 100) || (b.stuckHours || 0) - (a.stuckHours || 0)
  );

  // Funnel summary bar
  const funnelStages = (journeyFunnel || []).filter(s => s.count > 0);
  const maxCount = Math.max(...funnelStages.map(s => s.count), 1);

  return (
    <div>
      {/* Compact funnel summary bar */}
      {funnelStages.length > 0 && (
        <div className="mb-6 bg-dark-card rounded-xl border border-dark-border p-4">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-2 font-medium">Journey Funnel</div>
          <div className="flex items-end gap-1.5">
            {(journeyFunnel || []).map(stage => {
              const pct = maxCount > 0 ? (stage.count / maxCount) * 100 : 0;
              const hasBreached = stage.breachedCount > 0;
              return (
                <div key={stage.id} className="flex-1 text-center">
                  <div className="text-[11px] font-mono font-bold text-gray-300 mb-1">
                    {stage.count}
                    {hasBreached && (
                      <span className="text-sla-breached ml-0.5 text-[9px]">({stage.breachedCount})</span>
                    )}
                  </div>
                  <div
                    className={`rounded-sm transition-all ${
                      hasBreached ? 'bg-sla-breached/40' : stage.count > 0 ? 'bg-accent-blue/30' : 'bg-dark-surface'
                    }`}
                    style={{ height: `${Math.max(pct * 0.4, 2)}px`, minHeight: '2px' }}
                  />
                  <div className="text-[9px] text-gray-600 mt-1 leading-tight">{stage.label}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Customer cards */}
      {sorted.length === 0 ? (
        <div className="text-center text-gray-600 py-12">No customers match your filters.</div>
      ) : (
        <div className="space-y-3">
          {sorted.map(customer => (
            <CustomerCard key={customer.id} customer={customer} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}
