# Meeting-to-Tasks MCP Server

A real [Model Context Protocol](https://modelcontextprotocol.io) server (Streamable HTTP transport) that turns meeting notes into coordinated action across three business systems:

**Meeting notes/transcript → Linear issues → Notion summary → Slack notification**

An actual MCP server with real tool handlers that make live API calls to Linear, Notion, and Slack — not a mock. It's designed so an agent (Alexa+, or any MCP-speaking client) can drive the whole workflow by calling these tools in sequence after reasoning over a meeting transcript, and to handle natural follow-ups afterward (mark something done, reassign it, edit a Notion page, remove a task) without needing raw ids — the agent resolves names via its own discovery tools first.

## Architecture

```
src/
  server.ts            MCP server definition, registers all tools
  index.ts             Express app, Streamable HTTP transport, entry point
  tools/
    linear.ts           Linear SDK calls
    notion.ts           Notion SDK calls
    slack.ts             Slack SDK calls
  client/
    testClient.ts       Scripted end-to-end MCP client harness
  webapp/
    agent.ts             Groq tool-calling loop: connects to the MCP server as a
                          real client, lets the LLM decide which tools to call
    server.ts            Express app: /api/voice-turn (agent, streamed as NDJSON),
                          /api/transcribe (Groq Whisper), + serves the static HTML UI
    public/index.html     Static HTML voice-turn UI (alternate to Streamlit)
streamlit_app/
  app.py                 Streamlit voice-turn UI (primary), calls the same backend
  requirements.txt
```

The extraction of action items from raw meeting text is the *agent's* reasoning step (Alexa+, Claude, etc.) — it happens before any tool call. The server itself only performs the deterministic actions once the agent has decided what to do.

## Tools exposed

**Linear** — `linear_list_teams`, `linear_list_users`, `linear_list_issues`, `linear_create_issue`, `linear_update_issue`, `linear_set_issue_status`, `linear_archive_issue`, `linear_add_comment`

**Notion** — `notion_search_pages`, `notion_create_meeting_summary`, `notion_append_notes`, `notion_set_action_item_checked`, `notion_archive_page`

**Slack** — `slack_list_channels`, `slack_list_users`, `slack_list_recent_messages`, `slack_notify_channel`, `slack_update_message`

The `list_*`/`search_*` tools exist so the agent can resolve something the user names in plain language (a team, a person, a page, a past message) into the id another tool needs, without the user ever having to supply one.

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
   - **Slack**: Create an app at [api.slack.com/apps](https://api.slack.com/apps), add OAuth scopes `chat:write`, `channels:read`, `groups:read`, `users:read`, `channels:history`, install it to your workspace, and copy the Bot User OAuth Token into `SLACK_BOT_TOKEN`. Invite the bot to whichever channel you want it posting in.

3. Start the MCP server:
   ```
   npm run dev
   ```
   Listens on `http://localhost:3333/mcp` (Streamable HTTP, stateless mode).

4. In another terminal, run the end-to-end test client. It connects as a real MCP client, lists the tools, and drives a sample meeting transcript through the full pipeline (2 Linear issues → 1 Notion page → 1 Slack message):
   ```
   npm run test:client
   ```

## Voice-turn UI

A UI that mimics a voice interaction, backed by a real LLM tool-calling agent (not scripted) that drives the same MCP server over the same Streamable HTTP transport. Two frontends ship against the same backend — pick either, or run both.

Shared backend (`src/webapp/server.ts`, port 3334):
1. Get a free Groq API key at [console.groq.com/keys](https://console.groq.com/keys) (no card needed), set `GROQ_API_KEY` in `.env`.
2. With the MCP server already running (`npm run dev`), start the backend in another terminal:
   ```
   npm run webapp
   ```

What happens under the hood: a frontend posts the transcript to `/api/voice-turn`, which streams back each step as it happens (NDJSON) → the backend (`src/webapp/agent.ts`) connects to the MCP server as a real MCP client, fetches the live tool list, and hands it to Groq (`openai/gpt-oss-120b`) as function-calling tools. The model itself decides what to do and which tools to call, in what order — a genuine agent loop, not a hardcoded script.

### Frontend: Streamlit (primary)

```
cd streamlit_app
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
streamlit run app.py
```
Open `http://localhost:8501`. Record meeting notes with the mic (`st.audio_input`) — real speech-to-text via Groq Whisper (`/api/transcribe`), no browser speech API involved — or type/paste them, then "Send to agent." Tool calls and results render collapsed by default; the final response is always visible.

### Frontend: static HTML (alternate)

Served directly by the backend at `http://localhost:3334` (`src/webapp/public/index.html`). Uses the browser's Web Speech API for voice input (flakier — depends on Chrome reaching Google's speech backend over the network) and `speechSynthesis` to speak the final reply aloud.
