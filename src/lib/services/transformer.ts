/**
 * Transforms Google Docs content and comments into markdown
 * Output format follows DESIGN.md specification
 *
 * Heading/list conversion logic adapted from docs-markdown
 * (https://github.com/AnandChowdhary/docs-markdown, MIT license)
 */

import type {
	GoogleDocsDocument,
	Paragraph,
	ParagraphElement,
	CommentThread,
	TextStyle
} from '$lib/types/google';

/** Map Google Docs heading styles to markdown prefix */
const HEADING_MAP: Record<string, string> = {
	TITLE: '# ',
	SUBTITLE: '',      // rendered as italic
	HEADING_1: '## ',
	HEADING_2: '### ',
	HEADING_3: '#### ',
	HEADING_4: '##### ',
	HEADING_5: '###### ',
};

/**
 * Extract text content from paragraph elements with markdown formatting
 */
export function extractTextContent(elements: ParagraphElement[]): string {
	return elements
		.map((element) => {
			if (!element.textRun) return '';

			let text = element.textRun.content;
			const style = element.textRun.textStyle;

			if (style) {
				text = applyTextStyle(text, style);
			}

			return text;
		})
		.join('');
}

/**
 * Apply markdown formatting based on text style
 */
function applyTextStyle(text: string, style: TextStyle): string {
	// Handle links first (they may also have other styles)
	if (style.link?.url) {
		text = `[${text}](${style.link.url})`;
		return text;
	}

	// Apply formatting - order matters: bold wraps italic
	if (style.italic) {
		text = `_${text}_`;
	}
	if (style.bold) {
		text = `**${text}**`;
	}

	return text;
}

/**
 * Determine list prefix for a paragraph with a bullet
 */
function getListPrefix(
	paragraph: Paragraph,
	doc: GoogleDocsDocument
): string {
	const bullet = paragraph.bullet;
	if (!bullet) return '';

	const nestingLevel = bullet.nestingLevel || 0;
	const padding = '  '.repeat(nestingLevel);

	// Look up ordered vs unordered from the doc's lists metadata
	const listDetails = doc.lists?.[bullet.listId];
	const levels = listDetails?.listProperties?.nestingLevels || [];
	const glyphFormat = levels[nestingLevel]?.glyphFormat || '';

	// Ordered lists use formats like "%0." or "[%0]"
	const isOrdered = glyphFormat.includes('%') &&
		(glyphFormat.includes('.') || glyphFormat.startsWith('['));

	return isOrdered ? `${padding}1. ` : `${padding}- `;
}

/**
 * Format a comment thread as a blockquote
 */
export function formatCommentThread(thread: CommentThread): string {
	const anchorLabel = thread.resolved ? `${thread.anchorId} resolved` : thread.anchorId;

	return thread.comments
		.map((comment) => {
			const header = `> [${anchorLabel}] **${comment.authorName}** (${comment.authorEmail}):`;
			const content = comment.content
				.split('\n')
				.map((line) => `> ${line}`)
				.join('\n');
			return `${header}\n${content}`;
		})
		.join('\n>\n');
}

/**
 * Insert anchor markers into text for commented sections
 */
function insertAnchors(text: string, threads: CommentThread[]): string {
	let result = text;

	// Sort threads by quoted text length (longest first) to avoid partial matches
	const sortedThreads = [...threads].sort(
		(a, b) => b.quotedText.length - a.quotedText.length
	);

	for (const thread of sortedThreads) {
		if (!thread.quotedText) continue;

		// Escape special regex characters in quoted text
		const escaped = thread.quotedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const regex = new RegExp(escaped, 'g');

		// Only replace first occurrence to handle repeated text
		let replaced = false;
		result = result.replace(regex, (match) => {
			if (replaced) return match;
			replaced = true;
			return `[${match}]^[${thread.anchorId}]`;
		});
	}

	return result;
}

/**
 * Transform Google Docs document and comments to markdown
 */
export function transformToMarkdown(
	doc: GoogleDocsDocument,
	threads: CommentThread[]
): string {
	const lines: string[] = [];

	// Check if any paragraph has TITLE style - if so, don't add doc.title separately
	const hasTitleParagraph = doc.body.content.some(
		(el) => el.paragraph?.paragraphStyle?.namedStyleType === 'TITLE'
	);

	if (!hasTitleParagraph) {
		lines.push(`# ${doc.title}`);
		lines.push('');
	}

	let prevWasList = false;

	for (const element of doc.body.content) {
		if (!element.paragraph) continue;

		const paragraph = element.paragraph;
		const styleType = paragraph.paragraphStyle?.namedStyleType;
		const isList = !!paragraph.bullet;
		const rawText = extractTextContent(paragraph.elements);

		// Skip empty paragraphs (just newlines)
		if (!rawText.trim()) {
			if (prevWasList) {
				// Don't add blank line inside list
			} else {
				lines.push('');
			}
			prevWasList = false;
			continue;
		}

		const textContent = rawText.replace(/\n$/, '');

		// Build the line with heading/list prefix
		let line: string;

		if (isList) {
			const prefix = getListPrefix(paragraph, doc);
			line = `${prefix}${textContent}`;

			// No blank line between consecutive list items
			if (!prevWasList && lines.length > 0) {
				// Add blank line before list starts (unless at beginning)
				const lastLine = lines[lines.length - 1];
				if (lastLine !== '') {
					lines.push('');
				}
			}
		} else if (styleType === 'SUBTITLE') {
			line = `_${textContent.trim()}_`;
		} else if (styleType && HEADING_MAP[styleType]) {
			line = `${HEADING_MAP[styleType]}${textContent}`;
		} else {
			line = textContent;
		}

		// Find threads that reference text in this paragraph
		const matchingThreads = threads.filter(
			(thread) => thread.quotedText && textContent.includes(thread.quotedText)
		);

		// Insert anchor markers
		if (matchingThreads.length > 0) {
			line = insertAnchors(line, matchingThreads);
		}

		// Add blank line before non-list paragraphs (standard markdown spacing)
		if (!isList && prevWasList) {
			lines.push('');
		}

		lines.push(line.trimEnd());

		// Regular paragraphs get followed by a blank line
		if (!isList) {
			// Add comment threads after the paragraph
			if (matchingThreads.length > 0) {
				lines.push('');
				for (const thread of matchingThreads) {
					lines.push(formatCommentThread(thread));
				}
			}

			lines.push('');
		} else if (matchingThreads.length > 0) {
			// Comments on list items: add after the item
			lines.push('');
			for (const thread of matchingThreads) {
				lines.push(formatCommentThread(thread));
			}
		}

		prevWasList = isList;
	}

	// Clean up trailing blank lines and excess whitespace
	let result = lines.join('\n');
	result = result.replace(/\n{3,}/g, '\n\n');
	result = result.trimEnd() + '\n';

	return result;
}

/**
 * Convert Drive API comments to internal CommentThread format
 */
export function convertDriveComments(
	comments: Array<{
		id: string;
		content: string;
		resolved: boolean;
		quotedFileContent?: { value: string };
		author: { displayName: string; emailAddress?: string };
		replies: Array<{
			content: string;
			author: { displayName: string; emailAddress?: string };
		}>;
	}>
): CommentThread[] {
	return comments
		.filter((comment) => !comment.resolved || comment.quotedFileContent)
		.map((comment, index) => ({
			id: comment.id,
			anchorId: `c${index + 1}`,
			quotedText: comment.quotedFileContent?.value || '',
			resolved: comment.resolved,
			comments: [
				{
					authorName: comment.author.displayName,
					authorEmail: comment.author.emailAddress || '',
					content: comment.content,
					isReply: false
				},
				...comment.replies.map((reply) => ({
					authorName: reply.author.displayName,
					authorEmail: reply.author.emailAddress || '',
					content: reply.content,
					isReply: true
				}))
			]
		}));
}
