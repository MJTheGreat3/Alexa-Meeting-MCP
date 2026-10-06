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

const SYSTEM_PROMPT = `You are the backend agent behind an Alexa+ voice skill that turns meeting notes into coordinated team action. You have tools to create Linear issues, file a Notion meeting summary, and notify a Slack channel.

Given a meeting transcript, do all of the following in order:
1. Call linear_list_teams to get a valid teamId (unless already known from this conversation).
2. Identify every concrete action item in the transcript. Call linear_create_issue once per action item, using that teamId.
3. Call slack_list_channels to get a valid channel id (unless already known).
4. Call notion_create_meeting_summary once, with all action items and their Linear issue URLs, plus the raw transcript.
5. Call slack_notify_channel once, posting a short summary with links to the created issues and the Notion page.

Then reply with a short, spoken-style confirmation summarizing what you did, suitable for a voice assistant to read aloud. Do not ask the user clarifying questions - make reasonable choices and proceed.`;

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

    const MAX_ITERATIONS = 10;
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
