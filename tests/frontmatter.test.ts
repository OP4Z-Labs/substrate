import { describe, expect, it } from "vitest";
import { parseFrontMatter } from "../src/util/frontmatter.js";

describe("parseFrontMatter", () => {
  it("parses string and integer scalars", () => {
    const source = ["---", "command: audit", "action: pre-merge", "schema_version: 2", "---", "", "# body"].join(
      "\n",
    );
    const { data, body } = parseFrontMatter(source);
    expect(data.command).toBe("audit");
    expect(data.action).toBe("pre-merge");
    expect(data.schema_version).toBe(2);
    expect(body.trim()).toBe("# body");
  });

  it("strips surrounding quotes", () => {
    const { data } = parseFrontMatter(['---', 'title: "Quoted"', "---"].join("\n"));
    expect(data.title).toBe("Quoted");
  });

  it("returns empty data when no front matter present", () => {
    const { data, body } = parseFrontMatter("# Just a heading\n\nNo front matter here.");
    expect(data).toEqual({});
    expect(body).toContain("# Just a heading");
  });

  it("skips comment lines inside the front matter block", () => {
    const source = ["---", "# a comment", "command: audit", "---"].join("\n");
    const { data } = parseFrontMatter(source);
    expect(data.command).toBe("audit");
  });
});
