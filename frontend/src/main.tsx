import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ExternalLink, Moon, Sun, SquareCode } from 'lucide-react';
import type { QueueView } from '../../backend/src/control/types';
import { loadQueue } from './api';
import { RequestForm } from './components/RequestForm';
import { TaskBoard } from './components/TaskBoard';
import { Guide } from './components/Guide';
import { AdminDialog } from './components/AdminDialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import './styles.css';

type Page = 'workbench' | 'guide' | 'history';
const pageTitles: Record<Page, [string, string]> = {
  workbench: ['工作台', '提交需求，查看实现与发布进度。'],
  guide: ['使用说明', '了解需求怎样从队列进入已发布版本。'],
  history: ['实验记录', '查看已经结束的任务和发布结果。'],
};

function App() {
  const [tab, setTab] = useState<Page>('workbench');
  const [data, setData] = useState<QueueView | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [dark, setDark] = useState(() => {
    const stored = localStorage.getItem('nc-theme');
    return stored ? stored === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  });
  const refreshing = useRef(false);
  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    setLoading(true);
    try { setData(await loadQueue()); setError(''); }
    catch (error) { setError((error as Error).message); }
    finally { setLoading(false); refreshing.current = false; }
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);
  useEffect(() => {
    void refresh();
    const visible = () => { if (!document.hidden) void refresh(); };
    const timer = window.setInterval(visible, 10_000);
    document.addEventListener('visibilitychange', visible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [refresh]);
  const status = !data ? '连接中' : !data.configured ? '未连接 Jules' : data.paused ? '调度已暂停' : data.activeId ? '正在处理任务' : '队列空闲';

  return <Tabs value={tab} onValueChange={value => setTab(value as Page)} className="min-h-dvh gap-0">
    <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-background focus:p-4">跳到主要内容</a>
    <header className="border-b bg-card">
      <div className="mx-auto flex min-h-16 max-w-6xl flex-wrap items-center gap-x-7 gap-y-2 px-4 py-3 sm:px-6">
        <a href="/" aria-label="noCoder 首页" className="flex shrink-0 items-center gap-2 text-base font-semibold tracking-tight"><SquareCode className="size-5" strokeWidth={1.6} />noCoder</a>
        <TabsList variant="line" aria-label="主导航" className="order-3 h-9 w-full justify-start gap-3 p-0 sm:order-none sm:w-auto">
          <TabsTrigger value="workbench" className="flex-none px-1">工作台</TabsTrigger>
          <TabsTrigger value="guide" className="flex-none px-1">使用说明</TabsTrigger>
          <TabsTrigger value="history" className="flex-none px-1">实验记录</TabsTrigger>
        </TabsList>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" asChild><a href={data?.repositoryUrl || 'https://github.com/jiangfengwhu/no-coder'} target="_blank" rel="noreferrer">GitHub<ExternalLink className="size-3.5" /></a></Button>
          <Button variant="ghost" size="icon-sm" aria-label={dark ? '切换浅色主题' : '切换深色主题'} onClick={() => setDark(previous => { localStorage.setItem('nc-theme', previous ? 'light' : 'dark'); return !previous; })}>{dark ? <Sun /> : <Moon />}</Button>
        </div>
      </div>
    </header>
    <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="text-2xl font-semibold tracking-tight">{pageTitles[tab][0]}</h1><p className="mt-2 text-sm text-muted-foreground">{pageTitles[tab][1]}</p></div>
        <Badge variant="outline" className="mt-1 gap-2 py-1 font-normal"><span className={`size-1.5 rounded-full ${data?.configured && !data.paused ? 'bg-emerald-600' : 'bg-muted-foreground'}`} />{status}</Badge>
      </div>
      {data && !data.configured && <Alert className="mb-6 border-dashed bg-transparent"><AlertTitle>Jules 尚未连接</AlertTitle><AlertDescription>可以先提交需求。完成服务配置后，队列会按顺序处理。</AlertDescription></Alert>}
      {data?.paused && <Alert className="mb-6"><AlertTitle>调度已暂停</AlertTitle><AlertDescription>{data.pauseReason} 已提交需求会保留。</AlertDescription></Alert>}
      <TabsContent value="workbench" forceMount className="data-[state=inactive]:hidden">
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(320px,1fr)]">
          <TaskBoard data={data} loading={loading} error={error} onRefresh={refresh} />
          <RequestForm inviteRequired={data?.inviteRequired ?? false} onSubmitted={() => { void refresh(); }} />
        </div>
      </TabsContent>
      <TabsContent value="guide"><Guide /></TabsContent>
      <TabsContent value="history"><TaskBoard data={data} loading={loading} error={error} onRefresh={refresh} historyOnly /></TabsContent>
    </main>
    <footer className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-muted-foreground sm:px-6">
      <span>共享一个应用，按顺序实现每条需求。</span>
      <div className="flex items-center gap-4"><span>Cloudflare Workers</span><AdminDialog data={data} onRefresh={refresh} /></div>
    </footer>
  </Tabs>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
