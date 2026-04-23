/**
 * Live end-to-end test: exports a real gdoc to .docx via Drive, runs the OOXML
 * adapter, and pushes the result through the transformer. Confirms that the
 * failing-doc class (.docx-imported gdocs with `kix.*` anchors) now produces
 * inline `^[cN]` anchors — the Drive-API pipeline used to silently drop them.
 *
 * Reads ACCESS_TOKEN and DOC_ID from `env.local` (or `GOOGLE_TEST_DOC_ID` for
 * back-compat with the CLAUDE.md convention). Short-lived OAuth tokens expire
 * in ~1 hour; refresh manually when the test fails with HTTP 401.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { exportDocx } from '$lib/services/google-drive-export';
import { parseDocx } from '$lib/services/docx-adapter';
import { transformToMarkdown } from '$lib/services/transformer';

function loadEnvLocal(): Record<string, string> {
	const path = resolve(process.cwd(), 'env.local');
	if (!existsSync(path)) return {};
	const source = readFileSync(path, 'utf8');
	const out: Record<string, string> = {};
	for (const line of source.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eq = trimmed.indexOf('=');
		if (eq < 0) continue;
		out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
	}
	return out;
}

const env = { ...process.env, ...loadEnvLocal() };
const DOC_ID = env.GOOGLE_TEST_DOC_ID ?? env.DOC_ID;
const ACCESS_TOKEN = env.ACCESS_TOKEN;

// Skip the whole file when credentials aren't configured — keeps the suite
// portable across machines that don't have a token wired up.
const describeLive = DOC_ID && ACCESS_TOKEN ? describe : describe.skip;

describeLive('live: Drive .docx export → markdown pipeline', () => {
	it('exports the failing doc and surfaces its comments as inline anchors', async () => {
		const buffer = await exportDocx(DOC_ID!, ACCESS_TOKEN!);
		expect(buffer.byteLength).toBeGreaterThan(10_000);

		const { doc, threads } = parseDocx(buffer);

		// Sanity: at least a handful of paragraphs and some number of threads.
		expect(doc.body.content.length).toBeGreaterThan(5);
		expect(threads.length).toBeGreaterThanOrEqual(6);

		// The failing doc's hallmark: before the port, 0 of these threads had
		// usable quotedText. After the port, the overwhelming majority should.
		const anchored = threads.filter((t) => t.quotedText.length > 0);
		expect(anchored.length).toBeGreaterThanOrEqual(6);

		const md = transformToMarkdown(doc, threads);

		// Count the number of anchor tokens rendered inline.
		const anchorMatches = md.match(/\]\^\[c\d+\]/g) ?? [];
		expect(anchorMatches.length).toBeGreaterThanOrEqual(6);
	}, 30_000);
});
