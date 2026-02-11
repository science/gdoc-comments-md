import { test, expect } from '@playwright/test';

const longLineMarkdown = '# Test\n\n' + 'word '.repeat(200) + '\n';

async function seedConvertPage(page: import('@playwright/test').Page) {
	const entry = {
		docId: 'doc-wrap-test',
		docUrl: 'https://docs.google.com/document/d/doc-wrap-test/edit',
		docTitle: 'Wrap Test Doc',
		commentCount: 0,
		convertedAt: Date.now()
	};

	await page.evaluate(
		({ entry, markdown }) => {
			localStorage.setItem('gdoc_history', JSON.stringify([entry]));

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
					store.put({ docId: entry.docId, markdown });
					tx.oncomplete = () => resolve();
					tx.onerror = () => reject(tx.error);
				};
				request.onerror = () => reject(request.error);
			});
		},
		{ entry, markdown: longLineMarkdown }
	);
}

test.describe('Word wrap toggle', () => {
	test('preview defaults to no wrapping (horizontal scroll)', async ({ page }) => {
		await page.goto('/');
		await seedConvertPage(page);
		await page.goto('/convert?historyId=doc-wrap-test');

		const pre = page.locator('pre');
		await expect(pre).toBeVisible();

		const whiteSpace = await pre.evaluate((el) => getComputedStyle(el).whiteSpace);
		expect(whiteSpace).toBe('pre');
	});

	test('checking wrap toggle enables word wrapping', async ({ page }) => {
		await page.goto('/');
		await seedConvertPage(page);
		await page.goto('/convert?historyId=doc-wrap-test');

		const toggle = page.getByTestId('wrap-toggle');
		await expect(toggle).toBeVisible();
		await toggle.check();

		const pre = page.locator('pre');
		const whiteSpace = await pre.evaluate((el) => getComputedStyle(el).whiteSpace);
		expect(whiteSpace).toBe('pre-wrap');
	});

	test('unchecking wrap toggle restores horizontal scroll', async ({ page }) => {
		await page.goto('/');
		await seedConvertPage(page);
		await page.goto('/convert?historyId=doc-wrap-test');

		const toggle = page.getByTestId('wrap-toggle');
		await toggle.check();
		await toggle.uncheck();

		const pre = page.locator('pre');
		const whiteSpace = await pre.evaluate((el) => getComputedStyle(el).whiteSpace);
		expect(whiteSpace).toBe('pre');
	});
});
