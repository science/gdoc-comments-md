import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { exportDocx } from '$lib/services/google-drive-export';

describe('exportDocx', () => {
	let fetchMock: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		fetchMock = vi.spyOn(globalThis, 'fetch');
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('returns an ArrayBuffer of the .docx export', async () => {
		const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]); // PK\x03\x04 zip magic
		fetchMock.mockResolvedValue(new Response(bytes, { status: 200 }));

		const result = await exportDocx('docId', 'token123');
		expect(result).toBeInstanceOf(ArrayBuffer);
		expect(new Uint8Array(result)).toEqual(bytes);
	});

	it('targets the Drive export endpoint with the .docx MIME type', async () => {
		fetchMock.mockResolvedValue(new Response(new Uint8Array([0]), { status: 200 }));

		await exportDocx('abc123', 'token');

		const url = fetchMock.mock.calls[0][0] as string;
		expect(url).toContain('/drive/v3/files/abc123/export');
		expect(decodeURIComponent(url)).toContain(
			'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
		);
	});

	it('sends the bearer token', async () => {
		fetchMock.mockResolvedValue(new Response(new Uint8Array([0]), { status: 200 }));

		await exportDocx('docId', 'token-xyz');

		const init = fetchMock.mock.calls[0][1] as RequestInit;
		expect(init.headers).toMatchObject({ Authorization: 'Bearer token-xyz' });
	});

	it('throws a descriptive error when the API returns an error body', async () => {
		fetchMock.mockResolvedValue(
			new Response(JSON.stringify({ error: { message: 'Export quota exceeded' } }), {
				status: 403
			})
		);

		await expect(exportDocx('docId', 'token')).rejects.toThrow('Export quota exceeded');
	});

	it('throws a generic error when the response body is empty', async () => {
		fetchMock.mockResolvedValue(new Response('', { status: 500 }));

		await expect(exportDocx('docId', 'token')).rejects.toThrow(/500/);
	});
});
