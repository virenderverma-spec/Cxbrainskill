# Network Connectivity

Diagnose and resolve network, signal, calling, texting, and data connectivity issues for Meow Mobile customers.

## Description

This skill handles issues where customers have an active eSIM but are experiencing service problems including no signal, dropped calls, slow data, inability to text, or roaming issues.

## Triggers

- "no signal"
- "no service"
- "can't make calls"
- "calls dropping"
- "can't send texts"
- "SMS not working"
- "no data"
- "slow internet"
- "data not working"
- "roaming"
- "network issues"
- "bars but no service"

## Prerequisites Check

Before network troubleshooting, verify:

```
1. get_esim_status(email) → Must be ACTIVE
2. get_subscription_status(email) → Must be ACTIVE (not suspended)
3. Account is not suspended for non-payment or AUP violation
```

**If eSIM is not ACTIVE:**
→ Switch to `esim-troubleshooting` skill

**If account is SUSPENDED:**
→ Address suspension reason first (payment, AUP violation, etc.)

## Network Coverage

Meow Mobile uses **AT&T's network** (via MVNO agreement). Coverage follows AT&T's footprint.

**Coverage check:**
```
Query: get_network_coverage(zip_code)

Returns:
- coverage_type: "5G" | "LTE" | "3G" | "NONE"
- signal_strength: "EXCELLENT" | "GOOD" | "FAIR" | "POOR"
- known_issues: Any reported outages or degradation
```

## Diagnostic Flow

### Step 1: Gather Information

Ask/determine:
1. **What's not working?** (calls, texts, data, or everything)
2. **Where are they?** (home, work, traveling)
3. **When did it start?** (just now, hours ago, days)
4. **Any changes?** (new phone, traveled, changed settings)

### Step 2: Check for Outages

```
Query: get_network_outages(zip_code)

Returns:
- active_outages: Array of current outages
  - outage_type: "VOICE" | "DATA" | "ALL"
  - affected_area: Geographic scope
  - started_at: When outage began
  - estimated_resolution: ETA if available
  - description: What's affected
```

**If outage found:**
```
There's currently a network issue in your area that's affecting [voice/data/all services].

Outage details:
- Started: [time]
- Affected area: [area]
- Status: Our carrier partner is working on it
- Expected resolution: [ETA or "within a few hours"]

What to do in the meantime:
- WiFi Calling should work if you're connected to WiFi (Settings > Phone > WiFi Calling)
- You can use messaging apps like iMessage or WhatsApp over WiFi

I'll follow up when the outage is resolved. Sorry for the inconvenience!
```

**If no outage:**
→ Continue to Step 3

### Step 3: Branch by Symptom

---

## Symptom: No Signal / No Service

### Check 1: Is eSIM enabled?

```
[For iPhone]
Settings > Cellular > Check if Meow Mobile plan is ON
Settings > Cellular > Cellular Data > Should be set to Meow Mobile

[For Android]
Settings > Network & Internet > SIMs > Meow Mobile should be enabled
Set Meow Mobile as default for calls/texts/data
```

**Response:**
```
Let's make sure your eSIM is properly enabled:

For iPhone:
1. Go to Settings > Cellular
2. Find your Meow Mobile plan
3. Make sure "Turn On This Line" is toggled ON
4. Tap "Cellular Data" and select Meow Mobile
5. Make sure "Data Roaming" is ON (even for domestic use)

For Android:
1. Go to Settings > Network & Internet > SIMs
2. Tap on Meow Mobile
3. Make sure it's enabled
4. Set as default for Calls, SMS, and Mobile Data
```

### Check 2: Airplane Mode Toggle

```
Sometimes the network connection needs a reset.

Please try:
1. Turn ON Airplane Mode
2. Wait 30 seconds
3. Turn OFF Airplane Mode
4. Wait for the network to reconnect (may take 1-2 minutes)

Do you see signal bars now?
```

### Check 3: Network Settings Reset

```
If airplane mode didn't help, let's reset network settings.

**iPhone:**
Settings > General > Transfer or Reset iPhone > Reset > Reset Network Settings

**Android:**
Settings > System > Reset > Reset Network Settings

Warning: This will forget your saved WiFi passwords. After reset, reconnect to WiFi and check cellular signal.
```

### Check 4: Carrier Settings Update

```
**iPhone:**
Settings > General > About
If a carrier update is available, you'll see a prompt. Tap "Update"

**Android:**
Usually automatic, but try:
Settings > About Phone > Check for Updates
```

---

## Symptom: Can't Make or Receive Calls

### If outgoing calls fail:

```
Troubleshooting call issues:

1. **Check signal**: Do you have at least 1-2 bars?

2. **Try WiFi Calling**:
   - iPhone: Settings > Phone > WiFi Calling > ON
   - Android: Settings > Network > WiFi Calling > ON

3. **Check call forwarding**:
   - iPhone: Settings > Phone > Call Forwarding > Should be OFF
   - Android: Phone app > Settings > Supplementary Services > Call Forwarding > OFF

4. **Dial a test number**: Try calling your own voicemail (*86) to test

If none of this works, what error message do you hear? (e.g., "Call Failed", "Cannot Complete Call", silence)
```

### If incoming calls go straight to voicemail:

```
If calls are going to voicemail without ringing:

1. **Check Do Not Disturb**:
   - iPhone: Settings > Focus > Do Not Disturb > OFF
   - Android: Settings > Sound > Do Not Disturb > OFF

2. **Check Silence Unknown Callers**:
   - iPhone: Settings > Phone > Silence Unknown Callers > OFF

3. **Check blocked numbers**:
   - iPhone: Settings > Phone > Blocked Contacts
   - Android: Phone app > Settings > Blocked Numbers

4. **Make sure phone isn't in Airplane Mode**

Are people getting voicemail immediately, or does it ring a few times first?
```

---

## Symptom: Can't Send or Receive Texts

### SMS/MMS not working:

```
Let's troubleshoot text messaging:

1. **For iPhone (iMessage)**:
   - Settings > Messages > iMessage > Toggle OFF, wait 10 sec, toggle ON
   - Settings > Messages > Send as SMS > Should be ON

2. **Check if it's SMS vs iMessage**:
   - Blue bubbles = iMessage (uses data/WiFi)
   - Green bubbles = SMS (uses cellular)

3. **MMS Settings (for picture messages)**:
   - iPhone: Settings > Messages > MMS Messaging > ON
   - Android: Messaging app > Settings > MMS settings

4. **Try sending to different number**:
   - Send a test text to a different person to see if it's number-specific
```

### Group texts not working:

```
For group messaging:

iPhone:
Settings > Messages > Group Messaging > ON
Settings > Messages > MMS Messaging > ON

Android:
Messaging app > Settings > Group messaging > Should be enabled
Make sure MMS is enabled (group texts use MMS)

Note: If you're in a group with both iPhone and Android users, make sure everyone has MMS enabled.
```

---

## Symptom: Data Not Working / Slow Internet

### No data at all:

```
Let's check your data settings:

1. **Cellular Data is ON**:
   - iPhone: Settings > Cellular > Cellular Data > ON
   - Android: Settings > Network > Mobile Data > ON

2. **Correct APN settings**:
   APN: att.mvno
   (This should be automatic, but let's verify)

   iPhone: Settings > Cellular > Cellular Data Options > Cellular Network
   Android: Settings > Network > Mobile Network > Access Point Names

3. **Data Roaming**:
   - Should be ON (even for domestic use with some MVNOs)
   - iPhone: Settings > Cellular > Cellular Data Options > Data Roaming > ON

4. **Check data usage**: Have you used an unusual amount of data recently?
```

### Slow data speeds:

```
If data is working but slow:

1. **Check signal strength**: Fewer bars = slower speeds. Try moving to a different location.

2. **Network type**:
   - iPhone: Look at status bar (5G, LTE, 4G, 3G)
   - If showing 3G or lower, you're in a poor coverage area

3. **Congestion**: Networks can be slow during peak hours (lunch, evening commute). Try again in 30 min.

4. **Background apps**: Close apps running in background that might be using data

5. **Speed test**: Run a speed test (speedtest.net) and tell me the results
   - Expected: 20-100 Mbps on LTE/5G
   - If <5 Mbps, there may be a network issue

6. **Restart phone**: Sometimes a fresh connection helps
```

---

## Symptom: Issues While Traveling

### Domestic roaming:

```
Meow Mobile works nationwide on AT&T's network, so you should have coverage in most areas.

If you're having issues while traveling:

1. **Enable Data Roaming**:
   - iPhone: Settings > Cellular > Cellular Data Options > Data Roaming > ON
   - This is needed even within the US for some network handoffs

2. **Manual network selection** (if in poor coverage):
   - iPhone: Settings > Cellular > Network Selection > turn OFF Automatic, select AT&T
   - Android: Settings > Network > Mobile Network > Network operators > AT&T

3. **Check coverage**: What's your current ZIP code? I'll check network availability.
```

### International roaming:

```
International roaming is currently [supported/not supported] on Meow Mobile.

[If not supported:]
For international travel, you have a few options:
- Get a local SIM at your destination
- Use an international eSIM service (Airalo, Holafly)
- Use WiFi calling when connected to WiFi abroad

[If supported:]
To enable international roaming:
1. Settings > Cellular > Data Roaming > ON
2. Contact us before traveling so we can enable international access
3. Rates: $[rate] per MB data, $[rate] per minute calls

What country are you traveling to?
```

---

## Device-Specific Troubleshooting

### iPhone eSIM issues:

```
iPhone eSIM checklist:

1. **iOS version**: Make sure you're on iOS 14 or later
   Settings > General > Software Update

2. **eSIM visible**:
   Settings > Cellular > You should see "Meow Mobile" as a plan

3. **Primary line**: If you have multiple eSIMs:
   Settings > Cellular > Default Voice Line > Meow Mobile
   Settings > Cellular > Cellular Data > Meow Mobile

4. **Physical SIM conflict**: If you have a physical SIM too:
   Make sure it's not interfering with the eSIM settings
```

### Android eSIM issues:

```
Android eSIM checklist (varies by manufacturer):

1. **Samsung**:
   Settings > Connections > SIM Manager > Check Meow Mobile is active

2. **Google Pixel**:
   Settings > Network & Internet > SIMs > Meow Mobile enabled

3. **Other Android**:
   Settings > Network > SIM Cards > Enable Meow Mobile

4. **Make sure eSIM is default**:
   Set Meow Mobile as default for Calls, SMS, and Data
```

---

## Resolution Actions

| Issue | Resolution | Tool/Action |
|-------|------------|-------------|
| Outage in area | Inform and wait | Provide ETA, suggest WiFi calling |
| Settings wrong | Guide through settings | Step-by-step instructions |
| eSIM corrupted | SIM swap | `trigger_sim_swap` |
| Network reset needed | Reset network settings | Guide customer |
| Coverage issue | Explain coverage | Check coverage map |
| Device incompatible | Explain limitation | Suggest compatible device |

## Escalation Triggers

Escalate to L2/Engineering if:

1. **eSIM shows ACTIVE but no service** after all troubleshooting
2. **Widespread outage** affecting multiple customers
3. **Provisioning issue** - network doesn't recognize the SIM
4. **Carrier-side block** - AT&T rejecting the connection
5. **Repeated network drops** with no explanation

**Escalation template:**
```
[INTERNAL NOTE]
Escalating: Network connectivity issue

Customer: [email]
Device: [model]
Location: [ZIP code]
eSIM State: [ACTIVE/etc]

Symptom: [What's not working]
Duration: [How long]

Troubleshooting attempted:
1. [Step and result]
2. [Step and result]
3. [Step and result]

Outage check: [None found / Details]
Coverage check: [Good / Poor]

Recommended action: [Network investigation / Carrier escalation / SIM reprovision]
```

## Parameters

- `customer_email`: Required - Customer's email
- `zip_code`: Optional - For coverage/outage check
- `symptom`: Optional - Pre-identified issue type
- `device_model`: Optional - For device-specific guidance

## Example Usage

```
Agent: "Customer says they have bars but can't make calls"

LLM:
1. get_esim_status → ACTIVE
2. get_network_outages(zip) → None
3. Diagnosis: eSIM active, no outage, likely settings issue
4. Walks through call settings verification
5. Suggests WiFi calling as backup
6. If persists, recommends network settings reset
```

```
Agent: "Customer traveling and lost service"

LLM:
1. Asks for current ZIP code
2. get_network_coverage(zip) → LTE coverage available
3. Checks Data Roaming setting (often the culprit)
4. Guides customer to enable Data Roaming
5. Suggests manual network selection to AT&T
```
