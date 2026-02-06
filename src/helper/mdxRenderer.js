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
    // Wrap with context about which file failed
    const wrappedError = new Error(
      `MDX compilation failed for ${filePath}: ${error.message}`
    );
    wrappedError.originalError = error;
    throw wrappedError;
  }
}
