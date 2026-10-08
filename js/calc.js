/* 근무표 계산 (파이썬 app.py·overtime.py와 같은 결과를 내도록 옮긴 것).
 * 20일 주기 패턴, 공휴일·6일근무 색, 시간외근무1·2·통계 계산과 화면용 격자 만들기.
 * 날짜는 1970-01-01부터의 일수(dn)로 다룬다(시간대 영향 없음). */
(function (root) {
  'use strict';
  const PINK = '#F99F9F', YELLOW = '#F8F056', GREEN = '#99FFCC';
  const WEEKDAYS = '월화수목금토일';
  const PREFIXES = '건병공연';
  const SHIFTS = ['말번', '말번', '중번', '중번', '초번', '초번', '휴무', '휴무'];
  const DUTY_COLS = []; for (let c = 3; c <= 18; c++) DUTY_COLS.push(c);
  const MAX_COL = 21;
  const OT_SHEETS = ['시간외근무1', '시간외근무2'];
  const STAT_SHEET = '시간외근무_통계';
  const DAY_COL0 = 5;

  // ---------------------------------------------------------------- 공통 도우미
  const dn = (y, m, d) => Date.UTC(y, m - 1, d) / 86400000;
  const ymd = n => { const t = new Date(n * 86400000); return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()]; };
  const iso = n => { const [y, m, d] = ymd(n); return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; };
  const weekday = n => (new Date(n * 86400000).getUTCDay() + 6) % 7;   // 월=0 … 일=6 (파이썬 weekday)
  const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mod = (a, b) => ((a % b) + b) % b;
  const colLetter = c => { let s = ''; while (c > 0) { const r = (c - 1) % 26; s = String.fromCharCode(65 + r) + s; c = (c - 1 - r) / 26; } return s; };
  const plen = s => Array.from(s).length;
  const isNum = v => typeof v === 'number';

  /** 파이썬 round(): 0.5는 짝수 쪽으로 */
  function pyRound(x) {
    const f = Math.floor(x), diff = x - f;
    if (diff > 0.5) return f + 1;
    if (diff < 0.5) return f;
    return f % 2 === 0 ? f : f + 1;
  }

  /** 파이썬 str.strip() (모든 공백) / 엑셀 TRIM (스페이스만) */
  const pyStrip = s => s.replace(/^\s+|\s+$/g, '');
  const xtrim = s => s.replace(/ +/g, ' ').replace(/^ +| +$/g, '');

  // ---------------------------------------------------------------- 근무표
  const dutyKey = (col, day) => `${colLetter(col)}:${day}`;
  const cycleRow = (info, n) => mod(n - info.base, 20);

  function groupOf(text, letterCol) {
    let t = pyStrip(text || '');
    if (t && PREFIXES.includes(t[0])) t = t.slice(1);
    if (t.includes('/')) t = pyStrip(t.split('/')[0]);
    if (!t) return null;
    let n;
    if (letterCol) n = t.codePointAt(0) - 64;
    else {
      if (!/^\s*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?\s*$/.test(t)) return null;
      n = Math.trunc(parseFloat(t));
    }
    return n >= 1 && n <= 8 ? n : null;
  }

  function weekWorkDays(info, n, g) {
    let cnt = 0;
    for (let k = 0; k < 7; k++) {
      const row = info.pattern[cycleRow(info, n - k)];
      if ([row[0], row[2], row[4], row[6], row[8], row[10]].includes(String(g))) cnt++;
    }
    return cnt;
  }

  function dutyFill(info, n, col, value) {
    if (weekday(n) === 6) {
      const g = groupOf(value, col % 2 === 0);
      if (g && weekWorkDays(info, n, g) === 6) return GREEN;
    }
    if (col >= 3 && col <= 14 && iso(n) in info.holidays) return YELLOW;
    return null;
  }

  /** 그 달 근무 편집 (저장된 것이 없으면 원본 달이면 원본에 남은 값) */
  function effectiveEdits(info, y, m, stored) {
    if (stored) return stored;
    if (info.tpl_ym[0] === y && info.tpl_ym[1] === m) return Object.assign({}, info.literals);
    return {};
  }

  function buildSheet(y, m, info, edits) {
    const nd = daysIn(y, m), days = [];
    for (let i = 0; i < 31; i++) {
      if (i >= nd) { days.push(null); continue; }
      const n = dn(y, m, i + 1);
      const pat = info.pattern[cycleRow(info, n)];
      const hol = iso(n) in info.holidays;
      const headFill = hol ? YELLOW : (weekday(n) >= 5 ? PINK : null);
      const duties = DUTY_COLS.map((c, j) => {
        const key = dutyKey(c, i + 1);
        const v = key in edits ? edits[key] : pat[j];
        return { addr: key, v, orig: pat[j], edited: key in edits && edits[key] !== pat[j], fill: dutyFill(info, n, c, v) };
      });
      days.push({ day: i + 1, wd: WEEKDAYS[weekday(n)], fill: headFill, duties });
    }
    const pre = `${y}-${String(m).padStart(2, '0')}-`;
    const holList = Object.keys(info.holidays).sort().filter(k => k.startsWith(pre))
      .map(k => `${parseInt(k.slice(8), 10)}일 ${info.holidays[k]}`);
    return { year: y, month: m, days, holidays: holList };
  }

  function groupValues(info, groupEdits) {
    const vals = Object.assign({}, info.group_orig);
    for (const k in groupEdits) if (k in vals) vals[k] = groupEdits[k];
    return vals;
  }

  const personNames = (info, groupEdits) => {
    const vals = groupValues(info, groupEdits);
    return info.layout.name_rows.map(r => (`T${r}` in vals ? vals[`T${r}`] : ''));
  };

  function buildGrid(info, sheet, groupEdits) {
    const L = info.layout, gvals = groupValues(info, groupEdits), rows = [];
    for (let r = 1; r <= L.max_row; r++) {
      const row = [];
      for (let c = 1; c <= MAX_COL; c++) {
        const base = info.cells[r - 1][c - 1];
        if (base === null) continue;
        const cell = Object.assign({}, base, { addr: null, gaddr: null, edited: false, orig: '' });
        const a = `${colLetter(c)}${r}`;
        if (r === 1 && c === 5) cell.v = String(sheet.year);
        else if (r === 1 && c === 8) cell.v = String(sheet.month);
        else if (c === 19 && L.print_label_rows.includes(r)) cell.v = '';
        else if (r >= L.first && r <= L.last && c <= 18) {
          const day = sheet.days[r - L.first];
          if (day === null) cell.v = '';
          else if (c === 1) { cell.v = String(day.day); cell.fill = day.fill || cell.fill; }
          else if (c === 2) { cell.v = day.wd; cell.fill = day.fill || cell.fill; }
          else {
            const duty = day.duties[c - 3];
            Object.assign(cell, { v: duty.v, fill: duty.fill || cell.fill, addr: duty.addr, edited: duty.edited, orig: duty.orig });
          }
        } else if (a in gvals) {
          Object.assign(cell, { v: gvals[a], gaddr: a, orig: info.group_orig[a],
            edited: a in groupEdits && groupEdits[a] !== info.group_orig[a] });
        } else if (c === 19 && L.holiday_rows.includes(r)) {
          const i = L.holiday_rows.indexOf(r);
          cell.v = i < sheet.holidays.length ? sheet.holidays[i] : '';
        }
        if (c >= 19 && L.name_rows.includes(r)) cell.g = Math.floor((r - L.name_rows[0]) / 2) + 1;   // '내 근무'용 조 번호
        row.push(cell);
      }
      rows.push({ h: pyRound(info.heights[r - 1] * 4 / 3), cells: row });
    }
    return rows;
  }

  // ---------------------------------------------------------------- 시간외 (엑셀 '계산' 시트 수식 옮김)
  function parseCell(raw) {
    const t = xtrim(raw || '');
    let body, pre;
    if (t && PREFIXES.includes(t[0])) { body = t.slice(1); pre = t[0]; } else { body = t; pre = '연'; }
    const i = body.indexOf('/');
    if (i >= 0) return [xtrim(body.slice(0, i)), xtrim(body.slice(i + 1)), pre];
    return [body, '', pre];
  }

  function personKey(i) {
    const g = Math.floor(i / 2) + 1;
    return i % 2 === 0 ? [String(g), g, false] : [String.fromCharCode(64 + g), g, true];
  }

  function groupShift(info, n, g) {
    const row = info.pattern[cycleRow(info, n)], s = String(g);
    if (s === row[0] || s === row[2]) return '말번';
    if (s === row[4] || s === row[6]) return '중번';
    if (s === row[8] || s === row[10]) return '초번';
    return '휴무';
  }

  function weekCount(info, n, g) {
    let c = 0;
    for (let k = 0; k < 7; k++) if (groupShift(info, n - k, g) !== '휴무') c++;
    return c;
  }

  /** 주6일 근무 주(일요일 n)의 여섯째 근무일: 일요일이 휴무면 토요일. 공휴일이면 6일 연장·민트 없음 */
  const sixthDay = (info, n, g) => n - (groupShift(info, n, g) === '휴무' ? 1 : 0);

  function personDay(cells, key, letter) {
    const nums = [], lets = [];
    for (let j = 0; j < 8; j++) { nums.push(parseCell(cells[2 * j])); lets.push(parseCell(cells[2 * j + 1])); }
    const own = letter ? lets : nums;
    let k = 0;
    for (let i = 0; i < 8; i++) if (own[i][0].toUpperCase() === key.toUpperCase()) { k = i + 1; break; }
    const bp = k ? SHIFTS[k - 1] : '';
    const bq = k && own[k - 1][1] ? own[k - 1][2] + '/' + own[k - 1][1] : '';
    const found = (lo, hi) => nums.slice(lo, hi).concat(lets.slice(lo, hi)).some(x => x[1].includes(key));
    let br = (found(4, 6) ? '초' : '') + (found(2, 4) ? '중' : '') + (found(0, 2) ? '말' : '');
    if (nums.slice(0, 6).concat(lets.slice(0, 6)).some(x => x[1].includes(key) && plen(x[1]) > 1)) br += '*';
    return [bp, bq, br];
  }

  function extBase(info, n, g, bp, br, holiday) {
    if (br === '') return 0;
    const core = br.replace(/\*/g, '');
    if (bp === '휴무') {
      if (br.endsWith('*')) return 3.5;
      if (plen(core) === 1) {
        const rem = 7 - (weekday(n) + 1);
        let laterOff = false;
        for (let j = 1; j <= 6; j++) if (j <= rem && groupShift(info, n + j, g) === '휴무') { laterOff = true; break; }
        return laterOff ? 8 : 11;
      }
      return core === '중말' ? 15 : 16;
    }
    const pair = bp.slice(0, 1) + core;
    if (br.endsWith('*')) return 3.5;
    if (holiday) return (pair === '초말' || pair === '말초') ? 11 : 10;
    return (pair === '초말' || pair === '말초') ? 8 : 7.5;
  }

  function nightValue(bp, bq, br) {
    if (bq !== '') return bq;
    const core = br.replace(/\*/g, '');
    if (['말번', '중번', '초번'].includes(bp)) {
      const s = bp.slice(0, 1) + (br.endsWith('*') ? '' : core);
      return s.includes('말') ? 7.5 : s.includes('중') ? 0.5 : '초번';
    }
    if (bp === '휴무') {
      if (br === '' || br.endsWith('*')) return '휴';
      return core.includes('말') ? 7.5 : core.includes('중') ? 0.5 : '초번';
    }
    return '';
  }

  function compute(info, y, m, dayCells, names) {
    const nd = daysIn(y, m);
    const pre = `${y}-${String(m).padStart(2, '0')}-`;
    const holDays = new Set(Object.keys(info.holidays).filter(k => k.startsWith(pre)).map(k => parseInt(k.slice(8), 10)));
    const people = [];
    for (let i = 0; i < 16; i++) {
      const [key, g, letter] = personKey(i);
      const states = [];
      for (let dd = 0; dd < nd; dd++) states.push(personDay(dayCells[dd], key, letter));
      const ext = [], night = [], hol = [], green = [];
      for (let dd = 0; dd < 31; dd++) {
        if (dd >= nd) { ext.push(''); night.push(''); hol.push(''); green.push(false); continue; }
        const n = dn(y, m, dd + 1);
        const [bp, bq, br] = states[dd];
        const isHol = holDays.has(dd + 1);
        const a = extBase(info, n, g, bp, br, isHol);
        const six = weekday(n) === 6 && weekCount(info, n, g) === 6 && !(iso(sixthDay(info, n, g)) in info.holidays);
        let b = 0;
        if (six) {
          let leave = false;
          for (let j = Math.max(0, dd - 6); j <= dd; j++) if (states[j][1] !== '') leave = true;
          b = leave ? 5.5 : 8;
        }
        ext.push(a + b === 0 ? '' : a + b);
        night.push(nightValue(bp, bq, br));
        hol.push(isHol && ((bq === '' && ['초번', '중번', '말번'].includes(bp)) || (bp === '휴무' && br !== '')) ? 8 : '');
        green.push(six);
      }
      const tot = vals => vals.reduce((s, v) => (isNum(v) ? s + v : s), 0);
      const raw = names[i];
      let no, name;
      if (raw.includes('.')) { const p = raw.indexOf('.'); no = raw.slice(0, p); name = xtrim(raw.slice(p + 1)); }
      else { no = key; name = raw; }
      people.push({ no, name, ext, night, hol, green, sum: [tot(ext), tot(night), tot(hol)] });
    }
    const holList = Object.keys(info.holidays).filter(k => k.startsWith(pre)).sort().slice(0, 8).map(k => [k, info.holidays[k]]);
    for (const p of people) {
      p.note = holList.filter(([k]) => p.hol[parseInt(k.slice(8), 10) - 1] === 8)
        .map(([k, nm]) => `${nm}(${parseInt(k.slice(8), 10)}일)`).join(', ');
    }
    return { people, ndays: nd, hol_days: holDays };
  }

  function fmt(v, nf) {
    if (isNum(v)) {
      if (nf === '0.0') return v.toFixed(1);
      return Number.isInteger(v) ? String(v) : String(v);
    }
    return v === null || v === undefined ? '' : String(v);
  }

  function gridRows(grid, overrides) {
    const rows = [];
    grid.cells.forEach((baseRow, ri) => {
      const r = ri + 1, row = [];
      baseRow.forEach((base, ci) => {
        if (base === null) return;
        const c = ci + 1;
        const cell = Object.assign({}, base, { addr: null, edited: false, orig: '' });
        const o = overrides[`${r},${c}`];
        if (o) {
          if ('v' in o) cell.v = fmt(o.v, base.nf);
          if (o.fill) cell.fill = o.fill;
        }
        row.push(cell);
      });
      rows.push({ h: pyRound(grid.heights[r - 1] * 4 / 3), cells: row });
    });
    return rows;
  }

  const widthsPx = grid => grid.widths.map(w => pyRound(w * 7 + 5));

  function buildOtSheets(info, y, m, result) {
    const nd = result.ndays, sheets = [];
    OT_SHEETS.forEach((sheetName, s) => {
      const ov = { '1,16': { v: m } };
      for (let dd = 0; dd < 31; dd++) {
        const c = DAY_COL0 + dd;
        if (dd >= nd) { ov[`3,${c}`] = { v: '' }; ov[`4,${c}`] = { v: '' }; continue; }
        const n = dn(y, m, dd + 1);
        const head = result.hol_days.has(dd + 1) ? YELLOW : weekday(n) >= 5 ? PINK : null;
        ov[`3,${c}`] = { v: dd + 1, fill: head };
        ov[`4,${c}`] = { v: WEEKDAYS[weekday(n)], fill: head };
      }
      for (let i = 0; i < 8; i++) {
        const p = result.people[s * 8 + i], r0 = 5 + 3 * i;
        ov[`${r0},1`] = { v: p.no };
        ov[`${r0},2`] = { v: p.name };
        for (let k = 0; k < 3; k++) ov[`${r0 + k},4`] = { v: p.sum[k] };
        for (let dd = 0; dd < 31; dd++) {
          const c = DAY_COL0 + dd;
          ov[`${r0},${c}`] = { v: p.ext[dd], fill: p.green[dd] ? GREEN : null };
          ov[`${r0 + 1},${c}`] = { v: p.night[dd] };
          ov[`${r0 + 2},${c}`] = { v: p.hol[dd], fill: p.hol[dd] === 8 ? YELLOW : null };
        }
      }
      const grid = info.ot.grids[sheetName];
      sheets.push([sheetName, widthsPx(grid), gridRows(grid, ov), grid.landscape]);
    });
    const ov = { '1,7': { v: m }, '3,3': { v: `[${m}월 순찰팀] 시간외 근무 현황` },
      '21,1': { v: `상기와 같이 시간외 근무 하였음을 확인합니다.\n\n${y}년 ${m}월 ${nd}일\n\n교통안전부` } };
    result.people.forEach((p, i) => {
      const r = 4 + i;
      ov[`${r},1`] = { v: p.no }; ov[`${r},2`] = { v: p.name };
      ov[`${r},4`] = { v: p.sum[0] }; ov[`${r},7`] = { v: p.sum[1] }; ov[`${r},10`] = { v: p.sum[2] };
      ov[`${r},13`] = { v: p.note };
    });
    const grid = info.ot.stat_grid;
    sheets.push([STAT_SHEET, widthsPx(grid), gridRows(grid, ov), grid.landscape]);
    return sheets;
  }

  /** 화면에 그릴 시트 4개: [이름, 열너비px, 행목록, 가로인쇄] */
  function allSheets(info, y, m, edits, groupEdits) {
    const sheet = buildSheet(y, m, info, edits);
    const widths = info.widths.map(w => pyRound(w * 7 + 5));
    const dayCells = sheet.days.filter(Boolean).map(d => d.duties.map(x => x.v));
    const result = compute(info, y, m, dayCells, personNames(info, groupEdits));
    return { sheet, sheets: [['근무표', widths, buildGrid(info, sheet, groupEdits), info.landscape]].concat(buildOtSheets(info, y, m, result)) };
  }

  /** 근무 칸 하나 수정 → [새 편집, 표시 값, 수정됨 여부, 색] (파이썬 /api/edit) */
  function applyDutyEdit(info, y, m, edits, key, value) {
    const mt = /^([C-R]):(\d+)$/.exec(key);
    const c = mt[1].charCodeAt(0) - 64, day = parseInt(mt[2], 10);
    const n = dn(y, m, day);
    const orig = info.pattern[cycleRow(info, n)][c - 3];
    const out = Object.assign({}, edits);
    value = pyStrip(String(value));
    if (value === '' || value === orig) { delete out[key]; value = orig; } else out[key] = value;
    return { edits: out, value, edited: key in out, fill: dutyFill(info, n, c, value) };
  }

  /** 근무조 칸 하나 수정 (비우면 원래 값) */
  function applyGroupEdit(info, groupEdits, addr, value) {
    const out = Object.assign({}, groupEdits), orig = info.group_orig[addr];
    value = pyStrip(String(value));
    if (value === '' || value === pyStrip(orig)) { delete out[addr]; value = orig; } else out[addr] = value;
    return { group: out, value, edited: addr in out };
  }

  const api = { PINK, YELLOW, GREEN, DUTY_COLS, OT_SHEETS, STAT_SHEET, dn, iso, weekday, daysIn, colLetter, pyRound,
    dutyKey, effectiveEdits, buildSheet, buildGrid, compute, allSheets, applyDutyEdit, applyGroupEdit, personNames, groupValues };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Calc = api;
})(this);
