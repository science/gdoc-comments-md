import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	fetchFileMetadata,
	isNativeGoogleDoc,
	describeNonNativeFile,
	NATIVE_GOOGLE_DOC_MIME_TYPE
} from '$lib/services/google-drive';

describe('NATIVE_GOOGLE_DOC_MIME_TYPE', () => {
	it('is the canonical Google Docs MIME type', () => {
		expect(NATIVE_GOOGLE_DOC_MIME_TYPE).toBe('application/vnd.google-apps.document');
	});
});

describe('isNativeGoogleDoc', () => {
	it('returns true for native Google Docs mime type', () => {
		expect(isNativeGoogleDoc('application/vnd.google-apps.document')).toBe(true);
	});

	it('returns false for .docx', () => {
		expect(
			isNativeGoogleDoc(
				'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
			)
		).toBe(false);
	});

	it('returns false for legacy .doc', () => {
		expect(isNativeGoogleDoc('application/msword')).toBe(false);
	});

	it('returns false for PDF', () => {
		expect(isNativeGoogleDoc('application/pdf')).toBe(false);
	});

	it('returns false for Google Sheet', () => {
		expect(isNativeGoogleDoc('application/vnd.google-apps.spreadsheet')).toBe(false);
	});

	it('returns false for empty string', () => {
		expect(isNativeGoogleDoc('')).toBe(false);
	});
});

describe('describeNonNativeFile', () => {
	it('identifies Microsoft Word .docx and names the file', () => {
		const msg = describeNonNativeFile({
			id: 'abc',
			name: 'My Proposal',
			mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
		});
		expect(msg).toMatch(/Microsoft Word/i);
		expect(msg).toContain('My Proposal');
		expect(msg).toMatch(/Save as Google Docs/i);
	});

	it('identifies legacy .doc', () => {
		const msg = describeNonNativeFile({
			id: 'abc',
			name: 'old.doc',
			mimeType: 'application/msword'
		});
		expect(msg).toMatch(/Microsoft Word/i);
	});

	it('identifies PDF', () => {
		const msg = describeNonNativeFile({
			id: 'abc',
			name: 'report.pdf',
			mimeType: 'application/pdf'
		});
		expect(msg).toMatch(/PDF/);
		expect(msg).toContain('report.pdf');
	});

	it('identifies Google Sheets', () => {
		const msg = describeNonNativeFile({
			id: 'abc',
			name: 'budget',
			mimeType: 'application/vnd.google-apps.spreadsheet'
		});
		expect(msg).toMatch(/Google Sheet/i);
	});

	it('identifies Google Slides', () => {
		const msg = describeNonNativeFile({
			id: 'abc',
			name: 'deck',
			mimeType: 'application/vnd.google-apps.presentation'
		});
		expect(msg).toMatch(/Google Slides/i);
	});

	it('identifies OpenDocument Text', () => {
		const msg = describeNonNativeFile({
			id: 'abc',
			name: 'essay.odt',
			mimeType: 'application/vnd.oasis.opendocument.text'
		});
		expect(msg).toMatch(/OpenDocument/i);
	});

	it('falls back to mime type for unknown types', () => {
		const msg = describeNonNativeFile({
			id: 'abc',
			name: 'unknown',
			mimeType: 'application/x-weird-type'
		});
		expect(msg).toContain('application/x-weird-type');
		expect(msg).toMatch(/not a native Google Doc/i);
	});

	it('always includes conversion guidance', () => {
		const msg = describeNonNativeFile({
			id: 'abc',
			name: 'doc',
			mimeType: 'application/pdf'
		});
		expect(msg).toMatch(/File.*Save as Google Docs/i);
	});
});

describe('fetchFileMetadata', () => {
	let fetchMock: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		fetchMock = vi.spyOn(globalThis, 'fetch');
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('fetches metadata for a file via Drive API', async () => {
		fetchMock.mockResolvedValue(
			new Response(
				JSON.stringify({
					id: 'abc',
					name: 'My Doc',
					mimeType: 'application/vnd.google-apps.document'
				}),
				{ status: 200 }
			)
		);

		const result = await fetchFileMetadata('abc', 'token123');
		expect(result).toEqual({
			id: 'abc',
			name: 'My Doc',
			mimeType: 'application/vnd.google-apps.document'
		});
	});

	it('requests the id, name, and mimeType fields', async () => {
		fetchMock.mockResolvedValue(
			new Response(
				JSON.stringify({ id: 'abc', name: 'n', mimeType: 'application/pdf' }),
				{ status: 200 }
			)
		);

		await fetchFileMetadata('abc', 'token123');

		const url = fetchMock.mock.calls[0][0] as string;
		expect(url).toContain('/drive/v3/files/abc');
		expect(url).toMatch(/fields=[^&]*mimeType/);
		expect(url).toMatch(/fields=[^&]*name/);
	});

	it('sends the bearer token', async () => {
		fetchMock.mockResolvedValue(
			new Response(
				JSON.stringify({ id: 'abc', name: 'n', mimeType: 'application/pdf' }),
				{ status: 200 }
			)
		);

		await fetchFileMetadata('abc', 'token123');

		const init = fetchMock.mock.calls[0][1] as RequestInit;
		expect(init.headers).toMatchObject({ Authorization: 'Bearer token123' });
	});

	it('throws descriptive error on API failure with error body', async () => {
		fetchMock.mockResolvedValue(
			new Response(JSON.stringify({ error: { message: 'File not found' } }), {
				status: 404
			})
		);

		await expect(fetchFileMetadata('missing', 'token')).rejects.toThrow('File not found');
	});

	it('throws generic error when response body is empty', async () => {
		fetchMock.mockResolvedValue(new Response('', { status: 500 }));

		await expect(fetchFileMetadata('abc', 'token')).rejects.toThrow(/500/);
	});
});
