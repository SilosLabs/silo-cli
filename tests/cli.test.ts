import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execa } from "execa";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Runs the real CLI entry point (via tsx) with a throwaway HOME, so the exit
// code is exactly what a shell script would see. cli.ts parses argv on import,
// so it can't be exercised in-process.
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
let home: string;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "silo-cli-test-"));
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

function silo(...args: string[]) {
  return execa("node", ["--import", "tsx", "src/cli.ts", ...args], {
    cwd: repoRoot,
    env: { HOME: home },
    reject: false,
  });
}

describe("CLI exit codes", () => {
  it.each(["bogus-cmd", "--bogus"])(
    "exits 1 for an unknown command or option (%s)",
    async (arg) => {
      const result = await silo(arg);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/unknown (command|option)/);
    },
    30_000,
  );

  it.each(["--help", "--version"])(
    "exits 0 for %s",
    async (arg) => {
      const result = await silo(arg);
      expect(result.exitCode).toBe(0);
    },
    30_000,
  );
});
