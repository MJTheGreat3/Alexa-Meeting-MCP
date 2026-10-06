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
    "linear_list_users",
    {
      title: "List Linear Users",
      description:
        "List workspace members and their user ids. Use this to find an assigneeId for linear_create_issue or linear_update_issue.",
      inputSchema: {},
    },
    async () => {
      try {
        return text(await linear.listUsers());
      } catch (err) {
        return errorText(err);
      }
    },
  );

  server.registerTool(
    "linear_list_issues",
    {
      title: "List Linear Issues",
      description:
        "List issues on a team, with their identifiers (e.g. MEE-7), titles, state, and assignee. Use this to find the right issue before updating, completing, or archiving it.",
      inputSchema: {
        teamId: z.string().describe("Linear team id, from linear_list_teams"),
        includeCompleted: z
          .boolean()
          .optional()
          .describe("Include done/canceled issues too (default: only open issues)"),
      },
    },
    async ({ teamId, includeCompleted }) => {
      try {
        return text(await linear.listIssues({ teamId, includeCompleted }));
      } catch (err) {
        return errorText(err);
      }
    },
  );

  server.registerTool(
    "linear_update_issue",
    {
      title: "Update Linear Issue",
      description:
        "Edit an existing Linear issue's title, description, or assignee. Use the issue identifier (e.g. MEE-7) from linear_list_issues or a prior tool result.",
      inputSchema: {
        idOrIdentifier: z.string().describe("Issue id or identifier, e.g. MEE-7"),
        title: z.string().optional(),
        description: z.string().optional(),
        assigneeId: z.string().optional().describe("User id to assign, from linear_list_users"),
      },
    },
    async ({ idOrIdentifier, title, description, assigneeId }) => {
      try {
        return text(await linear.updateIssue({ idOrIdentifier, title, description, assigneeId }));
      } catch (err) {
        return errorText(err);
      }
    },
  );

  server.registerTool(
    "linear_set_issue_status",
    {
      title: "Set Linear Issue Status",
      description:
        "Move a Linear issue to a new workflow status, e.g. mark it done, in progress, or back to backlog.",
      inputSchema: {
        idOrIdentifier: z.string().describe("Issue id or identifier, e.g. MEE-7"),
        status: z.enum(["backlog", "todo", "in_progress", "done", "canceled"]),
      },
    },
    async ({ idOrIdentifier, status }) => {
      try {
        return text(await linear.setIssueStatus({ idOrIdentifier, status }));
      } catch (err) {
        return errorText(err);
      }
    },
  );

  server.registerTool(
    "linear_archive_issue",
    {
      title: "Archive Linear Issue",
      description:
        "Remove an issue by archiving it (Linear's reversible soft-delete, recoverable from trash). Use when the user asks to remove, delete, or cancel a task entirely rather than just marking it done.",
      inputSchema: {
        idOrIdentifier: z.string().describe("Issue id or identifier, e.g. MEE-7"),
      },
    },
    async ({ idOrIdentifier }) => {
      try {
        return text(await linear.archiveIssue({ idOrIdentifier }));
      } catch (err) {
        return errorText(err);
      }
    },
  );

  server.registerTool(
    "linear_add_comment",
    {
      title: "Add Linear Comment",
      description:
        "Add a comment to an existing Linear issue, e.g. extra detail from a follow-up meeting, or an update for a teammate.",
      inputSchema: {
        idOrIdentifier: z.string().describe("Issue id or identifier, e.g. MEE-7"),
        body: z.string().describe("Comment text (Markdown supported)"),
      },
    },
    async ({ idOrIdentifier, body }) => {
      try {
        return text(await linear.addComment({ idOrIdentifier, body }));
      } catch (err) {
        return errorText(err);
      }
    },
  );

  server.registerTool(
    "notion_search_pages",
    {
      title: "Search Notion Pages",
      description:
        "Find existing Notion pages by title/keyword, with their ids and urls. Use this to resolve a page the user refers to by name (e.g. 'the standup summary') before appending notes, checking off items, or archiving it. Returns most recently edited first.",
      inputSchema: {
        query: z.string().optional().describe("Title/keyword to search for, omit to list recent pages"),
      },
    },
    async ({ query }) => {
      try {
        return text(await notion.searchPages({ query }));
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
    "notion_append_notes",
    {
      title: "Append Notion Notes",
      description:
        "Add more detail to an existing Notion meeting summary page, e.g. follow-up notes or extra context, without overwriting what's already there.",
      inputSchema: {
        pageId: z.string().describe("Notion page id, from notion_create_meeting_summary"),
        text: z.string().describe("Text to append as a new paragraph"),
      },
    },
    async ({ pageId, text: noteText }) => {
      try {
        return text(await notion.appendNotes({ pageId, text: noteText }));
      } catch (err) {
        return errorText(err);
      }
    },
  );

  server.registerTool(
    "notion_set_action_item_checked",
    {
      title: "Check Off Notion Action Item",
      description:
        "Mark an action item checkbox as done (or not done) on a Notion meeting summary page. Match the item by a substring of its text.",
      inputSchema: {
        pageId: z.string().describe("Notion page id, from notion_create_meeting_summary"),
        itemText: z.string().describe("Substring of the action item's text to match"),
        checked: z.boolean().describe("true to mark complete, false to uncheck"),
      },
    },
    async ({ pageId, itemText, checked }) => {
      try {
        return text(await notion.setActionItemChecked({ pageId, itemText, checked }));
      } catch (err) {
        return errorText(err);
      }
    },
  );

  server.registerTool(
    "notion_archive_page",
    {
      title: "Archive Notion Page",
      description: "Remove a Notion page by archiving it (reversible, recoverable from trash).",
      inputSchema: {
        pageId: z.string().describe("Notion page id"),
      },
    },
    async ({ pageId }) => {
      try {
        return text(await notion.archivePage({ pageId }));
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

  server.registerTool(
    "slack_list_users",
    {
      title: "List Slack Users",
      description:
        "List workspace members and their user ids. Use this to @mention someone in a Slack message: include <@USER_ID> in the text.",
      inputSchema: {},
    },
    async () => {
      try {
        return text(await slack.listUsers());
      } catch (err) {
        return errorText(err);
      }
    },
  );

  server.registerTool(
    "slack_list_recent_messages",
    {
      title: "List Recent Slack Messages",
      description:
        "List recent messages in a channel, with their text and ts (timestamp id). Use this to find the ts of a message the user refers to by content (e.g. 'the status update') before editing it with slack_update_message.",
      inputSchema: {
        channel: z.string().describe("Slack channel id, from slack_list_channels"),
        limit: z.number().optional().describe("Max messages to return, default 20"),
      },
    },
    async ({ channel, limit }) => {
      try {
        return text(await slack.listRecentMessages({ channel, limit }));
      } catch (err) {
        return errorText(err);
      }
    },
  );

  server.registerTool(
    "slack_update_message",
    {
      title: "Edit Slack Message",
      description:
        "Edit a previously posted Slack message, e.g. to update a status summary once tasks are completed. Use slack_list_recent_messages first if you only know the message by its content, not its ts.",
      inputSchema: {
        channel: z.string().describe("Slack channel id"),
        ts: z.string().describe("Timestamp id of the message to edit, from the original post's result or slack_list_recent_messages"),
        text: z.string().describe("New message text"),
      },
    },
    async ({ channel, ts, text: messageText }) => {
      try {
        return text(await slack.updateMessage({ channel, ts, text: messageText }));
      } catch (err) {
        return errorText(err);
      }
    },
  );

  return server;
}
