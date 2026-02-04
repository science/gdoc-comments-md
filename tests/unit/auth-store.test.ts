import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock localStorage before importing the store
const localStorageMock = (() => {
	let store: Record<string, string> = {};
	return {
		getItem: vi.fn((key: string) => store[key] ?? null),
		setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
		removeItem: vi.fn((key: string) => { delete store[key]; }),
		clear: vi.fn(() => { store = {}; })
	};
})();

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

// Import after mocking localStorage
const { setAuth, clearAuth, restoreAuth, getAuthState, isTokenExpired, getAccessToken } = await import('$lib/stores/auth.svelte');

describe('auth store', () => {
	beforeEach(() => {
		clearAuth();
		localStorageMock.clear();
		vi.clearAllMocks();
	});

	describe('setAuth', () => {
		it('sets authenticated state', () => {
			setAuth('token123', { email: 'a@b.com', name: 'Alice' });
			const state = getAuthState();
			expect(state.isAuthenticated).toBe(true);
			expect(state.accessToken).toBe('token123');
			expect(state.user?.email).toBe('a@b.com');
			expect(state.user?.name).toBe('Alice');
		});

		it('persists to localStorage', () => {
			setAuth('token123', { email: 'a@b.com', name: 'Alice' }, 3600);
			expect(localStorageMock.setItem).toHaveBeenCalledWith(
				'gdoc_auth',
				expect.stringContaining('token123')
			);
		});

		it('stores expiry based on expires_in', () => {
			const before = Date.now();
			setAuth('tok', { email: 'a@b.com', name: 'A' }, 7200);

			const stored = JSON.parse(localStorageMock.setItem.mock.calls[0][1]);
			// expiresAt should be ~7200s from now
			expect(stored.expiresAt).toBeGreaterThanOrEqual(before + 7200 * 1000 - 100);
			expect(stored.expiresAt).toBeLessThanOrEqual(before + 7200 * 1000 + 1000);
		});

		it('defaults to 3600s expiry when not provided', () => {
			const before = Date.now();
			setAuth('tok', { email: 'a@b.com', name: 'A' });

			const stored = JSON.parse(localStorageMock.setItem.mock.calls[0][1]);
			expect(stored.expiresAt).toBeGreaterThanOrEqual(before + 3600 * 1000 - 100);
			expect(stored.expiresAt).toBeLessThanOrEqual(before + 3600 * 1000 + 1000);
		});
	});

	describe('clearAuth', () => {
		it('clears state', () => {
			setAuth('token123', { email: 'a@b.com', name: 'Alice' });
			clearAuth();
			const state = getAuthState();
			expect(state.isAuthenticated).toBe(false);
			expect(state.accessToken).toBeNull();
			expect(state.user).toBeNull();
		});

		it('removes from localStorage', () => {
			setAuth('token123', { email: 'a@b.com', name: 'Alice' });
			clearAuth();
			expect(localStorageMock.removeItem).toHaveBeenCalledWith('gdoc_auth');
		});
	});

	describe('restoreAuth', () => {
		it('restores valid session from localStorage', () => {
			const stored = {
				accessToken: 'restored-token',
				user: { email: 'b@c.com', name: 'Bob' },
				expiresAt: Date.now() + 3600_000
			};
			localStorageMock.getItem.mockReturnValueOnce(JSON.stringify(stored));

			const result = restoreAuth();
			expect(result).toBe(true);

			const state = getAuthState();
			expect(state.isAuthenticated).toBe(true);
			expect(state.accessToken).toBe('restored-token');
			expect(state.user?.name).toBe('Bob');
		});

		it('returns false when nothing stored', () => {
			localStorageMock.getItem.mockReturnValueOnce(null as unknown as string);
			expect(restoreAuth()).toBe(false);
		});

		it('returns false and cleans up expired token', () => {
			const stored = {
				accessToken: 'old-token',
				user: { email: 'b@c.com', name: 'Bob' },
				expiresAt: Date.now() - 1000 // already expired
			};
			localStorageMock.getItem.mockReturnValueOnce(JSON.stringify(stored));

			const result = restoreAuth();
			expect(result).toBe(false);
			expect(localStorageMock.removeItem).toHaveBeenCalledWith('gdoc_auth');
		});

		it('returns false for token expiring within 60 seconds', () => {
			const stored = {
				accessToken: 'almost-expired',
				user: { email: 'b@c.com', name: 'Bob' },
				expiresAt: Date.now() + 30_000 // 30s left, within 60s buffer
			};
			localStorageMock.getItem.mockReturnValueOnce(JSON.stringify(stored));

			expect(restoreAuth()).toBe(false);
		});

		it('returns false for corrupt data', () => {
			localStorageMock.getItem.mockReturnValueOnce('not-json');
			expect(restoreAuth()).toBe(false);
		});
	});

	describe('isTokenExpired', () => {
		it('returns true when no token set', () => {
			expect(isTokenExpired()).toBe(true);
		});

		it('returns false for fresh token', () => {
			setAuth('tok', { email: 'a@b.com', name: 'A' }, 3600);
			expect(isTokenExpired()).toBe(false);
		});
	});

	describe('getAccessToken', () => {
		it('returns null when not authenticated', () => {
			expect(getAccessToken()).toBeNull();
		});

		it('returns token when authenticated', () => {
			setAuth('my-token', { email: 'a@b.com', name: 'A' });
			expect(getAccessToken()).toBe('my-token');
		});
	});
});
