import { describe, it, expect } from 'vitest';
import { estimatePages, filterByPageRange, filterAndRenumberThreads } from '$lib/utils/pagination';
import type { StructuralElement, CommentThread } from '$lib/types/google';

// Helper to build structural elements with paragraph text
function makeElements(texts: string[]): StructuralElement[] {
	let index = 1;
	return texts.map((text) => {
		const start = index;
		const end = start + text.length;
		index = end;
		return {
			startIndex: start,
			endIndex: end,
			paragraph: {
				elements: [{ startIndex: start, endIndex: end, textRun: { content: text } }]
			}
		};
	});
}

describe('estimatePages', () => {
	it('returns a single page for an empty document', () => {
		const result = estimatePages([]);
		expect(result).toEqual([{ pageNumber: 1, startElementIndex: 0, endElementIndex: 0, charCount: 0 }]);
	});

	it('returns a single page for a short document', () => {
		const elements = makeElements(['Hello world.']);
		const result = estimatePages(elements);
		expect(result).toHaveLength(1);
		expect(result[0].pageNumber).toBe(1);
		expect(result[0].startElementIndex).toBe(0);
		expect(result[0].endElementIndex).toBe(1);
	});

	it('splits into multiple pages at paragraph boundaries', () => {
		// 5 paragraphs of 1000 chars each = 5000 chars, should be ~2 pages at 3000 chars/page
		const texts = Array.from({ length: 5 }, (_, i) => 'x'.repeat(1000));
		const elements = makeElements(texts);
		const result = estimatePages(elements);
		expect(result).toHaveLength(2);
		expect(result[0].pageNumber).toBe(1);
		expect(result[1].pageNumber).toBe(2);
	});

	it('never splits mid-paragraph', () => {
		// One paragraph of 5000 chars — must stay on one page even though >3000
		const elements = makeElements(['x'.repeat(5000)]);
		const result = estimatePages(elements);
		expect(result).toHaveLength(1);
		expect(result[0].endElementIndex).toBe(1);
	});

	it('respects custom charsPerPage', () => {
		const texts = Array.from({ length: 10 }, () => 'x'.repeat(100));
		const elements = makeElements(texts);
		// 1000 total chars, 500 per page = 2 pages
		const result = estimatePages(elements, 500);
		expect(result).toHaveLength(2);
	});

	it('detects hard page breaks as forced boundaries', () => {
		// Para, page break, para — should be 2 pages regardless of char count
		const elements: StructuralElement[] = [
			{
				startIndex: 1,
				endIndex: 11,
				paragraph: {
					elements: [{ startIndex: 1, endIndex: 11, textRun: { content: 'Before break' } }]
				}
			},
			{
				startIndex: 11,
				endIndex: 12,
				paragraph: {
					elements: [{ startIndex: 11, endIndex: 12, pageBreak: { textStyle: {} } }]
				}
			},
			{
				startIndex: 12,
				endIndex: 22,
				paragraph: {
					elements: [{ startIndex: 12, endIndex: 22, textRun: { content: 'After break' } }]
				}
			}
		];
		const result = estimatePages(elements);
		expect(result).toHaveLength(2);
		expect(result[0].pageNumber).toBe(1);
		expect(result[1].pageNumber).toBe(2);
	});

	it('counts characters correctly across pages', () => {
		const texts = ['a'.repeat(2000), 'b'.repeat(2000)];
		const elements = makeElements(texts);
		// 4000 total, at 3000/page → page 1 has 2000 (first para), then second para pushes over so it goes to page 2
		const result = estimatePages(elements, 3000);
		// First para = 2000 chars (under 3000, stays on page 1)
		// Second para = 2000 more (total 4000, over 3000 → new page)
		expect(result).toHaveLength(2);
		expect(result[0].charCount).toBe(2000);
		expect(result[1].charCount).toBe(2000);
	});
});

describe('filterByPageRange', () => {
	// 6 paragraphs of 1000 chars each → 2 pages at 3000 chars/page
	function makeSixParas() {
		return makeElements(Array.from({ length: 6 }, (_, i) => `Para${i + 1}${'x'.repeat(995)}`));
	}

	it('returns all elements when no filtering needed (startPage=1, no pageCount)', () => {
		const elements = makeSixParas();
		const result = filterByPageRange(elements, 1);
		expect(result.elements).toHaveLength(6);
		expect(result.totalPages).toBe(2);
		expect(result.startPage).toBe(1);
		expect(result.endPage).toBe(2);
	});

	it('returns only first page elements', () => {
		const elements = makeSixParas();
		const result = filterByPageRange(elements, 1, 1);
		expect(result.totalPages).toBe(2);
		expect(result.startPage).toBe(1);
		expect(result.endPage).toBe(1);
		// First page should have 3 elements (3000 chars)
		expect(result.elements.length).toBeLessThan(6);
		expect(result.elements.length).toBeGreaterThan(0);
	});

	it('returns only second page elements', () => {
		const elements = makeSixParas();
		const result = filterByPageRange(elements, 2, 1);
		expect(result.startPage).toBe(2);
		expect(result.endPage).toBe(2);
		expect(result.elements.length).toBeGreaterThan(0);
		expect(result.elements.length).toBeLessThan(6);
	});

	it('clamps startPage beyond total pages to last page', () => {
		const elements = makeSixParas();
		const result = filterByPageRange(elements, 99, 1);
		expect(result.startPage).toBe(2);
		expect(result.endPage).toBe(2);
	});

	it('clamps pageCount that extends beyond document', () => {
		const elements = makeSixParas();
		const result = filterByPageRange(elements, 1, 100);
		expect(result.elements).toHaveLength(6);
		expect(result.endPage).toBe(2);
	});

	it('returns empty result for empty document', () => {
		const result = filterByPageRange([], 1);
		expect(result.elements).toHaveLength(0);
		expect(result.totalPages).toBe(1);
	});
});

describe('filterAndRenumberThreads', () => {
	function makeThread(id: string, anchorId: string, quotedText: string): CommentThread {
		return {
			id,
			anchorId,
			quotedText,
			resolved: false,
			comments: [
				{ authorName: 'Alice', authorEmail: 'alice@test.com', content: 'Comment', isReply: false }
			]
		};
	}

	it('keeps threads whose quotedText appears in filtered elements', () => {
		const elements = makeElements(['Hello world', 'Goodbye world']);
		const threads = [
			makeThread('1', 'c1', 'Hello'),
			makeThread('2', 'c2', 'Goodbye')
		];
		const result = filterAndRenumberThreads(threads, elements);
		expect(result).toHaveLength(2);
	});

	it('removes threads whose quotedText does not appear in filtered elements', () => {
		const elements = makeElements(['Hello world']);
		const threads = [
			makeThread('1', 'c1', 'Hello'),
			makeThread('2', 'c2', 'Missing text')
		];
		const result = filterAndRenumberThreads(threads, elements);
		expect(result).toHaveLength(1);
		expect(result[0].quotedText).toBe('Hello');
	});

	it('renumbers anchor IDs sequentially starting from c1', () => {
		const elements = makeElements(['Alpha Beta Gamma']);
		const threads = [
			makeThread('1', 'c5', 'Alpha'),
			makeThread('2', 'c10', 'Gamma')
		];
		const result = filterAndRenumberThreads(threads, elements);
		expect(result).toHaveLength(2);
		expect(result[0].anchorId).toBe('c1');
		expect(result[1].anchorId).toBe('c2');
	});

	it('returns empty array when no threads match', () => {
		const elements = makeElements(['Hello world']);
		const threads = [makeThread('1', 'c1', 'No match here')];
		const result = filterAndRenumberThreads(threads, elements);
		expect(result).toHaveLength(0);
	});

	it('returns empty array for empty elements', () => {
		const threads = [makeThread('1', 'c1', 'Some text')];
		const result = filterAndRenumberThreads(threads, []);
		expect(result).toHaveLength(0);
	});

	it('handles threads with empty quotedText by excluding them', () => {
		const elements = makeElements(['Hello world']);
		const threads = [
			makeThread('1', 'c1', ''),
			makeThread('2', 'c2', 'Hello')
		];
		const result = filterAndRenumberThreads(threads, elements);
		expect(result).toHaveLength(1);
		expect(result[0].anchorId).toBe('c1');
		expect(result[0].quotedText).toBe('Hello');
	});
});
