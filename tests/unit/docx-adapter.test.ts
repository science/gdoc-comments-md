import { describe, it, expect } from 'vitest';
import { zipSync } from 'fflate';
import { parseDocx } from '$lib/services/docx-adapter';
import { transformToMarkdown, extractTextContent } from '$lib/services/transformer';

/**
 * Build a minimal .docx ArrayBuffer from a set of file path → XML string.
 *
 * Under jsdom, `TextEncoder.encode()` returns a Uint8Array from Node's realm,
 * but `fflate` loads in jsdom's realm — and its internal `instanceof Uint8Array`
 * type-check against jsdom's global then *rejects* the encoded bytes, treating
 * them as a nested directory tree instead of a file blob. Wrapping the encoded
 * bytes with `new Uint8Array(...)` rebuilds the array in jsdom's realm so the
 * identity check succeeds.
 */
function buildDocx(files: Record<string, string>): ArrayBuffer {
	const encoder = new TextEncoder();
	const entries: Record<string, Uint8Array> = {};
	for (const [path, content] of Object.entries(files)) {
		entries[path] = new Uint8Array(encoder.encode(content));
	}
	const u8 = zipSync(entries);
	const out = new Uint8Array(u8.byteLength);
	out.set(u8);
	return out.buffer;
}

const DOC_PROLOG =
	'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
	'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"' +
	' xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"' +
	' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';

const DOC_EPILOG = '</w:document>';

function docXml(bodyInner: string): string {
	return `${DOC_PROLOG}<w:body>${bodyInner}</w:body>${DOC_EPILOG}`;
}

describe('parseDocx — paragraphs and text', () => {
	it('extracts a single paragraph with plain text', () => {
		const buf = buildDocx({
			'word/document.xml': docXml(
				'<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>'
			)
		});

		const { doc } = parseDocx(buf);

		expect(doc.body.content).toHaveLength(1);
		const paragraph = doc.body.content[0].paragraph;
		expect(paragraph).toBeDefined();
		const text = extractTextContent(paragraph!.elements);
		expect(text).toBe('Hello world');
	});

	it('joins multiple <w:t> runs into a single paragraph text stream', () => {
		const buf = buildDocx({
			'word/document.xml': docXml(
				'<w:p>' +
					'<w:r><w:t>Hel</w:t></w:r>' +
					'<w:r><w:t>lo</w:t></w:r>' +
					'<w:r><w:t xml:space="preserve"> world</w:t></w:r>' +
					'</w:p>'
			)
		});

		const { doc } = parseDocx(buf);
		const paragraph = doc.body.content[0].paragraph;
		expect(extractTextContent(paragraph!.elements)).toBe('Hello world');
	});

	it('produces distinct paragraphs for multiple <w:p>', () => {
		const buf = buildDocx({
			'word/document.xml': docXml(
				'<w:p><w:r><w:t>First</w:t></w:r></w:p>' +
					'<w:p><w:r><w:t>Second</w:t></w:r></w:p>'
			)
		});

		const { doc } = parseDocx(buf);
		expect(doc.body.content).toHaveLength(2);
		expect(extractTextContent(doc.body.content[0].paragraph!.elements)).toBe('First');
		expect(extractTextContent(doc.body.content[1].paragraph!.elements)).toBe('Second');
	});

	it('feeds transformer to produce plain markdown', () => {
		const buf = buildDocx({
			'word/document.xml': docXml(
				'<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>'
			)
		});

		const { doc, threads } = parseDocx(buf);
		const md = transformToMarkdown(doc, threads);
		expect(md).toContain('Hello world');
	});

	it('returns an empty threads array when there are no comments', () => {
		const buf = buildDocx({
			'word/document.xml': docXml(
				'<w:p><w:r><w:t>Hello</w:t></w:r></w:p>'
			)
		});

		const { threads } = parseDocx(buf);
		expect(threads).toEqual([]);
	});
});

describe('parseDocx — heading styles', () => {
	function paragraphWithStyle(styleId: string, text: string): string {
		return (
			'<w:p>' +
			`<w:pPr><w:pStyle w:val="${styleId}"/></w:pPr>` +
			`<w:r><w:t>${text}</w:t></w:r>` +
			'</w:p>'
		);
	}

	it('maps Heading1 → HEADING_1', () => {
		const buf = buildDocx({
			'word/document.xml': docXml(paragraphWithStyle('Heading1', 'Section One'))
		});
		const { doc } = parseDocx(buf);
		expect(doc.body.content[0].paragraph?.paragraphStyle?.namedStyleType).toBe('HEADING_1');
	});

	it('maps Heading2 → HEADING_2', () => {
		const buf = buildDocx({
			'word/document.xml': docXml(paragraphWithStyle('Heading2', 'Subsection'))
		});
		const { doc } = parseDocx(buf);
		expect(doc.body.content[0].paragraph?.paragraphStyle?.namedStyleType).toBe('HEADING_2');
	});

	it('maps Heading3 → HEADING_3', () => {
		const buf = buildDocx({
			'word/document.xml': docXml(paragraphWithStyle('Heading3', 'Deep'))
		});
		const { doc } = parseDocx(buf);
		expect(doc.body.content[0].paragraph?.paragraphStyle?.namedStyleType).toBe('HEADING_3');
	});

	it('maps Title → TITLE', () => {
		const buf = buildDocx({
			'word/document.xml': docXml(paragraphWithStyle('Title', 'My Title'))
		});
		const { doc } = parseDocx(buf);
		expect(doc.body.content[0].paragraph?.paragraphStyle?.namedStyleType).toBe('TITLE');
	});

	it('maps Subtitle → SUBTITLE', () => {
		const buf = buildDocx({
			'word/document.xml': docXml(paragraphWithStyle('Subtitle', 'A subtitle'))
		});
		const { doc } = parseDocx(buf);
		expect(doc.body.content[0].paragraph?.paragraphStyle?.namedStyleType).toBe('SUBTITLE');
	});

	it('leaves unknown pStyle values without a namedStyleType', () => {
		const buf = buildDocx({
			'word/document.xml': docXml(paragraphWithStyle('CustomWeirdStyle', 'Weird'))
		});
		const { doc } = parseDocx(buf);
		expect(doc.body.content[0].paragraph?.paragraphStyle?.namedStyleType).toBeUndefined();
	});

	it('renders through transformer to the right markdown heading level', () => {
		const buf = buildDocx({
			'word/document.xml': docXml(
				paragraphWithStyle('Heading1', 'One') +
				paragraphWithStyle('Heading2', 'Two')
			)
		});
		const { doc, threads } = parseDocx(buf);
		const md = transformToMarkdown(doc, threads);
		expect(md).toContain('## One');
		expect(md).toContain('### Two');
	});
});

describe('parseDocx — text formatting', () => {
	function runWithProps(rPrInner: string, text: string): string {
		return (
			'<w:p>' +
			`<w:r><w:rPr>${rPrInner}</w:rPr><w:t>${text}</w:t></w:r>` +
			'</w:p>'
		);
	}

	it('extracts bold as textStyle.bold = true', () => {
		const buf = buildDocx({
			'word/document.xml': docXml(runWithProps('<w:b/>', 'Hello'))
		});
		const { doc } = parseDocx(buf);
		const element = doc.body.content[0].paragraph!.elements[0];
		expect(element.textRun?.textStyle?.bold).toBe(true);
	});

	it('extracts italic as textStyle.italic = true', () => {
		const buf = buildDocx({
			'word/document.xml': docXml(runWithProps('<w:i/>', 'Hello'))
		});
		const { doc } = parseDocx(buf);
		const element = doc.body.content[0].paragraph!.elements[0];
		expect(element.textRun?.textStyle?.italic).toBe(true);
	});

	it('extracts strikethrough as textStyle.strikethrough = true', () => {
		const buf = buildDocx({
			'word/document.xml': docXml(runWithProps('<w:strike/>', 'Hello'))
		});
		const { doc } = parseDocx(buf);
		const element = doc.body.content[0].paragraph!.elements[0];
		expect(element.textRun?.textStyle?.strikethrough).toBe(true);
	});

	it('ignores <w:b w:val="false"/> (OOXML explicit-off)', () => {
		const buf = buildDocx({
			'word/document.xml': docXml(runWithProps('<w:b w:val="false"/>', 'Hello'))
		});
		const { doc } = parseDocx(buf);
		const element = doc.body.content[0].paragraph!.elements[0];
		expect(element.textRun?.textStyle?.bold).not.toBe(true);
	});

	it('combines bold + italic + strikethrough into nested markdown', () => {
		const buf = buildDocx({
			'word/document.xml': docXml(
				runWithProps('<w:b/><w:i/><w:strike/>', 'Hello')
			)
		});
		const { doc, threads } = parseDocx(buf);
		const md = transformToMarkdown(doc, threads);
		expect(md).toContain('**_~~Hello~~_**');
	});

	it('extracts hyperlink URL from document.xml.rels', () => {
		const buf = buildDocx({
			'word/document.xml': docXml(
				'<w:p>' +
					'<w:hyperlink r:id="rId1">' +
						'<w:r><w:t>Click here</w:t></w:r>' +
					'</w:hyperlink>' +
				'</w:p>'
			),
			'word/_rels/document.xml.rels':
				'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
				'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
					'<Relationship Id="rId1"' +
					' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"' +
					' Target="https://example.com/" TargetMode="External"/>' +
				'</Relationships>'
		});
		const { doc, threads } = parseDocx(buf);
		const md = transformToMarkdown(doc, threads);
		expect(md).toContain('[Click here](https://example.com/)');
	});
});

describe('parseDocx — lists', () => {
	function listParagraph(numId: string, ilvl: string, text: string): string {
		return (
			'<w:p>' +
				'<w:pPr>' +
					'<w:numPr>' +
						`<w:ilvl w:val="${ilvl}"/>` +
						`<w:numId w:val="${numId}"/>` +
					'</w:numPr>' +
				'</w:pPr>' +
				`<w:r><w:t>${text}</w:t></w:r>` +
			'</w:p>'
		);
	}

	function numberingXml(defs: Array<{ numId: string; abstractId: string; levels: Array<{ ilvl: string; numFmt: 'bullet' | 'decimal' | 'lowerLetter' | 'upperRoman' }> }>): string {
		const abstracts = defs.map((def) =>
			`<w:abstractNum w:abstractNumId="${def.abstractId}">` +
				def.levels.map((lvl) =>
					`<w:lvl w:ilvl="${lvl.ilvl}"><w:numFmt w:val="${lvl.numFmt}"/></w:lvl>`
				).join('') +
			'</w:abstractNum>'
		).join('');
		const nums = defs.map((def) =>
			`<w:num w:numId="${def.numId}"><w:abstractNumId w:val="${def.abstractId}"/></w:num>`
		).join('');
		return (
			'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
			'<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
				abstracts +
				nums +
			'</w:numbering>'
		);
	}

	it('populates paragraph.bullet with the numId for a bulleted item', () => {
		const buf = buildDocx({
			'word/document.xml': docXml(listParagraph('1', '0', 'Item A')),
			'word/numbering.xml': numberingXml([
				{ numId: '1', abstractId: 'A', levels: [{ ilvl: '0', numFmt: 'bullet' }] }
			])
		});
		const { doc } = parseDocx(buf);
		const para = doc.body.content[0].paragraph!;
		expect(para.bullet).toEqual({ listId: '1', nestingLevel: 0 });
	});

	it('renders unordered list items as `-`', () => {
		const buf = buildDocx({
			'word/document.xml': docXml(
				listParagraph('1', '0', 'Apples') +
				listParagraph('1', '0', 'Oranges')
			),
			'word/numbering.xml': numberingXml([
				{ numId: '1', abstractId: 'A', levels: [{ ilvl: '0', numFmt: 'bullet' }] }
			])
		});
		const { doc, threads } = parseDocx(buf);
		const md = transformToMarkdown(doc, threads);
		expect(md).toContain('- Apples');
		expect(md).toContain('- Oranges');
	});

	it('renders ordered list items as `1.`', () => {
		const buf = buildDocx({
			'word/document.xml': docXml(
				listParagraph('2', '0', 'First') +
				listParagraph('2', '0', 'Second')
			),
			'word/numbering.xml': numberingXml([
				{ numId: '2', abstractId: 'B', levels: [{ ilvl: '0', numFmt: 'decimal' }] }
			])
		});
		const { doc, threads } = parseDocx(buf);
		const md = transformToMarkdown(doc, threads);
		expect(md).toContain('1. First');
		expect(md).toContain('1. Second');
	});

	it('indents nested list items', () => {
		const buf = buildDocx({
			'word/document.xml': docXml(
				listParagraph('3', '0', 'Top') +
				listParagraph('3', '1', 'Nested')
			),
			'word/numbering.xml': numberingXml([
				{
					numId: '3',
					abstractId: 'C',
					levels: [
						{ ilvl: '0', numFmt: 'bullet' },
						{ ilvl: '1', numFmt: 'bullet' }
					]
				}
			])
		});
		const { doc, threads } = parseDocx(buf);
		const md = transformToMarkdown(doc, threads);
		expect(md).toContain('- Top');
		expect(md).toContain('  - Nested');
	});

	it('handles list paragraphs when numbering.xml is missing (falls back to bullet)', () => {
		// Edge case: unusual export without numbering.xml. The bullet marker
		// still appears (the paragraph is a list item), but we can't determine
		// ordered vs unordered — default to unordered.
		const buf = buildDocx({
			'word/document.xml': docXml(listParagraph('1', '0', 'Item'))
		});
		const { doc, threads } = parseDocx(buf);
		const md = transformToMarkdown(doc, threads);
		expect(md).toContain('- Item');
	});
});

describe('parseDocx — comment ranges', () => {
	function commentsXml(entries: Array<{ id: string; author: string; date?: string; paragraphs: string[] }>): string {
		const comments = entries
			.map((c) => {
				const date = c.date ?? '2026-04-20T00:00:00Z';
				return (
					`<w:comment w:id="${c.id}" w:author="${c.author}" w:date="${date}" w:initials="A">` +
						c.paragraphs.map((text, i) =>
							`<w:p w14:paraId="${c.id}p${i}"><w:r><w:t>${text}</w:t></w:r></w:p>`
						).join('') +
					'</w:comment>'
				);
			})
			.join('');
		return (
			'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
			'<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"' +
				' xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">' +
				comments +
			'</w:comments>'
		);
	}

	it('emits a CommentThread with quotedText from a single-run range', () => {
		const buf = buildDocx({
			'word/document.xml': docXml(
				'<w:p>' +
					'<w:r><w:t xml:space="preserve">Here is </w:t></w:r>' +
					'<w:commentRangeStart w:id="0"/>' +
					'<w:r><w:t>target text</w:t></w:r>' +
					'<w:commentRangeEnd w:id="0"/>' +
					'<w:r><w:t xml:space="preserve"> and more.</w:t></w:r>' +
				'</w:p>'
			),
			'word/comments.xml': commentsXml([
				{ id: '0', author: 'Alice', paragraphs: ['This is the feedback'] }
			])
		});

		const { threads } = parseDocx(buf);
		expect(threads).toHaveLength(1);
		expect(threads[0].quotedText).toBe('target text');
		expect(threads[0].comments).toHaveLength(1);
		expect(threads[0].comments[0].authorName).toBe('Alice');
		expect(threads[0].comments[0].content).toBe('This is the feedback');
		expect(threads[0].comments[0].isReply).toBe(false);
	});

	it('renders an anchored comment through the full pipeline', () => {
		const buf = buildDocx({
			'word/document.xml': docXml(
				'<w:p>' +
					'<w:r><w:t xml:space="preserve">Here is </w:t></w:r>' +
					'<w:commentRangeStart w:id="0"/>' +
					'<w:r><w:t>target text</w:t></w:r>' +
					'<w:commentRangeEnd w:id="0"/>' +
					'<w:r><w:t xml:space="preserve"> trailing.</w:t></w:r>' +
				'</w:p>'
			),
			'word/comments.xml': commentsXml([
				{ id: '0', author: 'Alice', paragraphs: ['Feedback text'] }
			])
		});

		const { doc, threads } = parseDocx(buf);
		const md = transformToMarkdown(doc, threads);
		expect(md).toContain('[target text]^[c1]');
		expect(md).toContain('> [c1] **Alice**');
		expect(md).toContain('> Feedback text');
	});

	it('handles comments whose <w:commentRangeStart> and End span multiple runs', () => {
		const buf = buildDocx({
			'word/document.xml': docXml(
				'<w:p>' +
					'<w:commentRangeStart w:id="0"/>' +
					'<w:r><w:t>tar</w:t></w:r>' +
					'<w:r><w:t>get</w:t></w:r>' +
					'<w:commentRangeEnd w:id="0"/>' +
				'</w:p>'
			),
			'word/comments.xml': commentsXml([
				{ id: '0', author: 'A', paragraphs: ['x'] }
			])
		});
		const { threads } = parseDocx(buf);
		expect(threads[0].quotedText).toBe('target');
	});

	it('treats duplicate <w:commentRangeStart> for the same id as a single range', () => {
		// Some exports emit two Start markers with identical ids — observed in
		// the real failing doc. The first wins; the duplicate is ignored.
		const buf = buildDocx({
			'word/document.xml': docXml(
				'<w:p>' +
					'<w:commentRangeStart w:id="0"/>' +
					'<w:r><w:t>first</w:t></w:r>' +
					'<w:commentRangeStart w:id="0"/>' +
					'<w:r><w:t> second</w:t></w:r>' +
					'<w:commentRangeEnd w:id="0"/>' +
				'</w:p>'
			),
			'word/comments.xml': commentsXml([
				{ id: '0', author: 'A', paragraphs: ['x'] }
			])
		});
		const { threads } = parseDocx(buf);
		expect(threads[0].quotedText).toBe('first second');
	});

	it('produces an empty quotedText when <w:commentRangeEnd> has no matching Start', () => {
		const buf = buildDocx({
			'word/document.xml': docXml(
				'<w:p>' +
					'<w:r><w:t>Some text</w:t></w:r>' +
					'<w:commentRangeEnd w:id="0"/>' +
				'</w:p>'
			),
			'word/comments.xml': commentsXml([
				{ id: '0', author: 'A', paragraphs: ['orphan'] }
			])
		});
		const { threads } = parseDocx(buf);
		expect(threads).toHaveLength(1);
		expect(threads[0].quotedText).toBe('');
	});

	it('captures only the first paragraph portion for ranges that cross <w:p> boundaries', () => {
		// Multi-paragraph ranges collapse to their first paragraph's text
		// because the transformer matches quotedText against one paragraph at
		// a time. Capturing the whole concatenated span would never match any
		// single paragraph, so the anchor would silently fail.
		const buf = buildDocx({
			'word/document.xml': docXml(
				'<w:p>' +
					'<w:commentRangeStart w:id="0"/>' +
					'<w:r><w:t>line one</w:t></w:r>' +
				'</w:p>' +
				'<w:p>' +
					'<w:r><w:t> line two</w:t></w:r>' +
					'<w:commentRangeEnd w:id="0"/>' +
				'</w:p>'
			),
			'word/comments.xml': commentsXml([
				{ id: '0', author: 'A', paragraphs: ['spanning'] }
			])
		});
		const { threads } = parseDocx(buf);
		expect(threads[0].quotedText).toBe('line one');
	});

	it('captures ranges inside table cells', () => {
		const buf = buildDocx({
			'word/document.xml': docXml(
				'<w:tbl>' +
					'<w:tr>' +
						'<w:tc>' +
							'<w:p>' +
								'<w:commentRangeStart w:id="0"/>' +
								'<w:r><w:t>cell quote</w:t></w:r>' +
								'<w:commentRangeEnd w:id="0"/>' +
							'</w:p>' +
						'</w:tc>' +
					'</w:tr>' +
				'</w:tbl>'
			),
			'word/comments.xml': commentsXml([
				{ id: '0', author: 'A', paragraphs: ['on a cell'] }
			])
		});
		const { threads } = parseDocx(buf);
		expect(threads[0].quotedText).toBe('cell quote');
	});
});

describe('parseDocx — reply threading via commentsExtended.xml', () => {
	/**
	 * Helper that authors comments.xml with an explicit paraId per comment
	 * body paragraph so commentsExtended.xml can reference them.
	 */
	function commentXmlWithParaIds(entries: Array<{
		id: string;
		author: string;
		paraIds: string[];
		texts: string[];
	}>): string {
		const comments = entries
			.map((c) => {
				const paras = c.paraIds
					.map((pid, i) =>
						`<w:p w14:paraId="${pid}"><w:r><w:t>${c.texts[i]}</w:t></w:r></w:p>`
					)
					.join('');
				return (
					`<w:comment w:id="${c.id}" w:author="${c.author}" w:date="2026-04-20T00:00:00Z" w:initials="A">` +
						paras +
					'</w:comment>'
				);
			})
			.join('');
		return (
			'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
			'<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"' +
				' xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">' +
				comments +
			'</w:comments>'
		);
	}

	function commentsExtendedXml(
		exEntries: Array<{ paraId: string; paraIdParent?: string; done?: boolean }>
	): string {
		const items = exEntries
			.map((e) => {
				const parent = e.paraIdParent ? ` w15:paraIdParent="${e.paraIdParent}"` : '';
				const done = e.done ? ' w15:done="1"' : ' w15:done="0"';
				return `<w15:commentEx w15:paraId="${e.paraId}"${parent}${done}/>`;
			})
			.join('');
		return (
			'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
			'<w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml">' +
				items +
			'</w15:commentsEx>'
		);
	}

	function docWithTwoRanges(): string {
		return docXml(
			'<w:p>' +
				'<w:commentRangeStart w:id="0"/>' +
				'<w:r><w:t>target</w:t></w:r>' +
				'<w:commentRangeEnd w:id="0"/>' +
				'<w:r><w:t xml:space="preserve"> and </w:t></w:r>' +
				'<w:commentRangeStart w:id="1"/>' +
				'<w:r><w:t>other</w:t></w:r>' +
				'<w:commentRangeEnd w:id="1"/>' +
			'</w:p>'
		);
	}

	it('groups a reply with its parent into a single thread', () => {
		const buf = buildDocx({
			'word/document.xml': docWithTwoRanges(),
			'word/comments.xml': commentXmlWithParaIds([
				{ id: '0', author: 'Alice', paraIds: ['A'], texts: ['Parent comment'] },
				{ id: '1', author: 'Bob', paraIds: ['B'], texts: ['Reply to Alice'] }
			]),
			// Bob's paraId (B) references Alice's paraId (A) as parent.
			'word/commentsExtended.xml': commentsExtendedXml([
				{ paraId: 'A' },
				{ paraId: 'B', paraIdParent: 'A' }
			])
		});

		const { threads } = parseDocx(buf);
		expect(threads).toHaveLength(1);
		expect(threads[0].comments).toHaveLength(2);
		expect(threads[0].comments[0].isReply).toBe(false);
		expect(threads[0].comments[0].authorName).toBe('Alice');
		expect(threads[0].comments[1].isReply).toBe(true);
		expect(threads[0].comments[1].authorName).toBe('Bob');
		expect(threads[0].quotedText).toBe('target');
	});

	it('marks threads resolved when all replies are w15:done=1', () => {
		const buf = buildDocx({
			'word/document.xml': docWithTwoRanges(),
			'word/comments.xml': commentXmlWithParaIds([
				{ id: '0', author: 'Alice', paraIds: ['A'], texts: ['Parent'] },
				{ id: '1', author: 'Bob', paraIds: ['B'], texts: ['Reply'] }
			]),
			'word/commentsExtended.xml': commentsExtendedXml([
				{ paraId: 'A', done: true },
				{ paraId: 'B', paraIdParent: 'A', done: true }
			])
		});
		const { threads } = parseDocx(buf);
		expect(threads[0].resolved).toBe(true);
	});

	it('threads by the LAST paragraph of a multi-paragraph root', () => {
		// Key corner case: the thread key is the paraId of the *last* <w:p>
		// inside a comment body, not the first.
		const buf = buildDocx({
			'word/document.xml': docWithTwoRanges(),
			'word/comments.xml': commentXmlWithParaIds([
				{
					id: '0',
					author: 'Alice',
					paraIds: ['A1', 'A2'],
					texts: ['First para', 'Last para']
				},
				{ id: '1', author: 'Bob', paraIds: ['B'], texts: ['Reply'] }
			]),
			// Bob's parent is A2 (the LAST paragraph of Alice's body), not A1.
			'word/commentsExtended.xml': commentsExtendedXml([
				{ paraId: 'A2' },
				{ paraId: 'B', paraIdParent: 'A2' }
			])
		});
		const { threads } = parseDocx(buf);
		expect(threads).toHaveLength(1);
		expect(threads[0].comments).toHaveLength(2);
		expect(threads[0].comments[0].content).toBe('First para\nLast para');
		expect(threads[0].comments[1].content).toBe('Reply');
	});

	it('emits separate threads when no commentsExtended.xml is present AND quotedTexts differ', () => {
		// Without ex-threading, each comment with a distinct quotedText is its
		// own thread. Shared-quotedText merging (exercised in the next
		// describe block) only collapses comments whose ranges cover the same
		// text — distinct ranges stay distinct.
		const buf = buildDocx({
			'word/document.xml': docWithTwoRanges(),
			'word/comments.xml': commentXmlWithParaIds([
				{ id: '0', author: 'Alice', paraIds: ['A'], texts: ['Parent'] },
				{ id: '1', author: 'Bob', paraIds: ['B'], texts: ['Orphan reply'] }
			])
		});
		const { threads } = parseDocx(buf);
		expect(threads).toHaveLength(2);
	});
});

describe('parseDocx — merging comments with shared quotedText', () => {
	/**
	 * Google's .docx export (at least one class of it) flattens reply chains:
	 * each reply becomes its own <w:comment> with its own
	 * <w:commentRangeStart>/<w:commentRangeEnd> wrapping the SAME range of
	 * text as the parent. When commentsExtended.xml isn't present to carry
	 * threading, the adapter should recover the thread structure by merging
	 * comments that share an exact non-empty quotedText.
	 */

	function commentsXmlWithDates(
		entries: Array<{ id: string; author: string; date: string; text: string }>
	): string {
		const comments = entries
			.map(
				(c) =>
					`<w:comment w:id="${c.id}" w:author="${c.author}" w:date="${c.date}" w:initials="A">` +
						`<w:p><w:r><w:t>${c.text}</w:t></w:r></w:p>` +
					'</w:comment>'
			)
			.join('');
		return (
			'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
			'<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"' +
				' xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">' +
				comments +
			'</w:comments>'
		);
	}

	function threeOverlappingRanges(): string {
		// Three Start/End pairs all wrapping the same <w:t>shared</w:t> text.
		return docXml(
			'<w:p>' +
				'<w:commentRangeStart w:id="0"/>' +
				'<w:commentRangeStart w:id="1"/>' +
				'<w:commentRangeStart w:id="2"/>' +
				'<w:r><w:t>shared</w:t></w:r>' +
				'<w:commentRangeEnd w:id="2"/>' +
				'<w:commentRangeEnd w:id="1"/>' +
				'<w:commentRangeEnd w:id="0"/>' +
			'</w:p>'
		);
	}

	it('merges three comments sharing the same quotedText into one thread', () => {
		const buf = buildDocx({
			'word/document.xml': threeOverlappingRanges(),
			'word/comments.xml': commentsXmlWithDates([
				{ id: '0', author: 'Alice', date: '2026-01-01T00:00:00Z', text: 'Root comment' },
				{ id: '1', author: 'Bob', date: '2026-01-02T00:00:00Z', text: 'Reply one' },
				{ id: '2', author: 'Alice', date: '2026-01-03T00:00:00Z', text: 'Reply two' }
			])
			// no commentsExtended.xml
		});
		const { threads } = parseDocx(buf);
		expect(threads).toHaveLength(1);
		expect(threads[0].quotedText).toBe('shared');
		expect(threads[0].comments).toHaveLength(3);
	});

	it('orders merged comments by w:date (earliest first = root)', () => {
		// Order of comment elements in comments.xml is reversed from date order
		// to verify we pick the earliest as root.
		const buf = buildDocx({
			'word/document.xml': threeOverlappingRanges(),
			'word/comments.xml': commentsXmlWithDates([
				{ id: '0', author: 'Alice', date: '2026-01-03T00:00:00Z', text: 'Last' },
				{ id: '1', author: 'Bob', date: '2026-01-01T00:00:00Z', text: 'First' },
				{ id: '2', author: 'Carol', date: '2026-01-02T00:00:00Z', text: 'Middle' }
			])
		});
		const { threads } = parseDocx(buf);
		expect(threads).toHaveLength(1);
		expect(threads[0].comments[0].content).toBe('First');
		expect(threads[0].comments[0].isReply).toBe(false);
		expect(threads[0].comments[1].content).toBe('Middle');
		expect(threads[0].comments[1].isReply).toBe(true);
		expect(threads[0].comments[2].content).toBe('Last');
		expect(threads[0].comments[2].isReply).toBe(true);
	});

	it('does not merge comments with distinct quotedText', () => {
		const buf = buildDocx({
			'word/document.xml': docXml(
				'<w:p>' +
					'<w:commentRangeStart w:id="0"/>' +
					'<w:r><w:t>alpha</w:t></w:r>' +
					'<w:commentRangeEnd w:id="0"/>' +
					'<w:r><w:t xml:space="preserve"> and </w:t></w:r>' +
					'<w:commentRangeStart w:id="1"/>' +
					'<w:r><w:t>beta</w:t></w:r>' +
					'<w:commentRangeEnd w:id="1"/>' +
				'</w:p>'
			),
			'word/comments.xml': commentsXmlWithDates([
				{ id: '0', author: 'A', date: '2026-01-01T00:00:00Z', text: 'on alpha' },
				{ id: '1', author: 'B', date: '2026-01-02T00:00:00Z', text: 'on beta' }
			])
		});
		const { threads } = parseDocx(buf);
		expect(threads).toHaveLength(2);
		expect(threads.map((t) => t.quotedText).sort()).toEqual(['alpha', 'beta']);
	});

	it('does not merge threads that are empty (point comments stay separate)', () => {
		// Empty quotedText comments are each distinct point comments — merging
		// them by shared "" would conflate unrelated anchors. Their thread
		// identity comes from the w:id, not shared (empty) text.
		const buf = buildDocx({
			'word/document.xml': docXml(
				'<w:p>' +
					'<w:r><w:t>no ranges here</w:t></w:r>' +
					'<w:commentRangeEnd w:id="0"/>' + // orphan End
					'<w:commentRangeEnd w:id="1"/>' + // orphan End
				'</w:p>'
			),
			'word/comments.xml': commentsXmlWithDates([
				{ id: '0', author: 'A', date: '2026-01-01T00:00:00Z', text: 'point A' },
				{ id: '1', author: 'B', date: '2026-01-02T00:00:00Z', text: 'point B' }
			])
		});
		const { threads } = parseDocx(buf);
		expect(threads).toHaveLength(2);
	});

	it('does NOT merge comments with the same quotedText that live in different paragraphs', () => {
		// "Sophia" appearing as a range in paragraph 5 is a distinct thread
		// from "Sophia" appearing as a range in paragraph 20. The earlier
		// blanket merge-by-quotedText conflated unrelated conversations from
		// different parts of the doc.
		const buf = buildDocx({
			'word/document.xml': docXml(
				// Paragraph 0: range id=0 wraps "Sophia"
				'<w:p>' +
					'<w:commentRangeStart w:id="0"/>' +
					'<w:r><w:t>Sophia</w:t></w:r>' +
					'<w:commentRangeEnd w:id="0"/>' +
					'<w:r><w:t xml:space="preserve"> and something.</w:t></w:r>' +
				'</w:p>' +
				// Paragraph 1: separator paragraph
				'<w:p><w:r><w:t>intermediate paragraph</w:t></w:r></w:p>' +
				// Paragraph 2: range id=1 also wraps "Sophia"
				'<w:p>' +
					'<w:r><w:t xml:space="preserve">later: </w:t></w:r>' +
					'<w:commentRangeStart w:id="1"/>' +
					'<w:r><w:t>Sophia</w:t></w:r>' +
					'<w:commentRangeEnd w:id="1"/>' +
				'</w:p>'
			),
			'word/comments.xml':
				'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
				'<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"' +
					' xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">' +
					'<w:comment w:id="0" w:author="A" w:date="2026-01-01T00:00:00Z" w:initials="A">' +
						'<w:p><w:r><w:t>first conversation</w:t></w:r></w:p>' +
					'</w:comment>' +
					'<w:comment w:id="1" w:author="B" w:date="2026-01-02T00:00:00Z" w:initials="B">' +
						'<w:p><w:r><w:t>second conversation</w:t></w:r></w:p>' +
					'</w:comment>' +
				'</w:comments>'
		});
		const { threads } = parseDocx(buf);
		expect(threads).toHaveLength(2);
	});

	it('does merge same-paragraph comments with identical quotedText', () => {
		// The merge heuristic should still collapse a reply chain within a
		// single anchored span — this is the primary case where Google's
		// export flattens replies into separate <w:comment> entries.
		const buf = buildDocx({
			'word/document.xml': threeOverlappingRanges(),
			'word/comments.xml': commentsXmlWithDates([
				{ id: '0', author: 'A', date: '2026-01-01T00:00:00Z', text: 'root' },
				{ id: '1', author: 'B', date: '2026-01-02T00:00:00Z', text: 'reply one' },
				{ id: '2', author: 'C', date: '2026-01-03T00:00:00Z', text: 'reply two' }
			])
		});
		const { threads } = parseDocx(buf);
		expect(threads).toHaveLength(1);
	});

	it('respects commentsExtended threading when it is present — no extra merging', () => {
		// When commentsExtended already threads comments, merge-by-quotedText
		// should be a no-op: we don't collapse an ex-grouped thread into
		// another just because they happen to share quote text.
		const buf = buildDocx({
			'word/document.xml': threeOverlappingRanges(),
			'word/comments.xml':
				'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
				'<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"' +
					' xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">' +
					'<w:comment w:id="0" w:author="Alice" w:date="2026-01-01T00:00:00Z" w:initials="A">' +
						'<w:p w14:paraId="PID0"><w:r><w:t>Root</w:t></w:r></w:p>' +
					'</w:comment>' +
					'<w:comment w:id="1" w:author="Bob" w:date="2026-01-02T00:00:00Z" w:initials="B">' +
						'<w:p w14:paraId="PID1"><w:r><w:t>Reply</w:t></w:r></w:p>' +
					'</w:comment>' +
					'<w:comment w:id="2" w:author="Carol" w:date="2026-01-03T00:00:00Z" w:initials="C">' +
						'<w:p w14:paraId="PID2"><w:r><w:t>Separate</w:t></w:r></w:p>' +
					'</w:comment>' +
				'</w:comments>',
			'word/commentsExtended.xml':
				'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
				'<w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml">' +
					'<w15:commentEx w15:paraId="PID0"/>' +
					'<w15:commentEx w15:paraId="PID1" w15:paraIdParent="PID0"/>' +
					'<w15:commentEx w15:paraId="PID2"/>' +
				'</w15:commentsEx>'
		});
		const { threads } = parseDocx(buf);
		// ex groups: (0+1) and (2). But since they all share the same range
		// quotedText "shared", the merge pass collapses the two ex-threaded
		// groups too. We accept this because distinct Drive threads anchored
		// to the exact same text are rare and their visual output collision
		// would otherwise be worse (stacked anchors).
		expect(threads).toHaveLength(1);
		expect(threads[0].comments).toHaveLength(3);
	});
});
