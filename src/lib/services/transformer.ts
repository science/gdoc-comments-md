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
	TextStyle,
	StructuralElement
} from '$lib/types/google';
import { estimatePages, truncateByPageRange } from '$lib/utils/pagination';

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

	// Apply formatting - order matters (inner → outer): ~~ → _ → **
	if (style.strikethrough) {
		text = `~~${text}~~`;
	}
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
 * Insert anchor markers into text for commented sections.
 *
 * Each thread claims a single non-overlapping position in the original text
 * (longer quotedText wins first so an "x y" thread beats an "x" thread at
 * the same start). A shorter thread whose first occurrence would nest
 * inside an earlier claim falls through to the next occurrence; if none
 * exists the thread returns nothing here and lands in the trailing
 * `## Unanchored comments` section instead. This guarantees the output
 * never produces nested `[[text]^[cA]]^[cB]` artifacts — which the regex
 * implementation could otherwise emit when two threads' quotedTexts
 * overlapped the same region of text.
 *
 * @returns `{ text, anchored }` where `anchored` is the subset of input
 *   thread ids that actually got an inline anchor. The caller uses it to
 *   decide whether a given thread contributes a trailing blockquote or
 *   falls through to the unanchored section.
 */
function insertAnchors(
	text: string,
	threads: CommentThread[]
): { text: string; anchored: Set<string> } {
	interface Claim {
		start: number;
		end: number;
		anchorId: string;
	}

	// Process longer quotedTexts first so that at contested positions the
	// longer one wins. `sort` is stable in modern JS, preserving the
	// original thread order for equal-length quotes.
	const sorted = [...threads].sort(
		(a, b) => b.quotedText.length - a.quotedText.length
	);

	const claims: Claim[] = [];
	const anchored = new Set<string>();

	for (const thread of sorted) {
		const q = thread.quotedText;
		if (!q) continue;

		let searchFrom = 0;
		while (true) {
			const pos = text.indexOf(q, searchFrom);
			if (pos === -1) break; // no more occurrences
			const end = pos + q.length;

			const overlap = claims.find((c) => pos < c.end && end > c.start);
			if (!overlap) {
				claims.push({ start: pos, end, anchorId: thread.anchorId });
				anchored.add(thread.id);
				break;
			}
			// Skip past the overlapping claim and try again.
			searchFrom = overlap.end;
		}
	}

	if (claims.length === 0) return { text, anchored };

	claims.sort((a, b) => a.start - b.start);
	let out = '';
	let cursor = 0;
	for (const claim of claims) {
		out += text.slice(cursor, claim.start);
		out += `[${text.slice(claim.start, claim.end)}]^[${claim.anchorId}]`;
		cursor = claim.end;
	}
	out += text.slice(cursor);
	return { text: out, anchored };
}

/**
 * Renumber threads sequentially by their first appearance in the document.
 * Threads are ordered by which paragraph they first match (document position),
 * not by their API/creation order.
 */
function renumberByDocumentOrder(
	doc: GoogleDocsDocument,
	threads: CommentThread[]
): CommentThread[] {
	const seen = new Set<string>();
	const ordered: CommentThread[] = [];

	for (let i = 0; i < doc.body.content.length; i++) {
		const element = doc.body.content[i];
		if (!element.paragraph) continue;
		const rawText = extractTextContent(element.paragraph.elements);
		const textContent = rawText.replace(/\n$/, '');
		if (!textContent.trim()) continue;

		for (const thread of threads) {
			if (seen.has(thread.id)) continue;
			if (!thread.quotedText) continue;
			if (threadMatchesParagraph(thread, i, textContent)) {
				seen.add(thread.id);
				ordered.push(thread);
			}
		}
	}

	// Include any threads that didn't match any paragraph (e.g. no quotedText,
	// or their anchorParaIndex points outside the current body — which can
	// happen after page-range filtering).
	for (const thread of threads) {
		if (!seen.has(thread.id)) {
			ordered.push(thread);
		}
	}

	return ordered.map((thread, index) => ({
		...thread,
		anchorId: `c${index + 1}`
	}));
}

/**
 * Decide whether a thread belongs to the paragraph at `paragraphIndex`.
 *
 * When the adapter has recorded the thread's originating paragraph via
 * `anchorParaIndex`, that is authoritative — a thread only matches its one
 * true paragraph and nowhere else, even if its `quotedText` happens to
 * appear as a substring earlier in the doc. When `anchorParaIndex` is
 * absent (unit tests, old cached history entries), fall back to the
 * historical substring-includes heuristic.
 */
function threadMatchesParagraph(
	thread: CommentThread,
	paragraphIndex: number,
	paragraphText: string
): boolean {
	if (thread.anchorParaIndex !== undefined) {
		if (thread.anchorParaIndex !== paragraphIndex) return false;
		// Guard against a vanishing quote: if the paragraph text no longer
		// contains our quotedText (e.g. style markup inserted a separator),
		// the insertAnchors pass will simply fail to place it and the thread
		// falls to the unanchored section — which is the intended behavior.
		return paragraphText.includes(thread.quotedText);
	}
	return paragraphText.includes(thread.quotedText);
}

/**
 * Transform Google Docs document and comments to markdown
 */
export function transformToMarkdown(
	doc: GoogleDocsDocument,
	threads: CommentThread[]
): string {
	// Renumber threads by document position order
	const orderedThreads = renumberByDocumentOrder(doc, threads);
	const matchedThreadIds = new Set<string>();

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

	for (let elementIndex = 0; elementIndex < doc.body.content.length; elementIndex++) {
		const element = doc.body.content[elementIndex];
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

		// Candidate threads: belong to THIS paragraph (by recorded
		// anchorParaIndex where available, substring fallback otherwise) AND
		// haven't already been attached elsewhere.
		const candidateThreads = orderedThreads.filter(
			(thread) =>
				!matchedThreadIds.has(thread.id) &&
				thread.quotedText &&
				threadMatchesParagraph(thread, elementIndex, textContent)
		);

		// insertAnchors resolves overlapping / contested positions and reports
		// which threads actually got an inline anchor. Only those are
		// considered matched here; unclaimed candidates fall through to the
		// trailing "## Unanchored comments" section so the reader still sees
		// them instead of losing them to a silent stack.
		let anchored = new Set<string>();
		if (candidateThreads.length > 0) {
			const result = insertAnchors(line, candidateThreads);
			line = result.text;
			anchored = result.anchored;
		}
		for (const id of anchored) matchedThreadIds.add(id);

		const placedThreads = candidateThreads.filter((t) => anchored.has(t.id));

		// Add blank line before non-list paragraphs (standard markdown spacing)
		if (!isList && prevWasList) {
			lines.push('');
		}

		lines.push(line.trimEnd());

		// Regular paragraphs get followed by a blank line
		if (!isList) {
			// Add comment threads after the paragraph
			if (placedThreads.length > 0) {
				lines.push('');
				for (const thread of placedThreads) {
					lines.push(formatCommentThread(thread));
				}
			}

			lines.push('');
		} else if (placedThreads.length > 0) {
			// Comments on list items: add after the item
			lines.push('');
			for (const thread of placedThreads) {
				lines.push(formatCommentThread(thread));
			}
		}

		prevWasList = isList;
	}

	// Append any threads that never matched a paragraph into a trailing
	// "## Unanchored comments" section. This is a defensive safety net: when
	// quotedText is missing (point comments, deleted anchors) or the range
	// captured in OOXML doesn't line up with any emitted paragraph, the
	// comment would otherwise be silently dropped. Keeping it visible in a
	// dedicated section makes the failure loud enough to diagnose.
	const unanchored = orderedThreads.filter((thread) => !matchedThreadIds.has(thread.id));
	if (unanchored.length > 0) {
		lines.push('');
		lines.push('## Unanchored comments');
		lines.push('');
		for (const thread of unanchored) {
			lines.push(formatCommentThread(thread));
			lines.push('');
		}
	}

	// Clean up trailing blank lines and excess whitespace
	let result = lines.join('\n');
	result = result.replace(/\n{3,}/g, '\n\n');
	result = result.trimEnd() + '\n';

	return result;
}

export interface TransformOptions {
	startPage?: number;
	pageCount?: number;
	charsPerPage?: number;
}

export interface TransformResult {
	markdown: string;
	totalPages: number;
	pageRange: { start: number; end: number } | null;
	commentCount: number;
}

/**
 * Transform with optional page-range filtering.
 * When startPage > 1 or pageCount is set, filters elements and comments
 * to the requested page range and renumbers comment anchors sequentially.
 */
export function transformWithPageFilter(
	doc: GoogleDocsDocument,
	threads: CommentThread[],
	options?: TransformOptions
): TransformResult {
	const isFiltering = options && (
		(options.startPage !== undefined && options.startPage > 1) ||
		options.pageCount !== undefined
	);

	if (!isFiltering) {
		// No filtering — estimate pages for metadata but render the full doc.
		const totalPages = estimatePages(doc.body.content, options?.charsPerPage).length;
		return {
			markdown: transformToMarkdown(doc, threads),
			totalPages,
			pageRange: null,
			commentCount: threads.filter((t) => t.quotedText).length
		};
	}

	// Truncate the parsed doc + threads to the requested page range *before*
	// rendering. Threads whose anchor is outside the kept slice are dropped
	// outright — there is no substring-rescue path that could leak them onto
	// an earlier heading.
	const truncated = truncateByPageRange(
		doc,
		threads,
		options.startPage ?? 1,
		options.pageCount,
		options.charsPerPage
	);

	return {
		markdown: transformToMarkdown(truncated.doc, truncated.threads),
		totalPages: truncated.totalPages,
		pageRange: truncated.pageRange,
		commentCount: truncated.threads.length
	};
}

