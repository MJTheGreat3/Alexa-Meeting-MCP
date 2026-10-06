import Groq from "groq-sdk";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "groq-sdk/resources/chat/completions";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export type AgentTurn =
  | { type: "tool_call"; tool: string; args: unknown }
  | { type: "tool_result"; tool: string; result: unknown; isError?: boolean }
  | { type: "final"; text: string };

const SYSTEM_PROMPT = `You are the backend agent behind an Alexa+ voice skill for a team's meeting-to-tasks workflow. You have tools over Linear (issues), Notion (meeting summary pages), and Slack (channel messages). Each request is a separate voice turn with no memory of earlier turns, so re-discover ids (teams, issues, users, channels) with the relevant list_* tool whenever you need one you don't already have from this turn.

Two kinds of requests:

1. A fresh meeting transcript (notes from a meeting, standup, call). Do the full pipeline:
   - linear_list_teams to get a teamId.
   - Identify every concrete action item. Call linear_create_issue once per item.
   - slack_list_channels to get a channel id.
   - notion_create_meeting_summary once, with all action items (and their Linear issue URLs) plus the raw transcript.
   - slack_notify_channel once, summarizing with links.

2. A follow-up instruction about existing work - e.g. "mark X done", "remove/cancel Y", "add this detail to Z", "assign this to someone", "update the Notion page", "edit that Slack message". Do NOT re-run the full pipeline. Instead:
   - Find the right item first: linear_list_issues (by team) to resolve an issue by title/description, or use an identifier/id already mentioned.
   - To assign or mention a person, resolve their id first with linear_list_users (Linear) or slack_list_users (Slack) - match by name. For a Slack mention, include <@USER_ID> in the message text.
   - Use the single targeted tool for the change: linear_update_issue (edit), linear_set_issue_status (complete/reopen/etc.), linear_archive_issue (remove), linear_add_comment (add detail/notes), notion_append_notes (add detail to a page), notion_set_action_item_checked (check off an item on a summary page), notion_archive_page (remove a page), slack_update_message (edit a posted message).

In both cases, make reasonable choices and proceed without asking the user clarifying questions. Reply with a short, spoken-style confirmation of what you did, suitable for a voice assistant to read aloud.`;

function textOf(result: { content: Array<{ type: string; text?: string }> }) {
  const first = result.content.find((c) => c.type === "text");
  return first?.text ?? "";
}

export async function runMeetingPipelineTurn(transcript: string): Promise<{
  turns: AgentTurn[];
  finalText: string;
}> {
  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) throw new Error("GROQ_API_KEY is not set");
  const groq = new Groq({ apiKey: groqApiKey });
  const model = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";

  const serverUrl = new URL(process.env.MCP_SERVER_URL ?? "http://localhost:3333/mcp");
  const transport = new StreamableHTTPClientTransport(serverUrl);
  const mcpClient = new Client({ name: "route-b-agent", version: "0.1.0" });
  await mcpClient.connect(transport);

  const turns: AgentTurn[] = [];

  try {
    const { tools: mcpTools } = await mcpClient.listTools();
    const tools: ChatCompletionTool[] = mcpTools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description ?? "",
        parameters: t.inputSchema as Record<string, unknown>,
      },
    }));

    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: transcript },
    ];

    const MAX_ITERATIONS = 30;
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const completion = await groq.chat.completions.create({
        model,
        messages,
        tools,
        tool_choice: "auto",
      });
      const message = completion.choices[0].message;

      if (!message.tool_calls || message.tool_calls.length === 0) {
        const finalText = message.content ?? "Done.";
        turns.push({ type: "final", text: finalText });
        return { turns, finalText };
      }

      messages.push({
        role: "assistant",
        content: message.content,
        tool_calls: message.tool_calls,
      });

      for (const toolCall of message.tool_calls) {
        const args = JSON.parse(toolCall.function.arguments || "{}");
        turns.push({ type: "tool_call", tool: toolCall.function.name, args });

        const result = await mcpClient.callTool({
          name: toolCall.function.name,
          arguments: args,
        });
        const resultText = textOf(result as any);
        turns.push({
          type: "tool_result",
          tool: toolCall.function.name,
          result: (() => {
            try {
              return JSON.parse(resultText);
            } catch {
              return resultText;
            }
          })(),
          isError: Boolean((result as any).isError),
        });

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: resultText,
        });
      }
    }

    const finalText = "Reached the step limit before finishing - check the tool log above.";
    turns.push({ type: "final", text: finalText });
    return { turns, finalText };
  } finally {
    await mcpClient.close();
  }
}
