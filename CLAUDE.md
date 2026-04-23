# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Web application that extracts Google Docs comment threads and converts them to a markdown-native format. Users authenticate via Google OAuth2, provide a document URL, and receive markdown output with inline comment anchors and blockquote threads per the DESIGN.md specification.

## Project Structure

```
gdoc-comments-md/
├── CLAUDE.md              # This file - development guidelines
├── DESIGN.md              # Output format specification
├── package.json
├── svelte.config.js
├── vite.config.ts
├── tsconfig.json
├── src/
│   ├── app.css            # Tailwind imports + dark mode
│   ├── app.html           # HTML shell
│   ├── routes/
│   │   ├── +layout.svelte # App shell, dark theme
│   │   ├── +page.svelte   # Home/landing
│   │   ├── convert/
│   │   │   └── +page.svelte  # Main conversion UI
│   │   └── settings/
│   │       └── +page.svelte  # OAuth setup
│   └── lib/
│       ├── components/
│       │   └── HistoryList.svelte # Conversion history list UI
│       ├── services/
│       │   ├── google-auth.ts          # OAuth2 flow
│       │   ├── google-drive.ts         # Drive metadata (MIME preflight)
│       │   ├── google-drive-export.ts  # Drive .docx export
│       │   ├── docx-adapter.ts         # OOXML → GoogleDocsDocument + threads
│       │   ├── markdown-storage.ts     # IndexedDB cache for markdown
│       │   └── transformer.ts          # Markdown generation
│       ├── stores/
│       │   ├── auth.svelte.ts    # Auth state (Svelte 5 runes)
│       │   └── history.svelte.ts # Conversion history state
│       ├── types/
│       │   ├── google.ts  # API response types
│       │   └── history.ts # History entry types
│       └── utils/
│           ├── time.ts    # Relative time formatting
│           └── url.ts     # URL/doc ID extraction
├── tests/
│   ├── unit/              # Vitest unit tests
│   ├── e2e/               # Playwright browser tests
│   └── live/              # Real API tests (rate-limited)
├── poc/                   # OAuth proof of concept (reference)
└── static/
    └── favicon.ico
```

## Build & Test Commands

```bash
npm run dev              # Start dev server (port 5173)
npm run build            # Production build
npm run preview          # Preview production build
npm run check            # TypeScript/Svelte type checking

npm test                 # Run Vitest unit tests
npm run test:watch       # Unit tests in watch mode
npm run test:e2e         # Run Playwright E2E tests
npm run test:e2e:ui      # E2E tests with interactive UI
npm run test:live        # Run live API tests (SPARINGLY - see below)
```

## Development Methodology: TDD Red/Green

**All new functionality MUST follow Test-Driven Development:**

1. **RED**: Write a failing test first, run to prove it fails
2. **GREEN**: Write minimal code to pass, run to prove it passes
3. **REFACTOR**: Clean up while keeping tests green
4. **REPEAT**: Build functionality incrementally with test coverage

### Key Principles
- Never skip the RED step - running before implementation proves the test can fail
- Small increments - each test covers one small behavior
- Console debugging is temporary - remove `console.log` after fixing

### Test Types

| Test Type | Location | Command | Purpose |
|-----------|----------|---------|---------|
| Unit | `tests/unit/` | `npm test` | Pure functions, transformers, utilities |
| E2E | `tests/e2e/` | `npm run test:e2e` | Browser interactions, full UI flows |
| Live | `tests/live/` | `npm run test:live` | Real Google API calls (rate-limited) |

## Google API Integration

### OAuth2 Scopes Required
- `https://www.googleapis.com/auth/drive.readonly` — used for both the MIME preflight and the `.docx` export.
- `https://www.googleapis.com/auth/documents.readonly` — **requested but no longer exercised**; the Docs-API pipeline was retired in favor of the `.docx` path. Kept in the scope set for historical tokens; safe to drop in a future release.

### API Endpoints Used
- **Drive API (metadata preflight)**: `GET https://www.googleapis.com/drive/v3/files/{fileId}?fields=id,name,mimeType`
- **Drive API (.docx export)**: `GET https://www.googleapis.com/drive/v3/files/{fileId}/export?mimeType=application/vnd.openxmlformats-officedocument.wordprocessingml.document`

The pipeline intentionally does NOT use the Docs API. .docx-imported gdocs keep their comment anchor ranges only in the OOXML representation; the Docs API drops them. We export to .docx and parse OOXML instead.

### Credentials Management

**NEVER commit credentials to git.** OAuth client secrets are stored in:
- `poc/client_secret_*.json` - Downloaded from Google Cloud Console (gitignored)

For local development, the OAuth Client ID is stored in browser localStorage by the app.

### Live API Testing Rules

**CRITICAL: Live tests consume Google API quota and may trigger rate limits.**

1. **Default test suite excludes live tests** - `npm test` runs only unit tests
2. **Explicit invocation required** - Use `npm run test:live` only when needed
3. **Max 10 API calls per test run** - Keep tests minimal
4. **1-second delay between API calls** - Prevent rate limiting
5. **Never run live tests in CI** - Local development only
6. **Use a dedicated test document** - Create a Google Doc with known content/comments
7. **Store test document ID in environment** - Use `.env.local` (gitignored)

```bash
# .env.local
GOOGLE_TEST_DOC_ID=your-test-document-id
```

## Architecture

### Services Layer

| Service | Purpose |
|---------|---------|
| `google-auth.ts` | OAuth2 flow using Google Identity Services (GIS) |
| `google-drive.ts` | Drive metadata (MIME preflight before export) |
| `google-drive-export.ts` | Drive `.docx` export (the single source fetch) |
| `docx-adapter.ts` | OOXML → `GoogleDocsDocument` + `CommentThread[]` |
| `transformer.ts` | Convert document + comments to markdown |
| `markdown-storage.ts` | IndexedDB cache for converted markdown content |

### Client-Side Storage

| Key/DB | Type | Purpose |
|--------|------|---------|
| `gdoc_auth` | localStorage | OAuth token + user info |
| `gdoc_client_id` | localStorage | Google OAuth Client ID |
| `gdoc_history` | localStorage | Conversion history metadata (max 50 entries) |
| `gdoc_comments` | IndexedDB | Full markdown content cache (store: `markdown`, keyPath: `docId`) |

### Transformation Pipeline

```
1. User provides Google Doc URL
2. Extract document ID from URL
3. Preflight: Drive metadata fetch to verify native-gdoc MIME type
4. Export the doc to .docx via Drive API
5. Unzip + DOM-walk the OOXML (`docx-adapter.ts`) to produce a
   `GoogleDocsDocument` shape + `CommentThread[]` with `quotedText`
   drawn from `<w:commentRangeStart/>` / `<w:commentRangeEnd/>` markers.
   Each thread carries `anchorParaIndex` — the index of the paragraph
   where its Start marker was seen. This is authoritative for routing,
   so a comment whose quoted word happens to appear in an earlier
   paragraph (e.g. a title) never leaks onto it.
6. If page filtering is requested, `truncateByPageRange` slices
   `body.content` + threads to the kept range. Threads whose
   `anchorParaIndex` is outside the slice are dropped outright — no
   substring-rescue path. Pagination is a single truncation step, not a
   filter + remap + fallback pipeline.
7. Generate markdown with [text]^[cN] anchors
8. Append blockquote comment threads after paragraphs
9. Threads whose anchor can't be matched inline (empty quotedText, or
   contested position) render in a trailing `## Unanchored comments`
   section instead of being silently dropped
```

### Thread → paragraph routing

The adapter records `anchorParaIndex` per thread at the moment it sees
`<w:commentRangeStart>`. The transformer's `threadMatchesParagraph`
treats `anchorParaIndex` as authoritative: a thread only matches the
paragraph at that index, never anywhere else — even if its `quotedText`
appears elsewhere. Threads without `anchorParaIndex` (synthetic inputs
in unit tests, or pre-adapter history) fall back to the legacy
substring-includes heuristic. For `.docx`-sourced threads the field is
always set, so the fallback only ever runs in tests.

### Thread merging

When Google exports a gdoc to `.docx` without `commentsExtended.xml`
(older export shape), reply chains flatten into separate top-level
`<w:comment>` entries, each with its own redundant
`<w:commentRangeStart>/<w:commentRangeEnd>` wrapping the same text. The
adapter's `buildThreads` runs two passes: (1) `commentsExtended`-based
threading when that file is present, (2) merge-by-`(quotedText,
anchorParaIndex)` as a fallback. Reply chains collapse back into single
threads; distinct conversations on the same word in different spots
stay separate.

### Output Format (per DESIGN.md)

```markdown
Here is text [from the document itself]^[c1] including _styling_.

> [c1] **Sophia** (sophia@email.com):
> This is the first comment
>
> [c1] **Steve** (steve@email.com):
> This is a reply
```

## Styling

### Dark Mode (Default)

The app uses dark mode by default via Tailwind CSS:

```css
/* app.css */
@import 'tailwindcss';

:root {
  color-scheme: dark;
}

body {
  @apply bg-gray-900 text-gray-100;
}
```

### Color Palette
- Background: `bg-gray-900`, `bg-gray-800`
- Text: `text-gray-100`, `text-gray-400`
- Accents: `blue-500`, `blue-600`
- Borders: `border-gray-700`

## DRY Principles

### Before Adding New Code

1. **Check existing services** - Don't duplicate API logic
2. **Reuse type definitions** - All Google API types in `types/google.ts`
3. **Follow established patterns** - Match existing service/component structure

### Common Patterns

**API Calls** (always include auth header):
```typescript
const response = await fetch(url, {
  headers: { 'Authorization': `Bearer ${accessToken}` }
});
```

**Error Handling**:
```typescript
if (!response.ok) {
  const error = await response.json();
  throw new Error(error.error?.message || `HTTP ${response.status}`);
}
```

## Git Workflow

- Development happens on `main` branch — always stay on `main` locally
- `production` branch triggers GitHub Pages deploy via GitHub Actions
- Branches are kept in a linear graph — no PRs needed, push main to production directly: `git push origin main:production`
- Never switch to `production` locally; deploy by pushing main to production: `git push origin main:production`
- Never commit credentials or `.env` files
- Run `npm test` before committing

### Untracked Files Checklist

Before committing, check `git status` for:
- **Commit**: New `.ts`, `.svelte`, test files
- **Ignore**: `node_modules/`, `.env*`, `client_secret_*.json`

## Environment Configuration

```bash
# .env.local (gitignored)
GOOGLE_TEST_DOC_ID=document-id-for-live-tests
```

OAuth Client ID is stored in browser localStorage (set via Settings page).
