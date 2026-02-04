/**
 * IndexedDB storage for cached markdown content
 * Uses the idb library for a promise-based API
 */

import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'gdoc_comments';
const DB_VERSION = 1;
const STORE_NAME = 'markdown';

interface MarkdownRecord {
	docId: string;
	markdown: string;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
	if (!dbPromise) {
		dbPromise = openDB(DB_NAME, DB_VERSION, {
			upgrade(db) {
				if (!db.objectStoreNames.contains(STORE_NAME)) {
					db.createObjectStore(STORE_NAME, { keyPath: 'docId' });
				}
			}
		});
		// Request durable storage (non-blocking, browser may prompt user)
		navigator.storage?.persist?.().catch(() => {});
	}
	return dbPromise;
}

/**
 * Save markdown content for a document
 */
export async function saveMarkdown(docId: string, markdown: string): Promise<void> {
	const db = await getDb();
	await db.put(STORE_NAME, { docId, markdown } satisfies MarkdownRecord);
}

/**
 * Get cached markdown for a document, or null if not found
 */
export async function getMarkdown(docId: string): Promise<string | null> {
	const db = await getDb();
	const record = await db.get(STORE_NAME, docId) as MarkdownRecord | undefined;
	return record?.markdown ?? null;
}

/**
 * Delete cached markdown for a document
 */
export async function deleteMarkdown(docId: string): Promise<void> {
	const db = await getDb();
	await db.delete(STORE_NAME, docId);
}

/**
 * Delete all cached markdown
 */
export async function deleteAllMarkdown(): Promise<void> {
	const db = await getDb();
	await db.clear(STORE_NAME);
}
