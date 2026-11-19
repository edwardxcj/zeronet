import assert from "node:assert/strict";
import test from "node:test";
import { createDraftRepository, draftKey, PostDraftController } from "../src/lib/postDrafts.ts";

const empty = () => ({ caption: "", location: "", tags: "", file: [] });
const scope = { accountId: "account-a" };
const values = (caption = "A saved caption") => ({
  caption,
  location: "Sydney",
  tags: "photography,night",
  file: [new File([new Uint8Array([0, 1, 2, 255])], "night.jpg", {
    type: "image/jpeg", lastModified: 1730000000000,
  })],
});

function memoryStorage() {
  return {
    records: new Map(),
    failRead: false,
    failWrite: false,
    failRemove: false,
    beforeWrite: undefined,
    async read(key) {
      if (this.failRead) throw new Error("Storage unavailable");
      return structuredClone(this.records.get(key));
    },
    async write(key, record) {
      await this.beforeWrite?.();
      if (this.failWrite) throw new Error("Quota exceeded");
      this.records.set(key, structuredClone(record));
    },
    async remove(key, expectedRevision) {
      if (this.failRemove) throw new Error("Storage unavailable");
      const record = this.records.get(key);
      if (record !== undefined && expectedRevision !== undefined &&
        (record.revision === undefined ? null : record.revision) !== expectedRevision) return false;
      this.records.delete(key);
      return true;
    },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("drafts restore text and the image bytes/name/type after a structured-clone storage round trip", async () => {
  const storage = memoryStorage();
  const repository = createDraftRepository(storage);
  const original = values();
  await repository.save(scope, original);
  // A fresh repository represents a fresh page; it must not depend on memory-only File references.
  const restored = await createDraftRepository(storage).load(scope);
  assert.equal(restored.caption, original.caption);
  assert.equal(restored.location, original.location);
  assert.equal(restored.tags, original.tags);
  assert.notEqual(restored.file[0], original.file[0]);
  assert.equal(restored.file[0].name, "night.jpg");
  assert.equal(restored.file[0].type, "image/jpeg");
  assert.equal(restored.file[0].lastModified, original.file[0].lastModified);
  assert.deepEqual(new Uint8Array(await restored.file[0].arrayBuffer()), new Uint8Array([0, 1, 2, 255]));
});

test("account and create/edit draft scopes stay isolated even with separator-like IDs", async () => {
  const storage = memoryStorage();
  const repository = createDraftRepository(storage);
  const scopes = [scope, { accountId: "account-b" }, { ...scope, postId: "post-1" },
    { ...scope, postId: "post-2" }, { accountId: 'account-a","edit","post-1' }];
  for (const [index, item] of scopes.entries()) await repository.save(item, values(`Draft ${index}`));
  assert.equal(new Set(scopes.map(draftKey)).size, scopes.length);
  for (const [index, item] of scopes.entries()) assert.equal((await repository.load(item)).caption, `Draft ${index}`);
  await repository.clear(scopes[2]);
  assert.equal(await repository.load(scopes[2]), null);
  assert.equal((await repository.load(scope)).caption, "Draft 0");
  assert.throws(() => draftKey({ accountId: "" }), /account/);
});

test("malformed or wrongly scoped records cannot restore another account's content", async () => {
  const storage = memoryStorage();
  const repository = createDraftRepository(storage);
  await repository.save({ accountId: "other" }, values());
  const wrong = storage.records.get(draftKey({ accountId: "other" }));
  storage.records.set(draftKey(scope), wrong);
  await assert.rejects(repository.load(scope), /could not be restored/);
  storage.records.set(draftKey(scope), { ...wrong, accountId: scope.accountId, image: { data: "not a Blob" } });
  await assert.rejects(repository.load(scope), /could not be restored/);
  assert.equal(storage.records.has(draftKey(scope)), true);
});

test("a failed save retains current data and the earlier durable draft until explicit retry", async (t) => {
  const storage = memoryStorage();
  const repository = createDraftRepository(storage);
  await repository.save(scope, values("Earlier saved draft"));
  const controller = new PostDraftController(scope, empty(), repository);
  t.after(() => controller.dispose());
  await controller.restore();
  storage.failWrite = true;
  controller.change(values("New unsaved draft"));
  assert.equal(await controller.flush(), false);
  assert.equal(controller.getSnapshot().status, "error");
  assert.equal(controller.getSnapshot().unsaved, true);
  assert.equal((await repository.load(scope)).caption, "Earlier saved draft");
  storage.failWrite = false;
  assert.equal(await controller.retrySaving(), true);
  assert.equal((await repository.load(scope)).caption, "New unsaved draft");
  assert.equal(controller.getSnapshot().unsaved, false);
});

test("publishing failure keeps a recoverable draft; confirmed success clears after all earlier writes", async (t) => {
  const storage = memoryStorage();
  const repository = createDraftRepository(storage);
  const controller = new PostDraftController(scope, empty(), repository);
  t.after(() => controller.dispose());
  await controller.restore();
  controller.change(values());
  await controller.flush();
  // No finish call on a failed publication: reopening still restores the draft.
  assert.equal((await repository.load(scope)).caption, "A saved caption");
  const entered = deferred();
  const release = deferred();
  storage.beforeWrite = async () => { entered.resolve(); await release.promise; };
  controller.change(values("Latest pending version"));
  const pendingSave = controller.flush();
  await entered.promise;
  const finish = controller.finish();
  release.resolve();
  await pendingSave;
  assert.equal(await finish, true);
  controller.dispose();
  assert.equal(await repository.load(scope), null);
  assert.equal(controller.getSnapshot().hasDraft, false);
});

test("discard waits for pending saves, resets edit defaults, and preserves other account drafts", async (t) => {
  const storage = memoryStorage();
  const repository = createDraftRepository(storage);
  const baseline = { caption: "Published caption", location: "Melbourne", tags: "old", file: [] };
  const edit = { ...scope, postId: "post-1" };
  await repository.save(scope, values("Separate create draft"));
  const controller = new PostDraftController(edit, baseline, repository);
  t.after(() => controller.dispose());
  await controller.restore();
  const entered = deferred();
  const release = deferred();
  storage.beforeWrite = async () => { entered.resolve(); await release.promise; };
  controller.change(values("Edit not published"));
  const pendingSave = controller.flush();
  await entered.promise;
  const discarded = controller.discard();
  release.resolve();
  await pendingSave;
  assert.deepEqual(await discarded, baseline);
  assert.equal(await repository.load(edit), null);
  assert.equal((await repository.load(scope)).caption, "Separate create draft");
  assert.equal(controller.getSnapshot().unsaved, false);
});

test("finishing an older write cannot mark newer changes saved, and leaving flushes the latest draft", async (t) => {
  const storage = memoryStorage();
  const repository = createDraftRepository(storage);
  const controller = new PostDraftController(scope, empty(), repository);
  t.after(() => controller.dispose());
  await controller.restore();
  const entered = deferred();
  const release = deferred();
  storage.beforeWrite = async () => { entered.resolve(); await release.promise; };
  controller.change(values("Older snapshot"));
  const pendingSave = controller.flush();
  await entered.promise;
  controller.change(values("Newest snapshot"));
  release.resolve();
  await pendingSave;
  assert.equal(controller.getSnapshot().unsaved, true);
  controller.dispose();
  assert.equal((await repository.load(scope)).caption, "Newest snapshot");
});

test("unavailable storage is explicit; continuing without saving keeps edits and can recover with retry", async (t) => {
  const storage = memoryStorage();
  storage.failRead = true;
  const repository = createDraftRepository(storage);
  const controller = new PostDraftController(scope, empty(), repository);
  t.after(() => controller.dispose());
  assert.equal(await controller.restore(), null);
  assert.equal(controller.getSnapshot().ready, false);
  assert.equal(controller.getSnapshot().status, "error");
  controller.continueWithoutSaving();
  controller.change(values());
  assert.equal(await controller.flush(), false);
  assert.equal(controller.getSnapshot().unsaved, true);
  storage.failRead = false;
  assert.equal(await controller.retrySaving(), true);
  assert.equal((await repository.load(scope)).file[0].name, "night.jpg");
});

test("a clear failure is surfaced and cannot trigger an autosave that resurrects a published draft", async () => {
  const storage = memoryStorage();
  const repository = createDraftRepository(storage);
  const controller = new PostDraftController(scope, empty(), repository);
  await controller.restore();
  controller.change(values());
  await controller.flush();
  storage.failRemove = true;
  assert.equal(await controller.finish(), false);
  assert.equal(controller.getSnapshot().status, "error");
  controller.change(values("Must not overwrite after publish"));
  controller.dispose();
  assert.equal((await repository.load(scope)).caption, "A saved caption");
});

test("an obsolete restore cannot unlock the form while a newer restoration is pending", async () => {
  const storage = memoryStorage();
  const firstRead = deferred();
  const secondRead = deferred();
  const enteredFirst = deferred();
  let reads = 0;
  storage.read = async () => {
    if (++reads === 1) {
      enteredFirst.resolve();
      await firstRead.promise;
    } else {
      await secondRead.promise;
    }
    return undefined;
  };
  const controller = new PostDraftController(scope, empty(), createDraftRepository(storage));
  const older = controller.restore();
  await enteredFirst.promise;
  const newer = controller.restore();
  firstRead.resolve();
  assert.equal(await older, null);
  assert.equal(controller.getSnapshot().ready, false);
  secondRead.resolve();
  assert.deepEqual(await newer, empty());
  assert.equal(controller.getSnapshot().ready, true);
  controller.dispose();
});

test("discard invalidates an in-flight restore so its caller cannot reset the form to discarded content", async () => {
  const storage = memoryStorage();
  const repository = createDraftRepository(storage);
  await repository.save(scope, values("Discarded content"));
  const entered = deferred();
  const release = deferred();
  const read = storage.read.bind(storage);
  storage.read = async (key) => {
    entered.resolve();
    await release.promise;
    return read(key);
  };
  const controller = new PostDraftController(scope, empty(), repository);
  const restoration = controller.restore();
  await entered.promise;
  const discarded = controller.discard();
  release.resolve();
  assert.equal(await restoration, null);
  assert.deepEqual(await discarded, empty());
  assert.equal(await repository.load(scope), null);
  assert.equal(controller.getSnapshot().hasDraft, false);
  controller.dispose();
});

test("an earlier publishing controller cannot clear the newer draft saved after reopening the form", async () => {
  const storage = memoryStorage();
  // Independent repository queues also model two browser tabs sharing IndexedDB.
  const repositoryA = createDraftRepository(storage);
  const repositoryB = createDraftRepository(storage);
  const publishingA = new PostDraftController(scope, empty(), repositoryA);
  await publishingA.restore();
  publishingA.change(values("Post A, publishing remotely"));
  await publishingA.flush();
  const revisionA = (await repositoryA.loadWithRevision(scope)).revision;
  publishingA.dispose();

  const reopenedB = new PostDraftController(scope, empty(), repositoryB);
  await reopenedB.restore();
  reopenedB.change(values("New post B, keep this draft"));
  await reopenedB.flush();
  const revisionB = (await repositoryB.loadWithRevision(scope)).revision;
  assert.notEqual(revisionA, revisionB);

  // A's response arrives after B saved. Cleanup must compare A's revision atomically.
  assert.equal(await publishingA.finish(), true);
  assert.equal((await repositoryB.load(scope)).caption, "New post B, keep this draft");
  assert.equal((await repositoryB.loadWithRevision(scope)).revision, revisionB);
  assert.equal(await reopenedB.finish(), true);
  assert.equal(await repositoryB.load(scope), null);
});

test("a controller with no saved or loaded revision leaves another controller's draft untouched", async () => {
  const storage = memoryStorage();
  const repository = createDraftRepository(storage);
  const withoutDraft = new PostDraftController(scope, empty(), repository);
  await withoutDraft.restore();
  await createDraftRepository(storage).save(scope, values("Another controller saved this"));
  assert.equal(await withoutDraft.finish(), true);
  assert.equal((await repository.load(scope)).caption, "Another controller saved this");
});

test("legacy drafts can be cleared by their loader but cannot clear a newer revision", async () => {
  const storage = memoryStorage();
  const repository = createDraftRepository(storage);
  await repository.save(scope, values("Legacy draft"));
  delete storage.records.get(draftKey(scope)).revision;
  assert.equal((await repository.loadWithRevision(scope)).revision, null);
  const legacyController = new PostDraftController(scope, empty(), repository);
  await legacyController.restore();
  await createDraftRepository(storage).save(scope, values("New version from another tab"));
  assert.equal(await legacyController.finish(), true);
  assert.equal((await repository.load(scope)).caption, "New version from another tab");

  delete storage.records.get(draftKey(scope)).revision;
  const currentLegacy = new PostDraftController(scope, empty(), repository);
  await currentLegacy.restore();
  assert.equal(await currentLegacy.finish(), true);
  assert.equal(await repository.load(scope), null);
});
