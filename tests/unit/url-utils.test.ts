import { describe, it, expect } from 'vitest';
import { extractDocumentId } from '$lib/utils/url';

describe('extractDocumentId', () => {
	it('extracts ID from full Google Docs URL', () => {
		const url = 'https://docs.google.com/document/d/1abc123XYZ_def456/edit';
		expect(extractDocumentId(url)).toBe('1abc123XYZ_def456');
	});

	it('extracts ID from URL without /edit suffix', () => {
		const url = 'https://docs.google.com/document/d/1abc123XYZ_def456';
		expect(extractDocumentId(url)).toBe('1abc123XYZ_def456');
	});

	it('extracts ID from URL with query parameters', () => {
		const url = 'https://docs.google.com/document/d/1abc123XYZ_def456/edit?usp=sharing';
		expect(extractDocumentId(url)).toBe('1abc123XYZ_def456');
	});

	it('returns plain ID when already extracted', () => {
		const id = '1abc123XYZ_def456';
		expect(extractDocumentId(id)).toBe('1abc123XYZ_def456');
	});

	it('handles IDs with hyphens', () => {
		const url = 'https://docs.google.com/document/d/1abc-123_XYZ-def456/edit';
		expect(extractDocumentId(url)).toBe('1abc-123_XYZ-def456');
	});

	it('returns null for invalid URLs', () => {
		expect(extractDocumentId('')).toBeNull();
		expect(extractDocumentId('not-a-url')).toBeNull();
		expect(extractDocumentId('https://google.com')).toBeNull();
	});

	it('handles URL with extra path segments', () => {
		const url = 'https://docs.google.com/document/d/1abc123/edit/something';
		expect(extractDocumentId(url)).toBe('1abc123');
	});
});
