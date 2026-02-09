# CS Intelligence Platform

AI-powered customer service copilot for Meow Mobile, integrating Claude with Zendesk.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      ZENDESK AGENT WORKSPACE                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    Ticket View                            │   │
│  │  ┌────────────────────────────────────────────────────┐  │   │
│  │  │              CS Copilot Sidebar                     │  │   │
│  │  │  • Auto-loads customer profile                     │  │   │
│  │  │  • Quick actions (Diagnose, Draft, Escalate)       │  │   │
│  │  │  • AI chat for agent questions                     │  │   │
│  │  └────────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      EXPRESS SERVER                              │
│  POST /api/chat                                                  │
│  • Loads skills from .claude/skills/*.md                        │
│  • Injects into Claude system prompt                            │
│  • Connects to Boss API, Databricks, Zendesk                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      CLAUDE API                                  │
│  • Skills provide troubleshooting flows                         │
│  • Tools enable real-time data lookups                          │
│  • Returns diagnosis + recommended actions                       │
└─────────────────────────────────────────────────────────────────┘
```

## Project Structure

```
Cxbrainskill/
├── .claude/
│   └── skills/                    # CS Knowledge Base
│       ├── cs-agent-guide.md      # Master routing skill
│       ├── esim-troubleshooting.md
│       ├── portin-troubleshooting.md
│       ├── payment-issues.md
│       ├── network-connectivity.md
│       ├── account-management.md
│       ├── escalation-guide.md
│       ├── airvet-support.md
│       ├── mochi-handoff.md
│       ├── email-handling.md
│       └── cxbrain.md
│
├── server/                        # Backend Server
│   ├── server.js                  # Express app
│   ├── package.json
│   ├── .env.example
│   ├── lib/
│   │   └── skill-loader.js        # Loads skills into prompt
│   └── routes/
│       └── chat.js                # AI chat endpoint
│
├── zendesk-app/                   # Zendesk Sidebar App
│   ├── manifest.json              # ZAF configuration
│   └── assets/
│       ├── iframe.html            # Sidebar UI
│       └── main.js                # Frontend logic
│
└── README.md
```

## Setup

### 1. Install Server Dependencies

```bash
cd server
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your API keys:
# - ANTHROPIC_API_KEY
# - BOSS_API_URL / BOSS_API_TOKEN
# - ZENDESK credentials
# - DATABRICKS credentials
```

### 3. Start the Server

```bash
npm start
# Or for development with auto-reload:
npm run dev
```

### 4. Test Skills Loading

```bash
npm run test-skills
# Should output list of loaded skills
```

### 5. Deploy Zendesk App

```bash
cd zendesk-app

# Install ZCLI (Zendesk CLI) if not installed
npm install -g @zendesk/zcli

# Validate the app
zcli apps:validate

# Deploy to Zendesk
zcli apps:create
```

## How It Works

### Skills

Skills are markdown files that teach Claude how to handle specific issue types:

- **Triggers**: Phrases that activate the skill
- **Diagnostic flows**: Step-by-step troubleshooting
- **Decision trees**: If X, do Y
- **Response templates**: Pre-written customer messages
- **Escalation criteria**: When to hand off

### Example Flow

1. Agent opens ticket for customer with eSIM issue
2. Sidebar auto-loads customer profile via Boss API
3. Agent clicks "Diagnose" or asks a question
4. Server loads all skills into Claude's context
5. Claude follows `esim-troubleshooting` skill:
   - Checks order status
   - Checks eSIM provisioning state
   - Identifies root cause
6. Returns diagnosis + recommended action + draft response
7. Agent sends response or takes recommended action

### Supported Channels

Skills automatically adjust response style based on channel:

| Channel | Style |
|---------|-------|
| Email | Professional, thorough, well-formatted |
| Mochi Chat | Conversational, quick |
| Facebook/Instagram | Friendly, casual |
| Web Widget | Balanced |

## API Endpoints

### POST /api/chat

Send a message to the AI assistant.

```json
{
  "message": "Customer can't activate eSIM, what should I do?",
  "ticketId": "12345",
  "customerEmail": "customer@example.com",
  "channel": "email",
  "subject": "Can't activate eSIM",
  "conversationHistory": []
}
```

Response:
```json
{
  "response": "## Diagnosis for Jane Doe\n\n**Issue:** eSIM not installed...",
  "conversationHistory": [...]
}
```

### GET /api/skills

List available skills.

### POST /api/chat/reload-skills

Force reload skills from disk.

## Adding New Skills

1. Create a new `.md` file in `.claude/skills/`
2. Follow the skill template:

```markdown
# Skill Name

Brief description.

## Triggers
- "phrase that activates this"

## Diagnostic Flow
### Step 1: ...
### Step 2: ...

## Response Templates
...

## Escalation Criteria
...
```

3. Restart server or call `/api/chat/reload-skills`

## Connecting APIs

The `chat.js` file has placeholder functions for API calls. Replace with actual implementations:

```javascript
async function callBossAPI(endpoint, method, body) {
  const response = await fetch(`${process.env.BOSS_API_URL}${endpoint}`, {
    method,
    headers: {
      'Authorization': `Bearer ${process.env.BOSS_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : null
  });
  return response.json();
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Claude API key |
| `PORT` | Server port (default: 3000) |
| `BOSS_API_URL` | Internal customer data API |
| `BOSS_API_TOKEN` | Boss API authentication |
| `ZENDESK_SUBDOMAIN` | Your Zendesk subdomain |
| `ZENDESK_EMAIL` | Zendesk API user email |
| `ZENDESK_API_TOKEN` | Zendesk API token |
| `DATABRICKS_HOST` | Databricks workspace URL |
| `DATABRICKS_TOKEN` | Databricks access token |
| `DATABRICKS_WAREHOUSE_ID` | SQL warehouse ID |
