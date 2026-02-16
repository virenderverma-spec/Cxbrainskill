'use client';

import { formatHours, formatAge, slaBadge, TAG_COLORS, JOURNEY_STAGES, ZENDESK_BASE } from './shared';

const STAGE_STATUS = {
  passed: { icon: '\u2713', color: 'bg-green-500', text: 'text-green-400', ring: 'ring-green-500/30' },
  failed: { icon: '\u2717', color: 'bg-red-500', text: 'text-red-400', ring: 'ring-red-500/30' },
  locked: { icon: '\u25CF', color: 'bg-gray-700', text: 'text-gray-600', ring: 'ring-gray-700/30' },
};

function getStageStatus(stageOrder, stuckOrder) {
  if (stageOrder < stuckOrder) return 'passed';
  if (stageOrder === stuckOrder) return 'failed';
  return 'locked';
}

function getStageTimestamp(stageId, timestamps) {
  if (!timestamps) return null;
  switch (stageId) {
    case 'order_created': return timestamps.order;
    case 'payment': return timestamps.payment;
    case 'number_selection': return timestamps.numberSelection;
    case 'esim_activation': return timestamps.activation;
    case 'nw_enabled': return timestamps.activation; // Same step in practice
    case 'airvet_account': return timestamps.petInsurance;
    default: return null;
  }
}

export default function CustomerDetail({ customer, onBack }) {
  const sla = slaBadge(customer.slaStatus);
  const stuckOrder = customer.stuckOrder || 1;

  const resolutionSteps = buildResolutionSteps(customer.stuckAt, customer.issueTags || [], customer);
  const kbArticles = getKbArticles(customer.stuckAt, customer.issueTags || [], customer);

  return (
    <div>
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-300 mb-5 transition"
      >
        &larr; Back to list
      </button>

      {/* Customer header card */}
      <div className="bg-dark-card rounded-xl border border-dark-border p-6 mb-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-xl font-bold text-white">{customer.name}</h2>
              {customer.isS100 && (
                <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-ssc-bg text-ssc-gold border border-ssc-border">
                  S100 Member
                </span>
              )}
            </div>
            {customer.phone && <p className="text-sm text-gray-400">{customer.phone}</p>}
            {customer.email && <p className="text-xs text-gray-500">{customer.email}</p>}
          </div>
          <div className="text-right">
            {sla && (
              <span className={`inline-block px-2.5 py-1 rounded-md text-xs font-bold border mb-2 ${sla.cls}`}>
                {sla.label}
              </span>
            )}
            <div className="font-mono text-2xl font-bold text-white tabular-nums">
              {formatHours(customer.stuckHours)}
            </div>
            <div className="text-[11px] text-gray-500">stuck duration</div>
          </div>
        </div>

        {/* Meta row — Databricks-powered data */}
        <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
          {customer.onboardingStatus && (
            <span>Onboarding: <span className="text-gray-300">{customer.onboardingStatus}</span></span>
          )}
          {customer.telcoStatus && (
            <span>Telco: <span className="text-gray-300">{customer.telcoStatus}</span></span>
          )}
          {customer.esimStatus && (
            <span className={customer.esimStatus === 'ERROR' ? 'text-red-400' : ''}>
              eSIM: <span className="font-medium">{customer.esimStatus}</span>
            </span>
          )}
          {customer.portinStatus && customer.portinStatus !== 'NONE' && (
            <span className={customer.portinStatus === 'CONFLICT' ? 'text-red-400' : ''}>
              Port-in: <span className="font-medium">{customer.portinStatus}</span>
            </span>
          )}
          {customer.latestOrderStatus && (
            <span>Order: <span className="text-gray-300">{customer.latestOrderStatus}</span></span>
          )}
          {customer.isAirvetActivated && (
            <span className="text-green-400">Airvet Active</span>
          )}
          {customer.city && customer.region && (
            <span>{customer.city}, {customer.region}</span>
          )}
        </div>

        {/* Issue tags */}
        {(customer.issueTags || []).length > 0 && (
          <div className="flex gap-1.5 mt-3 flex-wrap">
            {customer.issueTags.map(tag => (
              <span key={tag} className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${TAG_COLORS[tag] || 'bg-gray-800/50 text-gray-400 border-gray-700/50'}`}>
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Two columns: Journey Timeline + Resolution */}
      <div className="grid grid-cols-[1fr_1fr] gap-6 mb-6">
        {/* Journey Timeline — powered by actual Databricks timestamps */}
        <div className="bg-dark-card rounded-xl border border-dark-border p-6">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-5">Journey Timeline</h3>
          <div className="space-y-0">
            {JOURNEY_STAGES.map((stage, idx) => {
              const status = getStageStatus(stage.order, stuckOrder);
              const style = STAGE_STATUS[status];
              const isFailed = status === 'failed';
              const timestamp = getStageTimestamp(stage.id, customer.onboardingTimestamps);

              return (
                <div key={stage.id}>
                  <div className="flex items-start gap-3">
                    {/* Dot + connector */}
                    <div className="flex flex-col items-center">
                      <div className={`w-7 h-7 rounded-full ${style.color} ring-4 ${style.ring} flex items-center justify-center text-xs font-bold text-white flex-shrink-0`}>
                        {style.icon}
                      </div>
                      {idx < JOURNEY_STAGES.length - 1 && (
                        <div className={`w-px h-8 ${status === 'locked' ? 'bg-gray-800' : 'bg-dark-border'}`} />
                      )}
                    </div>

                    {/* Stage label + details */}
                    <div className={`pt-1 pb-3 ${status === 'locked' ? 'opacity-40' : ''}`}>
                      <div className={`text-sm font-medium ${isFailed ? style.text : status === 'passed' ? 'text-gray-300' : 'text-gray-600'}`}>
                        {stage.label}
                        {isFailed && <span className="ml-1 text-[10px]">STUCK HERE</span>}
                      </div>

                      {/* Timestamp for completed stages */}
                      {status === 'passed' && timestamp && (
                        <div className="text-[10px] text-gray-600 mt-0.5 font-mono">
                          {new Date(timestamp).toLocaleString()}
                        </div>
                      )}

                      {/* Error details for failed stage */}
                      {isFailed && (
                        <div className="mt-2 bg-red-900/10 border border-red-800/20 rounded-lg p-3">
                          <div className="space-y-1 text-[11px]">
                            <div className="flex justify-between">
                              <span className="text-gray-500">Stage:</span>
                              <span className="text-gray-300">{customer.stuckStage}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-500">Duration:</span>
                              <span className="font-mono text-red-400">{formatHours(customer.stuckHours)}</span>
                            </div>
                            {customer.esimStatus && (
                              <div className="flex justify-between">
                                <span className="text-gray-500">eSIM Status:</span>
                                <span className={`${customer.esimStatus === 'ERROR' ? 'text-red-400' : 'text-gray-300'}`}>
                                  {customer.esimStatus}
                                </span>
                              </div>
                            )}
                            {customer.portinStatus && customer.portinStatus !== 'NONE' && (
                              <div className="flex justify-between">
                                <span className="text-gray-500">Port-in:</span>
                                <span className={`${customer.portinStatus === 'CONFLICT' ? 'text-red-400' : 'text-gray-300'}`}>
                                  {customer.portinStatus}
                                </span>
                              </div>
                            )}
                            {customer.latestOrderStatus && (
                              <div className="flex justify-between">
                                <span className="text-gray-500">Order:</span>
                                <span className="text-gray-300">{customer.latestOrderStatus}</span>
                              </div>
                            )}
                          </div>

                          {/* Impact statement */}
                          <div className="mt-2 p-2 bg-red-900/20 rounded text-[11px] text-red-300 border border-red-800/20">
                            {customer.recommendedAction || `Customer stuck at ${customer.stuckStage} for ${formatHours(customer.stuckHours)}.`}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Resolution Steps + Tickets */}
        <div className="space-y-6">
          {/* Resolution Steps */}
          <div className="bg-dark-card rounded-xl border border-dark-border p-6">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Resolution Steps</h3>
            <ol className="space-y-2">
              {resolutionSteps.map((step, i) => (
                <li key={i} className={`flex gap-3 p-2.5 rounded-lg ${i === 0 ? 'bg-accent-blue/10 border border-accent-blue/20' : 'bg-dark-surface/50'}`}>
                  <span className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                    i === 0 ? 'bg-accent-blue text-white' : 'bg-dark-border text-gray-500'
                  }`}>
                    {i + 1}
                  </span>
                  <span className={`text-xs ${i === 0 ? 'text-accent-blue' : 'text-gray-400'}`}>{step}</span>
                </li>
              ))}
            </ol>

            {kbArticles.length > 0 && (
              <div className="mt-4 p-3 bg-dark-surface rounded-lg border border-dark-border">
                <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">KB References</div>
                <div className="space-y-1.5">
                  {kbArticles.map(article => (
                    <a
                      key={article.id}
                      href={`${ZENDESK_HC}/${article.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-xs text-accent-blue hover:text-blue-300 transition"
                    >
                      <span className="text-gray-600">&rarr;</span>
                      {article.title}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Customer Info from Databricks */}
          <div className="bg-dark-card rounded-xl border border-dark-border p-6">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
              Customer Data
            </h3>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between p-2 bg-dark-surface/50 rounded">
                <span className="text-gray-500">Order ID</span>
                <span className="font-mono text-gray-300">{customer.latestOrderId || '—'}</span>
              </div>
              <div className="flex justify-between p-2 bg-dark-surface/50 rounded">
                <span className="text-gray-500">Order Status</span>
                <span className="text-gray-300">{customer.latestOrderStatus || '—'}</span>
              </div>
              <div className="flex justify-between p-2 bg-dark-surface/50 rounded">
                <span className="text-gray-500">MSISDN</span>
                <span className="font-mono text-gray-300">{customer.msisdn || '—'}</span>
              </div>
              <div className="flex justify-between p-2 bg-dark-surface/50 rounded">
                <span className="text-gray-500">IMEI</span>
                <span className="font-mono text-gray-300">{customer.imei || '—'}</span>
              </div>
            </div>
          </div>

          {/* Tickets */}
          <div className="bg-dark-card rounded-xl border border-dark-border p-6">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
              Zendesk Tickets {customer.tickets?.length > 0 ? `(${customer.tickets.length})` : ''}
            </h3>
            {customer.tickets && customer.tickets.length > 0 ? (
              <div className="space-y-2">
                {customer.tickets.map(ticket => (
                  <a
                    key={ticket.id}
                    href={`${ZENDESK_BASE}/agent/tickets/${ticket.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block p-3 rounded-lg bg-dark-surface hover:bg-dark-hover border border-dark-border transition"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-xs text-accent-blue">ZD-{ticket.id}</span>
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                        ticket.status === 'open' ? 'bg-red-900/20 text-red-400' :
                        ticket.status === 'new' ? 'bg-blue-900/20 text-blue-400' :
                        ticket.status === 'pending' ? 'bg-amber-900/20 text-amber-400' :
                        'bg-gray-800/50 text-gray-400'
                      }`}>
                        {ticket.status}
                      </span>
                    </div>
                    <p className="text-xs text-gray-300 truncate">{ticket.subject}</p>
                  </a>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-600 italic mb-3">No linked tickets found</p>
            )}

            {/* Zendesk CTAs */}
            <div className="flex gap-2 mt-4">
              <a
                href={`${ZENDESK_BASE}/agent/search/1?type=ticket&q=${encodeURIComponent(customer.email || customer.name)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-accent-blue/10 text-accent-blue border border-accent-blue/20 hover:bg-accent-blue/20 transition text-xs font-semibold"
              >
                Search Tickets &nearr;
              </a>
              <a
                href={`${ZENDESK_BASE}/agent/tickets/new`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-dark-surface text-gray-400 border border-dark-border hover:text-gray-200 hover:bg-dark-hover transition text-xs font-semibold"
              >
                Create Ticket &nearr;
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const ZENDESK_HC = 'https://rockstarautomations.zendesk.com/hc/en-us/articles';

function buildResolutionSteps(stuckAt, issueTags, customer) {
  const tagSet = new Set(issueTags);

  switch (stuckAt) {
    case 'order_created':
      return [
        'Check Recent Orders & Activities in ConnectX',
        'Verify customer eligibility and device compatibility',
        'Re-trigger order creation if stuck in queue',
        'Contact customer to confirm order details',
      ];
    case 'payment':
      if (tagSet.has('Double Charged')) return [
        'Check Payment Status on ConnectX — verify double debit',
        'Follow SOP: Payment Issues — Double Debit, Payment Status (ConnectX) — Received Both',
        'Initiate refund per Refund Initiation SOP',
        'Notify customer with refund confirmation and timeline',
      ];
      if (tagSet.has('Refund Pending')) return [
        'Review refund eligibility per Refund Initiation SOP',
        'Process refund via ConnectX payment tools',
        'Update ticket with refund status and reference',
        'Send customer confirmation email',
      ];
      return [
        'Check Payment Status on ConnectX',
        'Verify if autopay is enabled and card is valid (Wrong Card Linked / Card Expired SOP)',
        'Follow SOP: Payment Unsuccessful — Autopay Enabled, Funds Available',
        'Check if payment shows successful on customer end but not received on ConnectX',
      ];
    case 'number_selection':
      return [
        'Check port-in status on ConnectX — verify if number transfer is pending',
        'Follow carrier-wise port-in instructions for the losing carrier',
        'Check if numbers that cannot be ported in apply to this case',
        'Confirm number selection or assign new number from available pool',
      ];
    case 'esim_activation':
      if (customer?.esimStatus === 'ERROR') return [
        `eSIM status is ERROR — check eSIM Status & Replacement on ConnectX for order ${customer.latestOrderId || 'N/A'}`,
        'Follow Port-in/eSIM Error Codes and Rejections SOP to identify failure reason',
        'Re-issue QR code per QR Code Re-Issuance SOP or trigger eSIM Replacement',
        'Walk customer through eSIM Installation (iPhone & Android) steps',
      ];
      if (tagSet.has('MNP Stuck') || tagSet.has('MNP Conflict')) return [
        'Check Port-in Status on ConnectX',
        'Follow carrier-wise port-in instructions — verify account number and PIN with losing carrier',
        'Check Port-in/eSIM Error Codes and Rejections for rejection reason',
        'Escalate to ConnectX if blocked >24h per SLA for ConnectX',
      ];
      if (customer?.onboardingStatus === 'IMEI_CHECKING') return [
        'Run IMEI compatibility check — follow eSIM Device Compatibility Check SOP',
        'Check if IMEI is blacklisted per IMEI Blacklisted SOP',
        'Verify device is not carrier-restricted or locked (Carrier-Restricted / Locked Device SOP)',
        'If device incompatible, advise customer on Compatible Device List',
      ];
      return [
        'Check if eSIM is already activated per How to Check if eSIM is Already Activated SOP',
        'Follow eSIM Stuck in "Activating" troubleshooting guide',
        'Re-issue QR code if not received (QR Code Not Received / QR Code Expired SOP)',
        'Walk customer through eSIM Installation on iPhone & Android',
      ];
    case 'nw_enabled':
      return [
        'Follow Calls & Data Not Working troubleshooting SOP',
        'Check Network Outage Checker on Zendesk for area-wide issues',
        'Verify eSIM installed but not activated — follow eSIM Installed, Not Activated SOP',
        'If data fluctuating — follow Data Fluctuating, Calls Working SOP',
      ];
    case 'airvet_account':
      return [
        'Follow Airvet Account Setup & Pet Registration SOP',
        'Check state eligibility — verify States Where Airvet Veterinarians Can Prescribe',
        'If setup fails, follow Airvet Escalation SOP',
        'Send Airvet welcome link and verify account access',
      ];
    default:
      return [
        'Follow general Troubleshooting Guide',
        'Check account status on ConnectX',
        'Follow SOP: Mandatory Incident Data Collection & Escalation (L0 → L1)',
        'Escalate if not resolved within SLA',
      ];
  }
}

function getKbArticles(stuckAt, issueTags, customer) {
  const articles = [];

  switch (stuckAt) {
    case 'order_created':
      articles.push({ title: 'Check Recent Orders & Activities', id: '44600701856155' });
      articles.push({ title: 'Customer Onboarding Workflow', id: '42174785773339' });
      break;
    case 'payment':
      articles.push({ title: 'Check Payment Status - ConnectX', id: '44605895175451' });
      articles.push({ title: 'How to Check Missed Payments', id: '42174101294107' });
      if (issueTags?.includes('Double Charged'))
        articles.push({ title: 'Payment Issues - Double Debit', id: '44457698753051' });
      if (issueTags?.includes('Refund Pending'))
        articles.push({ title: 'Refund Initiation SOP', id: '44457870635419' });
      articles.push({ title: 'Payment Unsuccessful: Autopay', id: '44457693627931' });
      articles.push({ title: 'Wrong Card Linked to Autopay', id: '44457777398811' });
      break;
    case 'number_selection':
      articles.push({ title: 'Port-In Procedure', id: '44557504609947' });
      articles.push({ title: 'Carrier-wise Port-in Instructions', id: '44457968468763' });
      articles.push({ title: 'Numbers That Cannot Be Ported In', id: '44557267053723' });
      articles.push({ title: 'Port-in Status - ConnectX', id: '44601028819739' });
      break;
    case 'esim_activation':
      if (customer?.esimStatus === 'ERROR') {
        articles.push({ title: 'Port-in/eSIM Error Codes and Rejections', id: '44457984778651' });
        articles.push({ title: 'eSIM Status & Replacement - ConnectX', id: '44600946917019' });
        articles.push({ title: 'QR Code Re-Issuance', id: '44455117766299' });
      } else if (issueTags?.includes('MNP Stuck') || issueTags?.includes('MNP Conflict')) {
        articles.push({ title: 'Port-in Status - ConnectX', id: '44601028819739' });
        articles.push({ title: 'Carrier-wise Port-in Instructions', id: '44457968468763' });
        articles.push({ title: 'SLA for ConnectX', id: '46360765653531' });
      } else if (customer?.onboardingStatus === 'IMEI_CHECKING') {
        articles.push({ title: 'eSIM Device Compatibility Check', id: '44455336528667' });
        articles.push({ title: 'IMEI Blacklisted', id: '44454719349787' });
        articles.push({ title: 'Locked Device', id: '44455447219099' });
        articles.push({ title: 'Compatible Device List', id: '45270363486235' });
      } else {
        articles.push({ title: 'How to Check if eSIM is Already Activated', id: '44463392211739' });
        articles.push({ title: 'eSIM Stuck in "Activating"', id: '44455404526747' });
        articles.push({ title: 'QR Code Not Received', id: '44454944958107' });
      }
      articles.push({ title: 'eSIM Installation on iPhone & Android', id: '44455115809691' });
      break;
    case 'nw_enabled':
      articles.push({ title: 'Calls & Data Not Working', id: '44454272223643' });
      articles.push({ title: 'Network Outage Checker - Zendesk', id: '44600050078363' });
      articles.push({ title: 'eSIM Installed, Not Activated', id: '44454558535067' });
      articles.push({ title: 'Network Not Working', id: '44454895449755' });
      break;
    case 'airvet_account':
      articles.push({ title: 'Airvet Account Setup & Pet Registration', id: '44455580058395' });
      articles.push({ title: 'States Where Airvet Can Prescribe', id: '45569798195355' });
      articles.push({ title: 'Airvet Escalation', id: '44455585587483' });
      break;
    default:
      articles.push({ title: 'Troubleshooting Guide', id: '44455761075099' });
      articles.push({ title: 'Mandatory Incident Data Collection & Escalation', id: '46471334875547' });
  }

  return articles;
}
