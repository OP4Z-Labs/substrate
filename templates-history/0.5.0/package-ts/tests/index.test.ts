import { describe, expect, it } from "vitest";
import { NAME, hello } from "../src/index.js";

describe("{{NAME}}", () => {
  it("exposes its name", () => {
    expect(NAME).toBe("{{NAME}}");
  });

  it("greets", () => {
    expect(hello()).toBe("hello from {{NAME}}");
  });
});
