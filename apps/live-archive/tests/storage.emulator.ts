import { beforeAll, it, expect } from "vitest";
import { createRequire } from "node:module";
const { getFirestore } = createRequire(
  new URL("../functions/package.json", import.meta.url),
)("firebase-admin/firestore");
import { trialDataset, trialSongs } from "../fixtures/dome2024";
import { emptyDataset } from "../shared/model";
let api: typeof import("../functions/src/index");
const request = (data: unknown = {}, uid = "owner-test") =>
  ({
    data,
    auth: { uid, token: { firebase: { sign_in_provider: "google.com" } } },
    rawRequest: {},
  }) as never;
beforeAll(async () => {
  process.env.GCLOUD_PROJECT = "demo-live-archive";
  process.env.OWNER_UID = "owner-test";
  process.env.UNIVERSE_SPREADSHEET_ID = "unused-test";
  process.env.LIVE_SERVICE_ACCOUNT =
    "test@demo-live-archive.iam.gserviceaccount.com";
  api = await import("../functions/src/index");
});
it("bootstrap rejects strangers and is idempotent", async () => {
  await expect(
    api.bootstrap.run(request({}, "stranger")),
  ).rejects.toMatchObject({ code: "permission-denied" });
  const a = await api.bootstrap.run(request()),
    b = await api.bootstrap.run(request());
  expect(a).toEqual(b);
});
it("atomic restore, stale saves, failed staging and rollback protect active data", async () => {
  const db = getFirestore(),
    path = db.doc("users/owner-test/control/state");
  await db
    .doc("users/owner-test/catalog/universe")
    .set({ songs: trialSongs, revision: 1 });
  let control = (await path.get()).data()!;
  const originalId = control.activeDatasetId;
  const expected = () => ({
    datasetId: control.activeDatasetId,
    revision: control.revision,
  });
  await api.restoreBackup.run(
    request({ data: trialDataset(), expected: expected(), confirmed: true }),
  );
  control = (await path.get()).data()!;
  expect(control.activeDatasetId).not.toBe(originalId);
  expect(control.previousDatasetId).toBe(originalId);
  const activeId = control.activeDatasetId;
  const stale = expected();
  const entity = {
    id: "local-test",
    revision: 0,
    title: "A cover",
    artist: null,
  };
  await api.saveEntity.run(
    request({
      collection: "localSongs",
      entity,
      expected: expected(),
      expectedEntityRevision: null,
    }),
  );
  control = (await path.get()).data()!;
  expect(control.previousDatasetId).toBe(originalId);
  await expect(
    api.saveEntity.run(
      request({
        collection: "localSongs",
        entity: { ...entity, title: "Stale" },
        expected: stale,
        expectedEntityRevision: null,
      }),
    ),
  ).rejects.toMatchObject({ code: "aborted" });
  // A stale restore stages successfully, then fails the control CAS. It cannot replace the active data.
  await expect(
    api.restoreBackup.run(
      request({ data: emptyDataset(), expected: stale, confirmed: true }),
    ),
  ).rejects.toMatchObject({ code: "aborted" });
  expect((await path.get()).data()?.activeDatasetId).toBe(activeId);
  const invalid = trialDataset();
  invalid.templates[0].entries[0].songRef = "U:unavailable";
  await expect(
    api.restoreBackup.run(
      request({ data: invalid, expected: expected(), confirmed: true }),
    ),
  ).rejects.toBeTruthy();
  expect((await path.get()).data()?.activeDatasetId).toBe(activeId);
  await api.rollbackRestore.run(
    request({ expected: expected(), confirmedLossOfEdits: true }),
  );
  control = (await path.get()).data()!;
  expect(control.activeDatasetId).toBe(originalId);
  const result = (await api.getState.run(request())) as {
    data: ReturnType<typeof emptyDataset>;
  };
  expect(result.data.shows).toHaveLength(0);
});
