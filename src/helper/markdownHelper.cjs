const { createSlugger } = require("./slug.cjs");

const markdown = require("markdown-it")({ html: true });

markdown.use(require("markdown-it-container"), "aside", getAside());
markdown.use(require("markdown-it-deflist"));
markdown.use(require("markdown-it-sup"));
markdown.use(require("markdown-it-front-matter"), handleFrontMatter);
markdown.core.ruler.push("ursa_structure", ursaStructure);

module.exports = { markdownToHtml };

function markdownToHtml(md) {
  return markdown.render(md);
}

function getAside() {
  return {
    validate: function (params) {
      return true;
    },

    render: function (tokens, idx) {
      return tokens[idx].nesting === 1 ? '<aside class="ursa-aside">\n' : "</aside>\n";
    },
  };
}

function handleFrontMatter(frontMatter) {}

/**
 * Document structure (SPEC §3): slug ids on every heading, tables wrapped in
 * .ursa-table-scroll, and one section.ursa-section per top-level h1 with one
 * per h2 nested inside it. Content before the first h1/h2 is left unwrapped.
 */
function ursaStructure(state) {
  const slug = createSlugger();
  const html = (content) => {
    const token = new state.Token("html_block", "", 0);
    token.content = content;
    return token;
  };
  const out = [];
  const open = []; // levels of the sections currently open, outermost first

  for (let i = 0; i < state.tokens.length; i++) {
    const token = state.tokens[i];

    if (token.type === "heading_open") {
      const inline = state.tokens[i + 1];
      token.attrSet("id", slug(inlineText(inline)));

      const level = Number(token.tag.slice(1));
      if (token.level === 0 && level <= 2) {
        while (open.length && open[open.length - 1] >= level) {
          open.pop();
          out.push(html("</section>\n"));
        }
        out.push(html(`<section class="ursa-section" data-level="${level}">\n`));
        open.push(level);
      }
    }

    if (token.type === "table_open") out.push(html('<div class="ursa-table-scroll">\n'));
    out.push(token);
    if (token.type === "table_close") out.push(html("</div>\n"));
  }

  while (open.pop()) out.push(html("</section>\n"));
  state.tokens = out;
}

function inlineText(inline) {
  if (!inline?.children) return inline?.content ?? "";
  return inline.children
    .filter((t) => t.type === "text" || t.type === "code_inline")
    .map((t) => t.content)
    .join("");
}
