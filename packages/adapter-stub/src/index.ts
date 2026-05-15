/**
 * @cadence/adapter-stub — reference TaskAdapter implementation.
 *
 * Every method logs the verb + the inputs it was given, then returns a
 * deterministic synthetic task (or array) so downstream code paths get
 * exercised end-to-end. This is the v0.5 way to prove the plugin contract
 * works: install the stub, point `extensions.taskAdapter` at it, run
 * `cadence task find STUB-1` and see "would call findTask" + a synthetic
 * task echo. No real tracker SDK, no network, no surprises.
 *
 * Real adapter implementations (Linear / Jira / GitHub Issues) follow this
 * shape and replace the synthetic returns with real API calls. The
 * `TaskAdapter` interface lives at `cadence/dist/extensions/task-adapter.js`
 * once cadence is installed.
 *
 * Why a duplicate of the interface here rather than `import` from cadence:
 * the adapter package is a peer of cadence, not a downstream consumer. The
 * stub's source file duplicates the interface inline so the package can
 * build without depending on the cadence build artifact. Type compatibility
 * is enforced by structural typing at runtime via cadence's
 * `isTaskAdapter()` guard.
 */

interface CadenceTask {
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
  findTask(input: FindTaskInput): Promise<CadenceTask | null>;
  searchTasks(input: SearchTasksInput): Promise<CadenceTask[]>;
  createTask(input: CreateTaskInput): Promise<CadenceTask>;
  updateTask(input: UpdateTaskInput): Promise<CadenceTask>;
  completeTask(input: CompleteTaskInput): Promise<CadenceTask>;
}

const ADAPTER_NAME = "@cadence/adapter-stub";
const ADAPTER_VERSION = "0.5.0";

function log(verb: string, inputs: object): void {
  // Stream to stderr so test harnesses can separate adapter chatter from
  // command stdout. The "would call" wording is the contract — tests
  // assert on this string.
  process.stderr.write(
    `[stub-adapter] would call ${verb}(${JSON.stringify(inputs)})\n`,
  );
}

let nextId = 1;
function synthId(prefix = "STUB"): string {
  const id = `${prefix}-${nextId}`;
  nextId += 1;
  return id;
}

const stubAdapter: TaskAdapter = {
  name: ADAPTER_NAME,
  version: ADAPTER_VERSION,

  async findTask(input) {
    log("findTask", input);
    if (!input.id) return null;
    return {
      id: input.id,
      title: `Synthetic task ${input.id}`,
      description: "Returned by @cadence/adapter-stub — no tracker call was made.",
      status: "open",
      priority: "medium",
    };
  },

  async searchTasks(input) {
    log("searchTasks", input);
    const limit = input.limit ?? 3;
    const results: CadenceTask[] = [];
    for (let i = 0; i < limit; i += 1) {
      results.push({
        id: synthId(),
        title: `Synthetic match for "${input.query}" (${i + 1}/${limit})`,
        status: "open",
      });
    }
    return results;
  },

  async createTask(input) {
    log("createTask", input);
    return {
      id: synthId(),
      title: input.title,
      description: input.description,
      type: input.type,
      priority: input.priority,
      status: input.status ?? "open",
      estimatedHours: input.estimatedHours,
      actualHours: input.actualHours,
      labels: input.labels,
    };
  },

  async updateTask(input) {
    log("updateTask", input);
    return {
      id: input.id,
      title: `Synthetic updated task ${input.id}`,
      status: input.status,
      priority: input.priority,
      estimatedHours: input.estimatedHours,
      actualHours: input.actualHours,
      labels: input.labels,
    };
  },

  async completeTask(input) {
    log("completeTask", input);
    return {
      id: input.id,
      title: `Synthetic completed task ${input.id}`,
      status: "completed",
      actualHours: input.actualHours,
    };
  },
};

export default stubAdapter;
export { stubAdapter };
