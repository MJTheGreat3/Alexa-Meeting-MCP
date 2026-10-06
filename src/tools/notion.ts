import { Client } from "@notionhq/client";

let client: Client | undefined;

function getClient(): Client {
  if (!client) {
    const auth = process.env.NOTION_API_KEY;
    if (!auth) throw new Error("NOTION_API_KEY is not set");
    client = new Client({ auth });
  }
  return client;
}

function getParentPageId(): string {
  const parentPageId = process.env.NOTION_PARENT_PAGE_ID;
  if (!parentPageId) throw new Error("NOTION_PARENT_PAGE_ID is not set");
  return parentPageId;
}

export async function createMeetingSummary(input: {
  title: string;
  actionItems: { text: string; issueUrl?: string }[];
  rawNotes: string;
}) {
  const page = await getClient().pages.create({
    parent: { page_id: getParentPageId() },
    properties: {
      title: { title: [{ text: { content: input.title } }] },
    },
    children: [
      {
        object: "block",
        type: "heading_2",
        heading_2: { rich_text: [{ text: { content: "Action Items" } }] },
      },
      ...input.actionItems.map((item) => ({
        object: "block" as const,
        type: "to_do" as const,
        to_do: {
          rich_text: [
            {
              text: {
                content: item.issueUrl ? `${item.text} (${item.issueUrl})` : item.text,
              },
            },
          ],
          checked: false,
        },
      })),
      {
        object: "block",
        type: "heading_2",
        heading_2: { rich_text: [{ text: { content: "Raw Notes" } }] },
      },
      {
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: [{ text: { content: input.rawNotes.slice(0, 2000) } }] },
      },
    ],
  });
  const url = "url" in page ? page.url : undefined;
  return { id: page.id, url };
}

export async function appendNotes(input: { pageId: string; text: string }) {
  const result = await getClient().blocks.children.append({
    block_id: input.pageId,
    children: [
      {
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: [{ text: { content: input.text.slice(0, 2000) } }] },
      },
    ],
  });
  return { appended: result.results.length };
}

export async function setActionItemChecked(input: {
  pageId: string;
  itemText: string;
  checked: boolean;
}) {
  const children = await getClient().blocks.children.list({ block_id: input.pageId });
  const match = children.results.find(
    (block): block is typeof block & { type: "to_do"; to_do: { rich_text: { plain_text: string }[] } } =>
      "type" in block &&
      block.type === "to_do" &&
      block.to_do.rich_text.some((rt) => rt.plain_text.includes(input.itemText)),
  );
  if (!match) throw new Error(`No to-do block on page ${input.pageId} matching "${input.itemText}"`);
  await getClient().blocks.update({
    block_id: match.id,
    to_do: { checked: input.checked },
  });
  return { id: match.id, checked: input.checked };
}

export async function archivePage(input: { pageId: string }) {
  await getClient().pages.update({ page_id: input.pageId, archived: true });
  return { id: input.pageId, archived: true };
}
