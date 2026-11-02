/**
 * The CLI version, read from package.json at runtime.
 *
 * `silo --version`, the banners, and the integration-test user-agent all use
 * this, so a version bump in package.json is the only edit a release needs.
 * `createRequire` resolves the path relative to this module, which works the
 * same from src/ (tsx, vitest) and from the bundled files in dist/ —
 * package.json sits one level up in both.
 */
import { createRequire } from "node:module";

const pkg = createRequire(import.meta.url)("../package.json") as { version: string };

export const VERSION: string = pkg.version;
