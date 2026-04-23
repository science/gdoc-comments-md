# gdoc-comments-md

**Live app:** [science.github.io/gdoc-comments-md](https://science.github.io/gdoc-comments-md/)

Web application that extracts Google Docs comment threads and converts them to a clean, readable markdown format with inline anchors and threaded replies.

## What it does

Paste a Google Doc URL, get markdown like this:

```markdown
Here is text [from the document itself]^[c1] including _styling_.

> [c1] **Sophia** (sophia@email.com):
> This is the first comment
>
> [c1] **Steve** (steve@email.com):
> This is a reply
```

Comments are linked to their highlighted text via `[text]^[cN]` anchors, with full threads rendered as blockquotes after each paragraph. See [DESIGN.md](DESIGN.md) for the complete format specification.

## Features

- Google OAuth2 authentication (browser-based, no backend required)
- Exports the doc to `.docx` via Drive API and parses OOXML directly — preserves comment anchor ranges that Google's Docs API drops for `.docx`-imported docs
- Converts headings, lists (ordered/unordered/nested), bold, italic, strikethrough, links
- Inline comment anchors with threaded replies; reply chains without `commentsExtended.xml` are reconstructed by shared `(quotedText, anchor-paragraph)` pairs
- Paragraph-index-based anchor routing: a comment on the word "Sophia" deep in the doc never leaks onto an earlier paragraph that also contains "Sophia"
- Optional "pages 1–N" page-range filtering: truncates the parsed doc + threads to the requested range; out-of-range threads are dropped outright, never rehomed
- Trailing `## Unanchored comments` section for any thread whose anchor can't be placed inline (empty range, contested position) — loud failure instead of silent drop
- Resolved comment markers (from `w15:done`)
- Copy to clipboard and download as `.md`
- Dark mode UI
- Token persistence across page refreshes

## Setup

### Prerequisites

- Node.js 18+
- A Google Cloud project with Drive API enabled

### Google Cloud Configuration

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create or select a project
3. Enable **Google Drive API** (Docs API is no longer required — the pipeline exports to `.docx` via Drive and parses OOXML locally)
4. Create OAuth 2.0 credentials (Web application type)
5. Add `http://localhost:5173` and `https://science.github.io` to Authorized JavaScript origins
6. Configure the OAuth consent screen (add yourself as a test user)

### Install and Run

```bash
npm install
npm run dev
```

Open `http://localhost:5173`, go to Settings, paste your OAuth Client ID, and sign in.

## Commands

```bash
npm run dev          # Start dev server (port 5173)
npm run build        # Production build
npm run preview      # Preview production build
npm run check        # TypeScript/Svelte type checking
npm test             # Run unit tests (177 tests)
npm run test:watch   # Unit tests in watch mode
npm run test:live    # Live tests (parse any local .docx + optional Drive export)
```

## Tech Stack

- **Framework**: SvelteKit 2 + Svelte 5 (runes)
- **Styling**: Tailwind CSS 4 (dark mode)
- **Auth**: Google Identity Services (GIS) — client-side OAuth2
- **APIs**: Google Drive API v3 (metadata + `.docx` export)
- **OOXML parsing**: in-browser `DOMParser` over a local unzip via [`fflate`](https://github.com/101arrowz/fflate) — no server-side parsing step, no heavyweight document library
- **Testing**: Vitest (unit + live), Playwright (E2E)
- **Build**: Vite 7, static adapter

## Credits

Document-to-markdown conversion logic adapted from [docs-markdown](https://github.com/AnandChowdhary/docs-markdown) by Anand Chowdhary (MIT License) -- specifically the heading style mapping and list/bullet detection from the Google Docs API JSON structure.

The [gd2md-html](https://github.com/Bean-Road-Communications/gd2md-html) project by Bean Road Communications was referenced during design evaluation.

Built with assistance from [Claude Code](https://claude.ai/code) by Anthropic.

## License

Copyright 2025 Stephen Midgley

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for details.
