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
	const allComments: DriveCommentsResponse['comments'] = [];
	let pageToken: string | undefined;

	do {
		const url = new URL(`${DRIVE_API_BASE}/${documentId}/comments`);
		url.searchParams.set('fields', '*');
		url.searchParams.set('pageSize', '100');
		if (pageToken) url.searchParams.set('pageToken', pageToken);

		const response = await fetch(url.toString(), {
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

		const data: DriveCommentsResponse = await response.json();
		allComments.push(...(data.comments || []));
		pageToken = data.nextPageToken;
	} while (pageToken);

	return { kind: 'drive#commentList', comments: allComments };
}
