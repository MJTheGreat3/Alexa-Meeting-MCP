import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// Stand-in for what the Alexa+ agent extracts from a spoken/transcribed meeting.
// In the real flow this extraction is the agent's own reasoning step, before it
// ever calls these tools — the server only does the Linear/Notion/Slack actions.
const SAMPLE_TRANSCRIPT = `
Standup - Oct 6
Priya: Checkout page still throws a 500 when the cart is empty, need someone on that today.
Dev: I'll also write up the API rate-limit doc so support stops getting paged for it.
Priya: And can someone ping #eng-standup once both are filed so folks know to stop retrying?
`;

const ACTION_ITEMS = [
  { text: "Fix 500 error on checkout page when cart is empty", owner: "Priya" },
  { text: "Write API rate-limit documentation", owner: "Dev" },
];

function textOf(result: { content: Array<{ type: string; text?: string }> }) {
  const first = result.content.find((c) => c.type === "text");
  return first?.text ?? "";
}

async function main() {
  const serverUrl = new URL(process.env.MCP_SERVER_URL ?? "http://localhost:3333/mcp");
  const transport = new StreamableHTTPClientTransport(serverUrl);
  const client = new Client({ name: "meeting-pipeline-test-client", version: "0.1.0" });
  await client.connect(transport);

  console.log("Connected. Available tools:");
  const { tools } = await client.listTools();
  console.log(tools.map((t) => t.name).join(", "));

  console.log("\n1. Listing Linear teams...");
  const teamsResult = await client.callTool({ name: "linear_list_teams", arguments: {} });
  const teams = JSON.parse(textOf(teamsResult as any));
  console.log(teams);
  const teamId = process.env.LINEAR_TEAM_ID ?? teams[0]?.id;
  if (!teamId) throw new Error("No Linear team available");

  console.log("\n2. Creating a Linear issue per action item...");
  const createdIssues: { text: string; issueUrl?: string }[] = [];
  for (const item of ACTION_ITEMS) {
    const result = await client.callTool({
      name: "linear_create_issue",
      arguments: {
        teamId,
        title: item.text,
        description: `Owner: ${item.owner}\n\nFrom meeting notes:\n${SAMPLE_TRANSCRIPT}`,
      },
    });
    const issue = JSON.parse(textOf(result as any));
    console.log(issue);
    createdIssues.push({ text: item.text, issueUrl: issue.url });
  }

  console.log("\n3. Filing the meeting summary in Notion...");
  const notionResult = await client.callTool({
    name: "notion_create_meeting_summary",
    arguments: {
      title: "Standup Summary - Oct 6",
      actionItems: createdIssues,
      rawNotes: SAMPLE_TRANSCRIPT,
    },
  });
  const notionPage = JSON.parse(textOf(notionResult as any));
  console.log(notionPage);

  console.log("\n4. Listing Slack channels...");
  const channelsResult = await client.callTool({ name: "slack_list_channels", arguments: {} });
  const channels = JSON.parse(textOf(channelsResult as any));
  console.log(channels);
  const targetChannel =
    process.env.SLACK_CHANNEL_ID ??
    channels.find((c: any) => c.name === "eng-standup")?.id ??
    channels[0]?.id;
  if (!targetChannel) throw new Error("No Slack channel available");

  console.log("\n5. Posting summary to Slack...");
  const summaryLines = [
    "Standup action items filed:",
    ...createdIssues.map((i) => `- ${i.text}${i.issueUrl ? ` (${i.issueUrl})` : ""}`),
    notionPage.url ? `Full summary: ${notionPage.url}` : undefined,
  ].filter(Boolean);
  const slackResult = await client.callTool({
    name: "slack_notify_channel",
    arguments: { channel: targetChannel, text: summaryLines.join("\n") },
  });
  console.log(JSON.parse(textOf(slackResult as any)));

  console.log("\nDone: meeting -> Linear issues + Notion summary + Slack notify, end to end.");
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
