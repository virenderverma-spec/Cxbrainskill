'use client';

import { useState } from 'react';
import { formatHours, slaBadge, TAG_COLORS, JOURNEY_STAGES } from './shared';

function getBlockerReason(stageId, c) {
  switch (stageId) {
    case 'esim_activation':
      if (c.esimStatus === 'ERROR') return 'eSIM Error';
      if (c.portinStatus === 'CONFLICT') return 'Port-in Conflict';
      if (c.portinStatus === 'REVIEWING') return 'Port-in Reviewing';
      if (c.onboardingStatus === 'IMEI_CHECKING') return 'IMEI Check';
      return 'Pending';
    case 'number_selection':
      if (c.portinStatus === 'CONFLICT') return 'Port-in Conflict';
      if (c.portinStatus === 'REVIEWING') return 'Port-in Reviewing';
      return 'Awaiting Selection';
    case 'payment':
      return 'Payment Pending';
    case 'order_created':
      if (c.latestOrderStatus === 'DRAFT') return 'Draft';
      if (c.latestOrderStatus === 'INPROGRESS') return 'In Progress';
      if (c.latestOrderStatus === 'PENDING') return 'Pending';
      return c.latestOrderStatus || 'Unknown';
    case 'airvet_account':
      return c.isAirvetActivated ? 'Airvet Active' : 'Airvet Pending';
    default:
      return 'Pending';
  }
}

function groupByBlocker(stageId, stageCustomers) {
  const groups = {};
  for (const c of stageCustomers) {
    const reason = getBlockerReason(stageId, c);
    if (!groups[reason]) groups[reason] = [];
    groups[reason].push(c);
  }
  return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
}

const BLOCKER_COLORS = {
  'eSIM Error': 'bg-red-900/30 text-red-400 border-red-800/40',
  'Port-in Conflict': 'bg-indigo-900/30 text-indigo-400 border-indigo-800/40',
  'Port-in Reviewing': 'bg-amber-900/30 text-amber-400 border-amber-800/40',
  'IMEI Check': 'bg-violet-900/30 text-violet-400 border-violet-800/40',
  'Draft': 'bg-gray-800/50 text-gray-400 border-gray-700/50',
  'Payment Pending': 'bg-orange-900/30 text-orange-400 border-orange-800/40',
  'Airvet Pending': 'bg-cyan-900/30 text-cyan-400 border-cyan-800/40',
};

export default function JourneyFunnel({ customers, journeyFunnel, onSelect }) {
  const maxCount = Math.max(...(journeyFunnel || []).map(s => s.count), 1);
  const [collapsed, setCollapsed] = useState({});
  const [subCollapsed, setSubCollapsed] = useState({});

  const toggle = (stageId) => {
    setCollapsed(prev => ({ ...prev, [stageId]: !prev[stageId] }));
  };

  const toggleSub = (key) => {
    setSubCollapsed(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="space-y-0">
      {JOURNEY_STAGES.map((stage, idx) => {
        const funnelData = (journeyFunnel || []).find(f => f.id === stage.id) || { count: 0, breachedCount: 0 };
        const stageCustomers = customers.filter(c => c.stuckAt === stage.id)
          .sort((a, b) => (b.stuckHours || 0) - (a.stuckHours || 0));
        const pct = maxCount > 0 ? (funnelData.count / maxCount) * 100 : 0;
        const isEmpty = stageCustomers.length === 0;
        const isCollapsed = collapsed[stage.id];

        return (
          <div key={stage.id}>
            {/* Connector arrow */}
            {idx > 0 && (
              <div className="flex justify-center py-1">
                <span className="text-gray-700 text-lg leading-none select-none">&darr;</span>
              </div>
            )}

            {/* Stage card */}
            <div className={`bg-dark-card rounded-xl border border-dark-border overflow-hidden transition ${isEmpty ? 'opacity-40' : ''}`}>
              {/* Stage header — clickable to collapse/expand */}
              <button
                onClick={() => !isEmpty && toggle(stage.id)}
                disabled={isEmpty}
                className={`relative w-full px-5 py-3 text-left ${!isEmpty ? 'cursor-pointer hover:bg-dark-hover/50' : ''} transition`}
              >
                {/* Background bar */}
                <div
                  className={`absolute inset-y-0 left-0 ${
                    funnelData.breachedCount > 0 ? 'bg-sla-breached/8' : 'bg-accent-purple/8'
                  } transition-all`}
                  style={{ width: `${pct}%` }}
                />
                <div className="relative flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full bg-dark-surface border border-dark-border flex items-center justify-center text-xs font-mono font-bold text-gray-400">
                      {stage.order}
                    </span>
                    <span className="text-sm font-semibold text-gray-200">{stage.label}</span>
                    {/* Chevron indicator */}
                    {!isEmpty && (
                      <span className={`text-gray-600 text-xs transition-transform ${isCollapsed ? '' : 'rotate-90'}`}>
                        &#9654;
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold text-white">{funnelData.count}</span>
                    {funnelData.breachedCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#450A0A] text-sla-breached border border-red-800/50">
                        {funnelData.breachedCount} breached
                      </span>
                    )}
                  </div>
                </div>
              </button>

              {/* Sub-status groups with customers — collapsible */}
              {stageCustomers.length > 0 && !isCollapsed && (() => {
                const groups = groupByBlocker(stage.id, stageCustomers);
                return (
                  <div className="border-t border-dark-border">
                    {groups.map(([reason, groupCustomers]) => {
                      const subKey = `${stage.id}__${reason}`;
                      const isSubCollapsed = subCollapsed[subKey];
                      const sorted = [...groupCustomers].sort((a, b) => (b.stuckHours || 0) - (a.stuckHours || 0));
                      return (
                        <div key={reason}>
                          <button
                            onClick={() => toggleSub(subKey)}
                            className="flex items-center gap-2 px-5 py-2 bg-dark-surface/40 border-b border-dark-border/50 w-full text-left hover:bg-dark-surface/60 transition cursor-pointer"
                          >
                            <span className={`text-gray-600 text-[10px] transition-transform ${isSubCollapsed ? '' : 'rotate-90'}`}>&#9654;</span>
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${BLOCKER_COLORS[reason] || 'bg-gray-800/50 text-gray-400 border-gray-700/50'}`}>
                              {reason}
                            </span>
                            <span className="text-[11px] font-mono font-bold text-gray-400">{groupCustomers.length}</span>
                          </button>
                          {!isSubCollapsed && sorted.map(customer => {
                            const sla = slaBadge(customer.slaStatus);
                            return (
                              <div
                                key={customer.id}
                                className="flex items-center gap-3 px-5 pl-9 py-2.5 border-b border-dark-border/30 last:border-b-0 hover:bg-dark-hover transition cursor-pointer group"
                                onClick={() => onSelect(customer)}
                              >
                                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                  <span className="text-sm text-gray-300 truncate">{customer.name}</span>
                                  {customer.isS100 && (
                                    <span className="flex-shrink-0 px-1 py-0 rounded text-[9px] font-bold bg-ssc-bg text-ssc-gold border border-ssc-border">
                                      S100
                                    </span>
                                  )}
                                </div>
                                {sla && (
                                  <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold border ${sla.cls}`}>
                                    {sla.label}
                                  </span>
                                )}
                                <div className="flex gap-1 flex-shrink-0">
                                  {(customer.issueTags || []).slice(0, 2).map(tag => (
                                    <span
                                      key={tag}
                                      className={`px-1.5 py-0 rounded-full text-[9px] font-medium border ${TAG_COLORS[tag] || 'bg-gray-800/50 text-gray-400 border-gray-700/50'}`}
                                    >
                                      {tag}
                                    </span>
                                  ))}
                                </div>
                                <span className="font-mono text-xs font-semibold text-gray-400 flex-shrink-0 w-16 text-right tabular-nums">
                                  {formatHours(customer.stuckHours)}
                                </span>
                                <span className="text-gray-700 group-hover:text-accent-blue transition flex-shrink-0">&rarr;</span>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>
        );
      })}
    </div>
  );
}
