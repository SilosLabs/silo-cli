import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  evaluate,
  compilePolicy,
  evaluateCompiled,
  parsePolicyFile,
  placeRule,
} from "../../src/policy/engine.js";
import type { Policy } from "../../src/policy/engine.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DENY_ALL: Policy = {
  version: "1",
  name: "deny-all",
  default: "deny",
  rules: [
    { host: "llm.gateway", action: "allow" },
    { host: "localhost", action: "allow" },
    { host: "127.0.0.1", action: "allow" },
  ],
};

const PYPI_POLICY: Policy = {
  version: "1",
  name: "pypi",
  default: "deny",
  rules: [
    { host: "llm.gateway", action: "allow" },
    { host: "pypi.org", action: "allow" },
    { host: "files.pythonhosted.org", action: "allow" },
    { host: "*.pythonhosted.org", action: "allow" },
  ],
};

const ALLOW_ALL: Policy = {
  version: "1",
  name: "allow-all",
  default: "allow",
  rules: [{ host: "blocked.example.com", action: "deny" }],
};

// ---------------------------------------------------------------------------
// evaluate() — basic rule matching
// ---------------------------------------------------------------------------

describe("evaluate()", () => {
  it("allows llm.gateway in the deny-all policy", () => {
    expect(evaluate(DENY_ALL, "llm.gateway")).toBe("allow");
  });

  it("allows localhost in the deny-all policy", () => {
    expect(evaluate(DENY_ALL, "localhost")).toBe("allow");
    expect(evaluate(DENY_ALL, "127.0.0.1")).toBe("allow");
  });

  it("denies an unlisted host in the deny-all policy", () => {
    expect(evaluate(DENY_ALL, "api.openai.com")).toBe("deny");
    expect(evaluate(DENY_ALL, "evil.example.com")).toBe("deny");
    expect(evaluate(DENY_ALL, "pypi.org")).toBe("deny");
  });

  it("allows pypi.org and files.pythonhosted.org in the pypi policy", () => {
    expect(evaluate(PYPI_POLICY, "pypi.org")).toBe("allow");
    expect(evaluate(PYPI_POLICY, "files.pythonhosted.org")).toBe("allow");
  });

  it("denies non-pypi hosts in the pypi policy", () => {
    expect(evaluate(PYPI_POLICY, "registry.npmjs.org")).toBe("deny");
    expect(evaluate(PYPI_POLICY, "github.com")).toBe("deny");
  });

  it("allows any host in an allow-all policy", () => {
    expect(evaluate(ALLOW_ALL, "any.host.example")).toBe("allow");
    expect(evaluate(ALLOW_ALL, "api.openai.com")).toBe("allow");
  });

  it("explicit deny rule overrides an allow-all default", () => {
    expect(evaluate(ALLOW_ALL, "blocked.example.com")).toBe("deny");
  });

  it("first matching rule wins (earlier rule has priority)", () => {
    const policy: Policy = {
      version: "1",
      name: "priority-test",
      default: "deny",
      rules: [
        { host: "example.com", action: "allow" },
        { host: "example.com", action: "deny" }, // should never be reached
      ],
    };
    expect(evaluate(policy, "example.com")).toBe("allow");
  });
});

// ---------------------------------------------------------------------------
// Glob pattern matching (via picomatch)
// ---------------------------------------------------------------------------

describe("glob pattern matching", () => {
  it("matches any subdomain depth with *.host (picomatch * crosses dots)", () => {
    // In picomatch, * matches any char except '/'. Since hostnames have no
    // slashes, *.pythonhosted.org matches both shallow and deep subdomains.
    // This is intentionally permissive for allow-list rules.
    const policy: Policy = {
      version: "1",
      name: "glob-test",
      default: "deny",
      rules: [{ host: "*.pythonhosted.org", action: "allow" }],
    };
    expect(evaluate(policy, "cdn.pythonhosted.org")).toBe("allow");
    expect(evaluate(policy, "a.b.pythonhosted.org")).toBe("allow");
  });

  it("uses ** to match nested subdomains (same as * for hostnames)", () => {
    const policy: Policy = {
      version: "1",
      name: "deep-glob",
      default: "deny",
      rules: [{ host: "**.example.com", action: "allow" }],
    };
    expect(evaluate(policy, "sub.example.com")).toBe("allow");
    expect(evaluate(policy, "deep.sub.example.com")).toBe("allow");
  });

  it("matches brace expansion {a,b}", () => {
    const policy: Policy = {
      version: "1",
      name: "brace-test",
      default: "deny",
      rules: [{ host: "{pypi,npmjs}.org", action: "allow" }],
    };
    expect(evaluate(policy, "pypi.org")).toBe("allow");
    expect(evaluate(policy, "npmjs.org")).toBe("allow");
    expect(evaluate(policy, "github.com")).toBe("deny");
  });

  it("is case-insensitive", () => {
    const policy: Policy = {
      version: "1",
      name: "case-test",
      default: "deny",
      rules: [{ host: "PyPI.ORG", action: "allow" }],
    };
    expect(evaluate(policy, "pypi.org")).toBe("allow");
    expect(evaluate(policy, "PYPI.ORG")).toBe("allow");
  });
});

// ---------------------------------------------------------------------------
// compilePolicy / evaluateCompiled
// ---------------------------------------------------------------------------

describe("compilePolicy + evaluateCompiled", () => {
  it("produces the same results as evaluate()", () => {
    const compiled = compilePolicy(PYPI_POLICY);
    expect(evaluateCompiled(compiled, "pypi.org")).toBe(evaluate(PYPI_POLICY, "pypi.org"));
    expect(evaluateCompiled(compiled, "github.com")).toBe(evaluate(PYPI_POLICY, "github.com"));
  });

  it("compiling the same policy twice gives consistent results", () => {
    const a = compilePolicy(DENY_ALL);
    const b = compilePolicy(DENY_ALL);
    expect(evaluateCompiled(a, "llm.gateway")).toBe(
      evaluateCompiled(b, "llm.gateway"),
    );
  });
});

// ---------------------------------------------------------------------------
// parsePolicyFile
// ---------------------------------------------------------------------------

describe("parsePolicyFile", () => {
  let tmpFile: string;

  beforeEach(() => {
    tmpFile = join(tmpdir(), `silo-test-policy-${Date.now()}.yaml`);
  });

  afterEach(() => {
    try { unlinkSync(tmpFile); } catch { /* ignore */ }
  });

  it("parses a valid policy YAML file", () => {
    writeFileSync(
      tmpFile,
      `
version: "1"
name: test
default: deny
rules:
  - host: pypi.org
    action: allow
    comment: PyPI
`,
      "utf8",
    );

    const policy = parsePolicyFile(tmpFile);
    expect(policy.name).toBe("test");
    expect(policy.default).toBe("deny");
    expect(policy.rules).toHaveLength(1);
    expect(policy.rules[0]?.host).toBe("pypi.org");
    expect(policy.rules[0]?.action).toBe("allow");
    expect(policy.rules[0]?.comment).toBe("PyPI");
  });

  it("throws when the file does not exist", () => {
    expect(() =>
      parsePolicyFile("/nonexistent/path/policy.yaml"),
    ).toThrow(/Cannot read policy file/);
  });

  it("throws on invalid YAML", () => {
    writeFileSync(tmpFile, "{ invalid yaml: [unclosed", "utf8");
    expect(() => parsePolicyFile(tmpFile)).toThrow(/YAML parse error/);
  });

  it("throws when required fields are missing", () => {
    writeFileSync(tmpFile, `name: incomplete\nrules: []`, "utf8");
    expect(() => parsePolicyFile(tmpFile)).toThrow(/Invalid policy schema/);
  });

  it("throws when an action value is not allow|deny", () => {
    writeFileSync(
      tmpFile,
      `
version: "1"
name: bad-action
default: deny
rules:
  - host: example.com
    action: permit
`,
      "utf8",
    );
    expect(() => parsePolicyFile(tmpFile)).toThrow(/Invalid policy schema/);
  });

  it("accepts an optional description field", () => {
    writeFileSync(
      tmpFile,
      `
version: "1"
name: described
description: "A test policy"
default: allow
rules: []
`,
      "utf8",
    );
    const policy = parsePolicyFile(tmpFile);
    expect(policy.description).toBe("A test policy");
  });
});

// ---------------------------------------------------------------------------
// placeRule: where `policy add` inserts a rule so that it takes effect
// ---------------------------------------------------------------------------

describe("placeRule", () => {
  const npmPolicy = (): Policy => ({
    version: "1",
    name: "npm",
    default: "deny",
    rules: [
      { host: "llm.gateway", action: "allow" },
      { host: "registry.npmjs.org", action: "allow" },
      { host: "*.npmjs.org", action: "allow" },
      { host: "github.com", action: "allow" },
    ],
  });

  function add(policy: Policy, rule: Policy["rules"][number]): Policy {
    const { index } = placeRule(policy, rule);
    policy.rules.splice(index, 0, rule);
    return policy;
  }

  it("puts a deny ahead of the allow wildcard that would shadow it", () => {
    const policy = npmPolicy();
    const rule = { host: "evil.npmjs.org", action: "deny" as const };
    const placed = placeRule(policy, rule);
    expect(placed.index).toBe(2);
    expect(placed.ahead?.host).toBe("*.npmjs.org");
    expect(evaluate(add(policy, rule), "evil.npmjs.org")).toBe("deny");
    // Other hosts under the wildcard are still allowed.
    expect(evaluate(policy, "cdn.npmjs.org")).toBe("allow");
  });

  it("appending is what used to happen, and it left the host allowed", () => {
    const policy = npmPolicy();
    policy.rules.push({ host: "evil.npmjs.org", action: "deny" });
    expect(evaluate(policy, "evil.npmjs.org")).toBe("allow");
  });

  it("places a deny wildcard ahead of a broader allow wildcard", () => {
    const policy = npmPolicy();
    const rule = { host: "*.evil.npmjs.org", action: "deny" as const };
    expect(placeRule(policy, rule).ahead?.host).toBe("*.npmjs.org");
    expect(evaluate(add(policy, rule), "x.evil.npmjs.org")).toBe("deny");
  });

  it("appends a rule that no earlier rule contradicts", () => {
    const policy = npmPolicy();
    const placed = placeRule(policy, { host: "api.example.com", action: "allow" });
    expect(placed).toEqual({ index: policy.rules.length });
  });

  it("appends when the earlier match already has the same action", () => {
    const policy = npmPolicy();
    const placed = placeRule(policy, { host: "cdn.npmjs.org", action: "allow" });
    expect(placed.index).toBe(policy.rules.length);
    expect(placed.ahead).toBeUndefined();
  });

  it("matches existing patterns case-insensitively, like evaluation does", () => {
    const policy = npmPolicy();
    const rule = { host: "EVIL.NPMJS.ORG", action: "deny" as const };
    expect(placeRule(policy, rule).ahead?.host).toBe("*.npmjs.org");
    expect(evaluate(add(policy, rule), "evil.npmjs.org")).toBe("deny");
  });

  it("puts an allow ahead of a deny that would block it", () => {
    const policy: Policy = {
      version: "1",
      name: "blocklist",
      default: "allow",
      rules: [{ host: "*.example.com", action: "deny" }],
    };
    const rule = { host: "docs.example.com", action: "allow" as const };
    expect(placeRule(policy, rule)).toEqual({ index: 0, ahead: policy.rules[0] });
    expect(evaluate(add(policy, rule), "docs.example.com")).toBe("allow");
  });
});
