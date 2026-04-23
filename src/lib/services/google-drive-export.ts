/**
 * Google Drive export service.
 *
 * Exports a native Google Doc as OOXML (.docx). The Drive API export endpoint
 * returns a fully round-tripped Word document that preserves comment anchor
 * ranges (`<w:commentRangeStart/>` / `<w:commentRangeEnd/>` markers) which
 * the Docs API does not expose — that is why this path exists.
 */

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3/files';

const DOCX_MIME_TYPE =
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export async function exportDocx(
	documentId: string,
	accessToken: string
): Promise<ArrayBuffer> {
	const url = new URL(`${DRIVE_API_BASE}/${documentId}/export`);
	url.searchParams.set('mimeType', DOCX_MIME_TYPE);

	const response = await fetch(url.toString(), {
		headers: {
			Authorization: `Bearer ${accessToken}`
		}
	});

	if (!response.ok) {
		const error = await response.json().catch(() => ({}));
		throw new Error(
			error.error?.message || `Failed to export document: HTTP ${response.status}`
		);
	}

	return response.arrayBuffer();
}
