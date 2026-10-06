import { WebClient } from "@slack/web-api";

let client: WebClient | undefined;

function getClient(): WebClient {
  if (!client) {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) throw new Error("SLACK_BOT_TOKEN is not set");
    client = new WebClient(token);
  }
  return client;
}

export async function listChannels() {
  const result = await getClient().conversations.list({
    types: "public_channel,private_channel",
    exclude_archived: true,
  });
  return (result.channels ?? []).map((c) => ({ id: c.id, name: c.name }));
}

export async function notifyChannel(input: { channel: string; text: string }) {
  const result = await getClient().chat.postMessage({
    channel: input.channel,
    text: input.text,
  });
  return { ok: result.ok, ts: result.ts, channel: result.channel };
}
