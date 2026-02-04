<script lang="ts">
	import { base } from '$app/paths';
	import { getAuthState } from '$lib/stores/auth.svelte';

	const auth = getAuthState();
</script>

<svelte:head>
	<title>GDoc Comments to Markdown</title>
</svelte:head>

<div class="space-y-8">
	<section class="text-center space-y-4">
		<h1 class="text-4xl font-bold text-white">
			Google Docs Comments to Markdown
		</h1>
		<p class="text-xl text-gray-400 max-w-2xl mx-auto">
			Extract comment threads from Google Docs and convert them to a clean, readable markdown format.
		</p>
	</section>

	<section class="bg-gray-800 rounded-lg p-6 border border-gray-700">
		<h2 class="text-lg font-semibold mb-4">How it works</h2>
		<ol class="list-decimal list-inside space-y-2 text-gray-300">
			<li>Connect your Google account in <a href="{base}/settings" class="text-blue-400 hover:underline">Settings</a></li>
			<li>Paste a Google Doc URL on the <a href="{base}/convert" class="text-blue-400 hover:underline">Convert</a> page</li>
			<li>Get markdown with inline comment anchors and threaded replies</li>
		</ol>
	</section>

	<section class="bg-gray-800 rounded-lg p-6 border border-gray-700">
		<h2 class="text-lg font-semibold mb-4">Output format</h2>
		<pre class="bg-gray-900 p-4 rounded text-sm overflow-x-auto"><code class="text-gray-300">Here is text [from the document itself]^[c1] including _styling_.

&gt; [c1] **Sophia** (sophia@email.com):
&gt; This is the first comment
&gt;
&gt; [c1] **Steve** (steve@email.com):
&gt; This is a reply</code></pre>
	</section>

	<section class="text-center">
		{#if auth.isAuthenticated}
			<a
				href="{base}/convert"
				class="inline-block bg-blue-600 hover:bg-blue-700 text-white font-medium px-6 py-3 rounded-lg transition-colors"
			>
				Convert a Document
			</a>
		{:else}
			<a
				href="{base}/settings"
				class="inline-block bg-blue-600 hover:bg-blue-700 text-white font-medium px-6 py-3 rounded-lg transition-colors"
			>
				Connect Google Account
			</a>
		{/if}
	</section>
</div>
