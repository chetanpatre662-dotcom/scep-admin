/**
 * markdown.js — Tiny, XSS-safe Markdown -> HTML renderer (no dependencies).
 * -----------------------------------------------------------------------------
 * The AI answer text is UNTRUSTED. This renderer is "escape-first": every raw
 * character is HTML-escaped BEFORE any formatting is applied, so no attacker-
 * controlled HTML/JS can ever reach the DOM. Formatting is then re-introduced
 * only from a small, fixed whitelist by wrapping the already-escaped text in
 * known-safe tags. We never call `innerHTML` with raw model output elsewhere —
 * this function is the single sanitized entry point.
 *
 * Supported: headings (#..######), bold, italic, inline code, fenced code
 * blocks, unordered + ordered lists, block quotes, tables (GFM pipe), links
 * ([text](http/https/mailto only)), horizontal rules, paragraphs, line breaks.
 *
 * Explicitly NOT supported (by design, for safety): raw HTML, images, arbitrary
 * URL schemes (javascript:, data:, etc.).
 * -----------------------------------------------------------------------------
 */

/** HTML-escape every dangerous character. Applied to ALL text first. */
export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only allow safe link schemes; otherwise render as plain (escaped) text. */
function safeUrl(url) {
  const u = String(url || '').trim();
  if (/^(https?:|mailto:)/i.test(u)) return u;
  return null;
}

/** Inline formatting on an ALREADY-ESCAPED string. */
function renderInline(escaped) {
  let s = escaped;

  // Inline code `code` (do first so its contents aren't further formatted).
  const codeSpans = [];
  s = s.replace(/`([^`]+)`/g, (_m, code) => {
    codeSpans.push(code);
    return `\u0000CODE${codeSpans.length - 1}\u0000`;
  });

  // Links [text](url) — url validated against a scheme whitelist. Because the
  // whole string was escaped, the url here is escaped too; unescape entities we
  // introduced only for the scheme check + href.
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) => {
    const decoded = url.replace(/&amp;/g, '&');
    const safe = safeUrl(decoded);
    if (!safe) return m; // leave as escaped literal text
    const href = escapeHtml(safe);
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  });

  // Bold **x** / __x__
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  // Italic *x* / _x_
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');

  // Restore inline code spans (contents already escaped).
  s = s.replace(/\u0000CODE(\d+)\u0000/g, (_m, i) => `<code>${codeSpans[Number(i)]}</code>`);
  return s;
}

/** Render a GFM pipe table from an array of raw (escaped) row strings. */
function renderTable(rows) {
  // rows[0] = header, rows[1] = separator (---|---), rows[2..] = body.
  const splitRow = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const header = splitRow(rows[0]);
  const body = rows.slice(2).map(splitRow);
  const th = header.map((c) => `<th>${renderInline(c)}</th>`).join('');
  const trs = body
    .map((cells) => `<tr>${cells.map((c) => `<td>${renderInline(c)}</td>`).join('')}</tr>`)
    .join('');
  return `<table class="ai-md-table"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
}

/**
 * Render markdown text to safe HTML.
 * @param {string} text - untrusted markdown (e.g. an AI answer)
 * @returns {string} sanitized HTML
 */
export function renderMarkdown(text) {
  const escaped = escapeHtml(text);
  const lines = escaped.split('\n');
  const out = [];

  let i = 0;
  let listType = null;   // 'ul' | 'ol' | null
  let paragraph = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      out.push(`<p>${renderInline(paragraph.join('<br>'))}</p>`);
      paragraph = [];
    }
  };
  const closeList = () => {
    if (listType) { out.push(`</${listType}>`); listType = null; }
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Fenced code block ```
    if (/^```/.test(trimmed)) {
      flushParagraph(); closeList();
      const codeLines = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        codeLines.push(lines[i]); // already escaped
        i += 1;
      }
      i += 1; // skip closing fence
      out.push(`<pre class="ai-md-pre"><code>${codeLines.join('\n')}</code></pre>`);
      continue;
    }

    // GFM table: header line, then a separator row of ---/:--- cells.
    if (
      trimmed.includes('|') &&
      i + 1 < lines.length &&
      /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(lines[i + 1])
    ) {
      flushParagraph(); closeList();
      const tableRows = [lines[i], lines[i + 1]];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        tableRows.push(lines[i]); i += 1;
      }
      out.push(renderTable(tableRows));
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph(); closeList();
      out.push('<hr>');
      i += 1;
      continue;
    }

    // Headings # .. ######
    const h = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushParagraph(); closeList();
      const level = h[1].length;
      out.push(`<h${level} class="ai-md-h">${renderInline(h[2])}</h${level}>`);
      i += 1;
      continue;
    }

    // Block quote
    const bq = trimmed.match(/^>\s?(.*)$/);
    if (bq) {
      flushParagraph(); closeList();
      out.push(`<blockquote>${renderInline(bq[1])}</blockquote>`);
      i += 1;
      continue;
    }

    // Unordered list item
    const ul = trimmed.match(/^[-*+]\s+(.*)$/);
    if (ul) {
      flushParagraph();
      if (listType !== 'ul') { closeList(); out.push('<ul>'); listType = 'ul'; }
      out.push(`<li>${renderInline(ul[1])}</li>`);
      i += 1;
      continue;
    }

    // Ordered list item
    const ol = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (ol) {
      flushParagraph();
      if (listType !== 'ol') { closeList(); out.push('<ol>'); listType = 'ol'; }
      out.push(`<li>${renderInline(ol[1])}</li>`);
      i += 1;
      continue;
    }

    // Blank line -> paragraph break
    if (trimmed === '') {
      flushParagraph(); closeList();
      i += 1;
      continue;
    }

    // Regular text line -> accumulate into a paragraph.
    closeList();
    paragraph.push(trimmed);
    i += 1;
  }

  flushParagraph();
  closeList();
  return out.join('\n');
}

export default { renderMarkdown, escapeHtml };
