# Script: Generate External Communications

Build customer-facing messages for email, SMS, and push notification channels.

---

## Input

```json
{
  "signal_type": "SIG-002",
  "severity": "CRITICAL",
  "customer_data": { "email": "...", "name": "Jane", "order": {...}, "touches": 7 },
  "channel": "email"
}
```

## Output

Personalized message body ready for dispatch. Apply tone-guide.md rules before finalizing.

---

## Email Templates by Signal Type

### SIG-001: eSIM Stuck in PENDING (>48h)

**Subject:** Your Meow Mobile eSIM is ready to install

**Body:**
```
Hi {{customer_name}},

We noticed you completed your payment {{days_since_payment}} days ago but haven't installed your eSIM yet. Your eSIM profile is ready and waiting!

Here's how to get set up (takes about 2 minutes):

1. Open Settings on your phone
2. Tap Cellular (iPhone) or Network & Internet (Android)
3. Tap "Add eSIM" or "Add Cellular Plan"
4. Scan the QR code from your confirmation email

If you can't find your QR code, just reply to this email and we'll resend it right away.

Need help? We're here — just reply or chat with us in the Meow Mobile app.

Best,
{{agent_name}}
Meow Mobile Support
```

### SIG-002: eSIM Provisioning FAILED

**Subject:** Action needed: We're fixing your eSIM activation

**Body:**
```
Hi {{customer_name}},

We detected a technical issue with your eSIM activation and our team is already on it.

Here's what happened: Your payment was processed successfully, but the eSIM profile hit an error on our end. This isn't anything you did wrong.

What we're doing: We're generating a fresh eSIM profile for you right now. You'll receive a new QR code at this email within {{resolution_eta}}.

What you'll need to do: Once you get the new QR code, scan it to install your eSIM. We'll include step-by-step instructions.

We'll follow up to make sure everything is working. Sorry for the hiccup!

Best,
{{agent_name}}
Meow Mobile Support
```

### SIG-003: Payment Failed

**Subject:** Quick update on your Meow Mobile order

**Body:**
```
Hi {{customer_name}},

We noticed your recent payment for Meow Mobile didn't go through. This sometimes happens with bank security checks — it's usually an easy fix.

Here are a few things to try:
- Make sure your card details are up to date in the app
- Try a different payment method
- Check with your bank that they're not blocking "Meow Mobile" or "Gather Inc."

You can retry your payment in the Meow Mobile app: Settings > Payment Method.

If you're still having trouble, just reply here and we'll help sort it out.

Best,
Meow Mobile Support
```

### SIG-004: Port-in Rejected

**Subject:** Your number transfer needs a quick update

**Body:**
```
Hi {{customer_name}},

We tried to transfer your phone number ({{masked_phone}}) to Meow Mobile, but {{carrier_name}} flagged an issue. This is common and usually fixable.

The most likely causes:
- Account number or PIN doesn't match their records
- Your old account has a port-out block
- The name on file doesn't match exactly

To fix this:
1. Contact {{carrier_name}} and verify your account number and transfer PIN
2. Ask them to remove any port-out restrictions
3. Reply to this email with the confirmed details

Once we have the right info, the transfer usually completes within 24-48 hours.

We're here to help if you need anything!

Best,
{{agent_name}}
Meow Mobile Support
```

### SIG-005: Port-in Stalled >72h

**Subject:** Update on your number transfer

**Body:**
```
Hi {{customer_name}},

We wanted to give you an update on your number transfer to Meow Mobile. It's taking longer than expected — we've been waiting on {{carrier_name}} to process the request.

What's happening: Your transfer request is with {{carrier_name}} and we're actively monitoring it. Sometimes carriers take extra time, especially on weekends or holidays.

What we're doing: We've escalated this on our end to speed things up. You don't need to do anything right now.

We'll update you as soon as the transfer completes. If you haven't heard from us in 48 hours, reply to this email and we'll dig deeper.

Best,
{{agent_name}}
Meow Mobile Support
```

### SIG-007: Mochi Escalation Abandoned

**Subject:** Following up on your chat with us

**Body:**
```
Hi {{customer_name}},

I noticed you were chatting with our support bot earlier and we didn't get a chance to fully resolve your issue.

I've reviewed your conversation and here's what I can see: {{mochi_issue_summary}}.

{{#if actionable}}
I've gone ahead and {{action_taken}}. Here's what I'd recommend: {{next_step}}.
{{else}}
To help get this sorted, could you reply with {{info_needed}}?
{{/if}}

Either way, you have a real human on this now. I'll make sure it gets resolved.

Best,
{{agent_name}}
Meow Mobile Support
```

### SIG-008: Repeat Contact (3+ touches)

**Subject:** Re: Your ongoing issue — I'm taking ownership

**Body:**
```
Hi {{customer_name}},

I can see you've reached out {{touch_count}} times about this issue, and I want to sincerely apologize that it's taken this long. That's not the experience you should have with us.

Here's what I know:
- {{issue_summary}}
- {{what_tried_so_far}}
- {{current_status}}

I'm personally taking ownership of your case. Here's my plan:
1. {{immediate_action}}
2. {{next_step_with_timeline}}
3. {{follow_up_commitment}}

You won't need to explain this again to anyone else. I'll see it through to resolution and check in with you {{specific_follow_up_time}}.

Thank you for your patience, {{customer_name}}.

Best,
{{agent_name}}
Meow Mobile Support
```

### SIG-009: Silent Churn Risk

**Subject:** Need help setting up your Meow Mobile?

**Body:**
```
Hi {{customer_name}},

Welcome to Meow Mobile! I noticed you signed up {{days_since_payment}} days ago but haven't activated your eSIM yet. Wanted to check in and see if you need any help getting started.

Setting up takes about 2 minutes:
1. Check your email for the QR code we sent on {{qr_sent_date}}
2. On your phone: Settings > Cellular > Add eSIM > Scan QR code
3. That's it! Your Meow Mobile line will appear in about 30 seconds

If you're having trouble or have questions, just reply to this email. Happy to walk you through it.

Looking forward to getting you connected!

Best,
Meow Mobile Support
```

### SIG-010: Network Outage Impact

**Subject:** Service alert for your area

**Body:**
```
Hi {{customer_name}},

We're aware of a service disruption in your area that may be affecting your Meow Mobile service. Our network team is actively working to restore full coverage.

What we know:
- Area affected: {{affected_region}}
- Started: {{outage_start_time}}
- Estimated restoration: {{restoration_eta}}
- Impact: {{impact_description}}

What you can try in the meantime:
- Toggle Airplane Mode on and off
- If urgent, connect to WiFi for WiFi Calling

We'll send another update when service is fully restored. No need to contact us — we're on it.

Sorry for the inconvenience!

Meow Mobile Support
```

### Pet Care Alert (Airvet)

**Subject:** Update on your pet's upcoming appointment

**Body:**
```
Hi {{customer_name}},

We noticed an issue with your upcoming Airvet appointment{{#if pet_name}} for {{pet_name}}{{/if}} on {{airvet_appointment_date}}. We've flagged this with the Airvet team and they're working to confirm your slot.

We'll update you within {{resolution_eta}}. If you need immediate help, you can reach Airvet directly through the Meow Mobile app under Pet Care.

Your pet's care is important to us — we'll make sure this gets sorted.

Best,
{{agent_name}}
Meow Mobile Support
```

---

## SMS Templates

160-character limit. Include link shortener for any URLs. Always end with `- Meow Mobile`.

| Signal | SMS Text |
|---|---|
| SIG-001 | `Your Meow Mobile eSIM is ready to install! Open Settings > Cellular > Add eSIM and scan your QR code. Need help? Reply HELP - Meow Mobile` |
| SIG-002 | `Meow Mobile: We detected an issue with your eSIM and are fixing it now. Check your email for details. - Meow Mobile` |
| SIG-004 | `Meow Mobile: Your number transfer needs updated info from {{carrier_name}}. Check your email for steps. - Meow Mobile` |
| SIG-010 | `Meow Mobile: Service disruption in your area. Our team is on it. Try toggling Airplane Mode. Updates at {{status_link}} - Meow Mobile` |
| Pet care | `Meow Mobile: Issue with your Airvet appointment on {{date}}. We're sorting it out — check email for details. - Meow Mobile` |

---

## Push Notification Templates

Short title + body. Include deep_link to relevant app screen.

| Signal | Title | Body | Deep Link |
|---|---|---|---|
| SIG-001 | Your eSIM is ready | Tap to install your Meow Mobile eSIM | `meow://esim/install` |
| SIG-002 | eSIM update | We're fixing an issue with your eSIM. Check details. | `meow://support/ticket/{{ticket_id}}` |
| SIG-009 | Get connected | Your Meow Mobile eSIM is waiting to be installed. | `meow://esim/install` |
| SIG-010 | Service alert | Service disruption in your area. We're working on it. | `meow://status` |
| Pet care | Airvet appointment update | Issue with your upcoming appointment. Tap for details. | `meow://petcare/appointments` |

---

## Merged Signal Template {#merged-signals}

When multiple signals fire for the same customer within 15 minutes, combine into one message.

**Subject:** Update on your Meow Mobile account

**Body:**
```
Hi {{customer_name}},

We're reaching out because we've identified a couple of things on your account that need attention:

{{#each signals}}
**{{signal_label}}**
{{plain_language_description}}

{{/each}}

Here's what we're doing:
{{#each signals}}
- {{action_being_taken}}
{{/each}}

{{#if customer_action_needed}}
What we need from you:
{{customer_action_steps}}
{{/if}}

We'll keep you updated. If you have questions, just reply to this email.

Best,
{{agent_name}}
Meow Mobile Support
```
