# Link Resolution logic

The core feature of Ursa is to process every document (.md, .mdx, .txt, .yml) in a document tree and render it to HTML. During this process, Ursa processes links in every document with a variety of rules to determine if the link is valid, and if so, what the final URL should be in the rendered HTML.

The process works as follows:
- In the generation phase, Ursa reads every source document (.md, .mdx, .txt, .yml) and looks for links according to that document type's link syntax. For example, in Markdown documents, Ursa looks for the standard Markdown link syntax of [label](target). In wikitext documents, Ursa looks for [[target|label]] or [[target]] syntax.
- For each link found, Ursa iterates through a series of rules. The first rule that matches determines the validity and final rendering of the link. If no rules match, the link is marked as broken and rendered as such in the final HTML.
  - Rule 1: the link matches an exact file path within the docroot.
    - Use cases: links to static assets, and links to other documents using their native extension.
    - Logic: return `file exists`
    - Example 1 (static asset)
      - Using the example docroot below, a link to /img/qux.jpg would match this rule and be rendered as /img/qux.jpg in the final HTML
    - Example 2 (document with native extension)
      - A link to /foo/index.md would match this rule and be rendered as /foo/index.html in the final HTML.
  - Rule 2: the link matches an exact file path after rendering. 
    - Use case: links to documents from other documents.
    - Logic: return `file exists if you replace the extension with .html`
    - Examples:
      - The link foo/index.html doesn't match a source file, but will match foo/index.md after rendering, so the link is valid and will be rendered as foo/index.html in the final HTML.
    - Note: this logic is distinct from rule 3 in that it never changes the path or guesses the filename, and is thus easier and quicker to test.
  - Rule 3: the link matches a path name with an implied filename and extension.
    - Logic: 
      - there is a list of valid patterns
      - for each pattern, plug in the file path and check the resulting path; if there's a file there, it's a match
      - each pattern takes the form: `filepath => fullpath`, e.g. './foo/bar' => './foo/bar/index.md'
      - patterns:
        - {filepath}/index.md
        - {filepath}/home.md
        - {filepath}/{parentFolderName}.md (e.g. /foo/bar => /foo/bar/bar.md)
        - {filepath}/_index.md
        - {filepath}/_home.md
        - repeat the above with .mdx, .txt, .yml, .html extensions
    - Use case: links to documents, with a convenient, shorter syntax
  

Example docroot:
- index.md
- foo/
  - index.md
  - bar/
    - bar.md
- img/
  - qux.jpg