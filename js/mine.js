/* 내 근무: 고른 조(번호 n과 짝 글자 CHAR(64+n))의 근무 칸만 굵게·테두리·진한 색으로 강조하고 나머지는 흐리게.
 * 근무표 화면(#sheet)에만 적용되고 인쇄·저장 엑셀에는 영향이 없다. 고른 조는 이 기기(localStorage)에 기억한다.
 * (Flask 앱 templates/_mine.js 와 같은 파일) */
(function (root) {
  'use strict';
  const KEY = 'gunmu.mine';
  const PREFIXES = '건병공연';
  const st = { on: false, g: 0 };
  let opt = null;

  try { Object.assign(st, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* 저장소 없음 */ }
  const keep = () => { try { localStorage.setItem(KEY, JSON.stringify({ on: st.on, g: st.g })); } catch (e) { /* 무시 */ } };

  /** 칸 글자 속 조 표시들: '7/5' → [7,5], 'G/E' → [G,E], '건1/7C' → [1,7,C] */
  function tokens(v) {
    let t = String(v || '').trim().toUpperCase();
    if (t && PREFIXES.includes(t[0])) t = t.slice(1);
    return t.match(/[1-8A-H]/g) || [];
  }
  const groupOf = tok => (/\d/.test(tok) ? +tok : tok.charCodeAt(0) - 64);

  const css = `
@media screen {
  body.mine-on #sheet td.duty:not(.mine) { opacity: .28; }
  body.mine-on #sheet td[data-g]:not(.mine) { opacity: .4; }
  body.mine-on #sheet td.mine { background: #0b3d91 !important; color: #fff !important; font-weight: 900 !important;
    box-shadow: inset 0 0 0 3px #ffc000; position: relative; z-index: 1; }
  body.mine-on #sheet td.mine-day { font-weight: 900 !important; box-shadow: inset 0 0 0 2px #0b3d91; }
  body.mine-on.edit-duty #sheet td.duty:not(.mine), body.mine-on.edit-group #sheet td[data-g]:not(.mine) { opacity: 1; }
  #sheet td.duty, #sheet td[data-g] { cursor: pointer; }
  .mine-hint { margin: 8px 16px 0; padding: 8px 12px; border-radius: 8px; background: #fff7d6; border: 1px solid #e0b830;
    font-size: 14px; color: #333; display: none; }
  body.mine-pick .mine-hint { display: block; }
}
@media screen and (max-width: 700px) {
  body.mine-on #sheet td.mine { box-shadow: inset 0 0 0 2px #ffc000; }
  .mine-hint { font-size: 15px; }
}`;

  function apply() {
    if (!opt) return;
    const on = st.on && st.g >= 1 && st.g <= 8;
    document.body.classList.toggle('mine-on', on);
    document.body.classList.toggle('mine-pick', st.on && !on);
    const t = document.querySelector(opt.sheet);
    if (t) {
      const n = String(st.g), ch = String.fromCharCode(64 + st.g);
      t.querySelectorAll('td.mine, td.mine-day').forEach(td => td.classList.remove('mine', 'mine-day'));
      if (on) {
        t.querySelectorAll('td.duty').forEach(td => {
          const k = tokens(td.textContent);
          if (k.includes(n) || k.includes(ch)) {
            td.classList.add('mine');
            const tr = td.parentElement;   // 그날 일·요일 칸도 굵게
            for (let i = 0; i < 2 && i < tr.cells.length; i++) if (!tr.cells[i].classList.contains('duty')) tr.cells[i].classList.add('mine-day');
          }
        });
        t.querySelectorAll('td[data-g]').forEach(td => { if (+td.dataset.g === st.g) td.classList.add('mine'); });
      }
    }
    const b = opt.button;
    if (b) {
      b.classList.toggle('on', st.on);
      b.textContent = st.on ? (on ? `내 근무 ${st.g}조 ✓` : '내 근무: 조 고르기') : '내 근무';
    }
  }

  function set(on, g) {
    st.on = on;
    if (g !== undefined) st.g = g;
    keep();
    apply();
  }

  function onClick(e) {
    const td = e.target.closest && e.target.closest('td');
    if (!td || (opt.isEditing && opt.isEditing())) return;
    if (td.dataset.g) {   // 근무조(조·이름) 칸: 그 조를 고르고 켬, 같은 조를 다시 누르면 끔
      const g = +td.dataset.g;
      if (st.on && st.g === g) set(false); else set(true, g);
    } else if (td.classList.contains('duty') && st.on) {   // 근무 칸: 켜져 있을 때 앞 조(빗금 앞) 고르기
      const k = tokens(String(td.textContent).split('/')[0]);
      if (k.length) set(true, groupOf(k[0]));
    }
  }

  /** opt: { button, sheet: '#sheet', container, isEditing() } */
  function init(o) {
    opt = o;
    if (!document.getElementById('mine-css')) {
      const s = document.createElement('style');
      s.id = 'mine-css'; s.textContent = css;
      document.head.appendChild(s);
    }
    (o.container || document).addEventListener('click', onClick);
    if (o.button) o.button.addEventListener('click', () => set(!st.on));
    apply();
  }

  root.Mine = { init, apply, state: st, tokens };
})(this);
