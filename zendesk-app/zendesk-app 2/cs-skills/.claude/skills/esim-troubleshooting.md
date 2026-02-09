# eSIM Troubleshooting

Diagnose and resolve eSIM activation, installation, and provisioning issues for Meow Mobile customers.

## Description

This skill handles the #1 contact reason: customers who can't get their eSIM working. It covers the full journey from payment completion to active service, identifying where the customer is stuck and providing the exact resolution.

## Triggers

- "eSIM not working"
- "can't activate eSIM"
- "QR code won't scan"
- "eSIM won't install"
- "no service after activation"
- "eSIM says invalid"
- "activation failed"
- "can't download eSIM"
- "eSIM error"
- "profile download failed"

## eSIM States Reference

| State | Meaning | Customer Experience | Action Required |
|-------|---------|---------------------|-----------------|
| `NOT_PROVISIONED` | Payment not complete or order failed | Can't start activation | Verify payment status |
| `PROVISIONING` | eSIM being created (1-5 min) | Waiting screen | Wait, check again in 5 min |
| `PENDING` | eSIM ready, not installed | Has QR code, hasn't scanned | Guide through installation |
| `DOWNLOADING` | Profile being installed | Installation in progress | Wait for completion |
| `ACTIVE` | eSIM working | Should have service | If no service, check network |
| `FAILED` | Provisioning error | Error message | Trigger SIM swap |
| `SUSPENDED` | Account suspended | No service | Check account status |

## Diagnostic Flow

### Step 1: Verify Payment & Order Status

```
Query: get_orders_by_email(customer_email)

Check:
- Is there a completed order? (status = COMPLETED)
- Was payment successful? (payment_status = SUCCEEDED)
- When did they pay? (completed_at timestamp)
```

**If no completed order:**
→ Issue is payment, not eSIM. Switch to `payment-issues` skill.

**If order completed:**
→ Continue to Step 2.

### Step 2: Check eSIM Provisioning State

```
Query: get_esim_status(customer_email)

Response includes:
- esim_state: Current state (see table above)
- iccid: SIM identifier
- provisioned_at: When eSIM was created
- installed_at: When customer installed (null if not installed)
- error_code: If FAILED, the reason
```

### Step 3: Branch by State

#### If `NOT_PROVISIONED` or `PROVISIONING`:

**Diagnosis:** eSIM not ready yet.

**Check:**
- How long since payment? If <5 min, ask customer to wait.
- If >10 min and still PROVISIONING, there's a backend issue.

**Action:**
- <5 min since payment: "Your eSIM is being prepared, please wait 5 minutes and check again."
- >10 min: Escalate to L2 - provisioning stuck.

---

#### If `PENDING`:

**Diagnosis:** eSIM ready but customer hasn't installed it.

**Check:**
- Is device compatible? (iPhone XS or newer, Pixel 3+, Samsung S20+)
- Did they receive the QR code in the app?

**Action:**
```
Use tool: send_esim_instructions(customer_email)
```

**Response to customer:**
```
Your eSIM is ready to install! Here's what to do:

1. Make sure you're connected to WiFi
2. Open the Meow Mobile app
3. Tap "Activate eSIM" on the home screen
4. Choose "Scan QR Code" or "Install Manually"
5. Follow the prompts to add the cellular plan
6. When asked, enable "Turn On This Line"
7. Restart your phone

After restart, you should see "Meow" in your status bar. Let me know once you've tried this!
```

---

#### If `DOWNLOADING`:

**Diagnosis:** Installation in progress.

**Check:**
- How long has it been downloading? (check timestamp)
- If >15 min, likely stuck.

**Action:**
- <15 min: Ask customer to wait, ensure strong WiFi connection.
- >15 min: Ask customer to restart phone and try again. If still stuck, may need SIM swap.

---

#### If `ACTIVE` but customer reports no service:

**Diagnosis:** eSIM is active but something else is wrong.

**Check:**
1. Is airplane mode off?
2. Is the eSIM line enabled in device settings?
3. Are there network outages in their area?
4. Is the device in a supported coverage area?

```
Query: get_network_outages(customer_zip_code)
```

**Action:**
Guide customer through settings verification:
```
Let's make sure everything is configured correctly:

**For iPhone:**
1. Go to Settings > Cellular
2. Find your Meow Mobile plan
3. Make sure "Turn On This Line" is enabled
4. Tap "Cellular Data" and select Meow Mobile
5. Restart your phone

**For Android:**
1. Go to Settings > Network & Internet > SIMs
2. Find your Meow Mobile eSIM
3. Make sure it's enabled
4. Set it as default for calls and data
5. Restart your phone

If you still don't have service after this, let me know your ZIP code and I'll check for outages.
```

---

#### If `FAILED`:

**Diagnosis:** eSIM provisioning failed. Requires SIM swap.

**Check error_code:**

| Error Code | Meaning | Resolution |
|------------|---------|------------|
| `CARRIER_REJECTED` | Carrier denied activation | Check account status, may be fraud block |
| `PROFILE_DOWNLOAD_FAILED` | Technical error | Trigger SIM swap |
| `DEVICE_INCOMPATIBLE` | Device can't accept eSIM | Customer needs different device |
| `DUPLICATE_ACTIVATION` | eSIM already active elsewhere | Deactivate old eSIM first |
| `PROVISIONING_TIMEOUT` | Backend timeout | Trigger SIM swap |

**Action for most errors:**
```
Confirm with agent: "I recommend triggering a SIM swap to provision a new eSIM. This will invalidate the old QR code and create a new one. Should I proceed?"

If confirmed:
Use tool: trigger_sim_swap(customer_email, reason="eSIM provisioning failed")
```

**Response to customer after SIM swap:**
```
I've reset your eSIM and a fresh one is being prepared. This takes about 5 minutes.

Once ready, you'll see a new QR code in the Meow Mobile app. The old one won't work anymore, so please use the new code to activate.

I'll follow up in a few minutes to make sure everything's working!
```

---

## Device Compatibility Reference

### Supported Devices (eSIM capable)

**iPhone:**
- iPhone XS, XS Max, XR (2018) and newer
- NOT supported: iPhone X, 8, 7, SE (1st gen)

**Google Pixel:**
- Pixel 3, 3a and newer
- NOT supported: Pixel 2, original Pixel

**Samsung:**
- Galaxy S20 and newer
- Galaxy Z Fold/Flip series
- Galaxy Note 20 and newer
- NOT supported: S10, Note 10 (carrier-dependent)

**Other:**
- Motorola Razr (2019+)
- OnePlus (varies by model/region)

### Checking Device Compatibility

Ask customer:
```
What phone model do you have? You can find this in:
- iPhone: Settings > General > About > Model Name
- Android: Settings > About Phone > Model
```

If device is not compatible:
```
Unfortunately, your [Device Model] doesn't support eSIM. Meow Mobile requires an eSIM-capable device.

Compatible devices include:
- iPhone XS or newer
- Google Pixel 3 or newer
- Samsung Galaxy S20 or newer

If you have another device that's compatible, you can activate Meow Mobile on that one instead. Would you like me to help with that, or would you prefer a refund?
```

## Common Failure Scenarios

### Scenario 1: "I scanned the QR code but nothing happened"

**Likely causes:**
1. Camera app instead of Settings
2. Already installed (check if ACTIVE)
3. Weak internet connection

**Resolution:**
```
The QR code needs to be scanned from your phone's Settings, not the camera app.

**For iPhone:**
Settings > Cellular > Add Cellular Plan > scan the QR code

**For Android:**
Settings > Network & Internet > SIMs > Add eSIM > scan the QR code

Make sure you're on a strong WiFi connection when scanning.
```

### Scenario 2: "It says 'Cellular Plan Cannot Be Added'"

**Likely causes:**
1. Device not compatible
2. Carrier lock on device
3. eSIM already installed (duplicate)

**Resolution:**
Check if device is carrier-locked:
```
Is your phone unlocked? If you bought it through a carrier (AT&T, Verizon, T-Mobile), it might be locked to that carrier.

To check:
- iPhone: Settings > General > About > look for "Carrier Lock"
- Android: Contact your original carrier

If locked, you'll need to request an unlock from your original carrier before using Meow Mobile.
```

### Scenario 3: "eSIM installed but shows 'No Service'"

**Diagnostic steps:**
1. Check eSIM state (should be ACTIVE)
2. Check if line is enabled in settings
3. Check for network outages
4. Verify not in airplane mode

**If eSIM is ACTIVE and no outages:**
```
Let's reset the network settings:

**iPhone:**
Settings > General > Transfer or Reset > Reset > Reset Network Settings

**Android:**
Settings > System > Reset > Reset Network Settings

Warning: This will forget saved WiFi passwords. After reset, reconnect to WiFi and check if you have service.
```

### Scenario 4: "I used the QR code on my old phone by mistake"

**Diagnosis:** eSIM activated on wrong device.

**Resolution:** Trigger SIM swap to generate new eSIM for correct device.
```
No problem! I'll deactivate the eSIM on your old phone and create a new one for your [correct device].

Use tool: trigger_sim_swap(customer_email, reason="Activated on wrong device")

The new eSIM will be ready in about 5 minutes. You'll see a fresh QR code in the app.
```

## Escalation Triggers

Escalate to L2 if:

1. **Provisioning stuck >30 min** - Backend issue
2. **SIM swap failed** - System error
3. **Error code: CARRIER_REJECTED** - May be fraud/compliance issue
4. **3+ failed activation attempts** - Needs engineering investigation
5. **Customer has been stuck >72 hours** - SLO breach, priority resolution

**Escalation template:**
```
[INTERNAL NOTE]
Escalating: eSIM activation failure

Customer: [email]
Order ID: [order_id]
Device: [device_model]
eSIM State: [current_state]
Error Code: [error_code if any]

Timeline:
- Paid: [timestamp]
- First contact: [timestamp]
- Issue duration: [X days]

Tried:
1. [Action and result]
2. [Action and result]

Recommended L2 action: [specific ask]
```

## Parameters

- `customer_email`: Required - Customer's email
- `device_model`: Optional - Customer's phone model
- `esim_state`: Optional - Pre-fetched eSIM state
- `skip_compatibility_check`: Default false - Skip device compatibility verification

## Example Usage

```
Agent: "Customer says eSIM won't install, shows error"

LLM:
1. get_orders_by_email → Order COMPLETED, paid 2 days ago
2. get_esim_status → State: FAILED, error: PROFILE_DOWNLOAD_FAILED
3. Diagnosis: eSIM provisioning failed, needs SIM swap
4. Asks agent to confirm SIM swap
5. If confirmed, triggers SIM swap and provides customer response
```

```
Agent: "Customer scanned QR code but nothing happened"

LLM:
1. get_esim_status → State: PENDING (not installed)
2. Diagnosis: Customer likely scanned with camera app
3. Provides correct scanning instructions for their device type
4. Offers to send eSIM instructions via app notification
```
