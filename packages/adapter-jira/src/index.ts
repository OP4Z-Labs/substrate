/**
 * @op4z/substrate-adapter-jira — TaskAdapter implementation for Atlassian Jira.
 *
 * Backed by the `jira-client` REST library. Works against both Jira
 * Cloud (api.atlassian.com) and self-hosted Jira Server. Configured via
 * environment variables:
 *
 *   JIRA_HOST       e.g. "your-org.atlassian.net" (no protocol prefix)
 *   JIRA_USERNAME   email for cloud, or username for server
 *   JIRA_API_TOKEN  Atlassian API token (Cloud) or password (Server)
 *   JIRA_PROTOCOL   optional, defaults to "https"
 *
 * Design decisions:
 *
 * 1. **Adapter contract is duplicated inline** — same pattern as the
 *    stub and Linear adapter. Peer package, no build-time import from
 *    substrate. Structural typing at runtime via `isTaskAdapter()`.
 *
 * 2. **`JiraClientLike` abstraction.** The jira-client SDK is a class
 *    with a sprawling surface. We narrow it to a `JiraClientLike`
 *    interface listing only the methods we actually call. Tests inject
 *    a fake implementing this interface. Real usage instantiates
 *    `JiraApi` from `jira-client`.
 *
 * 3. **Mapping decisions:**
 *    - `id` → Issue key (e.g. "PROJ-123"), NOT the numeric ID
 *    - `title` → `summary`
 *    - `description` → `description` (ADF on Cloud, plain text on Server)
 *    - `status` → `status.name`
 *    - `priority` → `priority.name`
 *    - `type` → `issuetype.name`
 *    - `assignee` → `assignee.emailAddress` (Cloud) or `name` (Server)
 *    - `labels` → `labels` (string array)
 *    - `estimatedHours` → `timetracking.originalEstimateSeconds / 3600`
 *    - `actualHours` → `timetracking.timeSpentSeconds / 3600`
 *    - `url` → constructed from host + key
 *
 * 4. **`completeTask` uses a workflow transition.** Jira's "complete"
 *    is a workflow transition, not a field update. The adapter looks up
 *    the issue's available transitions and picks the first one named
 *    "Done", "Closed", or "Resolved" (case-insensitive). v1.0 can take
 *    an explicit `--transition` flag for finer control.
 */

// jira-client is CJS; default import via esModuleInterop yields the class.
import JiraApi from "jira-client";

// ---------------------------------------------------------------------- types
// Adapter contract — duplicated from substrate's `src/extensions/task-adapter.ts`.
// Structural typing at runtime; do not import from substrate (peer package).

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

// ------------------------------------------------------------ jira-client abstraction
/**
 * Narrowed view of the jira-client surface. Real `JiraApi` instances
 * satisfy this naturally; test fakes implement just these methods.
 */
export interface JiraClientLike {
  findIssue(issueKey: string): Promise<JiraIssue>;
  searchJira(jql: string, options?: { maxResults?: number }): Promise<{
    issues: JiraIssue[];
    total?: number;
  }>;
  addNewIssue(input: Record<string, unknown>): Promise<JiraIssue>;
  updateIssue(issueKey: string, input: Record<string, unknown>): Promise<void>;
  transitionIssue(issueKey: string, input: { transition: { id: string } }): Promise<void>;
  listTransitions(issueKey: string): Promise<{
    transitions: { id: string; name: string }[];
  }>;
}

interface JiraIssue {
  id?: string;
  key: string;
  fields: {
    summary?: string;
    description?: string | { content?: unknown };
    status?: { name?: string };
    priority?: { name?: string };
    issuetype?: { name?: string };
    assignee?: { emailAddress?: string; name?: string; displayName?: string };
    labels?: string[];
    timetracking?: {
      originalEstimateSeconds?: number;
      timeSpentSeconds?: number;
    };
  };
}

const ADAPTER_NAME = "@op4z/substrate-adapter-jira";
const ADAPTER_VERSION = "0.8.0";

export interface JiraAdapterOptions {
  /** Jira host without protocol (e.g. "your-org.atlassian.net"). */
  host?: string;
  /** Email (Cloud) or username (Server). */
  username?: string;
  /** API token (Cloud) or password (Server). */
  apiToken?: string;
  /** "https" (default) or "http" for legacy on-prem. */
  protocol?: "http" | "https";
  /** Inject a pre-built client (used by tests). */
  client?: JiraClientLike;
}

function descriptionToText(
  raw: string | { content?: unknown } | undefined,
): string | undefined {
  if (raw == null) return undefined;
  if (typeof raw === "string") return raw;
  // Jira Cloud returns Atlassian Document Format (ADF). Stringify the
  // top-level object for v0.8; v1.0 can render ADF to markdown.
  return JSON.stringify(raw);
}

function toSubstrateTask(issue: JiraIssue, host?: string): SubstrateTask {
  const f = issue.fields;
  const tt = f.timetracking;
  return {
    id: issue.key,
    title: f.summary ?? "",
    description: descriptionToText(f.description),
    status: f.status?.name,
    priority: f.priority?.name?.toLowerCase(),
    type: f.issuetype?.name?.toLowerCase(),
    assignee: f.assignee?.emailAddress ?? f.assignee?.name ?? f.assignee?.displayName,
    labels: f.labels,
    estimatedHours:
      typeof tt?.originalEstimateSeconds === "number"
        ? tt.originalEstimateSeconds / 3600
        : undefined,
    actualHours:
      typeof tt?.timeSpentSeconds === "number" ? tt.timeSpentSeconds / 3600 : undefined,
    url: host ? `https://${host}/browse/${issue.key}` : undefined,
  };
}

/**
 * Build a Jira TaskAdapter. Throws if no credentials are provided and
 * no client is injected.
 */
export function createJiraAdapter(options: JiraAdapterOptions = {}): TaskAdapter {
  const host = options.host ?? process.env.JIRA_HOST ?? "";
  const username = options.username ?? process.env.JIRA_USERNAME ?? "";
  const apiToken = options.apiToken ?? process.env.JIRA_API_TOKEN ?? "";
  const protocol = options.protocol ?? (process.env.JIRA_PROTOCOL as "http" | "https") ?? "https";

  let client: JiraClientLike;
  if (options.client) {
    client = options.client;
  } else {
    if (!host || !username || !apiToken) {
      throw new Error(
        "@op4z/substrate-adapter-jira: set JIRA_HOST, JIRA_USERNAME, JIRA_API_TOKEN env vars (or pass options).",
      );
    }
    // The real jira-client constructor accepts a config object. We cast
    // to our narrow interface for the rest of the module.
    const RealJiraApi = JiraApi as unknown as new (config: {
      protocol: string;
      host: string;
      username: string;
      password: string;
      apiVersion: string;
      strictSSL: boolean;
    }) => JiraClientLike;
    client = new RealJiraApi({
      protocol,
      host,
      username,
      password: apiToken,
      apiVersion: "3",
      strictSSL: true,
    });
  }

  const effectiveHost = host;

  return {
    name: ADAPTER_NAME,
    version: ADAPTER_VERSION,

    async findTask({ id }) {
      try {
        const issue = await client.findIssue(id);
        if (!issue) return null;
        return toSubstrateTask(issue, effectiveHost);
      } catch (err) {
        if (
          err instanceof Error &&
          /404|not.*found|does.*not.*exist/i.test(err.message)
        ) {
          return null;
        }
        throw err;
      }
    },

    async searchTasks({ query, limit }) {
      // Use Jira's text search via JQL. Escaping double-quotes in the
      // query prevents JQL syntax breakage.
      const escaped = query.replace(/"/g, '\\"');
      const jql = `text ~ "${escaped}" ORDER BY updated DESC`;
      const result = await client.searchJira(jql, { maxResults: limit ?? 25 });
      return result.issues.map((i) => toSubstrateTask(i, effectiveHost));
    },

    async createTask(input) {
      if (!input.project) {
        throw new Error(
          "@op4z/substrate-adapter-jira: createTask requires `project` (Jira project key, e.g. 'PROJ').",
        );
      }
      const issueType = input.type ?? "Task";
      const labels: string[] = [];
      if (input.labels) labels.push(...input.labels);
      if (input.category) labels.push(`category:${input.category}`);
      if (input.complexity) labels.push(`complexity:${input.complexity}`);

      const fields: Record<string, unknown> = {
        project: { key: input.project },
        summary: input.title,
        description: input.description,
        issuetype: { name: issueType },
        labels,
      };
      if (input.priority) {
        // Jira's priority field expects a name like "High" / "Medium".
        // We accept any casing and Title-Case it.
        const titleCased =
          input.priority[0].toUpperCase() + input.priority.slice(1).toLowerCase();
        fields.priority = { name: titleCased };
      }
      if (input.estimatedHours !== undefined) {
        fields.timetracking = {
          originalEstimate: `${input.estimatedHours}h`,
        };
      }
      const created = await client.addNewIssue({ fields });
      // `addNewIssue` returns a thin shape — re-fetch for the full task.
      const full = await client.findIssue(created.key);
      return toSubstrateTask(full, effectiveHost);
    },

    async updateTask(input) {
      const fields: Record<string, unknown> = {};
      if (input.priority) {
        const titleCased =
          input.priority[0].toUpperCase() + input.priority.slice(1).toLowerCase();
        fields.priority = { name: titleCased };
      }
      if (input.assignee) {
        // For Cloud, `accountId` is the correct field; for Server, `name`.
        // Punt on Cloud-vs-Server detection: pass `name` and let the
        // server reject if mismatched. v1.0 can detect and route.
        fields.assignee = { name: input.assignee };
      }
      if (input.labels) fields.labels = input.labels;
      if (input.estimatedHours !== undefined) {
        fields.timetracking = {
          originalEstimate: `${input.estimatedHours}h`,
        };
      }
      if (Object.keys(fields).length > 0) {
        await client.updateIssue(input.id, { fields });
      }
      if (input.status) {
        // Transition the issue. Look up available transitions by name.
        const transitions = await client.listTransitions(input.id);
        const target = transitions.transitions.find(
          (t) => t.name.toLowerCase() === input.status?.toLowerCase(),
        );
        if (!target) {
          throw new Error(
            `@op4z/substrate-adapter-jira: no transition named "${input.status}" available on ${input.id}.`,
          );
        }
        await client.transitionIssue(input.id, { transition: { id: target.id } });
      }
      const full = await client.findIssue(input.id);
      return toSubstrateTask(full, effectiveHost);
    },

    async completeTask({ id }) {
      const transitions = await client.listTransitions(id);
      const target = transitions.transitions.find((t) =>
        /^(done|closed|resolved|complete)/i.test(t.name),
      );
      if (!target) {
        throw new Error(
          `@op4z/substrate-adapter-jira: no completion transition (Done/Closed/Resolved/Complete) on ${id}.`,
        );
      }
      await client.transitionIssue(id, { transition: { id: target.id } });
      const full = await client.findIssue(id);
      return toSubstrateTask(full, effectiveHost);
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
  if (!_instance) _instance = createJiraAdapter();
  return _instance;
}

export default defaultAdapter;
