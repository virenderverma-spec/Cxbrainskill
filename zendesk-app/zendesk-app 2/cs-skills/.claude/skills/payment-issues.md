# Payment Issues

Diagnose and resolve payment failures, billing disputes, refund requests, and charge-related issues for Meow Mobile customers.

## Description

This skill handles payment and billing issues including failed transactions, duplicate charges, refund requests, subscription management, and payment method updates.

## Triggers

- "payment failed"
- "card declined"
- "charged twice"
- "duplicate charge"
- "refund"
- "billing issue"
- "can't pay"
- "payment not going through"
- "subscription charge"
- "cancel subscription"
- "update payment method"
- "wrong amount charged"

## Payment States Reference

| State | Meaning | Customer Impact | Action |
|-------|---------|-----------------|--------|
| `SUCCEEDED` | Payment completed | Service should be active | No action needed |
| `PENDING` | Processing | Temporary hold on card | Wait 1-2 hours |
| `FAILED` | Payment rejected | No service activated | Diagnose decline reason |
| `REFUNDED` | Money returned | Original charge reversed | Confirm receipt |
| `DISPUTED` | Chargeback initiated | Under investigation | Do not refund again |
| `REQUIRES_ACTION` | 3D Secure needed | Customer must verify | Guide through verification |

## Decline Codes Reference

| Code | Meaning | Customer Action | Agent Action |
|------|---------|-----------------|--------------|
| `insufficient_funds` | Not enough money | Add funds or use different card | Suggest alternative |
| `card_declined` | Generic decline | Contact bank or use different card | Offer alternatives |
| `expired_card` | Card expiration passed | Update card in app | Guide to payment settings |
| `incorrect_cvc` | Wrong security code | Re-enter card details | Have them retry |
| `processing_error` | Temporary system issue | Wait and retry | Retry in 15 min |
| `card_not_supported` | Card type not accepted | Use different card | Explain accepted cards |
| `currency_not_supported` | Non-USD card | Use USD card | Explain requirement |
| `fraudulent` | Bank flagged as fraud | Customer contacts bank | Do NOT retry |
| `lost_card` | Card reported lost | Use different card | Do not attempt |
| `stolen_card` | Card reported stolen | Use different card | Do not attempt |
| `do_not_honor` | Bank refused (no reason) | Contact bank | Suggest calling bank |

## Diagnostic Flow

### Step 1: Check Payment Status

```
Query: get_payment_status(customer_email)

Response includes:
- payments: Array of payment attempts
  - payment_id: Unique ID
  - amount: Charge amount in cents
  - currency: USD
  - status: SUCCEEDED/FAILED/PENDING/REFUNDED
  - decline_code: If failed, the reason
  - created_at: Timestamp
  - payment_method: Last 4 digits of card
  - description: What the charge was for
```

### Step 2: Identify the Issue Type

| Symptom | Issue Type | Go To |
|---------|------------|-------|
| Recent payment FAILED | Payment Decline | Section A |
| Multiple SUCCEEDED for same amount | Duplicate Charge | Section B |
| Customer wants money back | Refund Request | Section C |
| Customer can't add card | Payment Method Issue | Section D |
| Wrong amount charged | Billing Dispute | Section E |

---

## Section A: Payment Decline

### Diagnose the Decline

```
From get_payment_status response:
- decline_code: [code from table above]
- payment_method: ****[last4]
- attempted_at: [timestamp]
```

### Response by Decline Code

#### insufficient_funds
```
The payment of $[amount] didn't go through because the card didn't have enough available funds.

You can:
1. Add funds to your account and try again
2. Use a different payment method

To retry or add a new card:
1. Open the Meow Mobile app
2. Go to Settings > Payment Method
3. Either retry with your current card or add a new one
```

#### card_declined (generic)
```
Your bank declined the payment. This can happen for several reasons that the bank doesn't share with us.

I'd recommend:
1. **Check with your bank** - Call the number on your card to ask why it was declined
2. **Try a different card** - If you have another card, you can add it in the app

Sometimes banks flag new merchants. If you tell your bank you're trying to pay Meow Mobile, they may approve subsequent attempts.
```

#### expired_card
```
The card on file (ending in [last4]) has expired.

To update your payment method:
1. Open the Meow Mobile app
2. Go to Settings > Payment Method
3. Tap "Update Card"
4. Enter your new card details

Once updated, you can retry the payment.
```

#### fraudulent / lost_card / stolen_card
```
[INTERNAL NOTE]
Payment declined with fraud/lost/stolen flag. DO NOT retry this card.
Customer should use a different payment method.

[To customer:]
This card can't be used for this payment. Please add a different payment method in the app under Settings > Payment Method.

If you believe this is an error, please contact your bank directly.
```

#### do_not_honor
```
Your bank declined the payment without providing a specific reason ("do not honor").

This often happens when:
- Bank's fraud protection flagged the transaction
- Daily spending limit reached
- Card restrictions in place

Your best bet is to call your bank (number on back of card) and ask why they declined a payment to "Meow Mobile" or "Gather Inc."

After speaking with your bank, you can retry the payment in the app.
```

---

## Section B: Duplicate Charge

### Verify Duplicate

```
Check get_payment_status for:
- Multiple SUCCEEDED payments
- Same amount
- Within short timeframe (same day)
```

**If TRUE duplicate (system error):**
```
I see two charges of $[amount] on [date]. This was a system error and I apologize for the confusion.

I'm processing a refund for the duplicate charge right now. You should see it back on your card within 5-7 business days.

[Use tool: process_refund(payment_id, reason="duplicate_charge")]

Refund initiated for: $[amount]
Original transaction: [payment_id]
Expected return: 5-7 business days
```

**If NOT a duplicate (e.g., retry after failure, or separate purchases):**
```
I checked your payment history and here's what I found:

[Date/Time 1]: $[amount] - [description] - FAILED
[Date/Time 2]: $[amount] - [description] - SUCCEEDED

The first attempt failed, so the second was a retry that went through. The failed attempt may show as "pending" on your bank statement for a few days, but it will drop off automatically (it wasn't actually charged).

If you still see both as completed charges after 5 business days, let me know and I'll investigate further.
```

### Common "Duplicate" Scenarios

| Scenario | Explanation | Action |
|----------|-------------|--------|
| Pending + Succeeded | First was pending, second is actual charge | Pending will drop off |
| Failed + Succeeded | First failed, second is successful retry | Only one charge |
| Two on same day | Could be waitlist + first month | Verify charges are for different things |
| Monthly + one-time | Subscription + add-on purchase | Explain both charges |

---

## Section C: Refund Request

### Refund Eligibility

| Situation | Eligible | Process |
|-----------|----------|---------|
| Duplicate charge | Yes | Immediate refund |
| Service never activated | Yes | Full refund |
| Within 7 days, no usage | Yes | Full refund |
| Cancellation request | Yes | Pro-rated refund |
| Service issues (outage) | Case by case | Credit or partial refund |
| "Changed my mind" after using | No | Explain policy |
| Chargeback already filed | No | Cannot double-refund |

### Processing a Refund

```
Verify eligibility, then:

Use tool: process_refund(payment_id, amount, reason)

Parameters:
- payment_id: The specific payment to refund
- amount: Full amount or partial (in cents)
- reason: "duplicate_charge" | "service_not_activated" | "customer_request" | "service_issue"
```

**Response after refund:**
```
I've processed your refund:

Amount: $[amount]
Original charge date: [date]
Refund initiated: [today]
Expected return: 5-7 business days

The refund will appear on your [card ending in last4]. Bank processing times vary, so if you don't see it after 7 business days, let me know.
```

### Cannot Refund - Chargeback

```
[INTERNAL NOTE]
Customer has an active dispute/chargeback on this payment. DO NOT process refund - it would result in double-refund.

[To customer:]
I see this charge is currently being disputed with your bank. Since the bank is handling this, I can't process a separate refund.

If the dispute is resolved in your favor, you'll get the money back through your bank. If it's resolved in our favor and you still want a refund, please reach out and we can help then.
```

---

## Section D: Payment Method Issues

### Can't Add Card

```
Troubleshooting steps:

1. **Card type**: We accept Visa, Mastercard, American Express, and Discover. We don't accept prepaid gift cards or some international cards.

2. **Billing address**: Make sure the billing ZIP code matches what's on file with your bank exactly.

3. **Card status**: Confirm the card isn't expired, frozen, or reported lost/stolen.

4. **3D Secure**: Some cards require additional verification. Look for a popup or redirect to your bank's site.

If none of these help, try a different card or contact your bank to ensure there are no blocks on online purchases.
```

### Updating Payment Method

```
To update your payment method:

1. Open the Meow Mobile app
2. Tap the profile icon (bottom right)
3. Go to Settings > Payment Method
4. Tap "Update" or "Add New Card"
5. Enter your new card details
6. Tap "Save"

Your next bill will automatically charge the new card.
```

---

## Section E: Billing Disputes

### Wrong Amount Charged

**First, verify what they were charged for:**
```
Query: get_payment_status(customer_email)

Check payment description and amount against pricing:
- Waitlist fee: $0.50
- First month (promo): $0.00 or discounted
- Monthly subscription: $45/month (unlimited plan)
- Add-ons: Varies
```

**If charge is correct but customer confused:**
```
I checked your charges and here's the breakdown:

[Date]: $0.50 - Waitlist reservation fee
[Date]: $45.00 - First month of Meow Mobile Unlimited

The waitlist fee was to hold your spot before launch. The $45 is your first full month of service (unlimited talk, text, and data).

Does this match what you were expecting? Let me know if anything looks off.
```

**If charge is actually wrong:**
```
You're right - that charge doesn't look correct. Let me fix this.

[Process refund or credit as appropriate]

I've [refunded/credited] $[amount] to your account. You should see it within 5-7 business days.

I'm also flagging this to our billing team so it doesn't happen again. Sorry for the confusion!
```

---

## Waitlist Fee Specifics

The $0.50 waitlist fee is a common source of confusion:

```
The $0.50 charge from [date] was the waitlist reservation fee. Here's how it worked:

- When you joined the waitlist, we charged $0.50 to hold your spot
- This confirms you're a real person (reduces bots/spam)
- The $0.50 is NOT applied to your first bill (it's a separate hold fee)

If you didn't end up signing up for Meow Mobile and want this refunded, I can do that for you. Just let me know!
```

## Subscription Management

### Cancel Subscription

```
Query: get_subscription_status(customer_email)

Check:
- subscription_status: ACTIVE/CANCELLED/PAUSED
- next_billing_date: When next charge would occur
- billing_cycle_end: When current paid period ends
```

**Processing cancellation:**
```
I can help you cancel your subscription.

Before I do, here's what to know:
- Your service will continue until [billing_cycle_end]
- You won't be charged again after cancellation
- Your phone number [will/won't] be released (depending on if ported)

If you'd like to keep your number, you'll want to port it to a new carrier before your service ends.

Should I proceed with the cancellation?

[If confirmed:]
Use tool: cancel_subscription(customer_email, reason)
```

---

## Escalation Triggers

Escalate to L2 if:

1. **Refund >$100** - Requires manager approval
2. **Repeated payment failures** with no clear decline reason
3. **Chargeback dispute** needing documentation
4. **Suspected fraud** - Customer didn't authorize charge
5. **System error** causing widespread billing issues
6. **Pro-rated refund calculation** - Complex billing math

**Escalation template:**
```
[INTERNAL NOTE]
Escalating: Billing/payment issue

Customer: [email]
Issue: [brief description]
Amount in question: $[amount]

Payment history:
- [Date]: $[amount] - [status]
- [Date]: $[amount] - [status]

Customer's ask: [what they want]
Recommended resolution: [your recommendation]

Needs L2 for: [reason - approval/investigation/dispute response]
```

## Parameters

- `customer_email`: Required - Customer's email
- `payment_id`: Optional - Specific payment to investigate
- `include_all_history`: Default false - Include all historical payments
- `date_range`: Optional - Filter payments by date

## Example Usage

```
Agent: "Customer says they were charged twice for $45"

LLM:
1. get_payment_status → Shows one FAILED, one SUCCEEDED for $45
2. Diagnosis: First was declined, second succeeded. Not a true duplicate.
3. Explains that failed charge will drop off statement
4. Offers to monitor and follow up if issue persists
```

```
Agent: "Customer wants a refund, service never worked"

LLM:
1. get_payment_status → $45 SUCCEEDED
2. get_esim_status → PENDING (never installed)
3. Diagnosis: Customer paid but never activated
4. Confirms refund eligibility
5. Processes refund with reason "service_not_activated"
6. Provides expected timeline for refund
```
