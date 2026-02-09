# Customer Experience Tracker (CX Brain)

Track and analyze overall customer experience by examining DSAT, NPS, escalations, repeat tickets, and generating experience outcomes for specified time periods.

## Description

This skill analyzes customer service data to provide a comprehensive view of customer experience metrics. It processes ticket data, survey responses, and escalation records to calculate key performance indicators and trends.

## Triggers

- "analyze customer experience"
- "customer experience report"
- "CX metrics"
- "DSAT analysis"
- "NPS report"
- "escalation analysis"
- "repeat ticket analysis"
- "WTD customer metrics"
- "MTD customer metrics"

## Instructions

When analyzing customer experience, follow these steps:

### 1. Data Collection
Identify and read the relevant data sources:
- Customer tickets file (e.g., `Customer tickets.xlsx` or CSV files)
- Survey/feedback data containing DSAT and NPS scores
- Escalation logs
- Ticket history for repeat ticket identification

### 2. Time Period Selection
Determine the analysis period based on user request:
- **WTD (Week to Date)**: From Monday of current week to today
- **MTD (Month to Date)**: From 1st of current month to today
- **QTD (Quarter to Date)**: From start of current quarter to today
- **YTD (Year to Date)**: From January 1st to today
- **Custom Range**: Any user-specified date range

### 3. Metrics Calculation

#### DSAT (Dissatisfaction) Analysis
- Calculate DSAT rate: (Dissatisfied responses / Total responses) x 100
- Identify top DSAT drivers (categories, agents, issue types)
- Compare against previous period

#### NPS (Net Promoter Score) Analysis
- Calculate NPS: % Promoters (9-10) - % Detractors (0-6)
- Segment by Promoters (9-10), Passives (7-8), Detractors (0-6)
- Track NPS trend over time

#### Escalation Analysis
- Total escalations count
- Escalation rate: (Escalated tickets / Total tickets) x 100
- Escalation reasons breakdown
- Time to escalation average

#### Repeat Tickets Analysis
- Identify tickets from same customer within 7 days on same issue
- Repeat ticket rate: (Repeat tickets / Total tickets) x 100
- Root cause analysis of repeat contacts

### 4. Overall Experience Score Calculation

Calculate the **Customer Experience Score (CXS)** using weighted metrics:

```
CXS = 100 - (DSAT_Impact + Escalation_Impact + Repeat_Impact) + NPS_Bonus

Where:
- DSAT_Impact = DSAT_Rate x 0.3
- Escalation_Impact = Escalation_Rate x 0.25
- Repeat_Impact = Repeat_Rate x 0.25
- NPS_Bonus = (NPS + 100) / 200 x 20  (normalized 0-20 points)
```

### 5. Output Report Format

Generate a report with the following structure:

```
## Customer Experience Report
**Period:** [WTD/MTD/Custom] ([Start Date] - [End Date])

### Executive Summary
- Overall CX Score: [X]/100 ([trend vs previous period])
- Key Highlights: [2-3 bullet points]

### Detailed Metrics

| Metric | Current | Previous | Change |
|--------|---------|----------|--------|
| DSAT Rate | X% | X% | [+/-]X% |
| NPS | X | X | [+/-]X |
| Escalation Rate | X% | X% | [+/-]X% |
| Repeat Ticket Rate | X% | X% | [+/-]X% |

### DSAT Breakdown
- Top 3 dissatisfaction drivers
- Recommendations for improvement

### Escalation Analysis
- Top escalation reasons
- High-escalation categories

### Repeat Tickets
- Common repeat issue themes
- First-contact resolution opportunities

### Recommendations
1. [Priority action item]
2. [Secondary action item]
3. [Improvement suggestion]
```

## Parameters

- `period`: Time period for analysis (WTD, MTD, QTD, YTD, or custom date range)
- `data_source`: Path to customer tickets/data file
- `compare_previous`: Whether to include comparison with previous period (default: true)
- `include_agent_breakdown`: Include per-agent metrics (default: false)
- `category_filter`: Filter by specific ticket categories (optional)

## Example Usage

```
Analyze customer experience for MTD and compare with last month
```

```
Generate WTD CX report focusing on escalations
```

```
Show me the repeat ticket analysis for January 2026
```

## Notes

- Ensure data files are accessible and in supported formats (XLSX, CSV, JSON)
- For accurate repeat ticket detection, ticket data should include customer ID and issue category
- NPS data requires survey responses with 0-10 rating scale
- DSAT can be derived from satisfaction surveys (1-5 scale where 1-2 = dissatisfied)
