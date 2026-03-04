'use client';

import { useState } from 'react';
import CustomerCard from './CustomerCard';

const BRAND_REGISTRY = {
  meow_mobile: { displayName: 'Meow Mobile', shortName: 'Mobile', color: '#6C5CE7' },
  meow_pager:  { displayName: 'Meow Pager',  shortName: 'Pager',  color: '#E17055' },
  meow_stem:   { displayName: 'Meow STEM+',  shortName: 'STEM+',  color: '#00B894' },
};

export default function BrandView({ customers, onSelect }) {
  const [selectedBrand, setSelectedBrand] = useState(null);

  // Group customers by brand
  const grouped = {};
  for (const c of customers) {
    const brandId = c.brandId || 'meow_mobile';
    if (!grouped[brandId]) grouped[brandId] = [];
    grouped[brandId].push(c);
  }

  // Sort each group by health score ascending (worst first)
  for (const brandId of Object.keys(grouped)) {
    grouped[brandId].sort((a, b) =>
      (a.healthScore ?? 100) - (b.healthScore ?? 100) || (b.stuckHours || 0) - (a.stuckHours || 0)
    );
  }

  // Sort brands by customer count descending
  const sortedBrands = Object.keys(grouped).sort((a, b) => grouped[b].length - grouped[a].length);

  if (customers.length === 0) {
    return (
      <div className="text-center text-gray-600 py-12">No customers match your filters.</div>
    );
  }

  // --- Drilled-down view: single brand selected ---
  if (selectedBrand) {
    const meta = BRAND_REGISTRY[selectedBrand] || BRAND_REGISTRY.meow_mobile;
    const brandCustomers = grouped[selectedBrand] || [];
    const criticalCount = brandCustomers.filter(c => c.healthCategory === 'critical').length;
    const highCount = brandCustomers.filter(c => c.healthCategory === 'high').length;
    const mediumCount = brandCustomers.filter(c => c.healthCategory === 'medium').length;
    const withTickets = brandCustomers.filter(c => c.ticketCount > 0).length;
    const silent = brandCustomers.filter(c => c.isSilent).length;

    return (
      <div className="space-y-4">
        {/* Brand header with back button */}
        <div className="bg-dark-card border border-dark-border rounded-xl p-5" style={{ borderTopColor: meta.color, borderTopWidth: '3px' }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSelectedBrand(null)}
                className="px-2.5 py-1 rounded-md text-xs font-medium bg-dark-surface text-gray-400 border border-dark-border hover:text-gray-200 transition"
              >
                &larr; All Brands
              </button>
              <span
                className="px-2 py-0.5 rounded text-[10px] font-bold border"
                style={{ color: meta.color, borderColor: meta.color + '40', backgroundColor: meta.color + '15' }}
              >
                {meta.shortName}
              </span>
              <h2 className="text-lg font-bold text-white">{meta.displayName}</h2>
            </div>
            <span className="text-2xl font-bold font-mono text-white">{brandCustomers.length}</span>
          </div>
          <div className="flex gap-3 text-[11px]">
            {criticalCount > 0 && (
              <span className="px-2 py-0.5 rounded bg-red-900/40 text-red-400 border border-red-800/40 font-medium">
                {criticalCount} critical
              </span>
            )}
            {highCount > 0 && (
              <span className="px-2 py-0.5 rounded bg-amber-900/40 text-amber-400 border border-amber-800/40 font-medium">
                {highCount} high
              </span>
            )}
            {mediumCount > 0 && (
              <span className="px-2 py-0.5 rounded bg-yellow-900/40 text-yellow-400 border border-yellow-800/40 font-medium">
                {mediumCount} medium
              </span>
            )}
            <span className="px-2 py-0.5 rounded bg-dark-surface text-gray-400 border border-dark-border font-medium">
              {withTickets} with tickets
            </span>
            <span className="px-2 py-0.5 rounded bg-dark-surface text-gray-400 border border-dark-border font-medium">
              {silent} silent
            </span>
          </div>
        </div>

        {/* Customer cards for this brand only */}
        {brandCustomers.length === 0 ? (
          <div className="text-center text-gray-600 py-12">No customers for this brand.</div>
        ) : (
          <div className="space-y-3">
            {brandCustomers.map(customer => (
              <CustomerCard key={customer.id} customer={customer} onSelect={onSelect} />
            ))}
          </div>
        )}
      </div>
    );
  }

  // --- Overview: all brands with clickable summary cards ---
  return (
    <div className="space-y-6">
      {/* Brand summary cards — clickable */}
      <div className="grid grid-cols-3 gap-3">
        {sortedBrands.map(brandId => {
          const meta = BRAND_REGISTRY[brandId] || BRAND_REGISTRY.meow_mobile;
          const brandCustomers = grouped[brandId];
          const criticalCount = brandCustomers.filter(c => c.healthCategory === 'critical').length;
          const highCount = brandCustomers.filter(c => c.healthCategory === 'high').length;
          return (
            <button
              key={brandId}
              onClick={() => setSelectedBrand(brandId)}
              className="bg-dark-card border border-dark-border rounded-xl p-4 text-left hover:bg-dark-hover transition cursor-pointer"
              style={{ borderTopColor: meta.color, borderTopWidth: '3px' }}
            >
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="px-2 py-0.5 rounded text-[10px] font-bold border"
                  style={{ color: meta.color, borderColor: meta.color + '40', backgroundColor: meta.color + '15' }}
                >
                  {meta.shortName}
                </span>
                <span className="text-sm font-semibold text-white">{meta.displayName}</span>
              </div>
              <div className="flex items-baseline gap-3">
                <span className="text-2xl font-bold font-mono text-white">{brandCustomers.length}</span>
                <span className="text-xs text-gray-500">customers</span>
              </div>
              <div className="flex gap-2 mt-2 text-[10px]">
                {criticalCount > 0 && (
                  <span className="px-1.5 py-0.5 rounded bg-red-900/40 text-red-400 border border-red-800/40 font-medium">
                    {criticalCount} critical
                  </span>
                )}
                {highCount > 0 && (
                  <span className="px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-400 border border-amber-800/40 font-medium">
                    {highCount} high
                  </span>
                )}
                {criticalCount === 0 && highCount === 0 && (
                  <span className="text-gray-600">No critical issues</span>
                )}
              </div>
              <div className="mt-2 text-[10px] text-gray-500">
                Click to view &rarr;
              </div>
            </button>
          );
        })}
      </div>

      {/* All brands listed below */}
      {sortedBrands.map(brandId => {
        const meta = BRAND_REGISTRY[brandId] || BRAND_REGISTRY.meow_mobile;
        const brandCustomers = grouped[brandId];
        return (
          <div key={brandId}>
            <button
              onClick={() => setSelectedBrand(brandId)}
              className="flex items-center gap-2 mb-3 group cursor-pointer"
            >
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: meta.color }}
              />
              <h3 className="text-sm font-semibold text-white group-hover:text-gray-300 transition">{meta.displayName}</h3>
              <span className="text-xs text-gray-500 font-mono">{brandCustomers.length}</span>
              <span className="text-[10px] text-gray-600 group-hover:text-gray-400 transition">&rarr;</span>
            </button>
            <div className="space-y-3">
              {brandCustomers.slice(0, 3).map(customer => (
                <CustomerCard key={customer.id} customer={customer} onSelect={onSelect} />
              ))}
              {brandCustomers.length > 3 && (
                <button
                  onClick={() => setSelectedBrand(brandId)}
                  className="w-full py-2 rounded-lg text-xs font-medium text-gray-500 bg-dark-card border border-dark-border hover:text-gray-300 hover:bg-dark-hover transition"
                >
                  View all {brandCustomers.length} {meta.displayName} customers &rarr;
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
