import { describe, it, expect } from 'vitest';
import { formatRelativeTime } from '$lib/utils/time';

describe('formatRelativeTime', () => {
	it('returns "just now" for less than 60 seconds ago', () => {
		expect(formatRelativeTime(Date.now() - 30_000)).toBe('just now');
		expect(formatRelativeTime(Date.now() - 1_000)).toBe('just now');
	});

	it('returns "1 minute ago" for 60-119 seconds', () => {
		expect(formatRelativeTime(Date.now() - 60_000)).toBe('1 minute ago');
		expect(formatRelativeTime(Date.now() - 90_000)).toBe('1 minute ago');
	});

	it('returns "N minutes ago" for < 60 minutes', () => {
		expect(formatRelativeTime(Date.now() - 5 * 60_000)).toBe('5 minutes ago');
		expect(formatRelativeTime(Date.now() - 30 * 60_000)).toBe('30 minutes ago');
	});

	it('returns "1 hour ago" for 60-119 minutes', () => {
		expect(formatRelativeTime(Date.now() - 60 * 60_000)).toBe('1 hour ago');
		expect(formatRelativeTime(Date.now() - 90 * 60_000)).toBe('1 hour ago');
	});

	it('returns "N hours ago" for < 24 hours', () => {
		expect(formatRelativeTime(Date.now() - 3 * 3600_000)).toBe('3 hours ago');
		expect(formatRelativeTime(Date.now() - 23 * 3600_000)).toBe('23 hours ago');
	});

	it('returns "yesterday" for 24-48 hours', () => {
		expect(formatRelativeTime(Date.now() - 24 * 3600_000)).toBe('yesterday');
		expect(formatRelativeTime(Date.now() - 36 * 3600_000)).toBe('yesterday');
	});

	it('returns "N days ago" for < 30 days', () => {
		expect(formatRelativeTime(Date.now() - 3 * 86400_000)).toBe('3 days ago');
		expect(formatRelativeTime(Date.now() - 29 * 86400_000)).toBe('29 days ago');
	});

	it('returns formatted date for > 30 days', () => {
		const oldDate = new Date(2024, 0, 15); // Jan 15, 2024
		const result = formatRelativeTime(oldDate.getTime());
		// Should contain month and day at minimum
		expect(result).toMatch(/Jan\s+15,?\s+2024/);
	});
});
