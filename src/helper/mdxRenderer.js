import { bundleMDX } from "mdx-bundler";
import { getMDXComponent } from "mdx-bundler/client/index.js";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { dirname } from "path";

/**
 * Render an MDX file to static HTML.
 * 
 * Uses mdx-bundler to compile MDX source (with component imports resolved via esbuild),
 * then renders the resulting React component to static HTML using react-dom/server.
 *
 * @param {Object} options
 * @param {string} options.source - Raw MDX file contents
 * @param {string} options.filePath - Absolute path to the MDX file (used for import resolution)
 * @param {string} [options.sourceRoot] - Root directory of the source files (for absolute imports)
 * @returns {Promise<{ html: string, frontmatter: Record<string, any> }>}
 */
export async function renderMDX({ source, filePath, sourceRoot }) {
  const cwd = dirname(filePath);

  const esbuildOptions = (options) => {
    // Enable loaders for TypeScript/JSX component files
    options.loader = {
      ...options.loader,
      ".js": "jsx",
      ".ts": "tsx",
      ".tsx": "tsx",
      ".jsx": "jsx",
    };
    // Set target for modern Node.js
    options.target = "es2020";
    options.platform = "node";
    return options;
  };

  try {
    const result = await bundleMDX({
      source,
      cwd,
      esbuildOptions,
      // mdx-bundler uses gray-matter internally for frontmatter
      mdxOptions(options) {
        return options;
      },
    });

    const { code, frontmatter } = result;

    // getMDXComponent evaluates the bundled code and returns a React component
    const Component = getMDXComponent(code);

    // Render to static HTML (no client-side React needed)
    const html = renderToStaticMarkup(React.createElement(Component));

    return { html, frontmatter: frontmatter || {} };
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
