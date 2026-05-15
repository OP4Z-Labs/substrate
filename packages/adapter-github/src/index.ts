/**
 * @op4z/substrate-adapter-github — TaskAdapter implementation for GitHub Issues.
 *
 * Backed by the official `octokit` package. Authenticates via the
 * GITHUB_TOKEN environment variable (or a personal access token passed
 * explicitly).
 *
 * **Required env vars:**
 *
 *   GITHUB_TOKEN  fine-grained or classic PAT with repo + issues scope
 *   GITHUB_OWNER  repo owner (org or user), used as default for `project`
 *   GITHUB_REPO   repo name, used as default for `project`
 *
 * The `project` option in substrate's CreateTaskInput is interpreted as
 * `<owner>/<repo>` (e.g. `acme/api-server`). If you set GITHUB_OWNER +
 * GITHUB_REPO, the `project` argument can be omitted for create.
 *
 * Design decisions:
 *
 * 1. **Adapter contract is duplicated inline** — same pattern as the
 *    stub, Linear, Jira adapters. Peer package, no build-time import
 *    from substrate. Structural typing at runtime.
 *
 * 2. **Mapping decisions:**
 *    - `id` → `<owner>/<repo>#<number>` (e.g. `acme/api#42`). NOT just
 *      the issue number, because substrate's task IDs are globally unique.
 *    - `title` → GitHub `title`
 *    - `description` → GitHub `body`
 *    - `status` → either `open` or `closed` (GitHub's binary state).
 *      The `state_reason` field (`completed`, `reopened`, `not_planned`)
 *      is mapped into a richer status string on closed issues.
 *    - `priority` → label prefixed `priority:` (e.g. `priority:high`)
 *    - `type` → label prefixed `type:`
 *    - `category` / `complexity` → label prefixed `category:` / `complexity:`
 *    - `assignee` → first assignee's login
 *    - `labels` → all labels
 *    - `estimatedHours` / `actualHours` → not natively supported by
 *      GitHub Issues; left undefined.
 *
 * 3. **`completeTask` closes the issue with `state_reason: completed`.**
 *    The `not_planned` close reason is not exposed in v0.8; v1.0 may
 *    add it as a flag.
 *
 * 4. **GitHub Issues' search is global, not repo-scoped, by default.**
 *    `searchTasks` always scopes to GITHUB_OWNER/GITHUB_REPO if set;
 *    otherwise the search hits all of GitHub. Callers should configure
 *    those env vars unless they really want a global search.
 */

import { Octokit } from "octokit";

// ---------------------------------------------------------------------- types

interface SubstrateTask {
  id: string;
  title: string;
  description?: string;
  status?: string;
  priority?: string;
  type?: string;
  assignee?: string;
  labels?: string[];
  estimatedHours?: number;
  actualHours?: number;
  url?: string;
}

interface FindTaskInput {
  id: string;
}

interface SearchTasksInput {
  query: string;
  filters?: Record<string, string | number | boolean | undefined>;
  limit?: number;
}

interface CreateTaskInput {
  title: string;
  description: string;
  type?: string;
  priority?: string;
  category?: string;
  complexity?: string;
  estimatedHours?: number;
  status?: string;
  actualHours?: number;
  labels?: string[];
  project?: string;
  assignee?: string;
}

interface UpdateTaskInput {
  id: string;
  status?: string;
  priority?: string;
  estimatedHours?: number;
  actualHours?: number;
  assignee?: string;
  labels?: string[];
}

interface CompleteTaskInput {
  id: string;
  actualHours?: number;
}

interface TaskAdapter {
  readonly name: string;
  readonly version: string;
  findTask(input: FindTaskInput): Promise<SubstrateTask | null>;
  searchTasks(input: SearchTasksInput): Promise<SubstrateTask[]>;
  createTask(input: CreateTaskInput): Promise<SubstrateTask>;
  updateTask(input: UpdateTaskInput): Promise<SubstrateTask>;
  completeTask(input: CompleteTaskInput): Promise<SubstrateTask>;
}

// ------------------------------------------------------------ octokit shape
/**
 * Narrowed view of the Octokit.rest surface — enough for tests to
 * inject a fake without instantiating the real client.
 */
export interface OctokitLike {
  rest: {
    issues: {
      get(params: {
        owner: string;
        repo: string;
        issue_number: number;
      }): Promise<{ data: GitHubIssue }>;
      create(params: {
        owner: string;
        repo: string;
        title: string;
        body?: string;
        labels?: string[];
        assignees?: string[];
      }): Promise<{ data: GitHubIssue }>;
      update(params: {
        owner: string;
        repo: string;
        issue_number: number;
        title?: string;
        body?: string;
        state?: "open" | "closed";
        state_reason?: "completed" | "not_planned" | "reopened" | null;
        labels?: string[];
        assignees?: string[];
      }): Promise<{ data: GitHubIssue }>;
    };
    search: {
      issuesAndPullRequests(params: {
        q: string;
        per_page?: number;
      }): Promise<{ data: { items: GitHubIssue[] } }>;
    };
  };
}

interface GitHubIssue {
  number: number;
  title: string;
  body?: string | null;
  state: "open" | "closed";
  state_reason?: "completed" | "not_planned" | "reopened" | null;
  labels: (string | { name?: string })[];
  assignees?: { login: string }[];
  html_url: string;
  repository_url?: string;
}

const ADAPTER_NAME = "@op4z/substrate-adapter-github";
const ADAPTER_VERSION = "0.8.0";

export interface GitHubAdapterOptions {
  /** GitHub personal access token (overrides GITHUB_TOKEN). */
  token?: string;
  /** Default owner used when `project` isn't supplied (overrides GITHUB_OWNER). */
  owner?: string;
  /** Default repo (overrides GITHUB_REPO). */
  repo?: string;
  /** Inject a pre-built client (used by tests). */
  client?: OctokitLike;
}

/**
 * Parse a substrate task ID into its `owner/repo#number` parts. Accepts:
 *   - "owner/repo#123"  (canonical)
 *   - "owner/repo/123"  (slash form some users prefer)
 *   - "123"             (fall back to default owner/repo)
 */
function parseTaskId(
  id: string,
  defaultOwner: string,
  defaultRepo: string,
): { owner: string; repo: string; number: number } {
  const hashMatch = id.match(/^([^/]+)\/([^#]+)#(\d+)$/);
  if (hashMatch) {
    return { owner: hashMatch[1], repo: hashMatch[2], number: parseInt(hashMatch[3], 10) };
  }
  const slashMatch = id.match(/^([^/]+)\/([^/]+)\/(\d+)$/);
  if (slashMatch) {
    return { owner: slashMatch[1], repo: slashMatch[2], number: parseInt(slashMatch[3], 10) };
  }
  if (/^\d+$/.test(id)) {
    if (!defaultOwner || !defaultRepo) {
      throw new Error(
        `@op4z/substrate-adapter-github: numeric id "${id}" requires GITHUB_OWNER + GITHUB_REPO env vars.`,
      );
    }
    return { owner: defaultOwner, repo: defaultRepo, number: parseInt(id, 10) };
  }
  throw new Error(
    `@op4z/substrate-adapter-github: cannot parse task id "${id}". Use "owner/repo#123" or set defaults.`,
  );
}

/**
 * Extract a label-name string from GitHub's loose label shape (it can be
 * either a string or an object with a `name` field).
 */
function labelName(l: string | { name?: string }): string | null {
  if (typeof l === "string") return l;
  return l.name ?? null;
}

function findPrefixedLabel(labels: string[], prefix: string): string | undefined {
  const match = labels.find((l) => l.startsWith(`${prefix}:`));
  return match ? match.slice(prefix.length + 1) : undefined;
}

function toSubstrateTask(
  issue: GitHubIssue,
  ownerHint: string,
  repoHint: string,
): SubstrateTask {
  // The `repository_url` is the canonical place to find owner/repo for
  // a returned issue, but it isn't always set on responses. Fall back to
  // the hints we used to fetch.
  let owner = ownerHint;
  let repo = repoHint;
  if (issue.repository_url) {
    const m = issue.repository_url.match(/repos\/([^/]+)\/([^/]+)$/);
    if (m) {
      owner = m[1];
      repo = m[2];
    }
  }
  const labels = (issue.labels.map(labelName).filter(Boolean) as string[]);
  let status: string = issue.state;
  if (issue.state === "closed") {
    // Promote `state_reason` into the status when it's more specific
    // than "closed" — e.g. "completed" / "not_planned".
    if (issue.state_reason && issue.state_reason !== "reopened") {
      status = issue.state_reason;
    }
  }
  return {
    id: `${owner}/${repo}#${issue.number}`,
    title: issue.title,
    description: issue.body ?? undefined,
    status,
    priority: findPrefixedLabel(labels, "priority"),
    type: findPrefixedLabel(labels, "type"),
    assignee: issue.assignees?.[0]?.login,
    labels,
    url: issue.html_url,
  };
}

export function createGitHubAdapter(options: GitHubAdapterOptions = {}): TaskAdapter {
  const token = options.token ?? process.env.GITHUB_TOKEN ?? "";
  const defaultOwner = options.owner ?? process.env.GITHUB_OWNER ?? "";
  const defaultRepo = options.repo ?? process.env.GITHUB_REPO ?? "";

  let client: OctokitLike;
  if (options.client) {
    client = options.client;
  } else {
    if (!token) {
      throw new Error(
        "@op4z/substrate-adapter-github: set GITHUB_TOKEN env var (or pass `token`) before using.",
      );
    }
    client = new Octokit({ auth: token }) as OctokitLike;
  }

  return {
    name: ADAPTER_NAME,
    version: ADAPTER_VERSION,

    async findTask({ id }) {
      const parsed = parseTaskId(id, defaultOwner, defaultRepo);
      try {
        const { data } = await client.rest.issues.get({
          owner: parsed.owner,
          repo: parsed.repo,
          issue_number: parsed.number,
        });
        return toSubstrateTask(data, parsed.owner, parsed.repo);
      } catch (err) {
        if (
          err instanceof Error &&
          (/(404|not found)/i.test(err.message) ||
            (err as unknown as { status?: number }).status === 404)
        ) {
          return null;
        }
        throw err;
      }
    },

    async searchTasks({ query, limit }) {
      let q = query;
      if (defaultOwner && defaultRepo) {
        q = `repo:${defaultOwner}/${defaultRepo} ${q}`;
      }
      const { data } = await client.rest.search.issuesAndPullRequests({
        q,
        per_page: limit ?? 25,
      });
      return data.items.map((i) => toSubstrateTask(i, defaultOwner, defaultRepo));
    },

    async createTask(input) {
      const projectStr = input.project ?? `${defaultOwner}/${defaultRepo}`;
      const parts = projectStr.split("/");
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        throw new Error(
          `@op4z/substrate-adapter-github: project must be "owner/repo" (got "${projectStr}").`,
        );
      }
      const [owner, repo] = parts;

      const labels: string[] = [];
      if (input.labels) labels.push(...input.labels);
      if (input.priority) labels.push(`priority:${input.priority}`);
      if (input.type) labels.push(`type:${input.type}`);
      if (input.category) labels.push(`category:${input.category}`);
      if (input.complexity) labels.push(`complexity:${input.complexity}`);

      const { data } = await client.rest.issues.create({
        owner,
        repo,
        title: input.title,
        body: input.description,
        labels,
        assignees: input.assignee ? [input.assignee] : undefined,
      });
      return toSubstrateTask(data, owner, repo);
    },

    async updateTask(input) {
      const parsed = parseTaskId(input.id, defaultOwner, defaultRepo);
      const update: {
        owner: string;
        repo: string;
        issue_number: number;
        state?: "open" | "closed";
        labels?: string[];
        assignees?: string[];
      } = {
        owner: parsed.owner,
        repo: parsed.repo,
        issue_number: parsed.number,
      };
      // Status: GitHub only supports open/closed. Map common statuses.
      if (input.status) {
        const s = input.status.toLowerCase();
        if (s === "open" || s === "reopened") {
          update.state = "open";
        } else if (
          s === "closed" ||
          s === "completed" ||
          s === "done" ||
          s === "not_planned"
        ) {
          update.state = "closed";
        }
      }
      // Labels — when provided, replace the full set.
      if (input.labels !== undefined) {
        update.labels = input.labels;
      }
      // Replace priority label.
      if (input.priority) {
        update.labels = (update.labels ?? []).filter((l) => !l.startsWith("priority:"));
        update.labels.push(`priority:${input.priority}`);
      }
      if (input.assignee) update.assignees = [input.assignee];

      const { data } = await client.rest.issues.update(update);
      return toSubstrateTask(data, parsed.owner, parsed.repo);
    },

    async completeTask({ id }) {
      const parsed = parseTaskId(id, defaultOwner, defaultRepo);
      const { data } = await client.rest.issues.update({
        owner: parsed.owner,
        repo: parsed.repo,
        issue_number: parsed.number,
        state: "closed",
        state_reason: "completed",
      });
      return toSubstrateTask(data, parsed.owner, parsed.repo);
    },
  };
}

// ------------------------------------------------------------ default export
let _instance: TaskAdapter | null = null;
const defaultAdapter: TaskAdapter = {
  name: ADAPTER_NAME,
  version: ADAPTER_VERSION,
  async findTask(input) {
    return getInstance().findTask(input);
  },
  async searchTasks(input) {
    return getInstance().searchTasks(input);
  },
  async createTask(input) {
    return getInstance().createTask(input);
  },
  async updateTask(input) {
    return getInstance().updateTask(input);
  },
  async completeTask(input) {
    return getInstance().completeTask(input);
  },
};

function getInstance(): TaskAdapter {
  if (!_instance) _instance = createGitHubAdapter();
  return _instance;
}

export default defaultAdapter;
