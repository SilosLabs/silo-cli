import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resolveWorkspaceMount } from "../../src/utils/workspace.js";

// No Docker here: volume lookups are injected.
const noVolumes = vi.fn(async () => false);
const volumes = (...names: string[]) => vi.fn(async (name: string) => names.includes(name));

describe("resolveWorkspaceMount", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "silo-ws-"));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("uses an absolute configured folder as it is", async () => {
    expect(await resolveWorkspaceMount(undefined, dir, noVolumes)).toEqual({ ok: true, source: dir, volume: false });
  });

  it("prefers a non-empty --workspace over the config", async () => {
    const result = await resolveWorkspaceMount(dir, "/somewhere/else", noVolumes);
    expect(result).toMatchObject({ ok: true, source: dir });
  });

  it("falls back to the config when --workspace is empty, instead of the current directory", async () => {
    const result = await resolveWorkspaceMount("", dir, noVolumes);
    expect(result).toMatchObject({ ok: true, source: dir });
    expect(result).not.toMatchObject({ source: process.cwd() });
  });

  it("expands ~ in the configured path", async () => {
    expect(await resolveWorkspaceMount(undefined, "~", noVolumes)).toMatchObject({ ok: true, source: homedir() });
  });

  it("keeps mounting an existing named volume from an older bare-name config, with a warning", async () => {
    const volumeExists = volumes("ws");
    const result = await resolveWorkspaceMount(undefined, "ws", volumeExists);
    expect(volumeExists).toHaveBeenCalledWith("ws");
    expect(result).toMatchObject({ ok: true, source: "ws", volume: true });
    expect(result.ok && result.warning).toMatch(/Docker named volume/);
    expect(result.ok && result.hint).toMatch(/docker run --rm -v ws:\/from/);
  });

  it("refuses a bare-name config with no such volume rather than guessing a folder", async () => {
    const result = await resolveWorkspaceMount(undefined, "ws", noVolumes);
    expect(result).toMatchObject({ ok: false });
    expect(!result.ok && result.error).toMatch(/is relative/);
  });

  it("refuses a relative configured path that Docker never accepted", async () => {
    const volumeExists = vi.fn(async () => true);
    const result = await resolveWorkspaceMount(undefined, "./my-project", volumeExists);
    expect(result).toMatchObject({ ok: false });
    expect(volumeExists).not.toHaveBeenCalled(); // "./my-project" can't be a volume name
  });

  it("resolves a relative --workspace against the current directory", async () => {
    const result = await resolveWorkspaceMount("src", "/unused", noVolumes);
    expect(result).toMatchObject({ ok: true, source: resolve(process.cwd(), "src"), volume: false });
  });

  it("still honours an existing volume named on the command line", async () => {
    expect(await resolveWorkspaceMount("ws", "/unused", volumes("ws"))).toMatchObject({ ok: true, source: "ws", volume: true });
  });

  it("refuses a folder that doesn't exist, like --mount does", async () => {
    const missing = join(dir, "missing");
    const result = await resolveWorkspaceMount(undefined, missing, noVolumes);
    expect(result).toEqual({
      ok: false,
      error: `Workspace folder does not exist: ${missing}`,
      hint: `Create it with: mkdir -p "${missing}"`,
    });
  });
});
