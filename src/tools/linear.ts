import { LinearClient, type Issue } from "@linear/sdk";

let client: LinearClient | undefined;

function getClient(): LinearClient {
  if (!client) {
    const apiKey = process.env.LINEAR_API_KEY;
    if (!apiKey) throw new Error("LINEAR_API_KEY is not set");
    client = new LinearClient({ apiKey });
  }
  return client;
}

function summarizeIssue(issue: Issue) {
  return { id: issue.id, identifier: issue.identifier, url: issue.url, title: issue.title };
}

async function resolveIssue(idOrIdentifier: string): Promise<Issue> {
  const issue = await getClient().issue(idOrIdentifier);
  if (!issue) throw new Error(`No Linear issue found for "${idOrIdentifier}"`);
  return issue;
}

export async function listTeams() {
  const teams = await getClient().teams();
  return teams.nodes.map((t) => ({ id: t.id, key: t.key, name: t.name }));
}

export async function listUsers() {
  const users = await getClient().users();
  return users.nodes.map((u) => ({ id: u.id, name: u.name, email: u.email }));
}

export async function listIssues(input: { teamId: string; includeCompleted?: boolean }) {
  const team = await getClient().team(input.teamId);
  const issues = await team.issues({ first: 50 });
  const withState = await Promise.all(
    issues.nodes.map(async (issue) => {
      const [state, assignee] = await Promise.all([issue.state, issue.assignee]);
      return {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        url: issue.url,
        state: state?.name,
        stateType: state?.type,
        assignee: assignee?.name,
      };
    }),
  );
  if (input.includeCompleted) return withState;
  return withState.filter((i) => i.stateType !== "completed" && i.stateType !== "canceled");
}

export async function createIssue(input: {
  teamId: string;
  title: string;
  description?: string;
  assigneeId?: string;
}) {
  const result = await getClient().createIssue({
    teamId: input.teamId,
    title: input.title,
    description: input.description,
    assigneeId: input.assigneeId,
  });
  const issue = await result.issue;
  if (!issue) throw new Error("Linear did not return the created issue");
  return summarizeIssue(issue);
}

export async function updateIssue(input: {
  idOrIdentifier: string;
  title?: string;
  description?: string;
  assigneeId?: string;
}) {
  const issue = await resolveIssue(input.idOrIdentifier);
  const result = await getClient().updateIssue(issue.id, {
    title: input.title,
    description: input.description,
    assigneeId: input.assigneeId,
  });
  const updated = await result.issue;
  if (!updated) throw new Error("Linear did not return the updated issue");
  return summarizeIssue(updated);
}

const STATUS_TO_STATE_TYPE: Record<string, string> = {
  todo: "unstarted",
  in_progress: "started",
  done: "completed",
  canceled: "canceled",
  backlog: "backlog",
};

export async function setIssueStatus(input: {
  idOrIdentifier: string;
  status: "todo" | "in_progress" | "done" | "canceled" | "backlog";
}) {
  const issue = await resolveIssue(input.idOrIdentifier);
  const team = await issue.team;
  if (!team) throw new Error(`Issue ${input.idOrIdentifier} has no team`);
  const states = await team.states();
  const targetType = STATUS_TO_STATE_TYPE[input.status];
  const targetState = states.nodes.find((s) => s.type === targetType);
  if (!targetState) {
    throw new Error(`No workflow state of type "${targetType}" found on team ${team.name}`);
  }
  const result = await getClient().updateIssue(issue.id, { stateId: targetState.id });
  const updated = await result.issue;
  if (!updated) throw new Error("Linear did not return the updated issue");
  return summarizeIssue(updated);
}

export async function archiveIssue(input: { idOrIdentifier: string }) {
  const issue = await resolveIssue(input.idOrIdentifier);
  await getClient().archiveIssue(issue.id);
  return { id: issue.id, identifier: issue.identifier, archived: true };
}

export async function addComment(input: { idOrIdentifier: string; body: string }) {
  const issue = await resolveIssue(input.idOrIdentifier);
  const result = await getClient().createComment({ issueId: issue.id, body: input.body });
  const comment = await result.comment;
  if (!comment) throw new Error("Linear did not return the created comment");
  return { id: comment.id, body: comment.body };
}
