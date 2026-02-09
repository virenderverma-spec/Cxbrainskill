# Airvet Support

Handle inquiries and issues related to Airvet, the 24/7 veterinary telehealth benefit included with Meow Mobile plans.

## Description

This skill covers questions about the Airvet pet care benefit, activation issues, usage problems, and explaining how the service works. Airvet provides 24/7 access to licensed veterinarians via video chat for Meow Mobile subscribers.

## Triggers

- "Airvet"
- "vet care"
- "veterinary"
- "pet benefit"
- "talk to a vet"
- "pet health"
- "animal doctor"
- "Airvet not working"
- "can't access Airvet"
- "how do I use Airvet"

## Airvet Overview

**What is Airvet?**
- 24/7 on-demand veterinary telehealth
- Video consultations with licensed vets
- Included FREE with all Meow Mobile plans
- Works for dogs, cats, and other common pets

**What Airvet covers:**
- General health questions
- Symptom assessment
- Nutrition advice
- Behavioral concerns
- Medication questions
- Post-surgery follow-up questions
- Help deciding if emergency vet visit is needed

**What Airvet does NOT cover:**
- Prescriptions (vets can recommend, not prescribe)
- In-person examinations
- Emergency treatment
- Surgery or procedures
- Diagnosis requiring lab work/imaging

## Airvet States

| State | Meaning | Action |
|-------|---------|--------|
| `NOT_ELIGIBLE` | Customer not on active Meow plan | Activate Meow service first |
| `ELIGIBLE_NOT_ACTIVATED` | Benefit available, not set up | Guide through activation |
| `ACTIVE` | Airvet ready to use | Provide usage instructions |
| `SUSPENDED` | Meow account suspended | Resolve account issue first |

## Diagnostic Flow

### Step 1: Check Eligibility

```
Query: get_customer_by_email(email)

Check:
- account_status: Must be ACTIVE
- plan_type: All plans include Airvet
- airvet_status: Current Airvet state
```

**If account not ACTIVE:**
→ Customer must have active Meow Mobile service to access Airvet

**If account ACTIVE:**
→ Continue to Step 2

### Step 2: Check Airvet Activation

```
Query: get_airvet_status(email)

Response:
- airvet_status: ELIGIBLE_NOT_ACTIVATED / ACTIVE
- activation_date: When activated (if applicable)
- last_used: Last consultation date
```

---

## Common Scenarios

### Scenario 1: "What is Airvet? How do I use it?"

```
Airvet is your free 24/7 vet care benefit included with Meow Mobile!

Here's how it works:
1. Download the Airvet app (App Store or Google Play)
2. Create an account using your Meow Mobile email: [email]
3. Add your pet's profile (name, species, breed, age)
4. Tap "Talk to a Vet" anytime you need help

You can video chat with a licensed veterinarian 24/7 about:
- Health concerns or symptoms
- Nutrition and diet questions
- Behavioral issues
- Whether you need to visit an emergency vet

It's completely free with your Meow Mobile plan - no copays, no limits on consultations!
```

### Scenario 2: "I can't activate Airvet / It says I'm not eligible"

**Check:**
1. Is Meow Mobile account ACTIVE?
2. Is customer using the same email for both?
3. Has account been active for 24+ hours? (sync delay)

```
Let me check your Airvet eligibility...

[If account not active:]
Airvet is available once your Meow Mobile service is active. I see your account is currently [status]. Let's get that sorted first, then Airvet will be available.

[If email mismatch:]
Make sure you're signing up for Airvet with the same email as your Meow Mobile account: [email]

If you already created an Airvet account with a different email, you can:
1. Delete that account in the Airvet app
2. Create a new one with [email]

[If new account (sync delay):]
I see your Meow Mobile account was just activated. The Airvet sync can take up to 24 hours. Please try again tomorrow, and if it still doesn't work, let me know!
```

### Scenario 3: "Airvet app isn't working"

**Troubleshooting:**
```
Let's troubleshoot the Airvet app:

1. **Update the app**: Make sure you have the latest version
   - App Store / Google Play > Airvet > Update

2. **Check internet connection**: Airvet needs a stable connection for video

3. **Allow permissions**: The app needs camera and microphone access
   - iPhone: Settings > Airvet > Camera & Microphone ON
   - Android: Settings > Apps > Airvet > Permissions

4. **Restart the app**: Force close and reopen

5. **Reinstall if needed**: Delete and redownload the app

If video calls aren't connecting, try:
- Switch from WiFi to cellular (or vice versa)
- Move to an area with better signal
- Close other apps using bandwidth
```

### Scenario 4: "Can I use Airvet for [specific situation]?"

**For general health questions:**
```
Yes! Airvet vets can help with general health questions like that. They can assess symptoms, provide guidance, and help you decide if an in-person vet visit is needed.

Just open the Airvet app and tap "Talk to a Vet" to start a consultation.
```

**For emergencies:**
```
If your pet is having an emergency (difficulty breathing, severe bleeding, loss of consciousness, suspected poisoning), please go directly to an emergency vet clinic.

Airvet vets can help you assess whether something is an emergency, but they cannot provide emergency treatment.

Would you like help finding an emergency vet near you?
```

**For prescriptions:**
```
Airvet vets can recommend medications and treatments, but they cannot write prescriptions directly. They can advise on over-the-counter options or recommend you visit your local vet for a prescription.

If your pet needs a specific prescription, you'll need to see a vet in person.
```

### Scenario 5: "Is Airvet really free?"

```
Yes, Airvet is 100% free with your Meow Mobile plan!

- Unlimited consultations
- No copays
- No hidden fees
- Available 24/7

It's one of the perks of being a Meow Mobile customer. We're a cat-themed phone company, so naturally we want to help you take care of your furry friends!
```

### Scenario 6: "I had a bad experience with an Airvet vet"

```
I'm sorry to hear that. Your feedback is important.

You can report the experience directly in the Airvet app:
1. Go to your consultation history
2. Find the consultation in question
3. Tap to rate and leave feedback

I can also pass along your feedback to our Airvet partner if you'd like. Could you tell me:
- When the consultation happened (date/time)
- What the issue was

We take quality seriously and want to make sure you have a good experience.
```

---

## Airvet Activation Instructions

**For customers who haven't activated yet:**

```
Here's how to activate your free Airvet benefit:

1. **Download the Airvet app**
   - iPhone: App Store > search "Airvet"
   - Android: Google Play > search "Airvet"

2. **Create your account**
   - Tap "Sign Up"
   - Use your Meow Mobile email: [customer_email]
   - Create a password
   - The app will automatically detect your Meow Mobile benefit

3. **Add your pet(s)**
   - Tap "Add Pet"
   - Enter name, species, breed, age, and any health conditions
   - You can add multiple pets

4. **Start using it!**
   - Tap "Talk to a Vet" anytime
   - A licensed vet will join the video call within minutes

That's it! You now have 24/7 access to veterinary care.
```

## Escalation Triggers

Escalate to Airvet partner support if:

1. **Account sync issue >48 hours** - Meow account active but Airvet not recognizing
2. **Billing dispute** - Customer charged by Airvet (should be free)
3. **Quality complaint** - Serious issue with vet consultation
4. **Technical bug** - App-side issue we can't troubleshoot

**Escalation process:**
```
For Airvet-specific issues, I need to connect you with the Airvet support team.

You can reach them at:
- Email: support@airvet.com
- In-app: Airvet app > Menu > Help

I'll also file a note on our end to track this. If they don't resolve it within 48 hours, let me know and I'll escalate further.
```

## Key Information

**Airvet contact:**
- Website: airvet.com
- Support: support@airvet.com
- App: Available on iOS and Android

**Meow Mobile + Airvet partnership:**
- Meow Mobile pays for the service
- Customers should never be charged
- If charged, escalate for refund

**Common email mismatch issues:**
- Customer used personal email for Airvet, Meow email is different
- Typo in email during Airvet signup
- Resolution: Re-register Airvet with correct Meow email

## Parameters

- `customer_email`: Required - Customer's Meow Mobile email
- `issue_type`: Optional - activation / app_issue / usage_question / complaint
- `pet_info`: Optional - Pet details if relevant

## Example Usage

```
Agent: "Customer asking how to use the free vet benefit"

LLM:
1. Confirms customer has active Meow account
2. Checks if Airvet is already activated
3. If not activated: Provides step-by-step activation guide
4. If activated: Provides usage instructions
5. Explains what Airvet can and cannot do
```

```
Agent: "Customer says Airvet says they're not eligible"

LLM:
1. Checks Meow account status → ACTIVE
2. Checks Airvet status → ELIGIBLE_NOT_ACTIVATED
3. Verifies email matches
4. Finds customer used different email for Airvet
5. Guides customer to re-register with correct email
```
