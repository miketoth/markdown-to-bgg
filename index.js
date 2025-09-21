/**
 * bgg-markdown-converter.js (JavaScript)
 *
 * A lightweight, dependency-free converter between BoardGameGeek forum markup ("GeekText")
 * and CommonMark/GitHub-flavored Markdown.
 *
 * Exported API (CommonJS):
 *   - bggToMarkdown(input)
 *   - markdownToBgg(input)
 *   - convert(input, direction)
 *
 * Notes & scope:
 * - Focuses on common BGG tags: [b], [i], [u], [s]/[-]…[/-], [url], [img], [quote], [list]/[olist] + [*],
 *   [code], [thing], [user], [size], [tt].
 * - Protects code blocks while transforming other markup.
 * - Heuristic mapping for [size] ↔ Markdown headings.
 */

// -------------- Helpers --------------

function esc(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Protect segments delimited by start/end regex and replace with tokens so other regexes don't touch them.
 */
function protectSegments(input, pairs) {
  let text = input;
  const store = {};
  let counter = 0;

  for (const { name, start, end } of pairs) {
    let m;
    const re = new RegExp(start.source, start.flags.replace("g", ""));

    while ((m = re.exec(text))) {
      const startIdx = m.index;
      const afterStart = startIdx + m[0].length;

      let endIdx = -1;
      if (!end) {
        endIdx = afterStart;
      } else {
        const endRe = new RegExp(end.source, end.flags.replace("g", ""));
        endRe.lastIndex = afterStart;
        const endMatch = endRe.exec(text);
        if (!endMatch) break; // unmatched; give up
        endIdx = endMatch.index + endMatch[0].length;
      }

      const chunk = text.slice(startIdx, endIdx);
      const token = `__PROTECTED_${name}_${counter++}__`;
      store[token] = chunk;
      text = text.slice(0, startIdx) + token + text.slice(endIdx);
      re.lastIndex = startIdx + token.length;
    }
  }
  return {
    text,
    restore: (s) => s.replace(/__PROTECTED_([A-Z0-9_]+?)_(\d+)__/g, (t) => store[t] ?? t),
  };
}

// Map BGG [size] to Markdown heading level and back (heuristics)
const sizeToHashes = [
  { threshold: 24, hashes: "#" },
  { threshold: 18, hashes: "##" },
  { threshold: 16, hashes: "###" },
  { threshold: 14, hashes: "####" },
  { threshold: 12, hashes: "#####" },
  { threshold: 10, hashes: "######" },
];

function sizeToHeading(sizeStr) {
  const n = parseInt(sizeStr, 10);
  if (!isFinite(n)) return null;
  for (const m of sizeToHashes) {
    if (n >= m.threshold) return m.hashes;
  }
  return null;
}

function headingToSize(hashes) {
  switch (hashes.length) {
    case 1: return 24;
    case 2: return 18;
    case 3: return 16;
    case 4: return 14;
    case 5: return 12;
    default: return 10;
  }
}

// Convert a BGG [quote] body into Markdown blockquote
function quoteBodyToMarkdown(body) {
  const lines = String(body).replace(/^\n+|\n+$/g, "").split(/\r?\n/);
  return lines.map((l) => "> " + l).join("\n") + "\n\n";
}

function blockquoteMarkdownToBgg(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let buf = [];
  function flush() {
    if (buf.length) {
      const inner = buf.map((l) => l.replace(/^>\s?/, "")).join("\n");
      out.push(`[quote]\n${inner}\n[/quote]`);
      buf = [];
    }
  }
  for (const l of lines) {
    if (/^>\s?/.test(l)) buf.push(l); else { flush(); out.push(l); }
  }
  flush();
  return out.join("\n");
}

// -------------- BGG → Markdown --------------

function bggToMarkdown(input) {
  if (!input) return input;

  const { text: t1, restore } = protectSegments(input, [
    { name: "CODE_BGG", start: /\[code\]/i, end: /\[\/code\]/i },
  ]);
  let out = t1;

  // [code] → fenced ```
  out = out.replace(/\[code\]([\s\S]*?)\[\/code\]/gi, (_, body) => {
    const clean = String(body).replace(/^\n+|\n+$/g, "");
    return "\n```\n" + clean + "\n```\n";
  });

  // [tt] → inline code
  out = out.replace(/\[tt\]([\s\S]*?)\[\/tt\]/gi, (_, body) => "`" + body + "`");

  // Basic inline styles
  out = out.replace(/\[b\]([\s\S]*?)\[\/b\]/gi, "**$1**");
  out = out.replace(/\[i\]([\s\S]*?)\[\/i\]/gi, "*$1*");
  out = out.replace(/\[u\]([\s\S]*?)\[\/u\]/gi, "<u>$1<\/u>");
  out = out.replace(/\[s\]([\s\S]*?)\[\/s\]/gi, "~~$1~~");
  out = out.replace(/\[-\]([\s\S]*?)\[\/-\]/gi, "~~$1~~");

  // Links & images
  out = out.replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, (_, href, text) => `[${text}](${href})`);
  out = out.replace(/\[img\]([\s\S]*?)\[\/img\]/gi, (_, src) => `![](${src})`);

  // [thing] and [user]
  out = out.replace(/\[thing=(\d+)\]([\s\S]*?)\[\/thing\]/gi, (_, id, text) => `[${text}](https://boardgamegeek.com/thing/${id})`);
  out = out.replace(/\[user=\d+\]([\s\S]*?)\[\/user\]/gi, (_, name) => `[@${name}](https://boardgamegeek.com/user/${name})`);

  // [quote]
  out = out.replace(/\[quote\]([\s\S]*?)\[\/quote\]/gi, (_, body) => quoteBodyToMarkdown(body));

  // [list]
  out = out.replace(/\[list\]([\s\S]*?)\[\/list\]/gi, (_, body) => {
    const items = String(body)
      .replace(/\r?\n/g, "\n")
      .split(/\n?\[\*\]\s*/i)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!items.length) return "";
    return "\n" + items.map((it) => `- ${it.replace(/\[\/*\]/g, "").trim()}`).join("\n") + "\n";
  });

  // [olist]
  out = out.replace(/\[olist\]([\s\S]*?)\[\/olist\]/gi, (_, body) => {
    const items = String(body)
      .replace(/\r?\n/g, "\n")
      .split(/\n?\[\*\]\s*/i)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!items.length) return "";
    return "\n" + items.map((it, i) => `${i + 1}. ${it.replace(/\[\/*\]/g, "").trim()}`).join("\n") + "\n";
  });

  // [size]
  out = out.replace(/\[size=(\d{1,3})\]([\s\S]*?)\[\/size\]/gi, (_, sz, text) => {
    const hashes = sizeToHeading(sz);
    const inner = String(text).trim();
    if (hashes && /^(?:.|\n){0,120}$/.test(inner) && !/\n/.test(inner)) {
      return `\n${hashes} ${inner}\n\n`;
    }
    return inner;
  });

  // [br]
  out = out.replace(/\[br\s*\/?\]/gi, "  \n");

  out = restore(out);
  return out;
}

// -------------- Markdown → BGG --------------

function markdownToBgg(input) {
  if (!input) return input;

  const { text: t1, restore } = protectSegments(input, [
    { name: "CODE_FENCE", start: /```[\s\S]*?\n/, end: /\n```/ },
  ]);
  let out = t1;

  // Fenced code → [code]
  out = out.replace(/```([a-z0-9_-]+)?\n([\s\S]*?)\n```/gi, (_, _lang, body) => `[code]\n${String(body).replace(/^\n+|\n+$/g, "")}\n[/code]`);

  // Inline code
  out = out.replace(/`([^`\n]+)`/g, (_, body) => `[tt]${body}[/tt]`);

  // Blockquotes
  out = blockquoteMarkdownToBgg(out);

  // Headings
  out = out.replace(/^(#{1,6})\s+(.+)$/gm, (_, hashes, text) => {
    const size = headingToSize(hashes);
    return `[size=${size}]${text.trim()}[/size]`;
  });

  // Bold, italics, strike
  out = out.replace(/\*\*([\s\S]*?)\*\*/g, "[b]$1[/b]");
  out = out.replace(/(?<!\*)\*([^\s*][\s\S]*?)\*(?!\*)/g, "[i]$1[/i]");
  out = out.replace(/(?<!_)_([^\s_][\s\S]*?)_(?!_)/g, "[i]$1[/i]");
  out = out.replace(/~~([\s\S]*?)~~/g, "[s]$1[/s]");

  // Links & images
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (m, text, href) => {
    const thingMatch = /boardgamegeek\.com\/(?:thing|boardgame)\/(\d+)/i.exec(href);
    if (thingMatch) return `[thing=${thingMatch[1]}]${text}[/thing]`;
    const userMatch = /boardgamegeek\.com\/user\/([A-Za-z0-9_-]+)/i.exec(href);
    if (userMatch) return `[user=0]${userMatch[1]}[/user]`;
    return `[url=${href}]${text}[/url]`;
  });
  out = out.replace(/!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g, (_m, _alt, src) => `[img]${src}[/img]`);

  // Unordered lists
  out = out.replace(/(?:^|\n)([ \t]*)([-*+])\s+(.+)(?:\n\1\2\s+.+)*/g, (block) => {
    const lines = block.trim().split(/\r?\n/);
    const items = lines.map((l) => l.replace(/^[ \t]*[-*+]\s+/, "").trim());
    return `\n[list]\n` + items.map((it) => `[*] ${it}`).join("\n") + "\n[/list]`;
  });

  // Ordered lists
  out = out.replace(/(?:^|\n)([ \t]*)\d+\.\s+(.+)(?:\n\1\d+\.\s+.+)*/g, (block) => {
    const lines = block.trim().split(/\r?\n/);
    const items = lines.map((l) => l.replace(/^[ \t]*\d+\.\s+/, "").trim());
    return `\n[olist]\n` + items.map((it) => `[*] ${it}`).join("\n") + "\n[/olist]`;
  });

  // Line breaks (two spaces)
  out = out.replace(/  \n/g, "[br]\n");

  // Underline HTML → [u]
  out = out.replace(/<u>([\s\S]*?)<\/u>/gi, "[u]$1[/u]");

  out = restore(out);
  return out;
}

function convert(input, direction) {
  return direction === "bgg2md" ? bggToMarkdown(input) : markdownToBgg(input);
}

// -------------- Minimal CLI --------------
// Usage:
//   node bgg-markdown-converter.js --from bgg < input.txt > output.md
//   node bgg-markdown-converter.js --from md < input.md > output.bgg

if (typeof require !== 'undefined' && require.main === module) {
  const fs = require("fs");

  const from = process.argv.includes("--from")
    ? process.argv[process.argv.indexOf("--from") + 1]
    : "bgg";

  const direction = from === "bgg" ? "bgg2md" : "md2bgg";
  const input = fs.readFileSync(0, "utf8");
  const result = convert(input, direction);
  process.stdout.write(result);
}

// CommonJS exports
if (typeof module !== 'undefined') {
  module.exports = { bggToMarkdown, markdownToBgg, convert };
}

/* Quick examples
BGG → Markdown
---------------
[input]
  [size=24]Building a Team Brawler[/size]\n\n[b]Hello[/b], see [url=https://boardgamegeek.com]site[/url].\n\n[list]\n[*] One\n[*] Two\n[/list]\n\n[quote]\nThis is quoted.\n[/quote]\n
[output]
  # Building a Team Brawler

  **Hello**, see [site](https://boardgamegeek.com).

  - One
  - Two

  > This is quoted.

Markdown → BGG
---------------
[input]
  # Title\n\n**Bold** *italic* ~~strike~~ and [link](https://boardgamegeek.com/thing/13).\n\n- A\n- B\n
[output]
  [size=24]Title[/size]\n\n[b]Bold[/b] [i]italic[/i] [s]strike[/s] and [thing=13]link[/thing].\n\n[list]\n[*] A\n[*] B\n[/list]
*/

