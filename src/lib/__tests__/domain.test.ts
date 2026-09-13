import { describe, it, expect } from "vitest";
import { normalizeDomain } from "../domain";

describe("normalizeDomain", () => {
  it("lowercases and trims", () => {
    expect(normalizeDomain("  EXAMPLE.com  ")).toBe("example.com");
  });

  it("strips a scheme", () => {
    expect(normalizeDomain("https://example.com")).toBe("example.com");
    expect(normalizeDomain("http://example.com")).toBe("example.com");
  });

  it("strips a leading wildcard", () => {
    expect(normalizeDomain("*.example.com")).toBe("example.com");
  });

  it("strips path and query", () => {
    expect(normalizeDomain("example.com/path?query=1")).toBe("example.com");
  });

  it("strips a port", () => {
    expect(normalizeDomain("example.com:8080")).toBe("example.com");
  });

  it("combines scheme, wildcard, path and port", () => {
    expect(normalizeDomain("https://*.example.com:8080/path")).toBe("example.com");
  });

  it("accepts localhost", () => {
    expect(normalizeDomain("localhost")).toBe("localhost");
  });

  it("accepts an IPv4 address", () => {
    expect(normalizeDomain("192.168.1.1")).toBe("192.168.1.1");
  });

  it("rejects a bare word with no dot", () => {
    expect(normalizeDomain("hello")).toBeNull();
    expect(normalizeDomain("foo")).toBeNull();
  });

  it("rejects userinfo-shaped input", () => {
    // Mirrors the Rust side's normalize_entry - "user:pass@example.com"
    // strips down to "user" via port-handling, and "user@example.com" has
    // no colon to strip at all; both must be rejected outright rather than
    // silently accepted (or, for the colon case, reduced to "user").
    expect(normalizeDomain("user:pass@example.com")).toBeNull();
    expect(normalizeDomain("user@example.com")).toBeNull();
  });

  it("accepts localhost and an IPv4 literal directly", () => {
    expect(normalizeDomain("localhost")).toBe("localhost");
    expect(normalizeDomain("127.0.0.1")).toBe("127.0.0.1");
  });

  it("rejects an empty string", () => {
    expect(normalizeDomain("   ")).toBeNull();
  });

  it("strips a trailing dot", () => {
    expect(normalizeDomain("example.com.")).toBe("example.com");
  });

  it("strips trailing dots and a fragment together", () => {
    expect(normalizeDomain("sub.example.com.#frag")).toBe("sub.example.com");
  });

  it("rejects a bare IPv6 literal", () => {
    expect(normalizeDomain("::1")).toBeNull();
    expect(normalizeDomain("2001:db8::1")).toBeNull();
  });

  it("rejects a bracketed IPv6 literal", () => {
    expect(normalizeDomain("[::1]")).toBeNull();
  });

  // Regression: naively cutting at the *first* colon (rather than rejecting
  // anything with more than one remaining colon, matching the Rust side's
  // normalize_entry) would silently truncate these into an accepted host
  // instead of rejecting the whole entry.
  it("rejects an IPv4 address with more than one colon instead of truncating it", () => {
    expect(normalizeDomain("1.2.3.4:5:6")).toBeNull();
  });

  it("rejects a domain with more than one colon instead of truncating it", () => {
    expect(normalizeDomain("example.com:80:80")).toBeNull();
  });

  it("still accepts a single bracketed IPv6 literal as rejected, and a normal domain:port as accepted", () => {
    expect(normalizeDomain("[::1]")).toBeNull();
    expect(normalizeDomain("example.com:8080")).toBe("example.com");
  });
});
