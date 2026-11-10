import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import {
  onCall,
  HttpsError,
  type CallableRequest,
} from "firebase-functions/v2/https";
import { defineString } from "firebase-functions/params";
import { GoogleAuth } from "google-auth-library";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import {
  collections,
  schemas,
  emptyDataset,
  type Dataset,
  type Collection,
  type Song,
} from "../../shared/model.js";
import {
  validateDataset,
  mergeLocalSong,
  Conflict,
} from "../../shared/domain.js";
import { normalizeSongs, nextSnapshot } from "../../shared/universe.js";

initializeApp();
const db = getFirestore();
const ownerUid = defineString("OWNER_UID");
const spreadsheetId = defineString("UNIVERSE_SPREADSHEET_ID");
const serviceAccount = defineString("LIVE_SERVICE_ACCOUNT");
const options = {
  region: "asia-northeast1",
  timeoutSeconds: 120,
  maxInstances: 2,
  serviceAccount,
};
type Control = {
  activeDatasetId: string;
  previousDatasetId: string | null;
  revision: number;
};
const ownerPath = (uid: string) => db.doc(`users/${uid}/control/state`);
const datasetPath = (uid: string, id: string) =>
  db.doc(`users/${uid}/datasets/${id}`);
const catalogPath = (uid: string) => db.doc(`users/${uid}/catalog/universe`);
async function owner(request: CallableRequest) {
  if (
    !ownerUid.value() ||
    request.auth?.uid !== ownerUid.value() ||
    request.auth.token.firebase?.sign_in_provider !== "google.com"
  )
    throw new HttpsError(
      "permission-denied",
      "本人のGoogleアカウントでログインしてください",
    );
  return request.auth.uid;
}
const call = (
  fn: (request: CallableRequest, uid: string) => Promise<unknown>,
) =>
  onCall(options, async (request) => {
    const uid = await owner(request);
    try {
      return await fn(request, uid);
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      if (e instanceof Conflict) throw new HttpsError("aborted", e.message);
      if (e instanceof z.ZodError)
        throw new HttpsError(
          "invalid-argument",
          "入力形式が正しくありません",
          e.issues,
        );
      throw new HttpsError("failed-precondition", (e as Error).message);
    }
  });
function sameControl(
  control: Control | undefined,
  expected: { datasetId: string; revision: number },
) {
  if (
    !control ||
    control.activeDatasetId !== expected.datasetId ||
    control.revision !== expected.revision
  )
    throw new Conflict(
      "他の端末で変更されました。最新データを読み直し、保存する内容を選んでください",
    );
}
async function readData(
  uid: string,
  control: Control,
  tx?: FirebaseFirestore.Transaction,
): Promise<Dataset> {
  const data = emptyDataset();
  const result = await Promise.all(
    collections.map(async (name) => {
      const q = datasetPath(uid, control.activeDatasetId).collection(name);
      const snap = tx ? await tx.get(q) : await q.get();
      return { name, rows: snap.docs.map((d) => d.data()) };
    }),
  );
  for (const { name, rows } of result) (data[name] as unknown[]) = rows;
  return validateDataset(data);
}
const expectedSchema = z.object({
  datasetId: z.string().uuid(),
  revision: z.number().int().nonnegative(),
});
export const bootstrap = call(async (_request, uid) => {
  return db.runTransaction(async (tx) => {
    const configured = await tx.get(db.doc("config/owner"));
    if (configured.exists && configured.data()?.uid !== uid)
      throw new HttpsError("permission-denied", "所有者設定が一致しません");
    const ref = ownerPath(uid),
      snapshot = await tx.get(ref);
    if (!configured.exists) tx.create(db.doc("config/owner"), { uid });
    if (snapshot.exists) return snapshot.data();
    const id = randomUUID(),
      control: Control = {
        activeDatasetId: id,
        previousDatasetId: null,
        revision: 0,
      };
    tx.create(datasetPath(uid, id), {
      ready: true,
      schemaVersion: 1,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.create(ref, control);
    return control;
  });
});
export const getState = call(async (_request, uid) =>
  db.runTransaction(async (tx) => {
    const control = (await tx.get(ownerPath(uid))).data() as
      Control | undefined;
    if (!control)
      throw new HttpsError("failed-precondition", "初期化してください");
    const [data, catalog] = await Promise.all([
      readData(uid, control, tx),
      tx.get(catalogPath(uid)),
    ]);
    return {
      control,
      data,
      songs: (catalog.data()?.songs ?? []) as Song[],
      syncedAt: catalog.data()?.syncedAt ?? null,
    };
  }),
);
export const syncUniverse = call(async (_request, uid) => {
  const before = await catalogPath(uid).get(),
    version = before.data()?.revision ?? 0;
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sid = spreadsheetId.value();
  if (!/^[\w-]+$/.test(sid)) throw new Error("Universeの読取先設定が必要です");
  // Only a GET is issued; neither Universe GAS nor its Writer is used.
  const response = await auth.request<{ values?: unknown[][] }>({
    url: `https://sheets.googleapis.com/v4/spreadsheets/${sid}/values/${encodeURIComponent("'06_Songs'!A1:G10000")}`,
    method: "GET",
    params: { valueRenderOption: "FORMATTED_VALUE" },
  });
  const rows = response.data.values ?? [];
  if (rows.length >= 10000)
    throw new Error("同期上限に達しました。スナップショットを保持しました");
  const incoming = normalizeSongs(rows),
    songs = nextSnapshot(before.data()?.songs ?? [], incoming);
  if (Buffer.byteLength(JSON.stringify(songs), "utf8") > 800000)
    throw new Error("楽曲スナップショット容量を超えました");
  const digest = createHash("sha256")
    .update(JSON.stringify(songs))
    .digest("hex");
  await db.runTransaction(async (tx) => {
    const current = await tx.get(catalogPath(uid));
    if ((current.data()?.revision ?? 0) !== version)
      throw new Conflict("別の同期が先に完了しました。再同期してください");
    tx.set(catalogPath(uid), {
      songs,
      revision: version + 1,
      digest,
      syncedAt: new Date().toISOString(),
    });
  });
  return { count: incoming.length };
});
async function ensureSongRefs(
  uid: string,
  data: Dataset,
  tx?: FirebaseFirestore.Transaction,
) {
  const snapshot = tx
    ? await tx.get(catalogPath(uid))
    : await catalogPath(uid).get();
  const refs = new Set<string>(
    (snapshot.data()?.songs ?? []).map((s: Song) => s.ref),
  );
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v)) {
        if (
          k === "songRef" &&
          typeof x === "string" &&
          x.startsWith("U:") &&
          !refs.has(x)
        )
          throw new Error(`Universe曲が未同期です: ${x}`);
        visit(x);
      }
  };
  visit(data);
}
export const saveEntity = call(async (request, uid) => {
  const input = z
    .object({
      expected: expectedSchema,
      collection: z.enum(collections as [Collection, ...Collection[]]),
      entity: z.unknown(),
      expectedEntityRevision: z.number().int().nullable(),
    })
    .parse(request.data);
  const entity = schemas[input.collection].parse(input.entity);
  return db.runTransaction(async (tx) => {
    const control = (await tx.get(ownerPath(uid))).data() as Control;
    sameControl(control, input.expected);
    const data = await readData(uid, control, tx),
      old = data[input.collection].find((x) => x.id === entity.id);
    if ((old?.revision ?? null) !== input.expectedEntityRevision)
      throw new Conflict("このデータが変更されています");
    const updated = { ...entity, revision: (old?.revision ?? -1) + 1 };
    (data[input.collection] as unknown[]) = [
      ...data[input.collection].filter((x) => x.id !== entity.id),
      updated,
    ];
    validateDataset(data);
    await ensureSongRefs(uid, data, tx);
    tx.set(
      datasetPath(uid, control.activeDatasetId)
        .collection(input.collection)
        .doc(entity.id),
      updated,
    );
    tx.update(ownerPath(uid), { revision: control.revision + 1 });
    return { revision: updated.revision };
  });
});
export const saveDatasetChanges = call(async (request, uid) => {
  const input = z
    .object({
      expected: expectedSchema,
      data: z.unknown(),
      confirmedDeletedShowIds: z.array(z.string()).default([]),
    })
    .parse(request.data);
  const next = validateDataset(input.data);
  return db.runTransaction(async (tx) => {
    const control = (await tx.get(ownerPath(uid))).data() as Control;
    sameControl(control, input.expected);
    const current = await readData(uid, control, tx);
    await ensureSongRefs(uid, next, tx);
    const removedShows = current.shows.filter(
      (s) => !next.shows.some((x) => x.id === s.id),
    );
    if (removedShows.some((s) => !input.confirmedDeletedShowIds.includes(s.id)))
      throw new Error("公演削除の影響を確認してください");
    const writes: (
      | { kind: "set"; c: Collection; entity: { id: string; revision: number } }
      | { kind: "delete"; c: Collection; id: string }
    )[] = [];
    for (const c of collections) {
      for (const old of current[c])
        if (!next[c].some((x) => x.id === old.id))
          writes.push({ kind: "delete", c, id: old.id });
      for (const entity of next[c]) {
        const old = current[c].find((x) => x.id === entity.id);
        if (JSON.stringify(old) !== JSON.stringify(entity))
          writes.push({
            kind: "set",
            c,
            entity: { ...entity, revision: (old?.revision ?? -1) + 1 },
          });
      }
    }
    if (writes.length > 400)
      throw new Error(
        "一度の編集は400件までです。一括初期登録・復元を使用してください",
      );
    for (const w of writes) {
      const ref = datasetPath(uid, control.activeDatasetId)
        .collection(w.c)
        .doc(w.kind === "set" ? w.entity.id : w.id);
      if (w.kind === "set") tx.set(ref, w.entity);
      else tx.delete(ref);
    }
    tx.update(ownerPath(uid), { revision: control.revision + 1 });
    return { ok: true };
  });
});
function digestData(data: Dataset) {
  // Canonical document order, independent of Firestore query order.
  return createHash("sha256")
    .update(
      JSON.stringify(
        collections.map((c) => [
          c,
          [...data[c]].sort((a, b) => a.id.localeCompare(b.id)),
        ]),
      ),
    )
    .digest("hex");
}
async function switchDataset(
  uid: string,
  data: Dataset,
  expected: z.infer<typeof expectedSchema>,
  retainBackup: boolean,
) {
  await ensureSongRefs(uid, data);
  const id = randomUUID(),
    ref = datasetPath(uid, id);
  await ref.create({
    ready: false,
    schemaVersion: 1,
    createdAt: FieldValue.serverTimestamp(),
  });
  const writes = collections.flatMap((c) =>
    data[c].map((entity) => ({
      ref: ref.collection(c).doc(entity.id),
      entity,
    })),
  );
  // Staging may span many batches; incomplete data is never the active dataset.
  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch();
    for (const x of writes.slice(i, i + 400)) batch.create(x.ref, x.entity);
    await batch.commit();
  }
  const loaded = await readData(uid, {
    activeDatasetId: id,
    previousDatasetId: null,
    revision: 0,
  });
  if (digestData(loaded) !== digestData(data))
    throw new Error("復元後の照合に失敗しました。元のデータを保持しています");
  await ref.update({ ready: true, digest: digestData(data) });
  await db.runTransaction(async (tx) => {
    const control = (await tx.get(ownerPath(uid))).data() as Control;
    sameControl(control, expected);
    const ready = await tx.get(ref);
    if (!ready.data()?.ready) throw new Error("復元データが未完了です");
    tx.update(ownerPath(uid), {
      activeDatasetId: id,
      previousDatasetId: retainBackup
        ? control.activeDatasetId
        : control.previousDatasetId,
      revision: control.revision + 1,
    });
  });
  return { datasetId: id };
}
export const restoreBackup = call(async (request, uid) => {
  const input = z
    .object({
      expected: expectedSchema,
      data: z.unknown(),
      confirmed: z.literal(true),
    })
    .parse(request.data);
  return switchDataset(uid, validateDataset(input.data), input.expected, true);
});
export const rollbackRestore = call(async (request, uid) => {
  const input = z
    .object({ expected: expectedSchema, confirmedLossOfEdits: z.literal(true) })
    .parse(request.data);
  return db.runTransaction(async (tx) => {
    const control = (await tx.get(ownerPath(uid))).data() as Control;
    sameControl(control, input.expected);
    if (!control.previousDatasetId) throw new Error("戻せるデータがありません");
    const backup = await tx.get(datasetPath(uid, control.previousDatasetId));
    if (!backup.data()?.ready) throw new Error("直前のデータを確認できません");
    tx.update(ownerPath(uid), {
      activeDatasetId: control.previousDatasetId,
      revision: control.revision + 1,
    });
    return { ok: true };
  });
});
export const confirmSongMerge = call(async (request, uid) => {
  const input = z
    .object({
      expected: expectedSchema,
      localRef: z.string(),
      universeRef: z.string(),
      confirmed: z.literal(true),
    })
    .parse(request.data);
  const control = (await ownerPath(uid).get()).data() as Control;
  sameControl(control, input.expected);
  const data = await readData(uid, control);
  return switchDataset(
    uid,
    mergeLocalSong(data, input.localRef, input.universeRef),
    input.expected,
    false,
  );
});
