import { LinearClient } from "@linear/sdk";

let client: LinearClient | undefined;

function getClient(): LinearClient {
  if (!client) {
    const apiKey = process.env.LINEAR_API_KEY;
    if (!apiKey) throw new Error("LINEAR_API_KEY is not set");
    client = new LinearClient({ apiKey });
  }
  return client;
}

export async function listTeams() {
  const teams = await getClient().teams();
  return teams.nodes.map((t) => ({ id: t.id, key: t.key, name: t.name }));
}

export async function createIssue(input: {
  teamId: string;
  title: string;
  description?: string;
}) {
  const result = await getClient().createIssue({
    teamId: input.teamId,
    title: input.title,
    description: input.description,
  });
  const issue = await result.issue;
  if (!issue) throw new Error("Linear did not return the created issue");
  return { id: issue.id, identifier: issue.identifier, url: issue.url, title: issue.title };
}
