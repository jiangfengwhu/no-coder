export type JobState = 'queued' | 'creating' | 'running' | 'needs_input' | 'checking' | 'ready_to_merge' | 'merging' | 'deploying' | 'completed' | 'failed' | 'blocked';

export interface Job {
  id: string;
  number: number;
  requestId: string;
  ownerHash: string;
  title: string;
  description: string;
  acceptance: string;
  state: JobState;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  sessionId?: string;
  sessionUrl?: string;
  sessionState?: string;
  prUrl?: string;
  prNumber?: number;
  headSha?: string;
  mergeSha?: string;
  mergeApproved?: boolean;
  message?: string;
  lastAgentMessage?: string;
  events: { at: string; text: string }[];
}

export type PublicJob = Omit<Job, 'ownerHash' | 'requestId'> & { mine: boolean; position: number | null };

export interface QueueMeta {
  nextNumber: number;
  activeId: string | null;
  paused: boolean;
  pauseReason?: string;
  latestCommit?: string;
}

export interface QueueView {
  jobs: PublicJob[];
  total: number;
  activeId: string | null;
  paused: boolean;
  pauseReason?: string;
  configured: boolean;
  missing: string[];
  autoMerge: boolean;
  inviteRequired: boolean;
  repositoryUrl?: string;
  latestCommit?: string;
}

export interface Env {
  ASSETS: Fetcher;
  AGENT_QUEUE: DurableObjectNamespace;
  JULES_API_KEY?: string;
  GITHUB_TOKEN?: string;
  QUEUE_ADMIN_TOKEN?: string;
  SUBMISSION_TOKEN?: string;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  GITHUB_BRANCH: string;
  JULES_SOURCE: string;
  DEPLOY_WORKFLOW: string;
  AUTO_MERGE: string;
  APP_COMMIT: string;
}

export interface QueueStore {
  loadMeta(): Promise<QueueMeta | undefined>;
  listJobs(): Promise<Job[]>;
  save(meta: QueueMeta, job?: Job): Promise<void>;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function missingConfig(env: Env): string[] {
  return ['JULES_API_KEY', 'GITHUB_TOKEN', 'QUEUE_ADMIN_TOKEN', 'GITHUB_OWNER', 'GITHUB_REPO', 'JULES_SOURCE']
    .filter(key => !env[key as keyof Env]);
}

export function isTerminal(job: Job): boolean {
  return job.state === 'completed' || job.state === 'failed';
}
