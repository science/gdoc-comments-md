# gdoc-comments-md

Design document for converting Google Docs comment threads into a markdown-native format.

## Comment Metadata Format

### Inline Anchors

Highlighted text is wrapped in brackets with a footnote-style anchor ID:

```
[highlighted text]^[c1]
```

Markdown formatting is preserved inside anchored spans:

```
[_styled_ text]^[c3]
```

### Comment Threads

Threads are placed as blockquotes after the paragraph containing their anchor. Each reply is prefixed with the anchor ID to explicitly link it back:

```markdown
> [c1] **Sophia** (sophia@email.com):
> This is the first comment on the highlighted text
>
> [c1] **Steve** (steve@email.com):
> This is a threaded reply
```

Multiple anchors in the same paragraph get separate blockquote blocks.

### Full Example

```markdown
# Document Header

Here is text [from the document itself]^[c1] including _styling_ of
[various]^[c2] simple kinds. And then the paragraph continues with more content.

> [c1] **Sophia** (sophia@email.com):
> This is the first comment on the highlighted text
>
> [c1] **Steve** (steve@email.com):
> This is a threaded reply

> [c2] **Alex** (alex@email.com):
> I'd reconsider this word choice
```

### Design Rationale

| Concern | Decision |
|---------|----------|
| Anchor syntax | `[text]^[id]` -- footnote-like, familiar to LLMs trained on markdown/LaTeX |
| Thread placement | After the paragraph, grouped by anchor ID |
| ID linkage | Explicit `[c1]` prefix on every reply ties thread to anchor |
| Multiple anchors | Each gets a unique ID; threads are separate blockquote blocks |
| Readability | No HTML tags; pure markdown-adjacent punctuation |
| Nested styling | Markdown formatting preserved inside anchored spans |

### Edge Cases (Future Resolution)

- Anchors spanning across paragraph boundaries
- Resolved vs. unresolved comment threads (possible marker: `[c1 resolved]`)
- Comments with no anchor text (point comments)
