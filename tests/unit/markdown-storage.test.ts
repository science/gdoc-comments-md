import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the idb module
const mockStore = new Map<string, { docId: string; markdown: string }>();

const mockObjectStore = {
	put: vi.fn(async (value: { docId: string; markdown: string }) => {
		mockStore.set(value.docId, value);
	}),
	get: vi.fn(async (key: string) => {
		return mockStore.get(key);
	}),
	delete: vi.fn(async (key: string) => {
		mockStore.delete(key);
	}),
	clear: vi.fn(async () => {
		mockStore.clear();
	})
};

const mockDb = {
	put: vi.fn(async (storeName: string, value: { docId: string; markdown: string }) => {
		mockStore.set(value.docId, value);
	}),
	get: vi.fn(async (storeName: string, key: string) => {
		return mockStore.get(key);
	}),
	delete: vi.fn(async (storeName: string, key: string) => {
		mockStore.delete(key);
	}),
	clear: vi.fn(async (storeName: string) => {
		mockStore.clear();
	})
};

vi.mock('idb', () => ({
	openDB: vi.fn(async () => mockDb)
}));

// Mock navigator.storage.persist
Object.defineProperty(globalThis, 'navigator', {
	value: {
		storage: {
			persist: vi.fn(async () => true)
		}
	},
	writable: true
});

const { saveMarkdown, getMarkdown, deleteMarkdown, deleteAllMarkdown } = await import('$lib/services/markdown-storage');

describe('markdown-storage', () => {
	beforeEach(() => {
		mockStore.clear();
		vi.clearAllMocks();
	});

	describe('saveMarkdown', () => {
		it('stores content by docId', async () => {
			await saveMarkdown('doc-1', '# Hello World');
			expect(mockDb.put).toHaveBeenCalledWith('markdown', {
				docId: 'doc-1',
				markdown: '# Hello World'
			});
		});
	});

	describe('getMarkdown', () => {
		it('retrieves stored content', async () => {
			mockStore.set('doc-1', { docId: 'doc-1', markdown: '# Test' });
			const result = await getMarkdown('doc-1');
			expect(result).toBe('# Test');
		});

		it('returns null for missing docId', async () => {
			const result = await getMarkdown('doc-nonexistent');
			expect(result).toBeNull();
		});
	});

	describe('deleteMarkdown', () => {
		it('removes content by docId', async () => {
			mockStore.set('doc-1', { docId: 'doc-1', markdown: '# Test' });
			await deleteMarkdown('doc-1');
			expect(mockDb.delete).toHaveBeenCalledWith('markdown', 'doc-1');
		});
	});

	describe('deleteAllMarkdown', () => {
		it('clears the entire store', async () => {
			mockStore.set('doc-1', { docId: 'doc-1', markdown: '# A' });
			mockStore.set('doc-2', { docId: 'doc-2', markdown: '# B' });
			await deleteAllMarkdown();
			expect(mockDb.clear).toHaveBeenCalledWith('markdown');
		});
	});
});
