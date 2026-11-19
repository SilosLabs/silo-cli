/**
 * Host path helpers.
 */
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Expand a leading `~` to the home directory, the way a shell would, and
 * leave everything else untouched. Covers `~`, `~/x` and Windows-style `~\x`.
 * `~user/x` is not expanded.
 */
export function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (/^~[\\/]/.test(path)) return join(homedir(), path.slice(2));
  return path;
}

/**
 * Turn a user-supplied host path into the absolute path Docker needs.
 *
 * Expands a leading `~` (a shell would, but prompts, flags read from config
 * and YAML don't) and resolves relative paths against the current directory.
 * Docker rejects a `~/…` bind-mount source and treats a bare name such as `ws`
 * as a named volume, so a raw path either fails or silently mounts something
 * other than the host folder the user meant.
 */
export function expandHostPath(path: string): string {
  return resolve(expandHome(path));
}

/**
 * True when Docker would read this `-v` source as a named volume rather than
 * a host path: its rule for local volume names is `[a-zA-Z0-9][a-zA-Z0-9_.-]*`.
 */
export function isVolumeName(path: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(path);
}
