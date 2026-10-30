import { useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import type { JobState, PublicJob, QueueView } from '../../../backend/src/control/types';
import { api } from '../api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';

export const labels: Record<JobState, string> = {
  queued: '排队中', creating: '正在连接', running: '正在实现', needs_input: '等待补充', checking: '正在验证',
  ready_to_merge: '等待合并', merging: '正在合并', deploying: '正在部署', completed: '已发布', failed: '未完成', blocked: '需要处理',
};
const date = (value: string) => new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));

function Feedback({ job, onRefresh }: { job: PublicJob; onRefresh: () => void }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <form className="mt-5 space-y-3 border-t pt-5" onSubmit={async event => {
    event.preventDefault(); setBusy(true); setError('');
    try { await api(`/api/requests/${job.id}/feedback`, { message }); setMessage(''); onRefresh(); }
    catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }}>
    <Label htmlFor={`feedback-${job.id}`}>补充说明</Label>
    <Textarea id={`feedback-${job.id}`} value={message} onChange={e => setMessage(e.target.value)} required maxLength={6000} rows={3} />
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button size="sm" disabled={busy}>{busy ? '发送中' : '发送给 Jules'}</Button>
  </form>;
}

function JobRow({ job, onRefresh }: { job: PublicJob; onRefresh: () => void }) {
  return <AccordionItem value={job.id} className="last:border-b-0">
    <AccordionTrigger className="items-center gap-3 px-5 py-4 hover:bg-muted/40 hover:no-underline sm:px-6">
      <div className="flex min-w-0 flex-1 items-start gap-3 text-left">
        <span className="mt-0.5 hidden w-8 shrink-0 font-mono text-xs font-normal text-muted-foreground sm:inline">#{job.number}</span>
        <span className="min-w-0 flex-1"><span className="block break-words text-sm font-medium">{job.title}</span><span className="mt-1 block text-xs font-normal text-muted-foreground">{date(job.createdAt)}{job.mine ? ' · 你提交的' : ''}</span></span>
        <Badge variant={job.state === 'failed' ? 'destructive' : job.state === 'queued' ? 'outline' : 'secondary'} className="shrink-0 font-normal">{labels[job.state]}</Badge>
      </div>
    </AccordionTrigger>
    <AccordionContent className="space-y-4 px-5 pb-5 text-sm leading-6 sm:px-6">
      <p className="break-words whitespace-pre-wrap">{job.description}</p>
      {job.acceptance && <div><h4 className="mb-1 text-xs font-medium text-muted-foreground">验收条件</h4><p className="break-words whitespace-pre-wrap">{job.acceptance}</p></div>}
      {job.position !== null && <p className="text-xs text-muted-foreground">等待队列第 {job.position} 位，前面有 {job.position - 1} 条待启动需求。当前任务完成后继续处理。</p>}
      {job.message && <p className="rounded-md bg-muted px-3 py-2 text-muted-foreground">{job.message}</p>}
      {job.lastAgentMessage && <blockquote className="border-l-2 pl-4"><h4 className="mb-1 font-medium">Jules 的消息</h4><p className="break-words whitespace-pre-wrap">{job.lastAgentMessage}</p></blockquote>}
      <div className="flex flex-wrap gap-4">{job.sessionUrl && <a className="inline-flex items-center gap-1 text-xs underline underline-offset-4" href={job.sessionUrl} target="_blank" rel="noreferrer">Jules 会话<ExternalLink className="size-3" /></a>}{job.prUrl && <a className="inline-flex items-center gap-1 text-xs underline underline-offset-4" href={job.prUrl} target="_blank" rel="noreferrer">代码变更<ExternalLink className="size-3" /></a>}</div>
      <details><summary className="text-xs text-muted-foreground">处理记录</summary><ol className="mt-3 space-y-2">{job.events.map((event, index) => <li key={index} className="flex flex-col gap-1 text-xs sm:flex-row sm:gap-3"><time className="shrink-0 tabular-nums text-muted-foreground">{date(event.at)}</time><span>{event.text}</span></li>)}</ol></details>
      {job.state === 'needs_input' && job.mine && <Feedback job={job} onRefresh={onRefresh} />}
    </AccordionContent>
  </AccordionItem>;
}

export function TaskBoard({ data, loading, error, onRefresh, historyOnly = false }: { data: QueueView | null; loading: boolean; error: string; onRefresh: () => void; historyOnly?: boolean }) {
  const [filter, setFilter] = useState<'all' | 'waiting' | 'finished'>('all');
  const active = data?.jobs.find(job => job.id === data.activeId);
  const waiting = data?.jobs.filter(job => job.state === 'queued') ?? [];
  const finished = data?.jobs.filter(job => ['completed', 'failed'].includes(job.state)) ?? [];
  const filtered = (historyOnly ? finished : filter === 'waiting' ? waiting : filter === 'finished' ? finished : data?.jobs ?? []).slice().sort((a, b) => {
    if (historyOnly || filter === 'finished') return b.number - a.number;
    if (a.id === data?.activeId) return -1;
    if (b.id === data?.activeId) return 1;
    return a.number - b.number;
  });
  return <div className="min-w-0 space-y-4">
    {!historyOnly && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-5 py-4 text-sm">
      <div><span className="text-muted-foreground">当前任务</span><p className="mt-1 font-medium">{active ? active.title : '暂无正在处理的任务'}</p></div>
      <span className="text-xs text-muted-foreground">并发上限 1</span>
    </div>}
    <Card className="gap-0 overflow-hidden py-0 shadow-none">
      <CardHeader className="flex flex-row items-center justify-between px-5 py-5 sm:px-6"><div className="flex items-center gap-2"><CardTitle className="text-base">{historyOnly ? '已结束任务' : '需求队列'}</CardTitle><Badge variant="secondary" className="tabular-nums font-normal">{historyOnly ? finished.length : data?.total ?? 0}</Badge></div><Button variant="ghost" size="sm" onClick={onRefresh} disabled={loading} aria-label="刷新队列"><RefreshCw className={loading ? 'animate-spin' : ''} />刷新</Button></CardHeader>
      {!historyOnly && <div className="flex flex-wrap items-center gap-1 border-y bg-muted/30 px-4 py-2 sm:px-5" aria-label="筛选需求">{([['all', '全部'], ['waiting', `排队中 ${waiting.length}`], ['finished', '已结束']] as const).map(([value, label]) => <Button key={value} size="sm" variant={filter === value ? 'secondary' : 'ghost'} aria-pressed={filter === value} onClick={() => setFilter(value)} className="h-7 text-xs shadow-none">{label}</Button>)}</div>}
      {error && <div role="alert" className="flex items-center justify-between gap-3 px-5 py-4 text-sm text-destructive">{error}<Button variant="outline" size="sm" onClick={onRefresh}>重试</Button></div>}
      {loading && !data ? <CardContent className="space-y-3 pt-6"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></CardContent> : filtered.length ? <Accordion type="single" collapsible>{filtered.map(job => <JobRow key={job.id} job={job} onRefresh={onRefresh} />)}</Accordion> : <div className="px-5 py-16 text-center"><p className="text-sm font-medium">{historyOnly ? '暂无已结束任务' : filter === 'waiting' ? '暂无排队需求' : filter === 'finished' ? '暂无已结束任务' : '暂无需求'}</p><p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-muted-foreground">{historyOnly ? '任务完成或失败后，会在这里保留记录。' : '提交一条需求后，可以在这里查看排队位置和处理结果。'}</p></div>}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-5 py-3 text-xs text-muted-foreground sm:px-6"><span>按提交顺序处理</span><span>{error ? '同步失败' : data ? '每 10 秒同步' : '正在连接'}</span></div>
    </Card>
    {!historyOnly && <p className="px-1 text-xs leading-6 text-muted-foreground">每条需求都从最新已发布版本开始。上一条任务发布完成后，才会启动下一条。</p>}
  </div>;
}
