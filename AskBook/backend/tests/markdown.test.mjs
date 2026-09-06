/**
 * tests/markdown.test.mjs — XSS-safety + formatting tests for the frontend
 * safe markdown renderer (js/common/markdown.js). Run via `node --test`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, escapeHtml } from '../../js/common/markdown.js';

test('escapes <script> (no executable HTML reaches the DOM)', () => {
  const out = renderMarkdown('<script>alert(1)</script>');
  assert.ok(!out.includes('<script>'));
  assert.ok(out.includes('&lt;script&gt;'));
});

test('escapes <img onerror> injection', () => {
  const out = renderMarkdown('<img src=x onerror=alert(1)>');
  assert.ok(!/<img/i.test(out));
});

test('neutralizes javascript: link scheme', () => {
  const out = renderMarkdown('[click](javascript:alert(1))');
  assert.ok(!/href="javascript:/i.test(out));
  assert.ok(!out.includes('<a '));
});

test('neutralizes data: link scheme', () => {
  const out = renderMarkdown('[x](data:text/html,<script>1</script>)');
  assert.ok(!/href="data:/i.test(out));
});

test('allows safe https links with noopener', () => {
  const out = renderMarkdown('[Docs](https://example.com/a)');
  assert.ok(out.includes('href="https://example.com/a"'));
  assert.ok(out.includes('rel="noopener'));
});

test('renders headings/bold/italic/lists/code/table safely', () => {
  assert.ok(renderMarkdown('# Title').includes('<h1'));
  assert.ok(renderMarkdown('**b**').includes('<strong>b</strong>'));
  assert.ok(renderMarkdown('_i_').includes('<em>i</em>'));
  assert.ok(renderMarkdown('`<b>`').includes('<code>&lt;b&gt;</code>'));
  const ul = renderMarkdown('- one\n- two');
  assert.ok(ul.includes('<ul>') && (ul.match(/<li>/g) || []).length === 2);
  assert.ok(renderMarkdown('1. a\n2. b').includes('<ol>'));
  const code = renderMarkdown('```\n<script>\n```');
  assert.ok(code.includes('<pre') && code.includes('&lt;script&gt;'));
  const table = renderMarkdown('| A | B |\n| --- | --- |\n| 1 | 2 |');
  assert.ok(table.includes('<table') && table.includes('<th>A</th>'));
});

test('escapeHtml handles quotes/ampersand/angle brackets', () => {
  assert.equal(escapeHtml('"\'&<>'), '&quot;&#39;&amp;&lt;&gt;');
});
