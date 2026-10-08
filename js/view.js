/* 표 확대·축소: Ctrl+마우스 휠(노트북 터치패드 두 손가락 확대 포함), Ctrl + = / - / 0, 휴대폰 두 손가락 확대, 오른쪽 아래 [-][100%][+][맞춤] (10~200%).
 * 표 영역(#view 안의 table.xl)만 확대하고 버튼 줄은 그대로. 배율은 이 기기(localStorage)에 기억. 인쇄·저장 엑셀에는 영향 없음.
 * (Flask 앱 templates/_view.js 와 같은 파일) */
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

    view.style.setProperty('--z', String(z));
    label.textContent = Math.round(z * 100) + '%';
  }

  root.ZoomView = { init, set, fit, get: () => z };
})(this);
