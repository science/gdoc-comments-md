/**
 * Conversion history store using Svelte 5 runes
 * Persists entry metadata to localStorage
 */

import type { HistoryEntry } from '$lib/types/history';

const STORAGE_KEY = 'gdoc_history';
const MAX_ENTRIES = 50;

// Module-level state using runes
let entries = $state<HistoryEntry[]>([]);

interface HistoryState {
	entries: HistoryEntry[];
}

/**
 * Get reactive history state
 */
export function getHistoryState(): HistoryState {
	return {
		get entries() {
			return entries;
		}
	};
}

/**
 * Add or update a history entry. New/updated entries go to the front.
 * Enforces MAX_ENTRIES cap by dropping oldest.
 */
export function addEntry(entry: HistoryEntry): void {
	// Remove existing entry with same docId
	entries = entries.filter(e => e.docId !== entry.docId);

	// Prepend new entry
	entries = [entry, ...entries];

	// Enforce cap
	if (entries.length > MAX_ENTRIES) {
		entries = entries.slice(0, MAX_ENTRIES);
	}

	persist();
}

/**
 * Remove a history entry by docId.
 * Returns true if entry was found and removed, false otherwise.
 */
export function removeEntry(docId: string): boolean {
	const len = entries.length;
	entries = entries.filter(e => e.docId !== docId);
	if (entries.length === len) return false;
	persist();
	return true;
}

/**
 * Clear all history entries
 */
export function clearHistory(): void {
	entries = [];
	try {
		localStorage.removeItem(STORAGE_KEY);
	} catch {
		// localStorage may be unavailable
	}
}

/**
 * Restore history from localStorage
 */
export function restoreHistory(): void {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return;

		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return;

		entries = parsed;
	} catch {
		// Corrupt data — ignore
	}
}

/**
 * Find a history entry by document ID
 */
export function getEntryByDocId(docId: string): HistoryEntry | undefined {
	return entries.find(e => e.docId === docId);
}

function persist(): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
	} catch {
		// localStorage may be unavailable
	}
}
