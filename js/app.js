/* 화면: 보기, 수정, 근무조 수정, 이전, 초기화, 저장(엑셀 내려받기), 시트별 출력. 모두 이 기기 안에서만 동작. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const HISTORY_MAX = 100;
  const S = { buf: null, name: '', info: null, y: 0, m: 0, tab: 0, mode: null, edits: {}, ot: {}, stored: false, group: {}, sheets: null };

  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const say = t => { $('msg').textContent = t; };
  const ymKey = (y, m) => `edits:${y}-${String(m).padStart(2, '0')}`;
  const otKey = (y, m) => `ot:${y}-${String(m).padStart(2, '0')}`;   // 시간외근무1·2 칸 직접 수정

  // ---------------------------------------------------------------- 저장소
  async function loadMonth(y, m) {
    const e = await Store.get(ymKey(y, m));
    S.stored = e !== undefined;
    S.edits = Calc.effectiveEdits(S.info, y, m, e);
    S.ot = (await Store.get(otKey(y, m))) || {};
  }
  const saveOt = (y, m, o) => Store.set(otKey(y, m), o);
  const saveEdits = (y, m, e) => Store.set(ymKey(y, m), e);
  async function pushHistory(entry) {
    const h = (await Store.get('history')) || [];
    h.push(entry);
    await Store.set('history', h.slice(-HISTORY_MAX));
  }

  // ---------------------------------------------------------------- 원본 불러오기
  async function useTemplate(buf, name) {
    const info = await Xlsx.readTemplate(buf);   // 양식이 아니면 여기서 오류
    S.buf = buf; S.name = name; S.info = info;
    return info;
  }

  async function pickFile(file) {
    const msg = $('startMsg');
    msg.textContent = '';
    try {
      const buf = await file.arrayBuffer();
      await useTemplate(buf, file.name);
      await Store.set('template', { name: file.name, buf, savedAt: Date.now() });
      await start();
    } catch (e) {
      const t = '근무표 양식 파일이 아닙니다: ' + (e && e.message ? e.message : e);
      msg.textContent = t; say(t);
    }
  }

  // ---------------------------------------------------------------- 그리기
  function tableHtml(widths, rows, idx) {
    let h = `<table class="xl"${idx === 0 ? ' id="sheet"' : ''} style="width:${widths.reduce((a, b) => a + b, 0)}px"><colgroup>`;
    for (const w of widths) h += `<col style="width:${w}px">`;
    h += '</colgroup>';
    for (const row of rows) {
      h += `<tr style="height:${row.h}px">`;
      for (const c of row.cells) {
        const cls = [c.border ? 'bd' : '', c.wrap ? 'wr' : '', c.rs > 1 || c.cs > 1 ? 'mg' : '', c.addr ? 'duty' : '',
          c.gaddr ? 'grp' : '', c.oaddr ? 'ot' : '', c.edited ? 'edited' : ''].filter(Boolean).join(' ');
        const al = ['left', 'center', 'right'].includes(c.al) ? c.al : 'center';
        let st = `vertical-align:${c.va || 'bottom'};font-size:${c.sz}pt;text-align:${al};`;
        if (c.b) st += 'font-weight:bold;';
        if (c.fill) st += `background:${c.fill};`;
        if (c.fc) st += `color:${c.fc};`;
        h += `<td${c.rs > 1 ? ` rowspan="${c.rs}"` : ''}${c.cs > 1 ? ` colspan="${c.cs}"` : ''} class="${cls}"` +
          (c.addr ? ` data-addr="${esc(c.addr)}"` : '') + (c.gaddr ? ` data-gaddr="${esc(c.gaddr)}"` : '') + (c.g ? ` data-g="${c.g}"` : '') +
          (c.oaddr ? ` data-oaddr="${c.oaddr}"` : '') + (c.osum ? ` data-osum="${c.osum}"` : '') +
          ` style="${st}">${esc(c.v)}</td>`;
      }
      h += '</tr>';
    }
    return h + '</table>';
  }

  function render() {
    const r = Calc.allSheets(S.info, S.y, S.m, S.edits, S.group, S.ot);
    S.sheets = r.sheets;
    $('tabs').innerHTML = r.sheets.map((s, i) => `<button data-i="${i}">${esc(s[0])}</button>`).join('');
    $('prints').innerHTML = r.sheets.map((s, i) => `<button data-print="${i}">${esc(s[0] === '시간외근무_통계' ? '통계' : s[0])} 출력</button>`).join('');
    $('pages').innerHTML = r.sheets.map((s, i) => `<section class="page" data-i="${i}"><div class="wrap">${tableHtml(s[1], s[2], i)}</div></section>`).join('');
    $('tabs').querySelectorAll('button').forEach(b => { b.onclick = () => showTab(+b.dataset.i); });
    $('prints').querySelectorAll('button').forEach(b => { b.onclick = () => printSheet(+b.dataset.print); });
    S.dirty = false;
    showTab(Math.min(S.tab, r.sheets.length - 1));
    setMode(S.mode);
    Mine.apply();
    document.title = `${S.y}년 ${S.m}월 근무표`;
  }

  function showTab(i) {
    if (i > 0 && S.dirty) { S.tab = i; render(); return; }   // 근무표·시간외를 고쳤으면 시간외·통계를 다시 계산
    S.tab = i;
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', +b.dataset.i === i));
    document.querySelectorAll('section.page').forEach(p => p.classList.toggle('on', +p.dataset.i === i));
    // [수정]·[초기화]는 근무표와 시간외근무1·2에서, 근무조 수정·내 근무는 근무표에서만
    ['btnEdit', 'btnReset'].forEach(id => { $(id).style.display = i < 3 ? '' : 'none'; });
    ['btnGroup', 'btnMine'].forEach(id => { $(id).style.display = i === 0 ? '' : 'none'; });
    document.body.classList.toggle('on-ot', i === 1 || i === 2);
    if ((i > 0 && S.mode === 'group') || (i >= 3 && S.mode)) setMode(null);
    Store.set('view', { y: S.y, m: S.m, tab: i });
  }

  // ---------------------------------------------------------------- 편집
  function setMode(m) {
    S.mode = m;
    document.body.classList.toggle('edit-duty', m === 'duty');
    document.body.classList.toggle('edit-group', m === 'group');
    $('btnEdit').classList.toggle('on', m === 'duty');
    $('btnGroup').classList.toggle('on', m === 'group');
    $('btnEdit').textContent = m === 'duty' ? '수정 끝' : '수정';
    $('btnGroup').textContent = m === 'group' ? '근무조 수정 끝' : '근무조 수정';
    document.querySelectorAll('td.duty, td.ot').forEach(td => { td.contentEditable = m === 'duty' ? 'true' : 'false'; });
    document.querySelectorAll('td.grp').forEach(td => { td.contentEditable = m === 'group' ? 'true' : 'false'; });
  }
  const editable = el => !!(el && el.classList && ((S.mode === 'duty' && (el.classList.contains('duty') || el.classList.contains('ot'))) ||
                                                   (S.mode === 'group' && el.classList.contains('grp'))));

  async function commit(td) {
    const value = td.innerText.trim();
    if (value === td.dataset.before) return;
    try {
      if (td.classList.contains('grp')) {
        const r = Calc.applyGroupEdit(S.info, S.group, td.dataset.gaddr, value);
        if (JSON.stringify(r.group) !== JSON.stringify(S.group)) {
          await pushHistory({ type: 'group', before: S.group });
          S.group = r.group; await Store.set('group', S.group);
        }
        td.textContent = r.value; td.dataset.before = String(r.value).trim();
        td.classList.toggle('edited', r.edited);
        say('근무조 칸 보관됨');
      } else if (td.classList.contains('ot')) {   // 시간외근무1·2 칸 직접 수정 → 그 사람 계(합계)도 바꿈
        const r = Calc.applyOtEdit(S.info, S.y, S.m, S.edits, S.group, S.ot, td.dataset.oaddr, value);
        if (JSON.stringify(r.ot) !== JSON.stringify(S.ot)) {
          await pushHistory({ type: 'ot', y: S.y, m: S.m, before: S.ot });
          S.ot = r.ot; await saveOt(S.y, S.m, S.ot);
        }
        td.textContent = r.value; td.dataset.before = String(r.value).trim();
        td.classList.toggle('edited', r.edited);
        td.style.background = r.fill || '';
        for (const [a, t] of Object.entries(r.sums)) document.querySelectorAll(`td[data-osum="${a}"]`).forEach(x => { x.textContent = t; });
        say(td.dataset.oaddr.split(':')[2] + '일 시간외 칸 보관됨');
      } else {
        const r = Calc.applyDutyEdit(S.info, S.y, S.m, S.edits, td.dataset.addr, value);
        if (JSON.stringify(r.edits) !== JSON.stringify(S.edits)) {
          await pushHistory({ type: 'duty', y: S.y, m: S.m, before: S.edits });
          S.edits = r.edits; S.stored = true; await saveEdits(S.y, S.m, S.edits);
        }
        td.textContent = r.value; td.dataset.before = r.value;
        td.classList.toggle('edited', r.edited);
        td.style.background = r.fill || '';
        say(td.dataset.addr.split(':')[1] + '일 칸 보관됨');
      }
      Mine.apply();
      S.dirty = true;
    } catch (e) { say('보관 실패: ' + e.message); }
  }

  async function goMonth(y, m) {
    S.y = y; S.m = m;
    $('y').value = String(y); $('m').value = String(m);
    await loadMonth(y, m);
    render();
  }

  async function undo() {
    if (editable(document.activeElement)) await commit(document.activeElement);
    const h = (await Store.get('history')) || [];
    if (!h.length) { say('되돌릴 수정이 없습니다'); return; }
    const e = h.pop();
    await Store.set('history', h);
    if (e.type === 'group') {
      S.group = e.before; await Store.set('group', S.group);
      await goMonth(S.y, S.m);
      say(`근무조 수정을 되돌렸습니다 (남은 단계 ${h.length})`);
    } else if (e.type === 'ot') {
      await saveOt(e.y, e.m, e.before);
      await goMonth(e.y, e.m);
      say(`${e.y}년 ${e.m}월 시간외 수정을 되돌렸습니다 (남은 단계 ${h.length})`);
    } else {   // 'duty', 'month'(초기화: 근무 칸과 시간외 직접 수정 함께)
      await saveEdits(e.y, e.m, e.before);
      if (e.type === 'month') await saveOt(e.y, e.m, e.ot || {});
      await goMonth(e.y, e.m);
      say(`${e.y}년 ${e.m}월 ${e.type === 'month' ? '초기화를' : '근무 수정을'} 되돌렸습니다 (남은 단계 ${h.length})`);
    }
  }

  async function reset() {
    if (!confirm(`${S.m}월 근무를 원래대로 되돌릴까요?\n(이 달에 고친 근무 칸과 시간외 칸이 모두 원래 근무·계산값으로 돌아갑니다. [이전]으로 다시 살릴 수 있습니다.)`)) return;
    const n = Object.keys(S.edits).length + Object.keys(S.ot).length;
    if (n) await pushHistory({ type: 'month', y: S.y, m: S.m, before: S.edits, ot: S.ot });
    await saveEdits(S.y, S.m, {});
    await saveOt(S.y, S.m, {});
    await goMonth(S.y, S.m);
    say(`${S.m}월 근무를 원래대로 되돌렸습니다` + (n ? ` (${n}칸)` : ''));
  }

  // ---------------------------------------------------------------- 저장 (엑셀 내려받기)
  // 안드로이드 앱(APK, Capacitor) 안에서는 내려받기 링크가 동작하지 않아 기기 파일로 쓰고 공유 창을 연다
  const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  async function nativeSave(blob, name) {
    const P = window.Capacitor.Plugins;
    const b64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(r.error);
      r.readAsDataURL(blob);
    });
    let where = '';
    try { await P.Filesystem.writeFile({ path: name, data: b64, directory: 'DOCUMENTS', recursive: true }); where = '문서(Documents) 폴더'; } catch (e) { /* 권한 없음 → 공유로만 */ }
    const w = await P.Filesystem.writeFile({ path: name, data: b64, directory: 'CACHE' });
    try { await P.Share.share({ title: name, dialogTitle: '엑셀 파일 보내기·저장', files: [w.uri] }); } catch (e) { /* 공유 취소 */ }
    return where;
  }

  async function save() {
    if (editable(document.activeElement)) await commit(document.activeElement);
    say('엑셀 파일 만드는 중…');
    try {
      const xlsm = /\.xlsm$/i.test(S.name);
      const blob = await Xlsx.saveWorkbook(S.buf, S.info, S.y, S.m, S.edits, S.group, 'blob', S.ot);
      const name = `근무표_${S.y}년${String(S.m).padStart(2, '0')}월.${xlsm ? 'xlsm' : 'xlsx'}`;
      const type = xlsm ? 'application/vnd.ms-excel.sheet.macroEnabled.12' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      const file = new Blob([blob], { type });
      if (isNative()) {
        const where = await nativeSave(file, name);
        say(`저장됨: ${name}` + (where ? ` (${where})` : ''));
        return;
      }
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      say(`저장됨: ${name} (내려받기 폴더)`);
    } catch (e) { say('저장 실패: ' + e.message); }
  }

  // ---------------------------------------------------------------- 출력 (시트 하나)
  async function printSheet(i) {
    if (isNative()) { say('휴대폰 앱에서는 인쇄가 되지 않습니다. [저장]한 엑셀을 PC에서 인쇄하거나 PC·웹 버전에서 출력하세요.'); return; }
    if (editable(document.activeElement)) await commit(document.activeElement);
    if (S.dirty) { render(); }
    const land = S.sheets[i][3];
    $('pagestyle').textContent = `@page { size: A4 ${land ? 'landscape' : 'portrait'}; margin: 6mm; }`;
    const sec = document.querySelector(`section.page[data-i="${i}"]`);
    document.querySelectorAll('section.page').forEach(p => p.classList.toggle('print-target', p === sec));
    // A4 - 좁은 여백(6mm) 영역(96dpi px)에 한 장으로 맞춤
    const pw = (land ? 285 : 198) * 96 / 25.4, ph = (land ? 198 : 285) * 96 / 25.4;
    const t = sec.querySelector('table.xl');
    const wasOn = sec.classList.contains('on');
    sec.classList.add('on');
    t.style.zoom = 1;
    t.style.zoom = Math.min(1, pw / (t.offsetWidth + 16), ph / (t.offsetHeight + 16)) * 0.98;
    if (!wasOn) sec.classList.remove('on');
    const done = () => { t.style.zoom = ''; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => window.print(), 50);
  }

  // ---------------------------------------------------------------- 시작
  async function start() {
    $('start').hidden = true; $('app').hidden = false;
    S.group = (await Store.get('group')) || {};
    const view = (await Store.get('view')) || {};
    const now = new Date();
    S.tab = view.tab || 0;
    $('tplInfo').textContent = `원본: ${S.name} (이 기기에 보관됨)`;
    await goMonth(view.y || now.getFullYear(), view.m || now.getMonth() + 1);
  }

  async function boot() {
    for (let y = 2020; y <= 2050; y++) $('y').insertAdjacentHTML('beforeend', `<option>${y}</option>`);
    for (let m = 1; m <= 12; m++) $('m').insertAdjacentHTML('beforeend', `<option>${m}</option>`);
    $('y').onchange = $('m').onchange = () => goMonth(+$('y').value, +$('m').value);
    $('btnEdit').onclick = () => setMode(S.mode === 'duty' ? null : 'duty');
    $('btnGroup').onclick = () => setMode(S.mode === 'group' ? null : 'group');
    $('btnUndo').onclick = undo;
    $('btnReset').onclick = reset;
    $('btnSave').onclick = save;
    $('btnReload').onclick = () => $('file').click();
    $('file').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) pickFile(f); };
    const pages = $('pages');
    Mine.init({ button: $('btnMine'), sheet: '#sheet', container: pages, isEditing: () => !!S.mode });
    ZoomView.init($('view'));
    pages.addEventListener('focusout', e => { if (editable(e.target)) commit(e.target); });
    pages.addEventListener('focusin', e => { if (editable(e.target)) e.target.dataset.before = e.target.innerText.trim(); });
    pages.addEventListener('keydown', e => {
      if (!editable(e.target)) return;
      if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
      if (e.key === 'Escape') { e.target.textContent = e.target.dataset.before; e.target.blur(); }
    });
    pages.addEventListener('paste', e => {   // 붙여넣기는 글자만
      if (!editable(e.target)) return;
      e.preventDefault();
      document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text').replace(/\s+/g, ' '));
    });

    try {
      const t = await Store.get('template');
      if (t && t.buf) { await useTemplate(t.buf, t.name); await start(); return; }
    } catch (e) {
      $('startMsg').textContent = '저장된 원본을 읽지 못했습니다. 파일을 다시 골라 주세요. (' + e.message + ')';
    }
    $('start').hidden = false;
  }

  if (!isNative() && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  window.GunmuApp = { S };   // 시험용
  boot();
})();
