<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { getAuthState, restoreAuth, setAuth, isTokenExpired } from '$lib/stores/auth.svelte';
	import { initGoogleAuth, silentRefresh } from '$lib/services/google-auth';
	import type { TokenResponse } from '$lib/services/google-auth';

	let { children } = $props();
	const auth = getAuthState();

	onMount(() => {
		// Try to restore auth from localStorage
		const restored = restoreAuth();

		// Initialize GIS for potential silent refresh
		const clientId = localStorage.getItem('gdoc_client_id');
		if (clientId) {
			initGoogleAuth(clientId, handleTokenResponse).then(() => {
				// If restored but token is expiring soon, silently refresh
				if (restored && isTokenExpired()) {
					silentRefresh();
				}
			}).catch(() => {
				// GIS init failed, user can still use restored token until it expires
			});
		}
	});

	async function handleTokenResponse(response: TokenResponse) {
		if (response.error || !response.access_token) return;

		// Fetch user info and update auth store (which persists to localStorage)
		try {
			const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
				headers: { Authorization: `Bearer ${response.access_token}` }
			});
			if (!userResponse.ok) return;

			const user = await userResponse.json();
			setAuth(response.access_token, {
				email: user.email,
				name: user.name,
				picture: user.picture
			}, response.expires_in);
		} catch {
			// Silent refresh failed, existing token may still work
		}
	}
</script>

<div class="min-h-screen flex flex-col">
	<header class="bg-gray-800 border-b border-gray-700">
		<nav class="max-w-4xl mx-auto px-4 py-4">
			<div class="flex items-center justify-between">
				<a href="/" class="text-xl font-semibold text-blue-400 hover:text-blue-300">
					GDoc Comments
				</a>
				<div class="flex items-center gap-4">
					<a href="/convert" class="text-gray-300 hover:text-white transition-colors">
						Convert
					</a>
					<a href="/settings" class="text-gray-300 hover:text-white transition-colors">
						Settings
					</a>
					{#if auth.isAuthenticated && auth.user}
						<span class="text-sm text-gray-400">{auth.user.email}</span>
					{/if}
				</div>
			</div>
		</nav>
	</header>

	<main class="flex-1 max-w-4xl mx-auto px-4 py-8 w-full">
		{@render children()}
	</main>

	<footer class="bg-gray-800 border-t border-gray-700 py-4">
		<div class="max-w-4xl mx-auto px-4 text-center text-gray-500 text-sm">
			Extract Google Docs comments to markdown
		</div>
	</footer>
</div>
