'use client';

import { useState, useEffect, useCallback } from 'react';
import Header from './components/Header';
import PriorityQueue from './components/PriorityQueue';
import JourneyFunnel from './components/JourneyFunnel';
import CustomerDetail from './components/CustomerDetail';

export default function Dashboard() {
  const [customers, setCustomers] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const [tab, setTab] = useState('queue');
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const [severityCounts, setSeverityCounts] = useState({ critical: 0, high: 0, medium: 0, low: 0, healthy: 0 });
  const [slaCounts, setSlaCounts] = useState({ breached: 0, critical: 0, warning: 0, ok: 0 });
  const [journeyFunnel, setJourneyFunnel] = useState([]);
  const [ticketCount, setTicketCount] = useState(0);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/customers');
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data = await res.json();
      setCustomers(data.customers || []);
      setSeverityCounts(data.severityCounts || {});
      setSlaCounts(data.slaCounts || {});
      setJourneyFunnel(data.journeyFunnel || []);
      setTicketCount(data.ticketCount || 0);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchData]);

  useEffect(() => {
    let result = customers;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(c =>
        c.name?.toLowerCase().includes(term) ||
        c.email?.toLowerCase().includes(term) ||
        c.phone?.includes(term) ||
        c.onboardingStatus?.toLowerCase().includes(term) ||
        c.stuckStage?.toLowerCase().includes(term)
      );
    }
    if (statusFilter !== 'all') {
      result = result.filter(c => c.healthCategory === statusFilter);
    }
    setFiltered(result);
  }, [customers, searchTerm, statusFilter]);

  const exportCSV = () => {
    const headers = ['Name', 'Email', 'Phone', 'Health Score', 'Category', 'SLA', 'Stuck Stage', 'Stuck Hours', 'Onboarding Status', 'eSIM Status', 'Port-in Status', 'Order Status', 'Issue Tags', 'Signed Up'];
    const rows = filtered.map(c => [
      c.name, c.email || '', c.phone || '', c.healthScore, c.healthCategory, c.slaStatus,
      c.stuckStage, Math.round(c.stuckHours || 0), c.onboardingStatus || '',
      c.esimStatus || '', c.portinStatus || '', c.latestOrderStatus || '',
      (c.issueTags || []).join('; '), c.signedUpAt || '',
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `customer-health-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // When a proactive ticket is created, update both the selected customer and the main list
  const handleCustomerUpdate = useCallback((updatedCustomer) => {
    setSelectedCustomer(updatedCustomer);
    setCustomers(prev => prev.map(c =>
      c.id === updatedCustomer.id ? updatedCustomer : c
    ));
  }, []);

  // Detail view
  if (selectedCustomer) {
    return (
      <div className="max-w-[1200px] mx-auto px-4 py-6">
        <CustomerDetail
          customer={selectedCustomer}
          onBack={() => setSelectedCustomer(null)}
          onCustomerUpdate={handleCustomerUpdate}
        />
      </div>
    );
  }

  return (
    <div className="max-w-[1200px] mx-auto px-4 py-6">
      <Header
        severityCounts={severityCounts}
        total={customers.length}
        lastUpdated={lastUpdated}
        onRefresh={fetchData}
        onExport={exportCSV}
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        statusFilter={statusFilter}
        onStatusChange={setStatusFilter}
        ticketCount={ticketCount}
      />

      {/* Tabs */}
      <div className="flex gap-1 mb-6">
        <button
          onClick={() => setTab('queue')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
            tab === 'queue'
              ? 'bg-accent-blue/20 text-accent-blue border border-accent-blue/30'
              : 'bg-dark-card text-gray-500 border border-dark-border hover:text-gray-300'
          }`}
        >
          Priority Queue
        </button>
        <button
          onClick={() => setTab('funnel')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
            tab === 'funnel'
              ? 'bg-accent-purple/20 text-accent-purple border border-accent-purple/30'
              : 'bg-dark-card text-gray-500 border border-dark-border hover:text-gray-300'
          }`}
        >
          Journey Funnel
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-900/20 border border-red-800/30 rounded-lg text-red-400 text-sm">
          Error loading data: {error}. <button onClick={fetchData} className="underline">Retry</button>
        </div>
      )}

      {loading && customers.length === 0 ? (
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="animate-pulse bg-dark-card rounded-xl border border-dark-border p-6 h-32" />
          ))}
        </div>
      ) : tab === 'queue' ? (
        <PriorityQueue
          customers={filtered}
          journeyFunnel={journeyFunnel}
          onSelect={setSelectedCustomer}
        />
      ) : (
        <JourneyFunnel
          customers={filtered}
          journeyFunnel={journeyFunnel}
          onSelect={setSelectedCustomer}
        />
      )}

      <div className="mt-6 text-center text-xs text-gray-600">
        Showing {filtered.length} of {customers.length} customers &middot; Data from Databricks
      </div>
    </div>
  );
}
