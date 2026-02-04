import { test, expect } from '@playwright/test';

const sampleEntries = [
	{
		docId: 'doc-abc123',
		docUrl: 'https://docs.google.com/document/d/doc-abc123/edit',
		docTitle: 'First Test Document',
		commentCount: 3,
		convertedAt: Date.now() - 60_000 // 1 minute ago
	},
	{
		docId: 'doc-xyz789',
		docUrl: 'https://docs.google.com/document/d/doc-xyz789/edit',
		docTitle: 'Second Test Document',
		commentCount: 7,
		convertedAt: Date.now() - 3600_000 // 1 hour ago
	}
];

const sampleMarkdown = '# Test Document\n\nSome content with [comments]^[c1].\n\n> [c1] **Alice**: Great point!';

async function seedHistory(page: import('@playwright/test').Page, entries = sampleEntries) {
	await page.evaluate(
		({ entries, markdown }) => {
			localStorage.setItem('gdoc_history', JSON.stringify(entries));

			// Seed IndexedDB
			return new Promise<void>((resolve, reject) => {
				const request = indexedDB.open('gdoc_comments', 1);
				request.onupgradeneeded = () => {
					const db = request.result;
					if (!db.objectStoreNames.contains('markdown')) {
						db.createObjectStore('markdown', { keyPath: 'docId' });
					}
				};
				request.onsuccess = () => {
					const db = request.result;
					const tx = db.transaction('markdown', 'readwrite');
					const store = tx.objectStore('markdown');
					for (const entry of entries) {
						store.put({ docId: entry.docId, markdown });
					}
					tx.oncomplete = () => resolve();
					tx.onerror = () => reject(tx.error);
				};
				request.onerror = () => reject(request.error);
			});
		},
		{ entries, markdown: sampleMarkdown }
	);
}

test.describe('Conversion History', () => {
	test('home page shows history when entries exist', async ({ page }) => {
		await page.goto('/');
		await seedHistory(page);
		await page.reload();

		const historyList = page.getByTestId('history-list');
		await expect(historyList).toBeVisible();

		const links = page.getByTestId('history-entry-link');
		await expect(links).toHaveCount(2);
		await expect(links.first()).toHaveText('First Test Document');
		await expect(links.nth(1)).toHaveText('Second Test Document');
	});

	test('home page hides history section when empty', async ({ page }) => {
		await page.goto('/');
		// Ensure no history in localStorage
		await page.evaluate(() => localStorage.removeItem('gdoc_history'));
		await page.reload();

		const historyList = page.getByTestId('history-list');
		await expect(historyList).not.toBeVisible();
	});

	test('clicking entry navigates to /convert?historyId= and shows cached markdown', async ({ page }) => {
		await page.goto('/');
		await seedHistory(page);
		await page.reload();

		// Verify the link points to the correct URL
		const firstLink = page.getByTestId('history-entry-link').first();
		await expect(firstLink).toBeVisible();
		await expect(firstLink).toHaveAttribute('href', '/convert?historyId=doc-abc123');

		// Navigate directly to the cached view
		await page.goto('/convert?historyId=doc-abc123');

		// Should show the cached markdown content
		await expect(page.locator('code')).toContainText('Test Document');
		await expect(page.getByTestId('cached-indicator')).toBeVisible();
		await expect(page.getByTestId('cached-indicator')).toContainText('Cached from');
	});

	test('delete button removes individual entry and persists after reload', async ({ page }) => {
		await page.goto('/');
		await seedHistory(page);
		await page.reload();

		// Verify 2 entries
		await expect(page.getByTestId('history-entry-link')).toHaveCount(2);

		// Delete first entry
		await page.getByTestId('history-delete-btn').first().dispatchEvent('click');

		// Should now show 1 entry
		await expect(page.getByTestId('history-entry-link')).toHaveCount(1);
		await expect(page.getByTestId('history-entry-link').first()).toHaveText('Second Test Document');

		// Verify persists after reload
		await page.reload();
		await expect(page.getByTestId('history-entry-link')).toHaveCount(1);
	});

	test('Clear All removes all entries', async ({ page }) => {
		await page.goto('/');
		await seedHistory(page);
		await page.reload();

		await expect(page.getByTestId('history-list')).toBeVisible();

		await page.getByTestId('history-clear-all').dispatchEvent('click');

		await expect(page.getByTestId('history-list')).not.toBeVisible();

		// Verify persists after reload
		await page.reload();
		await expect(page.getByTestId('history-list')).not.toBeVisible();
	});
});
