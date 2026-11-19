export type PostDraftValues = {
  caption: string;
  location: string;
  tags: string;
  file: File[];
};

export type PostDraftScope = {
  accountId: string;
  postId?: string;
};

type DraftRecord = {
  version: 1;
  revision?: string;
  accountId: string;
  postId: string | null;
  caption: string;
  location: string;
  tags: string;
  image: { data: Blob; name: string; type: string; lastModified: number } | null;
};

export interface DraftStorage {
  read(key: string): Promise<unknown>;
  write(key: string, value: DraftRecord): Promise<void>;
  // undefined explicitly discards any draft; null matches a legacy draft with no revision.
  remove(key: string, expectedRevision?: string | null): Promise<boolean>;
}

let connection: Promise<IDBDatabase> | undefined;

function openDatabase() {
  if (!connection) {
    connection = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("Local draft storage is unavailable."));
        return;
      }
      const request = indexedDB.open("zeronet-post-drafts", 1);
      let blocked = false;
      request.onupgradeneeded = () => {
        request.result.createObjectStore("drafts");
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => {
        blocked = true;
        reject(new Error("Local draft storage is blocked."));
      };
      request.onsuccess = () => {
        const database = request.result;
        if (blocked) {
          database.close();
          return;
        }
        database.onversionchange = () => {
          database.close();
          connection = undefined;
        };
        resolve(database);
      };
    }).catch((error) => {
      connection = undefined;
      throw error;
    });
  }
  return connection;
}

async function accessStorage(
  mode: IDBTransactionMode,
  requestFor: (store: IDBObjectStore) => IDBRequest
) {
  const database = await openDatabase();
  return new Promise<unknown>((resolve, reject) => {
    const transaction = database.transaction("drafts", mode);
    const request = requestFor(transaction.objectStore("drafts"));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("Draft save was interrupted."));
  });
}

const browserStorage: DraftStorage = {
  read: (key) => accessStorage("readonly", (store) => store.get(key)),
  write: async (key, value) => {
    await accessStorage("readwrite", (store) => store.put(value, key));
  },
  remove: async (key, expectedRevision) => {
    const database = await openDatabase();
    return new Promise<boolean>((resolve, reject) => {
      const transaction = database.transaction("drafts", "readwrite");
      const store = transaction.objectStore("drafts");
      let matched = true;
      if (expectedRevision === undefined) {
        store.delete(key);
      } else {
        const request = store.get(key);
        request.onsuccess = () => {
          const record = request.result as DraftRecord | undefined;
          if (record === undefined) return;
          const revision = record.revision === undefined ? null : record.revision;
          if (revision === expectedRevision) store.delete(key);
          else matched = false;
        };
      }
      // The read and conditional delete share one transaction, including across tabs.
      transaction.oncomplete = () => resolve(matched);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error("Draft cleanup was interrupted."));
    });
  },
};

export function draftKey(scope: PostDraftScope) {
  if (!scope.accountId) throw new Error("An account is required for a draft.");
  return JSON.stringify([scope.accountId, scope.postId ? "edit" : "create", scope.postId ?? null]);
}

function copyValues(values: PostDraftValues): PostDraftValues {
  return { ...values, file: [...values.file] };
}

function sameValues(left: PostDraftValues, right: PostDraftValues) {
  return left.caption === right.caption &&
    left.location === right.location &&
    left.tags === right.tags &&
    left.file[0] === right.file[0];
}

export function createDraftRepository(storage: DraftStorage = browserStorage) {
  let pending: Promise<unknown> = Promise.resolve();
  function ordered<T>(operation: () => Promise<T>): Promise<T> {
    const result = pending.then(operation);
    pending = result.catch(() => undefined);
    return result;
  }

  const loadWithRevision = (scope: PostDraftScope) => ordered(async () => {
      const record = await storage.read(draftKey(scope));
      if (record === undefined || record === null) return null;
      const draft = record as DraftRecord;
      if (
        draft.version !== 1 ||
        (draft.revision !== undefined && typeof draft.revision !== "string") ||
        draft.accountId !== scope.accountId ||
        draft.postId !== (scope.postId ?? null) ||
        typeof draft.caption !== "string" ||
        typeof draft.location !== "string" ||
        typeof draft.tags !== "string" ||
        (draft.image !== null && (
          !(draft.image?.data instanceof Blob) ||
          typeof draft.image.name !== "string" ||
          typeof draft.image.type !== "string" ||
          typeof draft.image.lastModified !== "number"
        ))
      ) {
        throw new Error("The saved draft could not be restored.");
      }
      return {
        revision: draft.revision ?? null,
        values: {
          caption: draft.caption,
          location: draft.location,
          tags: draft.tags,
          file: draft.image ? [new File([draft.image.data], draft.image.name, {
            type: draft.image.type,
            lastModified: draft.image.lastModified,
          })] : [],
        },
      };
    });

  return {
    loadWithRevision,
    load: (scope: PostDraftScope) => loadWithRevision(scope).then((saved) => saved?.values ?? null),
    save: (scope: PostDraftScope, values: PostDraftValues) => {
      const file = values.file[0];
      const revision = crypto.randomUUID();
      const record: DraftRecord = {
        version: 1,
        revision,
        accountId: scope.accountId,
        postId: scope.postId ?? null,
        caption: values.caption,
        location: values.location,
        tags: values.tags,
        image: file ? {
          data: file,
          name: file.name,
          type: file.type,
          lastModified: file.lastModified,
        } : null,
      };
      return ordered(async () => {
        await storage.write(draftKey(scope), record);
        return revision;
      });
    },
    clear: (scope: PostDraftScope, expectedRevision?: string | null) =>
      ordered(() => storage.remove(draftKey(scope), expectedRevision)),
  };
}

export const postDraftRepository = createDraftRepository();
type DraftRepository = ReturnType<typeof createDraftRepository>;

export type PostDraftState = {
  ready: boolean;
  status: "loading" | "idle" | "saving" | "saved" | "error";
  hasDraft: boolean;
  unsaved: boolean;
  restored: boolean;
};

export class PostDraftController {
  private scope: PostDraftScope;
  private baseline: PostDraftValues;
  private values: PostDraftValues;
  private repository: DraftRepository;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private listeners = new Set<() => void>();
  private revision = 0;
  private savedRevision = 0;
  private storageRevision: string | null | undefined;
  private pendingWrites = new Set<Promise<string>>();
  private restoreVersion = 0;
  private stopped = false;
  private autosave = true;
  private state: PostDraftState = {
    ready: false, status: "loading", hasDraft: false, unsaved: false, restored: false,
  };

  constructor(scope: PostDraftScope, baseline: PostDraftValues, repository = postDraftRepository) {
    this.scope = { ...scope };
    this.baseline = copyValues(baseline);
    this.values = copyValues(baseline);
    this.repository = repository;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = () => this.state;

  private updateState(change: Partial<PostDraftState>) {
    this.state = { ...this.state, ...change };
    this.listeners.forEach((listener) => listener());
  }

  async restore() {
    const version = ++this.restoreVersion;
    this.updateState({ status: "loading", ready: false });
    try {
      const saved = await this.repository.loadWithRevision(this.scope);
      if (version !== this.restoreVersion) return null;
      this.values = copyValues(saved?.values ?? this.baseline);
      this.storageRevision = saved?.revision;
      this.revision = 0;
      this.savedRevision = 0;
      this.autosave = true;
      this.updateState({
        ready: true,
        status: saved ? "saved" : "idle",
        restored: !!saved,
        hasDraft: !!saved,
        unsaved: false,
      });
      return copyValues(this.values);
    } catch {
      if (version === this.restoreVersion) this.updateState({ status: "error", ready: false });
      return null;
    }
  }

  continueWithoutSaving() {
    this.restoreVersion++;
    this.autosave = false;
    this.updateState({ ready: true, status: "error" });
  }

  change(values: PostDraftValues) {
    if (!this.state.ready || this.stopped || sameValues(values, this.values)) return;
    this.values = copyValues(values);
    this.revision++;
    clearTimeout(this.timer);
    const hasDraft = this.state.hasDraft || !sameValues(this.values, this.baseline);
    this.updateState({
      hasDraft,
      unsaved: hasDraft,
      restored: false,
      status: hasDraft ? (this.autosave ? "saving" : "error") : "idle",
    });
    if (hasDraft && this.autosave) {
      this.timer = setTimeout(() => { void this.flush(); }, 500);
    }
  }

  async flush() {
    clearTimeout(this.timer);
    if (!this.state.ready || this.stopped || !this.autosave) return false;
    if (this.revision === this.savedRevision && this.state.status !== "error") return true;
    const revision = this.revision;
    const values = copyValues(this.values);
    this.updateState({ status: "saving" });
    let write: Promise<string> | undefined;
    try {
      write = this.repository.save(this.scope, values);
      this.pendingWrites.add(write);
      this.storageRevision = await write;
      this.savedRevision = revision;
      if (revision === this.revision && !this.stopped) {
        this.updateState({ status: "saved", unsaved: false, hasDraft: true });
      }
      return true;
    } catch {
      if (revision === this.revision && !this.stopped) {
        this.updateState({ status: "error", unsaved: true });
      }
      return false;
    } finally {
      if (write) this.pendingWrites.delete(write);
    }
  }

  retrySaving() {
    this.autosave = true;
    return this.flush();
  }

  async discard() {
    this.restoreVersion++;
    clearTimeout(this.timer);
    this.stopped = true;
    try {
      await this.repository.clear(this.scope);
      this.storageRevision = undefined;
      this.values = copyValues(this.baseline);
      this.revision++;
      this.savedRevision = this.revision;
      this.autosave = true;
      this.updateState({
        ready: true, status: "idle", hasDraft: false, unsaved: false, restored: false,
      });
      return copyValues(this.values);
    } catch {
      this.updateState({ status: "error" });
      return null;
    } finally {
      this.stopped = false;
    }
  }

  async finish() {
    this.restoreVersion++;
    clearTimeout(this.timer);
    this.stopped = true;
    try {
      // Finish all writes from this controller before selecting the revision to clear.
      await Promise.allSettled(this.pendingWrites);
      if (this.storageRevision !== undefined) {
        await this.repository.clear(this.scope, this.storageRevision);
      }
      // A revision mismatch belongs to a newer draft and is intentionally preserved.
      this.storageRevision = undefined;
      this.updateState({ status: "idle", hasDraft: false, unsaved: false });
      return true;
    } catch {
      this.updateState({ status: "error" });
      return false;
    }
  }

  dispose() {
    clearTimeout(this.timer);
    if (!this.stopped && this.state.unsaved && this.autosave) void this.flush();
  }
}
