import { NextResponse } from 'next/server';

const ZENDESK_SUBDOMAIN = process.env.ZENDESK_SUBDOMAIN;
const ZENDESK_EMAIL = process.env.ZENDESK_EMAIL;
const ZENDESK_API_TOKEN = process.env.ZENDESK_API_TOKEN;
const ZENDESK_AUTH = Buffer.from(`${ZENDESK_EMAIL}/token:${ZENDESK_API_TOKEN}`).toString('base64');

// Internal test email — used when testMode is true
const TEST_EMAIL = ZENDESK_EMAIL;

// --- Message templates per stuck stage ---

function buildSubject(stuckStage, customerName) {
  const firstName = (customerName || 'there').split(' ')[0];
  switch (stuckStage) {
    case 'order_created':
      return `${firstName}, we noticed your Meow Mobile order needs attention`;
    case 'payment':
      return `${firstName}, let's get your Meow Mobile payment sorted`;
    case 'number_selection':
      return `${firstName}, your number transfer is in progress`;
    case 'esim_activation':
      return `${firstName}, we're working on your eSIM activation`;
    case 'nw_enabled':
      return `${firstName}, let's get your network up and running`;
    case 'airvet_account':
      return `${firstName}, one last step — setting up your Airvet account`;
    default:
      return `${firstName}, an update on your Meow Mobile setup`;
  }
}

function buildMessage(customer) {
  const firstName = (customer.name || 'there').split(' ')[0];
  const stuckStage = customer.stuckAt;
  const stuckHours = Math.round(customer.stuckHours || 0);
  const stuckDays = Math.floor(stuckHours / 24);
  const durationText = stuckDays > 0 ? `${stuckDays} day${stuckDays > 1 ? 's' : ''}` : `${stuckHours} hours`;

  let issueDetail = '';
  let whatWeAreDoing = '';
  let customerAction = '';

  switch (stuckStage) {
    case 'order_created':
      issueDetail = `We noticed your order was created ${durationText} ago but hasn't moved to the next step yet.`;
      whatWeAreDoing = `Our team is reviewing your order to make sure everything is in order. We want to ensure there are no blockers preventing your setup from moving forward.`;
      customerAction = `You don't need to do anything right now. If you'd like to continue your setup, you can open the Meow Mobile app and pick up where you left off. If you're having trouble, just reply to this email and we'll help you out.`;
      break;
    case 'payment':
      issueDetail = `We see that your payment step hasn't completed yet — it's been about ${durationText} since you started your setup.`;
      whatWeAreDoing = `We're checking to make sure there are no issues on our end with the payment process. Sometimes a card update or a simple retry is all that's needed.`;
      customerAction = `If your payment didn't go through, you can try again in the Meow Mobile app. Make sure your card details are up to date. If you're seeing any errors, reply to this email and we'll sort it out for you.`;
      break;
    case 'number_selection':
      issueDetail = `Your number selection or port-in request has been pending for about ${durationText}.`;
      if (customer.portinStatus === 'CONFLICT' || (customer.issueTags || []).includes('MNP Conflict')) {
        whatWeAreDoing = `We've detected a conflict with your number transfer. This usually means we need some additional information from your previous carrier. Our team is already looking into this.`;
        customerAction = `To help speed things up, please make sure you have your account number and PIN from your previous carrier ready. Reply to this email and we'll walk you through the next steps.`;
      } else {
        whatWeAreDoing = `Number transfers can sometimes take a bit of time depending on your previous carrier. We're monitoring the status and will let you know as soon as it's complete.`;
        customerAction = `If you haven't started a number transfer and just need a new number, you can select one in the Meow Mobile app. Otherwise, sit tight — we're on it.`;
      }
      break;
    case 'esim_activation':
      if (customer.esimStatus === 'ERROR' || (customer.issueTags || []).includes('eSIM Failed')) {
        issueDetail = `We detected an issue with your eSIM activation — it looks like there was an error during the setup process.`;
        whatWeAreDoing = `Our technical team has been notified and is working on resolving this. We may need to re-issue your eSIM QR code.`;
        customerAction = `You don't need to do anything yet. We'll send you a new QR code if needed, along with step-by-step instructions to install it. If you'd like to get this resolved faster, reply to this email.`;
      } else if (customer.onboardingStatus === 'IMEI_CHECKING') {
        issueDetail = `Your device compatibility check has been pending for about ${durationText}.`;
        whatWeAreDoing = `We're verifying that your device supports eSIM technology. Most modern smartphones do, but some models or carrier-locked devices may have limitations.`;
        customerAction = `If you're unsure whether your phone supports eSIM, check your device settings or reply to this email with your phone model and we'll confirm right away.`;
      } else {
        issueDetail = `Your eSIM activation has been in progress for about ${durationText}.`;
        whatWeAreDoing = `We're checking the activation status to make sure everything is proceeding as expected. Sometimes eSIM activation needs a manual push from our side.`;
        customerAction = `If you received a QR code but haven't installed it yet, open your phone's Settings > Cellular > Add eSIM and scan the QR code. If you need help, reply to this email.`;
      }
      break;
    case 'nw_enabled':
      issueDetail = `It looks like your eSIM is installed but your network connection isn't fully active yet.`;
      whatWeAreDoing = `We're investigating why the network hasn't come online. This could be a provisioning delay or a settings issue that we can fix quickly.`;
      customerAction = `Try restarting your phone and make sure your Meow Mobile eSIM is set as the primary line. If calls and data still aren't working, reply here and we'll troubleshoot with you.`;
      break;
    case 'airvet_account':
      issueDetail = `You're almost there! Your Meow Mobile service is active, but your Airvet pet care account hasn't been set up yet.`;
      whatWeAreDoing = `We're checking the Airvet integration to make sure your account can be created. This is the final step to unlock your free vet care benefit.`;
      customerAction = `Open the Meow Mobile app and follow the prompts to register your pet with Airvet. If you're having trouble or the option isn't showing up, reply to this email and we'll get it sorted.`;
      break;
    default:
      issueDetail = `We noticed your Meow Mobile setup hasn't completed yet — it's been about ${durationText}.`;
      whatWeAreDoing = `Our team is reviewing your account to identify any blockers and get things moving.`;
      customerAction = `Open the Meow Mobile app to continue your setup, or reply to this email if you need any help.`;
  }

  return `Hi ${firstName},

${issueDetail}

**What we're doing:**
${whatWeAreDoing}

**What you can do:**
${customerAction}

We're committed to making your Meow Mobile experience great. If you have any questions at all, just reply to this email and a member of our team will be happy to help.

Warm regards,
Meow Mobile Support Team`;
}

// --- API Handler ---

export async function POST(request) {
  try {
    const body = await request.json();
    const { customer, testMode = true, subject: customSubject, message: customMessage } = body;

    if (!customer || !customer.email) {
      return NextResponse.json({ error: 'Customer email is required' }, { status: 400 });
    }

    // In test mode, send to internal email instead of customer
    const requesterEmail = testMode ? TEST_EMAIL : customer.email;
    const requesterName = testMode ? `[TEST] ${customer.name || 'Test Customer'}` : (customer.name || 'Customer');

    // Use edited subject/message if provided, otherwise generate defaults
    const subject = customSubject || buildSubject(customer.stuckAt, customer.name);
    const message = customMessage || buildMessage(customer);

    // Add test mode banner to message
    const finalMessage = testMode
      ? `--- TEST MODE — Original recipient: ${customer.email} ---\n\n${message}`
      : message;

    // Create ticket via Zendesk API
    const ticketPayload = {
      ticket: {
        subject,
        comment: { body: finalMessage, public: false, suppress_notifications: true },
        requester: { name: requesterName, email: requesterEmail },
        tags: ['proactive_outreach', 'internal_ticket_created', `stuck_${customer.stuckAt || 'unknown'}`],
        priority: 'normal',
        status: 'open',
      },
    };

    const res = await fetch(
      `https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/tickets.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${ZENDESK_AUTH}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(ticketPayload),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error('Zendesk ticket creation failed:', errText);
      return NextResponse.json({ error: `Zendesk API error: ${res.status}` }, { status: 502 });
    }

    const data = await res.json();
    const ticketId = data.ticket?.id;

    return NextResponse.json({
      success: true,
      ticketId,
      ticketUrl: `https://${ZENDESK_SUBDOMAIN}.zendesk.com/agent/tickets/${ticketId}`,
      testMode,
      requesterEmail,
      subject,
    });
  } catch (err) {
    console.error('Proactive outreach error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
