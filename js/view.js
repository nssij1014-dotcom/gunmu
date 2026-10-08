/* 표 확대·축소: Ctrl+마우스 휠(노트북 터치패드 두 손가락 확대 포함), Ctrl + = / - / 0, 휴대폰 두 손가락 확대, 오른쪽 아래 [-][100%][+][맞춤] (10~200%).
 * 표 영역(#view 안의 table.xl)만 확대하고 버튼 줄은 그대로. 배율은 이 기기(localStorage)에 기억. 인쇄·저장 엑셀에는 영향 없음.
 * (Flask 앱 templates/_view.js 와 같은 파일)
 * 틀 고정: 머리 줄(일자·요일, No·날짜·요일)은 세로 스크롤 때, 시간외근무의 "계" 열까지는 가로 스크롤 때 고정. */
(function (root) {
  'use strict';
  const KEY = 'gunmu.zoom', MIN = 0.1, MAX = 2;
  let z = 1, view = null, label = null;
  try { const v = parseFloat(localStorage.getItem(KEY)); if (v) z = Math.min(MAX, Math.max(0.1, v)); } catch (e) { /* 저장소 없음 */ }

  const css = `
#view table.xl { zoom: var(--z, 1); }
.zoombox { position: fixed; right: 18px; bottom: 26px; z-index: 20; display: flex; gap: 3px; padding: 4px;
  background: rgba(31, 78, 121, .92); border-radius: 9px; box-shadow: 0 2px 10px rgba(0, 0, 0, .25); }
.zoombox button { font: inherit; font-size: 15px; font-weight: bold; min-width: 34px; height: 32px; padding: 0 6px;
  border: 0; border-radius: 6px; background: #fff; color: #111; cursor: pointer; }
.zoombox button.pct, .zoombox button.fit { min-width: 60px; font-size: 14px; }
@media screen {
  #view table.xl td.fz-t, #view table.xl td.fz-l { position: sticky; z-index: 2; }
  #view table.xl td.fz-t { top: var(--ft); }
  #view table.xl td.fz-l { left: var(--fl); }
  #view table.xl td.fz-t.fz-l { z-index: 3; }
  /* 고정 칸은 배경이 겹친 테두리를 가리므로 테두리를 그림자로 다시 그림 (x0: 첫 열, y0: 머리 첫 줄) */
  #view table.xl td.bd.fz-t, #view table.xl td.bd.fz-l { box-shadow: inset -1px -1px 0 #000; }
  #view table.xl td.bd.fz-x0 { box-shadow: inset -1px -1px 0 #000, inset 1px 0 0 #000; }
  #view table.xl td.bd.fz-y0 { box-shadow: inset -1px -1px 0 #000, inset 0 1px 0 #000; }
  #view table.xl td.bd.fz-x0.fz-y0 { box-shadow: inset -1px -1px 0 #000, inset 1px 1px 0 #000; }
}
@media print { .zoombox { display: none !important; } #view table.xl { zoom: 1; } }`;

  function set(nz, cx, cy, lo) {
    if (!view) return;
    nz = Math.round(Math.min(MAX, Math.max(lo || MIN, nz)) * 100) / 100;
    const old = z, r = view.getBoundingClientRect();
    const px = cx === undefined ? r.width / 2 : cx - r.left, py = cy === undefined ? r.height / 2 : cy - r.top;
    const sx = (view.scrollLeft + px) / old, sy = (view.scrollTop + py) / old;
    z = nz;
    view.style.setProperty('--z', String(z));
    view.scrollLeft = sx * z - px;   // 손가락·마우스 아래 칸이 그 자리에 있도록
    view.scrollTop = sy * z - py;
    if (label) label.textContent = Math.round(z * 100) + '%';
    try { localStorage.setItem(KEY, String(z)); } catch (e) { /* 무시 */ }
  }

  /** 지금 보이는 표 전체 너비가 화면 너비에 딱 맞는 배율 */
  function fit() {
    if (!view) return;
    const t = [...view.querySelectorAll('table.xl')].find(x => x.offsetParent !== null);
    if (!t) return;
    const natural = t.getBoundingClientRect().width / z;   // 100%일 때 너비
    const avail = view.clientWidth - 24;
    if (natural > 0) { set(Math.floor(avail / natural * 100) / 100); view.scrollLeft = 0; }
  }

  /** 틀 고정: '일자' 또는 'No' 칸이 있는 머리 줄부터 첫 자료 줄 전까지는 위에, '계' 열까지는 왼쪽에 고정 (화면에서만) */
  function freeze(t) {
    if (t.dataset.fz) return;
    t.dataset.fz = '1';
    const widths = [...t.querySelectorAll('col')].map(c => parseFloat(c.style.width) || 0);
    const rows = [...t.rows], busy = [], pos = new Map();   // 칸마다 [시작 열]
    rows.forEach((r, ri) => {
      let col = 0;
      [...r.cells].forEach(c => {
        while (busy[ri] && busy[ri][col]) col++;
        pos.set(c, col);
        for (let i = 0; i < c.rowSpan; i++) for (let j = 0; j < c.colSpan; j++) (busy[ri + i] = busy[ri + i] || [])[col + j] = 1;
        col += c.colSpan;
      });
    });
    const txt = c => c.textContent.replace(/\s+/g, '');
    const h0 = rows.findIndex(r => [...r.cells].some(c => txt(c) === '일자' || txt(c) === 'No'));
    if (h0 < 0) return;
    const h1 = Math.max(...[...rows[h0].cells].map(c => h0 + c.rowSpan));   // 첫 자료 줄
    const gye = [...rows[h0].cells].find(x => txt(x) === "계");
    const k = gye ? pos.get(gye) + gye.colSpan : 0;   // 왼쪽 고정 열 수
    const lefts = [0];
    widths.forEach((w, i) => { lefts[i + 1] = lefts[i] + w; });
    const tops = {};
    let y = 0;
    for (let ri = h0; ri < h1; ri++) { tops[ri] = y; y += parseFloat(rows[ri].style.height) || rows[ri].offsetHeight; }
    rows.forEach((r, ri) => {
      if (ri < h0) return;
      [...r.cells].forEach(c => {
        const col = pos.get(c);
        const top = ri < h1, left = col + c.colSpan <= k;
        if (!top && !left) return;
        if (top) { c.classList.add('fz-t'); c.style.setProperty('--ft', tops[ri] + 'px'); }
        // 왼쪽 고정은 1px 더 왼쪽에 붙여 지나가는 칸이 틈으로 비치지 않게
        if (left) { c.classList.add('fz-l'); c.style.setProperty('--fl', (lefts[col] - 1) + 'px'); }
        if (col === 0) c.classList.add('fz-x0');
        if (ri === h0) c.classList.add('fz-y0');
        if (!c.style.background) c.style.background = '#fff';
      });
    });
  }
  const freezeAll = () => view && view.querySelectorAll('table.xl').forEach(freeze);

  const dist = e => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  const mid = e => ({ x: (e.touches[0].clientX + e.touches[1].clientX) / 2, y: (e.touches[0].clientY + e.touches[1].clientY) / 2 });

  function init(v) {
    view = v;
    if (!document.getElementById('view-css')) {
      const s = document.createElement('style');
      s.id = 'view-css'; s.textContent = css;
      document.head.appendChild(s);
    }
    const box = document.createElement('div');
    box.className = 'zoombox';
    box.innerHTML = '<button type="button" title="축소 (Ctrl+휠 아래)">−</button><button type="button" class="pct" title="100%로">100%</button><button type="button" title="확대 (Ctrl+휠 위)">+</button><button type="button" class="fit" title="표 너비를 화면에 맞춤">맞춤</button>';
    const [minus, pct, plus, fitBtn] = box.querySelectorAll('button');
    fitBtn.onclick = fit;
    minus.onclick = () => set(z / 1.1);
    plus.onclick = () => set(z * 1.1);
    pct.onclick = () => set(1);
    label = pct;
    document.body.appendChild(box);

    v.addEventListener('wheel', e => {
      if (!e.ctrlKey) return;
      e.preventDefault();   // 창 전체 확대 대신 표만
      set(z * Math.pow(1.1, -Math.sign(e.deltaY) * Math.min(3, Math.max(1, Math.abs(e.deltaY) / 100))), e.clientX, e.clientY);
    }, { passive: false });
    document.addEventListener('keydown', e => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (e.key === '=' || e.key === '+') { e.preventDefault(); set(z * 1.1); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); set(z / 1.1); }
      else if (e.key === '0') { e.preventDefault(); set(1); }
    });

    // 휴대폰: 두 손가락으로 표 확대·축소
    let d0 = 0, z0 = 1;
    v.addEventListener('touchstart', e => { if (e.touches.length === 2) { d0 = dist(e); z0 = z; } }, { passive: true });
    v.addEventListener('touchmove', e => {
      if (e.touches.length !== 2 || !d0) return;
      e.preventDefault();
      const c = mid(e);
      set(z0 * dist(e) / d0, c.x, c.y);
    }, { passive: false });
    v.addEventListener('touchend', e => { if (e.touches.length < 2) d0 = 0; });
    document.addEventListener('gesturestart', e => e.preventDefault());   // 아이폰 사파리 화면 전체 확대 막기

    freezeAll();
    new MutationObserver(ms => { if (ms.some(m => [...m.addedNodes].some(n => n.querySelector && (n.matches('table.xl') || n.querySelector('table.xl'))))) freezeAll(); })
      .observe(v, { childList: true, subtree: true });   // 웹 앱은 달을 바꿀 때 표를 새로 그림

    view.style.setProperty('--z', String(z));
    label.textContent = Math.round(z * 100) + '%';
  }

  root.ZoomView = { init, set, fit, freeze: freezeAll, get: () => z };
})(this);
