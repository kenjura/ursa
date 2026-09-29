import { getImageTag } from './WikiImage.js';
import { createSlugger, slugify } from './slug.cjs';

let instance = {};

// Pre-compiled regex patterns for better performance
// These are created once at module load time instead of on every call
const REGEX = {
  menuStyle: /^_(menu|style)/,
  hasH1: /^=([^=\n]+)=/,
  noH1: /^__NOH1__/,
  noH1Replace: /__NOH1__/g,
  nowiki: /<nowiki>([\d\D]*?)<\/nowiki>/g,
  codeBlock: /^ ([^\n]*)$/gm,
  htmlTag: /<\/?[A-Za-z][^>]*>/g,
  h3: /^===([^=\n]+)===/gm,
  h2: /^==([^=\n]+)==/gm,
  h1: /^=([^=\n]+)=/gm,
  numberedList: /(\n|^)#([\d\D]*?)(\n(?!#)|$)/g,
  bulletList: /(\n|^)\*([\d\D]*?)(\n(?!\*)|$)/g,
  ddDt: /^;([^:\n]*)\n?(?::(.*))?/gm,
  dd: /^:(.*)/m,
  hr: /---/g,
  boldItalic: /'''''([^']+)'''''/g,
  bold: /'''([^']+)'''/g,
  italic: /''([^']+)''/g,
  embiggen3: /\+\+\+([^\+]+)\+\+\+/g,
  embiggen2: /\+\+([^\+]+)\+\+/g,
  table: /\{\|([\d\D]*?)\|\}/g,
  indent3: /^\.\.\.(.*)$/gm,
  indent2: /^\.\.(.*)$/gm,
  indent1: /^\.(.*)$/gm,
  wikiLink1: /\[\[([^\[\]\|#]*)(?:(\|[^\]\|#]*)+)?(?:#([^\]\|#]*))?\]\]/g,
  wikiLink2: /\[\[([^\[\]\|#\n]*)((\|[^\]\|#\n]*)+)?(?:#([^\]\|#\n]*))?\]\]/g,
  externalLink: /\[([^\]\n ]*)(?: ([^\]\n]+))?\]/g,
  paragraph: /^[^\$\n].*$/gm,
  emptyP: /<p><\/p>/g,
  superscript: /\^([^\^]*)\^/g,
  nowikiRestore: /\$NOWIKI_(\d*)\$/g,
  codeRestore: /\$CODE_(\d*)\$/g,
  codeJoin: /<\/code>\s*<code>/g,
  htmlRestore: /\$HTML_(\d*)\$/g,
  heading: /<h([1-6])>([\d\D]*?)<\/h\1>/g,
};

export function wikiToHtml({ wikitext, articleName, args } = {}) {
  if (!args) args = { db: "noDB" };
  if (!wikitext) return "nothing to render";

  const db = args.db || "noDB";
  const linkbase = ("/" + db + "/").replace(/\/\//g, "/");
  const imageroot = ("/" + db + "/img/").replace(/\/\//g, "/");

  // console.log('wikitext=',wikitext);
  var html = String(wikitext);
  // instance.article = article;

  // convenience features
  // 1 - add title if none present
  if (
    !args.noH1 &&
    !articleName.match(REGEX.menuStyle) &&
    !html.match(REGEX.hasH1) &&
    !html.match(REGEX.noH1)
  )
    html = "=" + articleName.replace(/^_/, "") + "=\n" + html;
  html = html.replace(REGEX.noH1Replace, "");

  // basic formatting ------------------------------------------
  // nowiki
  html = html.replace(REGEX.nowiki, processNoWiki);
  html = html.replace(REGEX.codeBlock, processCodeBlock);
  html = html.replace(REGEX.htmlTag, processHTML);
  //html = html.replace( /{(?!\|)([^\|]+\|)?([^}]*)}/g , processJSON );
  // headers
  html = html.replace(REGEX.h3, "<h3>$1</h3>");
  html = html.replace(REGEX.h2, "<h2>$1</h2>");
  html = html.replace(REGEX.h1, "<h1>$1</h1>");

  // bullets
  html = html.replace(REGEX.numberedList, processNumberedLists);
  html = html.replace(REGEX.bulletList, processBullets);

  // dd/dt
  html = html.replace(REGEX.ddDt, "<dl><dt>$1</dt><dd>$2</dd></dl>");
  html = html.replace(REGEX.dd, "<dd>$1</dd>\n");
  // hr
  html = html.replace(REGEX.hr, "<hr>");
  // inline
  html = html.replace(REGEX.boldItalic, "<b><i>$1</i></b>");
  html = html.replace(REGEX.bold, "<b>$1</b>");
  html = html.replace(REGEX.italic, "<i>$1</i>");
  // html = html.replace( /''(.*?)''/g , '<i>$1</i>' );
  // strikethrough
  // html = html.replace( /--(.*?)--/g , '<strike>$1</strike>' );
  // embiggen
  html = html.replace(REGEX.embiggen3, '<span class="ursa-big" data-level="2">$1</span>');
  html = html.replace(REGEX.embiggen2, '<span class="ursa-big" data-level="1">$1</span>');
  // tables
  html = html.replace(REGEX.table, processTable);
  // div/indent
  html = html.replace(REGEX.indent3, '<div class="ursa-indent" data-level="2">$1</div>');
  html = html.replace(REGEX.indent2, '<div class="ursa-indent" data-level="1">$1</div>');
  html = html.replace(REGEX.indent1, "<div>$1</div>");
  // links
  html = html.replace(REGEX.wikiLink1, processLink);
  html = html.replace(REGEX.wikiLink2, processLink);
  html = html.replace(REGEX.externalLink, processExternalLink);

  // code
  // html = html.replace( /^ (.*)$/mg , '<code>$1</code>' );
  // paragraphs
  html = html.trim();
  // html = html.replace( /^.*$/gm , processParagraphs );
  html = html.replace(REGEX.paragraph, processParagraphs);
  html = html.replace(REGEX.emptyP, "");
  // beautify HTML
  //html = beautifyHTML(html);

  // superscript
  html = html.replace(REGEX.superscript, "<sup>$1</sup>");

  // restore nowiki blocks
  html = html.replace(REGEX.nowikiRestore, processNoWikiRestore);
  html = html.replace(REGEX.codeRestore, processCodeBlockRestore);
  html = html.replace(REGEX.codeJoin, "\n");
  html = html.replace(REGEX.htmlRestore, processHTMLRestore);
  //html = html.replace( /\$JSON_(\d*)\$/g , processJSONRestore );

  // sections and heading ids (SPEC §3). Unlike the old sectionOuter
  // templates this always runs: sections are part of the document markup now,
  // not something the page adds.
  html = sectionize(html);

  // toc html
  if (args.toc) return html;
  var tocHtml = getTOC(wikitext);

  // return html;
  return {
    html: html,
    wikitext: wikitext,
    tocHtml: tocHtml,
  };

  function getTOC(wikitext) {
    if (!wikitext) return "";
    var headerRows = wikitext.match(/^=.*/gm);
    if (!headerRows || !headerRows.length) return "";
    headerRows = headerRows.filter((hr) => hr.indexOf("|right") < 0);
    var headers = headerRows.join("\n");
    headers = headers.replace(/\[\[/g, "");
    headers = headers.replace(/\]\]/g, "");
    headers = headers.replace(/^===([^=|]*)(.*)$/gm, "*** $1");
    headers = headers.replace(/^==([^=|]*)(.*)$/gm, "** $1");
    headers = headers.replace(/^=([^=|]*)(.*)$/gm, "* $1");
    headers = headers.replace(/=([^=|]*)/g, "$1");
    headers = headers.replace(/\* (.*)$/gm, "* [[#$1]]");
    return wikiToHtml(headers, "toc", {
      toc: true,
      noSection: true,
      noH1: true,
    });
  }

  /**
   * Wrap each h1 run, and each h2 run inside it, in section.ursa-section, and
   * give every heading a slug id. A heading's `|classes|style` arguments go on
   * its section; an h1 whose argument is `right` becomes aside.ursa-sidebar
   * (no heading) holding everything up to the next h1.
   */
  function sectionize(html) {
    const slug = createSlugger();
    const open = []; // closing tags of the open sections, innermost last
    const levels = [];
    let out = "";
    let last = 0;
    let match;
    REGEX.heading.lastIndex = 0;
    while ((match = REGEX.heading.exec(html))) {
      out += html.slice(last, match.index);
      last = REGEX.heading.lastIndex;
      const level = Number(match[1]);
      const [title, classes = "", style = ""] = match[2].split("|").map((part) => part.trim());
      if (level <= 2) {
        while (levels.length && levels[levels.length - 1] >= level) {
          levels.pop();
          out += open.pop();
        }
        if (level === 1 && classes === "right") {
          out += '<aside class="ursa-sidebar">';
          open.push("</aside>");
          levels.push(level);
          continue;
        }
        const classAttr = ["ursa-section", classes].filter(Boolean).join(" ");
        const styleAttr = style ? ` style="${style}"` : "";
        out += `<section class="${classAttr}" data-level="${level}"${styleAttr}>`;
        open.push("</section>");
        levels.push(level);
      }
      out += `<h${level} id="${slug(stripTags(title))}">${title}</h${level}>`;
    }
    out += html.slice(last);
    while (open.length) out += open.pop();
    return out;
  }

  function processLink(entireMatch, articleName, displayName, anchor) {
    var namespace = [].concat(articleName.match(/([^:]+)(?=:)/g)).pop();
    if (namespace)
      var res = processSpecialLink(
        entireMatch,
        namespace,
        articleName,
        displayName
      );
    if (res) return res;
    if (!anchor) anchor = "";

    if (articleName.match(/^(\d+d\d+)([+-]\d+)/))
      return (
        "<a onclick=\"roll('" + articleName + "')\">" + articleName + "</a>"
      );
    if (articleName.match(/^[+-]/))
      return '<a onclick="roll(' + articleName + ')">' + articleName + "</a>";

    // if (isNullOrEmpty(articleName)) return '<a href="#'+anchor+'" onclick="instance.findHeader(\''+anchor+'\')">'+anchor+'</a>';
    if (!articleName)
      return (
        '<a data-scroll href="#' +
        slugify(anchor) +
        '">' +
        anchor +
        "</a>"
      );

    if (!displayName) displayName = anchor || articleName;
    else if (displayName.substr(0, 1) == "|")
      displayName = displayName.substr(1);

    if (!anchor) anchor = "";
    else anchor = "#" + slugify(anchor);

    // Note: Link validation (active/inactive status) is now handled by linkValidator.js
    // after HTML generation, so we don't set active/inactive class here.

    if (articleName.indexOf("/") >= 0) {
      // assume the link is fully formed
      return `<a class="ursa-wikilink" data-article="${articleName}" href="${articleName}">${
        displayName || articleName
      }</a>`;
    } else {
      var link = linkbase + articleName + anchor;

      return (
        '<a class="ursa-wikilink" data-article="' +
        articleName +
        '" href="' +
        link +
        '">' +
        displayName +
        "</a>"
      );
    }
  }

  function processNumberedLists(entireMatch) {
    var lines = entireMatch.match(/^(.*)$/gm);
    var level = 1;
    var html = "\n<ol>";
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.substr(0, 1) != "#") continue;
      var lineLevel = line.match(/#+/)[0].length;
      if (lineLevel > level) html += stringRepeat("<ol>", lineLevel - level);
      if (lineLevel < level)
        html += stringRepeat("</li></ol>", level - lineLevel);
      if (lineLevel == level && html != "\n<ol>") html += "</li>";
      level = lineLevel;
      //html += '\n'+stringRepeat('\t',lineLevel);
      html += "<li>" + line.replace(/#+/, "");
    }

    if (level > 1) html += stringRepeat("</li></ol>", level);
    html += "</li></ol>\n";
    return html;
  }

  function processBullets(entireMatch) {
    var lines = entireMatch.match(/^(.*)$/gm);
    var level = 1;
    var html = "\n<ul>";
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.substr(0, 1) != "*") continue;
      var lineLevel = line.match(/\*+/)[0].length;
      if (lineLevel > level) html += stringRepeat("<ul>", lineLevel - level);
      if (lineLevel < level)
        html += stringRepeat("</li></ul>", level - lineLevel);
      if (lineLevel == level && html != "\n<ul>") html += "</li>";
      level = lineLevel;
      //html += '\n'+stringRepeat('\t',lineLevel);
      html += "<li>" + line.replace(/\*+/, "");
    }

    if (level > 1) html += stringRepeat("</li></ul>", level);
    html += "</li></ul>\n";
    return html;
  }
  function processExternalLink(entireMatch, url, displayName) {
    if (!displayName) displayName = url;
    return '<a href="' + url + '">' + displayName + "</a>";
  }
  function processSpecialLink(
    entireMatch,
    namespace,
    articleName,
    displayName
  ) {
    var args = [];
    if (!displayName) displayName = "";
    else {
      args = getMatches(entireMatch, /\|([^\|\]]+)/g, 0);
      // var str = [].concat(entireMatch.match( /\[\[([^\]]+)\]\]/ )).pop();
      // if (str) args = str.split('|');
    }

    articleName = articleName.replace(namespace + ":", "");

    function getArg(index) {
      if (args.length >= index) return args[index];
      else return "";
    }

    switch (namespace.toUpperCase()) {
      case "IFRAME":
        return '<iframe src="' + articleName + '"' + getArg(0) + "></iframe>";
      case "IMAGE":
        return getImageTag({
          name: articleName,
          args: args,
          imgUrl: imageroot + articleName,
        });
      default:
        return null;
    }
  }

  function processJSON(entireMatch, options, tag) {
    if (!instance._JSONTags) instance._JSONTags = [];
    instance._JSONTags.push(
      new JSONTag({ options: options, body: "{" + tag + "}" })
    );
    return "$JSON_" + (instance._JSONTags.length - 1) + "$";
  }
  function processJSONRestore(entireMatch, arrayIndex) {
    var tag = instance._JSONTags[parseInt(arrayIndex)];
    return "JSON tag: " + tag.render();
  }
  function processHTML(entireMatch) {
    if (!instance._htmlTags) instance._htmlTags = [];
    instance._htmlTags.push(entireMatch);
    return "$HTML_" + (instance._htmlTags.length - 1) + "$";
  }
  function processHTMLRestore(entireMatch, arrayIndex) {
    return instance._htmlTags[parseInt(arrayIndex)];
  }
  function processNoWiki(entireMatch, wikiText) {
    if (!instance._noWiki) instance._noWiki = [];
    instance._noWiki.push(wikiText);
    return "$NOWIKI_" + (instance._noWiki.length - 1) + "$";
  }
  function processNoWikiRestore(entireMatch, arrayIndex) {
    return instance._noWiki[parseInt(arrayIndex)];
  }
  function processCodeBlock(entireMatch, wikiText) {
    if (!instance._CodeBlock) instance._CodeBlock = [];
    instance._CodeBlock.push(wikiText);
    return "$CODE_" + (instance._CodeBlock.length - 1) + "$";
  }
  function processCodeBlockRestore(entireMatch, arrayIndex) {
    return "<code>" + instance._CodeBlock[parseInt(arrayIndex)] + "</code>";
  }
  function processParagraphs(entireMatch) {
    if (entireMatch.substr(0, 1) == "<") return entireMatch; // html? looks like it's already been converted, let's leave it alone
    if (entireMatch.indexOf("$HTML") > -1) return entireMatch;
    if (entireMatch.indexOf("<figure") > -1) return entireMatch; // a figure can't sit in a <p>

    return "<p>" + entireMatch + "</p>";
  }

  function processTable(entireMatch, tableBody) {
    // ***************** LEX ***************
    // protect pipe characters inside a table that have nothing to do with cell boundaries
    entireMatch = entireMatch.replace(/\[\[[^\]\n]+\]\]/g, function (em) {
      return em.replace(/\|/g, "$BAR$");
    });

    // table boundaries
    entireMatch = entireMatch.replace(/\{\|(?:([^>\n]*)>)?/g, "¦TABLE¦$1¦");
    entireMatch = entireMatch.replace(/\|\}/g, "¦END TABLE¦");

    // table rows
    entireMatch = entireMatch.replace(/^\|-/gm, "¦ROW BOUNDARY¦");

    // table headers

    // note 2013-04-02: tweaked TH regex to allow ! characters inside TD cells. Basically, a single ! is only a "start TH" if it is preceded by a newline.
    // note 2014-06-19: swapped out $ for \n inside the TH/TD optional HTML attributes section. In a character class, $ doesn't mean "end of line", it's always literal. For some reason.

    //entireMatch = entireMatch.replace( /!{1,2}(?:([^$>\|!]+)>|([0-9]+)\|)?([^!\|¦]+)(?=\n!|!!|\n\||\|\||¦)/gm , function(wholeMatch,m0,m1,m2,m3,m4,m5) {
    entireMatch = entireMatch.replace(
      /(?:^!|!!)(?:([^\n>\|!]+)>|([0-9]+)\|)?([^!\|¦]+)(?=\n!|!!|\n\||\|\||¦)/gm,
      function (wholeMatch, m0, m1, m2, m3, m4, m5) {
        m0 = m0 || "";
        m2 = m2 || "";
        if (m1 != "" && typeof m1 != "undefined")
          return '¦TH¦colspan="' + m1 + '" ' + m0 + "¦" + m2 + "¦END TH¦";
        else return "¦TH¦" + m0 + "¦" + m2 + "¦END TH¦";
        // m0 = !m0>
        // m1 = !m1| aka colspan
        // m2 = actual cell content
      }
    );
    //return entireMatch;
    entireMatch = entireMatch.replace(
      /\|{1,2}(?:([^\n>\|!]+)>|([0-9]+)\|)?([^\|¦]+)(?=\n!|!!|\n\||\|\||¦)/gm,
      function (wholeMatch, m0, m1, m2, m3) {
        m0 = m0 || "";
        m2 = m2 || "";
        if (m1 != "" && typeof m1 != "undefined")
          return '¦TD¦colspan="' + m1 + '" ' + m0 + "¦" + m2 + "¦END TD¦";
        else return "¦TD¦" + m0 + "¦" + m2 + "¦END TD¦";
      }
    );

    // ***************** FINAL ******************
    entireMatch = entireMatch.replace(
      /¦TABLE¦([^¦]*)¦/g,
      '<div class="ursa-table-scroll"><table $1><tr>'
    );
    entireMatch = entireMatch.replace(/¦END TABLE¦/g, "</tr></table></div>");

    entireMatch = entireMatch.replace(/¦ROW BOUNDARY¦/g, "</tr><tr>");

    entireMatch = entireMatch.replace(
      /¦TH¦([^¦]*)¦([^¦]*)¦END TH¦/g,
      "<th $1>$2</th>"
    );
    entireMatch = entireMatch.replace(
      /¦TD¦([^¦]*)¦([^¦]*)¦END TD¦/g,
      function (wholeMatch, m0, m1, m2) {
        return "<td " + (m0 || "") + ">\n" + (m1 || "") + "\n</td>";
      }
    );

    entireMatch = entireMatch.replace(/\$BAR\$/g, "|");

    // **************** RETURN *****************
    return entireMatch;
  }

  function findHeader(name) {
    smoothScroll.animateScroll(null, "#" + name);
    // var headers = document.querySelectorAll('h1,h2,h3');
    // for (var i = 0; i < headers.length; i++) {
    // 	if (headers[i].innerHTML.trim()==name) {
    // 		var y = UIUtil.getPageOffset(headers[i]).y;
    // 		UIUtil.animate( document.body, 300, { scrollTop: y});
    // 		// document.body.scrollTop = y;
    // 		return;
    // 	}
    // }
  }
}

const stripTags = (html) => html.replace(/<[^>]*>/g, "");

const stringRepeat = function (chr, count) {
  var ret = "";
  for (var i = 0; i < count; i++) {
    ret += chr;
  }
  return ret;
};

const getMatches = function (string, regex, index) {
  index || (index = 1); // default to the first capturing group
  var matches = [];
  var match;
  while ((match = regex.exec(string))) {
    matches.push(match[index]);
  }
  return matches;
};
