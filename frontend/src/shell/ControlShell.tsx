import { useState } from 'react';
import { ArrowUpRight, CircleHelp, List, Plus } from 'lucide-react';
import { useQueue } from '../use-queue';
import { RequestForm } from '../components/RequestForm';
import { TaskBoard } from '../components/TaskBoard';
import { Guide } from '../components/Guide';
import { AdminDialog } from '../components/AdminDialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

type Panel = 'submit' | 'queue' | 'guide';
export function ControlShell() {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>('submit');
  const { data, error, loading, connection, refresh } = useQueue();
  const active = data?.jobs.find(job => job.id === data.activeId);
  const waiting = data?.jobs.filter(job => job.state === 'queued').length ?? 0;
  const status = !data ? '连接中' : !data.configured ? '未连接 Jules' : data.paused ? '调度已暂停' : active ? '正在处理' : '队列空闲';
  return <>
    <button className="orb" type="button" onClick={() => setOpen(true)} aria-label={`打开需求与队列，${status}`} aria-haspopup="dialog">
      <span className="orb-mark"><Plus size={22} strokeWidth={1.8} /></span>
      <span className="orb-copy"><strong>提交需求</strong><span><i className={data?.paused || error ? 'orb-dot warning' : 'orb-dot'} />{status}{waiting > 0 ? ` · ${waiting} 条排队` : ''}</span></span>
      <ArrowUpRight className="orb-arrow" size={16} />
    </button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="shell-dialog max-h-[min(90dvh,850px)] max-w-[calc(100%-1.5rem)] overflow-y-auto p-0 sm:max-w-2xl">
        <DialogHeader className="px-5 pt-5 pr-12 sm:px-6 sm:pt-6"><DialogTitle>需求与队列</DialogTitle><DialogDescription>提交需求，查看实现进度。</DialogDescription></DialogHeader>
        <Tabs value={panel} onValueChange={v => setPanel(v as Panel)} className="gap-0">
          <TabsList variant="line" className="mx-5 justify-start gap-4 border-b p-0 sm:mx-6" aria-label="需求导航">
            <TabsTrigger value="submit"><Plus />提交需求</TabsTrigger><TabsTrigger value="queue"><List />队列</TabsTrigger><TabsTrigger value="guide"><CircleHelp />使用说明</TabsTrigger>
          </TabsList>
          <TabsContent value="submit" forceMount className="p-5 data-[state=inactive]:hidden sm:p-6"><RequestForm inviteRequired={data?.inviteRequired ?? false} onSubmitted={() => { void refresh(); setPanel('queue'); }} /></TabsContent>
          <TabsContent value="queue" className="p-5 sm:p-6">{data?.paused && <p role="status" className="mb-4 rounded-md border px-4 py-3 text-sm">调度已暂停：{data.pauseReason}</p>}<TaskBoard data={data} loading={loading} error={error} onRefresh={refresh} connection={connection} /><div className="mt-4 flex justify-end"><AdminDialog data={data} onRefresh={refresh} /></div></TabsContent>
          <TabsContent value="guide" className="p-5 sm:p-6"><Guide /></TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  </>;
}
