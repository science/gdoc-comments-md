<script lang="ts">
	import { base } from '$app/paths';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { getAuthState } from '$lib/stores/auth.svelte';
	import { addEntry, getEntryByDocId, restoreHistory } from '$lib/stores/history.svelte';
	import { saveMarkdown, getMarkdown } from '$lib/services/markdown-storage';
	import { extractDocumentId } from '$lib/utils/url';
	import { fetchDocument } from '$lib/services/google-docs';
	import { fetchComments } from '$lib/services/google-drive';
	import { transformToMarkdown, transformWithPageFilter, convertDriveComments } from '$lib/services/transformer';
	import { formatRelativeTime } from '$lib/utils/time';

	const auth = getAuthState();

	let docUrl = $state('');
	let isLoading = $state(false);
	let error = $state<string | null>(null);
	let markdownOutput = $state<string | null>(null);
	let docTitle = $state<string | null>(null);
	let commentCount = $state(0);
	let copied = $state(false);
	let cachedAt = $state<number | null>(null);
	let startPage = $state(1);
	let pageCountInput = $state('');
	let totalPages = $state<number | null>(null);
	let pageRange = $state<{ start: number; end: number } | null>(null);

	onMount(async () => {
		const historyId = $page.url.searchParams.get('historyId');
		if (!historyId) return;

		// Ensure history is loaded (child onMount runs before layout onMount)
		restoreHistory();

		const entry = getEntryByDocId(historyId);
		if (!entry) return;

		const cached = await getMarkdown(historyId);
		if (!cached) return;

		docUrl = entry.docUrl;
		docTitle = entry.docTitle;
		commentCount = entry.commentCount;
		markdownOutput = cached;
		cachedAt = entry.convertedAt;
	});

	async function handleConvert() {
		if (!docUrl.trim()) {
			error = 'Please enter a Google Doc URL';
			return;
		}

		if (!auth.accessToken) {
			error = 'Please connect your Google account in Settings first';
			return;
		}

		// Extract document ID
		const documentId = extractDocumentId(docUrl);
		if (!documentId) {
			error = 'Invalid Google Doc URL. Please enter a valid URL or document ID.';
			return;
		}

		error = null;
		isLoading = true;
		markdownOutput = null;
		docTitle = null;
		commentCount = 0;
		copied = false;
		totalPages = null;
		pageRange = null;

		try {
			// Fetch document and comments in parallel
			const [doc, commentsResponse] = await Promise.all([
				fetchDocument(documentId, auth.accessToken),
				fetchComments(documentId, auth.accessToken)
			]);

			docTitle = doc.title;

			// Convert Drive comments to internal format
			const threads = convertDriveComments(commentsResponse.comments || []);

			// Transform to markdown (with optional page filtering)
			const parsedPageCount = pageCountInput ? parseInt(pageCountInput, 10) : undefined;
			const usePageFilter = startPage > 1 || parsedPageCount !== undefined;

			if (usePageFilter) {
				const result = transformWithPageFilter(doc, threads, {
					startPage,
					pageCount: parsedPageCount
				});
				markdownOutput = result.markdown;
				totalPages = result.totalPages;
				pageRange = result.pageRange;
				commentCount = result.commentCount;
			} else {
				const result = transformWithPageFilter(doc, threads);
				markdownOutput = result.markdown;
				totalPages = result.totalPages;
				pageRange = null;
				commentCount = threads.filter((t) => t.quotedText).length;
			}
			cachedAt = null;

			// Save to history (always store full doc comment count)
			const fullCommentCount = commentsResponse.comments?.length || 0;
			addEntry({
				docId: documentId,
				docUrl: docUrl.trim(),
				docTitle: doc.title,
				commentCount: fullCommentCount,
				convertedAt: Date.now()
			});
			saveMarkdown(documentId, markdownOutput);
		} catch (e) {
			error = e instanceof Error ? e.message : 'An error occurred';
		} finally {
			isLoading = false;
		}
	}

	async function copyToClipboard() {
		if (markdownOutput) {
			await navigator.clipboard.writeText(markdownOutput);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		}
	}

	function downloadMarkdown() {
		if (!markdownOutput || !docTitle) return;

		const blob = new Blob([markdownOutput], { type: 'text/markdown' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${docTitle.replace(/[^a-z0-9]/gi, '_')}.md`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	}
</script>

<svelte:head>
	<title>Convert - GDoc Comments</title>
</svelte:head>

<div class="space-y-6">
	<h1 class="text-2xl font-bold">Convert Document</h1>

	{#if !auth.isAuthenticated && !markdownOutput}
		<div class="bg-yellow-900/50 border border-yellow-700 rounded-lg p-4">
			<p class="text-yellow-200">
				Please <a href="{base}/settings" class="underline hover:text-yellow-100">connect your Google account</a> first.
			</p>
		</div>
	{/if}

	{#if auth.isAuthenticated}
		<div class="bg-gray-800 rounded-lg p-6 border border-gray-700 space-y-4">
			<div>
				<label for="doc-url" class="block text-sm font-medium text-gray-300 mb-2">
					Google Doc URL or Document ID
				</label>
				<input
					id="doc-url"
					type="text"
					bind:value={docUrl}
					placeholder="https://docs.google.com/document/d/... or document ID"
					class="w-full px-4 py-2 bg-gray-900 border border-gray-600 rounded-lg focus:outline-none focus:border-blue-500 text-white placeholder-gray-500"
					onkeydown={(e) => e.key === 'Enter' && handleConvert()}
				/>
			</div>

			<div class="flex gap-4 items-end">
				<div>
					<label for="start-page" class="block text-sm font-medium text-gray-300 mb-2">
						Start from page
					</label>
					<input
						id="start-page"
						type="number"
						min="1"
						bind:value={startPage}
						class="w-28 px-4 py-2 bg-gray-900 border border-gray-600 rounded-lg focus:outline-none focus:border-blue-500 text-white"
					/>
				</div>
				<div>
					<label for="page-count" class="block text-sm font-medium text-gray-300 mb-2">
						Number of pages
					</label>
					<input
						id="page-count"
						type="number"
						min="1"
						bind:value={pageCountInput}
						placeholder="All"
						class="w-28 px-4 py-2 bg-gray-900 border border-gray-600 rounded-lg focus:outline-none focus:border-blue-500 text-white placeholder-gray-500"
					/>
				</div>
				<p class="text-xs text-gray-500 pb-2">Pages are approximate (~3000 characters each)</p>
			</div>

			{#if error}
				<div class="bg-red-900/50 border border-red-700 rounded p-3 text-red-200 text-sm">
					{error}
				</div>
			{/if}

			<button
				onclick={handleConvert}
				disabled={isLoading || !docUrl.trim()}
				class="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-medium px-4 py-2 rounded-lg transition-colors"
			>
				{isLoading ? 'Converting...' : 'Convert to Markdown'}
			</button>
		</div>
	{/if}

	{#if markdownOutput}
		<div class="bg-gray-800 rounded-lg p-6 border border-gray-700 space-y-4">
			<div class="flex items-center justify-between flex-wrap gap-4">
				<div>
					<h2 class="text-lg font-semibold">{docTitle}</h2>
					<p class="text-sm text-gray-400">
					{commentCount} comment{commentCount !== 1 ? 's' : ''} found{#if totalPages}
						{#if pageRange}
							&middot; Showing pages {pageRange.start}–{pageRange.end} of ~{totalPages} estimated
						{:else}
							&middot; ~{totalPages} estimated page{totalPages !== 1 ? 's' : ''}
						{/if}
					{/if}
				</p>
					{#if cachedAt}
						<p class="text-sm text-yellow-400 mt-1" data-testid="cached-indicator">
							Cached from {formatRelativeTime(cachedAt)}
							{#if auth.isAuthenticated}
								<button
									onclick={handleConvert}
									class="ml-2 text-blue-400 hover:text-blue-300 underline"
								>
									Re-fetch from Google
								</button>
							{/if}
						</p>
					{/if}
				</div>
				<div class="flex gap-2">
					<button
						onclick={copyToClipboard}
						class="text-sm bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded transition-colors"
					>
						{copied ? 'Copied!' : 'Copy to Clipboard'}
					</button>
					<button
						onclick={downloadMarkdown}
						class="text-sm bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded transition-colors"
					>
						Download .md
					</button>
				</div>
			</div>
			<pre class="bg-gray-900 p-4 rounded text-sm overflow-x-auto max-h-[500px] overflow-y-auto"><code class="text-gray-300">{markdownOutput}</code></pre>
		</div>
	{/if}
</div>
