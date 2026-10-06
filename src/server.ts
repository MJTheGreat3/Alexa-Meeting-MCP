import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as linear from "./tools/linear.js";
import * as notion from "./tools/notion.js";
import * as slack from "./tools/slack.js";

function text(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function errorText(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

export function buildServer() {
  const server = new McpServer({
    name: "meeting-pipeline-mcp",
    version: "0.1.0",
  });

  server.registerTool(
    "linear_list_teams",
    {
      title: "List Linear Teams",
      description:
        "List Linear teams visible to this API key, with their ids. Call this first to find the teamId needed by linear_create_issue.",
      inputSchema: {},
    },
    async () => {
      try {
        return text(await linear.listTeams());
      } catch (err) {
        return errorText(err);
      }
    },
  );

  server.registerTool(
    "linear_create_issue",
    {
      title: "Create Linear Issue",
      description:
        "Create a single Linear issue for one action item extracted from a meeting. Use linear_list_teams first to get a valid teamId.",
      inputSchema: {
        teamId: z.string().describe("Linear team id, from linear_list_teams"),
        title: z.string().describe("Short action-item title"),
        description: z.string().optional().describe("Extra context pulled from the meeting notes"),
      },
    },
    async ({ teamId, title, description }) => {
      try {
        return text(await linear.createIssue({ teamId, title, description }));
      } catch (err) {
        return errorText(err);
      }
    },
  );

  server.registerTool(
    "notion_create_meeting_summary",
    {
      title: "Create Notion Meeting Summary",
      description:
        "File a structured meeting summary page in Notion: action items (optionally linked to their Linear issue URLs) plus the raw notes/transcript.",
      inputSchema: {
        title: z.string().describe("Meeting summary page title, e.g. 'Standup 2026-10-06'"),
        actionItems: z
          .array(
            z.object({
              text: z.string(),
              issueUrl: z.string().optional().describe("Linked Linear issue URL, if one was created"),
            }),
          )
          .describe("Action items extracted from the meeting"),
        rawNotes: z.string().describe("The original meeting notes or transcript text"),
      },
    },
    async ({ title, actionItems, rawNotes }) => {
      try {
        return text(await notion.createMeetingSummary({ title, actionItems, rawNotes }));
      } catch (err) {
        return errorText(err);
      }
    },
  );

  server.registerTool(
    "slack_list_channels",
    {
      title: "List Slack Channels",
      description:
        "List Slack channels the bot can see, with their ids. Call this first to find the channel id needed by slack_notify_channel.",
      inputSchema: {},
    },
    async () => {
      try {
        return text(await slack.listChannels());
      } catch (err) {
        return errorText(err);
      }
    },
  );

  server.registerTool(
    "slack_notify_channel",
    {
      title: "Notify Slack Channel",
      description:
        "Post a summary message to a Slack channel, e.g. announcing the action items and links created from a meeting.",
      inputSchema: {
        channel: z.string().describe("Slack channel id, from slack_list_channels"),
        text: z.string().describe("Message text to post"),
      },
    },
    async ({ channel, text: messageText }) => {
      try {
        return text(await slack.notifyChannel({ channel, text: messageText }));
      } catch (err) {
        return errorText(err);
      }
    },
  );

  return server;
}
