/* 근무표 계산 엔진 (화면과 무관한 순수 계산). 브라우저와 node 양쪽에서 쓴다.
 * 규칙 출처: 근무표 자동화 PRD(2026-10-10) + 순찰근무표_자동화.xlsx 수식.
 *
 * cfg = {
 *   pattern: 20행 x 8칸 (말1,말2,중1,중2,초1,초2,휴무,휴무) 조 번호 1~8,
 *   base: 'YYYY-MM-DD' 주기 1일차,
 *   holidays: (iso) => 공휴일 이름 | undefined,
 *   getOverrides: (y, m) => { 'd|c': '입력 문자열' }   // c: 0~15 (번호·영문 교대)
 *   otherMonthVacation: true  // 지난달 휴가 입력도 저장돼 있으면 사용 (false면 패턴대로=휴가 없음)
 * }
 */
(function (g) {
  'use strict';

  const TYPES = ['말번', '말번', '중번', '중번', '초번', '초번', '휴무', '휴무'];
  const INI = { '말번': '말', '중번': '중', '초번': '초' };
  const NUMS = '12345678';
  const LETS = 'ABCDEFGH';
  const IDS = NUMS + LETS;

  // 시트 순서: 1, A, 2, B, ... 8, H
  const PEOPLE = [];
  for (let i = 1; i <= 8; i++) {
    PEOPLE.push({ id: String(i), group: i, kind: 'n' });
    PEOPLE.push({ id: LETS[i - 1], group: i, kind: 'l' });
  }

  const mod = (a, n) => ((a % n) + n) % n;
  const dn = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / 864e5);
  const dateOf = (n) => { const t = new Date(n * 864e5); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; };
  const pad = (x) => (x < 10 ? '0' : '') + x;
  const iso = (n) => { const t = dateOf(n); return t.y + '-' + pad(t.m) + '-' + pad(t.d); };
  const wd = (n) => mod(n + 4, 7);                 // 0=일 ... 6=토
  const wdMon1 = (n) => { const w = wd(n); return w === 0 ? 7 : w; };  // 월=1 ... 일=7
  const isoToDn = (s) => { const [y, m, d] = s.split('-').map(Number); return dn(y, m, d); };

  /* ---------- 패턴 ---------- */
  function patIdx(cfg, n) { return mod(n - isoToDn(cfg.base), 20); }
  function typeOf(cfg, grp, n) {
    const k = cfg.pattern[patIdx(cfg, n)].indexOf(grp);
    return k < 0 ? '' : TYPES[k];
  }
  // 그 날이 끝나는 7일(월~일 기준 창) 안의 근무 수. 일요일에 쓰면 그 주 근무 수.
  function workCount(cfg, grp, n) {
    let c = 0;
    for (let k = 0; k < 7; k++) if (typeOf(cfg, grp, n - k) !== '휴무') c++;
    return c;
  }
  function autoCell(cfg, n, c) {
    const v = cfg.pattern[patIdx(cfg, n)][c >> 1];
    return c % 2 === 0 ? String(v) : LETS[v - 1];
  }

  /* ---------- 칸 해석 ---------- */
  // "건7/5" -> {reason:'건', orig:'7', subs:'5'},  "1/7C" -> {reason:'연', orig:'1', subs:'7C'}
  function parseCell(text) {
    let t = String(text == null ? '' : text).trim().toUpperCase();
    let reason = '연';
    if (t !== '' && IDS.indexOf(t[0]) < 0) { reason = t[0]; t = t.slice(1); }
    const i = t.indexOf('/');
    if (i < 0) return { reason, orig: t.trim(), subs: '' };
    return { reason, orig: t.slice(0, i).trim(), subs: t.slice(i + 1).trim() };
  }

  function dayModel(cfg, n, cache) {
    if (cache && cache.has(n)) return cache.get(n);
    const { y, m, d } = dateOf(n);
    const ov = (cfg.getOverrides && cfg.getOverrides(y, m)) || {};
    const dm = { n, numOrig: [], letOrig: [], numSubs: [], letSubs: [], numReason: [], letReason: [], texts: [] };
    for (let c = 0; c < 16; c++) {
      const raw = ov[d + '|' + c];
      const text = raw === undefined || raw === null ? autoCell(cfg, n, c) : raw;
      dm.texts.push(text);
      const p = parseCell(text), k = c >> 1;
      if (c % 2 === 0) { dm.numOrig[k] = p.orig; dm.numSubs[k] = p.subs; dm.numReason[k] = p.reason; }
      else { dm.letOrig[k] = p.orig; dm.letSubs[k] = p.subs; dm.letReason[k] = p.reason; }
    }
    if (cache) cache.set(n, dm);
    return dm;
  }

  // 한 사람의 그 날: 자기 근무, 대근 표시(label), 연장 근무(extStr: 초중말 중 해당 글자, star: 나눠 서기)
  function personDay(dm, p) {
    const origs = p.kind === 'n' ? dm.numOrig : dm.letOrig;
    const subs = p.kind === 'n' ? dm.numSubs : dm.letSubs;
    const rs = p.kind === 'n' ? dm.numReason : dm.letReason;
    const k = origs.indexOf(p.id);
    const own = k < 0 ? '' : TYPES[k];
    const label = k >= 0 && subs[k] ? rs[k] + '/' + subs[k] : '';
    let hasMal = false, hasJung = false, hasCho = false, star = false;
    for (let s = 0; s < 6; s++) {                       // 휴무 칸(6,7)의 표기는 연장으로 보지 않는다
      for (const str of [dm.numSubs[s], dm.letSubs[s]]) {
        if (!str || str.indexOf(p.id) < 0) continue;
        if (s < 2) hasMal = true; else if (s < 4) hasJung = true; else hasCho = true;
        if (str.length > 1) star = true;
      }
    }
    const extStr = (hasCho ? '초' : '') + (hasJung ? '중' : '') + (hasMal ? '말' : '');
    return { own, label, extStr, star };
  }

  /* ---------- 시간외 계산 ---------- */
  function extValue(cfg, n, p, pd, isHol) {
    const s = pd.extStr;
    if (!s) return 0;
    if (pd.own === '휴무') {
      if (isHol) return pd.star ? 3.5 : 8;              // 2026-10-10 결정: 휴무일 연장이 공휴일이면 연장 8만
      if (pd.star) return 3.5;
      if (s.length === 1) {
        const left = 7 - wdMon1(n);
        for (let k = 1; k <= left; k++) if (typeOf(cfg, p.group, n + k) === '휴무') return 8;   // 첫째 휴무일
        return 11;                                        // 두번째(마지막) 휴무일
      }
      return s === '중말' ? 15 : 16;
    }
    if (pd.star) return 3.5;
    const comb = (INI[pd.own] || '') + s;
    const wide = comb === '초말' || comb === '말초';
    if (isHol) return wide ? 11 : 10;
    return wide ? 8 : 7.5;
  }

  function nightValue(pd) {
    if (pd.label) return pd.label;
    if (INI[pd.own]) {
      const s = INI[pd.own] + (pd.star ? '' : pd.extStr);
      if (s.indexOf('말') >= 0) return 7.5;
      if (s.indexOf('중') >= 0) return 0.5;
      return '초번';
    }
    if (pd.own === '휴무') {
      if (!pd.extStr || pd.star) return '휴';
      if (pd.extStr.indexOf('말') >= 0) return 7.5;
      if (pd.extStr.indexOf('중') >= 0) return 0.5;
      return '초번';
    }
    return '';
  }

  // 그 주(월~일)에 휴가(다른 사람 번호로 바뀐 날)가 있었나
  function vacationInWeek(cfg, p, n, cache) {
    for (let k = 0; k < 7; k++) {
      const day = n - k;
      if (cfg.otherMonthVacation === false) {
        const a = dateOf(day), b = dateOf(n);
        if (a.y !== b.y || a.m !== b.m) continue;
      }
      if (personDay(dayModel(cfg, day, cache), p).label) return true;
    }
    return false;
  }

  /* ---------- 월 계산 ---------- */
  function computeMonth(cfg, y, m, names) {
    names = names || {};
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const cache = new Map();
    const days = [];
    for (let d = 1; d <= last; d++) {
      const n = dn(y, m, d);
      days.push({ d, n, wd: wd(n), hol: cfg.holidays(iso(n)) || null });
    }
    const persons = PEOPLE.map((p) => {
      const ext = [], night = [], hol = [], six = [], label = [];
      let tExt = 0, tNight = 0, tHol = 0;
      const notes = [];
      for (const day of days) {
        const dm = dayModel(cfg, day.n, cache);
        const pd = personDay(dm, p);
        const isHol = !!day.hol;
        let e = extValue(cfg, day.n, p, pd, isHol);
        let isSix = false;
        if (day.wd === 0 && !isHol && workCount(cfg, p.group, day.n) === 6) {
          isSix = true;
          e += vacationInWeek(cfg, p, day.n, cache) ? 5.5 : 8;
        }
        const nv = nightValue(pd);
        const hv = isHol && !pd.label && (pd.own === '초번' || pd.own === '중번' || pd.own === '말번') ? 8 : null;
        ext.push(e ? e : null);
        night.push(nv === '' ? null : nv);
        hol.push(hv);
        six.push(isSix);
        label.push(pd.label);
        if (e) tExt += e;
        if (typeof nv === 'number') tNight += nv;
        if (hv) { tHol += hv; notes.push({ d: day.d, name: day.hol }); }
      }
      return {
        id: p.id, group: p.group, kind: p.kind, name: names[p.id] || '',
        ext, night, hol, six, label, tExt, tNight, tHol,
        note: notes.map((o) => o.name + '(' + o.d + '일)').join(', '),
      };
    });
    return { y, m, days, persons };
  }

  /* ---------- 근무표 화면용 ---------- */
  // 한 달의 근무표 칸(16칸)과 색 구분
  function monthGrid(cfg, y, m) {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const cache = new Map();
    const rows = [];
    for (let d = 1; d <= last; d++) {
      const n = dn(y, m, d);
      const hol = cfg.holidays(iso(n)) || null;
      const dm = dayModel(cfg, n, cache);
      const sunday = wd(n) === 0;
      const ov = (cfg.getOverrides && cfg.getOverrides(y, m)) || {};
      const cells = dm.texts.map((text, c) => {
        let mint = false;
        if (sunday && !hol) {
          const o = parseCell(text).orig;
          const grp = o && IDS.indexOf(o) >= 0 ? (NUMS.indexOf(o) >= 0 ? +o : LETS.indexOf(o) + 1) : 0;
          if (grp && workCount(cfg, grp, n) === 6) mint = true;
        }
        return { text, input: ov[d + '|' + c] !== undefined && ov[d + '|' + c] !== null, mint };
      });
      rows.push({ d, n, wd: wd(n), hol, cells });
    }
    return rows;
  }

  /* ---------- 패턴 입력 도우미 ---------- */
  // 엑셀에서 복사한 20행 x 8칸(또는 영문이 끼어 있는 16칸, 일차 열 포함)을 읽는다.
  function parsePatternText(text) {
    const rows = [];
    for (const line of String(text).split(/\r?\n/)) {
      let cells = line.split('\t').map((s) => s.trim()).filter((s) => s !== '');
      if (!cells.length) continue;
      cells = cells.filter((s) => !/^[A-Ha-h]$/.test(s));
      if (cells.length === 9) cells = cells.slice(1);
      if (cells.length === 8 && cells.every((s) => /^[1-8]$/.test(s))) rows.push(cells.map(Number));
    }
    return rows;
  }
  // 하루에 1~8이 한 번씩 들어갔는지. 문제 있는 행 목록을 돌려준다.
  function validatePattern(pattern) {
    const problems = [];
    for (let i = 0; i < 20; i++) {
      const row = pattern[i] || [];
      const seen = {};
      const dup = [], miss = [];
      row.forEach((v) => { seen[v] = (seen[v] || 0) + 1; });
      for (let v = 1; v <= 8; v++) { if (!seen[v]) miss.push(v); else if (seen[v] > 1) dup.push(v); }
      if (miss.length || dup.length || row.length !== 8) problems.push({ day: i + 1, missing: miss, duplicated: dup });
    }
    return problems;
  }

  /* ---------- 공휴일 ---------- */
  // 구글 캘린더 ICS 텍스트 -> { 'YYYY-MM-DD': 이름 }
  function parseICS(text) {
    const out = {};
    const unfolded = String(text).replace(/\r?\n[ \t]/g, '');
    const evs = unfolded.split('BEGIN:VEVENT').slice(1);
    for (const ev of evs) {
      const ds = /DTSTART(?:;VALUE=DATE)?:(\d{4})(\d{2})(\d{2})/.exec(ev);
      const sm = /SUMMARY[^:]*:(.*)/.exec(ev);
      if (ds && sm) out[ds[1] + '-' + ds[2] + '-' + ds[3]] = sm[1].trim().replace(/\\,/g, ',');
    }
    return out;
  }
  // 기본 목록 + 받아 둔 목록(연도 단위로 통째 교체) + 직접 추가/삭제 + 근로자의 날(항상)
  function buildHolidayFn(base, fetched, extra) {
    base = base || {}; fetched = fetched || {}; extra = extra || {};
    const fetchedYears = {};
    Object.keys(fetched).forEach((k) => { fetchedYears[k.slice(0, 4)] = true; });
    return function (s) {
      if (Object.prototype.hasOwnProperty.call(extra, s)) return extra[s] || undefined;   // null = 삭제
      if (s.slice(5) === '05-01') return '근로자의 날';
      if (fetchedYears[s.slice(0, 4)]) return fetched[s];
      return base[s];
    };
  }
  function holidaysOfMonth(fn, y, m) {
    const out = [];
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    for (let d = 1; d <= last; d++) { const nm = fn(y + '-' + pad(m) + '-' + pad(d)); if (nm) out.push({ d, name: nm }); }
    return out;
  }

  // 숫자 표시: 8 -> "8", 7.5 -> "7.5"
  const fmt = (v) => (typeof v === 'number' ? String(Math.round(v * 100) / 100) : v == null ? '' : String(v));

  g.GM = {
    TYPES, PEOPLE, IDS, mod, dn, dateOf, iso, wd, isoToDn, pad,
    typeOf, workCount, patIdx, autoCell, parseCell, dayModel, personDay,
    computeMonth, monthGrid, parsePatternText, validatePattern,
    parseICS, buildHolidayFn, holidaysOfMonth, fmt,
    daysInMonth: (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(),
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = g.GM;
})(typeof window !== 'undefined' ? window : globalThis);
