import { describe, it, expect } from "vitest";
import { noCacheArgs } from "../../src/commands/build.js";

describe("noCacheArgs", () => {
  it("adds --no-cache when the cache option is false (silo build --no-cache)", () => {
    expect(noCacheArgs(false)).toEqual(["--no-cache"]);
  });

  it("adds nothing when the cache option is true or unset", () => {
    expect(noCacheArgs(true)).toEqual([]);
    expect(noCacheArgs(undefined)).toEqual([]);
  });
});
