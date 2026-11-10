import { z } from "zod";
export const id = z.string().regex(/^[A-Za-z0-9_-]{1,120}$/);
export const songRef = z.string().regex(/^[UL]:[A-Za-z0-9_-]{1,120}$/);
const date = z.iso.date();
const nullableText = z.string().max(4000).nullable();
const base = { id, revision: z.number().int().nonnegative() };
export const entrySchema = z.strictObject({
  id,
  songRef,
  section: z.enum(["MAIN", "ENCORE"]),
  version: z.enum(["FULL", "SHORT"]).nullable(),
  medleyGroup: id.nullable(),
  performance: z.enum(["ORIGINAL", "COVER", "SOLO", "UNIT", "OTHER"]),
  members: z.array(z.string()).max(30),
});
export const templateSchema = z.strictObject({
  ...base,
  tourId: id,
  name: z.string().min(1).max(200),
  entries: z.array(entrySchema).max(300),
});
export const operationSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("ADD"),
    entry: entrySchema,
    after: id.nullable(),
  }),
  z.strictObject({ kind: z.literal("REMOVE"), target: id }),
  z.strictObject({ kind: z.literal("MOVE"), target: id, after: id.nullable() }),
  z.strictObject({
    kind: z.literal("PATCH"),
    target: id,
    patch: entrySchema.omit({ id: true }).partial(),
  }),
]);
export const schemas = {
  tours: z.strictObject({
    ...base,
    name: z.string().min(1).max(200),
    type: z.enum(["TOUR", "SPECIAL", "FANMEETING"]),
    startDate: date,
    endDate: date,
    defaultTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .nullable(),
    releaseIds: z.array(id),
  }),
  shows: z.strictObject({
    ...base,
    tourId: id.nullable(),
    name: z.string().min(1).max(200),
    type: z.enum(["TOUR", "SPECIAL", "FANMEETING"]),
    format: z.enum(["ARENA", "DOME", "STADIUM", "FANMEETING", "OTHER"]),
    date,
    venue: z.string().min(1).max(200),
    region: z.string().max(100),
    slot: z.string().min(1).max(30),
    startsAt: z.iso.datetime({ offset: true }).nullable(),
    templateId: id.nullable(),
    hasSavedSetlist: z.boolean(),
    surpriseReview: z.enum(["UNREVIEWED", "NONE", "REVIEWED"]),
    note: z.string().max(10000),
  }),
  templates: templateSchema,
  overrides: z.strictObject({
    ...base,
    showId: id,
    templateId: id,
    operations: z.array(operationSchema).max(600),
  }),
  directEntries: z.strictObject({
    ...base,
    showId: id,
    entries: z.array(entrySchema).max(300),
  }),
  entryFacts: z.strictObject({
    ...base,
    showId: id,
    entryKey: id,
    unpublishedBeforeShow: z.boolean(),
    firstPerformedAtShow: z.boolean(),
    note: z.string().max(4000),
  }),
  localSongs: z.strictObject({
    ...base,
    title: z.string().min(1).max(300),
    artist: nullableText,
  }),
  songMetadata: z.strictObject({
    ...base,
    songRef,
    category: z.enum(["ORIGINAL", "COVER", "OTHER"]),
    unreleased: z.boolean(),
    announcedAt: z.iso.datetime({ offset: true }).nullable(),
    appleMusicUrl: z
      .url()
      .regex(/^https:\/\/music\.apple\.com\//)
      .nullable(),
  }),
  releases: z.strictObject({
    ...base,
    title: z.string().min(1).max(300),
    artist: nullableText,
    form: nullableText,
    announcedAt: z.iso.datetime({ offset: true }).nullable(),
    releaseDate: date.nullable(),
    universeKey: nullableText,
  }),
  releaseTracks: z.strictObject({
    ...base,
    releaseId: id,
    songRef,
    position: z.number().int().positive().nullable(),
    lead: z.boolean().nullable(),
    newOnAlbum: z.boolean().nullable(),
    announcedAt: z.iso.datetime({ offset: true }).nullable(),
  }),
  attendance: z.strictObject({
    ...base,
    showId: id,
    attended: z.boolean(),
    seat: z.string().max(1000),
    note: z.string().max(10000),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  }),
};
export const collections = Object.keys(schemas) as (keyof typeof schemas)[];
export type Collection = keyof typeof schemas;
export const datasetSchema = z.strictObject({
  schemaVersion: z.literal(1),
  tours: z.array(schemas.tours),
  shows: z.array(schemas.shows),
  templates: z.array(schemas.templates),
  overrides: z.array(schemas.overrides),
  directEntries: z.array(schemas.directEntries),
  entryFacts: z.array(schemas.entryFacts),
  localSongs: z.array(schemas.localSongs),
  songMetadata: z.array(schemas.songMetadata),
  releases: z.array(schemas.releases),
  releaseTracks: z.array(schemas.releaseTracks),
  attendance: z.array(schemas.attendance),
});
export type Dataset = z.infer<typeof datasetSchema>;
export type Entry = z.infer<typeof entrySchema>;
export type Show = Dataset["shows"][number];
export type Song = {
  ref: string;
  title: string;
  artist: string | null;
  releaseDate: string | null;
  form: string | null;
  cdTitle: string | null;
  isTitleTrack: boolean;
  available: boolean;
};
export const emptyDataset = (): Dataset => ({
  schemaVersion: 1,
  tours: [],
  shows: [],
  templates: [],
  overrides: [],
  directEntries: [],
  entryFacts: [],
  localSongs: [],
  songMetadata: [],
  releases: [],
  releaseTracks: [],
  attendance: [],
});
