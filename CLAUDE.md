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
│       ├── components/    # Reusable UI components
│       ├── services/
│       │   ├── google-auth.ts    # OAuth2 flow
│       │   ├── google-docs.ts    # Document fetch (Docs API)
│       │   ├── google-drive.ts   # Comments fetch (Drive API)
│       │   └── transformer.ts    # Markdown generation
│       ├── stores/
│       │   └── auth.ts    # Auth state (Svelte 5 runes)
│       ├── types/
│       │   └── google.ts  # API response types
│       └── utils/
│           └── anchors.ts # Anchor placement logic
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
- `https://www.googleapis.com/auth/documents.readonly`
- `https://www.googleapis.com/auth/drive.readonly`

### API Endpoints Used
- **Docs API**: `GET https://docs.googleapis.com/v1/documents/{documentId}`
- **Drive API**: `GET https://www.googleapis.com/drive/v3/files/{fileId}/comments?fields=*`

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
| `google-docs.ts` | Fetch document content via Docs API |
| `google-drive.ts` | Fetch comments via Drive API |
| `transformer.ts` | Convert document + comments to markdown |

### Transformation Pipeline

```
1. User provides Google Doc URL
2. Extract document ID from URL
3. Fetch document content (Docs API)
4. Fetch comments with replies (Drive API)
5. Map comment anchors to document positions
6. Generate markdown with [text]^[cN] anchors
7. Append blockquote comment threads after paragraphs
```

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

- Development happens on `main` branch
- `production` branch triggers GitHub Pages deploy via GitHub Actions
- Branches are kept in a linear graph — no PRs needed, push main to production directly: `git push origin main:production`
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
