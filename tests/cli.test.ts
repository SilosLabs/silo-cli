import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execa } from "execa";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Runs the real CLI entry point (via tsx) with a throwaway HOME, so the exit
// code is exactly what a shell script would see. cli.ts parses argv on import,
// so it can't be exercised in-process.
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
let home: string;

// conf stores the config under $XDG_CONFIG_HOME on Linux when it's set (CI
// runners set it), ignoring HOME. Pin it inside each throwaway HOME, or every
// test shares, and writes to, the runner's real config directory.
function isolatedEnv(homeDir: string): Record<string, string> {
  return { HOME: homeDir, XDG_CONFIG_HOME: join(homeDir, ".config") };
}

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "silo-cli-test-"));
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

function silo(...args: string[]) {
  return execa("node", ["--import", "tsx", "src/cli.ts", ...args], {
    cwd: repoRoot,
    env: isolatedEnv(home),
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

// ---------------------------------------------------------------------------
// Commands that fail must exit non-zero, so scripts and CI can rely on them.
// A fake `docker` on PATH stands in for the daemon. FAKE_DOCKER_FAIL picks what
// fails: "all", "rmi", or "rm:<container>".
// ---------------------------------------------------------------------------

const FAKE_DOCKER = `#!/bin/sh
[ "$FAKE_DOCKER_FAIL" = "all" ] && { echo "Cannot connect to the Docker daemon" >&2; exit 1; }
case "$1" in
  info|version|stop) exit 0 ;;
  ps) printf 'silo-a\\nsilo-b\\n'; exit 0 ;;
  rm) for a in "$@"; do [ "rm:$a" = "$FAKE_DOCKER_FAIL" ] && { echo "Error: could not remove $a" >&2; exit 1; }; done; exit 0 ;;
  rmi) [ "$FAKE_DOCKER_FAIL" = "rmi" ] && { echo "Error: No such image" >&2; exit 1; }; exit 0 ;;
  *) exit 1 ;;
esac
`;

describe("exit codes when a command fails", () => {
  let fakeBin: string;
  let configuredHome: string;

  beforeAll(async () => {
    fakeBin = mkdtempSync(join(tmpdir(), "silo-fake-docker-"));
    writeFileSync(join(fakeBin, "docker"), FAKE_DOCKER);
    chmodSync(join(fakeBin, "docker"), 0o755);

    // A real, valid config written through the config manager.
    configuredHome = mkdtempSync(join(tmpdir(), "silo-cli-home-"));
    mkdirSync(join(configuredHome, "ws"));
    const write = `
      const { writeConfig } = await import("./src/config/manager.ts");
      const { SiloConfigSchema } = await import("./src/config/schema.ts");
      writeConfig(SiloConfigSchema.parse({
        version: "1",
        llm: { provider: "openai", apiKey: "sk-test-key", model: "gpt-4o" },
        sandbox: { image: "silo-sandbox:latest", containerName: "silo-agent",
          workspacePath: ${JSON.stringify(join(configuredHome, "ws"))}, cpuLimit: "1.0", memoryLimit: "1g", autoOpenLogs: false },
      }));`;
    await execa("node", ["--import", "tsx", "--input-type=module", "-e", write], {
      cwd: repoRoot,
      env: isolatedEnv(configuredHome),
    });
  }, 30_000);

  afterAll(() => {
    rmSync(fakeBin, { recursive: true, force: true });
    rmSync(configuredHome, { recursive: true, force: true });
  });

  function siloWith(homeDir: string, fail: string, ...args: string[]) {
    return execa("node", ["--import", "tsx", "src/cli.ts", ...args], {
      cwd: repoRoot,
      env: { ...isolatedEnv(homeDir), PATH: `${fakeBin}:${process.env.PATH}`, FAKE_DOCKER_FAIL: fail },
      reject: false,
    });
  }

  it("doctor exits 1 when a check fails", async () => {
    const result = await siloWith(home, "all", "doctor");
    expect(result.stdout + result.stderr).toMatch(/critical issue/);
    expect(result.exitCode).toBe(1);
  }, 30_000);

  it("snapshot delete exits 1 when the snapshot can't be deleted", async () => {
    const result = await siloWith(configuredHome, "rmi", "snapshot", "delete", "missing");
    expect(result.exitCode).toBe(1);
  }, 30_000);

  it("stop --all exits 1 when a container can't be stopped", async () => {
    const result = await siloWith(configuredHome, "rm:silo-b", "stop", "--all");
    expect(result.stdout + result.stderr).toMatch(/Could not stop: silo-b/);
    expect(result.exitCode).toBe(1);
  }, 30_000);

  it("stop --all still exits 0 when everything stops", async () => {
    const result = await siloWith(configuredHome, "", "stop", "--all");
    expect(result.stdout + result.stderr).toMatch(/shut down cleanly/);
    expect(result.exitCode).toBe(0);
  }, 30_000);

  it("snapshot delete still exits 0 when the snapshot is deleted", async () => {
    const result = await siloWith(configuredHome, "", "snapshot", "delete", "present");
    expect(result.exitCode).toBe(0);
  }, 30_000);
});
