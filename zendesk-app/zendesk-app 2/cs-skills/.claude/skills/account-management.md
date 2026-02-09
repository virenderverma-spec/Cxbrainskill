# Account Management

Handle account-related requests including login issues, profile updates, account suspension/reactivation, and account deletion for Meow Mobile customers.

## Description

This skill covers all account lifecycle operations from login problems to account closure, including profile changes, security concerns, and compliance-related suspensions.

## Triggers

- "can't login"
- "forgot password"
- "update my email"
- "change my name"
- "delete my account"
- "account suspended"
- "reactivate account"
- "close my account"
- "account locked"
- "can't access account"
- "change phone number"
- "verify my account"

## Account States Reference

| State | Meaning | Service Status | Can Login |
|-------|---------|----------------|-----------|
| `ACTIVE` | Normal state | Full service | Yes |
| `PENDING` | Signup not complete | No service | Yes |
| `SUSPENDED_PAYMENT` | Payment failed/overdue | No service | Yes |
| `SUSPENDED_AUP` | Policy violation | No service | Yes |
| `SUSPENDED_FRAUD` | Fraud investigation | No service | No |
| `CANCELLED` | Customer cancelled | No service | Limited |
| `TERMINATED` | Account closed | No service | No |

## Diagnostic Flow

### Step 1: Identify Account State

```
Query: get_customer_by_email(customer_email)

Response includes:
- customer_id: Unique ID
- email: Account email
- name: Customer name
- phone: Phone number on account
- account_status: See states above
- created_at: Account creation date
- suspension_reason: If suspended, why
- last_login: Last successful login
```

### Step 2: Branch by Issue Type

---

## Section A: Login Issues

### Can't Login - Forgot Password

```
To reset your password:

1. Open the Meow Mobile app
2. Tap "Sign In"
3. Tap "Forgot Password"
4. Enter your email: [customer_email]
5. Check your email for a reset link
6. Click the link and create a new password

The reset link expires in 1 hour. If you don't see the email, check your spam folder.

Still not working? Let me know and I can send a manual reset.
```

**If customer didn't receive reset email:**
```
Check:
1. Spam/junk folder
2. Correct email address (common typos)
3. Email deliverability

Use tool: send_password_reset(customer_email)

I've sent a new password reset link to [email]. It should arrive within a few minutes.

If you still don't receive it:
- Check spam/junk folder
- Try adding noreply@meowmobile.com to your contacts
- If using Gmail, check the "Promotions" or "Updates" tabs
```

### Can't Login - Account Locked

```
Query: get_customer_by_email → Check account_status and suspension_reason
```

**If SUSPENDED_FRAUD:**
```
[INTERNAL NOTE]
Account flagged for fraud investigation. DO NOT provide password reset or account access.
Escalate to Trust & Safety team.

[To customer:]
I see there's a hold on your account that I need to look into. For security reasons, I can't make changes right now.

I'm escalating this to our specialized team who will review and contact you within 24-48 hours at [customer_email].

Is there anything else I can help with in the meantime?
```

**If SUSPENDED_PAYMENT:**
```
Your account is on hold due to a payment issue.

To restore access:
1. Open the app (you can still log in)
2. Go to Settings > Payment Method
3. Update your payment information
4. Your account will reactivate automatically once payment processes

If you need help with the payment, let me know what error you're seeing.
```

**If SUSPENDED_AUP:**
```
Your account has been suspended for a policy violation.

Suspension reason: [reason from system]

[Common AUP violations:]
- Excessive international calling (potential fraud pattern)
- Abusive behavior toward support
- Terms of service violation

To appeal or discuss this suspension, I'll need to connect you with our Trust & Safety team.

Would you like me to escalate this for review?
```

### Can't Login - Wrong Email

```
Let me help you find your account.

Can you provide any of the following?
- Phone number associated with the account
- Previous email addresses you might have used
- Approximate date you signed up
- Last 4 digits of the card used to pay

[Use info to search:]
Query: search_customer(phone=X) or search_customer(card_last4=X)
```

---

## Section B: Profile Updates

### Change Email Address

```
To update your email address:

Current email: [current_email]
New email: [requested_email]

Steps:
1. Open the Meow Mobile app
2. Go to Settings > Account
3. Tap "Email Address"
4. Enter new email
5. Verify new email by clicking the link sent to it

[If customer can't access app:]
I can update your email manually. For security, I'll need to verify your identity first.

Can you confirm:
- Last 4 digits of the card on file
- Your billing ZIP code
- Your date of birth

[After verification:]
Use tool: update_customer_email(customer_id, new_email)

I've updated your email to [new_email]. You'll receive a confirmation at both the old and new addresses.
```

### Change Name on Account

```
To update the name on your account:

Current name: [current_name]
Requested name: [new_name]

Note: The name on your Meow Mobile account should match your payment method. If you're updating due to a legal name change, the process is the same.

I can update this for you. Just confirm the new name spelling:
First Name: ___
Last Name: ___

[After confirmation:]
Use tool: update_customer_name(customer_id, first_name, last_name)

Done! Your account name is now [new_name].
```

### Update Phone Number on Account

**Note:** This is the contact number, not the Meow Mobile service number.

```
Your Meow Mobile service number: [meow_number] (can't be changed here, see port-in)
Contact number on file: [contact_number]

To update your contact number:
1. Open the app
2. Go to Settings > Account > Contact Phone
3. Enter new number
4. Verify with SMS code

[If changing Meow service number:]
Your Meow Mobile number can only be changed by:
1. Porting in a different number (replacing current)
2. Requesting a new number assignment

Would you like help with either of those?
```

---

## Section C: Account Suspension

### View Suspension Reason

```
Query: get_customer_by_email → suspension_reason

Common reasons:
- PAYMENT_FAILED: Payment didn't go through
- PAYMENT_OVERDUE: Account past due >30 days
- AUP_VIOLATION: Acceptable Use Policy breach
- FRAUD_SUSPECTED: Unusual activity detected
- MANUAL_HOLD: Admin placed hold
```

### Reactivate - Payment Suspension

```
Your account was suspended because [reason]:

[If PAYMENT_FAILED:]
Your last payment didn't go through. To reactivate:
1. Update payment method in app
2. Pay outstanding balance: $[amount]
3. Service restores within 1 hour

[If PAYMENT_OVERDUE:]
Your account is past due by $[amount].
- To reactivate: Pay balance in full
- After 60 days overdue, number may be released

Would you like help updating your payment method?
```

### Reactivate - AUP Suspension

```
[INTERNAL NOTE]
AUP suspensions require Trust & Safety review. Agents cannot reactivate directly.

[To customer:]
Your account was suspended for: [AUP reason]

To request reactivation:
1. I'll submit a review request to our Trust & Safety team
2. They'll review within 48 business hours
3. You'll receive an email with their decision

Would you like me to submit this review request?

[If yes:]
Use tool: submit_aup_review(customer_id, customer_statement)

Please briefly describe your side of the situation, and I'll include it in the review request.
```

### Appeal Fraud Suspension

```
[INTERNAL NOTE]
FRAUD_SUSPECTED suspensions are high-risk. Do not share details of why flagged.
Escalate to Trust & Safety immediately.

[To customer:]
I see there's a security review on your account. This is handled by a specialized team.

For your protection, I'll have them contact you directly at [email]. They typically respond within 24-48 hours.

If you need to provide any documentation or have urgent concerns, you can email trust@meowmobile.com directly.
```

---

## Section D: Account Closure

### Cancel Service (Voluntary)

```
Before cancelling, I'd like to understand why you're leaving:
- [ ] Moving to another carrier
- [ ] Service issues
- [ ] Pricing
- [ ] Don't need phone service anymore
- [ ] Other: ___

[If service issues:]
Can I help resolve the issue instead of cancelling? What's been going wrong?

[If proceeding with cancellation:]
Here's what happens when you cancel:
- Service continues until [billing_cycle_end]
- Your phone number will be released after 30 days
- Any remaining balance is due immediately
- You can port your number out before cancellation completes

Would you like to:
1. Cancel now (service until [date])
2. Port your number first, then cancel
3. Talk through options before deciding

[If confirmed cancel:]
Use tool: cancel_account(customer_id, reason, effective_date)
```

### Delete Account (GDPR/CCPA)

```
You have the right to request deletion of your personal data.

Important: Account deletion is permanent and different from cancellation:
- Cancellation: Ends service, keeps account for records
- Deletion: Permanently removes all personal data

After deletion:
- All your data is removed from our systems
- This cannot be undone
- Any legal/billing records may be retained as required by law
- Process takes up to 30 days

Are you sure you want to delete your account?

[If confirmed:]
Use tool: submit_deletion_request(customer_id)

I've submitted your deletion request. You'll receive a confirmation email within 48 hours, and deletion will complete within 30 days.
```

### Port-Out (Keeping Number)

```
To transfer your number to another carrier:

You'll need this information for your new carrier:
- Account Number: [account_number]
- Transfer PIN: [I'll generate this]
- Account Holder Name: [name]
- Service Address ZIP: [billing_zip]

Use tool: generate_port_out_pin(customer_id)

Your Transfer PIN is: [PIN]
(This is different from your account login password)

Give this information to your new carrier to start the port. Once they submit the request, the transfer typically takes 1-3 business days.

Note: Your Meow Mobile service will automatically cancel once the port completes. Make sure to settle any outstanding balance.
```

---

## Section E: Security Concerns

### Unauthorized Access

```
If you believe someone accessed your account without permission:

1. **Change your password immediately**
   - App > Settings > Security > Change Password

2. **Review recent activity**
   - Check for unauthorized purchases or changes
   - Let me know what you see

3. **Update payment method**
   - Remove current card and add a new one
   - App > Settings > Payment Method

I'll also flag your account for security review.

Use tool: flag_security_review(customer_id, reason="unauthorized_access")

Have you noticed any unauthorized charges?
```

### Account Takeover Suspected

```
[INTERNAL NOTE]
If customer reports someone else has taken over their account (changed email, changed password, locked them out):

1. Verify customer identity through alternative means
2. Do NOT make changes based on ticket email alone
3. Require callback to phone on file OR ID verification

[To customer:]
For your security, I need to verify your identity before making changes.

I'll need to call you at the phone number we have on file, OR you can email a photo of your ID to verify@meowmobile.com.

Which would you prefer?

[After verification:]
Use tool: emergency_account_recovery(customer_id)
- Resets password
- Revokes all sessions
- Sends notification to original email
```

---

## Escalation Triggers

Escalate to L2/Trust & Safety if:

1. **Fraud suspension** - Requires T&S review
2. **AUP suspension appeal** - Requires T&S decision
3. **Account takeover** - Requires identity verification
4. **Legal requests** (subpoenas, law enforcement) - Requires Legal team
5. **Complex deletion requests** - Requires Privacy team
6. **VIP/Influencer accounts** - Requires special handling

**Escalation template:**
```
[INTERNAL NOTE]
Escalating: Account management issue

Customer: [email]
Account Status: [status]
Issue: [description]

Customer's request: [what they want]
Verification completed: [Yes/No - method used]

Recommended action: [specific ask for L2/T&S]
Urgency: [Low/Medium/High]
```

## Parameters

- `customer_email`: Required - Customer's email
- `customer_id`: Optional - If already known
- `include_history`: Default true - Include account history
- `skip_verification`: Default false - Skip identity verification (internal use)

## Example Usage

```
Agent: "Customer says they can't log in, forgot password"

LLM:
1. Confirms customer email
2. Checks account status → ACTIVE (no blocks)
3. Triggers password reset email
4. Provides instructions to check spam folder
5. Offers manual reset if email not received
```

```
Agent: "Customer wants to delete their account completely"

LLM:
1. Clarifies deletion vs cancellation
2. Explains consequences (permanent, 30 days)
3. Confirms customer truly wants deletion
4. Submits GDPR/CCPA deletion request
5. Provides confirmation and timeline
```

```
Agent: "Customer account is suspended, they don't know why"

LLM:
1. get_customer_by_email → SUSPENDED_PAYMENT
2. Explains suspension is due to failed payment
3. Checks outstanding balance
4. Guides customer to update payment method
5. Confirms automatic reactivation after payment
```
