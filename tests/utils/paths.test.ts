import { describe, it, expect } from "vitest";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { expandHostPath } from "../../src/utils/paths.js";

describe("expandHostPath", () => {
  it("expands a bare ~ to the home directory", () => {
    expect(expandHostPath("~")).toBe(homedir());
  });

  it("expands ~/ paths against the home directory", () => {
    expect(expandHostPath("~/silo-workspace")).toBe(join(homedir(), "silo-workspace"));
  });

  it("resolves a bare name to an absolute path, not a Docker volume name", () => {
    expect(expandHostPath("ws")).toBe(resolve(process.cwd(), "ws"));
  });

  it("resolves relative segments", () => {
    expect(expandHostPath("./a/../b")).toBe(resolve(process.cwd(), "b"));
  });

  it("leaves an absolute path unchanged", () => {
    expect(expandHostPath("/tmp/workspace")).toBe("/tmp/workspace");
  });

  it("does not treat ~user as the current user's home", () => {
    expect(expandHostPath("~other/ws")).toBe(resolve(process.cwd(), "~other/ws"));
  });
});
