
import { markdownToHtml } from "./markdownHelper.cjs";
import { wikiToHtml } from "./wikitextHelper.js";

const DEFAULT_WIKITEXT_ARGS = { db: "noDB", noSection: true, noTOC: true };

export function renderFile({ fileContents, type, dirname, basename }) {
  switch (type) {
    case ".md":
      return markdownToHtml(fileContents);
    case ".txt":
      return wikiToHtml({
        wikitext: fileContents,
        articleName: basename,
        args: { ...DEFAULT_WIKITEXT_ARGS, db: dirname },
      })?.html;
  }
}