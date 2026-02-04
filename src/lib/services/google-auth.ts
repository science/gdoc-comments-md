/**
 * Google OAuth2 authentication service using Google Identity Services (GIS)
 */

const SCOPES = [
	'openid',
	'email',
	'profile',
	'https://www.googleapis.com/auth/documents.readonly',
	'https://www.googleapis.com/auth/drive.readonly'
].join(' ');

// GIS types
export interface TokenResponse {
	access_token: string;
	expires_in?: number;
	error?: string;
}

interface TokenClient {
	requestAccessToken: (overrides?: { prompt?: string }) => void;
}

declare global {
	interface Window {
		google?: {
			accounts: {
				oauth2: {
					initTokenClient: (config: {
						client_id: string;
						scope: string;
						callback: (response: TokenResponse) => void;
					}) => TokenClient;
					revoke: (token: string, callback: () => void) => void;
				};
			};
		};
	}
}

let tokenClient: TokenClient | null = null;
let currentAccessToken: string | null = null;

/**
 * Load Google Identity Services script if not already loaded
 */
function loadGisScript(): Promise<void> {
	return new Promise((resolve, reject) => {
		if (window.google?.accounts?.oauth2) {
			resolve();
			return;
		}

		// Check if script is already loading
		const existing = document.querySelector('script[src*="accounts.google.com/gsi/client"]');
		if (existing) {
			existing.addEventListener('load', () => resolve());
			existing.addEventListener('error', () => reject(new Error('Failed to load GIS script')));
			return;
		}

		const script = document.createElement('script');
		script.src = 'https://accounts.google.com/gsi/client';
		script.async = true;
		script.defer = true;
		script.onload = () => resolve();
		script.onerror = () => reject(new Error('Failed to load GIS script'));
		document.head.appendChild(script);
	});
}

/**
 * Initialize Google OAuth2 with client ID
 */
export async function initGoogleAuth(
	clientId: string,
	callback: (response: TokenResponse) => void
): Promise<void> {
	await loadGisScript();

	if (!window.google?.accounts?.oauth2) {
		throw new Error('Google Identity Services not available');
	}

	tokenClient = window.google.accounts.oauth2.initTokenClient({
		client_id: clientId,
		scope: SCOPES,
		callback: (response) => {
			if (response.access_token) {
				currentAccessToken = response.access_token;
			}
			callback(response);
		}
	});
}

/**
 * Trigger sign-in flow (shows consent screen)
 */
export function signIn(): void {
	if (!tokenClient) {
		throw new Error('Auth not initialized. Call initGoogleAuth first.');
	}
	tokenClient.requestAccessToken();
}

/**
 * Silently refresh the token without showing consent screen.
 * Only works if the user has previously granted access.
 * If silent refresh fails, GIS may show the consent screen anyway.
 */
export function silentRefresh(): void {
	if (!tokenClient) {
		throw new Error('Auth not initialized. Call initGoogleAuth first.');
	}
	tokenClient.requestAccessToken({ prompt: '' });
}

/**
 * Sign out and revoke token
 */
export function signOut(): void {
	if (currentAccessToken && window.google?.accounts?.oauth2) {
		window.google.accounts.oauth2.revoke(currentAccessToken, () => {
			currentAccessToken = null;
		});
	}
	currentAccessToken = null;
}

/**
 * Check if GIS is initialized
 */
export function isInitialized(): boolean {
	return tokenClient !== null;
}
