import { describe, expect, it } from "vitest";
import { parseYaml } from "../src/util/yaml-mini.js";

describe("parseYaml", () => {
  it("parses an empty document", () => {
    expect(parseYaml("")).toEqual({});
  });

  it("parses a flat mapping of scalars", () => {
    const doc = parseYaml(`name: foo\nversion: 1\nactive: true\n`);
    expect(doc).toEqual({ name: "foo", version: 1, active: true });
  });

  it("parses nested mappings", () => {
    const doc = parseYaml(`project:\n  name: bar\n  version: 2\n`);
    expect(doc).toEqual({ project: { name: "bar", version: 2 } });
  });

  it("parses block sequences of scalars", () => {
    const doc = parseYaml(`items:\n  - a\n  - b\n  - c\n`);
    expect(doc).toEqual({ items: ["a", "b", "c"] });
  });

  it("parses sequences of mappings (docker-compose services)", () => {
    const doc = parseYaml(`services:\n  web:\n    image: node\n    ports:\n      - "3000:3000"\n`);
    expect(doc).toEqual({
      services: { web: { image: "node", ports: ["3000:3000"] } },
    });
  });

  it("keeps quoted strings as strings even when they look like numbers", () => {
    const doc = parseYaml(`port: "8080"\n`);
    expect(doc).toEqual({ port: "8080" });
  });

  it("ignores comments and blank lines", () => {
    const doc = parseYaml(`# comment\nname: foo\n\n# another\nversion: 1\n`);
    expect(doc).toEqual({ name: "foo", version: 1 });
  });

  it("parses inline arrays", () => {
    const doc = parseYaml(`tags: [a, b, c]\n`);
    expect(doc).toEqual({ tags: ["a", "b", "c"] });
  });

  it("handles list items with colons in the value (path mounts)", () => {
    const doc = parseYaml(`volumes:\n  - ./app:/app\n  - db-data:/var/lib/data\n`);
    expect(doc).toEqual({ volumes: ["./app:/app", "db-data:/var/lib/data"] });
  });

  it("parses null / empty / ~ as null", () => {
    const doc = parseYaml(`a:\nb: ~\nc: null\n`);
    expect(doc).toEqual({ a: null, b: null, c: null });
  });
});
