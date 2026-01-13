import { openDB } from "idb";

const DB_NAME = "evb_local_v1";
const DOCX_STORE = "docx";
const STORE_NAME = "tableImages";

type TableImageRecord = {
  id: string;
  projectId: string;
  blob: Blob;
};

function openTableImageDb() {
  return openDB(DB_NAME, 2, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(DOCX_STORE)) {
        db.createObjectStore(DOCX_STORE, { keyPath: "projectId" });
      }
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("projectId", "projectId", { unique: false });
      }
    }
  });
}

export async function putTableImage(
  projectId: string,
  attachmentId: string,
  blob: Blob
): Promise<void> {
  const db = await openTableImageDb();
  const record: TableImageRecord = { id: attachmentId, projectId, blob };
  await db.put(STORE_NAME, record);
}

export async function getTableImage(attachmentId: string): Promise<Blob | null> {
  const db = await openTableImageDb();
  const record = (await db.get(STORE_NAME, attachmentId)) as TableImageRecord | undefined;
  return record?.blob ?? null;
}

export async function getTableImageBlob(
  projectId: string,
  attachmentId: string
): Promise<Blob | null> {
  const db = await openTableImageDb();
  const record = (await db.get(STORE_NAME, attachmentId)) as TableImageRecord | undefined;
  if (!record || record.projectId !== projectId) {
    return null;
  }
  return record.blob ?? null;
}

export async function deleteTableImagesForProject(projectId: string): Promise<void> {
  const db = await openTableImageDb();
  const index = db.transaction(STORE_NAME, "readwrite").store.index("projectId");
  let cursor = await index.openCursor(projectId);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
}
