import { useRef, useState } from 'react';
import { ArrowUpRight, Check, Lightbulb, LoaderCircle } from 'lucide-react';
import { api } from '../api';

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
    if (busy) return;
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

  return <section className="request-panel" id="submit" aria-labelledby="submit-title">
    <div className="panel-heading"><span className="eyebrow">YOUR NEXT IDEA</span><Lightbulb size={19} aria-hidden="true" /></div>
    <h2 id="submit-title">你希望它能做什么？</h2>
    <p className="muted form-intro">把想法写下来，Jules 会按顺序实现。</p>
    <form onSubmit={submit}>
      <label htmlFor="title">一句话描述你的想法 <span>*</span></label>
      <input id="title" name="title" value={title} onChange={e => { setTitle(e.target.value); setSuccess(false); }} placeholder="例如：做一个大家都能编辑的留言板" required minLength={2} maxLength={100} />
      <div className="label-row"><label htmlFor="description">具体说说 <span>*</span></label><span className="character-count">{description.length} / 6000</span></div>
      <textarea id="description" name="description" value={description} onChange={e => setDescription(e.target.value)} placeholder="它解决什么问题？你想怎样使用它？描述越具体，越容易实现。" required minLength={10} maxLength={6000} rows={5} />
      <label htmlFor="acceptance">怎样算做好了？ <span className="optional">选填</span></label>
      <textarea id="acceptance" name="acceptance" value={acceptance} onChange={e => setAcceptance(e.target.value)} placeholder="例如：能发布留言，刷新以后内容还在。" maxLength={2000} rows={2} />
      {inviteRequired && <><label htmlFor="invite">邀请码 <span>*</span></label><input id="invite" type="password" value={inviteCode} onChange={e => setInviteCode(e.target.value)} required autoComplete="off" /></>}
      <label className="consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} required /><span>我理解需求内容会公开，更新会影响所有使用者。请勿填写密码或个人隐私。</span></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      {success && <p className="form-success" role="status"><Check size={16} />已加入队列。你可以在左侧查看进度。</p>}
      <button className="button primary submit-button" type="submit" disabled={busy || !consent}>{busy ? '正在加入队列' : '提交想法，加入队列'}{busy ? <LoaderCircle className="spin" size={18} /> : <ArrowUpRight size={18} />}</button>
      <p className="form-footnote">按提交顺序处理 · 同时只实现一个需求</p>
    </form>
  </section>;
}
