// WebSocket client for the LAN relay server (server/lan-server.js): the first browser to connect to a
// server takes seat 1 (the host), the second seat 2. Messages are JSON objects relayed to the other
// seat as they are. Browser only; the sync layer (sync.js) does not know about this file.

export function createSocket({ onMessage, onStatus } = {}) {
  const here = typeof location !== 'undefined' ? `${location.protocol}//${location.host}` : '';
  const state = {
    status: 'idle',          // idle | connecting | online | full | closed | error
    seat: 0,                 // 1 = host, 2 = guest
    peer: false,             // the other seat is taken
    addrs: [],               // the server's LAN addresses (from hello)
    base: '',                // the server we are connected to ('' = this page's own)
  };
  let ws = null;
  const supported = /^https?:$/.test(typeof location !== 'undefined' ? location.protocol : '') && typeof WebSocket !== 'undefined';
  const status = (s) => { state.status = s; if (onStatus) onStatus(s); };

  return {
    state, supported,
    get connected() { return !!ws && ws.readyState === 1; },
    get open() { return !!ws; },
    get isHost() { return state.seat === 1; },
    // Addresses the other computer can open: the server's LAN addresses, or this page's own address.
    links(pathname = '/') {
      const local = typeof location !== 'undefined' && /^(localhost|127\.|\[::1\])/.test(location.hostname);
      const list = state.addrs.slice();
      if (!local && here && !list.includes(here)) list.unshift(here);
      return (list.length ? list : [here]).map((u) => u.replace(/\/+$/, '') + pathname);
    },
    // base: another server such as http://192.168.1.20:8080, or '' for this page's own server.
    connect(base = '') {
      if (ws || !supported) return;
      state.base = base;
      const url = base ? `${base.replace(/^http/, 'ws').replace(/\/+$/, '')}/ws` : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
      let sock;
      try { sock = new WebSocket(url); } catch (e) { status('error'); return; }
      ws = sock;
      status('connecting');
      sock.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.t === 'hello') { state.seat = m.player; state.peer = !!m.peer; state.addrs = m.addrs || []; status('online'); }
        else if (m.t === 'peer') { state.peer = !!m.on; if (onStatus) onStatus(state.status); }
        else if (m.t === 'full') status('full');
        if (onMessage) onMessage(m);
      };
      sock.onerror = () => { if (state.status === 'connecting') status('error'); };
      sock.onclose = () => {
        if (ws !== sock) return;
        ws = null;
        state.peer = false; state.seat = 0;
        if (state.status !== 'full') status(state.status === 'connecting' || state.status === 'error' ? 'error' : 'closed');
        if (onMessage) onMessage({ t: 'closed' });
      };
    },
    send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); },
    close() {
      const sock = ws;
      ws = null;
      state.peer = false; state.seat = 0;
      status('idle');
      if (sock) try { sock.close(); } catch (e) { /* already closed */ }
    },
  };
}
