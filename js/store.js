/* 브라우저 안 저장소(IndexedDB): 원본 엑셀, 달별 수정, 근무조 수정, 되돌리기 기록. 인터넷으로 보내지 않는다. */
(function (root) {
  'use strict';
  const DB = 'gunmu', STORE = 'kv';
  let dbp = null;
  function db() {
    if (!dbp) {
      dbp = new Promise((res, rej) => {
        const r = indexedDB.open(DB, 1);
        r.onupgradeneeded = () => r.result.createObjectStore(STORE);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    }
    return dbp;
  }
  async function tx(mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction(STORE, mode), s = t.objectStore(STORE);
      const req = fn(s);
      t.oncomplete = () => res(req ? req.result : undefined);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  }
  const Store = {
    get: k => tx('readonly', s => s.get(k)),
    set: (k, v) => tx('readwrite', s => s.put(v, k)),
    del: k => tx('readwrite', s => s.delete(k)),
  };
  // 기기가 저장 공간을 정리할 때 지우지 않도록 요청 (지원하는 브라우저만)
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* 무시 */ }
  root.Store = Store;
})(this);
