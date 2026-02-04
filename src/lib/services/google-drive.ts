/**
 * Google Drive API service for fetching comments
 */

import type { DriveCommentsResponse } from '$lib/types/google';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3/files';

/**
 * Fetch comments for a Google Doc
 * Uses the Drive API since Docs API doesn't expose comments
 */
export async function fetchComments(
	documentId: string,
	accessToken: string
): Promise<DriveCommentsResponse> {
	const url = `${DRIVE_API_BASE}/${documentId}/comments?fields=*`;

	const response = await fetch(url, {
		headers: {
			Authorization: `Bearer ${accessToken}`
		}
	});

	if (!response.ok) {
		const error = await response.json().catch(() => ({}));
		throw new Error(
			error.error?.message || `Failed to fetch comments: HTTP ${response.status}`
		);
	}

	return response.json();
}
