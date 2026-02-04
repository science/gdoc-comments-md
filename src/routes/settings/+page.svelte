<script lang="ts">
	import { onMount } from 'svelte';
	import { getAuthState, setAuth, clearAuth } from '$lib/stores/auth.svelte';
	import { initGoogleAuth, signIn, signOut } from '$lib/services/google-auth';
	import type { TokenResponse } from '$lib/services/google-auth';

	const auth = getAuthState();

	let clientId = $state('');
	let isInitialized = $state(false);
	let initError = $state<string | null>(null);
	let isSigningIn = $state(false);

	onMount(() => {
		// Load saved client ID from localStorage
		const savedClientId = localStorage.getItem('gdoc_client_id');
		if (savedClientId) {
			clientId = savedClientId;
			initializeAuth(savedClientId);
		}
	});

	async function initializeAuth(id: string) {
		initError = null;
		try {
			await initGoogleAuth(id, handleTokenResponse);
			isInitialized = true;
		} catch (e) {
			initError = e instanceof Error ? e.message : 'Failed to initialize';
			isInitialized = false;
		}
	}

	function handleTokenResponse(response: TokenResponse) {
		isSigningIn = false;

		if (response.error) {
			initError = `Auth error: ${response.error}`;
			return;
		}

		// Fetch user info with the token
		fetchUserInfo(response.access_token, response.expires_in);
	}

	async function fetchUserInfo(token: string, expiresIn?: number) {
		try {
			const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
				headers: { Authorization: `Bearer ${token}` }
			});

			if (!response.ok) {
				const body = await response.text();
				throw new Error(`User info failed (HTTP ${response.status}): ${body}`);
			}

			const user = await response.json();
			setAuth(token, {
				email: user.email,
				name: user.name,
				picture: user.picture
			}, expiresIn);
		} catch (e) {
			initError = e instanceof Error ? e.message : 'Failed to get user info';
		}
	}

	function saveClientId() {
		if (!clientId.trim()) {
			initError = 'Please enter a Client ID';
			return;
		}
		localStorage.setItem('gdoc_client_id', clientId.trim());
		initializeAuth(clientId.trim());
	}

	function handleSignIn() {
		isSigningIn = true;
		initError = null;
		signIn();
	}

	function handleSignOut() {
		signOut();
		clearAuth();
	}
</script>

<svelte:head>
	<title>Settings - GDoc Comments</title>
</svelte:head>

<div class="space-y-6">
	<h1 class="text-2xl font-bold">Settings</h1>

	<!-- Instructions -->
	<div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
		<h2 class="text-lg font-semibold mb-4">Setup Instructions</h2>
		<ol class="list-decimal list-inside space-y-2 text-gray-300 text-sm">
			<li>Go to <a href="https://console.cloud.google.com/apis/credentials" target="_blank" class="text-blue-400 hover:underline">Google Cloud Console</a></li>
			<li>Create or select a project</li>
			<li>Enable <strong>Google Docs API</strong> and <strong>Google Drive API</strong></li>
			<li>Create OAuth 2.0 credentials (Web application type)</li>
			<li>Add <code class="bg-gray-700 px-1 rounded">http://localhost:5173</code> to Authorized JavaScript origins</li>
			<li>Copy the Client ID and paste it below</li>
			<li>Configure OAuth consent screen (add yourself as test user)</li>
		</ol>
	</div>

	<!-- OAuth Configuration -->
	<div class="bg-gray-800 rounded-lg p-6 border border-gray-700 space-y-4">
		<h2 class="text-lg font-semibold">Google OAuth Configuration</h2>

		<div>
			<label for="client-id" class="block text-sm font-medium text-gray-300 mb-2">
				OAuth Client ID
			</label>
			<input
				id="client-id"
				type="text"
				bind:value={clientId}
				placeholder="YOUR_CLIENT_ID.apps.googleusercontent.com"
				class="w-full px-4 py-2 bg-gray-900 border border-gray-600 rounded-lg focus:outline-none focus:border-blue-500 text-white placeholder-gray-500"
			/>
		</div>

		{#if initError}
			<div class="bg-red-900/50 border border-red-700 rounded p-3 text-red-200 text-sm">
				{initError}
			</div>
		{/if}

		<button
			onclick={saveClientId}
			class="bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2 rounded-lg transition-colors"
		>
			Save & Initialize
		</button>
	</div>

	<!-- Auth Status -->
	{#if isInitialized}
		<div class="bg-gray-800 rounded-lg p-6 border border-gray-700 space-y-4">
			<h2 class="text-lg font-semibold">Authentication</h2>

			{#if auth.isAuthenticated && auth.user}
				<div class="flex items-center gap-4 bg-green-900/30 border border-green-700 rounded-lg p-4">
					{#if auth.user.picture}
						<img src={auth.user.picture} alt="Profile" class="w-12 h-12 rounded-full" />
					{/if}
					<div>
						<div class="font-medium text-white">{auth.user.name}</div>
						<div class="text-sm text-gray-400">{auth.user.email}</div>
					</div>
				</div>
				<button
					onclick={handleSignOut}
					class="bg-red-600 hover:bg-red-700 text-white font-medium px-4 py-2 rounded-lg transition-colors"
				>
					Sign Out
				</button>
			{:else}
				<p class="text-gray-400">Ready to sign in.</p>
				<button
					onclick={handleSignIn}
					disabled={isSigningIn}
					class="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white font-medium px-4 py-2 rounded-lg transition-colors"
				>
					{isSigningIn ? 'Signing in...' : 'Sign in with Google'}
				</button>
			{/if}
		</div>
	{/if}
</div>
