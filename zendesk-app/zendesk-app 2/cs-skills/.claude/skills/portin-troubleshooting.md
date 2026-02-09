# Port-In Troubleshooting

Diagnose and resolve number porting issues when customers transfer their phone number from another carrier to Meow Mobile.

## Description

This skill handles port-in requests where customers want to keep their existing phone number. Port-ins involve coordination with the customer's previous carrier and can fail for various reasons including incorrect account information, carrier blocks, or timing issues.

## Triggers

- "port-in failed"
- "transfer my number"
- "keep my old number"
- "number not ported"
- "port request rejected"
- "number still with old carrier"
- "porting taking too long"
- "wrong number ported"
- "can't port my number"
- "port-in stuck"

## Port-In States Reference

| State | Meaning | Typical Duration | Action |
|-------|---------|------------------|--------|
| `NOT_STARTED` | No port request submitted | - | Collect required info |
| `SUBMITTED` | Request sent to carrier | 0-4 hours | Wait |
| `PENDING_CARRIER` | Waiting for old carrier response | 4-24 hours | Wait, monitor |
| `FOC_RECEIVED` | Old carrier approved, date set | Until FOC date | Inform customer of date |
| `IN_PROGRESS` | Number being transferred | 15-60 min | Wait |
| `COMPLETED` | Port successful | - | Verify service |
| `REJECTED` | Carrier rejected request | - | Fix and resubmit |
| `CANCELLED` | Port cancelled | - | Determine next steps |

## Required Information for Port-In

Before a port-in can succeed, we need:

| Field | Description | Where Customer Finds It |
|-------|-------------|------------------------|
| **Phone Number** | The number to transfer | Their current phone |
| **Account Number** | Account # with old carrier | Bill or carrier app/website |
| **PIN/Passcode** | Security PIN on the account | Set when account created, or call carrier |
| **Billing ZIP Code** | ZIP on file with old carrier | Bill or carrier account |
| **Account Holder Name** | Name on the account | Must match exactly |

## Diagnostic Flow

### Step 1: Check Port-In Status

```
Query: get_portin_status(customer_email)

Response includes:
- port_state: Current state (see table above)
- phone_number: Number being ported
- old_carrier: Previous carrier name
- submitted_at: When port was requested
- foc_date: Firm Order Commitment date (when port will complete)
- rejection_reason: If rejected, the reason code
- rejection_details: Human-readable rejection message
```

### Step 2: Branch by State

#### If `NOT_STARTED`:

**Diagnosis:** Customer hasn't submitted port request yet.

**Action:** Guide them to submit in the app:
```
To transfer your number to Meow Mobile:

1. Open the Meow Mobile app
2. Go to Settings > Phone Number
3. Tap "Transfer My Number"
4. Enter your current phone number
5. Enter your account details from [Old Carrier]

You'll need:
- Account Number (from your bill)
- Account PIN (the security PIN, not your phone passcode)
- Billing ZIP code

Once submitted, the transfer usually takes 1-3 business days.
```

---

#### If `SUBMITTED` or `PENDING_CARRIER`:

**Diagnosis:** Port in progress, waiting for old carrier.

**Check:** How long has it been?
- <24 hours: Normal, wait
- 24-48 hours: Slightly delayed, may need carrier follow-up
- >48 hours: Likely stuck, investigate

**Response if <24 hours:**
```
Your number transfer is in progress! Here's the status:

Request submitted: [timestamp]
Current status: Waiting for [Old Carrier] to release your number

This typically takes 1-3 business days. You'll get a notification when it's complete.

In the meantime, your old carrier service will continue working normally. Once the port completes, your service will switch to Meow Mobile automatically.
```

**Response if >48 hours:**
```
I see your port request has been pending for [X days]. Let me check if there's an issue.

[Check rejection_reason - if found, follow rejection flow below]

If no rejection reason visible, escalate:
[INTERNAL NOTE]
Port-in stuck >48 hours without rejection. Need ConnectX investigation.
Customer: [email]
Phone: [number]
Old Carrier: [carrier]
Submitted: [timestamp]
```

---

#### If `FOC_RECEIVED`:

**Diagnosis:** Old carrier approved! Port has a scheduled completion date.

**Response:**
```
Great news! [Old Carrier] has approved your number transfer.

Scheduled completion: [FOC_DATE]

On that date (usually early morning), your service will switch to Meow Mobile. You might experience a brief interruption (a few minutes to an hour) during the switch.

Tips:
- Keep your old carrier service active until the port completes
- Don't cancel your old account early - it can cause the port to fail
- Make sure your Meow Mobile eSIM is already installed and ready
```

---

#### If `IN_PROGRESS`:

**Diagnosis:** Port is actively happening right now.

**Response:**
```
Your number is being transferred right now! This usually takes 15-60 minutes.

During this time:
- You might briefly lose service on both old and new carriers
- Don't restart your phone unless prompted
- Stay in an area with good signal

Once complete, you'll see "Meow" as your carrier and your old number will work on Meow Mobile.
```

---

#### If `COMPLETED`:

**Diagnosis:** Port finished successfully.

**Check:** Is customer still having issues?
- If can't make calls → check eSIM status, network connectivity
- If getting calls on old carrier → port may not be fully propagated (wait 24h)

**Response:**
```
Your number transfer is complete! [Phone Number] is now on Meow Mobile.

If you're still seeing your old carrier in your phone:
1. Restart your phone
2. Wait a few minutes for the network to update

If calls are still going to your old carrier, this can take up to 24 hours to fully propagate across all networks.
```

---

#### If `REJECTED`:

**Diagnosis:** Old carrier rejected the port request.

**Check rejection_reason and follow the specific resolution:**

### Rejection Reason Codes

| Code | Meaning | Resolution |
|------|---------|------------|
| `INVALID_ACCOUNT_NUMBER` | Account number doesn't match | Collect correct account number |
| `INVALID_PIN` | PIN/passcode is wrong | Collect correct PIN |
| `INVALID_ZIP` | Billing ZIP doesn't match | Collect correct ZIP |
| `NAME_MISMATCH` | Account holder name differs | Verify exact name on account |
| `ACCOUNT_SUSPENDED` | Old account is suspended | Customer must resolve with old carrier |
| `OUTSTANDING_BALANCE` | Old account has unpaid balance | Customer must pay balance first |
| `BUSINESS_ACCOUNT` | Port from business account | Different process, may need LOA |
| `NUMBER_NOT_PORTABLE` | Number can't be ported (landline, VoIP) | Explain limitation |
| `CARRIER_FREEZE` | Number freeze/lock active | Customer must remove freeze |
| `PENDING_PORT` | Number already being ported elsewhere | Cancel other port first |

---

### Resolution by Rejection Type

#### INVALID_ACCOUNT_NUMBER

```
The port was rejected because the account number didn't match [Old Carrier]'s records.

Can you double-check your account number? You can find it:
- On your monthly bill (usually top right)
- In the [Old Carrier] app under Account Details
- By calling [Old Carrier] customer service

Common mistakes:
- Using phone number instead of account number
- Missing leading zeros
- Using a sub-account number instead of main account

Once you have the correct account number, reply here and I'll resubmit the request.
```

#### INVALID_PIN

```
The port was rejected because the PIN/passcode didn't match.

This is the security PIN on your [Old Carrier] account - not your phone's unlock code or voicemail PIN.

To find or reset your PIN:
1. Log into [Old Carrier] website/app
2. Go to Account Security settings
3. Look for "Account PIN" or "Transfer PIN"

Or call [Old Carrier] at [carrier phone number] and ask them to verify or reset your account PIN.

Once you have the correct PIN, let me know and I'll resubmit.
```

#### OUTSTANDING_BALANCE

```
[Old Carrier] rejected the port because there's an outstanding balance on your account.

You'll need to pay off the balance before we can transfer your number. You can:
1. Log into [Old Carrier] and make a payment
2. Call [Old Carrier] billing department

Once the balance is paid (give it 24 hours to update in their system), let me know and I'll resubmit the port request.
```

#### CARRIER_FREEZE / NUMBER_FREEZE

```
Your number has a "port freeze" or "number lock" enabled with [Old Carrier]. This is a security feature that prevents unauthorized transfers.

To remove the freeze:
1. Log into your [Old Carrier] account
2. Look for "Number Lock" or "Port Protection" in settings
3. Disable it (you may need to verify your identity)

Or call [Old Carrier] and ask them to remove the port freeze.

Once removed, let me know and I'll resubmit. The freeze removal is usually instant.
```

#### NAME_MISMATCH

```
The port was rejected because the account holder name doesn't match exactly.

The name on your Meow Mobile account: [Name]
The name must match your [Old Carrier] account exactly (including middle names, suffixes, etc.)

Can you verify the exact name on your [Old Carrier] account?

If they're different, you have two options:
1. Update your Meow Mobile profile to match your [Old Carrier] account
2. Update your [Old Carrier] account to match Meow Mobile

Let me know which you'd prefer, or if the names should already match and this seems like an error.
```

#### BUSINESS_ACCOUNT

```
Your number is on a business account with [Old Carrier], which requires additional authorization to port.

For business account ports, we need:
1. A Letter of Authorization (LOA) signed by an authorized account holder
2. Business account number
3. Business tax ID (EIN) or the last 4 of SSN of authorized person

I can send you the LOA form to fill out. Would you like me to do that?

Alternatively, if this is actually a personal account that's miscategorized, you may need to contact [Old Carrier] to correct it.
```

---

### Resubmitting a Port Request

After collecting corrected information:

```
Use tool: resubmit_port_request(customer_email, {
  account_number: "[corrected_value]",
  pin: "[corrected_value]",
  zip_code: "[corrected_value]",
  account_holder_name: "[corrected_value]"
})
```

**Response after resubmit:**
```
I've resubmitted your port request with the updated information.

New request submitted: [timestamp]
Expected completion: 1-3 business days

I'll keep an eye on it and let you know if there are any issues. Your [Old Carrier] service will continue working until the port completes.
```

## Carrier-Specific Notes

### AT&T
- Account number is NOT the phone number (10+ digits)
- PIN is 4-8 digits, set at account creation
- May require logging into att.com to find account number
- Prepaid accounts have different account numbers than postpaid

### Verizon
- Account number can be found in My Verizon app
- PIN is 4 digits
- "Number Lock" feature must be disabled first
- Customer may need to request "Number Transfer PIN" which is different from account PIN

### T-Mobile
- Account number on bill or in app
- PIN is 6-15 characters
- "Port Validation" feature may be enabled (acts as freeze)

### Smaller Carriers/MVNOs
- Account structures vary widely
- May need to contact carrier directly for account number
- Some prepaid carriers don't support outbound porting (rare)

## Escalation Triggers

Escalate to L2 if:

1. **Port stuck >5 business days** with no rejection
2. **Repeated rejections** (3+) despite correct information
3. **Carrier not responding** to port request
4. **Wrong number ported** - urgent, may affect another customer
5. **Customer losing service** on both old and new carriers
6. **Business account** requiring LOA processing

**Escalation template:**
```
[INTERNAL NOTE]
Escalating: Port-in issue requiring carrier coordination

Customer: [email]
Phone Number: [number]
Old Carrier: [carrier]
Port State: [state]
Rejection Reason: [reason if any]

Timeline:
- Port submitted: [timestamp]
- Current status duration: [X days]
- Customer first contact: [timestamp]

Attempted resolutions:
1. [What was tried]
2. [What was tried]

Recommended action: [Contact ConnectX / Carrier escalation / Manual intervention]
```

## Parameters

- `customer_email`: Required - Customer's email
- `phone_number`: Optional - Specific number to check
- `include_rejection_history`: Default true - Show all past rejections

## Example Usage

```
Agent: "Customer's port keeps getting rejected, says PIN is correct"

LLM:
1. get_portin_status → REJECTED, reason: INVALID_PIN, 2 prior attempts
2. Diagnosis: PIN rejection despite customer claiming correct PIN
3. Checks carrier (Verizon) - notes they have separate "Transfer PIN"
4. Provides Verizon-specific instructions for getting Transfer PIN
5. Offers to resubmit once customer confirms new PIN
```

```
Agent: "How long until this customer's number ports over?"

LLM:
1. get_portin_status → FOC_RECEIVED, foc_date: 2026-02-08
2. Diagnosis: Port approved, scheduled for Feb 8
3. Provides customer-friendly message with expected date
4. Notes that service will briefly interrupt during cutover
```
