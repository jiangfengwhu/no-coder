import { useRef, useState } from 'react';
import { Settings2, X } from 'lucide-react';
import type { QueueView } from '../../../backend/src/control/types';
import { api } from '../api';

export function AdminDialog({ data, onRefresh }: { data: QueueView | null; onRefresh: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [token, setToken] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const active = data?.jobs.find(job => job.id === data.activeId);
  async function action(name: string) {
    setBusy(true); setMessage('');
    try { await api('/api/admin', { action: name, sessionId, confirmRemoteStopped: confirmed }, token); setMessage('操作已完成。'); setError(false); onRefresh(); }
    catch (error) { setMessage((error as Error).message); setError(true); }
    finally { setBusy(false); }
  }
  return <><button className="text-button admin-trigger" onClick={() => dialog.current?.showModal()}><Settings2 size={13} />管理</button><dialog ref={dialog} className="admin-dialog" onClose={() => { setToken(''); setMessage(''); }}><div className="dialog-heading"><h2>调度管理</h2><button aria-label="关闭管理窗口" className="icon-button" onClick={() => dialog.current?.close()}><X size={20} /></button></div><p className="muted">管理密钥只在本次窗口中使用，不会写入浏览器存储。</p><label htmlFor="admin-token">管理密钥</label><input id="admin-token" type="password" value={token} onChange={e => setToken(e.target.value)} autoComplete="off" /><div className="admin-actions"><button className="button secondary" disabled={busy || !token} onClick={() => action(data?.paused ? 'resume' : 'pause')}>{data?.paused ? '恢复调度' : '暂停调度'}</button>{active?.state === 'ready_to_merge' && <button className="button primary" disabled={busy || !token} onClick={() => action('approve_merge')}>批准当前 PR 合并</button>}</div>{active && <details className="recovery"><summary>当前任务恢复工具</summary>{!active.sessionId && <><label htmlFor="session-id">找回的 Jules session ID</label><input id="session-id" value={sessionId} onChange={e => setSessionId(e.target.value)} /><button className="button secondary" disabled={busy || !token || !sessionId} onClick={() => action('attach_session')}>绑定并继续</button></>}<label className="consent"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /><span>我已确认远端 session 停止，且没有待处理的合并或部署。</span></label><button className="button danger" disabled={busy || !token || !confirmed} onClick={() => action('fail_active')}>结束当前任务并继续队列</button></details>}{message && <p role={error ? 'alert' : 'status'} className={error ? 'form-error' : 'form-success'}>{message}</p>}{Boolean(data?.missing.length) && <div className="config-list"><h3>尚待配置</h3><ul>{data?.missing.map(key => <li key={key}><code>{key}</code></li>)}</ul><p className="muted">在 Cloudflare Worker 环境变量中设置；密钥使用 Secret。</p></div>}</dialog></>;
}
