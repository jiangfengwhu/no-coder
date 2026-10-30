import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowDown, ArrowUpRight, BookOpen, Check, ChevronRight, Code2, GitBranch, Layers, Pause, Zap } from 'lucide-react';
import type { QueueView } from '../../backend/src/control/types';
import { loadQueue } from './api';
import { RequestForm } from './components/RequestForm';
import { TaskBoard } from './components/TaskBoard';
import { Guide } from './components/Guide';
import { AdminDialog } from './components/AdminDialog';
import './styles.css';

function App() {
  const [tab, setTab] = useState<'workbench' | 'guide' | 'history'>('workbench');
  const [data, setData] = useState<QueueView | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const refreshing = useRef(false);
  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true; setLoading(true);
    try { setData(await loadQueue()); setError(''); }
    catch (error) { setError((error as Error).message); }
    finally { setLoading(false); refreshing.current = false; }
  }, []);
  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => { if (!document.hidden) void refresh(); }, 10_000);
    const visible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener('visibilitychange', visible);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', visible); };
  }, [refresh]);
  const queued = data?.jobs.filter(job => job.state === 'queued').length ?? 0;
  const published = data?.jobs.filter(job => job.state === 'completed').length ?? 0;
  const status = !data ? '连接中' : !data.configured ? '等待连接 Jules' : data.paused ? '调度已暂停' : data.activeId ? 'Jules 正在工作' : '准备接收想法';

  return <><a className="skip-link" href="#main">跳到主要内容</a><header className="site-header"><div className="header-inner"><a className="brand" href="/" aria-label="noCoder 首页"><span className="brand-mark">n<span>c</span></span><span>noCoder<span className="brand-period">.</span></span></a><nav aria-label="主导航">{([['workbench', '工作台'], ['guide', '使用说明'], ['history', '实验记录']] as const).map(([value, label]) => <button key={value} onClick={() => setTab(value)} className={tab === value ? 'active' : ''} aria-current={tab === value ? 'page' : undefined}>{label}</button>)}</nav><a className="repo-link" href={data?.repositoryUrl ?? 'https://github.com/jiangfengwhu/no-coder'} target="_blank" rel="noreferrer"><GitBranch size={15} /><span>源代码</span><ArrowUpRight size={13} /></a></div></header>
    <main id="main" className="page-shell"><section className="intro"><div className="intro-copy"><div className="intro-eyebrow"><span className="experiment-tag">开放实验</span><span className="mono">BUILT BY IDEAS, SHIPPED BY AI.</span></div><h1>一个应用，无数种可能。<br /><span>下一步，听你的。</span></h1><p>你提出想法，Jules 把它变成代码。<br className="mobile-break" />我们一起观察，一个应用能否由 AI 持续生长。</p></div><div className="intro-side"><div className="serial-label"><span className="eyebrow">ONE AT A TIME</span><span className="serial-number">01<span>/ session</span></span><p>每次专注一个想法<br />每次接着上个版本继续</p></div><span className="vertical-line" /></div></section>
    <section className="status-strip" aria-label="实验运行状态"><div className="runtime-status"><span className={`status-dot ${data?.configured && !data.paused ? 'online' : ''}`} /><span>{status}</span></div><div><span className="stat-label">排队需求</span><strong className="mono">{String(queued).padStart(2, '0')}</strong></div><div><span className="stat-label">已发布<span className="hide-mobile">版本</span></span><strong className="mono">{String(published).padStart(2, '0')}</strong></div><span className="strip-end"><Layers size={14} />所有人，共同构建</span></section>
    {data && !data.configured && <div className="connection-notice" role="status"><span className="notice-icon"><Zap size={15} /></span><p><strong>实验入口已就绪，Jules 尚未连接。</strong><span>你可以先提交想法。完成服务配置后，队列会开始处理。</span></p></div>}
    {data?.paused && <div className="connection-notice paused" role="status"><Pause size={17} /><p><strong>调度暂停，需求仍会保留。</strong><span>{data.pauseReason}</span></p></div>}
    {tab === 'guide' && <Guide />}
    {tab === 'history' && <TaskBoard data={data} loading={loading} error={error} onRefresh={refresh} historyOnly />}
    <div className={`workspace-grid ${tab !== 'workbench' ? 'secondary-workspace' : ''}`}><div>{tab === 'workbench' ? <TaskBoard data={data} loading={loading} error={error} onRefresh={refresh} /> : <section className="return-workbench"><BookOpen size={26} strokeWidth={1.3} /><h2>读完说明，就让想法发生。</h2><p>从一个小功能开始。描述你的使用场景，把实现交给 Jules。</p><button className="text-button" onClick={() => { setTab('workbench'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>返回工作台 <ChevronRight size={15} /></button></section>}</div><RequestForm inviteRequired={data?.inviteRequired ?? false} onSubmitted={() => { setTab('workbench'); void refresh(); }} /></div>
    <section className="how-it-works" aria-label="实现流程"><span className="eyebrow">HOW IT GROWS</span><div><span>01 <strong>提出想法</strong></span><ChevronRight size={14} /><span>02 <strong>按序实现</strong></span><ChevronRight size={14} /><span>03 <strong>验证代码</strong></span><ChevronRight size={14} /><span>04 <strong>发布更新</strong></span></div><button className="text-button" onClick={() => { setTab('guide'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>了解实验 <ArrowUpRight size={14} /></button></section></main>
    <footer className="site-footer"><div><a className="footer-brand" href="/">noCoder.</a><span>一个持续生长的 Web 实验</span></div><div className="footer-tools"><span>Jules × Cloudflare</span><AdminDialog data={data} onRefresh={refresh} /></div></footer></>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
