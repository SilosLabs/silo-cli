/**
 * Host path helpers.
 */
import { homedir } from "node:os";
import { resolve } from "node:path";

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
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  return resolve(path);
}
