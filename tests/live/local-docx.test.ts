/**
 * Offline counterpart to docx-export.test.ts: runs the full adapter +
 * transformer against any .docx found at the repo root (typically a
 * manually-exported sample of the failing gdoc). Skipped when no .docx is
 * present, so it is safe to leave in the suite.
 *
 * This exists because OAuth tokens are short-lived; maintainers can drop a
 * fresh .docx export in the repo root and re-run `npm run test:live` to
 * reproduce the end-to-end path without refreshing the token.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDocx } from '$lib/services/docx-adapter';
import { transformToMarkdown } from '$lib/services/transformer';

function findLocalDocx(): string | undefined {
	const root = process.cwd();
	const candidates = readdirSync(root).filter((f) => f.endsWith('.docx'));
	return candidates.length > 0 ? resolve(root, candidates[0]) : undefined;
}

const samplePath = findLocalDocx();
const describeLocal = samplePath && existsSync(samplePath) ? describe : describe.skip;

describeLocal('offline: parse a local .docx sample', () => {
	it('renders every thread either inline or in the unanchored section, never stacked', () => {
		const buf = readFileSync(samplePath!);
		const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
		const { doc, threads } = parseDocx(ab as ArrayBuffer);

		expect(threads.length).toBeGreaterThan(0);

		const md = transformToMarkdown(doc, threads);

		// No stacked anchors anywhere — the recurring real-world bug. A stack
		// looks like `[[inner]^[c1]outer]^[c2]`; the inline anchor algorithm
		// must either place anchors side-by-side or push the contested thread
		// to the unanchored section.
		expect(md).not.toMatch(/\[\[.*?\]\^\[c\d+\].*?\]\^\[c\d+\]/);

		// Every thread surfaces somewhere: either inline or in the unanchored
		// section. No silent drops.
		for (const t of threads) {
			const anchorId = t.anchorId;
			const appearsInline = md.includes(`]^[${anchorId}]`);
			const appearsInUnanchored =
				md.includes(`## Unanchored comments`) &&
				md.indexOf(`> [${anchorId}]`, md.indexOf('## Unanchored comments')) >= 0;
			expect(appearsInline || appearsInUnanchored).toBe(true);
		}
	});
});
