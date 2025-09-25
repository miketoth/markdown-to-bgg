/**
 * bggmd-converter (ESM)
 * BoardGameGeek (GeekText) ↔ Markdown converter.
 *
 * Usage:
 *   import { bggToMarkdown, markdownToBgg, convert } from './bggmd-converter.esm.js'
 *   const md = bggToMarkdown('[b]Hello[/b]')
 */

// ---------- Helpers ----------
function protectSegments(input, pairs) {
  let text = input;
  const store = Object.create(null);
  let counter = 0;
  for (const { name, start, end } of pairs) {
    let m; const re = new RegExp(start.source, start.flags.replace('g',''));
    while ((m = re.exec(text))) {
      const startIdx = m.index; const afterStart = startIdx + m[0].length;
      let endIdx = -1;
      if (!end) endIdx = afterStart; else {
        const endRe = new RegExp(end.source, end.flags.replace('g',''));
        endRe.lastIndex = afterStart; const endMatch = endRe.exec(text);
        if (!endMatch) break; endIdx = endMatch.index + endMatch[0].length;
      }
      const chunk = text.slice(startIdx, endIdx);
      const token = `__PROTECTED_${name}_${counter++}__`;
      store[token] = chunk;
      text = text.slice(0, startIdx) + token + text.slice(endIdx);
      re.lastIndex = startIdx + token.length;
    }
  }
  return { text, restore: (s) => s.replace(/__PROTECTED_([A-Z0-9_]+?)_(\d+)__/g, (t) => store[t] || t) };
}

const sizeToHashes = [
  { threshold: 24, hashes: '#' },
  { threshold: 18, hashes: '##' },
  { threshold: 16, hashes: '###' },
  { threshold: 14, hashes: '####' },
  { threshold: 12, hashes: '#####' },
  { threshold: 10, hashes: '######' },
];
function sizeToHeading(sizeStr) {
  const n = parseInt(sizeStr, 10);
  if (!isFinite(n)) return null;
  for (const m of sizeToHashes) if (n >= m.threshold) return m.hashes;
  return null;
}
function headingToSize(hashes) {
  switch ((hashes||'').length) {
    case 1: return 24; case 2: return 18; case 3: return 16; case 4: return 14; case 5: return 12; default: return 10;
  }
}
function quoteBodyToMarkdown(body) {
  const lines = String(body).replace(/^\n+|\n+$/g, '').split(/\r?\n/);
  return lines.map(l => '> ' + l).join('\n') + '\n\n';
}
function blockquoteMarkdownToBgg(md) {
  const lines = md.split(/\r?\n/); const out = []; let buf = [];
  function flush(){ if (buf.length){ const inner = buf.map(l=>l.replace(/^>\s?/, '')).join('\n'); out.push('[quote]\n'+inner+'\n[/quote]'); buf = []; } }
  for (const l of lines) { if (/^>\s?/.test(l)) buf.push(l); else { flush(); out.push(l); } }
  flush(); return out.join('\n');
}

// ---------- BGG → Markdown ----------
export function bggToMarkdown(input) {
  if (!input) return input;
  const pr = protectSegments(input, [{ name: 'CODE_BGG', start: /\[code\]/i, end: /\[\/code\]/i }]);
  let out = pr.text;

  out = out.replace(/\[code\]([\s\S]*?)\[\/code\]/gi, (_m, body) => {
    const clean = String(body).replace(/^\n+|\n+$/g, '');
    return '\n```\n' + clean + '\n```\n';
  });
  out = out.replace(/\[tt\]([\s\S]*?)\[\/tt\]/gi, (_m, body) => '`' + body + '`');
  out = out.replace(/\[b\]([\s\S]*?)\[\/b\]/gi, '**$1**');
  out = out.replace(/\[i\]([\s\S]*?)\[\/i\]/gi, '*$1*');
  out = out.replace(/\[u\]([\s\S]*?)\[\/u\]/gi, '<u>$1<\/u>');
  out = out.replace(/\[s\]([\s\S]*?)\[\/s\]/gi, '~~$1~~');
  out = out.replace(/\[-\]([\s\S]*?)\[\/-\]/gi, '~~$1~~');
  out = out.replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, (_m, href, text) => '['+text+']('+href+')');
  out = out.replace(/\[img\]([\s\S]*?)\[\/img\]/gi, (_m, src) => '![]('+src+')');
  out = out.replace(/\[thing=(\d+)\]([\s\S]*?)\[\/thing\]/gi, (_m, id, text) => '['+text+'](https://boardgamegeek.com/thing/'+id+')');
  out = out.replace(/\[user=\d+\]([\s\S]*?)\[\/user\]/gi, (_m, name) => '[@'+name+'](https://boardgamegeek.com/user/'+name+')');
  out = out.replace(/\[quote\]([\s\S]*?)\[\/quote\]/gi, (_m, body) => quoteBodyToMarkdown(body));
  out = out.replace(/\[list\]([\s\S]*?)\[\/list\]/gi, (_m, body) => {
    const items = String(body).replace(/\r?\n/g,'\n').split(/\n?\[\*\]\s*/i).map(s=>s.trim()).filter(Boolean);
    if (!items.length) return '';
    return '\n' + items.map(it => '- ' + it.replace(/\[\/*\]/g,'').trim()).join('\n') + '\n';
  });
  out = out.replace(/\[olist\]([\s\S]*?)\[\/olist\]/gi, (_m, body) => {
    const items = String(body).replace(/\r?\n/g,'\n').split(/\n?\[\*\]\s*/i).map(s=>s.trim()).filter(Boolean);
    if (!items.length) return '';
    return '\n' + items.map((it,i) => (i+1)+'. ' + it.replace(/\[\/*\]/g,'').trim()).join('\n') + '\n';
  });
  out = out.replace(/\[size=(\d{1,3})\]([\s\S]*?)\[\/size\]/gi, (_m, sz, text) => {
    const hashes = sizeToHeading(sz); const inner = String(text).trim();
    if (hashes && /^(?:.|\n){0,120}$/.test(inner) && !/\n/.test(inner)) return '\n'+hashes+' '+inner+'\n\n';
    return inner;
  });
  out = out.replace(/\[br\s*\/?\]/gi, '  \n');

  out = pr.restore(out);
  return out;
}

// ---------- Markdown → BGG ----------
export function markdownToBgg(input) {
  if (!input) return input;
  const pr = protectSegments(input, [{ name: 'CODE_FENCE', start: /```[\s\S]*?\n/, end: /\n```/ }]);
  let out = pr.text;

  out = out.replace(/```([a-z0-9_-]+)?\n([\s\S]*?)\n```/gi, (_m, _lang, body) => '[code]\n'+String(body).replace(/^\n+|\n+$/g,'')+'\n[/code]');
  out = out.replace(/`([^`\n]+)`/g, (_m, body) => '[tt]'+body+'[/tt]');
  out = blockquoteMarkdownToBgg(out);
  out = out.replace(/^(#{1,6})\s+(.+)$/gm, (_m, hashes, text) => '[size='+headingToSize(hashes)+']'+text.trim()+'[/size]');
  out = out.replace(/\*\*([\s\S]*?)\*\*/g, '[b]$1[/b]');
  out = out.replace(/(?<!\*)\*([^\s*][\s\S]*?)\*(?!\*)/g, '[i]$1[/i]');
  out = out.replace(/(?<!_)_([^\s_][\s\S]*?)_(?!_)/g, '[i]$1[/i]');
  out = out.replace(/~~([\s\S]*?)~~/g, '[s]$1[/s]');
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (_m, text, href) => {
    const thing = /boardgamegeek\.com\/(?:thing|boardgame)\/(\d+)/i.exec(href);
    if (thing) return '[thing='+thing[1]+']'+text+'[/thing]';
    const user = /boardgamegeek\.com\/user\/([A-Za-z0-9_-]+)/i.exec(href);
    if (user) return '[user=0]'+user[1]+'[/user]';
    return '[url='+href+']'+text+'[/url]';
  });
  out = out.replace(/!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g, (_m, _alt, src) => '[img]'+src+'[/img]');
  out = out.replace(/(?:^|\n)([ \t]*)([-*+])\s+(.+)(?:\n\1\2\s+.+)*/g, (block) => {
    const lines = block.trim().split(/\r?\n/); const items = lines.map(l=>l.replace(/^[ \t]*[-*+]\s+/, '').trim());
    return '\n[list]\n' + items.map(it=>'[*] '+it).join('\n') + '\n[/list]';
  });
  out = out.replace(/(?:^|\n)([ \t]*)\d+\.\s+(.+)(?:\n\1\d+\.\s+.+)*/g, (block) => {
    const lines = block.trim().split(/\r?\n/); const items = lines.map(l=>l.replace(/^[ \t]*\d+\.\s+/, '').trim());
    return '\n[olist]\n' + items.map(it=>'[*] '+it).join('\n') + '\n[/olist]';
  });
  out = out.replace(/  \n/g, '[br]\n');
  out = out.replace(/<u>([\s\S]*?)<\/u>/gi, '[u]$1[/u]');

  out = pr.restore(out);
  return out;
}

export function convert(input, direction) {
  return direction === 'bgg2md' ? bggToMarkdown(input) : markdownToBgg(input);
}

export default { bggToMarkdown, markdownToBgg, convert };
