import { ArrowUpRight, FileText, ListOrdered, Rocket, Sparkles } from 'lucide-react';

export function Guide() {
  const steps = [
    { icon: FileText, title: '写下一个具体想法', text: '描述你想解决的问题、使用方式和预期效果。所有人共享这个应用，需求与处理记录也会公开。' },
    { icon: ListOrdered, title: '按顺序，耐心等一等', text: '每条需求对应一个 Jules session。同一时间只处理一个任务，上一条发布完成后才会启动下一条。' },
    { icon: Sparkles, title: 'Jules 接手实现', text: 'Jules 阅读现有代码，修改前端和后端并提交 PR。如果需要进一步说明，你可以在原浏览器里回复。' },
    { icon: Rocket, title: '验证以后，更新上线', text: '代码通过检查后合并，由 GitHub Actions 部署到 Cloudflare。发布和健康检查通过后，队列才继续。' },
  ];
  return <section className="guide" aria-labelledby="guide-title"><span className="eyebrow">FIELD GUIDE / 001</span><h2 id="guide-title">从一个想法，到下一次更新。</h2><p className="guide-lead">这是一次关于 AI 自主维护软件的开放实验。你提出需求，我们观察它能走多远。</p><div className="guide-steps">{steps.map((step, index) => <article key={step.title}><span className="step-number">0{index + 1}</span><step.icon size={23} strokeWidth={1.5} /><h3>{step.title}</h3><p>{step.text}</p></article>)}</div><div className="guide-callout"><h3>一个好需求，可以这样写</h3><blockquote>“我想要一个公共留言板。任何人都能发布一段文字，按时间倒序显示。刷新页面后留言仍然保留，空留言不能提交。”</blockquote><a href="#submit" className="text-link">把你的想法也写下来 <ArrowUpRight size={15} /></a></div><div className="guide-faq"><h3>使用前，了解这几件事</h3><details><summary>为什么一次只处理一个需求？</summary><p>每个任务都从最新已发布版本开始，避免多条需求同时修改同一份代码。排队顺序按后端接收顺序确定。</p></details><details><summary>失败了会怎样？</summary><p>Jules 明确失败的任务会记录原因，然后处理下一条。无法确认远端状态、验证失败或部署失败时，调度会暂停并保留当前位置，等待检查。</p></details><details><summary>我能修改别人的需求吗？</summary><p>已提交内容会作为该次任务的记录保留。你可以提出新的改进需求；Jules 需要澄清时，原提交者可在同一浏览器中补充说明。清除浏览器 Cookie 会失去这项识别能力。</p></details><details><summary>现在可以提交什么？</summary><p>适合提交兼容 Web 和 Cloudflare Workers 的应用功能。请不要提交密钥、敏感个人信息或需要付费账户才能完成但尚未配置的服务。</p></details></div></section>;
}
