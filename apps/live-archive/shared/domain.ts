import {
  collections,
  datasetSchema,
  type Dataset,
  type Entry,
  type Show,
  type Song,
} from "./model.js";
export class Conflict extends Error {}
function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
export function medley(entry: Entry, group: string | null): Entry {
  return {
    ...entry,
    medleyGroup: group,
    version: group ? "SHORT" : entry.medleyGroup ? "FULL" : entry.version,
  };
}
export function effectiveEntries(data: Dataset, show: Show): Entry[] | null {
  if (!show.hasSavedSetlist) return null;
  if (!show.templateId)
    return structuredClone(
      data.directEntries.find((x) => x.showId === show.id)?.entries ?? [],
    );
  const template = data.templates.find((x) => x.id === show.templateId);
  assert(template, `基本セトリが見つかりません: ${show.id}`);
  const entries = structuredClone(template.entries);
  for (const op of data.overrides.find((x) => x.showId === show.id)
    ?.operations ?? []) {
    if (op.kind === "ADD") {
      assert(
        !entries.some((x) => x.id === op.entry.id),
        "追加行IDが重複しています",
      );
      const at =
        op.after === null ? -1 : entries.findIndex((x) => x.id === op.after);
      assert(op.after === null || at >= 0, "追加先の行が削除されています");
      entries.splice(at + 1, 0, structuredClone(op.entry));
    } else {
      const at = entries.findIndex((x) => x.id === op.target);
      assert(at >= 0, `差分対象の行が削除されています: ${op.target}`);
      if (op.kind === "REMOVE") entries.splice(at, 1);
      if (op.kind === "PATCH") {
        let entry = { ...entries[at], ...op.patch };
        if (
          "medleyGroup" in op.patch &&
          op.patch.medleyGroup !== entries[at].medleyGroup
        )
          entry = medley(
            { ...entry, medleyGroup: entries[at].medleyGroup },
            op.patch.medleyGroup!,
          );
        entries[at] = entry;
      }
      if (op.kind === "MOVE") {
        assert(op.after !== op.target, "同じ行へ移動できません");
        const [entry] = entries.splice(at, 1);
        const dest =
          op.after === null ? -1 : entries.findIndex((x) => x.id === op.after);
        assert(op.after === null || dest >= 0, "移動先の行が削除されています");
        entries.splice(dest + 1, 0, entry);
      }
    }
  }
  return entries;
}
export function validateDataset(input: unknown): Dataset {
  const data = datasetSchema.parse(input);
  for (const c of collections)
    assert(
      new Set(data[c].map((x) => x.id)).size === data[c].length,
      `${c}: ID重複`,
    );
  const tourIds = new Set(data.tours.map((x) => x.id)),
    showIds = new Set(data.shows.map((x) => x.id)),
    releaseIds = new Set(data.releases.map((x) => x.id));
  for (const t of data.tours) {
    assert(t.startDate <= t.endDate, "ツアー日付が逆順です");
    for (const id of t.releaseIds)
      assert(releaseIds.has(id), "関連作品がありません");
  }
  const localIds = new Set(data.localSongs.map((x) => "L:" + x.id));
  const checkSong = (ref: string) =>
    assert(
      ref.startsWith("U:") || localIds.has(ref),
      `LIVE限定曲がありません: ${ref}`,
    );
  const checkEntries = (entries: Entry[]) => {
    assert(
      new Set(entries.map((x) => x.id)).size === entries.length,
      "披露行ID重複",
    );
    entries.forEach((x) => checkSong(x.songRef));
  };
  const duplicates = new Set<string>();
  for (const s of data.shows) {
    assert(s.tourId === null || tourIds.has(s.tourId), "ツアーがありません");
    const key = showIdentity(s);
    assert(!duplicates.has(key), "同日・同会場・同公演回が重複しています");
    duplicates.add(key);
    if (s.templateId) {
      const t = data.templates.find((x) => x.id === s.templateId);
      assert(
        t && t.tourId === s.tourId,
        "公演と基本セトリのツアーが一致しません",
      );
    }
    const entries = effectiveEntries(data, s);
    if (entries) checkEntries(entries);
    if (s.hasSavedSetlist && !s.templateId)
      assert(
        data.directEntries.some((x) => x.showId === s.id),
        "直接セトリがありません",
      );
  }
  for (const t of data.templates) {
    assert(tourIds.has(t.tourId), "テンプレートのツアーがありません");
    checkEntries(t.entries);
  }
  for (const c of ["overrides", "directEntries", "attendance"] as const) {
    assert(
      new Set(data[c].map((x) => x.showId)).size === data[c].length,
      `${c}: 公演ごとに1件のみです`,
    );
    for (const x of data[c])
      assert(showIds.has(x.showId), "関連公演がありません");
  }
  for (const x of data.overrides)
    assert(
      data.shows.find((s) => s.id === x.showId)?.templateId === x.templateId,
      "差分の基本セトリが一致しません",
    );
  for (const x of data.directEntries) {
    assert(
      data.shows.find((s) => s.id === x.showId)?.tourId === null,
      "ツアー公演は基本セトリと公演差分で登録してください",
    );
    assert(
      !data.shows.find((s) => s.id === x.showId)?.templateId,
      "直接セトリと基本セトリは併用できません",
    );
    checkEntries(x.entries);
  }
  const facts = new Set<string>();
  for (const f of data.entryFacts) {
    const s = data.shows.find((x) => x.id === f.showId);
    assert(s, "披露事実の公演がありません");
    assert(
      effectiveEntries(data, s)?.some((x) => x.id === f.entryKey),
      "公演固有の披露事実が孤立しています",
    );
    const key = f.showId + ":" + f.entryKey;
    assert(!facts.has(key), "披露事実の重複");
    facts.add(key);
    assert(
      s.surpriseReview !== "NONE" ||
        (!f.unpublishedBeforeShow && !f.firstPerformedAtShow),
      "未発表新曲なしとフラグが矛盾しています",
    );
  }
  for (const x of data.songMetadata) checkSong(x.songRef);
  assert(
    new Set(data.songMetadata.map((x) => x.songRef)).size ===
      data.songMetadata.length,
    "曲メタデータ重複",
  );
  const tracks = new Set<string>();
  for (const x of data.releaseTracks) {
    assert(releaseIds.has(x.releaseId), "作品がありません");
    checkSong(x.songRef);
    const key = x.releaseId + ":" + x.songRef;
    assert(!tracks.has(key), "同作品の同曲重複");
    tracks.add(key);
  }
  return data;
}
export const showIdentity = (s: Pick<Show, "date" | "venue" | "slot">) =>
  [
    s.date,
    s.venue.normalize("NFKC").replace(/\s/g, ""),
    s.slot.normalize("NFKC").trim(),
  ].join("|");
export function importPreview(current: Dataset, incoming: Dataset) {
  const seen = new Set(current.shows.map(showIdentity));
  const duplicates: Show[] = [];
  const shows = incoming.shows.filter((s) => {
    const key = showIdentity(s);
    if (seen.has(key)) {
      duplicates.push(s);
      return false;
    }
    seen.add(key);
    return true;
  });
  return { shows, duplicates };
}
export function templateImpact(
  data: Dataset,
  template: Dataset["templates"][number],
) {
  const next = {
    ...data,
    templates: data.templates.map((x) => (x.id === template.id ? template : x)),
  };
  return data.shows
    .filter((s) => s.templateId === template.id)
    .map((s) => {
      try {
        effectiveEntries(next, s);
        const keys = new Set(effectiveEntries(next, s)?.map((x) => x.id));
        const orphanFacts = data.entryFacts.filter(
          (f) => f.showId === s.id && !keys.has(f.entryKey),
        );
        return {
          showId: s.id,
          conflict: orphanFacts.length
            ? "披露事実の紐づけを解消してください"
            : null,
        };
      } catch (e) {
        return { showId: s.id, conflict: (e as Error).message };
      }
    });
}
export function deriveOverrides(
  original: Entry[],
  desired: Entry[],
): Dataset["overrides"][number]["operations"] {
  const ops: Dataset["overrides"][number]["operations"] = [];
  const working = structuredClone(original);
  for (const e of original)
    if (!desired.some((x) => x.id === e.id)) {
      ops.push({ kind: "REMOVE", target: e.id });
      working.splice(
        working.findIndex((x) => x.id === e.id),
        1,
      );
    }
  let after: string | null = null;
  for (const e of desired) {
    const at = working.findIndex((x) => x.id === e.id);
    if (at < 0) {
      ops.push({ kind: "ADD", entry: e, after });
      working.splice(
        after === null ? 0 : working.findIndex((x) => x.id === after) + 1,
        0,
        e,
      );
    } else {
      const old = working[at],
        patch: Partial<Omit<Entry, "id">> = {};
      for (const key of [
        "songRef",
        "section",
        "version",
        "medleyGroup",
        "performance",
        "members",
      ] as const)
        if (JSON.stringify(old[key]) !== JSON.stringify(e[key]))
          Object.assign(patch, { [key]: e[key] });
      // The change-of-medley normalization runs first; an explicit later version override remains possible.
      if ("medleyGroup" in patch) {
        const { version, ...other } = patch;
        ops.push({ kind: "PATCH", target: e.id, patch: other });
        if (version !== undefined)
          ops.push({ kind: "PATCH", target: e.id, patch: { version } });
      } else if (Object.keys(patch).length)
        ops.push({ kind: "PATCH", target: e.id, patch });
      if ((at === 0 ? null : working[at - 1].id) !== after) {
        ops.push({ kind: "MOVE", target: e.id, after });
        const [moved] = working.splice(at, 1);
        working.splice(
          after === null ? 0 : working.findIndex((x) => x.id === after) + 1,
          0,
          moved,
        );
      }
    }
    after = e.id;
  }
  return ops;
}
export function analyze(data: Dataset, shows: Show[]) {
  const counts = new Map<
    string,
    {
      songRef: string;
      shows: number;
      performances: number;
      full: number;
      short: number;
      rate: number | null;
    }
  >();
  let denominator = 0;
  for (const show of shows) {
    const entries = effectiveEntries(data, show);
    if (entries === null) continue;
    denominator++;
    const seen = new Set<string>();
    for (const e of entries) {
      const c = counts.get(e.songRef) ?? {
        songRef: e.songRef,
        shows: 0,
        performances: 0,
        full: 0,
        short: 0,
        rate: null,
      };
      c.performances++;
      if (e.version === "FULL") c.full++;
      if (e.version === "SHORT") c.short++;
      if (!seen.has(e.songRef)) {
        c.shows++;
        seen.add(e.songRef);
      }
      counts.set(e.songRef, c);
    }
  }
  return [...counts.values()]
    .map((c) => ({ ...c, rate: denominator ? c.shows / denominator : null }))
    .sort(
      (a, b) =>
        b.shows - a.shows ||
        b.performances - a.performances ||
        a.songRef.localeCompare(b.songRef),
    );
}
export function unheard(songs: Song[], heard: Set<string>) {
  return songs.filter(
    (s) => s.available && s.artist === "BE:FIRST" && !heard.has(s.ref),
  );
}
export function mergeLocalSong(
  data: Dataset,
  localRef: string,
  universeRef: string,
): Dataset {
  assert(
    localRef.startsWith("L:") && universeRef.startsWith("U:"),
    "L:からU:への統合のみ可能です",
  );
  assert(
    data.localSongs.some((s) => "L:" + s.id === localRef),
    "LIVE限定曲がありません",
  );
  const map = (e: Entry) => ({
    ...e,
    songRef: e.songRef === localRef ? universeRef : e.songRef,
  });
  const next = structuredClone(data);
  next.templates = next.templates.map((t) => ({
    ...t,
    entries: t.entries.map(map),
  }));
  next.directEntries = next.directEntries.map((t) => ({
    ...t,
    entries: t.entries.map(map),
  }));
  next.overrides = next.overrides.map((o) => ({
    ...o,
    operations: o.operations.map((op) =>
      op.kind === "ADD"
        ? { ...op, entry: map(op.entry) }
        : op.kind === "PATCH" && op.patch.songRef === localRef
          ? { ...op, patch: { ...op.patch, songRef: universeRef } }
          : op,
    ),
  }));
  next.releaseTracks = next.releaseTracks
    .map((t) => ({
      ...t,
      songRef: t.songRef === localRef ? universeRef : t.songRef,
    }))
    .filter(
      (x, i, a) =>
        a.findIndex(
          (y) => y.releaseId === x.releaseId && y.songRef === x.songRef,
        ) === i,
    );
  const source = next.songMetadata.find((x) => x.songRef === localRef),
    target = next.songMetadata.find((x) => x.songRef === universeRef);
  if (source && target)
    assert(
      JSON.stringify({ ...source, id: "", songRef: "", revision: 0 }) ===
        JSON.stringify({ ...target, id: "", songRef: "", revision: 0 }),
      "追加メタデータが競合しています。統合前に一致させてください",
    );
  next.songMetadata = next.songMetadata
    .filter((x) => !(target && x.songRef === localRef))
    .map((x) => ({
      ...x,
      songRef: x.songRef === localRef ? universeRef : x.songRef,
    }));
  next.localSongs = next.localSongs.filter((s) => "L:" + s.id !== localRef);
  return validateDataset(next);
}
export function exportJson(data: Dataset) {
  return JSON.stringify(validateDataset(data), null, 2);
}
export const parseBackup = (raw: string) => validateDataset(JSON.parse(raw));
