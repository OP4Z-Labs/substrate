import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCreate } from "../src/commands/create.js";
import { makeTempDir, removeTempDir } from "./helpers.js";

describe("runCreate", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTempDir();
    process.chdir(tmp);
  });

  afterEach(() => {
    removeTempDir(tmp);
  });

  it("scaffolds package-ts into packages/typescript/<name>", () => {
    const result = runCreate({ template: "package-ts", name: "hello-pkg", quiet: true });
    expect(result.destination).toBe(join(tmp, "packages/typescript/hello-pkg"));

    const pkgJsonPath = join(result.destination, "package.json");
    expect(existsSync(pkgJsonPath)).toBe(true);

    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as { name: string };
    expect(pkg.name).toBe("hello-pkg");

    const indexPath = join(result.destination, "src/index.ts");
    expect(readFileSync(indexPath, "utf8")).toContain("hello-pkg");
  });

  it("scaffolds package-python and renames the source directory to snake_case", () => {
    const result = runCreate({ template: "package-python", name: "hello-py", quiet: true });
    expect(result.destination).toBe(join(tmp, "packages/python/hello-py"));

    const pkgInit = join(result.destination, "hello_py/__init__.py");
    expect(existsSync(pkgInit), "snake-cased package dir must exist").toBe(true);

    const contents = readFileSync(pkgInit, "utf8");
    expect(contents).toContain("hello-py");
  });

  it("rejects invalid names (uppercase, leading number)", () => {
    expect(() => runCreate({ template: "package-ts", name: "BadName", quiet: true })).toThrow(
      /kebab-case/,
    );
    expect(() => runCreate({ template: "package-ts", name: "9-leading", quiet: true })).toThrow(
      /kebab-case/,
    );
  });

  it("rejects unknown templates with an availability hint", () => {
    expect(() =>
      runCreate({ template: "service-rust", name: "foo", quiet: true }),
    ).toThrow(/not found.*Available/);
  });

  it("refuses to overwrite a non-empty destination", () => {
    runCreate({ template: "package-ts", name: "hello-pkg", quiet: true });
    expect(() =>
      runCreate({ template: "package-ts", name: "hello-pkg", quiet: true }),
    ).toThrow(/already exists/);
  });

  it("rejects framework-internal templates", () => {
    // `init` is for `substrate init`, not user-facing scaffolding.
    expect(() =>
      runCreate({ template: "init", name: "shadowed", quiet: true }),
    ).toThrow(/not a scaffold template/);
  });
});
