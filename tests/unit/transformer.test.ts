import { describe, it, expect } from 'vitest';
import {
	transformToMarkdown,
	transformWithPageFilter,
	extractTextContent,
	formatCommentThread
} from '$lib/services/transformer';
import type { CommentThread, GoogleDocsDocument } from '$lib/types/google';

describe('extractTextContent', () => {
	it('extracts plain text from paragraph elements', () => {
		const elements = [
			{ startIndex: 0, endIndex: 5, textRun: { content: 'Hello' } },
			{ startIndex: 5, endIndex: 6, textRun: { content: ' ' } },
			{ startIndex: 6, endIndex: 11, textRun: { content: 'World' } }
		];
		expect(extractTextContent(elements)).toBe('Hello World');
	});

	it('applies bold formatting', () => {
		const elements = [
			{ startIndex: 0, endIndex: 5, textRun: { content: 'Hello', textStyle: { bold: true } } }
		];
		expect(extractTextContent(elements)).toBe('**Hello**');
	});

	it('applies italic formatting', () => {
		const elements = [
			{ startIndex: 0, endIndex: 5, textRun: { content: 'Hello', textStyle: { italic: true } } }
		];
		expect(extractTextContent(elements)).toBe('_Hello_');
	});

	it('applies bold and italic together', () => {
		const elements = [
			{ startIndex: 0, endIndex: 5, textRun: { content: 'Hello', textStyle: { bold: true, italic: true } } }
		];
		expect(extractTextContent(elements)).toBe('**_Hello_**');
	});

	it('applies strikethrough formatting', () => {
		const elements = [
			{ startIndex: 0, endIndex: 5, textRun: { content: 'Hello', textStyle: { strikethrough: true } } }
		];
		expect(extractTextContent(elements)).toBe('~~Hello~~');
	});

	it('applies strikethrough combined with bold', () => {
		const elements = [
			{
				startIndex: 0,
				endIndex: 5,
				textRun: { content: 'Hello', textStyle: { bold: true, strikethrough: true } }
			}
		];
		expect(extractTextContent(elements)).toBe('**~~Hello~~**');
	});

	it('applies strikethrough combined with italic', () => {
		const elements = [
			{
				startIndex: 0,
				endIndex: 5,
				textRun: { content: 'Hello', textStyle: { italic: true, strikethrough: true } }
			}
		];
		expect(extractTextContent(elements)).toBe('_~~Hello~~_');
	});

	it('applies bold, italic, and strikethrough together', () => {
		const elements = [
			{
				startIndex: 0,
				endIndex: 5,
				textRun: {
					content: 'Hello',
					textStyle: { bold: true, italic: true, strikethrough: true }
				}
			}
		];
		expect(extractTextContent(elements)).toBe('**_~~Hello~~_**');
	});

	it('handles links', () => {
		const elements = [
			{ startIndex: 0, endIndex: 5, textRun: { content: 'Click', textStyle: { link: { url: 'https://example.com' } } } }
		];
		expect(extractTextContent(elements)).toBe('[Click](https://example.com)');
	});

	it('preserves newlines', () => {
		const elements = [
			{ startIndex: 0, endIndex: 6, textRun: { content: 'Line1\n' } },
			{ startIndex: 6, endIndex: 11, textRun: { content: 'Line2' } }
		];
		expect(extractTextContent(elements)).toBe('Line1\nLine2');
	});
});

describe('formatCommentThread', () => {
	it('formats a single comment', () => {
		const thread: CommentThread = {
			id: '1',
			anchorId: 'c1',
			quotedText: 'some text',
			resolved: false,
			comments: [
				{ authorName: 'Alice', authorEmail: 'alice@example.com', content: 'Nice!', isReply: false }
			]
		};
		const result = formatCommentThread(thread);
		expect(result).toBe('> [c1] **Alice** (alice@example.com):\n> Nice!');
	});

	it('formats a thread with replies', () => {
		const thread: CommentThread = {
			id: '1',
			anchorId: 'c1',
			quotedText: 'some text',
			resolved: false,
			comments: [
				{ authorName: 'Alice', authorEmail: 'alice@example.com', content: 'First comment', isReply: false },
				{ authorName: 'Bob', authorEmail: 'bob@example.com', content: 'Reply here', isReply: true }
			]
		};
		const result = formatCommentThread(thread);
		expect(result).toContain('> [c1] **Alice** (alice@example.com):');
		expect(result).toContain('> First comment');
		expect(result).toContain('> [c1] **Bob** (bob@example.com):');
		expect(result).toContain('> Reply here');
	});

	it('handles multi-line comments', () => {
		const thread: CommentThread = {
			id: '1',
			anchorId: 'c2',
			quotedText: 'text',
			resolved: false,
			comments: [
				{ authorName: 'Alice', authorEmail: 'alice@example.com', content: 'Line 1\nLine 2', isReply: false }
			]
		};
		const result = formatCommentThread(thread);
		expect(result).toContain('> Line 1\n> Line 2');
	});

	it('marks resolved threads', () => {
		const thread: CommentThread = {
			id: '1',
			anchorId: 'c1',
			quotedText: 'text',
			resolved: true,
			comments: [
				{ authorName: 'Alice', authorEmail: 'alice@example.com', content: 'Done', isReply: false }
			]
		};
		const result = formatCommentThread(thread);
		expect(result).toContain('[c1 resolved]');
	});
});

// Helper to build a minimal doc with paragraphs
function makeDoc(paragraphs: Array<{
	text: string;
	style?: string;
	bullet?: { listId: string; nestingLevel?: number };
}>, lists?: Record<string, { listProperties: { nestingLevels: Array<{ glyphFormat?: string }> } }>): GoogleDocsDocument {
	let index = 1;
	const content = paragraphs.map((p) => {
		const start = index;
		const end = start + p.text.length;
		index = end;
		return {
			startIndex: start,
			endIndex: end,
			paragraph: {
				elements: [
					{ startIndex: start, endIndex: end, textRun: { content: p.text } }
				],
				paragraphStyle: p.style ? { namedStyleType: p.style } : undefined,
				bullet: p.bullet
			}
		};
	});

	return {
		documentId: 'test',
		title: 'Test Doc',
		body: { content },
		lists
	} as GoogleDocsDocument;
}

describe('transformToMarkdown - headings', () => {
	it('renders TITLE style as H1', () => {
		const doc = makeDoc([{ text: 'My Title', style: 'TITLE' }]);
		const result = transformToMarkdown(doc, []);
		expect(result).toContain('# My Title');
	});

	it('renders HEADING_1 as ##', () => {
		const doc = makeDoc([{ text: 'Section One', style: 'HEADING_1' }]);
		const result = transformToMarkdown(doc, []);
		expect(result).toContain('## Section One');
	});

	it('renders HEADING_2 as ###', () => {
		const doc = makeDoc([{ text: 'Subsection', style: 'HEADING_2' }]);
		const result = transformToMarkdown(doc, []);
		expect(result).toContain('### Subsection');
	});

	it('renders HEADING_3 as ####', () => {
		const doc = makeDoc([{ text: 'Deep', style: 'HEADING_3' }]);
		const result = transformToMarkdown(doc, []);
		expect(result).toContain('#### Deep');
	});

	it('renders NORMAL_TEXT as plain paragraph', () => {
		const doc = makeDoc([{ text: 'Just a paragraph.' }]);
		const result = transformToMarkdown(doc, []);
		expect(result).toContain('Just a paragraph.');
		expect(result).not.toMatch(/^#+.*Just a paragraph/m);
	});

	it('does not double-add title as H1 when TITLE style exists', () => {
		const doc = makeDoc([
			{ text: 'Doc Title', style: 'TITLE' },
			{ text: 'Body text.' }
		]);
		const result = transformToMarkdown(doc, []);
		// Should only have one H1, from the TITLE paragraph
		const h1Count = (result.match(/^# /gm) || []).length;
		expect(h1Count).toBe(1);
	});
});

describe('transformToMarkdown - lists', () => {
	it('renders unordered list items with -', () => {
		const doc = makeDoc(
			[
				{ text: 'Item A', bullet: { listId: 'list1' } },
				{ text: 'Item B', bullet: { listId: 'list1' } }
			],
			{
				list1: { listProperties: { nestingLevels: [{ glyphFormat: '%0' }] } }
			}
		);
		const result = transformToMarkdown(doc, []);
		expect(result).toContain('- Item A');
		expect(result).toContain('- Item B');
	});

	it('renders ordered list items with 1.', () => {
		const doc = makeDoc(
			[
				{ text: 'First', bullet: { listId: 'list2' } },
				{ text: 'Second', bullet: { listId: 'list2' } }
			],
			{
				list2: { listProperties: { nestingLevels: [{ glyphFormat: '%0.' }] } }
			}
		);
		const result = transformToMarkdown(doc, []);
		expect(result).toContain('1. First');
		expect(result).toContain('1. Second');
	});

	it('indents nested list items', () => {
		const doc = makeDoc(
			[
				{ text: 'Top', bullet: { listId: 'list3' } },
				{ text: 'Nested', bullet: { listId: 'list3', nestingLevel: 1 } }
			],
			{
				list3: { listProperties: { nestingLevels: [{ glyphFormat: '%0' }, { glyphFormat: '%1' }] } }
			}
		);
		const result = transformToMarkdown(doc, []);
		expect(result).toContain('- Top');
		expect(result).toContain('  - Nested');
	});

	it('does not add blank lines between consecutive list items', () => {
		const doc = makeDoc(
			[
				{ text: 'A', bullet: { listId: 'list4' } },
				{ text: 'B', bullet: { listId: 'list4' } },
				{ text: 'C', bullet: { listId: 'list4' } }
			],
			{
				list4: { listProperties: { nestingLevels: [{ glyphFormat: '%0' }] } }
			}
		);
		const result = transformToMarkdown(doc, []);
		// Items should be on consecutive lines, no blank line between
		expect(result).toMatch(/- A\n- B\n- C/);
	});
});

describe('transformToMarkdown - comments', () => {
	it('transforms simple paragraph without comments', () => {
		const doc = makeDoc([{ text: 'Hello World' }]);
		const result = transformToMarkdown(doc, []);
		expect(result).toContain('Hello World');
	});

	it('inserts anchor markers for commented text', () => {
		const doc = makeDoc([{ text: 'Here is some text.' }]);
		const threads: CommentThread[] = [
			{
				id: '1',
				anchorId: 'c1',
				quotedText: 'some',
				resolved: false,
				comments: [
					{ authorName: 'Alice', authorEmail: 'alice@test.com', content: 'Comment here', isReply: false }
				]
			}
		];
		const result = transformToMarkdown(doc, threads);
		expect(result).toContain('[some]^[c1]');
	});

	it('numbers comments by document position, not API order', () => {
		const doc = makeDoc([
			{ text: 'First paragraph with wordA in it.' },
			{ text: 'Second paragraph with wordB in it.' }
		]);
		// API returns comments in reverse order (wordB created first, wordA second)
		const threads: CommentThread[] = [
			{
				id: 'api-first', anchorId: 'c1', quotedText: 'wordB', resolved: false,
				comments: [{ authorName: 'Bob', authorEmail: 'b@t.com', content: 'On B', isReply: false }]
			},
			{
				id: 'api-second', anchorId: 'c2', quotedText: 'wordA', resolved: false,
				comments: [{ authorName: 'Alice', authorEmail: 'a@t.com', content: 'On A', isReply: false }]
			}
		];
		const result = transformToMarkdown(doc, threads);
		// wordA appears first in document, so should be c1
		expect(result).toContain('[wordA]^[c1]');
		// wordB appears second in document, so should be c2
		expect(result).toContain('[wordB]^[c2]');
	});

	it('does not duplicate comment when quoted text appears in multiple paragraphs', () => {
		const doc = makeDoc([
			{ text: 'First paragraph mentions surrender here.' },
			{ text: 'Second paragraph also says surrender again.' }
		]);
		const threads: CommentThread[] = [
			{
				id: '1', anchorId: 'c1', quotedText: 'surrender', resolved: false,
				comments: [{ authorName: 'Alice', authorEmail: 'a@t.com', content: 'What does this mean?', isReply: false }]
			}
		];
		const result = transformToMarkdown(doc, threads);
		// Should only appear once as an anchor
		const anchorMatches = result.match(/\]?\^\[c1\]/g) || [];
		expect(anchorMatches).toHaveLength(1);
		// Should only appear once as a blockquote
		const blockquoteMatches = result.match(/> \[c1\] \*\*Alice\*\*/g) || [];
		expect(blockquoteMatches).toHaveLength(1);
		// First paragraph should have the anchor
		expect(result).toContain('[surrender]^[c1]');
		// Second paragraph should NOT have the anchor
		const lines = result.split('\n');
		const secondParaLine = lines.find(l => l.includes('Second paragraph'));
		expect(secondParaLine).not.toContain('^[c1]');
	});

	it('places comment threads after their paragraph', () => {
		const doc = makeDoc([{ text: 'Here is some text.' }]);
		const threads: CommentThread[] = [
			{
				id: '1',
				anchorId: 'c1',
				quotedText: 'some',
				resolved: false,
				comments: [
					{ authorName: 'Alice', authorEmail: 'alice@test.com', content: 'My comment', isReply: false }
				]
			}
		];
		const result = transformToMarkdown(doc, threads);
		const lines = result.split('\n');
		const textLineIndex = lines.findIndex(l => l.includes('[some]^[c1]'));
		const commentLineIndex = lines.findIndex(l => l.includes('> [c1] **Alice**'));
		expect(commentLineIndex).toBeGreaterThan(textLineIndex);
	});
});

describe('transformToMarkdown - anchors never stack inside prior anchors', () => {
	it('does not re-match inside an already-inserted anchor when quotedText is a substring', () => {
		// Two threads: one quoting "Steve", the other "Steve: ". The longer
		// one claims the position; the shorter should NOT then match the
		// "Steve" literal *inside* the longer one's annotation.
		const doc = makeDoc([{ text: 'Sophia & Steve: hello' }]);
		const threads: CommentThread[] = [
			{
				id: '1', anchorId: 'c1', quotedText: 'Steve', resolved: false,
				comments: [{ authorName: 'A', authorEmail: '', content: 'on Steve', isReply: false }]
			},
			{
				id: '2', anchorId: 'c2', quotedText: 'Steve: ', resolved: false,
				comments: [{ authorName: 'B', authorEmail: '', content: 'on Steve:', isReply: false }]
			}
		];
		const result = transformToMarkdown(doc, threads);
		// No nested anchors anywhere in the output.
		expect(result).not.toMatch(/\[\[.*?\]\^\[c\d+\].*?\]\^\[c\d+\]/);
	});

	it('splits distinct threads onto distinct occurrences when quotedText repeats', () => {
		// "abc" appears three times. Three threads each quoting "abc" should
		// land on three separate occurrences, not all stack on the first.
		const doc = makeDoc([{ text: 'abc abc abc' }]);
		const threads: CommentThread[] = [
			{
				id: '1', anchorId: 'c1', quotedText: 'abc', resolved: false,
				comments: [{ authorName: 'A', authorEmail: '', content: 'first', isReply: false }]
			},
			{
				id: '2', anchorId: 'c2', quotedText: 'abc', resolved: false,
				comments: [{ authorName: 'B', authorEmail: '', content: 'second', isReply: false }]
			},
			{
				id: '3', anchorId: 'c3', quotedText: 'abc', resolved: false,
				comments: [{ authorName: 'C', authorEmail: '', content: 'third', isReply: false }]
			}
		];
		const result = transformToMarkdown(doc, threads);
		// Three anchors side-by-side, none nested.
		const anchorMatches = result.match(/\[abc\]\^\[c\d+\]/g) ?? [];
		expect(anchorMatches).toHaveLength(3);
		expect(result).not.toMatch(/\[\[abc/);
	});

	it('places an anchor in the paragraph identified by thread.anchorParaIndex, not the first substring match', () => {
		// The docx adapter records the paragraph index where a comment's
		// <w:commentRangeStart> was seen. The transformer must route the
		// thread to THAT paragraph even when an earlier paragraph happens to
		// contain the quotedText as a substring — that false-positive is the
		// bug that silently attached deep-in-doc comments to the title bar.
		const doc = makeDoc([
			{ text: 'Sophia & Steve: heading' }, // paragraph 0: contains "Sophia"
			{ text: 'unrelated middle paragraph' },
			{ text: 'later mention of Sophia here' } // paragraph 2: real anchor
		]);
		const threads: CommentThread[] = [
			{
				id: '1',
				anchorId: 'c1',
				quotedText: 'Sophia',
				resolved: false,
				comments: [
					{ authorName: 'Alice', authorEmail: '', content: 'a comment', isReply: false }
				],
				anchorParaIndex: 2
			}
		];
		const result = transformToMarkdown(doc, threads);
		// Paragraph 0 ("Sophia & Steve: heading") must NOT have the anchor.
		expect(result).not.toMatch(/Sophia & Steve:.*\^\[c1\]/);
		// Paragraph 2 must have the anchor.
		expect(result).toContain('later mention of [Sophia]^[c1] here');
	});

	it('falls back to substring matching when anchorParaIndex is undefined', () => {
		// Unit-test and pre-adapter code paths may not have paragraph-index
		// info. Preserve the old substring-scan behavior in that case so
		// existing tests / history-cached threads keep working.
		const doc = makeDoc([
			{ text: 'Hello world' },
			{ text: 'Second paragraph' }
		]);
		const threads: CommentThread[] = [
			{
				id: '1',
				anchorId: 'c1',
				quotedText: 'Hello',
				resolved: false,
				comments: [
					{ authorName: 'Alice', authorEmail: '', content: 'test', isReply: false }
				]
				// no anchorParaIndex
			}
		];
		const result = transformToMarkdown(doc, threads);
		expect(result).toContain('[Hello]^[c1] world');
	});

	it('falls back to the unanchored section when no non-overlapping position is available', () => {
		// Only one "abc" in the text, two threads both quote "abc". The
		// longer-or-first thread claims it; the other has no place to land
		// and should render in the unanchored section instead of stacking.
		const doc = makeDoc([{ text: 'abc' }]);
		const threads: CommentThread[] = [
			{
				id: '1', anchorId: 'c1', quotedText: 'abc', resolved: false,
				comments: [{ authorName: 'A', authorEmail: '', content: 'alpha', isReply: false }]
			},
			{
				id: '2', anchorId: 'c2', quotedText: 'abc', resolved: false,
				comments: [{ authorName: 'B', authorEmail: '', content: 'beta', isReply: false }]
			}
		];
		const result = transformToMarkdown(doc, threads);
		expect(result).toContain('[abc]^[c1]');
		expect(result).not.toMatch(/\[\[abc/);
		expect(result).toContain('## Unanchored comments');
		expect(result).toContain('beta');
	});
});

describe('transformWithPageFilter', () => {
	// Build a doc with enough text to span multiple pages
	function makeMultiPageDoc(): GoogleDocsDocument {
		// 6 paragraphs of ~1000 chars each = ~6000 chars → 2 pages at 3000/page
		const paragraphs = [
			{ text: 'Page1 Para1 ' + 'a'.repeat(988) },
			{ text: 'Page1 Para2 ' + 'b'.repeat(988) },
			{ text: 'Page1 Para3 ' + 'c'.repeat(988) },
			{ text: 'Page2 Para4 ' + 'd'.repeat(988) },
			{ text: 'Page2 Para5 ' + 'e'.repeat(988) },
			{ text: 'Page2 Para6 ' + 'f'.repeat(988) }
		];
		return makeDoc(paragraphs);
	}

	it('returns full document when no page options set', () => {
		const doc = makeMultiPageDoc();
		const result = transformWithPageFilter(doc, []);
		expect(result.markdown).toContain('Page1 Para1');
		expect(result.markdown).toContain('Page2 Para6');
		expect(result.totalPages).toBe(2);
		expect(result.pageRange).toBeNull();
	});

	it('filters to requested page range', () => {
		const doc = makeMultiPageDoc();
		const result = transformWithPageFilter(doc, [], { startPage: 1, pageCount: 1 });
		expect(result.markdown).toContain('Page1 Para1');
		expect(result.markdown).not.toContain('Page2 Para4');
		expect(result.pageRange).toEqual({ start: 1, end: 1 });
		expect(result.totalPages).toBe(2);
	});

	it('filters comments to only those in the page range', () => {
		const doc = makeMultiPageDoc();
		const threads: CommentThread[] = [
			{
				id: '1', anchorId: 'c1', quotedText: 'Page1 Para1', resolved: false,
				comments: [{ authorName: 'A', authorEmail: 'a@t.com', content: 'On page 1', isReply: false }]
			},
			{
				id: '2', anchorId: 'c2', quotedText: 'Page2 Para4', resolved: false,
				comments: [{ authorName: 'B', authorEmail: 'b@t.com', content: 'On page 2', isReply: false }]
			}
		];
		const result = transformWithPageFilter(doc, threads, { startPage: 1, pageCount: 1 });
		expect(result.markdown).toContain('[Page1 Para1]^[c1]');
		expect(result.markdown).not.toContain('Page2 Para4');
		expect(result.commentCount).toBe(1);
	});

	it('renumbers comment IDs sequentially in filtered output', () => {
		const doc = makeMultiPageDoc();
		const threads: CommentThread[] = [
			{
				id: '1', anchorId: 'c1', quotedText: 'Page1 Para1', resolved: false,
				comments: [{ authorName: 'A', authorEmail: 'a@t.com', content: 'First', isReply: false }]
			},
			{
				id: '2', anchorId: 'c2', quotedText: 'Page2 Para4', resolved: false,
				comments: [{ authorName: 'B', authorEmail: 'b@t.com', content: 'Second', isReply: false }]
			},
			{
				id: '3', anchorId: 'c3', quotedText: 'Page2 Para5', resolved: false,
				comments: [{ authorName: 'C', authorEmail: 'c@t.com', content: 'Third', isReply: false }]
			}
		];
		// Page 2 only — should get c2 and c3, renumbered to c1 and c2
		const result = transformWithPageFilter(doc, threads, { startPage: 2, pageCount: 1 });
		expect(result.markdown).toContain(']^[c1]');
		expect(result.markdown).toContain(']^[c2]');
		expect(result.markdown).not.toContain(']^[c3]');
		expect(result.commentCount).toBe(2);
	});

	it('returns correct metadata', () => {
		const doc = makeMultiPageDoc();
		const result = transformWithPageFilter(doc, [], { startPage: 2 });
		expect(result.totalPages).toBe(2);
		expect(result.pageRange).toEqual({ start: 2, end: 2 });
	});

	it('does not leak out-of-range thread anchors onto earlier paragraphs when the quoted word coincidentally appears in-range', () => {
		// Regression guard for the "title anchor ghost" class: a thread
		// whose true anchor is on page 2 must not rehome onto a page-1
		// paragraph that happens to contain the same quoted word.
		const doc = makeMultiPageDoc();
		const threads: CommentThread[] = [
			{
				id: '1',
				anchorId: 'c1',
				quotedText: 'Page1 Para1',
				resolved: false,
				comments: [
					{ authorName: 'A', authorEmail: '', content: 'late comment', isReply: false }
				],
				anchorParaIndex: 3 // paragraph index of 'Page2 Para4' — out of page 1
			}
		];
		const result = transformWithPageFilter(doc, threads, { startPage: 1, pageCount: 1 });
		expect(result.markdown).not.toContain(']^[c1]');
		expect(result.markdown).not.toContain('late comment');
		expect(result.commentCount).toBe(0);
	});
});

describe('transformToMarkdown - unanchored comments section', () => {
	it('renders a "## Unanchored comments" section for threads whose quotedText is empty', () => {
		const doc = makeDoc([{ text: 'Hello world.' }]);
		const threads: CommentThread[] = [
			{
				id: '1',
				anchorId: 'c1',
				quotedText: '', // no anchor — could not be matched in source
				resolved: false,
				comments: [
					{ authorName: 'Alice', authorEmail: 'a@t.com', content: 'Point comment', isReply: false }
				]
			}
		];
		const result = transformToMarkdown(doc, threads);
		expect(result).toContain('## Unanchored comments');
		expect(result).toContain('> [c1] **Alice**');
		expect(result).toContain('> Point comment');
	});

	it('renders a "## Unanchored comments" section when quotedText cannot be found in any paragraph', () => {
		const doc = makeDoc([{ text: 'Hello world.' }]);
		const threads: CommentThread[] = [
			{
				id: '1',
				anchorId: 'c1',
				quotedText: 'text that does not appear in the document',
				resolved: false,
				comments: [
					{ authorName: 'Bob', authorEmail: 'b@t.com', content: 'Stale reference', isReply: false }
				]
			}
		];
		const result = transformToMarkdown(doc, threads);
		expect(result).toContain('## Unanchored comments');
		expect(result).toContain('> [c1] **Bob**');
	});

	it('omits the section entirely when every thread is anchored', () => {
		const doc = makeDoc([{ text: 'Hello world.' }]);
		const threads: CommentThread[] = [
			{
				id: '1',
				anchorId: 'c1',
				quotedText: 'Hello',
				resolved: false,
				comments: [
					{ authorName: 'Alice', authorEmail: 'a@t.com', content: 'Anchored', isReply: false }
				]
			}
		];
		const result = transformToMarkdown(doc, threads);
		expect(result).not.toContain('Unanchored comments');
		expect(result).toContain('[Hello]^[c1]');
	});

	it('omits the section for an empty threads array', () => {
		const doc = makeDoc([{ text: 'Hello.' }]);
		const result = transformToMarkdown(doc, []);
		expect(result).not.toContain('Unanchored comments');
	});

	it('places the section at the end of the document', () => {
		const doc = makeDoc([{ text: 'Hello world.' }]);
		const threads: CommentThread[] = [
			{
				id: '1',
				anchorId: 'c1',
				quotedText: '',
				resolved: false,
				comments: [
					{ authorName: 'Alice', authorEmail: 'a@t.com', content: 'Dangling', isReply: false }
				]
			}
		];
		const result = transformToMarkdown(doc, threads);
		const lines = result.split('\n');
		const bodyIndex = lines.findIndex((l) => l.includes('Hello world.'));
		const headingIndex = lines.findIndex((l) => l.includes('## Unanchored comments'));
		expect(headingIndex).toBeGreaterThan(bodyIndex);
	});
});
