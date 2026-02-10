/**
 * Reactive Communication Engine — Server Routes
 *
 * Handles:
 * 1. Webhook: New ticket created → consolidation check
 * 2. Webhook: Ticket updated (reply to merged ticket) → redirect
 * 3. Outbound gate: Pre-send verification
 * 4. Manual: Force merge / force send
 *
 * Triggered by Zendesk webhooks or called by the Zendesk sidebar app.
 */

const express = require('express');
const router = express.Router();
const zendesk = require('../lib/zendesk-client');
const commsLog = require('../lib/comms-log');

// In-memory store for pending merges (grace period)
const pendingMerges = new Map();

// In-memory store for agent locks
const agentLocks = new Map();

// Issue category keywords for classification
const ISSUE_CATEGORIES = {
  esim: ['esim', 'e-sim', 'activation', 'qr code', 'sim', 'provisioning'],
  payment: ['payment', 'charge', 'refund', 'billing', 'card', 'declined', 'invoice', 'double charge'],
  portin: ['port', 'transfer number', 'keep my number', 'porting', 'number transfer'],
  network: ['signal', 'network', 'data', 'coverage', 'no service', 'outage', 'slow'],
  account: ['login', 'password', 'account', 'email change', 'cancel', 'suspend'],
  billing: ['bill', 'subscription', 'plan', 'upgrade', 'downgrade', 'renewal'],
  airvet: ['airvet', 'vet', 'pet', 'veterinary'],
  general: []
};

// Gratitude keywords for auto-ack detection
const GRATITUDE_KEYWORDS = [
  'thanks', 'thank you', 'got it', 'perfect', 'great',
  'awesome', 'appreciate', 'that works', 'all good', 'wonderful'
];

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

/**
 * Strip common AI writing patterns to make text sound human.
 * Runs as a final pass on all draft output.
 */
function humanizeText(text) {
  if (!text) return text;

  let result = text;

  // ── STEP 1: Full-sentence filler removal ──
  // These add nothing. A real American support rep would never type these.

  const removePatterns = [
    // Scripted empathy — real people don't announce they understand
    /I want to assure you that\s*/gi,
    /I want to assure you\s*/gi,
    /I understand your frustration\.?\s*/gi,
    /I understand your concern\.?\s*/gi,
    /I understand how frustrating this (?:can be|is|must be)\.?\s*/gi,
    /I understand how (?:difficult|challenging|inconvenient) this (?:can be|is|must be)\.?\s*/gi,
    /I completely understand\.?\s*/gi,
    /I totally understand\.?\s*/gi,
    /I can only imagine how (?:frustrating|difficult|inconvenient) this (?:is|must be|has been)\.?\s*/gi,
    /I know this (?:isn't|is not) (?:ideal|what you (?:wanted|expected))\.?\s*/gi,
    // "Don't hesitate" — nobody talks like this
    /Please don't hesitate to reach out\.?\s*/gi,
    /Please don't hesitate to contact us\.?\s*/gi,
    /Please do not hesitate to\s*/gi,
    /Please don't hesitate to\s*/gi,
    /don't hesitate to reach out\.?\s*/gi,
    /do not hesitate to\s*/gi,
    /don't hesitate to\s*/gi,
    /feel free to reach out\.?\s*/gi,
    /feel free to contact us\.?\s*/gi,
    /feel free to reach back out\.?\s*/gi,
    // Robotic enthusiasm
    /Rest assured,?\s*/gi,
    /Certainly!\s*/gi,
    /Absolutely!\s*/gi,
    /Of course!\s*/gi,
    /Great question!\s*/gi,
    /That's a great question\.?\s*/gi,
    // "Happy to help" — the #1 AI tell
    /I'd be happy to help you with that\.?\s*/gi,
    /I'd be happy to help\.?\s*/gi,
    /I'd be happy to assist you with\s*/gi,  // keeps "with X" → "X"
    /I'd be happy to assist you\.?\s*/gi,
    /I'm happy to help\.?\s*/gi,
    /I'm happy to assist\.?\s*/gi,
    /I'm here to help\.?\s*/gi,
    /I'd love to help(?:\syou)? with (?:that|this)\.?\s*/gi,
    /Let me help you with that\.?\s*/gi,
    // Empty closers — filler at the end
    /I hope this helps\.?\s*/gi,
    /I hope that helps\.?\s*/gi,
    /I hope this resolves your (?:issue|concern|problem)\.?\s*/gi,
    /I hope this information (?:is helpful|helps)\.?\s*/gi,
    /Hope that helps\.?\s*/gi,
    /Hope this helps\.?\s*/gi,
    /I trust this (?:helps|answers your question|resolves your concern)\.?\s*/gi,
    /Please let me know if (?:there is|there's) anything else I can (?:help|assist) (?:you )?with\.?\s*/gi,
    /Is there anything else I can (?:help|assist) you with\.?\s*/gi,
    // Corporate filler
    /Thank you for your patience and understanding\.?\s*/gi,
    /Thank you for your understanding\.?\s*/gi,
    /Thank you for bringing this to our attention\.?\s*/gi,
    /Thank you for contacting us\.?\s*/gi,
    /Thank you for reaching out to us\.?\s*/gi,
    /Thanks for your patience and understanding\.?\s*/gi,
    /I appreciate your patience\.?\s*/gi,
    /I appreciate you reaching out\.?\s*/gi,
    /We appreciate your patience\.?\s*/gi,
    /We appreciate you reaching out\.?\s*/gi,
    /We value you as a customer\.?\s*/gi,
    /We value your (?:business|loyalty)\.?\s*/gi,
    /Your satisfaction is (?:our|my) (?:top |number one )?priority\.?\s*/gi,
    /Your (?:feedback|input) is (?:important|valuable) to us\.?\s*/gi,
    /We take (?:this|your concern|your feedback) (?:very )?seriously\.?\s*/gi,
    // Wordy padding — just say the thing
    /Please be advised that\s*/gi,
    /I wanted to let you know that\s*/gi,
    /I just wanted to (?:let you know|reach out|follow up|check in) (?:and |that )?\s*/gi,
    /I'm writing to inform you that\s*/gi,
    /I'm writing to let you know that\s*/gi,
    /As per our (?:conversation|discussion|records),?\s*/gi,
    /As mentioned (?:earlier|previously|above),?\s*/gi,
    /I would like to inform you that\s*/gi,
    /I wanted to take a moment to\s*/gi,
  ];
  for (const pattern of removePatterns) {
    result = result.replace(pattern, '');
  }

  // ── STEP 2: Phrase swaps → how Americans actually text/email ──

  // Apologies — Americans keep it short: "sorry" not "I sincerely apologize"
  result = result.replace(/I sincerely apologize/gi, "I'm really sorry");
  result = result.replace(/I deeply apologize/gi, "I'm really sorry");
  result = result.replace(/I apologize for the inconvenience/gi, "sorry about that");
  result = result.replace(/I apologize for any inconvenience/gi, "sorry about that");
  result = result.replace(/I apologize for any (?:issues|trouble|difficulties|problems)/gi, "sorry about that");
  result = result.replace(/We apologize for the inconvenience/gi, "sorry about that");
  result = result.replace(/We sincerely apologize/gi, "we're really sorry");
  result = result.replace(/I apologize/gi, "sorry");
  result = result.replace(/my apologies/gi, "sorry");
  result = result.replace(/our apologies/gi, "sorry");
  result = result.replace(/we apologize/gi, "we're sorry");

  // Transitions — Americans don't use essay words in emails
  result = result.replace(/Furthermore,?\s*/gi, 'Also, ');
  result = result.replace(/Additionally,?\s*/gi, 'Also, ');
  result = result.replace(/Moreover,?\s*/gi, 'Also, ');
  result = result.replace(/However,?\s*/gi, 'That said, ');
  result = result.replace(/Nevertheless,?\s*/gi, 'That said, ');
  result = result.replace(/Nonetheless,?\s*/gi, 'That said, ');
  result = result.replace(/Consequently,?\s*/gi, 'So ');
  result = result.replace(/Therefore,?\s*/gi, 'So ');
  result = result.replace(/Thus,?\s*/gi, 'So ');
  result = result.replace(/Hence,?\s*/gi, 'So ');
  result = result.replace(/Henceforth,?\s*/gi, 'From now on, ');

  // Stiff phrasing → how a real person would say it
  result = result.replace(/I have gone ahead and\s*/gi, "I ");
  result = result.replace(/I've gone ahead and\s*/gi, "I've ");
  result = result.replace(/I went ahead and\s*/gi, "I ");
  result = result.replace(/I have (?:taken the liberty|gone ahead) (?:of|to)\s*/gi, "I ");
  result = result.replace(/At this time,?\s*/gi, 'Right now, ');
  result = result.replace(/At this point in time,?\s*/gi, 'Right now, ');
  result = result.replace(/At this juncture,?\s*/gi, 'Right now, ');
  result = result.replace(/I'd be happy to assist you with\s*/gi, 'I can help with ');
  result = result.replace(/I'd be happy to help you with\s*/gi, 'I can help with ');
  result = result.replace(/I'd be happy to\s*/gi, 'I can ');
  result = result.replace(/I'd be glad to\s*/gi, 'I can ');
  result = result.replace(/I would be happy to\s*/gi, 'I can ');
  result = result.replace(/I would like to\s*/gi, "I'd like to ");
  result = result.replace(/I can confirm that\s*/gi, '');
  result = result.replace(/I can assure you that\s*/gi, '');
  result = result.replace(/Please note that\s*/gi, 'Heads up, ');
  result = result.replace(/Please be aware that\s*/gi, 'Heads up, ');
  result = result.replace(/It is worth noting that\s*/gi, '');
  result = result.replace(/It should be noted that\s*/gi, '');
  result = result.replace(/It is important to note that\s*/gi, '');
  result = result.replace(/Kindly\s*/gi, 'Please ');
  result = result.replace(/(?:^|\.\s+)Apologies(?:,|\s)/gim, '. Sorry, ');
  result = result.replace(/upon (?:further )?(?:review|investigation|checking)/gi, 'after looking into this');
  result = result.replace(/after (?:further )?(?:review|investigation)/gi, 'after looking into this');
  result = result.replace(/(?:I have |I've )?(?:looked into|investigated|reviewed) (?:this |your )?(?:matter|issue|case|concern|situation)/gi, "I looked into this");
  result = result.replace(/It appears that\s*/gi, 'Looks like ');
  result = result.replace(/It seems that\s*/gi, 'Looks like ');
  result = result.replace(/It would appear that\s*/gi, 'Looks like ');
  result = result.replace(/I (?:would like to |want to )?bring to your attention that\s*/gi, '');
  result = result.replace(/we are (?:currently )?(?:in the process of|working on)\s*/gi, "we're working on ");
  result = result.replace(/we are pleased to inform you that\s*/gi, '');
  result = result.replace(/I am pleased to inform you that\s*/gi, '');
  result = result.replace(/you will be (?:glad|happy|pleased) to (?:know|hear) that\s*/gi, '');
  result = result.replace(/I'm pleased to let you know that\s*/gi, '');

  // ── STEP 3: Vocabulary — plain American English ──
  // Americans say "use" not "utilize", "help" not "assistance", "about" not "regarding"

  result = result.replace(/\butilize\b/gi, 'use');
  result = result.replace(/\butilizing\b/gi, 'using');
  result = result.replace(/\butilization\b/gi, 'use');
  result = result.replace(/\bfacilitate\b/gi, 'help with');
  result = result.replace(/\bfacilitating\b/gi, 'helping with');
  result = result.replace(/\bendeavor\b/gi, 'try');
  result = result.replace(/\bcommence\b/gi, 'start');
  result = result.replace(/\bcommencing\b/gi, 'starting');
  result = result.replace(/\bterminate\b/gi, 'end');
  result = result.replace(/\bterminated\b/gi, 'ended');
  result = result.replace(/\bpurchased\b/gi, 'bought');
  result = result.replace(/\bassistance\b/gi, 'help');
  result = result.replace(/\binquiry\b/gi, 'question');
  result = result.replace(/\binquiries\b/gi, 'questions');
  result = result.replace(/\brectify\b/gi, 'fix');
  result = result.replace(/\bresolve this matter\b/gi, 'get this sorted out');
  result = result.replace(/\bresolve this issue\b/gi, 'get this fixed');
  result = result.replace(/\bresolve (?:your |the )?(?:concern|problem)\b/gi, 'fix this');
  result = result.replace(/\bremedy\b/gi, 'fix');
  result = result.replace(/\bsubsequently\b/gi, 'after that');
  result = result.replace(/\bprior to\b/gi, 'before');
  result = result.replace(/\bensure\b/gi, 'make sure');
  result = result.replace(/\bensuring\b/gi, 'making sure');
  result = result.replace(/\binconvenience(?:d)?\b/gi, 'trouble');
  result = result.replace(/\bexperience(?:d)? (?:an |any )?(?:issue|difficulty|problem)/gi, 'had a problem');
  result = result.replace(/\bregarding\b\s*/gi, 'about ');
  result = result.replace(/\bin regards to\b\s*/gi, 'about ');
  result = result.replace(/\bwith regards to\b\s*/gi, 'about ');
  result = result.replace(/\bwith respect to\b\s*/gi, 'about ');
  result = result.replace(/\bpertaining to\b\s*/gi, 'about ');
  result = result.replace(/\bin relation to\b\s*/gi, 'about ');
  result = result.replace(/\bin order to\b\s*/gi, 'to ');
  result = result.replace(/\bdue to the fact that\b\s*/gi, 'because ');
  result = result.replace(/\bat your earliest convenience\b/gi, 'when you get a chance');
  result = result.replace(/\bmoving forward\b/gi, 'from here');
  result = result.replace(/\bgoing forward\b/gi, 'from here');
  result = result.replace(/\bfor your reference\b/gi, 'FYI');
  result = result.replace(/\bfor your records\b/gi, 'FYI');
  result = result.replace(/\bplease find attached\b/gi, "I've attached");
  result = result.replace(/\battached herewith\b/gi, "attached");
  result = result.replace(/\bdo let (?:me|us) know\b/gi, 'let me know');
  result = result.replace(/\bplease do let (?:me|us) know\b/gi, 'just let me know');
  result = result.replace(/\bshould you have any (?:further |additional )?questions?\b/gi, 'if you have any questions');
  result = result.replace(/\bif you require (?:any )?(?:further |additional )?(?:assistance|help)\b/gi, 'if you need anything else');
  result = result.replace(/\bif you need (?:any )?(?:further |additional )(?:assistance|help)\b/gi, 'if you need anything else');
  result = result.replace(/\bdo not hesitate\b/gi, 'feel free');
  result = result.replace(/\bnumerous\b/gi, 'a lot of');
  result = result.replace(/\bsufficient\b/gi, 'enough');
  result = result.replace(/\bnevertheless\b/gi, 'still');
  result = result.replace(/\bwhilst\b/gi, 'while');
  result = result.replace(/\bamongst\b/gi, 'among');
  result = result.replace(/\btowards\b/gi, 'toward');
  result = result.replace(/\bforward(?:ed)? (?:this |your )?(?:matter|issue|case|concern) to\b/gi, 'passed this to');
  result = result.replace(/\bescalated (?:this |your )?(?:matter|issue|case|concern) to\b/gi, 'flagged this with');
  result = result.replace(/\bat the present time\b/gi, 'right now');
  result = result.replace(/\bin the near future\b/gi, 'soon');
  result = result.replace(/\bin a timely manner\b/gi, 'quickly');
  result = result.replace(/\bin a timely fashion\b/gi, 'quickly');

  // Sign-offs — Americans say "Thanks" not "Best regards"
  result = result.replace(/\bBest regards,?\s*$/gim, 'Thanks,');
  result = result.replace(/\bWarm regards,?\s*$/gim, 'Thanks,');
  result = result.replace(/\bKind regards,?\s*$/gim, 'Thanks,');
  result = result.replace(/\bSincerely,?\s*$/gim, 'Thanks,');
  result = result.replace(/\bYours truly,?\s*$/gim, 'Thanks,');
  result = result.replace(/\bRespectfully,?\s*$/gim, 'Thanks,');
  result = result.replace(/\bWith (?:kind |warm |best )?regards,?\s*$/gim, 'Thanks,');

  // ── STEP 4: Contraction enforcement ──
  // Americans use contractions in casual writing. Not using them sounds robotic.

  result = result.replace(/\bI am\b/g, "I'm");
  result = result.replace(/\bI have\b(?! to| a | an | any | no | the | my | your | been)/g, "I've");
  result = result.replace(/\bI will\b/g, "I'll");
  result = result.replace(/\bI would\b/g, "I'd");
  result = result.replace(/\bwe are\b/gi, "we're");
  result = result.replace(/\bwe have\b(?! to| a | an | any | no | the | our | been)/gi, "we've");
  result = result.replace(/\bwe will\b/gi, "we'll");
  result = result.replace(/\bwe would\b/gi, "we'd");
  result = result.replace(/\byou are\b/gi, "you're");
  result = result.replace(/\byou will\b/gi, "you'll");
  result = result.replace(/\byou would\b/gi, "you'd");
  result = result.replace(/\bthat is\b/gi, "that's");
  result = result.replace(/\bit is\b/gi, "it's");
  result = result.replace(/\bit will\b/gi, "it'll");
  result = result.replace(/\bthere is\b/gi, "there's");
  result = result.replace(/\bdo not\b/gi, "don't");
  result = result.replace(/\bdoes not\b/gi, "doesn't");
  result = result.replace(/\bdid not\b/gi, "didn't");
  result = result.replace(/\bcannot\b/gi, "can't");
  result = result.replace(/\bcan not\b/gi, "can't");
  result = result.replace(/\bwill not\b/gi, "won't");
  result = result.replace(/\bwould not\b/gi, "wouldn't");
  result = result.replace(/\bshould not\b/gi, "shouldn't");
  result = result.replace(/\bcould not\b/gi, "couldn't");
  result = result.replace(/\bhas not\b/gi, "hasn't");
  result = result.replace(/\bhave not\b/gi, "haven't");
  result = result.replace(/\bis not\b/gi, "isn't");
  result = result.replace(/\bare not\b/gi, "aren't");
  result = result.replace(/\bwas not\b/gi, "wasn't");
  result = result.replace(/\bwere not\b/gi, "weren't");
  result = result.replace(/\blet us\b/gi, "let's");

  // ── STEP 5: Punctuation ──

  // Semicolons → periods (Americans don't use semicolons in casual emails)
  result = result.replace(/;\s*/g, '. ');

  // Em dashes → comma or just join naturally
  result = result.replace(/\s*—\s*/g, ' - ');

  // Exclamation marks — allow max 2 (Americans are warm but not manic)
  let exclamationCount = 0;
  result = result.replace(/!/g, () => {
    exclamationCount++;
    return exclamationCount <= 2 ? '!' : '.';
  });

  // ── STEP 6: Cleanup ──

  // Collapse whitespace
  result = result.replace(/  +/g, ' ');
  result = result.replace(/^ +/gm, '');
  // Fix stray double periods
  result = result.replace(/\.\.+\s*/g, '. ');
  // Fix orphaned commas from removals (", To..." or "., ")
  result = result.replace(/^,\s*/gm, '');
  result = result.replace(/\.\s*,\s*/g, '. ');
  result = result.replace(/,\s*,/g, ',');
  // Fix "- " at start of sentence after em-dash + removal
  result = result.replace(/\s*-\s*\.\s*/g, '. ');
  result = result.replace(/^\s*-\s*$/gm, '');

  // Re-capitalize
  result = result.replace(/\. ([a-z])/g, (_, c) => '. ' + c.toUpperCase());
  result = result.replace(/^([a-z])/gm, (_, c) => c.toUpperCase());

  // Collapse excess blank lines
  result = result.replace(/\n{3,}/g, '\n\n');
  // Trim trailing whitespace
  result = result.replace(/[ \t]+$/gm, '');

  return result;
}

/**
 * Classify issue category from ticket subject + description
 */
function classifyIssue(text) {
  const lower = (text || '').toLowerCase();
  for (const [category, keywords] of Object.entries(ISSUE_CATEGORIES)) {
    if (category === 'general') continue;
    for (const kw of keywords) {
      if (lower.includes(kw)) return category;
    }
  }
  return 'general';
}

/**
 * Check if text is a short gratitude/acknowledgement
 */
function isGratitudeReply(text) {
  if (!text || text.length > 50) return false;
  const lower = text.toLowerCase().trim();
  return GRATITUDE_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Build merge summary internal note
 */
function buildMergeSummary(targetTicket, sourceTickets, issueThreads) {
  const timestamp = new Date().toISOString();
  const rows = sourceTickets.map((t, i) => {
    const issue = issueThreads[t.id] || 'general';
    return `| ${i + 1} | ${t.subject || 'N/A'} | #${t.id} | ${t.via?.channel || 'unknown'} | ${t.priority || 'normal'} | ${issue} |`;
  }).join('\n');

  return `## Ticket Consolidation Summary

**Consolidated at:** ${timestamp}
**Target ticket:** #${targetTicket.id}
**Source tickets merged:** ${sourceTickets.length}
**Total issues identified:** ${Object.keys(issueThreads).length}

### Issues Overview

| # | Subject | Source Ticket | Channel | Priority | Issue |
|---|---------|--------------|---------|----------|-------|
${rows}

### Action Required
Agent must address ALL issues in a single consolidated response.
Use the consolidated response template from reactive-communication skill (Section E, Template 1).`;
}

/**
 * Build agent checklist internal note
 */
function buildAgentChecklist(issueCount) {
  return `## Agent Pre-Response Checklist

Before responding to this customer, complete the following:

- [ ] Read ALL merged conversation histories (see internal notes below)
- [ ] Identify root cause for EACH issue (${issueCount} issues found)
- [ ] Check if any issue has a proactive outreach already sent (look for proactive_alert tag)
- [ ] Determine resolution or next step for EACH issue
- [ ] Draft ONE consolidated response covering ALL issues
- [ ] Select response channel (email for multi-issue)
- [ ] Verify response passes outbound gate

### Priority Ordering for Response
1. Service-impacting (no connectivity, can't make calls)
2. Financial (double charges, billing errors)
3. Pending actions (port-in, eSIM activation)
4. Informational (how-to, status updates)`;
}

// Issue-specific response templates keyed by category.
// Each template takes the customer's actual message context to produce a detailed response.
const ISSUE_TEMPLATES = {
  esim: {
    label: 'eSIM Activation',
    buildSection(customerMessages) {
      return `**Regarding your eSIM activation:**

I can see you've been having trouble getting your eSIM set up${customerMessages.length > 1 ? ` (you've reached out about this ${customerMessages.length} times, and I'm really sorry about that)` : ''}. I've looked into your account and here's exactly what's going on:

Our system shows your eSIM profile status is currently pending. I've triggered a fresh eSIM profile for your account. You should receive a new QR code at this email address within the next 15 minutes.

Once you receive it, here's how to install it (takes about 2 minutes):
1. Open **Settings** on your phone
2. Tap **Cellular** (iPhone) or **Network & Internet** (Android)
3. Tap **"Add eSIM"** or **"Add Cellular Plan"**
4. Scan the new QR code from the email

**Important:** If you previously tried scanning an old QR code, that one is now deactivated. Please only use the new one.

If the new QR code doesn't work or you don't receive it within 15 minutes, reply here right away and I'll escalate this to our technical team.`;
    }
  },
  payment: {
    label: 'Payment / Billing',
    buildSection(customerMessages) {
      const mentionsDuplicate = customerMessages.some(m => /double|twice|duplicate/i.test(m));
      const mentionsRefund = customerMessages.some(m => /refund/i.test(m));
      const mentionsFailed = customerMessages.some(m => /fail|decline|reject/i.test(m));

      if (mentionsDuplicate) {
        return `**Regarding your payment concern:**

I've reviewed your billing history and I can confirm there is a duplicate charge on your account. Sorry about that, it shouldn't have happened.

Here's what I've done:
1. I've flagged the duplicate charge and initiated a refund to your original payment method
2. The refund should appear on your statement within **3-5 business days** (depending on your bank)
3. Your service will remain fully active. This billing issue does not affect your plan

You don't need to do anything on your end. I'll follow up with you in 3 days to confirm the refund has posted. If you don't see it by then, just reply here and I'll escalate to our billing team directly.`;
      }

      if (mentionsFailed) {
        return `**Regarding your payment issue:**

I've looked into your account and can see the payment attempt was not successful. This can sometimes happen due to bank security checks or card verification requirements.

Here's what I'd recommend:
1. **Check with your bank** - sometimes "Meow Mobile" or "Gather Inc." gets flagged for new transactions. Ask them to allow it.
2. **Verify your card details** - in the Meow Mobile app, go to **Settings > Payment Method** and confirm your card number, expiration, and billing ZIP are correct.
3. **Try again** - once the above are confirmed, retry the payment in the app.

If it still doesn't go through after trying these steps, reply here with the last 4 digits of the card you're using and I'll investigate further on our end.`;
      }

      return `**Regarding your billing concern:**

I've reviewed your payment and billing history. Here's what I found and what I'm doing about it:

I've flagged this for our billing team to review. You should expect a resolution within 24-48 hours. For now, your service remains active and unaffected.

${mentionsRefund ? 'I\'ve also submitted your refund request. You\'ll receive a confirmation email once it\'s processed (typically 3-5 business days).' : ''}

If you have any additional billing questions, just reply here.`;
    }
  },
  portin: {
    label: 'Number Transfer (Port-In)',
    buildSection(customerMessages) {
      const mentionsRejected = customerMessages.some(m => /reject|fail|denied/i.test(m));
      const mentionsStuck = customerMessages.some(m => /stuck|delay|waiting|slow|long/i.test(m));

      if (mentionsRejected) {
        return `**Regarding your number transfer:**

I've checked the status of your port-in request and it was unfortunately rejected by your previous carrier. This is very common and usually easy to fix.

The most likely reasons:
- The **account number or PIN** doesn't match their records exactly
- There's a **port-out block** on your old account
- The **name on file** doesn't match exactly (even small differences like "Bob" vs "Robert")

Here's what to do:
1. Call your **previous carrier** and ask them for your exact **Account Number** and **Transfer PIN**
2. Ask them to **remove any port-out restrictions** on your account
3. Confirm the **exact name** on the account
4. Reply to this email with the verified details

Once I have the correct information, I'll resubmit the transfer right away. It typically completes within **24-48 hours** after that.`;
      }

      return `**Regarding your number transfer:**

I've checked the status of your port-in request. ${mentionsStuck ? 'I know this has been taking longer than expected, sorry about the delay.' : 'Here\'s the current status:'}

Port-in requests typically take 1-3 business days to complete. I've flagged yours for priority processing with our carrier team. You'll receive a confirmation email the moment the transfer is complete.

For now, your Meow Mobile service is active with a temporary number. Once the port completes, your original number will automatically replace it. No action needed from you.

I'll follow up within 24 hours with an update. If you need anything sooner, just reply here.`;
    }
  },
  network: {
    label: 'Network / Connectivity',
    buildSection(customerMessages) {
      const mentionsNoService = customerMessages.some(m => /no service|no signal|can't call|cant call|no data/i.test(m));

      return `**Regarding your connectivity issue:**

${mentionsNoService ? 'I can see you\'re currently without service, and I know that\'s really inconvenient.' : 'I\'ve looked into the connectivity issues you reported.'}

I've checked our network status for your area and here's what I've found:

First, please try these quick steps (they resolve most connectivity issues):
1. **Toggle Airplane Mode** - turn it on, wait 10 seconds, turn it off
2. **Restart your device** completely (power off and back on)
3. **Check your eSIM** - go to Settings > Cellular and make sure your Meow Mobile line is enabled and set as the primary line for data

If you're still having issues after trying these steps:
- Try connecting to **WiFi** and enable **WiFi Calling** (Settings > Phone > WiFi Calling) for calls and texts
- Reply to this email with your **ZIP code** so I can check for any known outages in your area

I'll keep monitoring this and follow up with you.`;
    }
  },
  account: {
    label: 'Account',
    buildSection(customerMessages) {
      return `**Regarding your account issue:**

I've reviewed your account and here's what I've found and what steps I've taken:

I'm looking into this now and will have an update for you shortly. If you need immediate access to your account, please try resetting your password through the Meow Mobile app (tap "Forgot Password" on the login screen).

If that doesn't work, reply here and I'll help you regain access right away.`;
    }
  },
  billing: {
    label: 'Billing',
    buildSection(customerMessages) {
      return `**Regarding your billing question:**

I've pulled up your billing history and plan details. Here's what I see:

I've forwarded your inquiry to our billing team for a detailed review. You'll receive a clear breakdown within 24 hours. For now, your service is active and unaffected.

If you have any specific charges you'd like me to look into right away, just reply with the details.`;
    }
  },
  airvet: {
    label: 'Airvet / Pet Care',
    buildSection(customerMessages) {
      return `**Regarding Airvet:**

Great news - Airvet is included free with your Meow Mobile plan! Here's what you need to know:

- **Download the Airvet app** from the App Store or Google Play
- **Sign up** using the same email address associated with your Meow Mobile account
- You'll get **unlimited 24/7 access** to licensed veterinarians via video chat

If you're having trouble activating or connecting, reply here and I'll get our Airvet support team involved.`;
    }
  },
  general: {
    label: 'Your Inquiry',
    buildSection(customerMessages) {
      return `**Regarding your inquiry:**

Thanks for reaching out. I've reviewed your message and I'm looking into this now. I'll have a detailed response for you within the next few hours.

If there's anything specific you'd like me to prioritize, just reply here.`;
    }
  }
};

/**
 * Build a comprehensive draft customer response covering all issues.
 * Pulls actual customer messages, deduplicates same-issue tickets,
 * and generates detailed per-issue responses.
 */
function buildDraftResponse(customerName, issueThreads, allTickets, ticketComments) {
  const name = customerName || 'there';

  // Priority order: service-impacting first, then financial, then pending, then informational
  const priorityOrder = ['network', 'esim', 'payment', 'billing', 'portin', 'account', 'airvet', 'general'];

  // Group tickets by issue and collect customer messages per issue
  const issueGroups = {};
  for (const [ticketId, category] of Object.entries(issueThreads)) {
    if (!issueGroups[category]) {
      issueGroups[category] = { tickets: [], customerMessages: [] };
    }
    const ticket = allTickets.find(t => String(t.id) === String(ticketId));
    if (ticket) {
      issueGroups[category].tickets.push(ticket);
    }
    // Use actual comments if available (preferred — avoids double-counting subject+description)
    if (ticketComments && ticketComments[ticketId]) {
      const customerMsgs = ticketComments[ticketId].filter(c => c.isCustomer);
      if (customerMsgs.length > 0) {
        for (const comment of customerMsgs) {
          issueGroups[category].customerMessages.push(comment.body);
        }
      } else if (ticket) {
        // Fallback: use subject + description if no customer comments found
        issueGroups[category].customerMessages.push(
          `${ticket.subject || ''} ${ticket.description || ''}`
        );
      }
    } else if (ticket) {
      // No comments data — fall back to subject + description
      issueGroups[category].customerMessages.push(
        `${ticket.subject || ''} ${ticket.description || ''}`
      );
    }
  }

  // Sort issues by priority
  const sortedIssues = Object.keys(issueGroups).sort(
    (a, b) => priorityOrder.indexOf(a) - priorityOrder.indexOf(b)
  );

  // Build response sections
  const sections = sortedIssues.map(issue => {
    const template = ISSUE_TEMPLATES[issue] || ISSUE_TEMPLATES.general;
    return template.buildSection(issueGroups[issue].customerMessages);
  });

  const issueCount = sortedIssues.length;
  const ticketCount = allTickets.length;

  // Build next steps summary for multi-issue
  let nextStepsSummary = '';
  if (issueCount > 1) {
    nextStepsSummary = `\n**Quick summary of what happens next:**\n${sortedIssues.map((issue, i) => {
      const label = (ISSUE_TEMPLATES[issue] || ISSUE_TEMPLATES.general).label;
      const dupCount = issueGroups[issue].tickets.length;
      const dupNote = dupCount > 1 ? ` (you reported this ${dupCount} times, all consolidated here)` : '';
      return `${i + 1}. **${label}${dupNote}** - see details above`;
    }).join('\n')}\n`;
  }

  // Apology note if customer contacted multiple times
  const apologyNote = ticketCount > 2
    ? `\n\nI can see you've reached out ${ticketCount} times, and I'm really sorry it took multiple contacts to get this handled. I've consolidated everything so you have one point of contact from here on out.\n`
    : ticketCount === 2
    ? `\n\nI noticed you reached out a couple of times. I've consolidated your requests so I can handle everything in one place for you.\n`
    : '';

  const draft = `## DRAFT CUSTOMER RESPONSE - READY TO REVIEW & SEND

---

Subject: Update on your Meow Mobile support request${issueCount > 1 ? 's' : ''}

Hi ${name},

Thank you for contacting Meow Mobile Support. I've reviewed ${issueCount > 1 ? 'all of your recent messages' : 'your message'} and want to give you a complete update.${apologyNote}

${sections.join('\n\n---\n\n')}

${nextStepsSummary}
I'm handling your case personally, so you won't need to explain anything again. If anything doesn't look right or you have questions, just reply to this email and I'll take care of it.

Best,
[AGENT NAME]
Meow Mobile Support

---

**AGENT INSTRUCTIONS:**
1. Review the draft above. It's based on the customer's actual messages.
2. Replace **[AGENT NAME]** with your name.
3. If you have access to account data (eSIM status, payment records, etc.), update the relevant sections with specifics.
4. Once reviewed, copy everything between the --- lines and send as a **public reply**.`;

  return humanizeText(draft);
}

// ─────────────────────────────────────────────
// ROUTE 1: Webhook — New Ticket Created
// POST /api/reactive/ticket-created
// ─────────────────────────────────────────────

router.post('/ticket-created', async (req, res) => {
  try {
    const { ticket_id, requester_email } = req.body;

    if (!ticket_id || !requester_email) {
      return res.status(400).json({ error: 'ticket_id and requester_email are required' });
    }

    console.log(`[REACTIVE] New ticket #${ticket_id} from ${requester_email}`);

    // Step 1: Search for other open tickets from same requester
    const openTickets = await zendesk.searchTicketsByRequester(requester_email);

    // Filter out the current ticket
    const otherTickets = openTickets.filter(t => String(t.id) !== String(ticket_id));

    if (otherTickets.length === 0) {
      // Single ticket — no consolidation needed
      console.log(`[REACTIVE] Single ticket for ${requester_email}. No consolidation.`);
      return res.json({
        action: 'none',
        message: 'Single ticket, no consolidation needed',
        ticket_id
      });
    }

    // Step 2: Multiple tickets detected — schedule merge with 2-min grace period
    console.log(`[REACTIVE] ${otherTickets.length} other open ticket(s) found for ${requester_email}. Scheduling merge.`);

    // Add internal note to the new ticket
    await zendesk.addInternalNote(ticket_id,
      `Multiple open tickets detected for this customer (${otherTickets.length + 1} total). Consolidation scheduled in 2 minutes.`
    );

    // Tag the ticket as merge pending
    const currentTicket = await zendesk.getTicket(ticket_id);
    const currentTags = zendesk.getTicketTags(currentTicket);
    await zendesk.updateTicket(ticket_id, {
      tags: [...new Set([...currentTags, 'merge_pending'])]
    });

    // Schedule merge after 2-minute grace period
    const mergeKey = requester_email;
    if (pendingMerges.has(mergeKey)) {
      clearTimeout(pendingMerges.get(mergeKey).timer);
    }

    const timer = setTimeout(async () => {
      try {
        await executeMerge(requester_email);
      } catch (err) {
        console.error(`[REACTIVE] Merge failed for ${requester_email}:`, err.message);
      }
      pendingMerges.delete(mergeKey);
    }, 2 * 60 * 1000); // 2 minutes

    pendingMerges.set(mergeKey, { timer, scheduledAt: new Date().toISOString() });

    res.json({
      action: 'merge_scheduled',
      message: `Merge scheduled in 2 minutes for ${requester_email}`,
      ticket_count: otherTickets.length + 1,
      ticket_ids: [ticket_id, ...otherTickets.map(t => t.id)]
    });

  } catch (error) {
    console.error('[REACTIVE] ticket-created error:', error);
    res.status(500).json({ error: 'Failed to process new ticket', details: error.message });
  }
});

// ─────────────────────────────────────────────
// ROUTE 2: Force Merge (skip grace period)
// POST /api/reactive/merge
// ─────────────────────────────────────────────

router.post('/merge', async (req, res) => {
  try {
    const { requester_email } = req.body;

    if (!requester_email) {
      return res.status(400).json({ error: 'requester_email is required' });
    }

    // Cancel any pending merge timer
    if (pendingMerges.has(requester_email)) {
      clearTimeout(pendingMerges.get(requester_email).timer);
      pendingMerges.delete(requester_email);
    }

    const result = await executeMerge(requester_email);
    res.json(result);

  } catch (error) {
    console.error('[REACTIVE] merge error:', error);
    res.status(500).json({ error: 'Merge failed', details: error.message });
  }
});

/**
 * Execute the ticket merge for a customer.
 * Merges ALL open tickets into the newest one regardless of issue type.
 * Each issue is classified and tagged so the agent's response addresses every issue separately.
 */
async function executeMerge(requesterEmail) {
  console.log(`[REACTIVE] Executing merge for ${requesterEmail}`);

  // Re-query open tickets (state may have changed during grace period)
  const allTickets = await zendesk.searchTicketsByRequester(requesterEmail);

  if (allTickets.length <= 1) {
    console.log(`[REACTIVE] Only ${allTickets.length} ticket(s) found. No merge needed.`);
    return { action: 'none', message: 'Not enough tickets to merge' };
  }

  // Target = newest ticket (first in list, sorted desc by created_at)
  const targetTicket = allTickets[0];
  const sourceTickets = allTickets.slice(1);

  console.log(`[REACTIVE] Merging ${sourceTickets.length} ticket(s) into #${targetTicket.id}`);

  // Classify issues for all tickets
  const issueThreads = {};
  let threadNum = 1;
  for (const ticket of allTickets) {
    const category = classifyIssue(`${ticket.subject} ${ticket.description}`);
    issueThreads[ticket.id] = category;
    threadNum++;
  }

  // Identify unique issues for the agent checklist
  const uniqueIssues = [...new Set(Object.values(issueThreads))];

  // Collect all ticket comments for draft response generation
  const ticketComments = {};

  // Fetch target ticket comments first
  const targetComments = await zendesk.getTicketComments(targetTicket.id);
  ticketComments[targetTicket.id] = targetComments.map(c => ({
    body: c.body || '',
    isCustomer: c.author_id === targetTicket.requester_id,
    created_at: c.created_at
  }));

  // Copy comments from each source ticket as internal notes on target
  for (const source of sourceTickets) {
    const comments = await zendesk.getTicketComments(source.id);
    const category = issueThreads[source.id] || 'general';

    // Store for draft response
    ticketComments[source.id] = comments.map(c => ({
      body: c.body || '',
      isCustomer: c.author_id === source.requester_id,
      created_at: c.created_at
    }));

    const commentHistory = comments.map(c => {
      const author = c.author_id === source.requester_id ? 'Customer' : 'Agent';
      const time = new Date(c.created_at).toLocaleString();
      return `[${time}] ${author}: ${c.body}`;
    }).join('\n\n');

    await zendesk.addInternalNote(targetTicket.id,
      `---\n**[MERGED] From Ticket #${source.id} (${source.via?.channel || 'unknown'})**\n**Subject:** ${source.subject}\n**Created:** ${source.created_at}\n**Issue:** ${category}\n\n**Conversation History:**\n${commentHistory}\n---`
    );
  }

  // Build issue thread tags
  const issueThreadTags = [];
  let idx = 1;
  for (const [ticketId, category] of Object.entries(issueThreads)) {
    issueThreadTags.push(`issue_thread_${idx}_${category}`);
    idx++;
  }

  // Merge metadata on target
  const allTags = zendesk.mergeTags(
    ...allTickets.map(t => zendesk.getTicketTags(t))
  );
  const highestPriority = zendesk.getHighestPriority(allTickets);
  const assignee = zendesk.getMostRecentAgent(allTickets);

  // Remove transient tags, add consolidation tags
  const finalTags = allTags
    .filter(t => t !== 'merge_pending' && t !== 'suppress_auto_ack')
    .concat(['consolidated_ticket', `merged_count_${sourceTickets.length}`])
    .concat(issueThreadTags);

  await zendesk.updateTicket(targetTicket.id, {
    tags: [...new Set(finalTags)],
    priority: highestPriority,
    assignee_id: assignee
  });

  // Add merge summary and agent checklist to target
  await zendesk.addInternalNote(targetTicket.id, buildMergeSummary(targetTicket, sourceTickets, issueThreads));
  await zendesk.addInternalNote(targetTicket.id, buildAgentChecklist(uniqueIssues.length));

  // If multiple different issues exist, add explicit guidance
  if (uniqueIssues.length > 1) {
    const issueList = uniqueIssues.map((issue, i) => `${i + 1}. **${issue}**`).join('\n');
    await zendesk.addInternalNote(targetTicket.id,
      `## IMPORTANT: Multiple Different Issues Detected

This customer has ${uniqueIssues.length} distinct issues across their tickets:
${issueList}

Your response MUST address each issue in its own section. Use the consolidated response template:

> **Regarding your [issue 1]:**
> [diagnosis + resolution]
>
> **Regarding your [issue 2]:**
> [diagnosis + resolution]

The outbound gate will verify that all issues are addressed before allowing send.`
    );
  }

  // Fetch requester name (search results don't include requester.name)
  let customerName = 'there';
  try {
    const fullTarget = await zendesk.getTicket(targetTicket.id);
    if (fullTarget.requester?.name) {
      customerName = fullTarget.requester.name;
    } else if (fullTarget.requester_id) {
      // Try to get user info via API
      const userData = await zendesk.zendeskRequest(`/users/${fullTarget.requester_id}.json`);
      if (userData?.user?.name) {
        customerName = userData.user.name;
      }
    }
  } catch (e) {
    console.warn(`[REACTIVE] Could not fetch requester name: ${e.message}`);
  }

  // Generate draft customer response covering all issues
  const draftResponse = buildDraftResponse(customerName, issueThreads, allTickets, ticketComments);
  await zendesk.addInternalNote(targetTicket.id, draftResponse);

  // Close source tickets (pending → solved to handle Zendesk status transition rules)
  for (const source of sourceTickets) {
    const sourceTags = zendesk.getTicketTags(source);
    // First set to pending with merge tags and internal note
    await zendesk.updateTicket(source.id, {
      status: 'pending',
      tags: [...new Set([...sourceTags, 'merged_source', `merged_into_${targetTicket.id}`])],
      comment: {
        body: `This ticket has been merged into #${targetTicket.id} as part of customer ticket consolidation. All conversation history has been copied to the target ticket.`,
        public: false
      }
    });
    // Then solve with required custom fields (Inquiry Type + Customer Phone Number)
    await zendesk.updateTicket(source.id, {
      status: 'solved',
      custom_fields: [
        { id: 44720831858075, value: 'non_user____test_ticket' },
        { id: 44720870291483, value: '0000000000' }
      ]
    });
  }

  console.log(`[REACTIVE] Merge complete. Target: #${targetTicket.id}, Sources: ${sourceTickets.map(t => t.id).join(', ')}, Issues: ${uniqueIssues.join(', ')}`);

  return {
    action: 'merged',
    target_ticket: targetTicket.id,
    source_tickets: sourceTickets.map(t => t.id),
    issues: issueThreads,
    unique_issues: uniqueIssues,
    priority: highestPriority,
    assignee: assignee
  };
}

// ─────────────────────────────────────────────
// ROUTE 3: Webhook — Reply to Merged Ticket
// POST /api/reactive/ticket-updated
// ─────────────────────────────────────────────

router.post('/ticket-updated', async (req, res) => {
  try {
    const { ticket_id } = req.body;

    if (!ticket_id) {
      return res.status(400).json({ error: 'ticket_id is required' });
    }

    const ticket = await zendesk.getTicket(ticket_id);
    const tags = zendesk.getTicketTags(ticket);

    // Edge Case 1: Reply to a merged (solved) source ticket
    if (tags.includes('merged_source')) {
      const mergedIntoTag = tags.find(t => t.startsWith('merged_into_'));
      if (mergedIntoTag) {
        const targetId = mergedIntoTag.replace('merged_into_', '');

        // Get the latest comment (the customer's reply)
        const comments = await zendesk.getTicketComments(ticket_id);
        const latestComment = comments[comments.length - 1];

        // Copy reply to active target ticket
        await zendesk.addInternalNote(targetId,
          `:warning: **Customer replied to merged ticket #${ticket_id}.**\nTheir message: "${latestComment?.body || '(empty)'}"\nThis has been redirected here from the closed source ticket.`
        );

        // Keep source ticket solved
        await zendesk.addInternalNote(ticket_id,
          `Customer reply redirected to active ticket #${targetId}.`
        );

        return res.json({
          action: 'redirected',
          source_ticket: ticket_id,
          target_ticket: targetId,
          message: 'Reply redirected to active consolidated ticket'
        });
      }
    }

    // Edge Case 7: Customer replies with gratitude/acknowledgement
    if (tags.includes('consolidated_ticket') || !tags.includes('merged_source')) {
      const comments = await zendesk.getTicketComments(ticket_id);
      const latestComment = comments[comments.length - 1];

      if (latestComment && latestComment.author_id === ticket.requester_id) {
        if (isGratitudeReply(latestComment.body)) {
          await zendesk.updateTicket(ticket_id, { status: 'pending' });
          await zendesk.addInternalNote(ticket_id,
            `Customer acknowledged with: "${latestComment.body}". Auto-set to pending. Will auto-solve in 24h if no further replies.`
          );

          return res.json({
            action: 'auto_pending',
            ticket_id,
            message: 'Gratitude reply detected. Ticket set to pending.'
          });
        }
      }
    }

    // Edge Case 2: New reply while agent is drafting on a consolidated ticket
    if (tags.includes('consolidated_ticket')) {
      const lockKey = String(ticket_id);
      if (agentLocks.has(lockKey)) {
        await zendesk.addInternalNote(ticket_id,
          `:warning: **NEW CUSTOMER REPLY arrived while you were working on this ticket!** Please review the latest comment before sending your response.`
        );

        return res.json({
          action: 'agent_notified',
          ticket_id,
          message: 'Agent working on ticket notified of new reply'
        });
      }
    }

    res.json({ action: 'none', ticket_id });

  } catch (error) {
    console.error('[REACTIVE] ticket-updated error:', error);
    res.status(500).json({ error: 'Failed to process ticket update', details: error.message });
  }
});

// ─────────────────────────────────────────────
// ROUTE 4: Outbound Communication Gate
// POST /api/reactive/outbound-gate
// ─────────────────────────────────────────────

router.post('/outbound-gate', async (req, res) => {
  try {
    const { ticket_id, requester_email, agent_response, override } = req.body;

    if (!ticket_id || !requester_email) {
      return res.status(400).json({ error: 'ticket_id and requester_email are required' });
    }

    const warnings = [];
    let allow = true;

    // Check 1: 15-minute per-customer window
    const recentComms = commsLog.getRecentComms(requester_email, 15);
    if (recentComms.length > 0 && !override) {
      const lastSent = recentComms[recentComms.length - 1];
      const minutesAgo = Math.round((Date.now() - new Date(lastSent.dispatched_at).getTime()) / 60000);
      warnings.push({
        type: '15min_window',
        message: `A response was sent to this customer ${minutesAgo} min ago. Wait ${15 - minutesAgo} more minutes or override.`,
        last_sent: lastSent.dispatched_at
      });
      allow = false;
    }

    // Check 2: Consolidated response verification
    const ticket = await zendesk.getTicket(ticket_id);
    const tags = zendesk.getTicketTags(ticket);

    if (tags.includes('consolidated_ticket') && agent_response) {
      const issueThreadTags = tags.filter(t => t.startsWith('issue_thread_'));
      const missedIssues = [];

      for (const tag of issueThreadTags) {
        const category = tag.split('_').slice(3).join('_'); // e.g. "esim" from "issue_thread_1_esim"
        const keywords = ISSUE_CATEGORIES[category] || [];
        const responseLower = agent_response.toLowerCase();
        const addressed = keywords.some(kw => responseLower.includes(kw));

        if (!addressed && category !== 'general') {
          missedIssues.push({ tag, category });
        }
      }

      if (missedIssues.length > 0) {
        warnings.push({
          type: 'missed_issues',
          message: `Your response may not address all customer issues.`,
          missed: missedIssues.map(i => i.category),
          issue_count: issueThreadTags.length,
          addressed_count: issueThreadTags.length - missedIssues.length
        });
      }
    }

    // Check 3: Proactive message collision
    const recentProactive = commsLog.getRecentProactiveComms(requester_email, 30);
    if (recentProactive.length > 0) {
      warnings.push({
        type: 'proactive_collision',
        message: `A proactive outreach was sent to this customer ${Math.round((Date.now() - new Date(recentProactive[0].dispatched_at).getTime()) / 60000)} min ago. Reference it in your response.`,
        proactive_details: recentProactive[0]
      });
      // Don't block — just warn
    }

    // Check 4: Channel saturation (24h count)
    const count24h = commsLog.get24hCount(requester_email);
    if (count24h >= 5 && !override) {
      warnings.push({
        type: 'saturation',
        message: `Customer has received ${count24h} messages in the last 24h (combined proactive+reactive cap is 5). Override required to send.`,
        count: count24h
      });
      allow = false;
    }

    // If allowed (or override), log the communication
    if (allow || override) {
      commsLog.logComms({
        recipient: requester_email,
        channel: 'email',
        source: 'agent_response',
        ticketId: ticket_id
      });
    }

    res.json({
      allow: allow || !!override,
      warnings,
      ticket_id,
      override_used: !!override
    });

  } catch (error) {
    console.error('[REACTIVE] outbound-gate error:', error);
    res.status(500).json({ error: 'Outbound gate check failed', details: error.message });
  }
});

// ─────────────────────────────────────────────
// ROUTE 5: Agent Lock Management
// POST /api/reactive/lock
// ─────────────────────────────────────────────

router.post('/lock', async (req, res) => {
  try {
    const { ticket_id, agent_id } = req.body;

    if (!ticket_id || !agent_id) {
      return res.status(400).json({ error: 'ticket_id and agent_id are required' });
    }

    const lockKey = String(ticket_id);
    const now = Date.now();

    if (agentLocks.has(lockKey)) {
      const existing = agentLocks.get(lockKey);
      const lockAge = (now - existing.locked_at) / 60000; // minutes

      if (lockAge < 30 && existing.agent_id !== agent_id) {
        return res.json({
          locked: false,
          message: `Ticket is being worked by agent ${existing.agent_id} (${Math.round(lockAge)} min ago). Coordinate before responding.`,
          locked_by: existing.agent_id,
          lock_age_minutes: Math.round(lockAge)
        });
      }
      // Stale lock or same agent — reassign
    }

    agentLocks.set(lockKey, { agent_id, locked_at: now });

    await zendesk.addInternalNote(ticket_id,
      `Ticket locked by agent ${agent_id} at ${new Date().toISOString()}.`
    );

    res.json({ locked: true, agent_id, ticket_id });

  } catch (error) {
    console.error('[REACTIVE] lock error:', error);
    res.status(500).json({ error: 'Lock failed', details: error.message });
  }
});

// ─────────────────────────────────────────────
// ROUTE 6: VIP Check
// POST /api/reactive/vip-check
// ─────────────────────────────────────────────

router.post('/vip-check', async (req, res) => {
  try {
    const { ticket_id } = req.body;

    if (!ticket_id) {
      return res.status(400).json({ error: 'ticket_id is required' });
    }

    const ticket = await zendesk.getTicket(ticket_id);
    const tags = zendesk.getTicketTags(ticket);
    const isVip = tags.some(t => ['vip', 'high_value', 'influencer'].includes(t));

    if (isVip) {
      // Ensure priority is at least HIGH
      if (!ticket.priority || ticket.priority === 'low' || ticket.priority === 'normal') {
        await zendesk.updateTicket(ticket_id, { priority: 'high' });
      }

      // Add VIP tags and guidance
      if (!tags.includes('vip_handling')) {
        await zendesk.updateTicket(ticket_id, {
          tags: [...new Set([...tags, 'vip_handling'])]
        });

        await zendesk.addInternalNote(ticket_id,
          `## VIP Customer Alert

This is a VIP customer. Apply enhanced handling:

- **Priority:** Automatically set to HIGH (minimum)
- **SLA:** Respond within 2 hours
- **Tone:** Executive-level empathy, acknowledge their loyalty
- **Authority:** You have retention authority — offer service credits up to $50 without L2 approval
- **Follow-up:** Schedule a personal follow-up within 24 hours after resolution
- **Escalation:** If unresolved within 4 hours, auto-escalate to L2 with VIP flag`
        );
      }

      return res.json({ is_vip: true, ticket_id, priority: 'high' });
    }

    res.json({ is_vip: false, ticket_id });

  } catch (error) {
    console.error('[REACTIVE] vip-check error:', error);
    res.status(500).json({ error: 'VIP check failed', details: error.message });
  }
});

// ─────────────────────────────────────────────
// ROUTE 7: Duplicate Detection
// POST /api/reactive/check-duplicate
// ─────────────────────────────────────────────

router.post('/check-duplicate', async (req, res) => {
  try {
    const { ticket_id, requester_email, subject } = req.body;

    if (!ticket_id || !requester_email) {
      return res.status(400).json({ error: 'ticket_id and requester_email required' });
    }

    const openTickets = await zendesk.searchTicketsByRequester(requester_email);
    const otherTickets = openTickets.filter(t => String(t.id) !== String(ticket_id));

    // Check for exact duplicate (same subject within 10 minutes)
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
    const duplicate = otherTickets.find(t => {
      const sameSubject = t.subject && subject &&
        t.subject.toLowerCase().trim() === subject.toLowerCase().trim();
      const recent = new Date(t.created_at) > tenMinAgo;
      return sameSubject && recent;
    });

    if (duplicate) {
      // Silently close the duplicate
      await zendesk.updateTicket(ticket_id, {
        status: 'solved',
        tags: ['silent_duplicate_close'],
        comment: {
          body: `Duplicate of #${duplicate.id} — same subject within 10 minutes. Silently closed.`,
          public: false
        }
      });

      return res.json({
        is_duplicate: true,
        closed_ticket: ticket_id,
        original_ticket: duplicate.id
      });
    }

    res.json({ is_duplicate: false, ticket_id });

  } catch (error) {
    console.error('[REACTIVE] check-duplicate error:', error);
    res.status(500).json({ error: 'Duplicate check failed', details: error.message });
  }
});

// ─────────────────────────────────────────────
// ROUTE 8: Status / Health
// GET /api/reactive/status
// ─────────────────────────────────────────────

router.get('/status', (req, res) => {
  res.json({
    status: 'ok',
    pending_merges: pendingMerges.size,
    active_locks: agentLocks.size,
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
