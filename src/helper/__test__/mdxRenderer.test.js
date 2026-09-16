import { join } from 'path';
import { mkdtemp, writeFile, mkdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { renderMDX, generateHydrationScript } from '../mdxRenderer.js';

// Helper: a temp source tree with a _components/ directory
let tempDir;
beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'ursa-mdx-'));
  await mkdir(join(tempDir, '_components'), { recursive: true });
});
afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function writeComponent(name, body) {
  const path = join(tempDir, '_components', `${name}.jsx`);
  await writeFile(path, body);
  return path;
}

async function render(mdx, { hydrate = true } = {}) {
  const filePath = join(tempDir, 'page.mdx');
  await writeFile(filePath, mdx);
  return renderMDX({ source: mdx, filePath, sourceRoot: tempDir, hydrate });
}

const COUNTER = `
import React from 'react';
export default function Counter({ label }) {
  const [n, setN] = React.useState(0);
  return <button onClick={() => setN(n + 1)}>{label}: {n}</button>;
}
`;

// ---------------------------------------------------------------------------
// Island wrapping
// ---------------------------------------------------------------------------
describe('renderMDX islands', () => {
  test('wraps a component imported from the MDX in <ursa-island>', async () => {
    await writeComponent('Counter', COUNTER);
    const { html } = await render(`
import Counter from '_components/Counter.jsx';

# Page

<Counter label="Clicks" />
`);
    expect(html).toMatch(/<ursa-island data-island="0" data-component="Counter"[^>]*>/);
    expect(html).toContain('<button>Clicks<!-- -->: <!-- -->0</button>');
    expect(html).toContain('</ursa-island>');
  });

  test('numbers islands in document order', async () => {
    await writeComponent('Counter', COUNTER);
    const { html } = await render(`
import Counter from '_components/Counter.jsx';

<Counter label="A" />

Some prose.

<Counter label="B" />
`);
    const ids = [...html.matchAll(/<ursa-island data-island="(\d+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(['0', '1']);
    expect(html.indexOf('>A<')).toBeLessThan(html.indexOf('>B<'));
  });

  test('does not nest islands: a component imported by a component is rendered plainly', async () => {
    await writeComponent('Inner', `
import React from 'react';
export default function Inner() { return <em>inner</em>; }
`);
    await writeComponent('Outer', `
import React from 'react';
import Inner from './Inner.jsx';
export default function Outer() { return <div>outer <Inner /></div>; }
`);
    const { html } = await render(`
import Outer from '_components/Outer.jsx';

<Outer />
`);
    expect(html.match(/<ursa-island/g)).toHaveLength(1);
    expect(html).toContain('data-component="Outer"');
    expect(html).toContain('<em>inner</em>');
  });

  test('leaves the surrounding markdown outside any island', async () => {
    await writeComponent('Counter', COUNTER);
    const { html } = await render(`
import Counter from '_components/Counter.jsx';

# Heading

<Counter label="x" />

## Sub
`);
    // Headings are siblings of the island, not children of it
    expect(html).toMatch(/<h1>Heading<\/h1>\s*<ursa-island/);
    expect(html).toMatch(/<\/ursa-island>\s*<h2>Sub<\/h2>/);
  });

  test('client bundle contains the island runtime', async () => {
    await writeComponent('Counter', COUNTER);
    const { clientCode } = await render(`
import Counter from '_components/Counter.jsx';

<Counter label="x" />
`);
    expect(clientCode).toContain('hydrateRoot');
    expect(clientCode).toContain('data-island');
  });

  test('hydrate: false still renders islands but emits no client code', async () => {
    await writeComponent('Counter', COUNTER);
    const result = await render(`
import Counter from '_components/Counter.jsx';

<Counter label="x" />
`, { hydrate: false });
    expect(result.html).toContain('<ursa-island');
    expect(result.clientCode).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Preload stripping
// ---------------------------------------------------------------------------
describe('renderMDX preload stripping', () => {
  test('removes React 19 hoisted <link rel="preload"> so the body starts with its heading', async () => {
    const { html } = await render(`
# Title
![pic](../img/pic.jpg)
`);
    expect(html).not.toContain('rel="preload"');
    expect(html.trimStart().startsWith('<h1>')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Hydration script
// ---------------------------------------------------------------------------
describe('generateHydrationScript', () => {
  test('renders into a detached root and looks up islands rather than a page container', () => {
    const script = generateHydrationScript('return { default: function () { return null; } };');
    expect(script).toContain('ursa-island[data-island]');
    expect(script).toContain('createRoot(detached)');
    expect(script).not.toContain("getElementById('main-content')");
  });

  test('escapes the bundle for embedding in a template literal', () => {
    const script = generateHydrationScript('var s = `a${b}`; // </script>');
    expect(script).toContain('\\`a\\${b}\\`');
    expect(script).toContain('<\\/script>');
  });
});
