/**
 * Diagnostic for "zero comments rendered" bug (see DEBUG_MISSING_COMMENTS.md).
 *
 * Fetches a doc + its comments via the same endpoints the app uses, then
 * reports how each comment fares against the transformer's literal-substring
 * anchor match. Also tries a normalized fuzzy match so we can see whether the
 * drops are pure Unicode/whitespace mismatches or something deeper.
 *
 * Usage:
 *   echo "ACCESS_TOKEN=ya29..." >> .env.local
 *   echo "DOC_ID=13HZmooT2yNQXnp4u9AKauUeTsn-T9BBtzZipqzK64_k" >> .env.local
 *   node scripts/diagnose-comments.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const name of ['.env.local', 'env.local']) {
	const envPath = path.join(__dirname, '..', name);
	if (!fs.existsSync(envPath)) continue;
	for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
		const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
		if (m && !(m[1] in process.env)) {
			process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
		}
	}
}

const token = process.env.ACCESS_TOKEN;
const docId = process.env.DOC_ID || '13HZmooT2yNQXnp4u9AKauUeTsn-T9BBtzZipqzK64_k';

if (!token) {
	console.error('Missing ACCESS_TOKEN. Put it in .env.local: ACCESS_TOKEN=ya29...');
	process.exit(1);
}

console.log(`Doc ID: ${docId}`);

// --- 1. Fetch doc metadata + content -----------------------------------

const metaRes = await fetch(
	`https://www.googleapis.com/drive/v3/files/${docId}?fields=id,name,mimeType`,
	{ headers: { Authorization: `Bearer ${token}` } }
);
if (!metaRes.ok) {
	console.error(`Drive metadata fetch failed: ${metaRes.status} ${await metaRes.text()}`);
	process.exit(1);
}
const meta = await metaRes.json();
console.log(`File: "${meta.name}" (mime: ${meta.mimeType})`);

const docRes = await fetch(`https://docs.googleapis.com/v1/documents/${docId}`, {
	headers: { Authorization: `Bearer ${token}` }
});
if (!docRes.ok) {
	console.error(`Docs fetch failed: ${docRes.status} ${await docRes.text()}`);
	process.exit(1);
}
const doc = await docRes.json();

// --- 2. Fetch all comments (paginated) ---------------------------------

const allComments = [];
let pageToken;
do {
	const u = new URL(`https://www.googleapis.com/drive/v3/files/${docId}/comments`);
	u.searchParams.set('fields', '*');
	u.searchParams.set('pageSize', '100');
	if (pageToken) u.searchParams.set('pageToken', pageToken);
	const r = await fetch(u, { headers: { Authorization: `Bearer ${token}` } });
	if (!r.ok) {
		console.error(`Comments fetch failed: ${r.status} ${await r.text()}`);
		process.exit(1);
	}
	const page = await r.json();
	allComments.push(...(page.comments || []));
	pageToken = page.nextPageToken;
} while (pageToken);

// --- 3. Reproduce transformer logic ------------------------------------

function decodeEntitiesCurrent(s) {
	// Exactly what transformer.ts:383 does today
	return s
		.replace(/&#39;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)));
}

// A richer decoder for diagnostic comparison only.
function decodeEntitiesFull(s) {
	const named = {
		nbsp: '\u00A0',
		ensp: '\u2002',
		emsp: '\u2003',
		thinsp: '\u2009',
		mdash: '\u2014',
		ndash: '\u2013',
		hellip: '\u2026',
		lsquo: '\u2018',
		rsquo: '\u2019',
		sbquo: '\u201A',
		ldquo: '\u201C',
		rdquo: '\u201D',
		bdquo: '\u201E',
		prime: '\u2032',
		Prime: '\u2033',
		bull: '\u2022',
		middot: '\u00B7',
		laquo: '\u00AB',
		raquo: '\u00BB',
		trade: '\u2122',
		copy: '\u00A9',
		reg: '\u00AE',
		apos: "'",
		quot: '"',
		amp: '&',
		lt: '<',
		gt: '>'
	};
	return s
		.replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
		.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n)))
		.replace(/&([a-zA-Z]+);/g, (m, name) => (name in named ? named[name] : m));
}

function normalizeForFuzzy(s) {
	return s
		.normalize('NFKC')
		.replace(/[\u2018\u2019\u201B\u2032]/g, "'")
		.replace(/[\u201C\u201D\u201F\u2033]/g, '"')
		.replace(/[\u2013\u2014]/g, '-')
		.replace(/\u2026/g, '...')
		.replace(/\u00A0/g, ' ')
		.replace(/\u00AD/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function fingerprint(s) {
	return [...s]
		.map((c) => {
			const n = c.codePointAt(0);
			if (n === 0x0a) return '\\n';
			if (n === 0x0d) return '\\r';
			if (n === 0x09) return '\\t';
			if (n >= 0x20 && n < 0x7f) return c;
			return `\\u${n.toString(16).padStart(4, '0')}`;
		})
		.join('');
}

function extractText(elements) {
	return (elements || []).map((e) => e.textRun?.content ?? '').join('');
}

const paragraphs = [];
for (const el of doc.body?.content ?? []) {
	if (!el.paragraph) continue;
	const raw = extractText(el.paragraph.elements);
	const text = raw.replace(/\n$/, '');
	if (text.trim()) paragraphs.push(text);
}

console.log(`Non-empty paragraphs: ${paragraphs.length}`);

// --- 4. Comment bucket stats -------------------------------------------

const buckets = {
	total: allComments.length,
	deleted: allComments.filter((c) => c.deleted).length,
	resolved: allComments.filter((c) => c.resolved).length,
	resolvedAndQuoted: allComments.filter((c) => c.resolved && c.quotedFileContent).length,
	withQuote: allComments.filter((c) => c.quotedFileContent).length,
	withoutQuote: allComments.filter((c) => !c.quotedFileContent).length,
	withAnchor: allComments.filter((c) => c.anchor).length
};
console.log('Comment buckets:');
for (const [k, v] of Object.entries(buckets)) console.log(`  ${k}: ${v}`);

// Mirror convertDriveComments filter
const eligible = allComments.filter((c) => !c.resolved || c.quotedFileContent);
console.log(`Eligible (after convertDriveComments filter): ${eligible.length}`);

// --- 5. Anchor-match evaluation ---------------------------------------

let matchedLiteral = 0;
let matchedFuzzy = 0;
let matchedFullDecode = 0;
let emptyQuote = 0;
let neverMatch = 0;
const samples = [];

for (const c of eligible) {
	const rawQ = c.quotedFileContent?.value ?? '';
	if (!rawQ) {
		emptyQuote++;
		continue;
	}
	const qCurrent = decodeEntitiesCurrent(rawQ);
	const qFull = decodeEntitiesFull(rawQ);

	const hitLiteral = paragraphs.findIndex((p) => p.includes(qCurrent));
	if (hitLiteral >= 0) {
		matchedLiteral++;
		continue;
	}

	const hitFullDecode = paragraphs.findIndex((p) => p.includes(qFull));
	if (hitFullDecode >= 0) {
		matchedFullDecode++;
		samples.push({ kind: 'fullDecodeOnly', c, qCurrent, qFull, paraIdx: hitFullDecode });
		continue;
	}

	const nq = normalizeForFuzzy(qFull);
	const hitFuzzy = paragraphs.findIndex((p) => normalizeForFuzzy(p).includes(nq));
	if (hitFuzzy >= 0) {
		matchedFuzzy++;
		samples.push({ kind: 'fuzzyOnly', c, qCurrent, qFull, paraIdx: hitFuzzy });
		continue;
	}

	neverMatch++;
	samples.push({ kind: 'never', c, qCurrent, qFull, paraIdx: -1 });
}

console.log('\nAnchor match results:');
console.log(`  matched via current (literal .includes with current decoder): ${matchedLiteral}`);
console.log(`  would match if we added full entity decoder (&nbsp; &mdash; etc):  ${matchedFullDecode}`);
console.log(`  would match with NFKC + smart-quote + NBSP + whitespace fuzz:     ${matchedFuzzy}`);
console.log(`  empty quotedText (already unanchorable):                          ${emptyQuote}`);
console.log(`  STILL no match after fuzz — genuinely orphaned:                   ${neverMatch}`);

// --- 6. Detailed samples ----------------------------------------------

function showSample(s, maxLen = 200) {
	const q = s.qFull.length > maxLen ? s.qFull.slice(0, maxLen) + '…' : s.qFull;
	const qRaw = s.c.quotedFileContent?.value ?? '';
	console.log(`\n  [${s.kind}] commentId=${s.c.id} resolved=${s.c.resolved} anchor=${s.c.anchor ?? '-'}`);
	console.log(`    quotedText raw   : ${JSON.stringify(qRaw.slice(0, maxLen))}`);
	console.log(`    quotedText (full-decoded): ${JSON.stringify(q)}`);
	console.log(`    fp(quoted)       : ${fingerprint(q)}`);
	if (s.paraIdx >= 0) {
		const p = paragraphs[s.paraIdx];
		const trimmed = p.length > maxLen ? p.slice(0, maxLen) + '…' : p;
		console.log(`    nearest para #${s.paraIdx}: ${JSON.stringify(trimmed)}`);
		console.log(`    fp(para)         : ${fingerprint(trimmed)}`);
	} else {
		// Find paragraph with max overlap (cheap prefix scan)
		let best = { idx: -1, score: 0 };
		const qn = normalizeForFuzzy(s.qFull).slice(0, 40);
		if (qn) {
			for (let i = 0; i < paragraphs.length; i++) {
				const pn = normalizeForFuzzy(paragraphs[i]);
				if (pn.includes(qn)) {
					best = { idx: i, score: qn.length };
					break;
				}
			}
		}
		if (best.idx >= 0) {
			console.log(`    best-partial para #${best.idx}: ${JSON.stringify(paragraphs[best.idx].slice(0, maxLen))}`);
		} else {
			console.log(`    (no partial match found anywhere)`);
		}
	}
}

if (samples.length > 0) {
	console.log(`\n--- Up to 8 mismatch samples ---`);
	for (const s of samples.slice(0, 8)) showSample(s);
}

// --- 7. Anchor-only comments (no quotedFileContent) -------------------

const anchorOnly = allComments.filter((c) => !c.quotedFileContent && c.anchor);
if (anchorOnly.length > 0) {
	console.log(`\n--- Anchor-only comments (no quotedFileContent): ${anchorOnly.length} ---`);
	for (const c of anchorOnly.slice(0, 10)) {
		console.log(`\n  id=${c.id}  author=${c.author?.displayName}`);
		console.log(`  content: ${JSON.stringify(c.content?.slice(0, 100))}`);
		console.log(`  replies: ${c.replies?.length ?? 0}`);
		console.log(`  anchor raw: ${JSON.stringify(c.anchor)}`);
		try {
			const parsed = JSON.parse(c.anchor);
			console.log(`  anchor parsed: ${JSON.stringify(parsed, null, 2).split('\n').join('\n    ')}`);
		} catch (e) {
			console.log(`  anchor parse failed: ${e.message}`);
		}
	}
}

// --- 8. Doc body index ranges for comparison --------------------------

const content = doc.body?.content ?? [];
const first = content.find((e) => e.startIndex !== undefined);
const last = [...content].reverse().find((e) => e.endIndex !== undefined);
console.log(`\nDoc body startIndex=${first?.startIndex ?? '?'} endIndex=${last?.endIndex ?? '?'}`);
console.log(`Total structural elements: ${content.length}`);

// --- 9. Named ranges — do any of these kix.* anchors resolve? --------

const nr = doc.namedRanges ?? {};
const nrNames = Object.keys(nr);
console.log(`\nnamedRanges count: ${nrNames.length}`);
if (nrNames.length > 0) {
	console.log(`  sample names: ${nrNames.slice(0, 5).map((n) => JSON.stringify(n)).join(', ')}`);
	for (const c of anchorOnly) {
		if (nr[c.anchor]) {
			console.log(`  HIT: ${c.anchor} → ${JSON.stringify(nr[c.anchor]).slice(0, 200)}`);
		}
	}
	// Also try reverse: any named range whose name contains any anchor id?
	for (const c of anchorOnly) {
		const id = c.anchor;
		const hit = nrNames.find((n) => n === id || n.includes(id.replace(/^kix\./, '')));
		if (hit) console.log(`  partial HIT: ${id} → namedRange "${hit}"`);
	}
}

// --- 10. Full raw shape of one comment (field discovery) --------------

if (allComments[0]) {
	console.log(`\nFull raw shape of comments[0] (keys): ${Object.keys(allComments[0]).join(', ')}`);
	const { htmlContent, ...rest } = allComments[0];
	console.log(`Has htmlContent: ${htmlContent !== undefined} (length: ${htmlContent?.length ?? 0})`);
	if (htmlContent) {
		console.log(`  htmlContent sample: ${JSON.stringify(htmlContent.slice(0, 300))}`);
	}
}

// --- 11. Search the full doc JSON for any kix.* anchor strings -------

const docJson = JSON.stringify(doc);
console.log(`\nSearching doc JSON (${docJson.length} chars) for each kix.* anchor:`);
for (const c of anchorOnly) {
	const hits = (docJson.match(new RegExp(c.anchor.replace(/\./g, '\\.'), 'g')) || []).length;
	console.log(`  ${c.anchor}: ${hits} occurrences in doc JSON`);
}
// Also check: does the doc contain ANY "kix." strings anywhere?
const allKix = [...new Set(docJson.match(/kix\.[a-z0-9]+/gi) ?? [])];
console.log(`\nAll distinct kix.* IDs found anywhere in doc JSON: ${allKix.length}`);
if (allKix.length > 0 && allKix.length <= 20) {
	console.log(`  ${allKix.join(', ')}`);
}
