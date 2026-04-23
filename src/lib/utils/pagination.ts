/**
 * Page estimation and filtering for Google Docs documents.
 * Approximates page boundaries by splitting at paragraph boundaries
 * every ~3000 characters. Hard page breaks force a boundary.
 */

import type {
	StructuralElement,
	CommentThread,
	GoogleDocsDocument
} from '$lib/types/google';

export interface PageBoundary {
	pageNumber: number;
	startElementIndex: number;
	endElementIndex: number; // exclusive
	charCount: number;
}

const DEFAULT_CHARS_PER_PAGE = 3000;

/**
 * Check if a structural element contains a hard page break
 */
function hasPageBreak(element: StructuralElement): boolean {
	if (!element.paragraph) return false;
	return element.paragraph.elements.some((el) => 'pageBreak' in el);
}

/**
 * Get the character count of a structural element's text content
 */
function getElementCharCount(element: StructuralElement): number {
	if (!element.paragraph) return 0;
	return element.paragraph.elements.reduce((sum, el) => {
		if (el.textRun) return sum + el.textRun.content.length;
		return sum;
	}, 0);
}

/**
 * Estimate page boundaries from structural elements.
 * Splits at paragraph boundaries every ~charsPerPage characters.
 * Hard page breaks force a boundary regardless of character count.
 */
export function estimatePages(
	elements: StructuralElement[],
	charsPerPage: number = DEFAULT_CHARS_PER_PAGE
): PageBoundary[] {
	if (elements.length === 0) {
		return [{ pageNumber: 1, startElementIndex: 0, endElementIndex: 0, charCount: 0 }];
	}

	const pages: PageBoundary[] = [];
	let currentPageStart = 0;
	let currentCharCount = 0;
	let pageNumber = 1;

	for (let i = 0; i < elements.length; i++) {
		const element = elements[i];

		// Hard page break forces a new page
		if (hasPageBreak(element)) {
			// Close current page (don't include the page break element itself)
			if (currentPageStart < i || currentCharCount > 0) {
				pages.push({
					pageNumber,
					startElementIndex: currentPageStart,
					endElementIndex: i,
					charCount: currentCharCount
				});
				pageNumber++;
			}
			currentPageStart = i + 1;
			currentCharCount = 0;
			continue;
		}

		const charCount = getElementCharCount(element);
		currentCharCount += charCount;

		// Check if adding this paragraph pushed us over the limit
		// Split BEFORE this paragraph if we were already over (and this isn't the first on the page)
		if (currentCharCount > charsPerPage && i > currentPageStart) {
			// Close previous page without this element
			pages.push({
				pageNumber,
				startElementIndex: currentPageStart,
				endElementIndex: i,
				charCount: currentCharCount - charCount
			});
			pageNumber++;
			currentPageStart = i;
			currentCharCount = charCount;
		}
	}

	// Close final page
	if (currentPageStart <= elements.length - 1 || pages.length === 0) {
		pages.push({
			pageNumber,
			startElementIndex: currentPageStart,
			endElementIndex: elements.length,
			charCount: currentCharCount
		});
	}

	return pages;
}

export interface FilterResult {
	elements: StructuralElement[];
	totalPages: number;
	startPage: number;
	endPage: number;
}

/**
 * Filter structural elements to those within a page range.
 * startPage is 1-indexed. pageCount defaults to all remaining pages.
 */
export function filterByPageRange(
	elements: StructuralElement[],
	startPage: number,
	pageCount?: number,
	charsPerPage: number = DEFAULT_CHARS_PER_PAGE
): FilterResult {
	const pages = estimatePages(elements, charsPerPage);
	const totalPages = pages.length;

	// Clamp startPage
	const clampedStart = Math.min(Math.max(1, startPage), totalPages);

	// Calculate endPage
	let endPage: number;
	if (pageCount === undefined) {
		endPage = totalPages;
	} else {
		endPage = Math.min(clampedStart + pageCount - 1, totalPages);
	}

	// Gather elements from the selected pages
	const selectedPages = pages.filter(
		(p) => p.pageNumber >= clampedStart && p.pageNumber <= endPage
	);

	const filteredElements: StructuralElement[] = [];
	for (const page of selectedPages) {
		for (let i = page.startElementIndex; i < page.endElementIndex; i++) {
			filteredElements.push(elements[i]);
		}
	}

	return {
		elements: filteredElements,
		totalPages,
		startPage: clampedStart,
		endPage
	};
}

/**
 * Extract all text content from structural elements
 */
function extractAllText(elements: StructuralElement[]): string {
	return elements
		.map((el) => {
			if (!el.paragraph) return '';
			return el.paragraph.elements
				.map((pe) => pe.textRun?.content || '')
				.join('');
		})
		.join('');
}

export interface TruncateResult {
	doc: GoogleDocsDocument;
	threads: CommentThread[];
	totalPages: number;
	pageRange: { start: number; end: number };
}

/**
 * Truncate a parsed document to the requested page range.
 *
 * Returns a new `doc` with `body.content` sliced to the kept paragraphs and
 * a `threads` array containing only the threads whose anchor lies inside
 * the kept slice (with `anchorParaIndex` remapped to the new 0-based index).
 *
 * Threads whose `anchorParaIndex` is **outside** the kept slice are
 * dropped entirely — never rehomed onto an earlier paragraph by substring
 * fallback. This is the "nuked from orbit" property: after truncation,
 * every remaining thread's anchor corresponds to an actual kept
 * paragraph, so there is no mechanism that could leak an out-of-range
 * comment onto the title or a heading.
 *
 * Legacy threads without `anchorParaIndex` (synthetic test inputs,
 * pre-adapter callers) keep the historical substring-membership behavior
 * — this never triggers for adapter-sourced threads since the adapter
 * always populates the field.
 */
export function truncateByPageRange(
	doc: GoogleDocsDocument,
	threads: CommentThread[],
	startPage: number,
	pageCount: number | undefined,
	charsPerPage: number = DEFAULT_CHARS_PER_PAGE
): TruncateResult {
	const { elements, totalPages, startPage: actualStart, endPage } = filterByPageRange(
		doc.body.content,
		startPage,
		pageCount,
		charsPerPage
	);

	// Map original element index → kept-slice index by reference identity.
	// `filterByPageRange` returns references copied from `doc.body.content`,
	// so identity comparison is safe and cheap.
	const originalIndexByElement = new Map<StructuralElement, number>();
	for (let i = 0; i < doc.body.content.length; i++) {
		originalIndexByElement.set(doc.body.content[i], i);
	}
	const remappedIndexByOriginal = new Map<number, number>();
	for (let i = 0; i < elements.length; i++) {
		const orig = originalIndexByElement.get(elements[i]);
		if (orig !== undefined) remappedIndexByOriginal.set(orig, i);
	}

	const keptText = extractAllText(elements);

	const kept = threads.filter((thread) => {
		if (!thread.quotedText) return false;
		if (thread.anchorParaIndex !== undefined) {
			return remappedIndexByOriginal.has(thread.anchorParaIndex);
		}
		// Legacy: no paraIndex → fall back to substring membership.
		return keptText.includes(thread.quotedText);
	});

	const remapped = kept.map((thread, index) => {
		const base: CommentThread = {
			...thread,
			anchorId: `c${index + 1}`
		};
		if (thread.anchorParaIndex !== undefined) {
			base.anchorParaIndex = remappedIndexByOriginal.get(thread.anchorParaIndex)!;
		}
		return base;
	});

	return {
		doc: { ...doc, body: { content: elements } },
		threads: remapped,
		totalPages,
		pageRange: { start: actualStart, end: endPage }
	};
}
