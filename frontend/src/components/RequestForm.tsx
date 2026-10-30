import { useRef, useState } from 'react';
import { Check, LoaderCircle } from 'lucide-react';
import { api } from '../api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function RequestForm({ inviteRequired, onSubmitted }: { inviteRequired: boolean; onSubmitted: (id: string) => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [acceptance, setAcceptance] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  const lastPayload = useRef('');

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !consent) return;
    setBusy(true); setError(''); setSuccess(false);
    const payload = JSON.stringify({ title: title.trim(), description: description.trim(), acceptance: acceptance.trim() });
    if (lastPayload.current && lastPayload.current !== payload) requestId.current = crypto.randomUUID();
    lastPayload.current = payload;
    try {
      const result = await api<{ id: string }>('/api/requests', { title, description, acceptance, inviteCode, requestId: requestId.current });
      setTitle(''); setDescription(''); setAcceptance(''); setConsent(false); setSuccess(true);
      requestId.current = crypto.randomUUID(); lastPayload.current = '';
      onSubmitted(result.id);
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }

  return <Card id="submit" className="gap-5 shadow-none" aria-labelledby="submit-title">
    <CardHeader><CardTitle id="submit-title" className="text-base">提交需求</CardTitle><CardDescription className="leading-6">描述使用场景和预期结果，提交后加入队列。</CardDescription></CardHeader>
    <CardContent><form onSubmit={submit} className="space-y-5">
      <div className="space-y-2"><Label htmlFor="title">需求标题 <span aria-hidden="true" className="text-muted-foreground">*</span></Label><Input id="title" name="title" value={title} onChange={e => { setTitle(e.target.value); setSuccess(false); }} placeholder="例如：增加公共留言板" required minLength={2} maxLength={100} /></div>
      <div className="space-y-2"><div className="flex items-center justify-between gap-2"><Label htmlFor="description">需求描述 <span aria-hidden="true" className="text-muted-foreground">*</span></Label><span className="text-xs tabular-nums text-muted-foreground">{description.length}/6000</span></div><Textarea id="description" name="description" value={description} onChange={e => setDescription(e.target.value)} placeholder="谁会使用？需要哪些功能？" required minLength={10} maxLength={6000} rows={5} className="min-h-32 leading-6" /></div>
      <div className="space-y-2"><Label htmlFor="acceptance">验收条件 <span className="font-normal text-muted-foreground">选填</span></Label><Textarea id="acceptance" name="acceptance" value={acceptance} onChange={e => setAcceptance(e.target.value)} placeholder="例如：可以发布留言，刷新后仍然保留。" maxLength={2000} rows={2} className="leading-6" /></div>
      {inviteRequired && <div className="space-y-2"><Label htmlFor="invite">邀请码</Label><Input id="invite" type="password" value={inviteCode} onChange={e => setInviteCode(e.target.value)} required autoComplete="off" /></div>}
      <div className="flex items-start gap-2.5"><Checkbox id="consent" checked={consent} onCheckedChange={value => setConsent(value === true)} required className="mt-1" /><Label htmlFor="consent" className="block text-xs leading-5 font-normal text-muted-foreground">我理解需求内容会公开，更新会影响所有使用者。请勿填写密码或个人隐私。</Label></div>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      {success && <p className="flex items-center gap-2 text-sm" role="status"><Check className="size-4" />已加入队列，可在需求列表查看。</p>}
      <Button className="w-full" type="submit" disabled={busy || !consent}>{busy && <LoaderCircle className="animate-spin" />}{busy ? '正在提交' : '提交需求'}</Button>
    </form></CardContent>
  </Card>;
}
