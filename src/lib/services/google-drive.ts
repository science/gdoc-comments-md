/**
 * Google Drive API metadata service.
 *
 * Used as a lightweight preflight to confirm a document ID refers to a
 * native Google Doc before we attempt to export it to .docx (the actual
 * comment-fetching pipeline lives in docx-adapter.ts).
 */

import type { DriveFileMetadata } from '$lib/types/google';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3/files';

export const NATIVE_GOOGLE_DOC_MIME_TYPE = 'application/vnd.google-apps.document';

const NON_NATIVE_MIME_NAMES: Record<string, string> = {
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
		'Microsoft Word document (.docx)',
	'application/msword': 'Microsoft Word document (.doc)',
	'application/pdf': 'PDF',
	'application/vnd.oasis.opendocument.text': 'OpenDocument Text (.odt)',
	'application/rtf': 'Rich Text Format (.rtf)',
	'text/plain': 'plain text file',
	'text/markdown': 'Markdown file',
	'text/html': 'HTML file',
	'application/vnd.google-apps.spreadsheet': 'Google Sheet',
	'application/vnd.google-apps.presentation': 'Google Slides presentation',
	'application/vnd.google-apps.folder': 'Google Drive folder',
	'application/vnd.google-apps.form': 'Google Form',
	'application/vnd.google-apps.drawing': 'Google Drawing'
};

export function isNativeGoogleDoc(mimeType: string): boolean {
	return mimeType === NATIVE_GOOGLE_DOC_MIME_TYPE;
}

export function describeNonNativeFile(metadata: DriveFileMetadata): string {
	const friendly = NON_NATIVE_MIME_NAMES[metadata.mimeType];
	const description = friendly
		? `"${metadata.name}" is a ${friendly}, not a native Google Doc.`
		: `"${metadata.name}" has MIME type ${metadata.mimeType} and is not a native Google Doc.`;
	return (
		`${description} The Google Docs API can only read native Google Docs. ` +
		`To fix: open the file in Google Drive and choose File → Save as Google Docs, ` +
		`then try the new document's URL.`
	);
}

/**
 * Fetch lightweight metadata (name + mimeType) for a Drive file.
 * Used as a preflight to produce clearer errors for non-native docs.
 */
export async function fetchFileMetadata(
	documentId: string,
	accessToken: string
): Promise<DriveFileMetadata> {
	const url = new URL(`${DRIVE_API_BASE}/${documentId}`);
	url.searchParams.set('fields', 'id,name,mimeType');

	const response = await fetch(url.toString(), {
		headers: {
			Authorization: `Bearer ${accessToken}`
		}
	});

	if (!response.ok) {
		const error = await response.json().catch(() => ({}));
		throw new Error(
			error.error?.message || `Failed to fetch file metadata: HTTP ${response.status}`
		);
	}

	return response.json();
}
