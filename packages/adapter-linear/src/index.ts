/**
 * @op4z/substrate-adapter-linear — TaskAdapter implementation for Linear.
 *
 * Uses Linear's official GraphQL SDK (@linear/sdk). Configured via
 * environment variable LINEAR_API_KEY (Linear personal API keys are
 * generated at https://linear.app/settings/api).
 *
 * Design decisions:
 *
 * 1. **Adapter contract is duplicated inline.** Per the v0.5 stub
 *    adapter pattern (see packages/adapter-stub/src/index.ts head
 *    comment): structural typing at runtime means we don't need
 *    a build-time import from substrate. The adapter ships a copy
 *    of the interface so it can build standalone.
 *
 * 2. **Mapping decisions:**
 *    - `id` → Linear identifier (e.g. "ENG-123"), NOT the GUID
 *    - `title` → Linear `title`
 *    - `description` → Linear `description` (markdown)
 *    - `status` → Linear workflow state `name` (e.g. "In Progress")
 *    - `priority` → Linear priority label ("Urgent", "High", etc.)
 *    - `type` → Linear label (Linear has no first-class "type" field;
 *      we map a label prefixed `type:` if present)
 *    - `estimatedHours` / `actualHours` → not natively tracked by
 *      Linear; left undefined unless the caller has another source
 *    - `url` → Linear's web URL
 *
 * 3. **Authentication:** read `LINEAR_API_KEY` from process.env at
 *    construction time. Calling `createLinearAdapter()` without a key
 *    throws — the adapter is unusable without credentials, and
 *    failing loudly is better than silent network errors.
 *
 * 4. **Project hint:** for `createTask`, the Linear API requires a
 *    `teamId`. We accept `project` as the team key (e.g. "ENG") and
 *    look up the team ID at create time. This matches OP4Z's `./exc
 *    api --create-task --project op4z` ergonomic.
 */

import { LinearClient, type Issue } from "@linear/sdk";

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

// -------------------------------------------------------------- adapter shape
const ADAPTER_NAME = "@op4z/substrate-adapter-linear";
const ADAPTER_VERSION = "0.8.0";

// Linear priority numbers: 0=No priority, 1=Urgent, 2=High, 3=Medium, 4=Low
const LINEAR_PRIORITY_TO_LABEL: Record<number, string> = {
  0: "no-priority",
  1: "urgent",
  2: "high",
  3: "medium",
  4: "low",
};

const LABEL_TO_LINEAR_PRIORITY: Record<string, number> = {
  urgent: 1,
  critical: 1,
  high: 2,
  medium: 3,
  low: 4,
  "no-priority": 0,
};

export interface LinearAdapterOptions {
  /** Linear API key (overrides LINEAR_API_KEY env var). */
  apiKey?: string;
  /** Inject a pre-built client (used by tests with HTTP mocks). */
  client?: LinearClient;
}

/**
 * Convert a Linear `Issue` to the substrate-canonical task shape.
 *
 * Linear's Issue model lazily fetches related entities (state, assignee,
 * labels). We resolve those promises here so the adapter consumer gets
 * fully-populated objects without surprise async access.
 */
async function toSubstrateTask(issue: Issue): Promise<SubstrateTask> {
  const state = await issue.state;
  const assignee = await issue.assignee;
  const labelsConnection = await issue.labels();
  const labelNames = labelsConnection.nodes.map((l) => l.name);
  // Linear has no first-class "type" — we map the first `type:<...>` label.
  const typeLabel = labelNames.find((n) => n.startsWith("type:"));
  return {
    id: issue.identifier,
    title: issue.title,
    description: issue.description ?? undefined,
    status: state?.name,
    priority: LINEAR_PRIORITY_TO_LABEL[issue.priority] ?? undefined,
    type: typeLabel ? typeLabel.slice("type:".length) : undefined,
    assignee: assignee?.email ?? assignee?.name,
    labels: labelNames,
    estimatedHours: issue.estimate ?? undefined,
    url: issue.url,
  };
}

/**
 * Build a Linear TaskAdapter. Throws when no API key is provided
 * (via options or LINEAR_API_KEY env).
 */
export function createLinearAdapter(options: LinearAdapterOptions = {}): TaskAdapter {
  const apiKey = options.apiKey ?? process.env.LINEAR_API_KEY ?? "";
  if (!options.client && !apiKey) {
    throw new Error(
      "@op4z/substrate-adapter-linear: set LINEAR_API_KEY env var (or pass `apiKey`) before using.",
    );
  }
  const client = options.client ?? new LinearClient({ apiKey });

  return {
    name: ADAPTER_NAME,
    version: ADAPTER_VERSION,

    async findTask({ id }) {
      // Linear's `client.issue(id)` accepts either UUID or identifier.
      try {
        const issue = await client.issue(id);
        if (!issue) return null;
        return toSubstrateTask(issue);
      } catch (err) {
        // Linear's SDK throws on 404; translate to null for the substrate
        // contract (find never throws on missing).
        if (err instanceof Error && /not.*found|invalid/i.test(err.message)) {
          return null;
        }
        throw err;
      }
    },

    async searchTasks({ query, limit }) {
      // Use the issues query with a title/description filter.
      const results = await client.issues({
        filter: {
          or: [
            { title: { containsIgnoreCase: query } },
            { description: { containsIgnoreCase: query } },
          ],
        },
        first: limit ?? 25,
      });
      const tasks = await Promise.all(results.nodes.map(toSubstrateTask));
      return tasks;
    },

    async createTask(input) {
      if (!input.project) {
        throw new Error(
          "@op4z/substrate-adapter-linear: createTask requires `project` (Linear team key, e.g. 'ENG').",
        );
      }
      // Resolve team by key.
      const teams = await client.teams({ filter: { key: { eq: input.project } } });
      const team = teams.nodes[0];
      if (!team) {
        throw new Error(
          `@op4z/substrate-adapter-linear: no team found with key "${input.project}".`,
        );
      }

      const priorityNum = input.priority
        ? LABEL_TO_LINEAR_PRIORITY[input.priority.toLowerCase()] ?? 0
        : 0;

      const labels: string[] = [];
      if (input.labels) labels.push(...input.labels);
      if (input.type) labels.push(`type:${input.type}`);
      if (input.category) labels.push(`category:${input.category}`);
      if (input.complexity) labels.push(`complexity:${input.complexity}`);

      const payload = await client.createIssue({
        teamId: team.id,
        title: input.title,
        description: input.description,
        priority: priorityNum,
        estimate: input.estimatedHours,
      });
      const issue = await payload.issue;
      if (!issue) {
        throw new Error("@op4z/substrate-adapter-linear: createIssue returned no issue.");
      }
      // Labels are attached separately; v0.8 punts on the label attachment
      // round-trip (it's a separate mutation per label) and returns the
      // freshly-created issue. v1.0 should add label sync.
      return toSubstrateTask(issue);
    },

    async updateTask(input) {
      // Translate priority label → Linear number if provided.
      const update: {
        title?: string;
        priority?: number;
        estimate?: number;
        stateId?: string;
      } = {};
      if (input.priority) {
        update.priority = LABEL_TO_LINEAR_PRIORITY[input.priority.toLowerCase()] ?? 0;
      }
      if (input.estimatedHours !== undefined) {
        update.estimate = input.estimatedHours;
      }
      // Status updates require a state ID lookup. The substrate contract
      // takes a status NAME (e.g. "In Progress"). We resolve to a state
      // ID by listing the team's workflow states.
      if (input.status) {
        const issue = await client.issue(input.id);
        const team = await issue.team;
        if (team) {
          const states = await team.states();
          const target = states.nodes.find(
            (s) => s.name.toLowerCase() === input.status?.toLowerCase(),
          );
          if (target) update.stateId = target.id;
        }
      }
      const payload = await client.updateIssue(input.id, update);
      const issue = await payload.issue;
      if (!issue) {
        throw new Error("@op4z/substrate-adapter-linear: updateIssue returned no issue.");
      }
      return toSubstrateTask(issue);
    },

    async completeTask({ id }) {
      // Linear has no first-class "completed" verb — set the issue's
      // state to the team's first state with type "completed".
      const issue = await client.issue(id);
      const team = await issue.team;
      if (!team) {
        throw new Error("@op4z/substrate-adapter-linear: issue has no team.");
      }
      const states = await team.states();
      const completed = states.nodes.find((s) => s.type === "completed");
      if (!completed) {
        throw new Error(
          `@op4z/substrate-adapter-linear: team has no workflow state with type "completed".`,
        );
      }
      const payload = await client.updateIssue(id, { stateId: completed.id });
      const updated = await payload.issue;
      if (!updated) {
        throw new Error("@op4z/substrate-adapter-linear: completeTask returned no issue.");
      }
      return toSubstrateTask(updated);
    },
  };
}

/**
 * Default export — a thin wrapper that calls `createLinearAdapter()` on
 * first access. Most substrate users will configure `extensions.taskAdapter:
 * "@op4z/substrate-adapter-linear"` and never construct the adapter manually;
 * substrate's loader imports the default export.
 *
 * Lazy instantiation: we don't construct the LinearClient at import time
 * because that would throw on missing LINEAR_API_KEY for callers who
 * only want to *check* the package is loadable.
 */
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
  if (!_instance) _instance = createLinearAdapter();
  return _instance;
}

export default defaultAdapter;
