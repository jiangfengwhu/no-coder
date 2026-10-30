import { useState } from 'react';
import { ArrowUpRight, Check, ChevronDown, Clock3, MessageSquare, Terminal, X } from 'lucide-react';
import type { JobState, PublicJob, QueueView } from '../../../backend/src/control/types';
import { api } from '../api';

export const labels: Record<JobState, string> = {
  queued: '排队中', creating: '正在连接', running: '正在实现', needs_input: '等待补充', checking: '正在验证',
  ready_to_merge: '等待合并', merging: '正在合并', deploying: '正在部署', completed: '已发布', failed: '未完成', blocked: '需要处理',
};
const date = (value: string) => new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));

function Feedback({ job, onRefresh }: { job: PublicJob; onRefresh: () => void }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <form className="feedback-form" onSubmit={async event => {
    event.preventDefault(); setBusy(true); setError('');
    try { await api(`/api/requests/${job.id}/feedback`, { message }); setMessage(''); onRefresh(); }
    catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }}>
    <label htmlFor={`feedback-${job.id}`}>补充说明</label>
    <textarea id={`feedback-${job.id}`} value={message} onChange={e => setMessage(e.target.value)} required maxLength={6000} rows={3} />
    {error && <p role="alert" className="form-error">{error}</p>}
    <button className="button small primary" disabled={busy}>{busy ? '发送中…' : '发送给 Jules'}<MessageSquare size={14} /></button>
  </form>;
}

function JobRow({ job, expanded, onToggle, onRefresh }: { job: PublicJob; expanded: boolean; onToggle: () => void; onRefresh: () => void }) {
  return <li className={`job-row ${expanded ? 'expanded' : ''}`}>
    <button className="job-summary" onClick={onToggle} aria-expanded={expanded} aria-controls={`detail-${job.id}`}>
      <span className="job-number">{String(job.number).padStart(3, '0')}</span>
      <span className="job-summary-text"><strong>{job.title}</strong><span>{date(job.createdAt)}{job.mine && ' · 你提交的需求'}</span></span>
      <span className={`badge ${job.state}`}><span className="status-dot" />{labels[job.state]}</span>
      <ChevronDown className="chevron" size={16} />
    </button>
    {expanded && <div className="job-detail" id={`detail-${job.id}`}>
      <p className="pre-wrap">{job.description}</p>
      {job.acceptance && <p className="muted pre-wrap">验收期望：{job.acceptance}</p>}
      {job.position !== null && <p className="muted">等待队列第 {job.position} 位，前面还有 {job.position - 1} 条待启动需求{job.position === 1 ? '，当前任务结束后轮到你' : ''}。</p>}
      {job.message && <p className="job-message">{job.message}</p>}
      {job.lastAgentMessage && <blockquote><strong>Jules 的消息</strong><p className="pre-wrap">{job.lastAgentMessage}</p></blockquote>}
      <div className="job-links">{job.sessionUrl && <a href={job.sessionUrl} target="_blank" rel="noreferrer">Jules session <ArrowUpRight size={13} /></a>}{job.prUrl && <a href={job.prUrl} target="_blank" rel="noreferrer">查看代码变更 <ArrowUpRight size={13} /></a>}</div>
      {job.events.length > 0 && <details><summary>处理记录</summary><ol className="events">{job.events.map((event, index) => <li key={index}><time>{date(event.at)}</time><span>{event.text}</span></li>)}</ol></details>}
      {job.state === 'needs_input' && job.mine && <Feedback job={job} onRefresh={onRefresh} />}
    </div>}
  </li>;
}

export function TaskBoard({ data, loading, error, onRefresh, historyOnly = false }: { data: QueueView | null; loading: boolean; error: string; onRefresh: () => void; historyOnly?: boolean }) {
  const [filter, setFilter] = useState<'all' | 'waiting' | 'finished'>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const active = data?.jobs.find(job => job.id === data.activeId);
  const waiting = data?.jobs.filter(job => job.state === 'queued') ?? [];
  const finished = data?.jobs.filter(job => ['completed', 'failed'].includes(job.state)) ?? [];
  const filtered = (historyOnly ? finished : filter === 'waiting' ? waiting : filter === 'finished' ? finished : data?.jobs ?? []).slice().sort((a, b) => {
    if (historyOnly || filter === 'finished') return b.number - a.number;
    if (a.id === data?.activeId) return -1;
    if (b.id === data?.activeId) return 1;
    return a.number - b.number;
  });
  return <section className="board" aria-labelledby="board-title">
    {!historyOnly && <div className={`active-card ${active ? 'has-active' : ''}`}>
      <div className="active-top"><span className="eyebrow"><span className="status-dot" />{active ? 'CURRENT SESSION' : 'NEXT SESSION'}</span><span className="mono">01 / 01</span></div>
      {active ? <><h2>{active.title}</h2><p>{active.message || labels[active.state]}</p><div className="active-bottom"><span className="active-state">{labels[active.state]}</span>{active.sessionUrl && <a href={active.sessionUrl} target="_blank" rel="noreferrer">查看 Jules <ArrowUpRight size={15} /></a>}</div></> : <><div className="empty-symbol" aria-hidden="true"><Terminal size={26} strokeWidth={1.4} /></div><h2>{waiting.length ? '想法已经就位' : '等待第一个想法'}</h2><p>{waiting.length ? data?.paused ? '调度已暂停，队列会保留。' : !data?.configured ? '连接 Jules 后，会从第一条需求开始。' : '调度器即将启动下一条需求。' : '还没有正在进行的任务。你的一句话，可能就是它的起点。'}</p><span className="active-caption">一个想法，一个 session，一次更新。</span></>}
    </div>}
    <div className="board-heading"><div><span className="eyebrow">{historyOnly ? 'CHANGELOG' : 'REQUEST QUEUE'}</span><h2 id="board-title">{historyOnly ? '实验记录' : '需求队列'} <span className="count">{historyOnly ? finished.length : data?.total ?? 0}</span></h2></div><button className="text-button" onClick={onRefresh} disabled={loading}>刷新 ↻</button></div>
    {!historyOnly && <div className="filter-bar" aria-label="筛选需求">{([['all', '全部需求'], ['waiting', `排队中 ${waiting.length}`], ['finished', '已结束']] as const).map(([value, label]) => <button key={value} onClick={() => setFilter(value)} aria-pressed={filter === value} className={filter === value ? 'selected' : ''}>{label}</button>)}<span className="queue-policy"><Clock3 size={13} />先来先处理</span></div>}
    {error && <div className="inline-error" role="alert">{error}<button onClick={onRefresh}>重试</button></div>}
    {loading && !data ? <div className="skeleton" role="status" aria-label="正在加载队列" /> : filtered.length ? <ul className="job-list">{filtered.map(job => <JobRow key={job.id} job={job} expanded={expanded === job.id} onToggle={() => setExpanded(expanded === job.id ? null : job.id)} onRefresh={onRefresh} />)}</ul> : <div className="empty-list"><span className="empty-list-icon">{historyOnly ? <Check size={21} /> : <MessageSquare size={21} />}</span><h3>{historyOnly ? '每一次更新，都会留在这里' : filter === 'waiting' ? '目前没有排队需求' : filter === 'finished' ? '还没有结束的任务' : '这里还空着，等你来添一笔'}</h3><p>{historyOnly ? '发布成功或未能完成的任务都会记录，方便一起观察实验。' : '写下你想要的功能，提交后就能在这里追踪进展。'}</p>{!historyOnly && <a href="#submit" className="text-link">提交一个想法 <ArrowUpRight size={14} /></a>}</div>}
    <div className="queue-note"><span>队列状态每 10 秒同步</span><span><span className="tiny-dot" />{error ? '连接中断' : data ? '已同步' : '连接中'}</span></div>
    {!historyOnly && <div className="experiment-note"><span className="note-mark">↳</span><p><strong>这里会变成什么，由大家决定。</strong><br />新的需求会接着已有的版本继续实现。每次发布，都是这个应用的一次生长。</p></div>}
  </section>;
}
