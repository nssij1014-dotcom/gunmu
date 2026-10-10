// 근무표 2 Windows 프로그램: 웹 앱(app/index.html)을 창에 담아 연다. 인터넷 없이 동작.
const { app, BrowserWindow, ipcMain, net, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const ICS = 'https://calendar.google.com/calendar/ical/ko.south_korea%23holiday%40group.v.calendar.google.com/public/basic.ics';
const SMOKE = !!process.env.GM_SMOKE;

if (!SMOKE && !app.requestSingleInstanceLock()) app.quit();

let win;
function createWindow() {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1360, height: 900, minWidth: 900, minHeight: 600,
    title: '순찰 근무표 2', backgroundColor: '#f3f5f2', show: !SMOKE,
    icon: path.join(__dirname, 'app', 'icons', 'icon-512.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, 'app', 'index.html'));
  // 바깥 주소는 브라우저로 연다 (앱 창은 항상 앱 파일만 보여 줌)
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) e.preventDefault(); });
  if (SMOKE) smoke();
}

// 공휴일 목록은 구글 캘린더 주소 하나만 앱 쪽 요청으로 받아 준다 (브라우저 보안 제약 없이)
ipcMain.handle('gm-fetch-holidays', async () => {
  const r = await net.fetch(ICS);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return await r.text();
});

// 설치 후 자동 점검: 창이 뜨고 앱이 그려지는지만 확인하고 종료한다
function smoke() {
  const out = (m) => { console.log(m); if (process.env.GM_SMOKE_OUT) fs.writeFileSync(process.env.GM_SMOKE_OUT, m + '\n'); };
  const fail = (m) => { out('SMOKE FAIL: ' + m); app.exit(1); };
  const t = setTimeout(() => fail('timeout'), 60000);
  win.webContents.on('did-fail-load', (e, c, d) => fail('load ' + d));
  win.webContents.on('did-finish-load', async () => {
    try {
      const r = await win.webContents.executeJavaScript(`JSON.stringify({
        title: document.title, hasGM: typeof GM === 'object' && typeof HOLIDAYS_BASE === 'object',
        wizard: !!document.querySelector('#patgrid'), gmFetch: typeof window.gmFetchHolidays })`);
      const o = JSON.parse(r);
      out('SMOKE ' + r);
      clearTimeout(t);
      app.exit(o.title === '순찰 근무표 2' && o.hasGM && o.wizard && o.gmFetch === 'function' ? 0 : 1);
    } catch (e) { fail(String(e)); }
  });
}

app.whenReady().then(createWindow);
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());
