'use client';

import { useState, useCallback } from 'react';
import { formatHours, formatAge, slaBadge, TAG_COLORS, JOURNEY_STAGES, ZENDESK_BASE } from './shared';
import ProactiveOutreach from './ProactiveOutreach';

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

export default function CustomerDetail({ customer, onBack, onCustomerUpdate }) {
  const [showOutreach, setShowOutreach] = useState(false);
  const sla = slaBadge(customer.slaStatus);
  const stuckOrder = customer.stuckOrder || 1;

  // Check if a proactive outreach ticket was sent in the last 3 days
  const hasRecentOutreach = (customer.tickets || []).some(t => {
    if (!t.tags?.includes('proactive_outreach')) return false;
    const created = new Date(t.created_at);
    const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
    return created.getTime() > threeDaysAgo;
  });
  const hasTickets = customer.tickets && customer.tickets.length > 0;

  const resolutionSteps = buildResolutionSteps(customer.stuckAt, customer.issueTags || [], customer);
  const kbArticles = getKbArticles(customer.stuckAt, customer.issueTags || [], customer);
  const [expandedSteps, setExpandedSteps] = useState({});
  const toggleStep = useCallback((i) => setExpandedSteps(prev => ({ ...prev, [i]: !prev[i] })), []);

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
                <li key={i} className={`rounded-lg ${i === 0 ? 'bg-accent-blue/10 border border-accent-blue/20' : 'bg-dark-surface/50'}`}>
                  <button
                    onClick={() => step.detail && toggleStep(i)}
                    className={`flex items-center gap-3 p-2.5 w-full text-left ${step.detail ? 'cursor-pointer' : 'cursor-default'}`}
                  >
                    <span className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                      i === 0 ? 'bg-accent-blue text-white' : 'bg-dark-border text-gray-500'
                    }`}>
                      {i + 1}
                    </span>
                    <span className={`text-xs flex-1 ${i === 0 ? 'text-accent-blue' : 'text-gray-400'}`}>{step.title}</span>
                    {step.detail && (
                      <span className={`text-[10px] text-gray-600 flex-shrink-0 transition-transform ${expandedSteps[i] ? 'rotate-90' : ''}`}>&#9654;</span>
                    )}
                  </button>
                  {step.detail && expandedSteps[i] && (
                    <div className="px-10 pb-3">
                      <div className="text-[11px] text-gray-500 leading-relaxed whitespace-pre-line border-l-2 border-dark-border pl-3">
                        {step.detail}
                      </div>
                      {step.escalation && (
                        <div className="mt-2 p-2 bg-amber-900/10 border border-amber-800/20 rounded text-[10px] text-amber-400">
                          <span className="font-semibold">Escalate if:</span> {step.escalation}
                        </div>
                      )}
                    </div>
                  )}
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
            {hasTickets ? (
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
                      <div className="flex items-center gap-1.5">
                        {ticket.tags?.includes('proactive_outreach') && (
                          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-green-900/20 text-green-400 border border-green-800/20">
                            Proactive
                          </span>
                        )}
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                          ticket.status === 'open' ? 'bg-red-900/20 text-red-400' :
                          ticket.status === 'new' ? 'bg-blue-900/20 text-blue-400' :
                          ticket.status === 'pending' ? 'bg-amber-900/20 text-amber-400' :
                          'bg-gray-800/50 text-gray-400'
                        }`}>
                          {ticket.status}
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-gray-300 truncate">{ticket.subject}</p>
                  </a>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-600 italic mb-3">No linked tickets found</p>
            )}

            {/* Proactive outreach CTA — show only if no tickets or no recent proactive outreach */}
            {customer.email && !hasRecentOutreach && (
              <div className="mt-3">
                <button
                  onClick={() => setShowOutreach(true)}
                  className="w-full py-2.5 rounded-lg text-xs font-semibold bg-green-900/20 text-green-400 border border-green-800/30 hover:bg-green-900/30 transition flex items-center justify-center gap-2"
                >
                  <span className="text-base">&#9993;</span>
                  Proactive Reach Out
                </button>
              </div>
            )}
            {hasRecentOutreach && (
              <div className="mt-3 text-[10px] text-gray-600 text-center italic">
                Proactive outreach sent recently
              </div>
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

      {/* Proactive Outreach Modal */}
      {showOutreach && (
        <ProactiveOutreach
          customer={customer}
          onClose={() => setShowOutreach(false)}
          onTicketCreated={(ticket) => {
            // Update customer with the new ticket so the UI reflects it immediately
            // Remove Silent Stuck tag since customer now has a ticket
            const updatedTags = (customer.issueTags || []).filter(t => t !== 'Silent Stuck');
            const updated = {
              ...customer,
              tickets: [...(customer.tickets || []), ticket],
              ticketCount: (customer.ticketCount || 0) + 1,
              isSilent: false,
              issueTags: updatedTags,
            };
            if (onCustomerUpdate) onCustomerUpdate(updated);
          }}
        />
      )}
    </div>
  );
}

const ZENDESK_HC = 'https://rockstarautomations.zendesk.com/hc/en-us/articles';

/* ──────────────────────────────────────────────────────
   Resolution Steps — powered by Zendesk KB articles
   Each step: { title, detail?, escalation? }
   ────────────────────────────────────────────────────── */
function buildResolutionSteps(stuckAt, issueTags, customer) {
  const tagSet = new Set(issueTags);

  switch (stuckAt) {
    // ───── ORDER CREATED ─────
    case 'order_created':
      return [
        {
          title: 'Check Recent Orders & Activities in ConnectX',
          detail: '1. Launch ConnectX and search customer by Email, Phone, or Name\n2. Click "Orders" tab to view all recent orders\n3. Click dropdown arrow on the order row to view Live Updates and Notes\n4. Verify order status — check if stuck in queue or processing',
        },
        {
          title: 'Verify customer eligibility and device compatibility',
          detail: '1. Confirm device supports eSIM: customer dials *#06# — look for EID number\n2. iPhone: Settings > General > About > check for EID\n3. Android: Settings > About Phone > Status > check for EID\n4. Verify device is carrier-unlocked (not locked to previous carrier)\n5. If no EID found — device may not support eSIM, advise compatible device',
          escalation: 'Device confirmed incompatible — advise customer to use a different eSIM-compatible device',
        },
        {
          title: 'Re-trigger order creation if stuck in queue',
          detail: '1. In ConnectX, check if order shows "Processing" for >1 hour\n2. Check for similar ongoing outage tickets on Zendesk\n3. If no outage: attempt to re-trigger the order from ConnectX\n4. Document action in ConnectX internal notes with ticket number',
        },
        {
          title: 'Contact customer to confirm order details',
          detail: '1. Verify registered email address is correct\n2. Confirm payment method on file (Apple Pay, Google Pay, Card, or PayPal)\n3. Note: NO KYC required for onboarding\n4. Note: User onboarded on NEW number by default (AT&T limitation — no number selection)\n5. Auto-pay is enabled by default for 30-day subscription renewal',
        },
      ];

    // ───── PAYMENT ─────
    case 'payment':
      if (tagSet.has('Double Charged')) return [
        {
          title: 'Check Payment Status on ConnectX — verify double debit',
          detail: '1. Search customer profile by Email or Phone\n2. Go to "Payments" tab > "Payment History"\n3. Check if two separate debits appear for same amount\n4. Verify both payments received and credited\n5. Document both Transaction IDs and reference numbers',
        },
        {
          title: 'Confirm double debit details with customer',
          detail: '1. Confirm exact amount of double payment\n2. Confirm date and time of both debits\n3. Confirm payment method used (Card/Debit/UPI/Bank Transfer)\n4. Request bank statement screenshot showing two separate debits\n5. Check ConnectX Payments > Payment History for excess credit balance',
        },
        {
          title: 'Escalate to Supervisor for refund processing',
          detail: '1. Set ticket priority to HIGH (financial matter)\n2. Add complete internal notes:\n   - Customer Account Number/ID\n   - Exact refund amount\n   - Date/Time of both payments\n   - Both Transaction ID/Reference numbers\n   - Payment method used\n   - Bank statement proof attached\n3. Assign ticket to Supervisor/Viru\n4. Change ticket status to "On-Hold"',
          escalation: 'All double debits must be escalated to Supervisor/Viru with complete proof',
        },
        {
          title: 'Notify customer with refund confirmation and timeline',
          detail: '1. Inform customer refund has been escalated\n2. Standard refund TAT: 5-7 business days\n3. Refund goes back to same card/method used for payment\n4. Advise customer to monitor bank statements\n5. Advise to contact support if not received after TAT',
        },
      ];

      if (tagSet.has('Refund Pending')) return [
        {
          title: 'Verify refund eligibility per Refund SOP',
          detail: '1. Check complete Zendesk ticket history\n2. Verify NO chargeback already raised\n3. Verify NO previous refund for same transaction\n4. Check ConnectX: payment transaction ID & status\n5. Check eSIM status (Not Installed / Installed / Activated)\n6. Check account creation & activation date',
        },
        {
          title: 'Determine refund scenario',
          detail: 'ALLOWED scenarios:\n- Paid Waitlist Fee & did NOT convert as User\n- Purchased but service never activated\n- Duplicate payment (only duplicate amount)\n- Account <30 days, NO 2nd payment, eSIM NOT installed\n\nNOT ALLOWED:\n- eSIM installed & activated (post-installation refunds not permitted)\n- Account >30 days old\n- Second payment already made',
        },
        {
          title: 'Process refund via ConnectX',
          detail: '1. Search customer profile > Payments tab\n2. Select the payment for refund\n3. Click three dots > "Refund"\n4. Enter refund amount\n5. Mention reason: e.g., "Service not activated" (MANDATORY)\n6. Confirm last 4 digits of card with customer\n7. Click "Refund Customer"\n8. Verify system shows refund status: "Initiated"\n9. If not authorized: Assign to Supervisor/Viru with scenario details',
          escalation: 'If refund requires supervisor approval, assign to Viru with complete internal notes',
        },
        {
          title: 'Send customer confirmation',
          detail: '1. Inform refund successfully initiated\n2. Refund TAT: 5-7 business days\n3. Amount credited to original payment card\n4. Document in ticket: Transaction ID, refund amount, card last 4 digits (masked)\n5. Update ticket status to Solved (if initiated) or On-Hold (if escalated)',
        },
      ];

      return [
        {
          title: 'Check Payment Status on ConnectX',
          detail: '1. Search customer by Email ID or Mobile Number\n2. Go to "Payments" tab\n3. Check transaction status under "Payment History"\n4. Review next billing date in "Next Payment Wallet" section\n5. Check if any payment attempts show "Failed" status',
        },
        {
          title: 'Verify autopay and card details',
          detail: '1. Verify autopay status is ENABLED (mandatory)\n2. Go to Payments > Payment Methods section\n3. Click arrow to check last 4 digits of existing card\n4. Confirm card is not expired or blocked\n5. If wrong card linked:\n   - Click three dots > "Customer Portal Link"\n   - Send payment link via email\n   - Customer updates new card via portal link\n6. IMPORTANT: Advise customer NOT to attempt multiple payments (avoid duplicate debits)',
        },
        {
          title: 'Troubleshoot payment failure',
          detail: '1. Check complete Zendesk ticket history for billing interactions\n2. Confirm date/time of failed payment attempt\n3. Ask if customer received bank/SMS/app alert for the debit\n4. Reconfirm sufficient balance was available at debit time\n5. Ask if new card received with same numbers (bank reissue)\n6. Ensure autopay consent is active and not revoked\n7. If card seems blocked: send "Add another card" link from ConnectX\n   - Payments > Select failed Payment > Click 3 dots > Customer portal link > Send via Email\n8. ETR to customer: 1-2 hours per billing SLA',
          escalation: 'Multiple consecutive failed attempts or possible account block — escalate to L1 with all billing fields filled',
        },
        {
          title: 'Check if payment shows successful on customer end but not in ConnectX',
          detail: '1. Request transaction ID or payment reference from customer\n2. Ask for bank statement screenshot showing debit\n3. Check ConnectX payment history for matching transaction\n4. If payment confirmed but not showing: escalate to Supervisor/Viru for manual lookup\n5. Follow up every 24 hours until resolved',
          escalation: 'Payment confirmed debited by bank but not showing in ConnectX after 48+ hours',
        },
      ];

    // ───── NUMBER SELECTION ─────
    case 'number_selection':
      return [
        {
          title: 'Check port-in status on ConnectX',
          detail: '1. Search customer profile in ConnectX\n2. Check port-in status under SIM/Order details\n3. Verify if number transfer is pending, processing, or rejected\n4. Note any error codes or rejection reasons',
        },
        {
          title: 'Follow carrier-wise port-in instructions for the losing carrier',
          detail: 'Pre-port requirements by carrier:\n\nAT&T: Account Number + Transfer PIN (request via myAT&T or call 611)\nVerizon: Number Lock must be toggled OFF in security settings\nCricket: Disable Account Lock in settings + generate PIN\nT-Mobile: Request Transfer PIN (specific PIN flow)\nUS Mobile / H2O / Consumer Cellular: Must call carrier support directly\nXfinity / Visible: Disable Number Lock in security settings\nGoogle Fi: Must contact Fi support for port-out credentials\nStraight Talk / Spectrum: Verify billing ZIP matches exactly\n\nAll carriers: Verify name, address, and billing ZIP match source carrier records exactly.\nTransfer PINs typically valid 5-7 days — advise customer to initiate port ASAP after generating PIN.',
        },
        {
          title: 'Check if number cannot be ported',
          detail: '1. Verify number is not a landline, VoIP, or prepaid number with restrictions\n2. Check if number is already in a pending port with another carrier\n3. Verify number is not from a business/enterprise account with port restrictions\n4. If number cannot be ported: inform customer and advise they will receive a new AT&T number by default',
          escalation: 'Port-in rejected after all pre-port requirements verified — escalate to L1 with error codes',
        },
        {
          title: 'Confirm number selection or assign new number',
          detail: '1. Note: Users are onboarded on a NEW number by default (AT&T limitation — no number selection)\n2. Port-in is near real-time (2-5 minutes for most customers)\n3. If customer skipped port-in: they already have a new number assigned\n4. Customer can initiate port-in later from the Meow Mobile app\n5. Confirm with customer their preference: keep new number or retry port-in',
        },
      ];

    // ───── eSIM ACTIVATION ─────
    case 'esim_activation':
      if (customer?.esimStatus === 'ERROR') return [
        {
          title: `eSIM status is ERROR — check ConnectX for order ${customer.latestOrderId || 'N/A'}`,
          detail: '1. Open ConnectX > search customer profile\n2. Go to Products tab > SIM details section\n3. Check eSIM status — should show error details\n4. Check if error is L0-resolvable:\n   - ERROR_CARRIER_LOCKED: Device locked by previous carrier → customer must unlock\n   - ERROR_EUICC_INSUFFICIENT_MEMORY: Too many eSIM profiles → delete unused profiles\n   - ERROR_EUICC_MISSING: Device doesn\'t support eSIM or hardware issue\n   - ERROR_INCOMPATIBLE_CARRIER: Update device OS to latest version\n   - ERROR_TIME_OUT: Wait 5-10 min, retry with stable Wi-Fi',
        },
        {
          title: 'Identify error code and follow resolution path',
          detail: 'L0-Resolvable Errors:\n- ERROR_CARRIER_LOCKED → Inform customer device locked, must contact previous carrier to unlock\n- ERROR_EUICC_INSUFFICIENT_MEMORY → Guide to Settings > Cellular > delete unused/old eSIM profiles\n- ERROR_TIME_OUT → Wait 5-10 min, ensure stable Wi-Fi, retry installation\n- ERROR_INCOMPATIBLE_CARRIER → Update device OS, then retry\n\nL1-Escalation Required:\n- EMBEDDED_SUBSCRIPTION_RESULT_ERROR → Missing carrier privilege certificate\n- ERROR_ADDRESS_MISSING → Incorrect eSIM activation string\n- ERROR_DISALLOWED_BY_PPR → Profile policy preventing installation\n- ERROR_NO_PROFILES_AVAILABLE → Profile not available on SMDP+',
          escalation: 'Backend/system errors (EMBEDDED_SUBSCRIPTION, ADDRESS_MISSING, PPR, NO_PROFILES) — escalate to L1 with device model, OS version, IMEI, and error code',
        },
        {
          title: 'Re-issue QR code or trigger eSIM Replacement',
          detail: 'QR Re-Issuance:\n1. Confirm why re-issuance needed (expired, already used, not downloading, device changed)\n2. Verify current eSIM status in ConnectX: QR Issued/Scanned/Activation status\n3. Confirm plan status (Active/Pending/Suspended)\n4. Verify IMEI & ICCID mapping in ConnectX\n\neSIM Replacement (if deleted by mistake):\n1. In ConnectX, click three dots (...) next to SIM details\n2. Select "Replace eSIM"\n3. Select "Continue" (SIM offering selected by default)\n4. Confirm charge (currently free)\n5. New eSIM email arrives in few minutes with new QR code',
        },
        {
          title: 'Walk customer through eSIM Installation',
          detail: 'iPhone:\n1. Settings > Mobile Service > Add eSIM\n2. Scan QR code (must be on separate device or printed)\n3. Tap Continue / Activate Cellular Plan\n4. Follow on-screen prompts\n\nAndroid:\n1. Settings > Connection > SIM Manager\n2. Add eSIM > Scan QR Code\n3. Confirm & Activate\n\nPost-install:\n- Delete any old/duplicate eSIM profiles\n- Set Meow Mobile eSIM as Primary for Data/Voice\n- Update Carrier Settings (iOS: Settings > General > About — wait for popup)',
        },
      ];

      if (tagSet.has('MNP Stuck') || tagSet.has('MNP Conflict')) return [
        {
          title: 'Check Port-in Status on ConnectX',
          detail: '1. Search customer profile in ConnectX\n2. Check port-in status — look for CONFLICT, REVIEWING, or REJECTED state\n3. Note the exact error message or rejection reason\n4. Check if port-in has been pending for >4 hours (usually completes in 2-5 min)',
        },
        {
          title: 'Verify port-in credentials with losing carrier',
          detail: '1. Confirm Account Number matches source carrier exactly\n2. Confirm Transfer PIN is still valid (typically expires in 5-7 days)\n3. Confirm customer name and billing ZIP match source carrier records\n4. Common rejection causes:\n   - PIN mismatch or expired\n   - Name/address mismatch\n   - Inactive donor account\n   - Account/Number Lock still enabled\n5. If PIN expired: customer must request new PIN from source carrier\n6. If name mismatch: customer must verify registered info with source carrier',
        },
        {
          title: 'Check Error Codes for rejection reason',
          detail: '1. Review port-in/eSIM error codes in ConnectX\n2. Document specific error code\n3. If L0-resolvable (credential issues): guide customer to fix with source carrier\n4. If system error: prepare for L1 escalation with all mandatory port-in fields:\n   - ICCID, IMEI, Customer Full Name (as per source carrier)\n   - Source carrier Account Number\n   - Source carrier Account Address (exact)\n   - SSN (last 4 digits — use secure fields only)\n   - Port-Out PIN/Password',
          escalation: 'Port-in blocked >24h after credentials verified — escalate to L1/ConnectX per SLA',
        },
        {
          title: 'Escalate if blocked >24h per ConnectX SLA',
          detail: '1. Ensure all mandatory port-in fields collected\n2. Set ticket priority based on stuck duration\n3. Add detailed internal notes with timeline\n4. Security: NEVER paste SSN/PIN in comments or screenshots — use secure fields only\n5. Assign to L1 queue (not particular agent)\n6. Change ticket status to "On-Hold"\n7. Inform customer of escalation and expected resolution timeline',
        },
      ];

      if (customer?.onboardingStatus === 'IMEI_CHECKING') return [
        {
          title: 'Run IMEI compatibility check',
          detail: '1. Ask customer for exact device name and model number\n2. Check eSIM Device Compatibility Database (sheet in KB)\n3. Confirm two criteria:\n   a. Model is listed as eSIM compatible\n   b. Device is unlocked (or locked to Meow/AT&T)\n\nCustomer self-check:\n- iPhone: Settings > General > About > look for "EID" number\n- Android: Dial *#06# > look for "EID" number\n- If EID present → device is eSIM-compatible\n- If EID missing or "Unavailable" → device may not support eSIM',
        },
        {
          title: 'Check if IMEI is blacklisted',
          detail: '1. In ConnectX: Go to Residential Store\n2. Click "Select" in Swap IMEI Offer\n3. Enter IMEI number\n4. System shows status — "Unqualified" with reason if blacklisted\n5. If blacklisted: inform customer device reported as lost/stolen/fraud/blocked\n6. Customer must use a different device that is not locked or blacklisted\n7. Script: "Your device IMEI is blacklisted. This usually means the device has been reported as lost, stolen, or involved in fraud. Mobile services cannot be activated on this device."',
          escalation: 'Existing Meow customer with blacklisted IMEI — escalate to L1 with IMEI, contact, email, and error details',
        },
        {
          title: 'Verify device is not carrier-locked',
          detail: '1. Ask directly: "Is your device locked to your previous carrier, or has unlock been completed?"\n2. Test: Try inserting a SIM from a different carrier\n3. If locked: DO NOT proceed with eSIM provisioning\n4. Customer must contact previous carrier to request unlock\n5. Common lock indicators:\n   - "SIM Not Supported"\n   - "Carrier Lock"\n   - "Cannot Add Data Plan (Carrier Restriction)"\n6. DO NOT escalate locked device issues to L1 — issue is external\n7. Inform customer to contact us ONLY after carrier confirms unlock',
        },
        {
          title: 'If device incompatible, advise customer',
          detail: '1. If device does not support eSIM: politely inform and suggest compatible device\n2. Refer to Compatible Device List article for supported models\n3. If device is locked: advise unlock process with previous carrier (varies by carrier)\n4. Note: Provisioning will ALWAYS fail until carrier unlocks device\n5. Document date/time customer was informed about device incompatibility',
        },
      ];

      return [
        {
          title: 'Check if eSIM is already activated',
          detail: '1. Go to ConnectX > Customer360\n2. Search by email or phone number\n3. Check Account Status and eSIM status\n4. If "Activated": confirm with customer service is working\n5. If "Activation Pending": proceed to troubleshooting\n\nAsk customer:\n- "Have you received your eSIM activation email?"\n- "Did you already scan the QR code?"\n- "Are you seeing any error message during setup?"',
        },
        {
          title: 'Troubleshoot eSIM stuck in "Activating"',
          detail: '1. Confirm duration stuck in "Activating"\n2. Confirm stable Wi-Fi connection\n3. Confirm device is carrier-unlocked\n4. Verify IMEI & EID match ConnectX:\n   - iOS: Settings > General > About\n   - Android: Settings > About Phone > Status\n   - Read back last 4 digits and match\n5. Delete OLD or DUPLICATE eSIM profiles from SIM manager\n6. Set Meow Mobile eSIM as Primary for Data/Voice\n7. Update Carrier Settings:\n   - iOS: Settings > General > About — wait 15-30 sec for popup, tap Update\n   - Android: Settings > Network > Carrier settings version\n8. Reset Network Settings (WARNING: forgets Wi-Fi passwords):\n   - iOS: Settings > General > Transfer or Reset > Reset > Reset Network Settings\n   - Android: Settings > System > Reset Options > Reset Wi-Fi, mobile & Bluetooth\n9. If still stuck: re-provision eSIM from ConnectX',
          escalation: 'Persists after IMEI/EID verified + network reset + re-provision — escalate to L1 as HIGH priority with device model, OS, screenshots',
        },
        {
          title: 'Re-issue QR code if not received',
          detail: '1. Check if activation email was sent — customer should check Inbox, Spam, Promotions\n2. Confirm email address on file is correct\n3. If not received: resend via ConnectX > Actions > Resend Activation Email\n4. If QR expired: re-issue new QR code from ConnectX\n5. Confirm reason for re-issuance: expired, already used, not downloading, device changed\n6. Verify IMEI & ICCID mapping in ConnectX before re-issuing',
        },
        {
          title: 'Walk customer through eSIM Installation',
          detail: 'iPhone:\n1. Settings > Mobile Service > Add eSIM\n2. Scan QR code (must be on separate screen/device/printed)\n3. Tap Continue / Activate Cellular Plan\n4. Follow on-screen prompts\n\nAndroid:\n1. Settings > Connection > SIM Manager\n2. Add eSIM > Scan QR Code\n3. Confirm & Activate\n\nPost-install verification:\n- Ensure eSIM profile is Enabled and set as Primary\n- Check APN settings: should be "ereseller"\n- Delete any unused/old SIM profiles\n- Restart device if service not appearing immediately',
        },
      ];

    // ───── NW ENABLED ─────
    case 'nw_enabled':
      return [
        {
          title: 'Check Network Outage first (MANDATORY)',
          detail: '1. Go to Zendesk Apps Panel > Network Outage Checker\n2. Enter customer\'s ZIP code to check for live outages\n3. This is MANDATORY for EVERY network ticket before troubleshooting\n4. If outage exists:\n   - Inform customer of the outage\n   - DO NOT escalate unnecessarily\n   - Share expected restoration timeline if available\n5. Check for similar ongoing tickets on Zendesk',
        },
        {
          title: 'Troubleshoot Calls & Data Not Working',
          detail: 'Probing (collect all before troubleshooting):\n- Signal bars visible? When did issue start?\n- Data/Calls/SMS — which is affected?\n- Continuous or intermittent? Specific location?\n- Take alternate contact number\n\nL0 Troubleshooting sequence:\n1. Confirm eSIM status is "Active" on ConnectX\n2. Confirm account is NOT suspended\n3. Toggle Airplane Mode ON/OFF\n4. Set Meow Mobile eSIM as primary SIM slot\n5. Check APN settings — must be "ereseller":\n   - iOS: Settings > Mobile Data > Mobile Data Options > Mobile Data Network\n   - Android: Settings > Connections > Mobile Networks > Access Point Names\n6. Switch between 5G/4G manually and re-test\n7. Reset Network Settings:\n   - iOS: Settings > General > Transfer or Reset > Reset > Reset Network Settings\n   - Android: Settings > System > Reset > Reset Network Settings\n8. Test: outgoing call + incoming call + mobile data\n9. Restart device',
          escalation: 'Issue persists after all L0 steps — escalate to L1 with device model, OS, location (lat/long — ZIP alone NOT accepted), time of issue, APN screenshot',
        },
        {
          title: 'Check if eSIM installed but not activated',
          detail: '1. Verify in ConnectX: Products Tab > SIM details > activation status\n2. If eSIM installed but not active:\n   - Toggle Airplane Mode\n   - Restart device\n   - Ensure eSIM profile is Enabled and selected for usage\n   - Check APN settings ("ereseller")\n   - Delete and reinstall eSIM profile if needed (send new QR via ConnectX)\n3. If still not activating: ETR 0-1 hour, escalate to L1 if unresolved',
        },
        {
          title: 'If data fluctuating — check usage and network',
          detail: '1. Check data usage threshold in ConnectX — if >50GB, may be throttled (Fair Usage Policy)\n2. Check plan validity and billing status\n3. Verify APN settings are correct ("ereseller")\n4. Switch between 5G/4G manually and re-test\n5. Reset Network Settings\n6. Ask customer to perform Speed Test\n7. If data partially connects: check for VPN or device management profile blocking\n8. ETR: 0-1 hour if needs backend verification',
          escalation: 'Data consistently poor after all L0 steps and no outage — escalate with speed test results, signal strength, and location lat/long',
        },
      ];

    // ───── AIRVET ACCOUNT ─────
    case 'airvet_account':
      return [
        {
          title: 'Guide through Airvet Account Setup',
          detail: 'Step 1 — Download & Activate:\n1. Download Airvet app from App Store (iOS) or Play Store (Android)\n2. Do NOT create account directly in Airvet — must go through Meow Mobile app\n3. Open Meow Mobile App > "Benefits" or "Plan Details" tab\n4. Tap "Activate Airvet" or "Launch Airvet" button\n5. Device redirects to Airvet with free subscription auto-applied\n\nStep 2 — Owner Profile:\n1. Tap "Sign Up"\n2. Enter: Full Name, Email, Password (min 8 chars)\n3. Allow Notifications when prompted (essential for vet callbacks)\n\nStep 3 — Pet Profile:\n1. Tap "Add Pet" or "+" icon\n2. Enter: Name, Species (Dog/Cat/Other), Breed, Gender\n3. Enter: Age/DOB, Weight, Spayed/Neutered\n4. Optional: Upload photo, list medications, known conditions\n\nStep 4 — Primary Vet:\n1. Search for customer\'s regular vet clinic\n2. Toggle "Share records with my vet" to ON\n\nStep 5 — Verify:\n- Dashboard should show "Active" or "Sponsored by Meow Mobile"\n- "Talk to a Vet" button should be blue/active (not greyed out)\n- No payment banner should appear',
        },
        {
          title: 'Check state eligibility for prescriptions',
          detail: 'Airvet prescriptions available ONLY in these states:\nAlabama, Arizona, California, Florida, Indiana, Louisiana, Maine, Massachusetts, Mississippi, Missouri, New Jersey, New York, Ohio, Pennsylvania, Rhode Island, South Carolina, Texas, Vermont, Virginia\n\nImportant notes:\n- Prescription is NEVER guaranteed, even in eligible states\n- Veterinarian determines if prescribing is legally allowed AND medically appropriate\n- Some conditions may still require in-person vet care\n- If customer is in non-eligible state: refer to their primary vet for prescriptions',
        },
        {
          title: 'If setup fails, escalate to Airvet',
          detail: 'Redirect to Airvet support for:\n- Account/login issues\n- Medical/consultation quality issues\n- App-specific bugs within Airvet\n- Prescription disputes\n\nEscalation email: support@airvet.com\n\nInclude in email:\n- Customer name, phone, email\n- Pet name\n- Meow Mobile Ticket ID\n- Issue summary + how long it\'s been happening\n- Pet condition: Stable / Improving / Worsening\n- Previous actions taken and outcome\n- Relevant attachments (records, photos, invoices)',
          escalation: 'All Airvet account/medical/billing issues beyond basic setup — redirect to support@airvet.com',
        },
        {
          title: 'Send Airvet welcome link and verify access',
          detail: '1. Ensure Airvet activation was triggered from Meow Mobile app (not directly)\n2. If customer can\'t find "Activate Airvet" in Meow app:\n   - Verify their subscription is active in ConnectX\n   - Check if Airvet benefit is provisioned for their plan\n3. Verify "Talk to a Vet" button is active and visible on Airvet home screen\n4. If button is greyed out or payment banner appears: account may not be linked correctly\n5. Try: uninstall Airvet > restart > reinstall > re-activate from Meow app',
        },
      ];

    // ───── COMPLETED (Post-Onboarding) ─────
    case 'completed':
      if (issueTags?.includes('Call Drops')) {
        return [
          {
            title: 'Probe & empathize — gather call drop details',
            detail: '1. Ask when call drops started (date/time with timezone)\n2. How often? Every call, or intermittent?\n3. Specific locations where drops occur (home, commute, office)?\n4. Does it happen on incoming, outgoing, or both?\n5. Is there a pattern (time of day, after X minutes)?\n6. Did calls work fine before at the same location?\n7. Any recent device updates, SIM changes, or travel?',
          },
          {
            title: 'Check tools — outage, barring, similar tickets',
            detail: '1. Check Network Outage Checker in Zendesk for known issues in customer area\n2. Verify telco account status in ConnectX — no barring, suspension, or billing hold\n3. Check MSISDN status: Active, not in grace period\n4. Search Zendesk for similar recent tickets from same area (cell tower issue?)\n5. Check if customer has VoLTE enabled (required for call quality)',
          },
          {
            title: 'L0 troubleshooting — VoLTE, network, device',
            detail: '1. Confirm VoLTE is enabled: Settings > Cellular > Cellular Data Options > Voice & Data > LTE/VoLTE ON\n2. Toggle Airplane Mode ON for 30 seconds, then OFF\n3. Switch network mode: Settings > Cellular > Network Selection > toggle off Auto, select carrier manually, then back to Auto\n4. Reset Network Settings (warn: saves Wi-Fi passwords will be lost)\n5. Check if eSIM is set as primary line for voice\n6. Toggle between 4G/5G and test calls\n7. Test with Wi-Fi Calling enabled vs disabled\n8. If dual-SIM: disable other SIM temporarily and test\n9. Ask customer to perform test call and note signal bars during drop',
          },
          {
            title: 'L1 escalation — collect mandatory incident data',
            detail: 'Mandatory fields (L1 will REJECT without these):\n- Device Make & Model (e.g., iPhone 15 Pro Max)\n- OS Version (e.g., iOS 17.4.1)\n- ICCID / IMEI / EID\n- Location where drops occur: Full Address + Lat/Long (ZIP alone NOT accepted)\n- Signal bars at drop location (0-5)\n- Timestamps of last 3 dropped calls (date + time + timezone)\n- Screenshot of signal strength / Field Test mode\n- VoLTE status: enabled or disabled\n- Did customer try all L0 steps? (Yes — list which ones)\n\nEscalation steps:\n1. Add all above to internal note\n2. Set priority based on frequency (every call = urgent, intermittent = high)\n3. Tag: issue____network, call_drops\n4. Assign to L1 Network queue\n5. Set ticket to On-Hold\n6. Inform customer: ETR 24-48h for network investigation',
            escalation: 'Escalate after all L0 steps exhausted. Mandatory: device model, OS, location with lat/long, signal screenshots, timestamps of dropped calls',
          },
        ];
      }
      // Generic post-onboarding (Suspended, Cancelled, etc.)
      return [
        {
          title: 'Review post-onboarding account status',
          detail: '1. Check telco account status in ConnectX (Active/Suspended/Cancelled)\n2. If Suspended: check reason (payment failure, fraud, customer request)\n3. If Cancelled: verify cancellation date and reason\n4. Review billing status and last successful payment\n5. Check for any pending port-out requests',
        },
        {
          title: 'Follow Device Troubleshooting Guide (12 steps)',
          detail: '1. Check IMEI/EID\n2. Restart device\n3. Toggle Airplane Mode ON/OFF\n4. Reset Network Settings\n5. Check APN settings ("ereseller")\n6. Manual Network Selection\n7. Toggle 4G/5G\n8. Manual eSIM Setup (if needed)\n9. Toggle eSIM On/Off\n10. Set eSIM as Primary\n11. Delete old/unused SIM profiles\n12. Check Roaming Status',
        },
        {
          title: 'Collect mandatory incident data for escalation',
          detail: 'Non-negotiable fields for L1 escalation:\n- ICCID, IMEI, SIM Type (Physical/eSIM)\n- Device Make & Model, OS Version\n- Issue Start Date & Time (with timezone)\n- Ongoing or Intermittent\n- Location: Full Address + Latitude & Longitude (ZIP alone NOT accepted)\n- Signal Bars (0-5)\n- Worked Before at Same Location? (Yes/No)\n- Exact Error Message (copy-paste only, never paraphrase)\n\nL1/L2 will REJECT tickets if:\n- Mandatory fields missing\n- Error messages paraphrased\n- No timestamps or IDs provided',
          escalation: 'Escalate only after ALL mandatory fields collected and all L0 troubleshooting performed',
        },
      ];

    // ───── DEFAULT ─────
    default:
      return [
        {
          title: 'Review account status on ConnectX',
          detail: '1. Search customer in ConnectX by email or phone\n2. Check account status (Active/Locked/Suspended)\n3. Check last login attempt and linked email type\n4. Review recent orders, payments, and eSIM status\n5. Check for any open/recent tickets in Zendesk',
        },
        {
          title: 'Follow Device Troubleshooting Guide (12 steps)',
          detail: '1. Check IMEI/EID\n2. Restart device\n3. Toggle Airplane Mode ON/OFF\n4. Reset Network Settings\n5. Check APN settings ("ereseller")\n6. Manual Network Selection\n7. Toggle 4G/5G\n8. Manual eSIM Setup (if needed)\n9. Toggle eSIM On/Off\n10. Set eSIM as Primary\n11. Delete old/unused SIM profiles\n12. Check Roaming Status',
        },
        {
          title: 'Collect mandatory incident data for escalation',
          detail: 'Non-negotiable fields for L1 escalation:\n- ICCID, IMEI, SIM Type (Physical/eSIM)\n- Device Make & Model, OS Version\n- Issue Start Date & Time (with timezone)\n- Ongoing or Intermittent\n- Location: Full Address + Latitude & Longitude (ZIP alone NOT accepted)\n- Signal Bars (0-5)\n- Worked Before at Same Location? (Yes/No)\n- Exact Error Message (copy-paste only, never paraphrase)\n\nL1/L2 will REJECT tickets if:\n- Mandatory fields missing\n- Error messages paraphrased\n- No timestamps or IDs provided',
          escalation: 'Escalate only after ALL mandatory fields collected and all L0 troubleshooting performed',
        },
        {
          title: 'Escalate if not resolved within SLA',
          detail: '1. Set correct Ticket Priority based on impact\n2. Apply correct Primary & Secondary tags\n3. Add complete internal notes with timeline of actions\n4. Attach all screenshots, test results, and customer confirmations\n5. Change ticket status to "On-Hold"\n6. Assign to L1 queue (not a particular agent)\n7. Inform customer of escalation and expected resolution timeline',
        },
      ];
  }
}

function getKbArticles(stuckAt, issueTags, customer) {
  const articles = [];

  switch (stuckAt) {
    case 'order_created':
      articles.push({ title: 'Check Recent Orders & Activities', id: '44600701856155' });
      articles.push({ title: 'Customer Onboarding Workflow', id: '42174785773339' });
      articles.push({ title: 'eSIM Device Compatibility Check', id: '44455336528667' });
      break;
    case 'payment':
      articles.push({ title: 'Check Payment Status - ConnectX', id: '44605895175451' });
      articles.push({ title: 'How to Check Missed Payments', id: '42174101294107' });
      if (issueTags?.includes('Double Charged'))
        articles.push({ title: 'Payment Issues - Double Debit', id: '44457698753051' });
      if (issueTags?.includes('Refund Pending'))
        articles.push({ title: 'Refund Initiation SOP', id: '44457870635419' });
      articles.push({ title: 'Payment Unsuccessful: Autopay Enabled', id: '44457693627931' });
      articles.push({ title: 'Wrong Card Linked to Autopay', id: '44457777398811' });
      articles.push({ title: 'Number Suspension (payment failure)', id: '43019888509851' });
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
        articles.push({ title: 'eSIM Replacement', id: '43019589278875' });
      } else if (issueTags?.includes('MNP Stuck') || issueTags?.includes('MNP Conflict')) {
        articles.push({ title: 'Port-in Status - ConnectX', id: '44601028819739' });
        articles.push({ title: 'Carrier-wise Port-in Instructions', id: '44457968468763' });
        articles.push({ title: 'Port-in/eSIM Error Codes', id: '44457984778651' });
        articles.push({ title: 'SLA for ConnectX', id: '46360765653531' });
      } else if (customer?.onboardingStatus === 'IMEI_CHECKING') {
        articles.push({ title: 'eSIM Device Compatibility Check', id: '44455336528667' });
        articles.push({ title: 'IMEI Blacklisted', id: '44454719349787' });
        articles.push({ title: 'Locked Device', id: '44455447219099' });
        articles.push({ title: 'IMEI Blacklisted Check - ConnectX', id: '46469428612763' });
        articles.push({ title: 'Compatible Device List', id: '45270363486235' });
      } else {
        articles.push({ title: 'How to Check if eSIM is Already Activated', id: '44463392211739' });
        articles.push({ title: 'eSIM Stuck in "Activating"', id: '44455404526747' });
        articles.push({ title: 'QR Code Not Received', id: '44454944958107' });
        articles.push({ title: 'QR Code Re-Issuance', id: '44455117766299' });
      }
      articles.push({ title: 'eSIM Installation on iPhone & Android', id: '44455115809691' });
      break;
    case 'nw_enabled':
      articles.push({ title: 'Network Outage Checker - Zendesk', id: '44600050078363' });
      articles.push({ title: 'Calls & Data Not Working', id: '44454272223643' });
      articles.push({ title: 'eSIM Installed, Not Activated', id: '44454558535067' });
      articles.push({ title: 'Data Fluctuating, Calls Working', id: '44454513061531' });
      articles.push({ title: 'Device Troubleshooting Guide', id: '44455761075099' });
      articles.push({ title: 'Service Resumed from Suspension - Not Working', id: '44455726855067' });
      articles.push({ title: 'Network Not Working, eSIM Inactive', id: '44454895449755' });
      break;
    case 'airvet_account':
      articles.push({ title: 'Airvet Account Setup & Pet Registration', id: '44455580058395' });
      articles.push({ title: 'States Where Airvet Can Prescribe', id: '45569798195355' });
      articles.push({ title: 'Airvet Escalation', id: '44455585587483' });
      break;
    case 'completed':
      if (issueTags?.includes('Call Drops')) {
        articles.push({ title: 'Calls Keep Dropping', id: '44454839305883' });
        articles.push({ title: 'Network Outage Checker', id: '44600050078363' });
        articles.push({ title: 'Device Troubleshooting Guide', id: '44455761075099' });
        articles.push({ title: 'Mandatory Incident Data & Escalation', id: '46471334875547' });
      } else {
        articles.push({ title: 'Device Troubleshooting Guide (12 Steps)', id: '44455761075099' });
        articles.push({ title: 'Mandatory Incident Data Collection & Escalation', id: '46471334875547' });
        articles.push({ title: 'Number Suspension (payment failure)', id: '43019888509851' });
      }
      break;
    default:
      articles.push({ title: 'Device Troubleshooting Guide (12 Steps)', id: '44455761075099' });
      articles.push({ title: 'Mandatory Incident Data Collection & Escalation', id: '46471334875547' });
      articles.push({ title: 'Customer Account Access', id: '42223257266203' });
      articles.push({ title: 'App Crash Troubleshooting', id: '44455595851675' });
  }

  return articles;
}
