# CS Intelligence Platform  Gather Brain

## Vision

Build a shared intelligence backend ("Gather Brain") that powers three surfaces: **Zendesk Copilot** (agent-facing), **Proactive Alerts** (ops-facing), and **Mochi** (customer-facing). A shared **Process/KB Skills** layer encodes the operational knowledge so all surfaces give consistent, instructional answers.

Split across **3 people**:
1. **Person A**  Zendesk Copilot (enhance existing sidebar into instructional agent)
2. **Person B**  Proactive Alert System (detect stuck customers, trigger outreach)
3. **Person C**  Process/KB Skills (troubleshooting flows, escalation paths, resolution playbooks)

---

## How This Addresses the 8 Operational Issues

| # | Issue | Root Cause | Workstream(s) | Specific Feature |
|---|-------|------------|---------------|------------------|
| 1 | **Agents don't know where customer is in journey** | No unified view; agents dig through 4+ systems manually | **WS1** Zendesk Copilot | **Auto-loaded customer profile**  funnel stage, order status, payment, eSIM, Airvet all rendered on ticket open. Agent sees journey at a glance without searching. |
| 2 | **KB is generic and unhelpful** | Static articles, no decision trees, no awareness of customer state | **WS3** Process/KB Skills | **Contextual skill files**  not generic articles but structured diagnostic flows (if eSIM status = X, do Y). Skills reference real tools and API calls. Claude uses them to give situational, not generic, answers. |
| 3 | **Information repeats across L0, L1, L2** | No shared context; each tier re-asks the same questions | **WS1** Zendesk Copilot | **Diagnosis banner + internal notes on escalation**  when agent clicks "Escalate to L2", the CTA auto-attaches full diagnostic context (what was checked, API results, customer state). L2 agent sees the same sidebar profile. Zero re-investigation. |
| 4 | **No agreed process with AT&T/ConnectX** | Agents don't know when to contact carrier vs. retry vs. wait | **WS3** Process/KB Skills | **`portin-troubleshooting` and `escalation-guide` skills**  encode exact criteria for carrier escalation (e.g., "port-in rejected with reason FOC_NOT_FOUND, collect correct account PIN, do NOT contact AT&T yet"). Removes guesswork. |
| 5 | **No customer-level SLOs** | No tracking of how long a specific customer has been suffering | **WS1** Zendesk Copilot | **Customer SLO Timer**  calculates "issue duration: 4 days since first open ticket" from Zendesk history. Color-coded urgency (green/amber/red). Agents see at a glance if this customer needs priority. |
| 6 | **Slow resolution / delays** | Agents spend time diagnosing instead of resolving; no quick actions | **WS1** Zendesk Copilot | **One-click CTAs**  "Send eSIM Instructions", "Trigger SIM Swap", "Check Network Outages" reduce resolution from 15-min investigation to one click. **Guided troubleshooting** walks through steps automatically so agents don't fumble. |
| 7 | **No proactive detection of stuck customers** | Issues only surface when customer complains | **WS2** Proactive Alerts | **Alert engine**  scans every 15 min for stuck orders (>2h), eSIM not installed (>48h), payment failures, port-in stuck. Alerts fire in Slack **before** customer reaches out. Can auto-create Zendesk tickets. |
| 8 | **Agent helplessness / lack of empowerment** | Agents see data but don't know what to DO with it | **WS1 + WS3** Copilot + Skills | **Instructional, not informational**  the diagnosis banner says "Customer paid but hasn't installed eSIM (3 days). **Send eSIM help article.**" not just "eSIM status: ERROR". Skills tell Claude what to recommend. CTAs let agents act immediately. |

### Coverage Map

```
Issue                              WS1 Copilot   WS2 Alerts   WS3 Skills
-----                              -----------   ----------   ----------
1. No journey visibility            PRIMARY
2. Generic KB                                                  PRIMARY
3. Info repeats across tiers        PRIMARY                    SUPPORTS
4. No carrier process                                          PRIMARY
5. No customer SLOs                 PRIMARY       SUPPORTS
6. Slow resolution                  PRIMARY                    SUPPORTS
7. No proactive detection                         PRIMARY
8. Agent helplessness               PRIMARY                    PRIMARY
```

Key insight: **WS1 (Copilot) and WS3 (Skills) are tightly coupled**  the Copilot is the delivery surface, Skills are the intelligence. Neither works well alone. WS2 (Alerts) is independent and addresses the one problem the other two can't: catching issues before anyone notices.

---

## What Exists Today

| Asset | Status | Location |
|-------|--------|----------|
| Zendesk sidebar app | Working demo | `zendesk-app/`  ZAF v2, auto-loads profile, AI chat |
| Backend server | Working | `zendesk-app/server/`  Express, 15 tools, Claude AI + direct mode |
| Boss API MCP | Working | `ai-boss-api`  real-time customer/order/eSIM/payment data |
| Databricks MCP | Working | `databricks-sql`  historical queries, ~24h delay |
| Zendesk MCP | Working | `zendesk`  ticket search (max 100) |
| Stripe MCP | Working | `stripe`  payment lookups |
| Brain-template | Working | `brain-template/`  Slack bot framework with skill loader |
| Launchmate skills | Written | `.claude/skills/`  ops-engineer, analytics-engineer, bi-analyst, launch-ops |
| CJ Dashboard | Working | `MC/cj-dashboard/`  Next.js, funnel/support/incident metrics |
| Data catalog | Complete | `MC/data_catalog.md`  all table schemas, query patterns |

---

## Architecture

```
+----------------------------------------------------------------------+
|                        GATHER BRAIN                                   |
|                                                                       |
|  +----------------------------------------------------------+        |
|  |  Process/KB Skills Layer                                   |        |
|  |  (Markdown SKILL.md files -- troubleshooting flows,        |        |
|  |   escalation paths, resolution steps, SOP playbooks)       |        |
|  +----------+-----------------+------------------+-----------+        |
|             |                 |                  |                     |
|  +----------v------+  +------v-------+  +-------v-------+            |
|  | Zendesk Copilot |  |  Proactive   |  |    Mochi      |            |
|  | (Sidebar App)   |  |  Alerts      |  |  (Customer    |            |
|  |                 |  |  (Cron/Event) |  |   Chatbot)    |            |
|  | Claude + Tools  |  |              |  |               |            |
|  | + Skills        |  |  Databricks  |  |  Same skills  |            |
|  | + CTAs          |  |  + Boss API  |  |  + tools      |            |
|  +--------+--------+  +------+-------+  +-------+-------+            |
|           |                  |                   |                     |
|  +--------v------------------v-------------------v-----------+        |
|  |  Shared Tool Layer                                         |        |
|  |  Boss API . Databricks . Zendesk . Stripe                  |        |
|  +------------------------------------------------------------+        |
+----------------------------------------------------------------------+
         |                    |                    |
         v                    v                    v
   Zendesk Agent         Slack Channel        Mobile App
   Workspace             (#cs-alerts)         (Mochi Chat)
```

---

## Workstream 1: Zendesk Copilot (Person A)

### Goal
Upgrade the existing sidebar from "informational" to "instructional"  tell agents **what to do**, not just show data.

### Current State
The sidebar already auto-loads customer profiles (name, orders, funnel, SIM status, Mochi history) and has an AI chat with 15 tool definitions. This is the foundation.

### What Changes

**1. Diagnosis Banner**  Top-of-sidebar, color-coded assessment
- Stuck at eSIM? Show "Customer paid but hasn't installed eSIM (3 days). Send eSIM help article."
- Port-in failed? Show "Port-in rejected by AT&T. Reason: [X]. Collect correct account PIN."
- Payment failed? Show "Payment declined. Ask customer to update payment method in app."
- Multiple issues? Stack them by severity.

**2. One-Click CTAs**  Buttons that perform actions
- "Send eSIM Instructions"  inserts a templated message into the ticket reply
- "Trigger SIM Swap"  calls Boss API `POST /individual/{id}/simswap`
- "Check Network Outages"  auto-detects customer ZIP, queries Boss API
- "Escalate to L2"  adds internal note with full diagnostic context, re-assigns

**3. Customer SLO Timer**  How long has this customer been suffering?
- "Issue duration: 4 days since first ticket" (queries Zendesk for earliest open ticket)
- Color-coded: green (<24h), amber (1-3 days), red (>3 days)

**4. Guided Troubleshooting**  Structured diagnostic flows
- Agent selects issue type (eSIM, port-in, payment, network)
- App walks through diagnostic steps from the relevant skill
- Each step auto-runs the query and shows the result
- At end: suggested resolution + one-click action

### New Endpoints

```
POST /api/customer/diagnose     Analyze profile, return diagnosis + recommendations
POST /api/actions/send-reply    Insert a reply into Zendesk ticket via API
POST /api/actions/sim-swap      Trigger SIM swap via Boss API
POST /api/actions/escalate      Add internal note + reassign ticket
GET  /api/customer/slo/:email   Calculate issue duration from first open ticket
```

### Key Design: Skills in System Prompt

The current `chat.js` has a hardcoded system prompt. Upgrade to dynamically load skills:

```javascript
const skillContent = loadSkills('./skills/');
const systemPrompt = BASE_PROMPT + '\n\n' + skillContent;
```

Person C writes the skills, Person A loads them into Claude.

---

## Workstream 2: Proactive Alert System (Person B)

### Goal
Detect customer problems **before** they open a ticket.

### How It Works

```
Alert Engine (Node.js cron job)

Every 15 min:
1. Query Databricks for stuck states
2. Query Boss API for failed orders
3. Compare against last-alert state (dedup)
4. If new issue found --> classify severity
5. Route to Slack + optionally auto-create Zendesk ticket
```

### Alert Rules

| Rule | Detection Query | Severity | Action |
|------|----------------|----------|--------|
| **Stuck orders** | Orders INPROGRESS > 2 hours | P2 | Slack + Zendesk ticket |
| **Payment failed, no retry** | Payment FAILED > 1 hour, no subsequent SUCCEEDED | P3 | Slack alert |
| **eSIM not installed** | Payment completed > 48 hours, no activation | P3 | Slack alert |
| **Port-in stuck** | Port-in order INPROGRESS > 4 hours | P2 | Slack + Zendesk ticket |
| **Repeat failures** | 2+ failed orders for same customer in 7 days | P2 | Slack + Zendesk ticket |
| **Mochi escalation spike** | >20% escalation rate in last hour (baseline 10%) | P2 | Slack alert |
| **Ticket SLA breach** | Open ticket > 24 hours without response | P2 | Slack alert |

### Slack Alert Format

```
[P2] Stuck Order Detected

Customer: Jane Doe (jane@example.com)
Order: #19345 | Status: INPROGRESS | Since: 3 hours ago
Issue: Order stuck in processing for 3+ hours

Suggested Actions:
1. Check order execution timeline
2. Run RCA on the order
3. Contact ConnectX if carrier-side issue

Auto-created Zendesk ticket: #54321
```

### Schedule

- **Every 15 min**: Stuck orders, payment failures, port-in stuck
- **Every 1 hour**: eSIM not installed, Mochi escalation spike
- **Every 4 hours**: Ticket SLA breach scan
- **Daily at 9am PST**: Summary of all overnight alerts

---

## Workstream 3: Process/KB Skills (Person C)

### Goal
Encode all CS operational knowledge into structured skill files that power both Zendesk Copilot and Mochi.

### Skill Structure

```
server/skills/
  esim-troubleshooting/SKILL.md      eSIM won't install -> check Boss API -> SIM swap flow
  portin-troubleshooting/SKILL.md    Port-in failed -> carrier rejection -> collect PIN
  payment-issues/SKILL.md            Payment declined -> card issues -> retry flow
  account-management/SKILL.md        Suspend/resume/terminate -> Boss API actions
  network-connectivity/SKILL.md      No service -> outage check -> device compatibility
  airvet-support/SKILL.md            Airvet activation -> link not received -> manual push
  escalation-guide/SKILL.md          When to escalate -> who to contact -> what info needed
  mochi-handoff/SKILL.md             How to handle Mochi escalations -> context preservation
```

### What a Skill Looks Like

Each skill encodes:
- **When to use**  trigger phrases / symptom patterns
- **Diagnostic steps**  ordered steps, each referencing a specific API tool
- **Decision table**  if status = X, do Y
- **Resolution paths**  branching actions based on diagnosis
- **Escalation criteria**  when to stop trying and escalate, with what info

### How Skills Are Consumed

1. **Zendesk Copilot**  Skills loaded into Claude's system prompt. When agent asks about an eSIM issue, Claude follows the skill's diagnostic steps and suggests CTAs.
2. **Mochi** (future)  Same skills loaded into Mochi's backend. Customer says "my eSIM isn't working" -> Mochi follows the same flow, either resolves or escalates with full context.
3. **Launchmate**  Similar skills already exist. Can be cross-referenced.

### Priority Order

| # | Skill | Rationale |
|---|-------|-----------|
| 1 | `esim-troubleshooting` | #1 contact reason, most complex flow |
| 2 | `portin-troubleshooting` | #2 contact reason, involves carrier coordination |
| 3 | `payment-issues` | Common, relatively straightforward |
| 4 | `account-management` | Suspend/resume/terminate needs Boss API actions |
| 5 | `network-connectivity` | Outage checks, device compatibility |
| 6 | `escalation-guide` | When/how to escalate, what info to collect |
| 7 | `airvet-support` | Smaller scope, partner-dependent |
| 8 | `mochi-handoff` | Bot-to-human transitions |

---

## Mochi Integration (Future)

After the initial demo, connect Mochi to the same brain:

1. Mochi's backend loads the same skill files
2. Customer describes a problem -> Mochi selects the relevant skill
3. Mochi walks customer through self-service steps
4. If resolution requires agent action (SIM swap, account change), Mochi escalates with:
   - Full diagnostic context (what was tried, what failed)
   - Suggested resolution for the agent
   - Auto-created Zendesk ticket

The skills structure supports this from day one  no rework needed.

---

## CJ Dashboard Enhancement (Future)

The existing CJ Dashboard already shows payment success, eSIM activation, port-in rate, Zendesk metrics, and funnel visualizations.

Future additions (after core workstreams):
- Real-time alert status panel (active P1/P2 alerts)
- Customer SLO dashboard (how many customers in "suffering" state)
- Stuck order queue
- Mochi escalation trend line

---

## Demo Plan (First Drop)

### Script

1. **Open a Zendesk ticket** for a real customer
2. **Show auto-loaded profile**  customer info, orders, funnel stage, SIM status
3. **Show diagnosis banner**  "Customer stuck at eSIM installation for 3 days"
4. **Show SLO timer**  "Issue duration: 4 days"
5. **Click a CTA**  "Send eSIM Instructions" -> templated reply inserted
6. **Use AI Chat**  "Why did this order fail?" -> Claude runs RCA, shows timeline
7. **Show guided troubleshooting**  Select "eSIM Issue" -> step-by-step diagnosis

### What Must Be Built for Demo

| Task | Workstream | Priority |
|------|-----------|----------|
| Diagnosis banner (analyze profile, recommend actions) | 1 | Must have |
| 2-3 one-click CTAs (send reply, check outages) | 1 | Must have |
| Customer SLO timer (first ticket date) | 1 | Must have |
| 1-2 skill files (eSIM, port-in) | 3 | Must have |
| Skills loaded into Claude system prompt | 1+3 | Must have |
| Guided troubleshooting flow (at least eSIM) | 1 | Nice to have |
| Proactive alert showing in Slack | 2 | Nice to have |

---

## Implementation Timeline

### Week 1: Foundation
- [ ] Person C writes `esim-troubleshooting` and `portin-troubleshooting` skills
- [ ] Person A adds skill loader to backend (server/skills/ -> system prompt)
- [ ] Person A builds diagnosis endpoint (POST /api/customer/diagnose)
- [ ] Person B sets up alert engine scaffold (cron + Databricks queries)

### Week 2: Core Features
- [ ] Person A adds diagnosis banner + SLO timer to sidebar UI
- [ ] Person A builds 3 CTA endpoints (send-reply, check-outages, escalate)
- [ ] Person B implements stuck order + payment failure detection
- [ ] Person C writes `payment-issues` and `account-management` skills

### Week 3: Polish + Demo
- [ ] Person A adds guided troubleshooting flow for eSIM
- [ ] Person B connects alerts to Slack webhook
- [ ] Person C writes `escalation-guide` and `network-connectivity` skills
- [ ] Integration testing end-to-end
- [ ] Demo preparation

---

## File Structure

```
zendesk-app/
  assets/iframe.html              MODIFY -- add diagnosis, CTAs, SLO, guided flows
  server/
    server.js                     MODIFY -- add new routes
    tools.js                      MODIFY -- add action tools
    routes/
      customer.js                 MODIFY -- add /diagnose endpoint
      chat.js                     MODIFY -- load skills into system prompt
      actions.js                  NEW -- CTA execution routes
    lib/
      boss-api.js                 KEEP
      databricks.js               KEEP
      zendesk-api.js              KEEP
    skills/                       NEW -- Process/KB skill files
      esim-troubleshooting/SKILL.md
      portin-troubleshooting/SKILL.md
      payment-issues/SKILL.md
      account-management/SKILL.md
      network-connectivity/SKILL.md
      escalation-guide/SKILL.md
      skill-loader.js             NEW -- Reads SKILL.md files, builds prompt
    alerts/                       NEW -- Proactive alert system
      engine.js                   Alert engine (cron scheduler)
      rules.js                    Alert rule definitions
      state.js                    Dedup state tracking
      slack.js                    Slack webhook sender
      zendesk.js                  Auto-create Zendesk tickets
  manifest.json                   KEEP
  translations/en.json            KEEP
  package.json                    MODIFY -- add node-cron
  .env                            MODIFY -- add SLACK_WEBHOOK_URL
```
