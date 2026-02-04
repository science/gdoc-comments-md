/**
 * Google Docs API service
 */

import type { GoogleDocsDocument } from '$lib/types/google';

const DOCS_API_BASE = 'https://docs.googleapis.com/v1/documents';

/**
 * Fetch a Google Docs document by ID
 */
export async function fetchDocument(
	documentId: string,
	accessToken: string
): Promise<GoogleDocsDocument> {
	const response = await fetch(`${DOCS_API_BASE}/${documentId}`, {
		headers: {
			Authorization: `Bearer ${accessToken}`
		}
	});

	if (!response.ok) {
		const error = await response.json().catch(() => ({}));
		throw new Error(
			error.error?.message || `Failed to fetch document: HTTP ${response.status}`
		);
	}

	return response.json();
}
