import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { HistoryEntry } from '$lib/types/history';

// Mock localStorage before importing the store
const localStorageMock = (() => {
	let store: Record<string, string> = {};
	return {
		getItem: vi.fn((key: string) => store[key] ?? null),
		setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
		removeItem: vi.fn((key: string) => { delete store[key]; }),
		clear: vi.fn(() => { store = {}; })
	};
})();

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

const {
	getHistoryState,
	addEntry,
	removeEntry,
	clearHistory,
	restoreHistory,
	getEntryByDocId
} = await import('$lib/stores/history.svelte');

function makeEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
	return {
		docId: 'doc-123',
		docUrl: 'https://docs.google.com/document/d/doc-123/edit',
		docTitle: 'Test Document',
		commentCount: 5,
		convertedAt: Date.now(),
		...overrides
	};
}

describe('history store', () => {
	beforeEach(() => {
		clearHistory();
		localStorageMock.clear();
		vi.clearAllMocks();
	});

	describe('addEntry', () => {
		it('stores a new entry and persists to localStorage', () => {
			const entry = makeEntry();
			addEntry(entry);

			const state = getHistoryState();
			expect(state.entries).toHaveLength(1);
			expect(state.entries[0].docId).toBe('doc-123');
			expect(localStorageMock.setItem).toHaveBeenCalledWith(
				'gdoc_history',
				expect.stringContaining('doc-123')
			);
		});

		it('updates existing entry for same docId and moves to front', () => {
			addEntry(makeEntry({ docId: 'doc-1', docTitle: 'First', convertedAt: 1000 }));
			addEntry(makeEntry({ docId: 'doc-2', docTitle: 'Second', convertedAt: 2000 }));
			addEntry(makeEntry({ docId: 'doc-1', docTitle: 'First Updated', convertedAt: 3000 }));

			const state = getHistoryState();
			expect(state.entries).toHaveLength(2);
			expect(state.entries[0].docId).toBe('doc-1');
			expect(state.entries[0].docTitle).toBe('First Updated');
			expect(state.entries[0].convertedAt).toBe(3000);
			expect(state.entries[1].docId).toBe('doc-2');
		});

		it('enforces MAX_ENTRIES=50 cap by dropping oldest', () => {
			// Add 50 entries
			for (let i = 0; i < 50; i++) {
				addEntry(makeEntry({ docId: `doc-${i}`, convertedAt: i }));
			}

			expect(getHistoryState().entries).toHaveLength(50);

			// Add one more — oldest (doc-0, which is at end) should be dropped
			addEntry(makeEntry({ docId: 'doc-new', convertedAt: 100 }));

			const state = getHistoryState();
			expect(state.entries).toHaveLength(50);
			expect(state.entries[0].docId).toBe('doc-new');
			// doc-0 was the oldest (at end), should be gone
			expect(state.entries.find(e => e.docId === 'doc-0')).toBeUndefined();
		});
	});

	describe('removeEntry', () => {
		it('deletes entry by docId and persists', () => {
			addEntry(makeEntry({ docId: 'doc-1' }));
			addEntry(makeEntry({ docId: 'doc-2' }));
			vi.clearAllMocks();

			const result = removeEntry('doc-1');
			expect(result).toBe(true);
			expect(getHistoryState().entries).toHaveLength(1);
			expect(getHistoryState().entries[0].docId).toBe('doc-2');
			expect(localStorageMock.setItem).toHaveBeenCalled();
		});

		it('returns false for non-existent docId', () => {
			addEntry(makeEntry({ docId: 'doc-1' }));
			expect(removeEntry('doc-nonexistent')).toBe(false);
		});
	});

	describe('clearHistory', () => {
		it('removes all entries and clears localStorage', () => {
			addEntry(makeEntry({ docId: 'doc-1' }));
			addEntry(makeEntry({ docId: 'doc-2' }));
			vi.clearAllMocks();

			clearHistory();
			expect(getHistoryState().entries).toHaveLength(0);
			expect(localStorageMock.removeItem).toHaveBeenCalledWith('gdoc_history');
		});
	});

	describe('restoreHistory', () => {
		it('loads entries from localStorage', () => {
			const entries: HistoryEntry[] = [
				makeEntry({ docId: 'doc-1' }),
				makeEntry({ docId: 'doc-2' })
			];
			localStorageMock.getItem.mockReturnValueOnce(JSON.stringify(entries));

			restoreHistory();
			expect(getHistoryState().entries).toHaveLength(2);
			expect(getHistoryState().entries[0].docId).toBe('doc-1');
		});

		it('handles missing data gracefully', () => {
			localStorageMock.getItem.mockReturnValueOnce(null as unknown as string);
			restoreHistory();
			expect(getHistoryState().entries).toHaveLength(0);
		});

		it('handles corrupt data gracefully', () => {
			localStorageMock.getItem.mockReturnValueOnce('not-json-at-all');
			restoreHistory();
			expect(getHistoryState().entries).toHaveLength(0);
		});

		it('handles non-array data gracefully', () => {
			localStorageMock.getItem.mockReturnValueOnce(JSON.stringify({ not: 'array' }));
			restoreHistory();
			expect(getHistoryState().entries).toHaveLength(0);
		});
	});

	describe('getEntryByDocId', () => {
		it('returns matching entry', () => {
			addEntry(makeEntry({ docId: 'doc-1', docTitle: 'Found It' }));
			addEntry(makeEntry({ docId: 'doc-2' }));

			const result = getEntryByDocId('doc-1');
			expect(result).toBeDefined();
			expect(result!.docTitle).toBe('Found It');
		});

		it('returns undefined for no match', () => {
			addEntry(makeEntry({ docId: 'doc-1' }));
			expect(getEntryByDocId('doc-nope')).toBeUndefined();
		});
	});
});
