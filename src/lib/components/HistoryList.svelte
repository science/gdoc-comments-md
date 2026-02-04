<script lang="ts">
	import { base } from '$app/paths';
	import type { HistoryEntry } from '$lib/types/history';
	import { formatRelativeTime } from '$lib/utils/time';

	interface Props {
		entries: HistoryEntry[];
		onDelete: (docId: string) => void;
		onClearAll: () => void;
	}

	let { entries, onDelete, onClearAll }: Props = $props();

	function truncateUrl(url: string, maxLen = 60): string {
		if (url.length <= maxLen) return url;
		return url.slice(0, maxLen) + '...';
	}
</script>

{#if entries.length > 0}
	<section class="bg-gray-800 rounded-lg p-6 border border-gray-700 space-y-4">
		<h2 class="text-lg font-semibold">Recent Conversions</h2>

		<ul class="space-y-3" data-testid="history-list">
			{#each entries as entry (entry.docId)}
				<li class="flex items-start justify-between gap-3 bg-gray-900 rounded-lg p-4 border border-gray-700">
					<div class="min-w-0 flex-1">
						<a
							href="{base}/convert?historyId={entry.docId}"
							class="text-blue-400 hover:text-blue-300 font-medium hover:underline"
							data-testid="history-entry-link"
						>
							{entry.docTitle}
						</a>
						<p class="text-sm text-gray-500 truncate mt-1" title={entry.docUrl}>
							{truncateUrl(entry.docUrl)}
						</p>
						<p class="text-sm text-gray-400 mt-1">
							{entry.commentCount} comment{entry.commentCount !== 1 ? 's' : ''}
							&middot;
							{formatRelativeTime(entry.convertedAt)}
						</p>
					</div>
					<button
						onclick={() => onDelete(entry.docId)}
						class="text-gray-500 hover:text-red-400 transition-colors shrink-0 p-1"
						title="Remove from history"
						data-testid="history-delete-btn"
					>
						<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
							<path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
						</svg>
					</button>
				</li>
			{/each}
		</ul>

		<div class="text-right">
			<button
				onclick={onClearAll}
				class="text-sm text-gray-500 hover:text-red-400 transition-colors"
				data-testid="history-clear-all"
			>
				Clear All History
			</button>
		</div>
	</section>
{/if}
