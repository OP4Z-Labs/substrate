/**
 * Unit tests for @cadence/adapter-linear.
 *
 * Strategy: inject a hand-rolled fake LinearClient via the
 * `createLinearAdapter({ client })` option. This bypasses real HTTP
 * (no nock or live API needed) and gives precise control over what
 * the SDK returns per call.
 *
 * For each verb, we assert:
 *   - The adapter routes to the right Linear SDK method
 *   - The cadence-canonical task returned has the right shape
 *   - Edge cases (404, missing required fields) surface correctly
 */

import { describe, expect, it, vi } from "vitest";
import type { LinearClient, Issue } from "@linear/sdk";
import { createLinearAdapter } from "../src/index.js";

/**
 * Build a Linear-Issue-shaped fixture. Linear's Issue model uses lazy
 * promise getters for related entities (state, assignee, labels); the
 * fake mirrors that shape.
 */
function makeFakeIssue(overrides: Record<string, unknown> = {}): Issue {
  const fixture = {
    id: "uuid-1234",
    identifier: "ENG-123",
    title: "Fix the thing",
    description: "Because it is broken.",
    priority: 2, // High
    estimate: 3,
    url: "https://linear.app/test/issue/ENG-123",
    state: Promise.resolve({ id: "state-1", name: "In Progress", type: "started" }),
    assignee: Promise.resolve({ email: "test@example.com", name: "Test User" }),
    labels: vi.fn().mockResolvedValue({
      nodes: [
        { name: "type:bug" },
        { name: "category:backend" },
      ],
    }),
    team: Promise.resolve({
      id: "team-1",
      states: vi.fn().mockResolvedValue({
        nodes: [
          { id: "state-1", name: "In Progress", type: "started" },
          { id: "state-2", name: "Done", type: "completed" },
        ],
      }),
    }),
    ...overrides,
  };
  return fixture as unknown as Issue;
}

describe("@cadence/adapter-linear", () => {
  it("exports name + version metadata", () => {
    const fake = {} as LinearClient;
    const adapter = createLinearAdapter({ client: fake });
    expect(adapter.name).toBe("@cadence/adapter-linear");
    expect(adapter.version).toBe("0.8.0");
  });

  it("throws if no API key and no injected client", () => {
    const orig = process.env.LINEAR_API_KEY;
    delete process.env.LINEAR_API_KEY;
    expect(() => createLinearAdapter()).toThrow(/LINEAR_API_KEY/);
    if (orig) process.env.LINEAR_API_KEY = orig;
  });

  it("findTask returns the cadence task shape", async () => {
    const fakeClient = {
      issue: vi.fn().mockResolvedValue(makeFakeIssue()),
    } as unknown as LinearClient;
    const adapter = createLinearAdapter({ client: fakeClient });

    const task = await adapter.findTask({ id: "ENG-123" });
    expect(fakeClient.issue).toHaveBeenCalledWith("ENG-123");
    expect(task).not.toBeNull();
    expect(task?.id).toBe("ENG-123");
    expect(task?.title).toBe("Fix the thing");
    expect(task?.description).toBe("Because it is broken.");
    expect(task?.status).toBe("In Progress");
    expect(task?.priority).toBe("high");
    expect(task?.type).toBe("bug");
    expect(task?.assignee).toBe("test@example.com");
    expect(task?.labels).toContain("type:bug");
    expect(task?.estimatedHours).toBe(3);
    expect(task?.url).toBe("https://linear.app/test/issue/ENG-123");
  });

  it("findTask returns null on 'not found' errors instead of throwing", async () => {
    const fakeClient = {
      issue: vi.fn().mockRejectedValue(new Error("Entity not found: Issue")),
    } as unknown as LinearClient;
    const adapter = createLinearAdapter({ client: fakeClient });

    const task = await adapter.findTask({ id: "ENG-9999" });
    expect(task).toBeNull();
  });

  it("findTask re-throws unexpected errors", async () => {
    const fakeClient = {
      issue: vi.fn().mockRejectedValue(new Error("Network blew up")),
    } as unknown as LinearClient;
    const adapter = createLinearAdapter({ client: fakeClient });
    await expect(adapter.findTask({ id: "ENG-1" })).rejects.toThrow(/Network/);
  });

  it("searchTasks queries by title/description containsIgnoreCase", async () => {
    const fakeClient = {
      issues: vi.fn().mockResolvedValue({
        nodes: [makeFakeIssue(), makeFakeIssue({ identifier: "ENG-124" })],
      }),
    } as unknown as LinearClient;
    const adapter = createLinearAdapter({ client: fakeClient });

    const results = await adapter.searchTasks({ query: "auth", limit: 5 });
    expect(fakeClient.issues).toHaveBeenCalledWith(
      expect.objectContaining({
        first: 5,
        filter: expect.objectContaining({
          or: expect.arrayContaining([
            expect.objectContaining({
              title: { containsIgnoreCase: "auth" },
            }),
          ]),
        }),
      }),
    );
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe("ENG-123");
    expect(results[1].id).toBe("ENG-124");
  });

  it("searchTasks defaults to limit=25 when not provided", async () => {
    const fakeClient = {
      issues: vi.fn().mockResolvedValue({ nodes: [] }),
    } as unknown as LinearClient;
    const adapter = createLinearAdapter({ client: fakeClient });

    await adapter.searchTasks({ query: "x" });
    expect(fakeClient.issues).toHaveBeenCalledWith(
      expect.objectContaining({ first: 25 }),
    );
  });

  it("createTask requires `project` (team key)", async () => {
    const fakeClient = {} as LinearClient;
    const adapter = createLinearAdapter({ client: fakeClient });
    await expect(
      adapter.createTask({
        title: "x",
        description: "y",
      }),
    ).rejects.toThrow(/project.*team key/);
  });

  it("createTask resolves team by key and creates the issue", async () => {
    const fakeClient = {
      teams: vi.fn().mockResolvedValue({
        nodes: [{ id: "team-1", key: "ENG" }],
      }),
      createIssue: vi.fn().mockResolvedValue({
        issue: Promise.resolve(makeFakeIssue()),
      }),
    } as unknown as LinearClient;
    const adapter = createLinearAdapter({ client: fakeClient });

    const result = await adapter.createTask({
      title: "Fix the thing",
      description: "Because it is broken.",
      priority: "high",
      type: "bug",
      project: "ENG",
      estimatedHours: 3,
    });
    expect(fakeClient.teams).toHaveBeenCalledWith({
      filter: { key: { eq: "ENG" } },
    });
    expect(fakeClient.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: "team-1",
        title: "Fix the thing",
        description: "Because it is broken.",
        priority: 2, // high → 2
        estimate: 3,
      }),
    );
    expect(result.id).toBe("ENG-123");
  });

  it("createTask throws when the team key is unknown", async () => {
    const fakeClient = {
      teams: vi.fn().mockResolvedValue({ nodes: [] }),
    } as unknown as LinearClient;
    const adapter = createLinearAdapter({ client: fakeClient });
    await expect(
      adapter.createTask({
        title: "x",
        description: "y",
        project: "DOES_NOT_EXIST",
      }),
    ).rejects.toThrow(/team.*DOES_NOT_EXIST/);
  });

  it("updateTask resolves status name to state ID and updates", async () => {
    const fakeClient = {
      issue: vi.fn().mockResolvedValue(makeFakeIssue()),
      updateIssue: vi.fn().mockResolvedValue({
        issue: Promise.resolve(makeFakeIssue()),
      }),
    } as unknown as LinearClient;
    const adapter = createLinearAdapter({ client: fakeClient });

    await adapter.updateTask({
      id: "ENG-123",
      status: "Done",
      priority: "low",
      estimatedHours: 5,
    });
    expect(fakeClient.updateIssue).toHaveBeenCalledWith(
      "ENG-123",
      expect.objectContaining({
        priority: 4, // low → 4
        estimate: 5,
        stateId: "state-2",
      }),
    );
  });

  it("completeTask sets the issue's state to the first 'completed' workflow state", async () => {
    const fakeClient = {
      issue: vi.fn().mockResolvedValue(makeFakeIssue()),
      updateIssue: vi.fn().mockResolvedValue({
        issue: Promise.resolve(makeFakeIssue({ state: Promise.resolve({ name: "Done" }) })),
      }),
    } as unknown as LinearClient;
    const adapter = createLinearAdapter({ client: fakeClient });

    const result = await adapter.completeTask({ id: "ENG-123", actualHours: 2 });
    expect(fakeClient.updateIssue).toHaveBeenCalledWith(
      "ENG-123",
      { stateId: "state-2" },
    );
    expect(result.id).toBe("ENG-123");
  });

  it("completeTask throws when no completed state exists on the team", async () => {
    const fakeIssue = makeFakeIssue({
      team: Promise.resolve({
        states: vi.fn().mockResolvedValue({
          nodes: [
            { id: "state-1", name: "In Progress", type: "started" },
          ],
        }),
      }),
    });
    const fakeClient = {
      issue: vi.fn().mockResolvedValue(fakeIssue),
    } as unknown as LinearClient;
    const adapter = createLinearAdapter({ client: fakeClient });
    await expect(adapter.completeTask({ id: "ENG-123" })).rejects.toThrow(
      /completed/,
    );
  });
});
