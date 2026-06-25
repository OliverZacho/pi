import { describe, it, expect } from "vitest";
import { collapseDuplicateRows } from "@/lib/dedup";

type Row = { tag: string; email: { id: string; duplicate_of: string | null } | null };

const row = (
  tag: string,
  id: string,
  duplicate_of: string | null = null
): Row => ({ tag, email: { id, duplicate_of } });

describe("collapseDuplicateRows", () => {
  it("collapses copies that share a canonical down to the first seen", () => {
    const rows: Row[] = [
      row("a", "dup1", "canon"),
      row("b", "dup2", "canon"),
      row("c", "canon"),
      row("d", "other")
    ];
    const out = collapseDuplicateRows(rows, (r) => r.email);
    expect(out.map((r) => r.tag)).toEqual(["a", "d"]);
  });

  it("treats a canonical row and its copies as one group regardless of order", () => {
    const rows: Row[] = [
      row("canonical", "canon"),
      row("copy", "dup1", "canon")
    ];
    const out = collapseDuplicateRows(rows, (r) => r.email);
    expect(out.map((r) => r.tag)).toEqual(["canonical"]);
  });

  it("keeps distinct emails untouched", () => {
    const rows: Row[] = [row("a", "1"), row("b", "2"), row("c", "3")];
    const out = collapseDuplicateRows(rows, (r) => r.email);
    expect(out).toHaveLength(3);
  });

  it("preserves caller ordering (group sits at its first member)", () => {
    const rows: Row[] = [
      row("newest-copy", "dup2", "canon"),
      row("x", "x"),
      row("older-copy", "dup1", "canon")
    ];
    const out = collapseDuplicateRows(rows, (r) => r.email);
    expect(out.map((r) => r.tag)).toEqual(["newest-copy", "x"]);
  });

  it("keeps rows whose email can't be resolved instead of dropping them", () => {
    const rows: Row[] = [{ tag: "orphan", email: null }, row("a", "1")];
    const out = collapseDuplicateRows(rows, (r) => r.email);
    expect(out.map((r) => r.tag)).toEqual(["orphan", "a"]);
  });
});
