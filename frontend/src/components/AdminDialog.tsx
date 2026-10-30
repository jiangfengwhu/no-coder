import { useState } from 'react';
import { Settings2 } from 'lucide-react';
import type { QueueView } from '../../../backend/src/control/types';
import { api } from '../api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

export function AdminDialog({ data, onRefresh }: { data: QueueView | null; onRefresh: () => void }) {
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
  return <Dialog onOpenChange={open => { if (!open) { setToken(''); setMessage(''); setConfirmed(false); } }}>
    <DialogTrigger asChild><Button variant="ghost" size="sm" className="h-7 px-1 text-xs text-muted-foreground"><Settings2 />管理</Button></DialogTrigger>
    <DialogContent className="max-h-[85dvh] overflow-y-auto"><DialogHeader><DialogTitle>调度管理</DialogTitle><DialogDescription>管理密钥仅在当前窗口使用，不写入浏览器存储。</DialogDescription></DialogHeader>
      <div className="space-y-2"><Label htmlFor="admin-token">管理密钥</Label><Input id="admin-token" type="password" value={token} onChange={e => setToken(e.target.value)} autoComplete="off" /></div>
      <div className="flex flex-wrap gap-3"><Button variant="outline" disabled={busy || !token} onClick={() => action(data?.paused ? 'resume' : 'pause')}>{data?.paused ? '恢复调度' : '暂停调度'}</Button>{active?.state === 'ready_to_merge' && <Button disabled={busy || !token} onClick={() => action('approve_merge')}>批准合并</Button>}</div>
      {active && <Accordion type="single" collapsible><AccordionItem value="recovery"><AccordionTrigger>当前任务恢复工具</AccordionTrigger><AccordionContent className="space-y-4">{!active.sessionId && <div className="space-y-2"><Label htmlFor="session-id">Jules session ID</Label><Input id="session-id" value={sessionId} onChange={e => setSessionId(e.target.value)} /><Button variant="outline" disabled={busy || !token || !sessionId} onClick={() => action('attach_session')}>绑定并继续</Button></div>}<div className="flex items-start gap-2"><Checkbox id="remote-confirm" checked={confirmed} onCheckedChange={checked => setConfirmed(checked === true)} className="mt-1" /><Label htmlFor="remote-confirm" className="block text-xs leading-6 font-normal">我已确认远端会话停止，线上与主分支一致，且没有待处理的合并或部署。</Label></div><Button variant="destructive" disabled={busy || !token || !confirmed} onClick={() => action('fail_active')}>结束当前任务并继续队列</Button></AccordionContent></AccordionItem></Accordion>}
      {message && <p role={error ? 'alert' : 'status'} className={`text-sm ${error ? 'text-destructive' : 'text-foreground'}`}>{message}</p>}
      {Boolean(data?.missing.length) && <section className="border-t pt-4"><h3 className="text-sm font-medium">尚待配置</h3><ul className="mt-2 space-y-1 font-mono text-xs text-muted-foreground">{data?.missing.map(key => <li key={key}>{key}</li>)}</ul><p className="mt-3 text-xs leading-6 text-muted-foreground">在 Cloudflare Worker 中设置环境变量，密钥使用 Secret。</p></section>}
    </DialogContent>
  </Dialog>;
}
