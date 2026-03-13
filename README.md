# @t-campbell18/mcp-mixpanel

[![npm version](https://img.shields.io/npm/v/@t-campbell18/mcp-mixpanel)](https://www.npmjs.com/package/@t-campbell18/mcp-mixpanel)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An MCP (Model Context Protocol) server that wraps the Mixpanel REST API. Query events, funnels, retention, user profiles, and more — directly from any MCP-compatible AI agent.

## Quick Start

```bash
npm install -g @t-campbell18/mcp-mixpanel
```

Set the required environment variables and run:

```bash
export MIXPANEL_PROJECT_ID="your-project-id"
export MIXPANEL_SERVICE_ACCOUNT_USERNAME="your-username"
export MIXPANEL_SERVICE_ACCOUNT_PASSWORD="your-password"
mcp-mixpanel
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `MIXPANEL_PROJECT_ID` | **Yes** | Your Mixpanel project ID |
| `MIXPANEL_SERVICE_ACCOUNT_USERNAME` | One auth method | Service account username |
| `MIXPANEL_SERVICE_ACCOUNT_PASSWORD` | One auth method | Service account password |
| `MIXPANEL_API_SECRET` | One auth method | Project API secret (legacy) |
| `MIXPANEL_REGION` | No | `US` (default) or `EU` |

## Authentication

At least one authentication method is required:

1. **Service Account** (recommended): Set both `MIXPANEL_SERVICE_ACCOUNT_USERNAME` and `MIXPANEL_SERVICE_ACCOUNT_PASSWORD`. Service accounts support all query and export endpoints.
2. **API Secret** (legacy): Set `MIXPANEL_API_SECRET`. Falls back to this if no service account is configured.

## Tools

### Query API

| Tool | Description | Example Prompt |
|---|---|---|
| `query_events` | Query event data with segmentation | "How many signups happened last week?" |
| `top_events` | Get the most common events | "What are the top events today?" |
| `event_properties` | Get top properties for an event | "What properties does the Purchase event have?" |
| `query_funnels` | Query a saved funnel | "Show me conversion for funnel 12345" |
| `list_funnels` | List all saved funnels | "What funnels do we have?" |
| `query_retention` | Query retention data | "What's our 7-day retention for signups?" |
| `frequency_report` | Get frequency/addiction report | "How often do users perform the Search event?" |
| `query_profiles` | Query user profiles | "Find users who were last seen after Jan 1" |
| `user_activity` | Get a user's event stream | "Show me recent activity for user abc123" |
| `query_insights` | Run a saved Insights report | "Run insights report 67890" |
| `run_jql` | Run a JQL script | "Run this JQL to find power users" |
| `segmentation_sum` | Sum a numeric property over time | "What's total revenue this month?" |
| `segmentation_average` | Average a numeric property over time | "What's the average order value this week?" |
| `list_cohorts` | List all cohorts | "What cohorts do we have?" |

### Export API

| Tool | Description | Example Prompt |
|---|---|---|
| `export_events` | Export raw event data (NDJSON, max 5000) | "Export all Purchase events from last week" |

### Annotations

| Tool | Description | Example Prompt |
|---|---|---|
| `list_annotations` | List annotations in a date range | "Show annotations from this month" |

## Setup

### Claude Code

```bash
claude mcp add mixpanel -- npx -y @t-campbell18/mcp-mixpanel
```

Set environment variables in your shell before running Claude Code.

### Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "mixpanel": {
      "command": "npx",
      "args": ["-y", "@t-campbell18/mcp-mixpanel"],
      "env": {
        "MIXPANEL_PROJECT_ID": "your-project-id",
        "MIXPANEL_SERVICE_ACCOUNT_USERNAME": "your-username",
        "MIXPANEL_SERVICE_ACCOUNT_PASSWORD": "your-password"
      }
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "mixpanel": {
      "command": "npx",
      "args": ["-y", "@t-campbell18/mcp-mixpanel"],
      "env": {
        "MIXPANEL_PROJECT_ID": "your-project-id",
        "MIXPANEL_SERVICE_ACCOUNT_USERNAME": "your-username",
        "MIXPANEL_SERVICE_ACCOUNT_PASSWORD": "your-password"
      }
    }
  }
}
```

### VS Code

Add to your VS Code MCP settings (`.vscode/mcp.json`):

```json
{
  "servers": {
    "mixpanel": {
      "command": "npx",
      "args": ["-y", "@t-campbell18/mcp-mixpanel"],
      "env": {
        "MIXPANEL_PROJECT_ID": "your-project-id",
        "MIXPANEL_SERVICE_ACCOUNT_USERNAME": "your-username",
        "MIXPANEL_SERVICE_ACCOUNT_PASSWORD": "your-password"
      }
    }
  }
}
```

### OpenClaw

```yaml
mcp_servers:
  - name: mixpanel
    command: npx
    args: ["-y", "@t-campbell18/mcp-mixpanel"]
    env:
      MIXPANEL_PROJECT_ID: "your-project-id"
      MIXPANEL_SERVICE_ACCOUNT_USERNAME: "your-username"
      MIXPANEL_SERVICE_ACCOUNT_PASSWORD: "your-password"
```

## EU Region

If your Mixpanel project is in the EU data residency, set:

```bash
export MIXPANEL_REGION=EU
```

This routes all API calls to Mixpanel's EU endpoints automatically.

## License

MIT
