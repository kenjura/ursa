import { bundleMDX } from "mdx-bundler";
import { getMDXComponent } from "mdx-bundler/client/index.js";
import React from "react";
import { renderToString } from "react-dom/server";
import * as esbuild from "esbuild";
import { dirname, join, resolve } from "path";
import { existsSync } from "fs";
import { writeFile, mkdir } from "fs/promises";
import remarkDirective from "remark-directive";
import { remarkDefinitionList, defListHastHandlers } from "remark-definition-list";
import remarkSupersub from "remark-supersub";
import remarkGfm from "remark-gfm";
import { visit } from "unist-util-visit";

/**
 * Custom remark plugin that converts container directives (:::name ... :::)
 * into <aside> HTML elements, matching the markdown-it-container behavior
 * used in the .md pipeline (markdownHelper.cjs).
 */
function remarkAsideContainers() {
  return (tree) => {
    visit(tree, (node) => {
      if (node.type === "containerDirective") {
        const data = node.data || (node.data = {});
        data.hName = "aside";
      }
    });
  };
}

/**
 * Find _components directories by walking up from the MDX file to the source root.
 * Returns paths from most specific (nearest) to most general (root).
 * @param {string} startDir - Directory of the MDX file
 * @param {string} [sourceRoot] - Source root to stop searching at
 * @returns {string[]} Array of absolute paths to _components directories
 */
function findComponentDirs(startDir, sourceRoot) {
  const dirs = [];
  let current = resolve(startDir);
  const root = sourceRoot ? resolve(sourceRoot) : null;

  while (true) {
    const candidate = join(current, '_components');
    if (existsSync(candidate)) {
      dirs.push(candidate);
    }
    
    // Stop if we've reached the source root or filesystem root
    if (root && current === root) break;
    const parent = dirname(current);
    if (parent === current) break; // filesystem root
    current = parent;
  }
  
  return dirs;
}

/**
 * Render an MDX file to HTML with optional client-side hydration support.
 * 
 * Uses mdx-bundler to compile MDX source (with component imports resolved via esbuild),
 * then renders the resulting React component to HTML using react-dom/server.
 * 
 * Supports a `_components/` directory convention: any `_components/` folder found in
 * the MDX file's directory or any parent directory (up to sourceRoot) will be added
 * as an esbuild resolve directory, enabling imports like:
 *   import { MyComponent } from '_components/MyComponent.tsx'
 *
 * @param {Object} options
 * @param {string} options.source - Raw MDX file contents
 * @param {string} options.filePath - Absolute path to the MDX file (used for import resolution)
 * @param {string} [options.sourceRoot] - Root directory of the source files (for absolute imports)
 * @param {boolean} [options.hydrate=false] - If true, includes client bundle for hydration
 * @returns {Promise<{ html: string, frontmatter: Record<string, any>, clientCode?: string }>}
 */
export async function renderMDX({ source, filePath, sourceRoot, hydrate = false }) {
  const cwd = dirname(filePath);
  const componentDirs = findComponentDirs(cwd, sourceRoot);

  /**
   * Create esbuild options for the given platform
   * @param {'node'|'browser'} platform - Target platform
   */
  const createEsbuildOptions = (platform) => (options) => {
    // Enable loaders for TypeScript/JSX component files
    options.loader = {
      ...options.loader,
      ".js": "jsx",
      ".ts": "tsx",
      ".tsx": "tsx",
      ".jsx": "jsx",
    };
    // Set target based on platform
    options.target = "es2020";
    options.platform = platform;
    
    // Add _components directories as resolve paths so imports like
    // '_components/Foo.tsx' resolve without relative path prefixes
    if (componentDirs.length > 0) {
      // Add parent directories of _components so 'import from "_components/X"' works
      const parentDirs = componentDirs.map(d => dirname(d));
      options.nodePaths = [...(options.nodePaths || []), ...parentDirs];
    }
    
    return options;
  };

  /**
   * Create MDX options with remark plugins
   */
  const createMdxOptions = () => (options) => {
    // Add remark plugins matching the markdown-it extensions in markdownHelper.cjs:
    // - remarkGfm: adds GFM support (tables, strikethrough, autolinks, task lists)
    // - remarkDirective: parses :::name container syntax into AST nodes
    // - remarkAsideContainers: converts container directives to <aside> elements
    // - remarkDefinitionList: adds PHP Markdown Extra style definition lists (Term\n: Def)
    // - remarkSupersub: adds ^superscript^ and ~subscript~ syntax
    options.remarkPlugins = [
      ...(options.remarkPlugins || []),
      remarkGfm,
      remarkDirective,
      remarkAsideContainers,
      remarkDefinitionList,
      remarkSupersub,
    ];
    // remark-definition-list needs custom handlers for remark-rehype conversion
    options.remarkRehypeOptions = {
      ...(options.remarkRehypeOptions || {}),
      handlers: {
        ...(options.remarkRehypeOptions?.handlers || {}),
        ...defListHastHandlers,
      },
    };
    return options;
  };

  try {
    // Server-side bundle (for SSR)
    const serverResult = await bundleMDX({
      source,
      cwd,
      esbuildOptions: createEsbuildOptions('node'),
      mdxOptions: createMdxOptions(),
    });

    const { code: serverCode, frontmatter } = serverResult;

    // getMDXComponent evaluates the bundled code and returns a React component
    const Component = getMDXComponent(serverCode);

    // Render to HTML with hydration markers (renderToString vs renderToStaticMarkup)
    const html = renderToString(React.createElement(Component));

    // If hydration is not requested, return without client code
    if (!hydrate) {
      return { html, frontmatter: frontmatter || {} };
    }

    // Client-side bundle (for hydration)
    // Same settings as server — mdx-bundler output is platform-agnostic
    // (it references React/ReactDOM/jsx-runtime via function parameters, not imports)
    const clientResult = await bundleMDX({
      source,
      cwd,
      esbuildOptions: createEsbuildOptions('browser'),
      mdxOptions: createMdxOptions(),
    });

    return { 
      html, 
      frontmatter: frontmatter || {},
      clientCode: clientResult.code,
    };
  } catch (error) {
    throw formatMDXError(error, filePath);
  }
}

/**
 * Format MDX compilation errors into user-friendly messages.
 * Detects common failure patterns and provides actionable guidance.
 */
function formatMDXError(error, filePath) {
  const msg = error.message || String(error);

  // Missing component / module not found
  const missingMatch = msg.match(/Could not resolve ["']([^"']+)["']/);
  if (missingMatch) {
    const importPath = missingMatch[1];
    const wrappedError = new Error(
      `MDX error in ${filePath}: Cannot resolve import "${importPath}". ` +
      `Check that the file exists relative to the MDX file's directory.`
    );
    wrappedError.originalError = error;
    return wrappedError;
  }

  // Unclosed tag / paragraph boundary errors (very common with HTML-in-MDX)
  const unclosedMatch = msg.match(/Expected a closing tag for `<(\w+)>`.*before the end of `(\w+)`/);
  if (unclosedMatch) {
    const [, tag, context] = unclosedMatch;
    const lineMatch = msg.match(/(\d+):(\d+)[-–](\d+):(\d+)/);
    const lineInfo = lineMatch ? ` (line ${lineMatch[1]})` : '';
    
    const wrappedError = new Error(
      `MDX compilation failed for ${filePath}:\n` +
      `Unclosed <${tag}> tag${lineInfo}. ` +
      `In MDX, HTML tags that contain content across line breaks must use JSX block syntax. ` +
      `Either put the <${tag}>...</${tag}> on a single line, or ensure the opening tag is on its own line with content indented below.`
    );
    wrappedError.originalError = error;
    return wrappedError;
  }

  // esbuild syntax / compilation errors
  if (msg.includes('Build failed') || msg.includes('error:')) {
    // Extract the most relevant error lines from esbuild output
    const errorLines = msg.split('\n').filter(line => 
      line.includes('error:') || line.includes('ERROR:') || line.match(/^\s+\d+\s*\|/)
    ).slice(0, 6);
    
    const summary = errorLines.length > 0 
      ? errorLines.join('\n')
      : msg.slice(0, 300);

    const wrappedError = new Error(
      `MDX compilation failed for ${filePath}:\n${summary}`
    );
    wrappedError.originalError = error;
    return wrappedError;
  }

  // React rendering errors (component threw during render)
  if (msg.includes('is not a function') || msg.includes('is not defined') || msg.includes('Cannot read properties')) {
    const wrappedError = new Error(
      `MDX render error in ${filePath}: A component threw during server-side rendering.\n${msg.slice(0, 300)}`
    );
    wrappedError.originalError = error;
    return wrappedError;
  }

  // Generic fallback
  const wrappedError = new Error(
    `MDX error in ${filePath}: ${msg.slice(0, 500)}`
  );
  wrappedError.originalError = error;
  return wrappedError;
}

/**
 * Build a local React runtime bundle for client-side hydration.
 * 
 * Uses esbuild to bundle React + ReactDOM from node_modules into a single
 * browser-ready file that sets window.React and window.ReactDOM globals.
 * This replaces the previous CDN approach (unpkg) which broke with React 19
 * since React 19 removed UMD builds.
 * 
 * @param {string} publicDir - Absolute path to the output public/ directory
 * @returns {Promise<void>}
 */
export async function buildReactRuntime(publicDir) {
  const outfile = join(publicDir, 'react-runtime.js');

  // Skip rebuild if already exists (for incremental builds)
  if (existsSync(outfile)) return;

  await mkdir(publicDir, { recursive: true });

  await esbuild.build({
    stdin: {
      contents: `
        import React from 'react';
        import * as ReactDOM from 'react-dom';
        import { hydrateRoot } from 'react-dom/client';
        import * as _jsx_runtime from 'react/jsx-runtime';
        window.React = React;
        window.ReactDOM = { ...ReactDOM, hydrateRoot };
        window._jsx_runtime = _jsx_runtime;
      `,
      resolveDir: dirname(new URL(import.meta.url).pathname),
      loader: 'js',
    },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    minify: true,
    outfile,
  });
}

/**
 * Generate the hydration script tags for an MDX page.
 * References the locally-built React runtime instead of CDN.
 * 
 * @param {string} clientCode - The bundled MDX client code from renderMDX
 * @param {string} [containerId='main-content'] - The ID of the container element to hydrate
 * @returns {string} HTML script tags to include in the page
 */
export function generateHydrationScript(clientCode, containerId = 'main-content') {
  // Escape the code for embedding in a script tag
  const escapedCode = clientCode
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${')
    .replace(/<\/script>/gi, '<\\/script>');

  return `
    <!-- React runtime for MDX hydration (built from node_modules) -->
    <script src="/public/react-runtime.js"></script>
    
    <!-- MDX Hydration -->
    <script>
    (function() {
      // getMDXComponent: matches mdx-bundler/client calling convention.
      // The bundled code is a function body expecting (React, ReactDOM, _jsx_runtime)
      // as parameters and returning { default: Component }.
      function getMDXComponent(code) {
        var React = window.React;
        var ReactDOM = window.ReactDOM;
        var _jsx_runtime = window._jsx_runtime;
        var fn = new Function('React', 'ReactDOM', '_jsx_runtime', code);
        var mdxExport = fn(React, ReactDOM, _jsx_runtime);
        return mdxExport.default;
      }
      
      // Hydrate when DOM is ready
      function hydrate() {
        try {
          var container = document.getElementById('${containerId}');
          if (!container) {
            console.error('MDX hydration: container #${containerId} not found');
            return;
          }
          
          // MDX bundled code (compiled by mdx-bundler)
          var mdxCode = \`${escapedCode}\`;
          var Component = getMDXComponent(mdxCode);
          
          // Use hydrateRoot (React 18+)
          window.ReactDOM.hydrateRoot(container, window.React.createElement(Component));
          console.log('MDX hydration complete');
        } catch (err) {
          console.error('MDX hydration error:', err);
        }
      }
      
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', hydrate);
      } else {
        hydrate();
      }
    })();
    </script>`;
}
