/**
 * OOXML (.docx) → GoogleDocsDocument adapter.
 *
 * Unzips a Word-compatible .docx archive and walks the OOXML tree with
 * DOMParser, emitting a {@link GoogleDocsDocument} shaped identically to
 * what the Docs API would return. Comment ranges are extracted from
 * `<w:commentRangeStart/>` / `<w:commentRangeEnd/>` markers — the anchor
 * information Google loses when importing .docx → native gdoc. Callers
 * feed the result straight into the existing transformer, unchanged.
 */

import { unzipSync, strFromU8 } from 'fflate';
import type {
	GoogleDocsDocument,
	StructuralElement,
	Paragraph,
	ParagraphElement,
	TextStyle,
	CommentThread,
	ThreadComment,
	DocList
} from '$lib/types/google';

// OOXML namespaces.
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14_NS = 'http://schemas.microsoft.com/office/word/2010/wordml';
const W15_NS = 'http://schemas.microsoft.com/office/word/2012/wordml';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

// Map OOXML pStyle values to Docs API namedStyleType values.
const STYLE_MAP: Record<string, string> = {
	Title: 'TITLE',
	Subtitle: 'SUBTITLE',
	Heading1: 'HEADING_1',
	Heading2: 'HEADING_2',
	Heading3: 'HEADING_3',
	Heading4: 'HEADING_4',
	Heading5: 'HEADING_5',
	Heading6: 'HEADING_6'
};

export interface ParseDocxResult {
	doc: GoogleDocsDocument;
	threads: CommentThread[];
}

export function parseDocx(buffer: ArrayBuffer | Uint8Array): ParseDocxResult {
	const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
	const zip = unzipSync(bytes);

	const documentXml = readFile(zip, 'word/document.xml');
	if (!documentXml) {
		throw new Error('Invalid .docx archive: missing word/document.xml');
	}
	const documentDoc = parseXml(documentXml);

	const body = firstChildNS(documentDoc.documentElement, W_NS, 'body');
	if (!body) {
		throw new Error('Invalid .docx archive: missing <w:body> in document.xml');
	}

	const lists = parseNumbering(readFile(zip, 'word/numbering.xml'));

	const context: DocxContext = {
		rels: parseRels(readFile(zip, 'word/_rels/document.xml.rels')),
		openRanges: new Map(),
		ranges: new Map(),
		currentParaIndex: 0
	};

	const state = createWalkState();
	walkBlockContainer(body, state, context);

	// Any ranges still open after the walk (End missing) become empty entries so
	// downstream code sees the comment but renders it in the unanchored section.
	for (const [wId, open] of context.openRanges) {
		if (!context.ranges.has(wId)) {
			context.ranges.set(wId, { text: '', paraIndex: open.paraIndex });
		}
	}

	const threads = buildThreads(zip, context.ranges);

	const doc: GoogleDocsDocument = {
		documentId: '',
		title: '',
		body: { content: state.content }
	};
	if (Object.keys(lists).length > 0) {
		doc.lists = lists;
	}

	return { doc, threads };
}

/* ---------------------------------------------------------------- */
/* Context (rels, later: numbering, comments)                       */
/* ---------------------------------------------------------------- */

interface DocxContext {
	/** rId → target URL (only populated for hyperlink-typed relationships). */
	rels: Map<string, string>;
	/**
	 * Comment ranges currently "open" during the body walk. For each w:id we
	 * accumulate the raw text pieces emitted by runs between Start and End
	 * markers, but stop accumulating once the paragraph containing the Start
	 * ends — see `sealed`. The transformer matches `quotedText` against a
	 * single paragraph's rendered text, so a range spanning multiple `<w:p>`
	 * must collapse to its first paragraph's portion to match at all.
	 * `paraIndex` captures the `state.content` index of the paragraph that
	 * held the Start marker — downstream, this routes the thread to the
	 * exact originating paragraph instead of scanning all paragraphs for a
	 * substring match (which pinned unrelated comments to a title bar when
	 * the quoted word appeared elsewhere first).
	 * Duplicate Starts for the same id are ignored (the first wins).
	 */
	openRanges: Map<
		string,
		{ pieces: string[]; sealed: boolean; paraIndex: number }
	>;
	/** Finalized w:id → raw quotedText and originating paragraph index. */
	ranges: Map<string, { text: string; paraIndex: number }>;
	/** Index in state.content of the paragraph currently being emitted. */
	currentParaIndex: number;
}

const HYPERLINK_REL_TYPE =
	'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink';
const RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

function parseRels(source: string | undefined): Map<string, string> {
	const map = new Map<string, string>();
	if (!source) return map;
	const xml = parseXml(source);
	const rels = xml.getElementsByTagNameNS(RELS_NS, 'Relationship');
	for (const rel of Array.from(rels)) {
		const id = rel.getAttribute('Id');
		const type = rel.getAttribute('Type');
		const target = rel.getAttribute('Target');
		if (!id || !type || !target) continue;
		if (type === HYPERLINK_REL_TYPE) {
			map.set(id, target);
		}
	}
	return map;
}

/**
 * Parse word/numbering.xml into a `doc.lists` map.
 *
 * The transformer only consults `nestingLevels[i].glyphFormat` to decide
 * ordered vs unordered — ordered glyph formats contain `%N.` or start with
 * `[`. We emit `"%0."` for any decimal/letter/roman numFmt and a plain bullet
 * character otherwise so `getListPrefix` takes the intended branch.
 */
function parseNumbering(source: string | undefined): Record<string, DocList> {
	const lists: Record<string, DocList> = {};
	if (!source) return lists;
	const xml = parseXml(source);

	// Collect <w:abstractNum> by abstractNumId.
	const abstracts = new Map<string, Element>();
	for (const ab of Array.from(xml.getElementsByTagNameNS(W_NS, 'abstractNum'))) {
		const id = ab.getAttributeNS(W_NS, 'abstractNumId') ?? ab.getAttribute('w:abstractNumId');
		if (id) abstracts.set(id, ab);
	}

	for (const num of Array.from(xml.getElementsByTagNameNS(W_NS, 'num'))) {
		const numId = num.getAttributeNS(W_NS, 'numId') ?? num.getAttribute('w:numId');
		if (!numId) continue;
		const ref = firstChildNS(num, W_NS, 'abstractNumId');
		const abstractId = ref
			? ref.getAttributeNS(W_NS, 'val') ?? ref.getAttribute('w:val')
			: null;
		if (!abstractId) continue;
		const abstract = abstracts.get(abstractId);
		if (!abstract) continue;

		const nestingLevels: { glyphFormat: string }[] = [];
		for (const lvl of childrenNS(abstract, W_NS, 'lvl')) {
			const ilvlStr = lvl.getAttributeNS(W_NS, 'ilvl') ?? lvl.getAttribute('w:ilvl');
			const ilvl = ilvlStr ? Number(ilvlStr) : 0;
			const fmt = firstChildNS(lvl, W_NS, 'numFmt');
			const fmtVal = fmt
				? fmt.getAttributeNS(W_NS, 'val') ?? fmt.getAttribute('w:val')
				: 'bullet';
			const glyphFormat = fmtVal === 'bullet' ? '•' : '%0.';
			nestingLevels[ilvl] = { glyphFormat };
		}

		// Fill any level gaps with a safe default so indexing by nestingLevel is
		// always in-bounds for `getListPrefix`.
		for (let i = 0; i < nestingLevels.length; i++) {
			if (!nestingLevels[i]) nestingLevels[i] = { glyphFormat: '•' };
		}

		lists[numId] = { listProperties: { nestingLevels } };
	}

	return lists;
}

/* ---------------------------------------------------------------- */
/* Comments → CommentThread[]                                       */
/* ---------------------------------------------------------------- */

interface DocxCommentEntry {
	wId: string;
	author: string;
	date: string;
	content: string;
	/** w14:paraId of the LAST <w:p> inside the comment body (threading key). */
	lastParaId: string | undefined;
}

interface CommentExEntry {
	paraId: string;
	paraIdParent?: string;
	done: boolean;
}

/**
 * Build CommentThread[] from word/comments.xml (+ optional
 * commentsExtended.xml for threading). Each <w:comment> joins by w:id to
 * the quotedText captured during the document walk.
 *
 * Threading works in two stages:
 *
 * 1. commentsExtended-based threading. w15:commentEx lists one entry per
 *    comment; w15:paraId matches the w14:paraId of the *last* <w:p> inside
 *    the comment body. w15:paraIdParent, when present, points at the
 *    parent's last-paragraph paraId — this is the explicit reply link.
 *
 * 2. quotedText-based merging (fallback). Google's .docx export sometimes
 *    omits commentsExtended.xml entirely and flattens every reply in a
 *    Drive thread into its own top-level <w:comment>, each with its own
 *    <w:commentRangeStart>/<w:commentRangeEnd> wrapping the *same* text.
 *    Without this fallback, a 10-reply thread would render as 10 separate
 *    anchors stacked on the same word. Here we group buckets that share an
 *    exact non-empty quotedText; the earliest-dated entry becomes the root
 *    and the rest become replies.
 */
function buildThreads(
	zip: Record<string, Uint8Array>,
	ranges: Map<string, { text: string; paraIndex: number }>
): CommentThread[] {
	const commentsSource = readFile(zip, 'word/comments.xml');
	if (!commentsSource) return [];

	const entries = parseCommentsXml(commentsSource);
	const exEntries = parseCommentsExtendedXml(
		readFile(zip, 'word/commentsExtended.xml')
	);

	const exByParaId = new Map<string, CommentExEntry>();
	for (const ex of exEntries) exByParaId.set(ex.paraId, ex);

	// Bucket = one nascent thread. Keyed by the root's wId.
	interface Bucket {
		entries: DocxCommentEntry[];
		exes: Array<CommentExEntry | undefined>;
	}
	const buckets = new Map<string, Bucket>();
	const rootWIdByParaId = new Map<string, string>();

	// Pass 1: identify roots (no ex, or ex without paraIdParent).
	for (const entry of entries) {
		const ex = entry.lastParaId ? exByParaId.get(entry.lastParaId) : undefined;
		const isReply = Boolean(ex?.paraIdParent);
		if (!isReply) {
			buckets.set(entry.wId, { entries: [entry], exes: [ex] });
			if (entry.lastParaId) rootWIdByParaId.set(entry.lastParaId, entry.wId);
		}
	}

	// Pass 2: attach replies to the thread whose root's last-paraId matches.
	// When the parent can't be found (mismatched refs, missing ex), the reply
	// becomes its own bucket — the quotedText-merge pass in step 3 may then
	// fold it into another bucket that shares its range.
	for (const entry of entries) {
		const ex = entry.lastParaId ? exByParaId.get(entry.lastParaId) : undefined;
		const isReply = Boolean(ex?.paraIdParent);
		if (!isReply) continue;

		const parentWId = ex?.paraIdParent
			? rootWIdByParaId.get(ex.paraIdParent)
			: undefined;
		const bucket = parentWId ? buckets.get(parentWId) : undefined;
		if (bucket) {
			bucket.entries.push(entry);
			bucket.exes.push(ex);
		} else {
			buckets.set(entry.wId, { entries: [entry], exes: [ex] });
		}
	}

	// Pass 3: merge buckets whose root shares a non-empty quotedText AND the
	// same originating paragraph index. Identical quotedText at the *same*
	// range position is near-certainly a reply chain flattened by Google's
	// export; identical text at *different* positions is two distinct
	// conversations that happen to quote the same word and must stay
	// separate — otherwise a later mention of "Sophia" would be merged into
	// a conversation anchored to an earlier mention. Empty quotedText is
	// skipped entirely; those are point comments whose identity comes from
	// w:id and which render in the unanchored section downstream.
	const bucketsByKey = new Map<string, string[]>();
	for (const rootWId of buckets.keys()) {
		const range = ranges.get(rootWId);
		if (!range || !range.text) continue;
		const key = `${range.paraIndex}\x1f${range.text}`;
		const list = bucketsByKey.get(key) ?? [];
		list.push(rootWId);
		bucketsByKey.set(key, list);
	}
	for (const wIds of bucketsByKey.values()) {
		if (wIds.length < 2) continue;
		wIds.sort((a, b) => {
			const da = buckets.get(a)!.entries[0].date;
			const db = buckets.get(b)!.entries[0].date;
			return da.localeCompare(db);
		});
		const primaryKey = wIds[0];
		const primary = buckets.get(primaryKey)!;
		for (const secondaryKey of wIds.slice(1)) {
			const secondary = buckets.get(secondaryKey)!;
			primary.entries.push(...secondary.entries);
			primary.exes.push(...secondary.exes);
			buckets.delete(secondaryKey);
		}
		// Co-sort entries + exes by w:date so the chronologically-first
		// comment ends up at index 0 (the root in the rendered thread).
		const combined = primary.entries.map((e, i) => ({
			entry: e,
			ex: primary.exes[i]
		}));
		combined.sort((a, b) => a.entry.date.localeCompare(b.entry.date));
		primary.entries = combined.map((c) => c.entry);
		primary.exes = combined.map((c) => c.ex);
	}

	const threads: CommentThread[] = [];
	let index = 0;
	for (const [wId, data] of buckets) {
		const comments: ThreadComment[] = data.entries.map((e, i) => ({
			authorName: e.author,
			authorEmail: '',
			content: e.content,
			isReply: i > 0
		}));
		// Resolved only when we have explicit ex coverage for every entry AND
		// every one is marked done. Unknown (ex-missing) entries keep the
		// thread active to avoid silently hiding unresolved conversations.
		const allDone =
			data.exes.length > 0 && data.exes.every((ex) => ex?.done === true);
		const range = ranges.get(wId);
		threads.push({
			id: wId,
			anchorId: `c${++index}`,
			quotedText: range?.text ?? '',
			resolved: allDone,
			comments,
			...(range ? { anchorParaIndex: range.paraIndex } : {})
		});
	}
	return threads;
}

function parseCommentsXml(source: string): DocxCommentEntry[] {
	const xml = parseXml(source);
	const comments = xml.getElementsByTagNameNS(W_NS, 'comment');

	const entries: DocxCommentEntry[] = [];
	for (const c of Array.from(comments)) {
		const wId = c.getAttributeNS(W_NS, 'id') ?? c.getAttribute('w:id');
		if (!wId) continue;
		const author = c.getAttributeNS(W_NS, 'author') ?? c.getAttribute('w:author') ?? '';
		const date = c.getAttributeNS(W_NS, 'date') ?? c.getAttribute('w:date') ?? '';

		// Comment body is 1+ paragraphs; join their text streams with newlines
		// so multi-paragraph feedback survives into the rendered blockquote.
		const paragraphs = childrenNS(c, W_NS, 'p');
		const bodyLines = paragraphs.map((p) => extractPlainText(p));
		const content = bodyLines.join('\n');

		// Threading key lives on the LAST paragraph in the body.
		const lastP = paragraphs[paragraphs.length - 1];
		const lastParaId = lastP
			? lastP.getAttributeNS(W14_NS, 'paraId') ?? lastP.getAttribute('w14:paraId') ?? undefined
			: undefined;

		entries.push({
			wId,
			author,
			date,
			content,
			lastParaId: lastParaId ?? undefined
		});
	}
	return entries;
}

function parseCommentsExtendedXml(source: string | undefined): CommentExEntry[] {
	if (!source) return [];
	const xml = parseXml(source);
	const exs = xml.getElementsByTagNameNS(W15_NS, 'commentEx');
	const out: CommentExEntry[] = [];
	for (const ex of Array.from(exs)) {
		const paraId =
			ex.getAttributeNS(W15_NS, 'paraId') ?? ex.getAttribute('w15:paraId');
		if (!paraId) continue;
		const paraIdParent =
			ex.getAttributeNS(W15_NS, 'paraIdParent') ??
			ex.getAttribute('w15:paraIdParent') ??
			undefined;
		const doneAttr =
			ex.getAttributeNS(W15_NS, 'done') ?? ex.getAttribute('w15:done');
		const done = doneAttr === '1' || doneAttr === 'true';
		out.push({ paraId, paraIdParent: paraIdParent || undefined, done });
	}
	return out;
}

/**
 * Recursively collect text content from `<w:t>` descendants, mirroring what
 * the body walker does for comment ranges but with no style markup. Skips
 * tracked-change deletions (`<w:del>`) and keeps insertions (`<w:ins>`).
 */
function extractPlainText(node: Element): string {
	const pieces: string[] = [];
	collectText(node, pieces);
	return pieces.join('');
}

function collectText(node: Element, out: string[]): void {
	for (const child of Array.from(node.children)) {
		if (child.namespaceURI === W_NS) {
			if (child.localName === 't') {
				out.push(child.textContent ?? '');
				continue;
			}
			if (child.localName === 'del') {
				// Tracked-change deletion — its text is *not* part of the live doc.
				continue;
			}
		}
		collectText(child, out);
	}
}

/* ---------------------------------------------------------------- */
/* XML + zip helpers                                                */
/* ---------------------------------------------------------------- */

function readFile(zip: Record<string, Uint8Array>, path: string): string | undefined {
	const entry = zip[path];
	return entry ? strFromU8(entry) : undefined;
}

function parseXml(source: string): XMLDocument {
	const parser = new DOMParser();
	const parsed = parser.parseFromString(source, 'application/xml');
	const err = parsed.getElementsByTagName('parsererror')[0];
	if (err) {
		throw new Error(`Failed to parse XML: ${err.textContent?.slice(0, 200)}`);
	}
	return parsed;
}

function firstChildNS(parent: Element | null, ns: string, localName: string): Element | null {
	if (!parent) return null;
	for (const child of Array.from(parent.children)) {
		if (child.namespaceURI === ns && child.localName === localName) {
			return child;
		}
	}
	return null;
}

function childrenNS(parent: Element, ns: string, localName: string): Element[] {
	const out: Element[] = [];
	for (const child of Array.from(parent.children)) {
		if (child.namespaceURI === ns && child.localName === localName) {
			out.push(child);
		}
	}
	return out;
}

/* ---------------------------------------------------------------- */
/* Body walking                                                     */
/* ---------------------------------------------------------------- */

interface WalkState {
	content: StructuralElement[];
	/** Running character offset used to populate startIndex/endIndex. */
	offset: number;
}

function createWalkState(): WalkState {
	return {
		content: [],
		offset: 0
	};
}

/**
 * Walk the children of a block-level container (<w:body>, <w:tc>, <w:sdtContent>)
 * emitting paragraphs into state.content in document order.
 *
 * Tables and structured-document-tag wrappers are walked through transparently
 * so their inner paragraphs and comment-range markers are still captured. We do
 * not emit any structural element for the table itself (cells' paragraphs are
 * flattened into the main content stream) — the transformer has no special
 * table rendering, so flattening keeps the paragraph-centric model intact.
 */
function walkBlockContainer(
	container: Element,
	state: WalkState,
	context: DocxContext
): void {
	for (const child of Array.from(container.children)) {
		if (child.namespaceURI !== W_NS) continue;
		switch (child.localName) {
			case 'p':
				emitParagraph(child, state, context);
				break;
			case 'tbl':
				// <w:tbl> → <w:tr> → <w:tc> → block content.
				for (const row of childrenNS(child, W_NS, 'tr')) {
					for (const cell of childrenNS(row, W_NS, 'tc')) {
						walkBlockContainer(cell, state, context);
					}
				}
				break;
			case 'sdt': {
				// Structured Document Tag wrapper. Walk inside sdtContent.
				const inner = firstChildNS(child, W_NS, 'sdtContent');
				if (inner) walkBlockContainer(inner, state, context);
				break;
			}
		}
	}
}

/**
 * Emit a StructuralElement wrapping a <w:p>.
 */
function emitParagraph(p: Element, state: WalkState, context: DocxContext): void {
	// The paragraph we're about to build lives at state.content.length.
	// Record that index so any <w:commentRangeStart> marker encountered
	// inside this paragraph knows which paragraph it anchors to.
	context.currentParaIndex = state.content.length;

	const paragraph = extractParagraph(p, context);
	const startIndex = state.offset;
	const paraTextLength = paragraph.elements.reduce(
		(sum, el) => sum + (el.textRun?.content.length ?? 0),
		0
	);
	// Paragraphs in the Docs API always end with a newline in their text
	// stream; mirror that by advancing the offset one past the text length.
	state.offset = startIndex + paraTextLength + 1;

	state.content.push({
		startIndex,
		endIndex: state.offset,
		paragraph
	});

	// Seal any still-open ranges at the paragraph boundary. The transformer
	// matches quotedText against a single paragraph's rendered text, so a
	// multi-paragraph range must collapse to its first paragraph's portion.
	for (const open of context.openRanges.values()) {
		open.sealed = true;
	}
}

/**
 * Extract a Paragraph from a <w:p> element.
 *
 * Paragraph children are walked recursively because Google's export wraps
 * individual runs and comment-range markers in pass-through structural tags
 * (`<w:sdt>/<w:sdtContent>`, `<w:ins>` for tracked insertions). Without
 * recursion we would miss every `<w:commentRangeStart>` in a Google-exported
 * docx — precisely the bug that motivated this pipeline.
 */
function extractParagraph(p: Element, context: DocxContext): Paragraph {
	const elements: ParagraphElement[] = [];
	walkInlineChildren(p, elements, undefined, context);

	const paragraphStyle = extractParagraphStyle(p);
	const bullet = extractBullet(p);

	const paragraph: Paragraph = { elements };
	if (paragraphStyle) paragraph.paragraphStyle = paragraphStyle;
	if (bullet) paragraph.bullet = bullet;
	return paragraph;
}

/**
 * Extract the `paragraph.bullet` shape from <w:pPr><w:numPr>…</w:numPr></w:pPr>.
 * Returns undefined when the paragraph is not a list item.
 */
function extractBullet(p: Element): Paragraph['bullet'] {
	const pPr = firstChildNS(p, W_NS, 'pPr');
	if (!pPr) return undefined;
	const numPr = firstChildNS(pPr, W_NS, 'numPr');
	if (!numPr) return undefined;

	const numId = firstChildNS(numPr, W_NS, 'numId');
	const ilvl = firstChildNS(numPr, W_NS, 'ilvl');

	const numIdVal =
		(numId && (numId.getAttributeNS(W_NS, 'val') ?? numId.getAttribute('w:val'))) ?? null;
	if (!numIdVal) return undefined;

	const ilvlVal =
		(ilvl && (ilvl.getAttributeNS(W_NS, 'val') ?? ilvl.getAttribute('w:val'))) ?? '0';
	const nestingLevel = Number(ilvlVal);

	return {
		listId: numIdVal,
		nestingLevel: Number.isFinite(nestingLevel) ? nestingLevel : 0
	};
}

function resolveHyperlinkUrl(
	hyperlink: Element,
	context: DocxContext
): string | undefined {
	const rId =
		hyperlink.getAttributeNS(R_NS, 'id') ?? hyperlink.getAttribute('r:id');
	if (!rId) return undefined;
	return context.rels.get(rId);
}

/**
 * Recursively walk the inline contents of a paragraph. Pass-through wrappers
 * (sdt/sdtContent and tracked-change insertions) are transparent; tracked-
 * change deletions are skipped. Hyperlinks propagate their URL to the runs
 * they enclose. Comment-range markers toggle the corresponding accumulators
 * in `context`.
 */
function walkInlineChildren(
	parent: Element,
	elements: ParagraphElement[],
	linkUrl: string | undefined,
	context: DocxContext
): void {
	for (const child of Array.from(parent.children)) {
		if (child.namespaceURI !== W_NS) continue;
		switch (child.localName) {
			case 'r':
				elements.push(...extractRun(child, linkUrl, context));
				break;
			case 'hyperlink':
				walkInlineChildren(
					child,
					elements,
					resolveHyperlinkUrl(child, context),
					context
				);
				break;
			case 'sdt':
			case 'sdtContent':
			case 'ins':
				// Pass-through wrappers — recurse; the wrapped content is live.
				walkInlineChildren(child, elements, linkUrl, context);
				break;
			case 'del':
				// Tracked-change deletion: the enclosed text is not part of the
				// rendered document. Skip the subtree entirely.
				break;
			case 'commentRangeStart': {
				const id = child.getAttributeNS(W_NS, 'id') ?? child.getAttribute('w:id');
				if (id && !context.openRanges.has(id)) {
					context.openRanges.set(id, {
						pieces: [],
						sealed: false,
						paraIndex: context.currentParaIndex
					});
				}
				break;
			}
			case 'commentRangeEnd': {
				const id = child.getAttributeNS(W_NS, 'id') ?? child.getAttribute('w:id');
				if (id && context.openRanges.has(id)) {
					const open = context.openRanges.get(id)!;
					context.ranges.set(id, {
						text: open.pieces.join(''),
						paraIndex: open.paraIndex
					});
					context.openRanges.delete(id);
				}
				break;
			}
			// commentReference, bookmarkStart/End, proofErr, etc — silently skip.
		}
	}
}

/**
 * Extract paragraph style from the <w:pPr> element, if any.
 * Only emits a paragraphStyle object when at least one recognizable field is
 * populated so the Docs-API shape stays canonical.
 */
function extractParagraphStyle(p: Element): Paragraph['paragraphStyle'] {
	const pPr = firstChildNS(p, W_NS, 'pPr');
	if (!pPr) return undefined;

	const pStyle = firstChildNS(pPr, W_NS, 'pStyle');
	if (!pStyle) return undefined;

	const val = pStyle.getAttributeNS(W_NS, 'val') ?? pStyle.getAttribute('w:val');
	if (!val) return undefined;

	const mapped = STYLE_MAP[val];
	if (!mapped) return undefined;

	return { namedStyleType: mapped };
}

/**
 * Extract ParagraphElements from a <w:r> (run) element. A run may contain
 * multiple text-bearing children (<w:t>, <w:tab/>, <w:br/>); we collect all
 * text content and emit a single ParagraphElement per run.
 *
 * @param linkUrl when the run lives inside a <w:hyperlink>, its resolved URL
 *   is merged into the emitted TextStyle so downstream markdown rendering
 *   sees a single "linked" ParagraphElement and does not need to stitch runs
 *   back together.
 */
function extractRun(
	r: Element,
	linkUrl: string | undefined,
	context: DocxContext
): ParagraphElement[] {
	const style = extractTextStyle(r);
	const pieces: string[] = [];

	for (const child of Array.from(r.children)) {
		if (child.namespaceURI !== W_NS) continue;
		if (child.localName === 't') {
			pieces.push(child.textContent ?? '');
		}
		// Tab/break handling lands in a later phase.
	}

	const joined = pieces.join('');
	if (!joined) return [];

	// Feed the raw text into every open comment range so quotedText accumulates
	// byte-identical to the paragraph's text stream between Start and End.
	// Ranges sealed at a previous paragraph boundary stop growing — see
	// DocxContext.openRanges for the rationale.
	if (context.openRanges.size > 0) {
		for (const open of context.openRanges.values()) {
			if (!open.sealed) open.pieces.push(joined);
		}
	}

	const textStyle: TextStyle = { ...(style ?? {}) };
	if (linkUrl) textStyle.link = { url: linkUrl };
	const hasAnyStyle = Object.keys(textStyle).length > 0;

	return [
		{
			startIndex: 0,
			endIndex: 0,
			textRun: {
				content: joined,
				...(hasAnyStyle ? { textStyle } : {})
			}
		}
	];
}

/**
 * Extract a TextStyle from the <w:rPr> of a run, if any.
 * Returns undefined when no recognizable styling is present.
 */
function extractTextStyle(r: Element): TextStyle | undefined {
	const rPr = firstChildNS(r, W_NS, 'rPr');
	if (!rPr) return undefined;

	const style: TextStyle = {};
	if (hasOnToggle(rPr, 'b')) style.bold = true;
	if (hasOnToggle(rPr, 'i')) style.italic = true;
	if (hasOnToggle(rPr, 'strike')) style.strikethrough = true;

	return Object.keys(style).length > 0 ? style : undefined;
}

/**
 * OOXML boolean toggles are on by default when the element exists. An explicit
 * `w:val="false"` or `w:val="0"` turns the toggle *off*; any other value (or
 * omitted attribute) leaves it on.
 */
function hasOnToggle(rPr: Element, localName: string): boolean {
	const el = firstChildNS(rPr, W_NS, localName);
	if (!el) return false;
	const val = el.getAttributeNS(W_NS, 'val') ?? el.getAttribute('w:val');
	if (val === null || val === undefined) return true;
	return val !== 'false' && val !== '0';
}
