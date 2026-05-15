/**
 * Unit tests for @cadence/adapter-github.
 *
 * Strategy: inject a hand-rolled fake `OctokitLike` via the
 * `createGitHubAdapter({ client })` option. No real HTTP, no GitHub
 * credentials required.
 */

import { describe, expect, it, vi } from "vitest";
import {
  createGitHubAdapter,
  type OctokitLike,
} from "../src/index.js";

function makeFakeIssue(overrides: Record<string, unknown> = {}) {
  return {
    number: 42,
    title: "Fix login redirect race",
    body: "Session cookie set before redirect; race in next/15.",
    state: "open",
    state_reason: null,
    labels: [
      { name: "priority:high" },
      { name: "type:bug" },
      { name: "needs-triage" },
    ],
    assignees: [{ login: "octocat" }],
    html_url: "https://github.com/acme/api/issues/42",
    repository_url: "https://api.github.com/repos/acme/api",
    ...overrides,
  };
}

function makeFakeOctokit(mocks: Partial<OctokitLike["rest"]>): OctokitLike {
  return {
    rest: {
      issues: {
        get: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        ...((mocks as { issues?: Record<string, unknown> }).issues ?? {}),
      },
      search: {
        issuesAndPullRequests: vi.fn(),
        ...((mocks as { search?: Record<string, unknown> }).search ?? {}),
      },
    },
  } as unknown as OctokitLike;
}

describe("@cadence/adapter-github", () => {
  it("exports name + version metadata", () => {
    const adapter = createGitHubAdapter({ client: makeFakeOctokit({}) });
    expect(adapter.name).toBe("@cadence/adapter-github");
    expect(adapter.version).toBe("0.8.0");
  });

  it("throws if no token and no injected client", () => {
    const origToken = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    expect(() => createGitHubAdapter()).toThrow(/GITHUB_TOKEN/);
    if (origToken) process.env.GITHUB_TOKEN = origToken;
  });

  it("findTask parses owner/repo#number form and returns cadence task", async () => {
    const client = makeFakeOctokit({
      issues: {
        get: vi.fn().mockResolvedValue({ data: makeFakeIssue() }),
      } as unknown as OctokitLike["rest"]["issues"],
    });
    const adapter = createGitHubAdapter({ client });

    const task = await adapter.findTask({ id: "acme/api#42" });
    expect(client.rest.issues.get).toHaveBeenCalledWith({
      owner: "acme",
      repo: "api",
      issue_number: 42,
    });
    expect(task?.id).toBe("acme/api#42");
    expect(task?.title).toBe("Fix login redirect race");
    expect(task?.priority).toBe("high");
    expect(task?.type).toBe("bug");
    expect(task?.assignee).toBe("octocat");
    expect(task?.status).toBe("open");
    expect(task?.url).toBe("https://github.com/acme/api/issues/42");
  });

  it("findTask accepts numeric IDs when GITHUB_OWNER + GITHUB_REPO are configured", async () => {
    const client = makeFakeOctokit({
      issues: {
        get: vi.fn().mockResolvedValue({ data: makeFakeIssue() }),
      } as unknown as OctokitLike["rest"]["issues"],
    });
    const adapter = createGitHubAdapter({
      client,
      owner: "acme",
      repo: "api",
    });
    const task = await adapter.findTask({ id: "42" });
    expect(client.rest.issues.get).toHaveBeenCalledWith({
      owner: "acme",
      repo: "api",
      issue_number: 42,
    });
    expect(task?.id).toBe("acme/api#42");
  });

  it("findTask throws when a numeric ID is used without defaults", async () => {
    const client = makeFakeOctokit({});
    const adapter = createGitHubAdapter({ client });
    await expect(adapter.findTask({ id: "42" })).rejects.toThrow(
      /GITHUB_OWNER/,
    );
  });

  it("findTask returns null on 404", async () => {
    const err: Error & { status?: number } = Object.assign(new Error("Not Found"), {
      status: 404,
    });
    const client = makeFakeOctokit({
      issues: {
        get: vi.fn().mockRejectedValue(err),
      } as unknown as OctokitLike["rest"]["issues"],
    });
    const adapter = createGitHubAdapter({ client });
    const task = await adapter.findTask({ id: "acme/api#9999" });
    expect(task).toBeNull();
  });

  it("findTask promotes closed+completed into the status string", async () => {
    const client = makeFakeOctokit({
      issues: {
        get: vi.fn().mockResolvedValue({
          data: makeFakeIssue({ state: "closed", state_reason: "completed" }),
        }),
      } as unknown as OctokitLike["rest"]["issues"],
    });
    const adapter = createGitHubAdapter({ client });
    const task = await adapter.findTask({ id: "acme/api#42" });
    expect(task?.status).toBe("completed");
  });

  it("searchTasks repo-scopes when owner+repo defaults are set", async () => {
    const client = makeFakeOctokit({
      search: {
        issuesAndPullRequests: vi.fn().mockResolvedValue({
          data: { items: [makeFakeIssue()] },
        }),
      } as unknown as OctokitLike["rest"]["search"],
    });
    const adapter = createGitHubAdapter({
      client,
      owner: "acme",
      repo: "api",
    });

    await adapter.searchTasks({ query: "auth refresh", limit: 5 });
    expect(client.rest.search.issuesAndPullRequests).toHaveBeenCalledWith({
      q: "repo:acme/api auth refresh",
      per_page: 5,
    });
  });

  it("createTask attaches priority/type/category/complexity as prefixed labels", async () => {
    const client = makeFakeOctokit({
      issues: {
        create: vi.fn().mockResolvedValue({ data: makeFakeIssue() }),
      } as unknown as OctokitLike["rest"]["issues"],
    });
    const adapter = createGitHubAdapter({ client });

    await adapter.createTask({
      title: "Fix",
      description: "Body",
      type: "bug",
      priority: "high",
      category: "backend",
      complexity: "standard",
      project: "acme/api",
    });
    expect(client.rest.issues.create).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "acme",
        repo: "api",
        title: "Fix",
        body: "Body",
        labels: expect.arrayContaining([
          "priority:high",
          "type:bug",
          "category:backend",
          "complexity:standard",
        ]),
      }),
    );
  });

  it("createTask rejects malformed project strings", async () => {
    const client = makeFakeOctokit({});
    const adapter = createGitHubAdapter({ client });
    await expect(
      adapter.createTask({
        title: "x",
        description: "y",
        project: "just-a-string",
      }),
    ).rejects.toThrow(/owner\/repo/);
  });

  it("updateTask maps `done`/`completed` status to state:closed", async () => {
    const client = makeFakeOctokit({
      issues: {
        update: vi.fn().mockResolvedValue({ data: makeFakeIssue({ state: "closed" }) }),
      } as unknown as OctokitLike["rest"]["issues"],
    });
    const adapter = createGitHubAdapter({ client });

    await adapter.updateTask({ id: "acme/api#42", status: "done" });
    expect(client.rest.issues.update).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "acme",
        repo: "api",
        issue_number: 42,
        state: "closed",
      }),
    );
  });

  it("updateTask replaces priority label rather than appending duplicates", async () => {
    const client = makeFakeOctokit({
      issues: {
        update: vi.fn().mockResolvedValue({ data: makeFakeIssue() }),
      } as unknown as OctokitLike["rest"]["issues"],
    });
    const adapter = createGitHubAdapter({ client });

    await adapter.updateTask({
      id: "acme/api#42",
      labels: ["priority:medium", "needs-triage"],
      priority: "high",
    });
    expect(client.rest.issues.update).toHaveBeenCalledWith(
      expect.objectContaining({
        labels: ["needs-triage", "priority:high"],
      }),
    );
  });

  it("completeTask closes the issue with state_reason=completed", async () => {
    const client = makeFakeOctokit({
      issues: {
        update: vi.fn().mockResolvedValue({
          data: makeFakeIssue({ state: "closed", state_reason: "completed" }),
        }),
      } as unknown as OctokitLike["rest"]["issues"],
    });
    const adapter = createGitHubAdapter({ client });

    const result = await adapter.completeTask({ id: "acme/api#42" });
    expect(client.rest.issues.update).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "acme",
        repo: "api",
        issue_number: 42,
        state: "closed",
        state_reason: "completed",
      }),
    );
    expect(result.status).toBe("completed");
  });
});
