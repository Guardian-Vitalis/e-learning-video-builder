import { openDB } from "idb";
import { DocxMeta } from "@evb/shared";

const DB_NAME = "evb_local_v1";
const STORE_NAME = "docx";
const TABLE_IMAGE_STORE = "tableImages";

type DocxRecord = {
  projectId: string;
  blob: Blob;
  meta: DocxMeta;
};

function openDocxDb() {
  return openDB(DB_NAME, 2, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "projectId" });
      }
      if (!db.objectStoreNames.contains(TABLE_IMAGE_STORE)) {
        const store = db.createObjectStore(TABLE_IMAGE_STORE, { keyPath: "id" });
        store.createIndex("projectId", "projectId", { unique: false });
      }
    }
  });
}

export async function putDocx(projectId: string, file: File): Promise<DocxMeta> {
  const db = await openDocxDb();
  const meta: DocxMeta = {
    fileName: file.name,
    fileSize: file.size,
    lastModified: file.lastModified,
    storedAt: new Date().toISOString()
  };
  const record: DocxRecord = { projectId, blob: file, meta };
  await db.put(STORE_NAME, record);
  return meta;
}

export async function getDocx(projectId: string): Promise<Blob | null> {
  const db = await openDocxDb();
  const record = (await db.get(STORE_NAME, projectId)) as DocxRecord | undefined;
  return record?.blob ?? null;
}

export async function deleteDocx(projectId: string): Promise<void> {
  const db = await openDocxDb();
  await db.delete(STORE_NAME, projectId);
}
