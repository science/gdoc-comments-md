/**
 * Authentication state store using Svelte 5 runes
 * Persists token + user info to localStorage
 */

const STORAGE_KEY = 'gdoc_auth';

interface User {
	email: string;
	name: string;
	picture?: string;
}

interface StoredAuth {
	accessToken: string;
	user: User;
	expiresAt: number; // unix ms
}

interface AuthState {
	isAuthenticated: boolean;
	user: User | null;
	accessToken: string | null;
}

// Module-level state using runes
let isAuthenticated = $state(false);
let user = $state<User | null>(null);
let accessToken = $state<string | null>(null);
let expiresAt = $state<number>(0);

/**
 * Get reactive auth state
 */
export function getAuthState(): AuthState {
	return {
		get isAuthenticated() {
			return isAuthenticated;
		},
		get user() {
			return user;
		},
		get accessToken() {
			return accessToken;
		}
	};
}

/**
 * Set authentication after successful OAuth flow
 * GIS implicit tokens expire in ~3600 seconds
 */
export function setAuth(token: string, userInfo: User, expiresInSeconds?: number): void {
	accessToken = token;
	user = userInfo;
	isAuthenticated = true;
	expiresAt = Date.now() + (expiresInSeconds || 3600) * 1000;

	// Persist to localStorage
	try {
		const stored: StoredAuth = { accessToken: token, user: userInfo, expiresAt };
		localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
	} catch {
		// localStorage may be unavailable (private browsing, etc.)
	}
}

/**
 * Clear authentication state
 */
export function clearAuth(): void {
	accessToken = null;
	user = null;
	isAuthenticated = false;
	expiresAt = 0;

	try {
		localStorage.removeItem(STORAGE_KEY);
	} catch {
		// ignore
	}
}

/**
 * Restore auth from localStorage
 * Returns true if a valid (non-expired) session was restored
 */
export function restoreAuth(): boolean {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return false;

		const stored: StoredAuth = JSON.parse(raw);

		// Check if token is still valid (with 60s buffer)
		if (stored.expiresAt < Date.now() + 60_000) {
			localStorage.removeItem(STORAGE_KEY);
			return false;
		}

		accessToken = stored.accessToken;
		user = stored.user;
		isAuthenticated = true;
		expiresAt = stored.expiresAt;
		return true;
	} catch {
		return false;
	}
}

/**
 * Check if the stored token is expired or about to expire
 */
export function isTokenExpired(): boolean {
	return expiresAt < Date.now() + 60_000;
}

/**
 * Get current access token (for API calls)
 */
export function getAccessToken(): string | null {
	return accessToken;
}
