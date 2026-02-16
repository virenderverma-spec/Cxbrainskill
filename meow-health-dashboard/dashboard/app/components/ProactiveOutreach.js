'use client';

import { useState } from 'react';
import { ZENDESK_BASE } from './shared';

// Client-side message preview (mirrors the API route templates)
function buildPreviewSubject(stuckAt, name) {
  const firstName = (name || 'there').split(' ')[0];
  const subjects = {
    order_created: `${firstName}, we noticed your Meow Mobile order needs attention`,
    payment: `${firstName}, let's get your Meow Mobile payment sorted`,
    number_selection: `${firstName}, your number transfer is in progress`,
    esim_activation: `${firstName}, we're working on your eSIM activation`,
    nw_enabled: `${firstName}, let's get your network up and running`,
    airvet_account: `${firstName}, one last step — setting up your Airvet account`,
  };
  return subjects[stuckAt] || `${firstName}, an update on your Meow Mobile setup`;
}

function buildPreviewMessage(customer) {
  const firstName = (customer.name || 'there').split(' ')[0];
  const stuckHours = Math.round(customer.stuckHours || 0);
  const stuckDays = Math.floor(stuckHours / 24);
  const durationText = stuckDays > 0 ? `${stuckDays} day${stuckDays > 1 ? 's' : ''}` : `${stuckHours} hours`;

  const templates = {
    order_created: {
      issue: `We noticed your order was created ${durationText} ago but hasn't moved to the next step yet.`,
      doing: `Our team is reviewing your order to make sure everything is in order. We want to ensure there are no blockers preventing your setup from moving forward.`,
      action: `You don't need to do anything right now. If you'd like to continue your setup, you can open the Meow Mobile app and pick up where you left off. If you're having trouble, just reply to this email and we'll help you out.`,
    },
    payment: {
      issue: `We see that your payment step hasn't completed yet — it's been about ${durationText} since you started your setup.`,
      doing: `We're checking to make sure there are no issues on our end with the payment process. Sometimes a card update or a simple retry is all that's needed.`,
      action: `If your payment didn't go through, you can try again in the Meow Mobile app. Make sure your card details are up to date. If you're seeing any errors, reply to this email and we'll sort it out for you.`,
    },
    number_selection: {
      issue: `Your number selection or port-in request has been pending for about ${durationText}.`,
      doing: `Number transfers can sometimes take a bit of time depending on your previous carrier. We're monitoring the status and will let you know as soon as it's complete.`,
      action: `If you haven't started a number transfer and just need a new number, you can select one in the Meow Mobile app. Otherwise, sit tight — we're on it.`,
    },
    esim_activation: {
      issue: customer.esimStatus === 'ERROR'
        ? `We detected an issue with your eSIM activation — it looks like there was an error during the setup process.`
        : `Your eSIM activation has been in progress for about ${durationText}.`,
      doing: customer.esimStatus === 'ERROR'
        ? `Our technical team has been notified and is working on resolving this. We may need to re-issue your eSIM QR code.`
        : `We're checking the activation status to make sure everything is proceeding as expected.`,
      action: customer.esimStatus === 'ERROR'
        ? `You don't need to do anything yet. We'll send you a new QR code if needed, along with step-by-step instructions to install it. If you'd like to get this resolved faster, reply to this email.`
        : `If you received a QR code but haven't installed it yet, open your phone's Settings > Cellular > Add eSIM and scan the QR code. If you need help, reply to this email.`,
    },
    nw_enabled: {
      issue: `It looks like your eSIM is installed but your network connection isn't fully active yet.`,
      doing: `We're investigating why the network hasn't come online. This could be a provisioning delay or a settings issue that we can fix quickly.`,
      action: `Try restarting your phone and make sure your Meow Mobile eSIM is set as the primary line. If calls and data still aren't working, reply here and we'll troubleshoot with you.`,
    },
    airvet_account: {
      issue: `You're almost there! Your Meow Mobile service is active, but your Airvet pet care account hasn't been set up yet.`,
      doing: `We're checking the Airvet integration to make sure your account can be created. This is the final step to unlock your free vet care benefit.`,
      action: `Open the Meow Mobile app and follow the prompts to register your pet with Airvet. If you're having trouble or the option isn't showing up, reply to this email and we'll get it sorted.`,
    },
  };

  const t = templates[customer.stuckAt] || {
    issue: `We noticed your Meow Mobile setup hasn't completed yet — it's been about ${durationText}.`,
    doing: `Our team is reviewing your account to identify any blockers and get things moving.`,
    action: `Open the Meow Mobile app to continue your setup, or reply to this email if you need any help.`,
  };

  return `Hi ${firstName},\n\n${t.issue}\n\nWhat we're doing:\n${t.doing}\n\nWhat you can do:\n${t.action}\n\nWe're committed to making your Meow Mobile experience great. If you have any questions at all, just reply to this email and a member of our team will be happy to help.\n\nWarm regards,\nMeow Mobile Support Team`;
}

export default function ProactiveOutreach({ customer, onClose, onTicketCreated }) {
  const [testMode, setTestMode] = useState(true);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [subject, setSubject] = useState(() => buildPreviewSubject(customer.stuckAt, customer.name));
  const [message, setMessage] = useState(() => buildPreviewMessage(customer));
  const [editing, setEditing] = useState(false);

  const handleSend = async () => {
    setSending(true);
    setError(null);
    try {
      const res = await fetch('/api/proactive-outreach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer, testMode, subject, message }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create ticket');
      setResult(data);
      // Notify parent with the new ticket so the UI updates immediately
      if (onTicketCreated) {
        onTicketCreated({
          id: data.ticketId,
          subject: subject,
          status: 'open',
          priority: 'normal',
          created_at: new Date().toISOString(),
          tags: ['proactive_outreach', `stuck_${customer.stuckAt || 'unknown'}`],
        });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  const handleReset = () => {
    setSubject(buildPreviewSubject(customer.stuckAt, customer.name));
    setMessage(buildPreviewMessage(customer));
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-dark-card border border-dark-border rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-dark-border">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white">Proactive Reach Out</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Create a Zendesk ticket and email the customer about their issue
              </p>
            </div>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg">&times;</button>
          </div>

          {/* Test mode toggle */}
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={() => setTestMode(!testMode)}
              className={`relative w-10 h-5 rounded-full transition-colors ${testMode ? 'bg-amber-600' : 'bg-green-600'}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${testMode ? 'left-0.5' : 'left-[22px]'}`} />
            </button>
            <span className={`text-xs font-medium ${testMode ? 'text-amber-400' : 'text-green-400'}`}>
              {testMode ? 'TEST MODE — email goes to you, not the customer' : 'LIVE MODE — email goes to the customer'}
            </span>
          </div>
        </div>

        {/* Result state */}
        {result ? (
          <div className="p-5">
            <div className="bg-green-900/20 border border-green-800/30 rounded-lg p-4 mb-4">
              <div className="text-sm font-bold text-green-400 mb-1">Ticket Created Successfully</div>
              <div className="text-xs text-gray-400 space-y-1">
                <p>Ticket ID: <span className="font-mono text-green-300">ZD-{result.ticketId}</span></p>
                <p>Sent to: <span className="text-gray-300">{result.requesterEmail}</span></p>
                {result.testMode && (
                  <p className="text-amber-400">Test mode — email was sent to your internal address, not the customer.</p>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <a
                href={result.ticketUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 py-2.5 rounded-lg text-xs font-semibold bg-accent-blue/10 text-accent-blue border border-accent-blue/20 hover:bg-accent-blue/20 transition text-center"
              >
                View Ticket in Zendesk &nearr;
              </a>
              <button
                onClick={onClose}
                className="flex-1 py-2.5 rounded-lg text-xs font-semibold bg-dark-surface text-gray-400 border border-dark-border hover:text-gray-200 transition"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Email editor */}
            <div className="p-5 space-y-4">
              {/* To */}
              <div className="flex items-center gap-2 text-xs">
                <span className="text-gray-500 w-12">To:</span>
                <span className={`font-mono ${testMode ? 'text-amber-400' : 'text-gray-300'}`}>
                  {testMode ? '(your internal email)' : customer.email}
                </span>
              </div>

              {/* Subject — editable */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-gray-500 uppercase tracking-wider">Subject</span>
                  {editing && (
                    <button onClick={handleReset} className="text-[10px] text-gray-600 hover:text-gray-400 transition">
                      Reset to default
                    </button>
                  )}
                </div>
                {editing ? (
                  <input
                    type="text"
                    value={subject}
                    onChange={e => setSubject(e.target.value)}
                    className="w-full px-3 py-2 bg-dark-surface border border-dark-border rounded-lg text-xs text-gray-200 focus:outline-none focus:border-accent-blue/40"
                  />
                ) : (
                  <div className="text-xs text-gray-300">{subject}</div>
                )}
              </div>

              {/* Message body — editable */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-gray-500 uppercase tracking-wider">Message</span>
                  <button
                    onClick={() => setEditing(!editing)}
                    className={`text-[10px] font-medium transition ${editing ? 'text-accent-blue' : 'text-gray-500 hover:text-gray-300'}`}
                  >
                    {editing ? 'Done editing' : 'Edit'}
                  </button>
                </div>
                {editing ? (
                  <textarea
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    rows={16}
                    className="w-full px-3 py-3 bg-dark-surface border border-dark-border rounded-lg text-xs text-gray-200 font-sans leading-relaxed focus:outline-none focus:border-accent-blue/40 resize-y"
                  />
                ) : (
                  <div className="bg-dark-surface rounded-lg border border-dark-border p-4 cursor-pointer hover:border-gray-600 transition" onClick={() => setEditing(true)}>
                    <pre className="text-xs text-gray-300 whitespace-pre-wrap font-sans leading-relaxed">
                      {message}
                    </pre>
                  </div>
                )}
              </div>

              {/* Tags */}
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span>Tags:</span>
                <span className="px-2 py-0.5 rounded bg-dark-surface text-gray-400 font-mono text-[10px]">proactive_outreach</span>
                <span className="px-2 py-0.5 rounded bg-dark-surface text-gray-400 font-mono text-[10px]">stuck_{customer.stuckAt || 'unknown'}</span>
              </div>

              {error && (
                <div className="bg-red-900/20 border border-red-800/30 rounded-lg p-3 text-xs text-red-400">
                  Error: {error}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="p-5 border-t border-dark-border flex gap-2">
              <button
                onClick={handleSend}
                disabled={sending}
                className={`flex-1 py-2.5 rounded-lg text-xs font-semibold transition flex items-center justify-center gap-2 ${
                  testMode
                    ? 'bg-amber-900/30 text-amber-400 border border-amber-800/30 hover:bg-amber-900/40'
                    : 'bg-green-900/30 text-green-400 border border-green-800/30 hover:bg-green-900/40'
                } ${sending ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {sending ? 'Creating ticket...' : testMode ? 'Send Test Email' : 'Send to Customer'}
              </button>
              <button
                onClick={onClose}
                className="px-6 py-2.5 rounded-lg text-xs font-semibold bg-dark-surface text-gray-400 border border-dark-border hover:text-gray-200 transition"
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
