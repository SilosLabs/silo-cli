import { describe, it, expect } from "vitest";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { expandHome, expandHostPath, isVolumeName } from "../../src/utils/paths.js";

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

  it("expands a Windows-style ~\\ path", () => {
    expect(expandHostPath("~\\ws")).toBe(join(homedir(), "ws"));
  });
});

describe("expandHome", () => {
  it("expands only a leading ~ and leaves relative paths relative", () => {
    expect(expandHome("~/ws")).toBe(join(homedir(), "ws"));
    expect(expandHome("ws")).toBe("ws");
    expect(expandHome("./ws")).toBe("./ws");
    expect(expandHome("/abs/ws")).toBe("/abs/ws");
  });
});

describe("isVolumeName", () => {
  it.each(["ws", "my-data", "data_1", "v1.2"])("treats %s as a Docker volume name", (name) => {
    expect(isVolumeName(name)).toBe(true);
  });

  it.each(["./ws", "~/ws", "/abs", "a/b", "", ".hidden", "-x"])("does not treat %s as a volume name", (name) => {
    expect(isVolumeName(name)).toBe(false);
  });
});
