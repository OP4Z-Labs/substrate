/**
 * Unit tests for @cadence/adapter-jira.
 *
 * Strategy: inject a hand-rolled fake `JiraClientLike` via the
 * `createJiraAdapter({ client })` option. Tests don't touch the
 * jira-client library, the network, or any real Jira instance.
 */

import { describe, expect, it, vi } from "vitest";
import {
  createJiraAdapter,
  type JiraClientLike,
} from "../src/index.js";

function makeFakeIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: "10001",
    key: "PROJ-123",
    fields: {
      summary: "Fix the thing",
      description: "Because it is broken.",
      status: { name: "In Progress" },
      priority: { name: "High" },
      issuetype: { name: "Bug" },
      assignee: { emailAddress: "test@example.com", displayName: "Test User" },
      labels: ["category:backend", "complexity:standard"],
      timetracking: {
        originalEstimateSeconds: 10800, // 3h
        timeSpentSeconds: 7200, // 2h
      },
    },
    ...overrides,
  };
}

describe("@cadence/adapter-jira", () => {
  it("exports name + version metadata", () => {
    const adapter = createJiraAdapter({ client: {} as JiraClientLike });
    expect(adapter.name).toBe("@cadence/adapter-jira");
    expect(adapter.version).toBe("0.8.0");
  });

  it("throws if no credentials and no injected client", () => {
    const origHost = process.env.JIRA_HOST;
    delete process.env.JIRA_HOST;
    expect(() => createJiraAdapter()).toThrow(/JIRA_HOST/);
    if (origHost) process.env.JIRA_HOST = origHost;
  });

  it("findTask returns a cadence task with mapped fields", async () => {
    const client = {
      findIssue: vi.fn().mockResolvedValue(makeFakeIssue()),
    } as unknown as JiraClientLike;
    const adapter = createJiraAdapter({
      client,
      host: "test.atlassian.net",
    });

    const task = await adapter.findTask({ id: "PROJ-123" });
    expect(client.findIssue).toHaveBeenCalledWith("PROJ-123");
    expect(task?.id).toBe("PROJ-123");
    expect(task?.title).toBe("Fix the thing");
    expect(task?.description).toBe("Because it is broken.");
    expect(task?.status).toBe("In Progress");
    expect(task?.priority).toBe("high");
    expect(task?.type).toBe("bug");
    expect(task?.assignee).toBe("test@example.com");
    expect(task?.estimatedHours).toBe(3);
    expect(task?.actualHours).toBe(2);
    expect(task?.url).toBe("https://test.atlassian.net/browse/PROJ-123");
  });

  it("findTask returns null on 404 errors", async () => {
    const client = {
      findIssue: vi
        .fn()
        .mockRejectedValue(new Error("404: Issue Does Not Exist")),
    } as unknown as JiraClientLike;
    const adapter = createJiraAdapter({ client, host: "x.atlassian.net" });
    const task = await adapter.findTask({ id: "PROJ-9999" });
    expect(task).toBeNull();
  });

  it("findTask re-throws non-404 errors", async () => {
    const client = {
      findIssue: vi.fn().mockRejectedValue(new Error("500 Internal Error")),
    } as unknown as JiraClientLike;
    const adapter = createJiraAdapter({ client, host: "x.atlassian.net" });
    await expect(adapter.findTask({ id: "PROJ-1" })).rejects.toThrow(/500/);
  });

  it("searchTasks issues a JQL text search and returns mapped results", async () => {
    const client = {
      searchJira: vi.fn().mockResolvedValue({
        issues: [makeFakeIssue(), makeFakeIssue({ key: "PROJ-124" })],
        total: 2,
      }),
    } as unknown as JiraClientLike;
    const adapter = createJiraAdapter({ client, host: "x.atlassian.net" });
    const results = await adapter.searchTasks({ query: "auth refresh", limit: 5 });
    expect(client.searchJira).toHaveBeenCalledWith(
      'text ~ "auth refresh" ORDER BY updated DESC',
      { maxResults: 5 },
    );
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe("PROJ-123");
    expect(results[1].id).toBe("PROJ-124");
  });

  it("searchTasks escapes embedded double-quotes in the query", async () => {
    const client = {
      searchJira: vi.fn().mockResolvedValue({ issues: [] }),
    } as unknown as JiraClientLike;
    const adapter = createJiraAdapter({ client, host: "x.atlassian.net" });
    await adapter.searchTasks({ query: 'foo "bar" baz' });
    expect(client.searchJira).toHaveBeenCalledWith(
      'text ~ "foo \\"bar\\" baz" ORDER BY updated DESC',
      { maxResults: 25 },
    );
  });

  it("createTask requires `project`", async () => {
    const adapter = createJiraAdapter({
      client: {} as JiraClientLike,
      host: "x.atlassian.net",
    });
    await expect(
      adapter.createTask({ title: "x", description: "y" }),
    ).rejects.toThrow(/project.*Jira project key/);
  });

  it("createTask builds the correct fields payload + re-fetches", async () => {
    const client = {
      addNewIssue: vi.fn().mockResolvedValue({ key: "PROJ-125" }),
      findIssue: vi.fn().mockResolvedValue(makeFakeIssue({ key: "PROJ-125" })),
    } as unknown as JiraClientLike;
    const adapter = createJiraAdapter({ client, host: "x.atlassian.net" });

    const result = await adapter.createTask({
      title: "Fix the thing",
      description: "Because broken.",
      type: "Bug",
      priority: "high",
      category: "backend",
      complexity: "standard",
      estimatedHours: 4,
      project: "PROJ",
    });
    expect(client.addNewIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: expect.objectContaining({
          project: { key: "PROJ" },
          summary: "Fix the thing",
          description: "Because broken.",
          issuetype: { name: "Bug" },
          priority: { name: "High" },
          labels: ["category:backend", "complexity:standard"],
          timetracking: { originalEstimate: "4h" },
        }),
      }),
    );
    expect(result.id).toBe("PROJ-125");
  });

  it("updateTask transitions to a named status via the workflow", async () => {
    const client = {
      updateIssue: vi.fn().mockResolvedValue(undefined),
      listTransitions: vi.fn().mockResolvedValue({
        transitions: [
          { id: "11", name: "In Progress" },
          { id: "21", name: "Done" },
        ],
      }),
      transitionIssue: vi.fn().mockResolvedValue(undefined),
      findIssue: vi.fn().mockResolvedValue(makeFakeIssue()),
    } as unknown as JiraClientLike;
    const adapter = createJiraAdapter({ client, host: "x.atlassian.net" });

    await adapter.updateTask({
      id: "PROJ-123",
      status: "In Progress",
      priority: "low",
    });
    expect(client.updateIssue).toHaveBeenCalledWith(
      "PROJ-123",
      expect.objectContaining({
        fields: expect.objectContaining({
          priority: { name: "Low" },
        }),
      }),
    );
    expect(client.transitionIssue).toHaveBeenCalledWith("PROJ-123", {
      transition: { id: "11" },
    });
  });

  it("updateTask throws when the requested status isn't an available transition", async () => {
    const client = {
      updateIssue: vi.fn().mockResolvedValue(undefined),
      listTransitions: vi.fn().mockResolvedValue({
        transitions: [{ id: "11", name: "In Progress" }],
      }),
      findIssue: vi.fn().mockResolvedValue(makeFakeIssue()),
    } as unknown as JiraClientLike;
    const adapter = createJiraAdapter({ client, host: "x.atlassian.net" });
    await expect(
      adapter.updateTask({ id: "PROJ-123", status: "BlocknotInWorkflow" }),
    ).rejects.toThrow(/no transition.*BlocknotInWorkflow/);
  });

  it("completeTask transitions via the first Done/Closed/Resolved match", async () => {
    const client = {
      listTransitions: vi.fn().mockResolvedValue({
        transitions: [
          { id: "11", name: "In Progress" },
          { id: "31", name: "Closed" },
          { id: "21", name: "Done" },
        ],
      }),
      transitionIssue: vi.fn().mockResolvedValue(undefined),
      findIssue: vi.fn().mockResolvedValue(makeFakeIssue()),
    } as unknown as JiraClientLike;
    const adapter = createJiraAdapter({ client, host: "x.atlassian.net" });

    await adapter.completeTask({ id: "PROJ-123" });
    expect(client.transitionIssue).toHaveBeenCalledWith("PROJ-123", {
      transition: { id: "31" }, // "Closed" comes before "Done" in this list
    });
  });

  it("completeTask throws when no completion transition is available", async () => {
    const client = {
      listTransitions: vi.fn().mockResolvedValue({
        transitions: [{ id: "11", name: "In Progress" }],
      }),
    } as unknown as JiraClientLike;
    const adapter = createJiraAdapter({ client, host: "x.atlassian.net" });
    await expect(adapter.completeTask({ id: "PROJ-1" })).rejects.toThrow(
      /Done\/Closed\/Resolved\/Complete/,
    );
  });
});
