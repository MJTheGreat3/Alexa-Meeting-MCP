# Meeting-to-Tasks MCP Server

Built for Amazon's "Build, Ship, Shape" Developer Hackathon 2026 — Alexa+ track.

A real [Model Context Protocol](https://modelcontextprotocol.io) server (Streamable HTTP transport) that turns meeting notes into coordinated action across three business systems:

**Meeting notes/transcript → Linear issues → Notion summary → Slack notification**

This is the "Route A" implementation: an actual MCP server with real tool handlers that make live API calls to Linear, Notion, and Slack — not a mock or a README-only claim. It's designed so an agent (Alexa+, or any MCP-speaking client) can drive the whole workflow by calling these tools in sequence after reasoning over a meeting transcript.

## Why this workflow

Rather than exposing generic CRUD tools per system, the server is scoped tightly around one deep, end-to-end pipeline: extract action items from a meeting, file them as tracked work, summarize the meeting durably, and notify the team — all from a single spoken or typed request.

## Architecture

```
src/
  server.ts            MCP server definition, registers all 5 tools
  index.ts             Express app, Streamable HTTP transport, entry point
  tools/
    linear.ts           Linear SDK calls (list teams, create issue)
    notion.ts           Notion SDK calls (create meeting summary page)
    slack.ts             Slack SDK calls (list channels, post message)
  client/
    testClient.ts       Scripted end-to-end MCP client harness (Route A proof)
  webapp/
    agent.ts             Groq tool-calling loop: connects to the MCP server as a
                          real client, lets the LLM decide which tools to call
    server.ts            Express app serving the simulator UI + /api/voice-turn
    public/index.html     Simulated Alexa+ voice-turn UI (mic input + spoken reply)
```

The extraction of action items from raw meeting text is the *agent's* reasoning step (Alexa+, Claude, etc.) — it happens before any tool call. The server itself only performs the deterministic actions once the agent has decided what to do: create this issue, file this summary, notify this channel.

## Tools exposed

| Tool | System | Purpose |
|---|---|---|
| `linear_list_teams` | Linear | Discover team ids (needed before creating an issue) |
| `linear_create_issue` | Linear | Create one issue for one action item |
| `notion_create_meeting_summary` | Notion | File a structured summary page: action items (linked to their Linear issues) + raw notes |
| `slack_list_channels` | Slack | Discover channel ids (needed before notifying) |
| `slack_notify_channel` | Slack | Post a message to a channel |

## Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in real credentials:
   ```
   cp .env.example .env
   ```

   - **Linear**: Settings → API → Personal API keys → create one. Copy a team id from `linear_list_teams` output (or Linear's UI) into `LINEAR_TEAM_ID`.
   - **Notion**: Create an integration at [notion.so/my-integrations](https://www.notion.so/my-integrations), copy its secret into `NOTION_API_KEY`. Then share a parent page with that integration in Notion's UI and copy that page's id into `NOTION_PARENT_PAGE_ID`.
   - **Slack**: Create an app at [api.slack.com/apps](https://api.slack.com/apps), add OAuth scopes `chat:write`, `channels:read`, `groups:read`, install it to your workspace, and copy the Bot User OAuth Token into `SLACK_BOT_TOKEN`. Invite the bot to whichever channel you want it posting in.

3. Start the MCP server:
   ```
   npm run dev
   ```
   Listens on `http://localhost:3333/mcp` (Streamable HTTP, stateless mode).

4. In another terminal, run the end-to-end test client. It connects as a real MCP client, lists the tools, and drives a sample meeting transcript through the full pipeline (2 Linear issues → 1 Notion page → 1 Slack message):
   ```
   npm run test:client
   ```

## Route B: simulated Alexa+ voice-turn UI

A web UI that mimics an Alexa+ voice interaction, backed by a real LLM tool-calling agent (not scripted) that drives the same MCP server over the same Streamable HTTP transport.

1. Get a free Groq API key at [console.groq.com/keys](https://console.groq.com/keys) (no card needed), set `GROQ_API_KEY` in `.env`.
2. With the MCP server already running (`npm run dev`), start the simulator in another terminal:
   ```
   npm run webapp
   ```
3. Open `http://localhost:3334`. Tap the mic (uses the browser's Web Speech API) or type/paste meeting notes, then "Send to agent."

What happens under the hood: the browser posts the transcript to `/api/voice-turn` → the backend (`src/webapp/agent.ts`) connects to the MCP server as a real MCP client, fetches the live tool list, and hands it to Groq (`openai/gpt-oss-120b`) as function-calling tools. The model itself decides what action items exist and which tools to call, in what order — the UI streams back each tool call/result as a conversation turn, then speaks the final spoken-style summary aloud via `speechSynthesis`.

This is a genuine agent loop, not a hardcoded script — swap the Groq call for a real Alexa+ Agent Skill invocation later and the MCP server underneath doesn't change.

## Status

- [x] Real MCP server, Streamable HTTP transport, spec 2025-06-18
- [x] Live tool handlers for Linear, Notion, Slack (official TypeScript SDKs: `@linear/sdk`, `@notionhq/client`, `@slack/web-api`)
- [x] End-to-end test client proving the full tool-call loop works against real APIs
- [x] Simulated Alexa+ voice-turn UI ("Route B" companion), real Groq tool-calling agent, fronting this same server
- [ ] Real Alexa+ Agent Skill integration, pending device/skill access during the hackathon window

## Hackathon compliance note

This satisfies the stricter "real MCP server" requirement (Route A): a working MCP server implementation with real tool handlers making live API calls, plus real clients (the test harness, and the Route B agent) that connect to and invoke it over the real Streamable HTTP transport.

It also satisfies the simulated-experience path (Route B) independently: a web app that mimics the Alexa+ voice interaction, backed by a real agent loop (Groq function-calling) driving a real backend — not a mockup with hardcoded responses. Same MCP server underneath either way, so if real Alexa+ device access becomes available during the hackathon, it plugs in without touching the server.