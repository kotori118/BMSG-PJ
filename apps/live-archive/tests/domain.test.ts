import { describe, it, expect } from "vitest";
import { trialDataset, trialSongs } from "../fixtures/dome2024";
import {
  analyze,
  effectiveEntries,
  deriveOverrides,
  validateDataset,
  medley,
  unheard,
  mergeLocalSong,
  templateImpact,
  exportJson,
  parseBackup,
  importPreview,
} from "../shared/domain";
import {
  normalizeSongs,
  nextSnapshot,
  mergeCandidates,
} from "../shared/universe";
describe("v0.24 setlists and analytics", () => {
  it("keeps missing setlists out of denominators; cover remains heard", () => {
    const d = trialDataset();
    validateDataset(d);
    const stats = analyze(d, d.shows);
    expect(stats).toHaveLength(29);
    expect(stats.every((s) => s.shows === 1 && s.rate === 1)).toBe(true);
    expect(effectiveEntries(d, d.shows[0])).toBeNull();
    const heard = new Set(stats.map((x) => x.songRef));
    expect(heard.has("L:local-to-the-first")).toBe(true);
    expect(
      unheard(
        [
          ...trialSongs,
          { ...trialSongs[0], ref: "U:unit", artist: "UNIT" },
          { ...trialSongs[0], ref: "U:subunit", artist: "BE:FIRST" },
        ],
        heard,
      ).map((s) => s.ref),
    ).toEqual(["U:subunit"]);
  });
  it("Slogan SHORT+FULL counts 2 performances, 1 show; null is not FULL", () => {
    const d = trialDataset(),
      t = d.templates[0];
    t.entries = [
      { ...t.entries[0], id: "a", songRef: "U:1032", version: "SHORT" },
      { ...t.entries[0], id: "b", songRef: "U:1032", version: "FULL" },
      { ...t.entries[0], id: "c", songRef: "U:1032", version: null },
    ];
    expect(analyze(d, d.shows)[0]).toMatchObject({
      performances: 3,
      shows: 1,
      full: 1,
      short: 1,
      rate: 1,
    });
  });
  it("medley setting normalizes SHORT and removal restores FULL", () => {
    const e = trialDataset().templates[0].entries[0];
    expect(medley(e, "m").version).toBe("SHORT");
    expect(medley(medley(e, "m"), null).version).toBe("FULL");
  });
  it("stores only differences and preserves template additions and show-specific facts", () => {
    const d = trialDataset(),
      t = d.templates[0],
      s = d.shows[1];
    d.shows[0] = { ...d.shows[0], templateId: t.id, hasSavedSetlist: true };
    const desired = structuredClone(t.entries);
    desired[0].songRef = "U:1032";
    [desired[1], desired[2]] = [desired[2], desired[1]];
    const operations = deriveOverrides(t.entries, desired);
    expect(operations.some((o) => o.kind === "REMOVE")).toBe(false);
    d.overrides = [
      { id: s.id, showId: s.id, templateId: t.id, revision: 0, operations },
    ];
    d.entryFacts = [
      {
        id: "fact",
        revision: 0,
        showId: s.id,
        entryKey: t.entries[0].id,
        unpublishedBeforeShow: true,
        firstPerformedAtShow: true,
        note: "",
      },
    ];
    expect(effectiveEntries(d, s)).toEqual(desired);
    expect(effectiveEntries(d, d.shows[0])![0].songRef).toBe("U:1003");
    t.entries.push({ ...t.entries[0], id: "new-base" });
    expect(effectiveEntries(d, s)?.some((x) => x.id === "new-base")).toBe(true);
    validateDataset(d);
    const broken = {
      ...t,
      entries: t.entries.filter((e) => e.id !== "entry-01"),
    };
    expect(
      templateImpact(d, broken).find((x) => x.showId === s.id)?.conflict,
    ).toBeTruthy();
  });
  it("detects orphan facts, mismatched tours and duplicate show slots", () => {
    const d = trialDataset();
    d.shows.push({ ...d.shows[0], id: "other" });
    expect(() => validateDataset(d)).toThrow("重複");
    const e = trialDataset();
    e.entryFacts.push({
      id: "orphan",
      revision: 0,
      showId: e.shows[0].id,
      entryKey: "missing",
      unpublishedBeforeShow: true,
      firstPerformedAtShow: true,
      note: "",
    });
    expect(() => validateDataset(e)).toThrow("孤立");
  });
  it("allows same venue/date with a different slot; import excludes duplicates", () => {
    const d = trialDataset();
    d.shows.push({ ...d.shows[0], id: "matinee", slot: "昼" });
    validateDataset(d);
    expect(importPreview(trialDataset(), d).shows.map((s) => s.id)).toEqual([
      "matinee",
    ]);
  });
  it("merges refs once without changing stable keys or replay facts", () => {
    const d = trialDataset();
    d.releaseTracks = [];
    const next = mergeLocalSong(d, "L:local-to-the-first", "U:9999");
    expect(next.localSongs).toHaveLength(0);
    expect(next.templates[0].entries[16]).toMatchObject({
      id: "entry-17",
      songRef: "U:9999",
    });
    expect(analyze(next, next.shows)).toHaveLength(29);
  });
  it("JSON roundtrip preserves all entities and rejects extra tables and dangling refs", () => {
    const d = trialDataset();
    expect(parseBackup(exportJson(d))).toEqual(d);
    expect(() =>
      validateDataset({ ...d, confirmationStatus: "CONFIRMED" }),
    ).toThrow();
    expect(() => mergeLocalSong(d, "L:local-to-the-first", "L:bad")).toThrow();
  });
});
describe("read-only Universe catalog staging", () => {
  const rows = [
    [
      "SongID",
      "Title",
      "Artist",
      "ReleaseDate",
      "Form",
      "CDTitle",
      "IsTitleTrack",
    ],
    ["1001", "Title", "BE:FIRST", "2026/11/03", "アルバム", "", "FALSE"],
  ];
  it("normalizes dates and preserves ID across a title rename", () => {
    const first = normalizeSongs(rows),
      next = normalizeSongs([
        rows[0],
        [...rows[1].slice(0, 1), "Renamed", ...rows[1].slice(2)],
      ]);
    expect(nextSnapshot(first, next)).toHaveLength(1);
    expect(next[0]).toMatchObject({
      ref: "U:1001",
      title: "Renamed",
      releaseDate: "2026-11-03",
      isTitleTrack: false,
    });
  });
  it("rejects partial, duplicate and empty catalogs, preserving the caller snapshot", () => {
    const previous = normalizeSongs(rows);
    expect(() => normalizeSongs([rows[0], rows[1], rows[1]])).toThrow();
    expect(() => normalizeSongs([rows[0]])).toThrow();
    expect(() => normalizeSongs([["SongID"]])).toThrow();
    expect(previous[0].title).toBe("Title");
  });
  it("retains removed refs for existing history, without listing them as unheard", () => {
    const previous = normalizeSongs(rows);
    const next = nextSnapshot(previous, [{ ...previous[0], ref: "U:1002" }]);
    expect(next.find((x) => x.ref === "U:1001")?.available).toBe(false);
    expect(unheard(next, new Set()).map((x) => x.ref)).toEqual(["U:1002"]);
  });
  it("same-title candidates require an explicit merge", () => {
    const s = normalizeSongs(rows),
      locals = [{ id: "local", title: "Title" }];
    expect(mergeCandidates(locals, s)).toHaveLength(1);
    expect(locals).toHaveLength(1);
    expect(s[0].ref).toBe("U:1001");
  });
});
