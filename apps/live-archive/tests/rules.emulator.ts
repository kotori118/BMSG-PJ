import { readFileSync } from "node:fs";
import { beforeAll, afterAll, it, expect } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-live-archive",
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
  });
  await env.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), "config/owner"), { uid: "owner-test" });
    await setDoc(doc(c.firestore(), "users/owner-test/control/state"), {
      activeDatasetId: "test",
    });
  });
});
afterAll(async () => env.cleanup());
it("permits only configured owner reads; client writes cannot bypass validation", async () => {
  await assertSucceeds(
    getDoc(
      doc(
        env.authenticatedContext("owner-test").firestore(),
        "users/owner-test/control/state",
      ),
    ),
  );
  await assertFails(
    getDoc(
      doc(
        env.authenticatedContext("stranger").firestore(),
        "users/owner-test/control/state",
      ),
    ),
  );
  await assertFails(
    getDoc(
      doc(
        env.unauthenticatedContext().firestore(),
        "users/owner-test/control/state",
      ),
    ),
  );
  await assertFails(
    setDoc(
      doc(
        env.authenticatedContext("owner-test").firestore(),
        "users/owner-test/control/state",
      ),
      { activeDatasetId: "malicious" },
    ),
  );
  await assertFails(
    setDoc(
      doc(env.authenticatedContext("owner-test").firestore(), "config/owner"),
      { uid: "stranger" },
    ),
  );
  expect(true).toBe(true);
});
