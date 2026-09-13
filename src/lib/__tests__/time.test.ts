import { describe, it, expect } from "vitest";
import { formatTimestamp } from "../time";

describe("formatTimestamp", () => {
  it("shows 'just now' for anything under a minute old", () => {
    const now = new Date(2024, 0, 1, 12, 0, 30);
    expect(formatTimestamp("2024-01-01 12:00:00", now)).toBe("just now");
  });

  it("shows minutes ago for under an hour old", () => {
    const now = new Date(2024, 0, 1, 12, 5, 0);
    expect(formatTimestamp("2024-01-01 12:00:00", now)).toBe("5 min ago");
  });

  it("shows hours ago for under a day old", () => {
    const now = new Date(2024, 0, 1, 15, 0, 0);
    expect(formatTimestamp("2024-01-01 12:00:00", now)).toBe("3 hr ago");
  });

  it("falls back to a locale date/time for anything a day or older", () => {
    const now = new Date(2024, 0, 3, 12, 0, 0);
    const result = formatTimestamp("2024-01-01 12:00:00", now);
    expect(result).not.toMatch(/ago|just now/);
  });

  it("falls back to a locale date/time for a timestamp in the future", () => {
    const now = new Date(2024, 0, 1, 12, 0, 0);
    const result = formatTimestamp("2024-01-01 12:05:00", now);
    expect(result).not.toMatch(/ago|just now/);
  });
});
