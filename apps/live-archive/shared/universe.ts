import type { Song } from "./model.js";
const columns = [
  "SongID",
  "Title",
  "Artist",
  "ReleaseDate",
  "Form",
  "CDTitle",
  "IsTitleTrack",
];
const text = (v: unknown) => String(v ?? "").trim();
export function normalizeSongs(rows: unknown[][]): Song[] {
  if (!rows.length) throw new Error("楽曲シートが空です");
  const header = rows[0].map(text);
  for (const key of columns)
    if (header.filter((x) => x === key).length !== 1)
      throw new Error(`必須列がありません・重複しています: ${key}`);
  const seen = new Set<string>();
  const songs: Song[] = [];
  for (const row of rows.slice(1)) {
    if (row.every((v) => !text(v))) continue;
    const get = (key: string) => text(row[header.indexOf(key)]);
    const songId = get("SongID"),
      title = get("Title");
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(songId) || !title || seen.has(songId))
      throw new Error(`不正または重複SongID: ${songId}`);
    const raw = get("ReleaseDate").replaceAll("/", "-");
    const date = raw || null;
    if (
      date &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        Number.isNaN(Date.parse(date)) ||
        new Date(date).toISOString().slice(0, 10) !== date)
    )
      throw new Error(`不正な発売日: ${songId}`);
    const flag = get("IsTitleTrack").toUpperCase();
    if (!["", "TRUE", "FALSE"].includes(flag))
      throw new Error(`不正なIsTitleTrack: ${songId}`);
    seen.add(songId);
    songs.push({
      ref: "U:" + songId,
      title,
      artist: get("Artist") || null,
      releaseDate: date,
      form: get("Form") || null,
      cdTitle: get("CDTitle") || null,
      isTitleTrack: flag === "TRUE",
      available: true,
    });
  }
  if (!songs.length)
    throw new Error("楽曲が0件です。前回スナップショットを保持します");
  return songs;
}
export function nextSnapshot(previous: Song[], incoming: Song[]): Song[] {
  const refs = new Set(incoming.map((x) => x.ref));
  return [
    ...incoming,
    ...previous
      .filter((s) => !refs.has(s.ref))
      .map((s) => ({ ...s, available: false })),
  ];
}
export const mergeCandidates = (
  locals: { id: string; title: string }[],
  songs: Song[],
) =>
  locals.flatMap((l) =>
    songs
      .filter(
        (s) =>
          s.available &&
          s.title.normalize("NFKC").toLocaleLowerCase() ===
            l.title.normalize("NFKC").toLocaleLowerCase(),
      )
      .map((s) => ({
        localRef: "L:" + l.id,
        universeRef: s.ref,
        title: s.title,
      })),
  );
