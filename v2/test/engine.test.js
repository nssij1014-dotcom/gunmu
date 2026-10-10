// node test/engine.test.js  -- 계산 규칙 검증 (지침의 사례 + 엑셀 10월 값 대조)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
require('../holidays.js');
const GM = require('../engine.js');
const X = JSON.parse(fs.readFileSync(path.join(__dirname, 'xlsx_pattern.json'), 'utf8'));
const OCT = JSON.parse(fs.readFileSync(path.join(__dirname, 'xlsx_oct2026.json'), 'utf8'));

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + e.message); }
}

const holFn = GM.buildHolidayFn(globalThis.HOLIDAYS_BASE, {}, {});
function mk(over, extra) {
  const store = over || {};
  return Object.assign({
    pattern: X.pattern, base: X.base, holidays: holFn,
    getOverrides: (y, m) => store[y + '-' + m] || {},
    otherMonthVacation: true,
  }, extra || {});
}
// 사람 id가 그 날 앉아 있는 칸 번호(0~15)
function cellOf(cfg, y, m, d, id) {
  const n = GM.dn(y, m, d), idx = GM.patIdx(cfg, n);
  const g = /\d/.test(id) ? +id : id.charCodeAt(0) - 64;
  const k = cfg.pattern[idx].indexOf(g);
  return 2 * k + (/\d/.test(id) ? 0 : 1);
}
function typeOn(cfg, y, m, d, id) {
  const g = /\d/.test(id) ? +id : id.charCodeAt(0) - 64;
  return GM.typeOf(cfg, g, GM.dn(y, m, d));
}
const person = (res, id) => res.persons.find((p) => p.id === id);
function setOv(store, y, m, d, c, text) { (store[y + '-' + m] = store[y + '-' + m] || {})[d + '|' + c] = text; }
// 조건에 맞는 날을 찾는다 (평일 비공휴일 기본)
function findDay(y, m, pred) {
  const last = GM.daysInMonth(y, m);
  for (let d = 1; d <= last; d++) if (pred(d)) return d;
  throw new Error('조건에 맞는 날 없음');
}

console.log('\n[패턴]');
t('7일 근무 수가 엑셀 패턴 시트와 같다', () => {
  const cfg = mk();
  for (let i = 0; i < 20; i++) for (let g = 1; g <= 8; g++) {
    const n = GM.isoToDn(X.base) + i;
    assert.strictEqual(GM.workCount(cfg, g, n), X.week[i][g - 1], `일차${i + 1} ${g}조`);
  }
});
t('패턴 검증: 겹침/빠짐 경고', () => {
  const bad = X.pattern.map((r) => r.slice()); bad[2][0] = 3;
  const pr = GM.validatePattern(bad);
  assert.strictEqual(pr.length, 1); assert.strictEqual(pr[0].day, 3);
  assert.strictEqual(GM.validatePattern(X.pattern).length, 0);
});
t('엑셀에서 복사한 패턴(영문 열 포함/일차 열 포함)을 읽는다', () => {
  const lines = X.pattern.map((r, i) => [i + 1].concat(r.flatMap((v) => [v, String.fromCharCode(64 + v)])).join('\t')).join('\n');
  const rows = GM.parsePatternText(lines);
  assert.deepStrictEqual(rows, X.pattern);
  assert.deepStrictEqual(GM.parsePatternText(X.pattern.map((r) => r.join('\t')).join('\r\n')), X.pattern);
});

console.log('\n[엑셀 2026-10 값과 일치 (대근 입력 없음)]');
t('시간외근무1·2 연장/야간/휴일 모든 칸이 같다', () => {
  const cfg = mk();
  const res = GM.computeMonth(cfg, 2026, 10);
  const sheets = [OCT['시간외근무1'], OCT['시간외근무2']];
  sheets.forEach((rows, si) => {
    for (let pi = 0; pi < 8; pi++) {
      const pers = res.persons[si * 8 + pi];
      const kinds = ['ext', 'night', 'hol'];
      kinds.forEach((kd, ki) => {
        const row = rows[pi * 3 + ki];
        for (let d = 1; d <= 31; d++) {
          let ex = row[3 + d]; if (ex === '') ex = null;
          const got = pers[kd][d - 1];
          assert.strictEqual(got === undefined ? null : got, ex, `${pers.id} ${kd} ${d}일: 엑셀 ${ex} / 앱 ${got}`);
        }
      });
      assert.strictEqual(pers.tExt, rows[pi * 3][3], pers.id + ' 연장 합계');
      assert.strictEqual(pers.tNight, rows[pi * 3 + 1][3], pers.id + ' 야간 합계');
      assert.strictEqual(pers.tHol, rows[pi * 3 + 2][3], pers.id + ' 휴일 합계');
    }
  });
});
t('통계 비고 문구가 같다', () => {
  const res = GM.computeMonth(mk(), 2026, 10);
  OCT.stat.slice(0, 16).forEach((r, i) => {
    assert.strictEqual(res.persons[i].note, r[12] || '', res.persons[i].id);
  });
});

console.log('\n[야간/연장: 평일 연속 근무]');
const Y = 2026, M = 11;   // 11월: 공휴일 없음
function weekdayCase(a, b, ownA, ownB) {   // a: 연장자(자기 근무 ownA), b: 휴가자(근무 ownB). 못 찾으면 다른 쌍을 찾는다
  const cfg = mk();
  const ok = (d, x, y) => { const w = GM.wd(GM.dn(Y, M, d)); return w >= 1 && w <= 5 && typeOn(cfg, Y, M, d, x) === ownA && typeOn(cfg, Y, M, d, y) === ownB; };
  for (let d = 1; d <= 30; d++) if (ok(d, a, b)) return d;
  for (let d = 1; d <= 30; d++) for (const x of '12345678') for (const y of '12345678') if (x !== y && ok(d, x, y)) { weekdayCase.pair = [x, y]; return d; }
  throw new Error('no case');
}
function run(a, b, d, text) {
  const store = {}; const cfg = mk(store);
  setOv(store, Y, M, d, cellOf(cfg, Y, M, d, b), text);
  return { res: GM.computeMonth(cfg, Y, M), cfg };
}
t('초번 + 중번 연속 "7/5": 5 연장 7.5 / 야간 0.5, 7 칸은 연/5', () => {
  const d = weekdayCase('5', '7', '초번', '중번');
  const { res } = run('5', '7', d, '7/5');
  assert.strictEqual(person(res, '5').ext[d - 1], 7.5);
  assert.strictEqual(person(res, '5').night[d - 1], 0.5);
  assert.strictEqual(person(res, '7').night[d - 1], '연/5');
  assert.strictEqual(person(res, '7').ext[d - 1], null);
});
t('초번 + 말번 연속: 연장 8 / 야간 7.5', () => {
  const d = weekdayCase('5', '7', '초번', '말번');
  const [a, b] = weekdayCase.pair || ['5', '7'];
  const { res } = run(a, b, d, `${b}/${a}`);
  assert.strictEqual(person(res, a).ext[d - 1], 8);
  assert.strictEqual(person(res, a).night[d - 1], 7.5);
});
t('중번 + 말번 연속: 연장 7.5 / 야간 7.5', () => {
  const d = weekdayCase('5', '7', '중번', '말번');
  const { res } = run('5', '7', d, '7/5');
  assert.strictEqual(person(res, '5').ext[d - 1], 7.5);
  assert.strictEqual(person(res, '5').night[d - 1], 7.5);
});
t('영문 대근 "G/E" -> 연/E 표시, E 연장', () => {
  const d = weekdayCase('E', 'G', '초번', '중번');
  const { res } = run('E', 'G', d, 'G/E');
  assert.strictEqual(person(res, 'G').night[d - 1], '연/E');
  assert.strictEqual(person(res, 'E').ext[d - 1], 7.5);
});
t('사유 문자 건·병·공 및 지침에 없는 문자(헌)도 같은 방식 + 휴가로 취급', () => {
  const d = weekdayCase('5', '7', '초번', '중번');
  for (const [txt, shown] of [['건7/5', '건/5'], ['병7/5', '병/5'], ['공7/5', '공/5'], ['헌7/5', '헌/5']]) {
    const { res } = run('5', '7', d, txt);
    assert.strictEqual(person(res, '7').night[d - 1], shown, txt);
    assert.strictEqual(person(res, '5').ext[d - 1], 7.5, txt);   // 대근자 계산은 사유 문자와 무관
  }
  const d2 = weekdayCase('H', 'D', '초번', '중번');
  const { res } = run('H', 'D', d2, '병D/H');
  assert.strictEqual(person(res, 'D').night[d2 - 1], '병/H');
});
t('"헌1/8"처럼 번호가 1인 휴가자 칸도 헌/8', () => {
  const d = weekdayCase('8', '1', '초번', '중번');
  const { res } = run('8', '1', d, '헌1/8');
  assert.strictEqual(person(res, '1').night[d - 1], '헌/8');
});

console.log('\n[1/7C 나눠 서기: 3.5 덧셈]');
t('"1/7C": 7과 C에게 3.5씩 (자기 근무에 연속되는 칸)', () => {
  // 1 휴가, 7(번호)과 C(영문=3조)가 나눠 근무
  const d = findDay(Y, M, (d) => { const cfg = mk(); const w = GM.wd(GM.dn(Y, M, d));
    return w >= 1 && w <= 5 && typeOn(cfg, Y, M, d, '1') === '중번' && typeOn(cfg, Y, M, d, '7') === '초번' && typeOn(cfg, Y, M, d, 'C') !== '휴무'; });
  const { res } = run('7', '1', d, '1/7C');
  assert.strictEqual(person(res, '7').ext[d - 1], 3.5);
  assert.strictEqual(person(res, 'C').ext[d - 1], 3.5);
  assert.strictEqual(person(res, '1').night[d - 1], '연/7C');
});
t('주6일 일요일과 겹치면 8 + 3.5 = 11.5', () => {
  const cfg0 = mk();
  const d = findDay(Y, M, (d) => { const n = GM.dn(Y, M, d); return GM.wd(n) === 0 &&
    [1, 2, 3, 4, 5, 6, 7, 8].some((g) => GM.workCount(cfg0, g, n) === 6); });
  const n = GM.dn(Y, M, d);
  const g6 = [1, 2, 3, 4, 5, 6, 7, 8].find((g) => GM.workCount(cfg0, g, n) === 6);
  const id6 = String(g6);
  const store = {};
  // 그 주 일요일에 다른 사람(1~8 중 휴가자)을 대신해 id6 이 3.5 만큼 서게 한다
  const other = [1, 2, 3, 4, 5, 6, 7, 8].map(String).find((x) => x !== id6 && typeOn(cfg0, Y, M, d, x) !== '휴무');
  const cfg = mk(store);
  setOv(store, Y, M, d, cellOf(cfg, Y, M, d, other), `${other}/${id6}${id6 === '2' ? 'B' : 'A'}`);
  const res = GM.computeMonth(cfg, Y, M);
  const v = person(res, id6).ext[d - 1];
  assert.ok(v === 11.5 || v === 8 + 3.5, '실제 ' + v);
});

console.log('\n[주6일]');
function sundayInfo(y, m) {
  const cfg = mk(); const out = [];
  const last = GM.daysInMonth(y, m);
  for (let d = 1; d <= last; d++) { const n = GM.dn(y, m, d); if (GM.wd(n) !== 0) continue;
    for (let g = 1; g <= 8; g++) if (GM.workCount(cfg, g, n) === 6) out.push({ d, g }); }
  return out;
}
t('주6일 일요일 연장 8, 색 표시(six)', () => {
  const res = GM.computeMonth(mk(), 2026, 11);
  const s = sundayInfo(2026, 11)[0];
  const p = res.persons.find((x) => x.id === String(s.g));
  assert.strictEqual(p.ext[s.d - 1], 8); assert.strictEqual(p.six[s.d - 1], true);
  const pl = res.persons.find((x) => x.group === s.g && x.kind === 'l');
  assert.strictEqual(pl.ext[s.d - 1], 8);
});
t('그 주에 휴가를 쓴 주6일 근무자는 5.5', () => {
  const s = sundayInfo(2026, 11).find((x) => x.d >= 8);
  const cfg0 = mk(); const store = {}; const cfg = mk(store);
  // 그 주 월~토 중 근무일 하나에서 이 조를 휴가 처리 (다른 조 번호로 교체)
  const n0 = GM.dn(2026, 11, s.d);
  let hit = null;
  for (let k = 1; k <= 6; k++) { const n = n0 - k; if (GM.dateOf(n).m !== 11) continue;
    if (GM.typeOf(cfg0, s.g, n) !== '휴무') { hit = n; break; } }
  assert.ok(hit);
  const dd = GM.dateOf(hit).d;
  setOv(store, 2026, 11, dd, cellOf(cfg, 2026, 11, dd, String(s.g)), `${s.g}/${s.g === 8 ? 7 : s.g + 1}`);
  const res = GM.computeMonth(cfg, 2026, 11);
  assert.strictEqual(person(res, String(s.g)).ext[s.d - 1], 5.5);
});
t('주6일째 일요일이 공휴일이면 연장 비고 휴일 8만', () => {
  // 공휴일이 일요일과 겹치는 해: 2026-03-01(삼일절, 일요일)
  const cfg = mk(); const n = GM.dn(2026, 3, 1); assert.strictEqual(GM.wd(n), 0);
  const res = GM.computeMonth(cfg, 2026, 3);
  const sixG = [1, 2, 3, 4, 5, 6, 7, 8].filter((g) => GM.workCount(cfg, g, n) === 6);
  // 6일 근무 판정 상관없이 연장 칸에 6일 가산이 없어야 한다
  for (const g of sixG) { const p = person(res, String(g)); assert.strictEqual(p.six[0], false); assert.strictEqual(p.ext[0], null); }
  const working = res.persons.filter((p) => p.hol[0] === 8);
  assert.ok(working.length > 0);
});
t('달이 넘어가는 주: 일요일이 있는 달에만 들어간다 (중복 없음)', () => {
  // 2026-11-01 은 일요일: 지난 주 월~일 중 10월 날짜 포함
  const a = GM.computeMonth(mk(), 2026, 10), b = GM.computeMonth(mk(), 2026, 11);
  const n = GM.dn(2026, 11, 1); assert.strictEqual(GM.wd(n), 0);
  const cfg = mk();
  for (let g = 1; g <= 8; g++) {
    const six = GM.workCount(cfg, g, n) === 6;
    assert.strictEqual(person(b, String(g)).six[0], six, g + '조 11/1');
    assert.strictEqual(person(a, String(g)).six.some((x, i) => a.days[i].d === 31 && x), false);   // 10/31은 토요일
  }
});
t('지난달 휴가 입력: 저장돼 있으면 5.5, 사용 안 함 옵션이면 패턴대로 8', () => {
  const cfgP = mk(); const n = GM.dn(2026, 11, 1);
  const g = [1, 2, 3, 4, 5, 6, 7, 8].find((x) => GM.workCount(cfgP, x, n) === 6);
  // 10월 마지막 근무일을 휴가로
  let hit = null; for (let k = 1; k <= 6; k++) if (GM.typeOf(cfgP, g, n - k) !== '휴무') { hit = n - k; break; }
  const dd = GM.dateOf(hit); const store = {}; const cfg = mk(store);
  setOv(store, dd.y, dd.m, dd.d, cellOf(cfg, dd.y, dd.m, dd.d, String(g)), `${g}/${g === 8 ? 7 : g + 1}`);
  assert.strictEqual(person(GM.computeMonth(cfg, 2026, 11), String(g)).ext[0], 5.5);
  const cfg2 = mk(store, { otherMonthVacation: false });
  assert.strictEqual(person(GM.computeMonth(cfg2, 2026, 11), String(g)).ext[0], 8);
});

console.log('\n[공휴일]');
t('근로자의 날(5/1)은 항상 공휴일 (토·일과 겹쳐도, 목록에 없는 해도)', () => {
  const f = GM.buildHolidayFn({}, {}, {});
  assert.strictEqual(f('2027-05-01'), '근로자의 날');   // 토요일
  assert.strictEqual(f('2099-05-01'), '근로자의 날');
  assert.strictEqual(GM.wd(GM.dn(2027, 5, 1)), 6);
  const cfg = mk({}, { holidays: holFn });
  const res = GM.computeMonth(cfg, 2027, 5);
  assert.ok(res.persons.some((p) => p.hol[0] === 8));
  assert.ok(res.persons.find((p) => p.hol[0] === 8).note.indexOf('근로자의 날(1일)') >= 0);
});
t('공휴일 근무: 초번/중번/말번 휴일 8, 휴무인 사람은 없음', () => {
  const res = GM.computeMonth(mk(), 2026, 10);   // 10/3 개천절
  res.persons.forEach((p) => {
    const t3 = p.night[2];
    if (t3 === '휴') assert.strictEqual(p.hol[2], null);
    else assert.strictEqual(p.hol[2], 8);
  });
});
t('공휴일 연장: 초중 10 / 초말 11 (연장 + 휴일 8)', () => {
  // 11월 공휴일 없으므로 10월 9일(한글날, 금)에서 시험
  const cfg0 = mk();
  const find = (a, b, ownA, ownB) => { const d = 9; return typeOn(cfg0, 2026, 10, d, a) === ownA && typeOn(cfg0, 2026, 10, d, b) === ownB; };
  const ids = ['1', '2', '3', '4', '5', '6', '7', '8'];
  let done = 0;
  for (const a of ids) for (const b of ids) {
    if (a === b) continue;
    if (find(a, b, '초번', '중번') && done < 1) { const store = {}; const cfg = mk(store);
      setOv(store, 2026, 10, 9, cellOf(cfg, 2026, 10, 9, b), `${b}/${a}`);
      const r = GM.computeMonth(cfg, 2026, 10);
      assert.strictEqual(person(r, a).ext[8], 10); assert.strictEqual(person(r, a).hol[8], 8); done++; }
  }
  for (const a of ids) for (const b of ids) {
    if (a === b) continue;
    if (find(a, b, '초번', '말번') && done < 2) { const store = {}; const cfg = mk(store);
      setOv(store, 2026, 10, 9, cellOf(cfg, 2026, 10, 9, b), `${b}/${a}`);
      const r = GM.computeMonth(cfg, 2026, 10);
      assert.strictEqual(person(r, a).ext[8], 11); assert.strictEqual(person(r, a).night[8], 7.5); done++; }
  }
  assert.strictEqual(done, 2);
});

console.log('\n[휴무일 연장]');
function offDayCase(y, m, order) {   // order 0: 그 주 첫째 휴무일, 1: 마지막 휴무일
  const cfg = mk();
  const last = GM.daysInMonth(y, m);
  for (let d = 1; d <= last; d++) { const n = GM.dn(y, m, d); if (holFn(GM.iso(n))) continue;
    for (let g = 1; g <= 8; g++) {
      if (GM.typeOf(cfg, g, n) !== '휴무') continue;
      let later = false; for (let k = 1; k <= 7 - (GM.wd(n) === 0 ? 7 : GM.wd(n)); k++) if (GM.typeOf(cfg, g, n + k) === '휴무') later = true;
      if ((order === 0) !== later) continue;
      // 이 날 근무하는 다른 조 (중번/말번/초번) 중 하나를 골라 g 조가 대신 선다
      for (let o = 1; o <= 8; o++) if (o !== g && GM.typeOf(cfg, o, n) !== '휴무') return { d, g, o, type: GM.typeOf(cfg, o, n) };
    } }
  throw new Error('no case');
}
for (const order of [0, 1]) {
  t((order === 0 ? '첫째' : '두번째') + ' 휴무일 연장: 연장 ' + (order === 0 ? 8 : 11) + ' + 야간', () => {
    const c = offDayCase(2026, 11, order);
    const store = {}; const cfg = mk(store);
    setOv(store, 2026, 11, c.d, cellOf(cfg, 2026, 11, c.d, String(c.o)), `${c.o}/${c.g}`);
    const p = person(GM.computeMonth(cfg, 2026, 11), String(c.g));
    assert.strictEqual(p.ext[c.d - 1], order === 0 ? 8 : 11);
    assert.strictEqual(p.night[c.d - 1], c.type === '말번' ? 7.5 : c.type === '중번' ? 0.5 : '초번');
  });
}
t('휴가 사용 + 두번째 휴무일 연장: 초중 16(야간 0.5) / 중말 15(7.5) / 초말 16(7.5)', () => {
  const cfg0 = mk(); const y = 2026, m = 11;
  const find = (needSlots) => { // needSlots: 'cj' 초중, 'jm' 중말, 'cm' 초말
    for (let d = 1; d <= 30; d++) { const n = GM.dn(y, m, d); if (holFn(GM.iso(n))) continue;
      for (let g = 1; g <= 8; g++) {
        if (GM.typeOf(cfg0, g, n) !== '휴무') continue;
        let later = false; for (let k = 1; k <= 7 - (GM.wd(n) === 0 ? 7 : GM.wd(n)); k++) if (GM.typeOf(cfg0, g, n + k) === '휴무') later = true;
        if (later) continue;
        const want = needSlots === 'cj' ? ['초번', '중번'] : needSlots === 'jm' ? ['중번', '말번'] : ['초번', '말번'];
        const pick = want.map((tp) => { for (let o = 1; o <= 8; o++) if (o !== g && GM.typeOf(cfg0, o, n) === tp) return o; return 0; });
        if (pick.every(Boolean) && pick[0] !== pick[1]) return { d, g, pick };
      } } throw new Error('no ' + needSlots);
  };
  for (const [k, ev, nv] of [['cj', 16, 0.5], ['jm', 15, 7.5], ['cm', 16, 7.5]]) {
    const c = find(k); const store = {}; const cfg = mk(store);
    c.pick.forEach((o) => setOv(store, y, m, c.d, cellOf(cfg, y, m, c.d, String(o)), `${o}/${c.g}`));
    const p = person(GM.computeMonth(cfg, y, m), String(c.g));
    assert.strictEqual(p.ext[c.d - 1], ev, k); assert.strictEqual(p.night[c.d - 1], nv, k);
  }
});
t('결정(2026-10-10): 휴무일 연장일이 공휴일이면 연장 8만, 휴일 비움', () => {
  const cfg0 = mk(); const y = 2026, m = 10;    // 10/3 토 개천절, 10/5 월 대체
  let found = null;
  for (const d of [3, 5, 9]) { const n = GM.dn(y, m, d);
    for (let g = 1; g <= 8 && !found; g++) if (GM.typeOf(cfg0, g, n) === '휴무') {
      for (let o = 1; o <= 8; o++) if (o !== g && GM.typeOf(cfg0, o, n) !== '휴무') { found = { d, g, o, type: GM.typeOf(cfg0, o, n) }; break; } } if (found) break; }
  assert.ok(found);
  const store = {}; const cfg = mk(store);
  setOv(store, y, m, found.d, cellOf(cfg, y, m, found.d, String(found.o)), `${found.o}/${found.g}`);
  const p = person(GM.computeMonth(cfg, y, m), String(found.g));
  assert.strictEqual(p.ext[found.d - 1], 8);
  assert.strictEqual(p.hol[found.d - 1], null);
});

console.log('\n[ICS / 공휴일 목록]');
t('구글 캘린더 ICS 읽기, 연 단위로 교체, 직접 추가/삭제', () => {
  const ics = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20270301\r\nSUMMARY:삼일절\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20270505\r\nSUMMARY:어린이날\r\nEND:VEVENT\r\nEND:VCALENDAR';
  const got = GM.parseICS(ics);
  assert.deepStrictEqual(got, { '2027-03-01': '삼일절', '2027-05-05': '어린이날' });
  const f = GM.buildHolidayFn({ '2027-01-01': '신정', '2026-01-01': '신정연휴' }, got, { '2027-06-03': '임시', '2027-03-01': null });
  assert.strictEqual(f('2027-01-01'), undefined);       // 2027은 받아 둔 목록으로 통째 교체
  assert.strictEqual(f('2026-01-01'), '신정연휴');
  assert.strictEqual(f('2027-06-03'), '임시');
  assert.strictEqual(f('2027-03-01'), undefined);       // 삭제
  assert.strictEqual(f('2027-05-01'), '근로자의 날');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
