/* 엑셀 파일 읽기·저장 (JSZip 사용, 인터넷 불필요).
 * 읽기: 근무표·시간외·통계 시트의 모양(병합, 글꼴, 채우기, 테두리, 열 너비, 행 높이)과 패턴·공휴일 값.
 * 저장: 원본 파일에서 바뀐 칸만 XML에서 고친다(서식·확장 조건부서식·매크로 유지) — 파이썬 xlsxpatch.py와 같은 방식. */
(function (root) {
  'use strict';
  const JSZipLib = (typeof JSZip !== 'undefined') ? JSZip : (typeof require !== 'undefined' ? require('jszip') : null);
  const Calc = root.Calc || (typeof require !== 'undefined' ? require('./calc.js') : null);

  const SHEET = '근무표', OT_SHEETS = ['시간외근무1', '시간외근무2'], STAT_SHEET = '시간외근무_통계';
  const LABOR_DAY = '근로자의 날';   // 매년 5월 1일 (원본 공휴일 표에 없으면 앱이 더함)
  const MAX_COL = 21, OT_ROWS = 28, OT_COLS = 35, STAT_ROWS = 24, STAT_COLS = 14;

  // ---------------------------------------------------------------- XML 도우미
  const unesc = s => s.replace(/&(lt|gt|quot|apos|amp|#x([0-9a-fA-F]+)|#(\d+));/g, (m, n, hx, dc) =>
    hx ? String.fromCodePoint(parseInt(hx, 16)) : dc ? String.fromCodePoint(parseInt(dc, 10)) :
      ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' })[n]);
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const attr = (tag, name) => { const m = new RegExp('\\s' + name + '="([^"]*)"').exec(tag); return m ? unesc(m[1]) : null; };
  const colIndex = s => { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n; };
  const splitRef = a => { const m = /^([A-Z]+)(\d+)$/.exec(a); return [colIndex(m[1]), parseInt(m[2], 10)]; };
  const CELL_RE = /<c\b[^>]*?\br="([A-Z]+\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g;

  /** <t> 글자 모으기 (서식 있는 글자 포함, 발음 표기 rPh 제외) */
  function textOf(xml) {
    xml = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
    let s = '';
    xml.replace(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g, (m, t) => { s += t ? unesc(t) : ''; return m; });
    return s;
  }

  async function openBook(buf) {
    const zip = await JSZipLib.loadAsync(buf);
    const read = async p => { const f = zip.file(p); return f ? f.async('string') : null; };
    const wb = await read('xl/workbook.xml'), rels = await read('xl/_rels/workbook.xml.rels');
    const targets = {};
    (rels.match(/<Relationship\b[^>]*>/g) || []).forEach(r => {
      const t = attr(r, 'Target');
      targets[attr(r, 'Id')] = t.startsWith('/') ? t.slice(1) : 'xl/' + t;
    });
    const parts = {};
    (wb.match(/<sheet\b[^>]*>/g) || []).forEach(s => { parts[attr(s, 'name')] = targets[attr(s, 'r:id')]; });
    const ssXml = await read('xl/sharedStrings.xml');
    const shared = ssXml ? (ssXml.match(/<si\b[\s\S]*?<\/si>|<si\/>/g) || []).map(textOf) : [];
    const styles = parseStyles(await read('xl/styles.xml'));
    const date1904 = /date1904="(1|true)"/.test(wb);
    return { zip, parts, shared, styles, date1904, read };
  }

  // ---------------------------------------------------------------- 서식
  const BUILTIN_FMT = { 0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 14: 'mm-dd-yy', 49: '@' };
  const color = tag => { const m = tag && /<(?:fgColor|color)\b[^>]*\brgb="([0-9A-Fa-f]{8})"/.exec(tag); return m && m[1] !== '00000000' ? '#' + m[1].slice(2) : null; };

  function parseStyles(xml) {
    const sec = name => { const m = new RegExp('<' + name + '\\b[^>]*>([\\s\\S]*?)</' + name + '>').exec(xml); return m ? m[1] : ''; };
    const items = (body, tag) => body.match(new RegExp('<' + tag + '\\b[^>]*/>|<' + tag + '\\b[^>]*>[\\s\\S]*?</' + tag + '>', 'g')) || [];
    const numFmts = {};
    items(sec('numFmts'), 'numFmt').forEach(t => { numFmts[attr(t, 'numFmtId')] = attr(t, 'formatCode'); });
    const fonts = items(sec('fonts'), 'font').map(f => {
      const sz = /<sz\b[^>]*\bval="([^"]+)"/.exec(f);
      const b = /<b\b([^>]*)\/?>/.exec(f);
      return { sz: sz ? parseFloat(sz[1]) : null, b: !!b && !/val="(0|false)"/.test(b[1]), color: color((/<color\b[^>]*\/?>/.exec(f) || [null])[0]) };
    });
    const fills = items(sec('fills'), 'fill').map(f => {
      const pt = /<patternFill\b[^>]*patternType="([^"]+)"/.exec(f);
      return pt && pt[1] === 'solid' ? color((/<fgColor\b[^>]*\/?>/.exec(f) || [null])[0]) : null;
    });
    const borders = items(sec('borders'), 'border').map(b => /<(left|right|top|bottom)\b[^>]*\bstyle="/.test(b));
    const xfs = items(sec('cellXfs'), 'xf').map(x => {
      const head = /<xf\b[^>]*>/.exec(x)[0], al = /<alignment\b[^>]*\/?>/.exec(x);
      const id = attr(head, 'numFmtId') || '0';
      return {
        nf: numFmts[id] || BUILTIN_FMT[id] || 'General',
        font: fonts[parseInt(attr(head, 'fontId') || '0', 10)] || {},
        fill: fills[parseInt(attr(head, 'fillId') || '0', 10)] || null,
        border: borders[parseInt(attr(head, 'borderId') || '0', 10)] || false,
        h: al ? attr(al[0], 'horizontal') : null, v: al ? attr(al[0], 'vertical') : null,
        wrap: al ? /wrapText="(1|true)"/.test(al[0]) : false,
      };
    });
    return { xfs };
  }

  // ---------------------------------------------------------------- 시트 읽기
  /** 시트 XML → { cells: {주소: {v, f, s}}, merges, cols, rows, fmt, landscape } */
  function parseSheet(xml, book) {
    const cells = {};
    xml.replace(CELL_RE, (c, a) => {
      const head = /<c\b[^>]*>|<c\b[^>]*\/>/.exec(c)[0];
      const t = attr(head, 't'), s = parseInt(attr(head, 's') || '0', 10);
      const f = /<f\b[^>]*>([\s\S]*?)<\/f>|<f\b[^>]*\/>/.exec(c);
      const vm = /<v>([\s\S]*?)<\/v>/.exec(c);
      let v = null;
      if (t === 'inlineStr') v = textOf((/<is>([\s\S]*?)<\/is>/.exec(c) || ['', ''])[1]);
      else if (vm) {
        const raw = unesc(vm[1]);
        if (t === 's') v = book.shared[parseInt(raw, 10)];
        else if (t === 'str' || t === 'e') v = raw;
        else if (t === 'b') v = raw === '1';
        else v = Number(raw);
      }
      cells[a] = { v, f: !!f, s };
      return c;
    });
    const merges = (xml.match(/<mergeCell\b[^>]*>/g) || []).map(m => {
      const [a, b] = attr(m, 'ref').split(':'); const [c1, r1] = splitRef(a), [c2, r2] = splitRef(b || a);
      return { r1, c1, r2, c2 };
    });
    const cols = (xml.match(/<col\b[^>]*>/g) || []).map(c => ({ min: +attr(c, 'min'), max: +attr(c, 'max'), width: attr(c, 'width') ? +attr(c, 'width') : null }));
    const rows = {};
    (xml.match(/<row\b[^>]*>/g) || []).forEach(r => { const ht = attr(r, 'ht'); if (ht) rows[+attr(r, 'r')] = +ht; });
    const fmt = /<sheetFormatPr\b[^>]*>/.exec(xml);
    const ps = /<pageSetup\b[^>]*>/.exec(xml);
    return {
      cells, merges, cols, rows,
      defaultColWidth: fmt && attr(fmt[0], 'defaultColWidth') ? +attr(fmt[0], 'defaultColWidth') : null,
      baseColWidth: fmt && attr(fmt[0], 'baseColWidth') ? +attr(fmt[0], 'baseColWidth') : 8,
      defaultRowHeight: fmt && attr(fmt[0], 'defaultRowHeight') ? +attr(fmt[0], 'defaultRowHeight') : 15,
      landscape: !!ps && attr(ps[0], 'orientation') === 'landscape',
    };
  }

  const cellVal = (sh, a) => (sh.cells[a] && !sh.cells[a].f ? sh.cells[a].v : (sh.cells[a] ? sh.cells[a].v : null));
  const isFormula = (sh, a) => !!(sh.cells[a] && sh.cells[a].f);

  /** 파이썬 read_grid와 같은 격자 */
  function readGrid(sh, book, maxRow, maxCol) {
    const merged = {}, covered = new Set();
    for (const m of sh.merges) {
      if (m.r1 > maxRow || m.c1 > maxCol) continue;
      merged[`${m.r1},${m.c1}`] = [Math.min(m.r2, maxRow) - m.r1 + 1, Math.min(m.c2, maxCol) - m.c1 + 1];
      for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) if (r !== m.r1 || c !== m.c1) covered.add(`${r},${c}`);
    }
    const cells = [];
    for (let r = 1; r <= maxRow; r++) {
      const row = [];
      for (let c = 1; c <= maxCol; c++) {
        if (covered.has(`${r},${c}`)) { row.push(null); continue; }
        const a = Calc.colLetter(c) + r, cell = sh.cells[a];
        const st = book.styles.xfs[cell ? cell.s : 0] || book.styles.xfs[0];
        let v = cell ? cell.v : null;
        if (cell && cell.f) v = '';
        else if (v === null || v === undefined) v = '';
        else if (typeof v === 'number') v = Number.isInteger(v) ? String(v) : String(v);
        else if (typeof v === 'boolean') v = v ? 'True' : 'False';
        else v = String(v);
        const [rs, cs] = merged[`${r},${c}`] || [1, 1];
        row.push({
          v, rs, cs, sz: st.font.sz || 11, b: !!st.font.b, fill: st.fill, border: st.border,
          al: st.h || (r >= 3 ? 'center' : 'left'), fc: st.font.color || null, nf: st.nf, wrap: st.wrap,
          va: st.v === 'top' ? 'top' : st.v === 'center' ? 'middle' : 'bottom',
        });
      }
      cells.push(row);
    }
    const widths = new Array(maxCol).fill(sh.defaultColWidth || sh.baseColWidth + 0.43);
    for (const d of sh.cols) if (d.width && d.min) for (let c = d.min; c <= Math.min(d.max || d.min, maxCol); c++) widths[c - 1] = d.width;
    const heights = []; for (let r = 1; r <= maxRow; r++) heights.push(sh.rows[r] || sh.defaultRowHeight);
    return { cells, widths, heights, landscape: sh.landscape };
  }

  const norm = v => String(v === null || v === undefined ? '' : v).replace(/\s+/g, '');

  function findLayout(sh) {
    const val = a => cellVal(sh, a);
    let hdr = 0;
    for (let r = 1; r < 20; r++) if (norm(val('A' + r)) === '일자') { hdr = r; break; }
    if (!hdr) throw new Error("'일자' 머리글을 찾지 못했습니다");
    const span = sh.merges.find(m => m.r1 === hdr && m.c1 === 1);
    const first = (span ? span.r2 : hdr) + 1, last = first + 30;
    const sRows = {};
    for (let r = 1; r <= last + 1; r++) { const v = val('S' + r); if (v !== null && v !== '' && !(norm(v) in sRows)) sRows[norm(v)] = r; }
    // 파이썬 dict는 같은 글자면 뒤의 행이 남는다
    for (let r = 1; r <= last + 1; r++) { const v = val('S' + r); if (v !== null && v !== '') sRows[norm(v)] = r; }
    const grp = sRows['근무조'], hol = sRows['공휴일'];
    if (!grp || !hol) throw new Error("'근무 조' 또는 '공휴일' 칸을 찾지 못했습니다");
    const covered = new Set();
    for (const m of sh.merges) for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) if (r !== m.r1 || c !== m.c1) covered.add(`${r},${c}`);
    const group_cells = [];
    for (let r = grp + 1; r < hol; r++) for (const c of [19, 20, 21]) {
      const a = Calc.colLetter(c) + r, v = val(a);
      if (!covered.has(`${r},${c}`) && !isFormula(sh, a) && (v !== null || c < 21)) group_cells.push(a);
    }
    const print_label_rows = [];
    for (let r = hol + 1; r <= last + 1; r++) if (String(val('S' + r) || '').includes('출력')) print_label_rows.push(r);
    const range = (a, n) => Array.from({ length: n }, (_, i) => a + i);
    return { first, last, max_row: last + 1, group_label: grp, group_cells, name_rows: range(grp + 1, 16),
      holiday_rows: range(hol + 1, 7), print_label_rows };
  }

  /** 엑셀 날짜 일련번호 → 1970-01-01부터의 일수 */
  const serialToDn = (s, d1904) => Math.floor(s) + (d1904 ? 1462 : 0) - 25569;
  const str = v => (v === null || v === undefined ? '' : (typeof v === 'number' && Number.isInteger(v) ? String(v) : String(v)));

  /** 원본 엑셀 → 앱이 쓰는 정보 (파이썬 read_template_info와 같은 모양) */
  async function readTemplate(buf) {
    const book = await openBook(buf);
    const sheet = async name => {
      if (!book.parts[name]) throw new Error(`'${name}' 시트가 없습니다`);
      return parseSheet(await book.read(book.parts[name]), book);
    };
    const ws = await sheet(SHEET), L = findLayout(ws);
    const pws = await sheet('패턴');
    const baseV = cellVal(pws, 'C1');
    if (typeof baseV !== 'number') throw new Error('패턴!C1 기준일이 날짜가 아닙니다');
    const base = serialToDn(baseV, book.date1904);
    const pattern = [];
    for (let r = 3; r <= 22; r++) {
      const row = [];
      for (let c = 3; c <= 17; c += 2) {
        let n = cellVal(pws, Calc.colLetter(c) + r);
        n = n === null || n === '' ? null : Math.trunc(Number(n));
        row.push(n ? String(n) : '', n ? String.fromCharCode(64 + n) : '');
      }
      pattern.push(row);
    }
    const hws = await sheet('공휴일'), holidays = {};
    const maxR = Math.max(0, ...Object.keys(hws.cells).map(a => splitRef(a)[1]));
    const freeRows = [];   // 날짜가 비어 있는 줄 (저장할 때 근로자의 날을 써 넣을 자리)
    for (let r = 2; r <= maxR; r++) {
      const d = cellVal(hws, 'A' + r), name = cellVal(hws, 'B' + r);
      if (typeof d === 'number' && hws.cells['A' + r] && isDateStyle(book, hws.cells['A' + r].s)) {
        holidays[Calc.iso(serialToDn(d, book.date1904))] = str(name);
      } else if (d === null || d === '') freeRows.push(r);
    }
    // 매년 5월 1일 근로자의 날은 공휴일 (원본 공휴일 표에 없는 해만 더함, 요일·토일 겹침과 상관없음)
    const labor_rows = [];
    for (let yy = 2020; yy <= 2050; yy++) {
      const k = `${yy}-05-01`;
      if (k in holidays) continue;
      holidays[k] = LABOR_DAY;
      if (freeRows.length) labor_rows.push([freeRows.shift(), Calc.dn(yy, 5, 1) + 25569 - (book.date1904 ? 1462 : 0)]);
    }
    const grid = readGrid(ws, book, L.max_row, MAX_COL);
    const tplY = cellVal(ws, 'E1'), tplM = cellVal(ws, 'H1');
    const literals = {};
    for (let i = 0; i < 31; i++) for (let c = 3; c <= 18; c++) {
      const a = Calc.colLetter(c) + (L.first + i);
      if (!isFormula(ws, a) && cellVal(ws, a) !== null) literals[Calc.dutyKey(c, i + 1)] = str(cellVal(ws, a));
    }
    const group_orig = {};
    for (const a of L.group_cells) group_orig[a] = str(cellVal(ws, a));
    const grids = {};
    for (const n of OT_SHEETS) grids[n] = readGrid(await sheet(n), book, OT_ROWS, OT_COLS);
    return {
      layout: L, base, pattern, holidays, labor_rows, cells: grid.cells, widths: grid.widths, heights: grid.heights, landscape: grid.landscape,
      ot: { grids, stat_grid: readGrid(await sheet(STAT_SHEET), book, STAT_ROWS, STAT_COLS) },
      group_orig, tpl_ym: [Math.trunc(Number(tplY) || 0), Math.trunc(Number(tplM) || 0)], literals,
    };
  }

  function isDateStyle(book, s) {
    const nf = (book.styles.xfs[s] || {}).nf || '';
    if (nf === 'General' || nf === '@') return false;
    return /[ymdhs]/i.test(nf.replace(/"[^"]*"|\[[^\]]*\]/g, ''));
  }

  // ---------------------------------------------------------------- 수식 옮기기 (공유 수식 풀기용)
  /** 수식 안의 상대 참조를 (dr, dc)만큼 옮긴다 — openpyxl Translator와 같은 결과 */
  function translateFormula(f, dr, dc) {
    const shiftCol = (dollar, col) => dollar ? col : Calc.colLetter(colIndex(col) + dc);
    const shiftRow = (dollar, row) => dollar ? row : String(parseInt(row, 10) + dr);
    const ID = 'A-Za-z0-9_.\\u00C0-\\uFFFF';
    const re = new RegExp(`(^|[^${ID}$])(?:(\\$?)([A-Z]{1,3})(\\$?)(\\d+)(?::(\\$?)([A-Z]{1,3})(\\$?)(\\d+))?|(\\$?)([A-Z]{1,3}):(\\$?)([A-Z]{1,3})|(\\$?)(\\d+):(\\$?)(\\d+))(?![${ID}(])`, 'g');
    const sub = seg => seg.replace(re, (m, pre, d1, c1, d2, r1, d3, c2, d4, r2, e1, k1, e2, k2, g1, w1, g2, w2) => {
      if (c1) {
        let out = pre + d1 + shiftCol(d1, c1) + d2 + shiftRow(d2, r1);
        if (c2) out += ':' + d3 + shiftCol(d3, c2) + d4 + shiftRow(d4, r2);
        return out;
      }
      if (k1) return pre + e1 + shiftCol(e1, k1) + ':' + e2 + shiftCol(e2, k2);
      return pre + g1 + shiftRow(g1, w1) + ':' + g2 + shiftRow(g2, w2);
    });
    // 따옴표 글자("…")와 시트 이름('…')은 건드리지 않는다
    let out = '', i = 0;
    while (i < f.length) {
      const ch = f[i];
      if (ch === '"' || ch === "'") {
        let j = i + 1;
        while (j < f.length) { if (f[j] === ch) { if (f[j + 1] === ch) { j += 2; continue; } break; } j++; }
        out += f.slice(i, j + 1); i = j + 1;
      } else {
        let j = i; while (j < f.length && f[j] !== '"' && f[j] !== "'") j++;
        out += sub(f.slice(i, j)); i = j;
      }
    }
    return out;
  }

  function expandShared(xml) {
    const masters = {};
    // 칸 하나 안에서, 닫힌 <f/>가 아닌 <f …>수식</f>만 (앞 칸의 <f/>가 뒤 칸 수식을 삼키지 않게)
    const mre = /<c\b[^>]*?\br="([A-Z]+\d+)"[^>/]*>(?:(?!<\/c>)[\s\S])*?<f(\s[^>]*?[^/])?>((?:(?!<\/c>)[\s\S])*?)<\/f>/g;
    let m;
    while ((m = mre.exec(xml))) {
      const fa = m[2] || '';
      if (fa.includes('t="shared"') && fa.includes('ref=')) masters[/\bsi="(\d+)"/.exec(fa)[1]] = [m[1], unesc(m[3])];
    }
    return xml.replace(CELL_RE, (cell, a) => {
      const fm = /<f\b([^>]*?)(\/>|>([\s\S]*?)<\/f>)/.exec(cell);
      if (!fm || !fm[1].includes('t="shared"')) return cell;
      const si = /\bsi="(\d+)"/.exec(fm[1])[1];
      if (!(si in masters)) return cell;
      const [origin, text] = masters[si];
      const [oc, or] = splitRef(origin), [cc, cr] = splitRef(a);
      const f = translateFormula(text, cr - or, cc - oc);
      return cell.slice(0, fm.index) + '<f>' + esc(f) + '</f>' + cell.slice(fm.index + fm[0].length);
    });
  }

  function cellXml(a, style, value) {
    const s = style ? ` s="${style}"` : '';
    if (typeof value === 'number') return `<c r="${a}"${s}><v>${value}</v></c>`;
    value = value === null || value === undefined ? '' : String(value);
    if (value.startsWith('=')) return `<c r="${a}"${s} t="str"><f>${esc(value.slice(1))}</f></c>`;
    if (value === '') return `<c r="${a}"${s}/>`;
    return `<c r="${a}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
  }

  function setCells(xml, values) {
    for (const a of Object.keys(values)) {
      const value = values[a];
      const re = new RegExp(`<c\\b[^>]*?\\br="${a}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`);
      const m = re.exec(xml);
      if (m) {
        const head = m[0].slice(0, m[0].indexOf('>') + 1), st = /\bs="(\d+)"/.exec(head);
        xml = xml.slice(0, m.index) + cellXml(a, st ? st[1] : null, value) + xml.slice(m.index + m[0].length);
        continue;
      }
      const [col, row] = splitRef(a), neu = cellXml(a, null, value);
      const rm = new RegExp(`<row\\b[^>]*?\\br="${row}"[^>]*?(/>|>([\\s\\S]*?)</row>)`).exec(xml);
      if (rm) {
        if (rm[1] === '/>') {
          xml = xml.slice(0, rm.index) + rm[0].slice(0, -2) + '>' + neu + '</row>' + xml.slice(rm.index + rm[0].length);
        } else {
          const bodyStart = rm.index + rm[0].length - rm[2].length - '</row>'.length;
          let pos = bodyStart + rm[2].length;
          const cre = new RegExp(CELL_RE.source, 'g'); cre.lastIndex = bodyStart;
          let cm;
          while ((cm = cre.exec(xml)) && cm.index < bodyStart + rm[2].length) {
            if (splitRef(cm[1])[0] > col) { pos = cm.index; break; }
          }
          xml = xml.slice(0, pos) + neu + xml.slice(pos);
        }
      } else {
        let pos = null;
        const rre = /<row\b[^>]*?\br="(\d+)"/g; let r2;
        while ((r2 = rre.exec(xml))) if (+r2[1] > row) { pos = r2.index; break; }
        if (pos === null) pos = xml.indexOf('</sheetData>');
        xml = xml.slice(0, pos) + `<row r="${row}">${neu}</row>` + xml.slice(pos);
      }
    }
    return xml;
  }

  const STAR4 = /(RIGHT\(계산!\$[A-Z]+\$\d+,1\)="\*"),4,/g;
  // 주6일 판정 뒤에 '여섯째 근무일(일요일 휴무면 토요일)이 공휴일이 아님' 조건을 붙인다 (연장 수식·민트 조건부서식)
  const SIX = /(INDEX\(주간근무,MOD\((DATE\(근무표!\$E\$1,근무표!\$H\$1,[A-Z]+\$3\))-기준일,20\)\+1,(\d)\)=6)(?!,COUNTIF\(공휴일목록)/g;
  const patchFormulaXml = xml => xml.replace(STAR4, '$1,3.5,').split('"말중"),3.5,4)').join('"말중"),3.5,3.5)')
    .replace(SIX, (all, head, date, g) => `${head},COUNTIF(공휴일목록,${date}-(INDEX(근무구분,MOD(${date}-기준일,20)+1,${g})="휴무"))=0`);
  // 계산 시트: 사유 글자를 건·병·공·연 넷만 보던 수식 → 맨 앞 한 글자가 숫자·영문·'/'가 아니면 사유 (파이썬 patch_calc_xml)
  const OLD_PREFIX = /OR\(LEFT\(TRIM\(([^()&]+)&amp;""\),1\)="[건병공연]",LEFT\(TRIM\(\1&amp;""\),1\)="[건병공연]",LEFT\(TRIM\(\1&amp;""\),1\)="[건병공연]",LEFT\(TRIM\(\1&amp;""\),1\)="[건병공연]"\)/g;
  const patchCalcXml = xml => xml.replace(OLD_PREFIX, (all, ref) =>
    `AND(LEN(TRIM(${ref}&amp;""))>1,ISERROR(FIND(UPPER(LEFT(TRIM(${ref}&amp;""),1)),"${Calc.NOT_PREFIX}")))`);

  /** 원본 파일 + {시트: {주소: 값}} → 새 파일(Blob 또는 Uint8Array) */
  async function savePatched(buf, cellValues, formulaFixes, outType) {
    const book = await openBook(buf), zip = book.zip;
    const edit = {}, fix = {};
    for (const n in cellValues) edit[book.parts[n]] = cellValues[n];
    for (const n in (formulaFixes || {})) fix[book.parts[n]] = formulaFixes[n];
    for (const p of new Set(Object.keys(edit).concat(Object.keys(fix)))) {
      let xml = await book.read(p);
      if (edit[p]) xml = setCells(expandShared(xml), edit[p]);
      if (fix[p]) xml = fix[p](xml);
      zip.file(p, xml);
    }
    let wb = await book.read('xl/workbook.xml');
    wb = /<calcPr\b/.test(wb)
      ? wb.replace(/<calcPr\b([^>]*?)\/?>/, (m, a) => '<calcPr' + a.replace(/\s*fullCalcOnLoad="[^"]*"/, '') + ' fullCalcOnLoad="1"/>')
      : wb.replace('</workbook>', '<calcPr fullCalcOnLoad="1"/></workbook>');
    zip.file('xl/workbook.xml', wb);
    if (zip.file('xl/calcChain.xml')) {
      zip.remove('xl/calcChain.xml');
      zip.file('xl/_rels/workbook.xml.rels', (await book.read('xl/_rels/workbook.xml.rels')).replace(/<Relationship\b[^>]*calcChain[^>]*\/>/g, ''));
      zip.file('[Content_Types].xml', (await book.read('[Content_Types].xml')).replace(/<Override\b[^>]*calcChain[^>]*\/>/g, ''));
    }
    return zip.generateAsync({ type: outType || 'blob', compression: 'DEFLATE' });
  }

  const dutyFormula = (r, k) => `=IF($A${r}="","",INDEX(근무패턴,MOD(DATE($E$1,$H$1,$A${r})-기준일,20)+1,${k})&"")`;

  /** 앱의 저장: 연·월, 바뀐 근무 칸, 근무조 수정을 원본에 써 넣는다 (파이썬 make_workbook) */
  function buildCellValues(info, y, m, edits, groupEdits) {
    const L = info.layout, values = { E1: y, H1: m };
    for (let i = 0; i < 31; i++) {
      const r = L.first + i;
      Calc.DUTY_COLS.forEach((c, k) => {
        const key = Calc.dutyKey(c, i + 1), a = Calc.colLetter(c) + r;
        if (key in edits) values[a] = edits[key];
        else if (key in info.literals) values[a] = dutyFormula(r, k + 1);
      });
    }
    for (const a in groupEdits) if (a in info.group_orig) values[a] = groupEdits[a];
    return values;
  }

  async function saveWorkbook(buf, info, y, m, edits, groupEdits, outType, otEdits) {
    const fixes = { '계산': patchCalcXml }; OT_SHEETS.forEach(n => { fixes[n] = patchFormulaXml; });
    const cells = { [SHEET]: buildCellValues(info, y, m, edits, groupEdits) };
    if ((info.labor_rows || []).length) {   // 원본 공휴일 표에 없던 근로자의 날을 빈 줄에 써 넣어 엑셀 수식(공휴일목록)도 같게
      cells['공휴일'] = {};
      for (const [r, serial] of info.labor_rows) { cells['공휴일']['A' + r] = serial; cells['공휴일']['B' + r] = LABOR_DAY; }
    }
    const C = Calc;
    for (const [key, v] of Object.entries(otEdits || {})) {   // 시간외 칸 직접 수정은 수식 대신 값으로
      const [i, , day] = key.split(':').map(Number);
      if (i >= 16 || day > C.daysIn(y, m)) continue;
      const [sname, addr] = C.otCell(...key.split(':').map(Number));
      (cells[sname] = cells[sname] || {})[addr] = C.otValue(v);
    }
    return savePatched(buf, cells, fixes, outType);
  }

  const api = { readTemplate, saveWorkbook, savePatched, translateFormula, expandShared, openBook };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Xlsx = api;
})(this);
