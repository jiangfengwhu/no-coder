import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Separator } from '@/components/ui/separator';

export function Guide() {
  return <article className="max-w-2xl space-y-7 text-sm leading-7">
    <section><h2 className="mb-3 text-base font-semibold">这个应用怎样工作</h2><p className="text-muted-foreground">所有人共享同一个应用。你提交功能需求，Jules 读取仓库代码并实现，随后在会话中运行发布脚本，将前端和后端上传到 Cloudflare。</p></section>
    <ol className="list-decimal space-y-4 pl-5 marker:text-muted-foreground">
      <li><strong className="font-medium">提交需求。</strong><span className="text-muted-foreground"> 写清使用场景、所需功能和验收条件。需求内容及处理结果公开。</span></li>
      <li><strong className="font-medium">等待处理。</strong><span className="text-muted-foreground"> 按提交顺序排队，同一时间只有一个 Jules 会话处理任务。</span></li>
      <li><strong className="font-medium">实现并发布。</strong><span className="text-muted-foreground"> Jules 修改代码，运行检查，在会话中打包并上传 Cloudflare，然后提交 PR。</span></li>
      <li><strong className="font-medium">确认版本。</strong><span className="text-muted-foreground"> 队列核对线上版本与 PR 一致，合并并确认源码一致后，再处理下一条需求。</span></li>
    </ol>
    <Separator />
    <section><h2 className="mb-3 text-base font-semibold">需求示例</h2><blockquote className="border-l-2 pl-4 text-muted-foreground">增加公共留言板。任何人都能发布一段文字，按时间倒序显示。刷新后留言保留，空留言不能提交。</blockquote></section>
    <section><h2 className="mb-2 text-base font-semibold">常见问题</h2><Accordion type="single" collapsible>
      <AccordionItem value="order"><AccordionTrigger>为什么一次只处理一个需求？</AccordionTrigger><AccordionContent className="leading-7 text-muted-foreground">保证每条需求基于最新发布版本，减少同时修改同一份代码产生的冲突。创建、验证、合并和发布全程占用同一个队列位置。</AccordionContent></AccordionItem>
      <AccordionItem value="feedback"><AccordionTrigger>Jules 需要我补充说明时怎么办？</AccordionTrigger><AccordionContent className="leading-7 text-muted-foreground">任务会显示“等待补充”。在提交需求的同一浏览器中展开任务并回复。清除 Cookie 会失去提交者身份识别。</AccordionContent></AccordionItem>
      <AccordionItem value="failure"><AccordionTrigger>任务失败会怎样？</AccordionTrigger><AccordionContent className="leading-7 text-muted-foreground">任务及原因会保留。Jules 直接发布模式下，无法确认发布、合并或验证结果时，队列会暂停，等待管理员核对后恢复。</AccordionContent></AccordionItem>
      <AccordionItem value="limits"><AccordionTrigger>提交内容有什么要求？</AccordionTrigger><AccordionContent className="leading-7 text-muted-foreground">提交适合 Web 和 Cloudflare Workers 的功能。每个浏览器最多同时保留 3 条未完成需求。请勿填写密钥、个人隐私，或依赖尚未配置的付费服务。</AccordionContent></AccordionItem>
    </Accordion></section>
  </article>;
}
