/**
 * Extract Google Docs document ID from URL or return ID if already extracted
 */
export function extractDocumentId(input: string): string | null {
	if (!input || typeof input !== 'string') {
		return null;
	}

	const trimmed = input.trim();
	if (!trimmed) {
		return null;
	}

	// Try to extract from Google Docs URL pattern
	const urlMatch = trimmed.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
	if (urlMatch) {
		return urlMatch[1];
	}

	// Check if it's already a valid document ID (alphanumeric with hyphens/underscores)
	if (/^[a-zA-Z0-9_-]+$/.test(trimmed) && trimmed.length > 10) {
		return trimmed;
	}

	return null;
}
