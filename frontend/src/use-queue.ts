import { useCallback, useEffect, useRef, useState } from 'react';
import type { QueueView } from '../../backend/src/control/types';
import { loadQueue } from './api';

export function useQueue() {
  const [data, setData] = useState<QueueView | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [connection, setConnection] = useState('连接中');
  const socketRef = useRef<WebSocket | null>(null);
  const requesting = useRef(false);

  const refresh = useCallback(async () => {
    if (requesting.current) return;
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) { socket.send('refresh'); return; }
    requesting.current = true;
    setLoading(true);
    try { setData(await loadQueue()); setError(''); }
    catch (error) { setError((error as Error).message); }
    finally { setLoading(false); requesting.current = false; }
  }, []);

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let attempts = 0;
    let waitingForPong = false;

    function disconnect() {
      clearTimeout(retryTimer);
      clearInterval(heartbeat);
      const previous = socket;
      socket = null;
      socketRef.current = null;
      if (previous) { previous.onclose = null; previous.onmessage = null; previous.onerror = null; previous.onopen = null; previous.close(); }
    }

    function retry() {
      if (disposed || document.hidden || !navigator.onLine || retryTimer) return;
      const delay = Math.min(60_000, 1000 * 2 ** Math.min(attempts++, 6)) * (1 + Math.random() * .25);
      retryTimer = setTimeout(() => { retryTimer = undefined; connect(); }, delay);
    }

    function connect() {
      if (disposed || document.hidden || !navigator.onLine || socket) return;
      clearTimeout(retryTimer); retryTimer = undefined;
      const url = new URL('/api/queue/live', location.href);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      setConnection(attempts ? '正在重连' : '连接中');
      const current = new WebSocket(url);
      socket = current; socketRef.current = current;
      current.onopen = () => {
        if (disposed || socket !== current) return;
        attempts = 0; waitingForPong = false; setConnection('实时推送'); setError('');
        // This is a WebSocket keepalive, not an HTTP poll. The DO runtime auto-responds without waking JS.
        heartbeat = setInterval(() => {
          if (current.readyState !== WebSocket.OPEN) return;
          if (waitingForPong) { current.close(); return; }
          waitingForPong = true; current.send('ping');
        }, 60_000);
      };
      current.onmessage = event => {
        if (disposed || socket !== current) return;
        if (event.data === 'pong') { waitingForPong = false; return; }
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'queue' && Array.isArray(message.data?.jobs)) {
            setData(message.data); setLoading(false); setError('');
          }
        } catch { /* Ignore an unsupported message; snapshots remain intact. */ }
      };
      current.onerror = () => { current.close(); };
      current.onclose = () => {
        if (socket !== current || disposed) return;
        clearInterval(heartbeat); socket = null; socketRef.current = null;
        setLoading(false); setConnection(navigator.onLine ? '正在重连' : '网络离线');
        retry();
      };
    }

    const visibility = () => {
      if (document.hidden) { disconnect(); setConnection('页面已挂起'); }
      else { attempts = 0; connect(); }
    };
    const online = () => { attempts = 0; connect(); };
    const offline = () => { disconnect(); setConnection('网络离线'); setLoading(false); };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    // One initial HTTP read establishes the HttpOnly visitor cookie before the socket handshake.
    void loadQueue().then(snapshot => { if (!disposed) { setData(snapshot); setError(''); } })
      .catch(error => { if (!disposed) setError((error as Error).message); })
      .finally(() => { if (!disposed) { setLoading(false); connect(); } });
    return () => {
      disposed = true; disconnect();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, []);

  return { data, error, loading, connection, refresh };
}
