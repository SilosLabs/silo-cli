/**
 * Deciding what `silo start` mounts at /workspace.
 */
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { expandHome, isVolumeName } from "./paths.js";
import { dockerVolumeExists } from "./system.js";

export type WorkspaceMount =
  | {
      ok: true;
      /** The `-v <source>:/workspace` source: an absolute path, or a volume name. */
      source: string;
      /** True when `source` is an existing Docker named volume, not a host folder. */
      volume: boolean;
      /** Set when the caller should tell the user something about the mount. */
      warning?: string;
      hint?: string;
    }
  | { ok: false; error: string; hint: string };

/**
 * Work out the workspace mount from `--workspace` and the configured path.
 *
 * - A non-empty `--workspace` wins. An empty one (`-w "$WS"` with `WS` unset)
 *   falls back to the config rather than resolving to the current directory.
 * - `~` forms are expanded and absolute paths are used as they are. The folder
 *   must already exist, as `--mount` sources must: on Linux, Docker would
 *   otherwise create it owned by root, and the sandbox user can't write to it.
 * - A bare name such as `ws` used to reach Docker unchanged, which mounts the
 *   named volume `ws`. If that volume exists, the user's files are in it, so
 *   keep mounting it and say so, rather than switching to an empty folder.
 * - Any other relative path in the config has no reliable base directory (it
 *   depends on where `silo start` runs), so ask for an absolute path instead.
 *   On the command line, a relative path is resolved against the current
 *   directory, which is what a shell user means.
 */
export async function resolveWorkspaceMount(
  flag: string | undefined,
  configured: string,
  volumeExists: (name: string) => Promise<boolean> = dockerVolumeExists,
): Promise<WorkspaceMount> {
  const fromFlag = Boolean(flag);
  const raw = flag || configured;
  const expanded = expandHome(raw);

  if (!isAbsolute(expanded)) {
    if (isVolumeName(raw) && (await volumeExists(raw))) {
      return {
        ok: true,
        source: raw,
        volume: true,
        warning:
          `Workspace "${raw}" is a Docker named volume, not a host folder. Earlier SILO ` +
          `versions mounted bare names this way, so your files are in that volume. Still mounting it.`,
        hint:
          `To move to a host folder, copy the files out ` +
          `(docker run --rm -v ${raw}:/from -v /path/to/folder:/to alpine cp -a /from/. /to/) ` +
          `and set that folder as the workspace.`,
      };
    }
    if (!fromFlag) {
      return {
        ok: false,
        error: `The workspace path in your config, "${raw}", is relative, so the folder it points to depends on where you run silo.`,
        hint: "Set an absolute path: re-run `silo onboard --force`, or pass `--workspace /path/to/folder`.",
      };
    }
  }

  const source = resolve(expanded);
  if (!existsSync(source)) {
    return {
      ok: false,
      error: `Workspace folder does not exist: ${source}`,
      hint: `Create it with: mkdir -p "${source}"`,
    };
  }
  return { ok: true, source, volume: false };
}
