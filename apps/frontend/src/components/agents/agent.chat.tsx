'use client';

import React, {
  FC,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  createContext,
} from 'react';
import { CopilotChat, CopilotKitCSSProperties, InputProps, UserMessageProps } from '@copilotkit/react-ui';
import { Input } from '@gitroom/frontend/components/agents/agent.input';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import {
  CopilotKit,
  useCopilotAction,
  useCopilotMessagesContext,
  useDefaultTool,
} from '@copilotkit/react-core';
import {
  MediaPortal,
  PropertiesContext,
} from '@gitroom/frontend/components/agents/agent';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@gitroom/react/form/button';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { TextMessage } from '@copilotkit/runtime-client-gql';
import { Composer } from '@gitroom/frontend/components/composer/composer';
import dayjs from 'dayjs';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { ExistingDataContextProvider } from '@gitroom/frontend/components/launches/helpers/use.existing.data';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { SafeContent } from '@gitroom/frontend/components/shared/safe-content';
import { csrfHeader } from '@gitroom/helpers/utils/csrf.header';
import Link from 'next/link';
import {
  useAiActive,
  AI_SETUP_HREF,
} from '@gitroom/frontend/components/layout/use-ai-active';
import { useToaster } from '@gitroom/react/toaster/toaster';
import useSWR, { useSWRConfig } from 'swr';
import { AgentContextBridge } from '@gitroom/frontend/components/agent/agent-context-bridge';

export interface MediaAttachment {
  id: string;
  path: string;
}

const MediaAttachmentContext = createContext<{
  media: MediaAttachment[];
  setMedia: (media: MediaAttachment[]) => void;
}>({ media: [], setMedia: () => {} });

export const AgentChat: FC = () => {
  const { backendUrl } = useVariables();
  const params = useParams<{ id: string }>();
  const { properties } = useContext(PropertiesContext);
  const t = useT();
  const router = useRouter();
  const aiActive = useAiActive();
  const [media, setMedia] = useState<MediaAttachment[]>([]);

  // No AI provider configured → CopilotKit's /copilot/agent handshake would
  // 403 and the "postmill" agent wouldn't resolve. Send the user to set one up.
  if (aiActive === false) {
    return (
      <div className="bg-newBgColorInner flex flex-1 flex-col items-center justify-center gap-[16px] text-center p-[40px]">
        <div className="text-[18px] font-[600]">
          {t('ai_not_configured_title', 'AI is not configured')}
        </div>
        <div className="text-[14px] opacity-80 max-w-[420px]">
          {t(
            'ai_not_configured_agent',
            'Configure an AI provider to use the assistant and build agents.'
          )}
        </div>
        <Button onClick={() => router.push(AI_SETUP_HREF)}>
          {t('configure_ai_provider', 'Configure AI provider')}
        </Button>
      </div>
    );
  }

  // Still resolving AI config — don't mount CopilotKit (and handshake) yet.
  if (aiActive !== true) {
    return null;
  }

  return (
    <CopilotKit
      {...(params.id === 'new' ? {} : { threadId: params.id })}
      credentials="include"
      runtimeUrl={backendUrl + '/copilot/agent'}
      headers={csrfHeader()}
      showDevConsole={false}
      agent="postmill"
      properties={{
        integrations: properties,
        media,
      }}
    >
      <MediaAttachmentContext.Provider value={{ media, setMedia }}>
        <Hooks />
        <AgentContextBridge />
        <LoadMessages id={params.id} />
        <ThreadListRefresher id={params.id} />
        <div
          style={
            {
              '--copilot-kit-primary-color': 'var(--new-btn-text)',
              '--copilot-kit-background-color': 'var(--new-bg-color)',
            } as CopilotKitCSSProperties
          }
          className="trz agent bg-newBgColorInner flex flex-col gap-[15px] transition-all flex-1 items-center relative"
        >
          <div className="absolute left-0 w-full h-full pb-[20px]">
            <CopilotChat
              className="w-full h-full"
              labels={{
                title: t('your_assistant', 'Your Assistant'),
                initial: t('agent_welcome_message', `Hello, I am your Postmill agent 🙌🏻.

I can schedule posts to your channels, generate images and videos, analyze your performance, manage campaigns, and reply to comments.

Pick the channels to work with from the channel selector in the top toolbar. Your previous conversations live in the menu on the left (open it with the toolbar button).

You can also use me as an MCP Server — see Settings >> Public API.
`),
              }}
              UserMessage={Message}
              Input={NewInput}
            />
          </div>
        </div>
      </MediaAttachmentContext.Provider>
    </CopilotKit>
  );
};

export const LoadMessages: FC<{ id: string }> = ({ id }) => {
  const { setMessages } = useCopilotMessagesContext();
  const fetch = useFetch();

  useEffect(() => {
    if (id === 'new') {
      setMessages([]);
      return;
    }
    // App Router keeps this component mounted across `/agents/A → /agents/B`, so
    // a slow response for the previous thread must never overwrite the current
    // one. Guard with a cancel flag and swallow rejections (the fetch aborts on
    // sign-out / navigation) so a stale load can't clobber a fresh thread.
    let cancelled = false;
    (async () => {
      const data = await (await fetch(`/copilot/${id}/list`)).json();
      if (cancelled) {
        return;
      }
      setMessages(
        data.messages.map((p: any) => {
          return new TextMessage({
            content: p.content.content,
            role: p.role,
          });
        })
      );
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id, fetch, setMessages]);

  return null;
};

// A brand-new conversation (`/agents/new`) gets a persisted server thread once
// its first exchange completes, but the left-hand thread list (`useSWR('threads')`
// in agent.tsx) won't reflect it until revalidated. Refresh that key once per new
// session so the new conversation appears without a manual reload.
const ThreadListRefresher: FC<{ id: string }> = ({ id }) => {
  const { messages } = useCopilotMessagesContext();
  const { mutate } = useSWRConfig();
  const refreshedRef = useRef(false);
  const lastIdRef = useRef(id);

  useEffect(() => {
    if (lastIdRef.current !== id) {
      lastIdRef.current = id;
      refreshedRef.current = false;
    }
    // Wait for the first round-trip (user + assistant) so the thread row exists.
    if (id === 'new' && !refreshedRef.current && messages.length >= 2) {
      refreshedRef.current = true;
      mutate('threads');
    }
  }, [id, messages.length, mutate]);

  return null;
};

const Message: FC<UserMessageProps> = (props) => {
  const convertContentToImagesAndVideo = useMemo(() => {
    const rawContent = props.message?.content;
    const contentStr = typeof rawContent === 'string' ? rawContent : '';
    // Backward-compat: messages created before structured media properties may
    // still contain inline Image:/Video: markers or [--Media--] wrappers. Render
    // them and strip the legacy integration marker block.
    // Escape `"` in interpolated URLs so a crafted url can't break out of the
    // src attribute and inject class/style attributes (DOMPurify strips scripts
    // but not attribute injection). Regexes are non-greedy so a second marker on
    // the same line / block isn't swallowed into the first match.
    const safeUrl = (u: string) => u.trim().replace(/"/g, '%22');
    return contentStr
      .replace(/Video: (http.*?mp4)\n/g, (match: string, p1: string) => {
        return `<video controls class="h-[150px] w-[150px] rounded-[8px] mb-[10px]"><source src="${safeUrl(p1)}" type="video/mp4">Your browser does not support the video tag.</video>`;
      })
      .replace(/Image: (http.*?)\n/g, (match: string, p1: string) => {
        return `<img src="${safeUrl(p1)}" class="h-[150px] w-[150px] max-w-full border border-newBgColorInner" />`;
      })
      .replace(/\[\-\-Media\-\-\](.*?)\[\-\-Media\-\-\]/g, (match: string, p1: string) => {
        return `<div class="flex justify-center mt-[20px]">${p1}</div>`;
      })
      .replace(
        /(\[--integrations--\][\s\S]*?\[--integrations--\])/g,
        () => ``
      );
  }, [props.message?.content]);
  return (
    <SafeContent
      className="copilotKitMessage copilotKitUserMessage min-w-[300px]"
      content={convertContentToImagesAndVideo}
    />
  );
};

const NewInput: FC<InputProps> = (props) => {
  const { media, setMedia } = useContext(MediaAttachmentContext);
  const [value, setValue] = useState('');
  return (
    <>
      <MediaPortal
        value={value}
        media={media}
        setMedia={(e) => setMedia(e.target.value || [])}
      />
      <Input
        {...props}
        onChange={setValue}
        onSend={(text: string) => {
          const send = props.onSend(text);
          setValue('');
          setMedia([]);
          return send;
        }}
      />
    </>
  );
};

export const Hooks: FC = () => {
  useCopilotAction({
    name: 'manualPosting',
    description:
      'This tool should be triggered when the user wants to manually add the generated post',
    parameters: [
      {
        name: 'list',
        type: 'object[]',
        description:
          'list of posts to schedule to different social media (integration ids)',
        attributes: [
          {
            name: 'integrationId',
            type: 'string',
            description: 'The integration id',
          },
          {
            name: 'date',
            type: 'string',
            description: 'UTC date of the scheduled post',
          },
          {
            name: 'settings',
            type: 'object',
            description: 'Settings for the integration [input:settings]',
          },
          {
            name: 'posts',
            type: 'object[]',
            description: 'list of posts / comments (one under another)',
            attributes: [
              {
                name: 'content',
                type: 'string',
                description: 'the content of the post',
              },
              {
                name: 'attachments',
                type: 'object[]',
                description: 'list of attachments',
                attributes: [
                  {
                    name: 'id',
                    type: 'string',
                    description: 'id of the attachment',
                  },
                  {
                    name: 'path',
                    type: 'string',
                    description: 'url of the attachment',
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    renderAndWaitForResponse: ({ args, status, respond }) => {
      if (status === 'executing') {
        return <OpenModal args={args} respond={respond} />;
      }

      return null;
    },
  });

  useCopilotAction({
    name: 'commentReply',
    description:
      'Reply to a synced social comment or post a first comment on a published post. Requires explicit user confirmation in UI mode.',
    parameters: [
      {
        name: 'postId',
        type: 'string',
        description: 'The post id the comment belongs to',
      },
      {
        name: 'message',
        type: 'string',
        description: 'The reply text to send',
      },
      {
        name: 'commentId',
        type: 'string',
        description:
          'Optional comment id; if provided, the reply is threaded under that comment, otherwise it posts a top-level comment on the post',
      },
    ],
    renderAndWaitForResponse: ({ args, status, respond }) => {
      if (status === 'executing') {
        return (
          <ConfirmCommentReplyCard
            postId={args.postId}
            commentId={args.commentId}
            message={args.message}
            onRespond={respond}
          />
        );
      }
      return null;
    },
  });

  useCopilotAction({
    name: 'mediaStudioGenerate',
    description:
      'Generate media (image, video, or audio) through a configured AI media provider. Requires explicit user confirmation in UI mode.',
    parameters: [
      {
        name: 'provider',
        type: 'string',
        description: 'The provider identifier, e.g. "runway", "luma", "openai"',
      },
      {
        name: 'operation',
        type: 'string',
        description: 'The media operation to perform: image, video, or audio',
      },
      {
        name: 'model',
        type: 'string',
        description: 'Optional model id; provider default is used when omitted',
      },
      {
        name: 'input',
        type: 'object',
        description: 'Provider-native generation parameters',
      },
      {
        name: 'mediaInputs',
        type: 'object',
        description:
          'Map of provider media-field names to /files fileIds (resolved to public URLs)',
      },
      {
        name: 'folderId',
        type: 'string',
        description: 'Optional destination folder id in the organization file library',
      },
    ],
    renderAndWaitForResponse: ({ args, status, respond }) => {
      if (status === 'executing') {
        return <ConfirmMediaStudioGenerateCard args={args} onRespond={respond} />;
      }
      return null;
    },
  });

  useDefaultTool({
    render: ({ name, args, status, result }) => {
      return (
        <ToolCallCard
          name={name}
          args={args}
          status={status}
          result={result}
        />
      );
    },
  });

  return null;
};

const ConfirmCommentReplyCard: FC<{
  postId: string;
  commentId?: string;
  message: string;
  onRespond: (value: any) => void;
}> = ({ postId, commentId, message, onRespond }) => {
  const fetch = useFetch();
  const toaster = useToaster();
  const t = useT();
  const [loading, setLoading] = useState(false);

  const handleApprove = async () => {
    setLoading(true);
    try {
      const url = commentId
        ? `/posts/${postId}/social-comments/${commentId}/reply`
        : `/posts/${postId}/social-comments`;
      const res = await fetch(url, {
        method: 'POST',
        // The org output guardrail is always enforced server-side on approve; the
        // human approval is the trust boundary. `guardrail` is deprecated/ignored but
        // sent for wire back-compat (see commentReply tool: ui sessions only draft).
        body: JSON.stringify({ message, guardrail: true }),
      });
      if (!res.ok) {
        // Extract the 422 GuardrailViolation reason from the JSON body, not statusText.
        throw new Error(
          await errorMessageFromResponse(res, t('failed_to_send', 'Failed to send reply'))
        );
      }
      toaster.show(t('reply_sent', 'Reply sent'), 'success');
      onRespond({ sent: true });
    } catch (err: any) {
      toaster.show(err.message || t('failed_to_send', 'Failed to send reply'), 'warning');
      onRespond({ error: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-[10px] border border-newBorder bg-newBgColor p-[14px] my-[8px] max-w-[520px]">
      <div className="text-[13px] font-[600] text-textColor mb-[8px]">
        {t('confirm_comment_reply', 'Confirm comment reply')}
      </div>
      <div className="text-[12px] text-newTableText mb-[6px]">
        {commentId
          ? t('replying_to_comment', 'Replying to comment {{commentId}} on post {{postId}}', {
              commentId,
              postId,
            })
          : t('posting_top_level_comment', 'Posting a top-level comment on post {{postId}}', {
              postId,
            })}
      </div>
      <div className="rounded-[8px] border border-newTableBorder bg-newBgColorInner p-[10px] text-[13px] text-textColor mb-[12px] whitespace-pre-wrap">
        {message}
      </div>
      <div className="flex gap-[8px] justify-end">
        <button
          type="button"
          disabled={loading}
          onClick={() => onRespond({ cancelled: true })}
          className="text-[12px] text-newTableText hover:text-textColor px-[12px] py-[6px] disabled:opacity-50"
        >
          {t('reject', 'Reject')}
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={handleApprove}
          className="bg-btnPrimary text-white text-[12px] rounded-[6px] px-[14px] py-[6px] disabled:opacity-50"
        >
          {loading ? t('sending', 'Sending...') : t('approve', 'Approve')}
        </button>
      </div>
    </div>
  );
};

const ConfirmMediaStudioGenerateCard: FC<{
  args: {
    provider: string;
    operation: string;
    model?: string;
    input?: object;
    mediaInputs?: object;
    folderId?: string;
  };
  onRespond: (value: any) => void;
}> = ({ args, onRespond }) => {
  const fetch = useFetch();
  const toaster = useToaster();
  const t = useT();
  const [loading, setLoading] = useState(false);

  const handleApprove = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/media/studio/${args.provider}/generate`, {
        method: 'POST',
        body: JSON.stringify({
          operation: args.operation,
          model: args.model,
          input: (args.input || {}) as Record<string, unknown>,
          mediaInputs: args.mediaInputs,
          folderId: args.folderId,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || t('generation_failed', 'Generation failed'));
      }
      const data = await res.json();
      toaster.show(t('generation_submitted', 'Generation submitted'), 'success');
      onRespond({ jobId: data.jobId, status: data.status });
    } catch (err: any) {
      toaster.show(err.message || t('generation_failed', 'Generation failed'), 'warning');
      onRespond({ error: err.message });
    } finally {
      setLoading(false);
    }
  };

  const input = args.input as Record<string, unknown> | undefined;
  const prompt =
    typeof input?.prompt === 'string'
      ? input.prompt
      : typeof input?.text === 'string'
      ? input.text
      : undefined;

  return (
    <div className="rounded-[10px] border border-newBorder bg-newBgColor p-[14px] my-[8px] max-w-[520px]">
      <div className="text-[13px] font-[600] text-textColor mb-[8px]">
        {t('confirm_media_generation', 'Confirm media generation')}
      </div>
      <div className="grid grid-cols-[100px_1fr] gap-y-[4px] text-[12px] mb-[12px]">
        <div className="text-newTableText">{t('provider', 'Provider')}</div>
        <div className="text-textColor">{args.provider}</div>
        <div className="text-newTableText">{t('operation', 'Operation')}</div>
        <div className="text-textColor capitalize">{args.operation}</div>
        {args.model && (
          <>
            <div className="text-newTableText">{t('model', 'Model')}</div>
            <div className="text-textColor">{args.model}</div>
          </>
        )}
        {prompt && (
          <>
            <div className="text-newTableText">{t('prompt', 'Prompt')}</div>
            <div className="text-textColor truncate" title={prompt}>
              {prompt}
            </div>
          </>
        )}
      </div>
      <div className="flex gap-[8px] justify-end">
        <button
          type="button"
          disabled={loading}
          onClick={() => onRespond({ cancelled: true })}
          className="text-[12px] text-newTableText hover:text-textColor px-[12px] py-[6px] disabled:opacity-50"
        >
          {t('reject', 'Reject')}
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={handleApprove}
          className="bg-btnPrimary text-white text-[12px] rounded-[6px] px-[14px] py-[6px] disabled:opacity-50"
        >
          {loading ? t('submitting', 'Submitting...') : t('approve', 'Approve')}
        </button>
      </div>
    </div>
  );
};

// Keyed by the tool `name` the stream actually emits. These MUST stay in lockstep
// with the backend tool-name arrays (`CONTENT/MEDIA/ANALYTICS/OPS_TOOL_NAMES` in
// `@gitroom/nestjs-libraries/chat/agents/*.agent` and `SUPERVISOR_TOOL_NAMES` in
// `load.tools.service`) — those modules pull heavy server deps, so we can't import
// them into the client bundle; `agent.chat.spec.tsx` reads them off disk and fails
// on any drift instead. Under the supervisor the top-level stream emits the
// delegation tools `agent-<specialist>` (Mastra names sub-agent tools
// `agent-${agentName}`), so those are mapped too.
export const SPECIALIST_BY_TOOL: Record<string, string> = {
  // content (CONTENT_TOOL_NAMES)
  generatePostContent: 'content',
  runGenerator: 'content',
  runContentPipeline: 'content',
  ragSearch: 'content',
  brandMemorySearch: 'content',
  brandProfile: 'content',
  brandMemoryReindex: 'content',
  // media (MEDIA_TOOL_NAMES)
  listMediaProviders: 'media',
  listMediaModels: 'media',
  mediaStudioGenerate: 'media',
  mediaJobStatus: 'media',
  generateImageTool: 'media',
  generateVideoTool: 'media',
  uploadFromUrlTool: 'media',
  designerDesign: 'media',
  filesSearch: 'media',
  stockSearch: 'media',
  // analytics (ANALYTICS_TOOL_NAMES)
  analyticsOverview: 'analytics',
  bestTime: 'analytics',
  recommendations: 'analytics',
  analyticsPost: 'analytics',
  watchlist: 'analytics',
  // ops (OPS_TOOL_NAMES)
  integrationSchema: 'ops',
  triggerTool: 'ops',
  schedulePostTool: 'ops',
  listPosts: 'ops',
  getPost: 'ops',
  reschedulePost: 'ops',
  deletePost: 'ops',
  approveDraft: 'ops',
  campaignCreate: 'ops',
  campaignUpdate: 'ops',
  campaignDashboard: 'ops',
  campaignTag: 'ops',
  commentsInbox: 'ops',
  commentReply: 'ops',
  // supervisor-held (SUPERVISOR_TOOL_NAMES) + the frontend-only manual composer
  integrationList: 'ops',
  groupList: 'ops',
  manualPosting: 'ops',
  // delegation tools emitted by the supervisor
  'agent-content': 'content',
  'agent-media': 'media',
  'agent-analytics': 'analytics',
  'agent-ops': 'ops',
};

// Delegation tools (`agent-<specialist>`) return `{ text, subAgentToolResults }`,
// where each entry is `{ toolName, result, args }` — the useful ids live on those
// inner results. Kept as module-level pure helpers so the memos that call them
// stay simple enough for the React Compiler to preserve their memoization.
type ToolSummary = { label: string; value: string } | null;

const delegatedIdSummary = (
  result: any,
  t: (key: string, fallback: string) => string
): ToolSummary => {
  const subResults = Array.isArray(result?.subAgentToolResults)
    ? result.subAgentToolResults
    : [];
  for (const sub of subResults) {
    const r = sub?.result;
    if (r?.jobId) return { label: t('media_job', 'Media job'), value: r.jobId };
    if (r?.platformCommentId) {
      return { label: t('comment_id', 'Comment id'), value: r.platformCommentId };
    }
    if (r?.id) return { label: t('id', 'Id'), value: r.id };
  }
  return null;
};

const resolveMediaJob = (
  name: string,
  result: any,
  args: any
): { provider: string; jobId: string } | null => {
  if (name === 'mediaStudioGenerate' && result?.jobId) {
    return { provider: args?.provider, jobId: result.jobId as string };
  }
  const subResults = Array.isArray(result?.subAgentToolResults)
    ? result.subAgentToolResults
    : [];
  for (const sub of subResults) {
    if (sub?.toolName === 'mediaStudioGenerate' && sub?.result?.jobId) {
      return { provider: sub?.args?.provider, jobId: sub.result.jobId as string };
    }
  }
  return null;
};

// A draft awaiting human approval. Outward tools (commentReply / mediaStudioGenerate)
// NEVER dispatch in a UI session — they return `{ needsConfirmation, draft }`. Under
// the supervisor topology those calls are delegated, so the draft arrives nested in
// `subAgentToolResults` where CopilotKit's `renderAndWaitForResponse` cards can't
// fire. Surface every such draft here with an out-of-band approve/reject that
// dispatches via the REST route (the human click is the trust boundary).
type PendingDraft =
  | { key: string; kind: 'comment'; draft: { action: string; postId: string; commentId?: string; message: string } }
  | { key: string; kind: 'media'; draft: { provider: string; operation: string; model?: string; input?: Record<string, unknown>; mediaInputs?: Record<string, string>; folderId?: string } };

const asPendingDraft = (raw: any, idx: number): PendingDraft | null => {
  if (!raw || raw.needsConfirmation !== true || !raw.draft) return null;
  const d = raw.draft;
  if (typeof d.provider === 'string' && typeof d.operation === 'string') {
    return { key: `media:${d.provider}:${d.operation}:${idx}`, kind: 'media', draft: d };
  }
  if (typeof d.postId === 'string' && typeof d.message === 'string') {
    return { key: `comment:${d.postId}:${d.commentId ?? ''}:${idx}`, kind: 'comment', draft: d };
  }
  return null;
};

const extractPendingDrafts = (result: any): PendingDraft[] => {
  const out: PendingDraft[] = [];
  const top = asPendingDraft(result, 0);
  if (top) out.push(top);
  const subResults = Array.isArray(result?.subAgentToolResults)
    ? result.subAgentToolResults
    : [];
  subResults.forEach((sub: any, i: number) => {
    const p = asPendingDraft(sub?.result, i + 1);
    if (p) out.push(p);
  });
  return out;
};

const ToolCallCard: FC<{
  name: string;
  args: any;
  status: string;
  result: any;
}> = ({ name, args, status, result }) => {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const details = useMemo(
    () => JSON.stringify({ args, result }, null, 2),
    [args, result]
  );
  const specialist = SPECIALIST_BY_TOOL[name];

  const pendingDrafts = useMemo(() => extractPendingDrafts(result), [result]);

  const summary = useMemo(() => {
    if (name === 'mediaStudioGenerate' && result?.jobId) {
      return { label: t('media_job', 'Media job'), value: result.jobId };
    }
    if (name === 'commentReply' && result?.platformCommentId) {
      return { label: t('comment_id', 'Comment id'), value: result.platformCommentId };
    }
    if (name === 'campaignCreate' && result?.id) {
      return { label: t('campaign_id', 'Campaign id'), value: result.id };
    }
    if (name === 'analyticsOverview' && result?.url) {
      return { label: t('analytics', 'Analytics'), value: result.url };
    }
    if (result?.jobId) {
      return { label: t('job_id', 'Job id'), value: result.jobId };
    }
    if (result?.id) {
      return { label: t('id', 'Id'), value: result.id };
    }
    // Surface the first meaningful id from a delegated specialist's tool calls.
    return delegatedIdSummary(result, t);
  }, [name, result, t]);

  // A media job may be produced directly (flat mode) or inside a delegated run.
  const mediaJob = useMemo(
    () => resolveMediaJob(name, result, args),
    [name, result, args]
  );

  return (
    <div className="rounded-[10px] border border-newBorder bg-newBgColor p-[12px] my-[6px] max-w-[520px]">
      <div className="flex items-center justify-between gap-[10px]">
        <div className="text-[13px] font-[600] text-textColor truncate">
          {specialist && (
            <span className="text-[10px] uppercase tracking-wider text-newTableText mr-[6px]">
              {specialist}
            </span>
          )}
          {t('tool_call', 'Tool')}: {name}
        </div>
        <span
          className={`shrink-0 text-[10px] font-[600] px-[7px] py-[2px] rounded-full ${
            status === 'complete'
              ? 'text-green-500 bg-green-500/10'
              : status === 'executing'
              ? 'text-amber-600 bg-amber-500/10'
              : 'text-newTableText bg-newBgColorInner'
          }`}
        >
          {status}
        </span>
      </div>
      {summary && (
        <div className="mt-[8px] text-[11px] text-newTableText">
          {summary.label}: <span className="text-textColor font-mono">{summary.value}</span>
        </div>
      )}
      {mediaJob && (
        <MediaJobStatusCard provider={mediaJob.provider} jobId={mediaJob.jobId} />
      )}
      {pendingDrafts.map((p) => (
        <PendingApprovalCard key={p.key} pending={p} />
      ))}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="mt-[8px] text-[11px] text-btnPrimaryAccent hover:underline"
      >
        {expanded ? t('hide_details', 'Hide details') : t('show_details', 'Show details')}
      </button>
      {expanded && (
        <div className="mt-[8px] text-[11px] text-newTableText overflow-auto max-h-[200px]">
          <pre className="whitespace-pre-wrap break-words">{details}</pre>
        </div>
      )}
    </div>
  );
};

// Out-of-band approval for a delegated draft. The agent's turn is already complete
// (the sub-agent returned the draft as its result); approving here dispatches the
// outward action via its REST route — the human click, not any model output, is the
// authorization. Local state resolves the card so it can't be double-submitted.
// Pull a human message out of a Nest error Response body ({message}/{error}),
// falling back to raw text then a generic label — so a 422 GuardrailViolation shows
// its reason (from the JSON body, not the generic statusText) instead of "Action
// failed" (3.1).
const errorMessageFromResponse = async (
  res: Response,
  fallback: string,
): Promise<string> => {
  const text = await res.text().catch(() => '');
  if (!text) return fallback;
  try {
    const body = JSON.parse(text);
    const msg = body?.message ?? body?.error;
    if (Array.isArray(msg)) return msg.join(', ') || fallback;
    if (typeof msg === 'string' && msg) return msg;
  } catch {
    /* not JSON — fall through to raw text */
  }
  return text || fallback;
};

// `crypto.randomUUID` only exists in a secure context (https or localhost); fall
// back so the approve card never crashes on a plain-http dev origin. An idempotency
// key needs uniqueness, not cryptographic strength.
function makeIdempotencyKey(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through to the non-crypto fallback */
  }
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export const PendingApprovalCard: FC<{ pending: PendingDraft }> = ({ pending }) => {
  const fetch = useFetch();
  const toaster = useToaster();
  const t = useT();
  const [loading, setLoading] = useState(false);
  const [resolved, setResolved] = useState<'sent' | 'rejected' | null>(null);
  // One idempotency key per card: a retry after an ambiguous failure (the POST
  // succeeded server-side but the client saw a timeout) re-sends the SAME key, so
  // the server short-circuits and cannot double-dispatch a comment / start a second
  // paid media job (3.2). Stable for this card's whole lifetime.
  const idempotencyKey = useRef(makeIdempotencyKey()).current;

  const approve = async () => {
    setLoading(true);
    try {
      if (pending.kind === 'comment') {
        const d = pending.draft;
        const url = d.commentId
          ? `/posts/${d.postId}/social-comments/${d.commentId}/reply`
          : `/posts/${d.postId}/social-comments`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'X-Idempotency-Key': idempotencyKey },
          // The org output guardrail is now always enforced server-side; the
          // deprecated `guardrail` flag is ignored but sent for wire back-compat.
          body: JSON.stringify({ message: d.message, guardrail: true }),
        });
        if (!res.ok) {
          throw new Error(
            await errorMessageFromResponse(res, t('action_failed', 'Action failed'))
          );
        }
        toaster.show(t('reply_sent', 'Reply sent'), 'success');
      } else {
        const d = pending.draft;
        const res = await fetch(`/media/studio/${d.provider}/generate`, {
          method: 'POST',
          headers: { 'X-Idempotency-Key': idempotencyKey },
          body: JSON.stringify({
            operation: d.operation,
            model: d.model,
            input: (d.input || {}) as Record<string, unknown>,
            mediaInputs: d.mediaInputs,
            folderId: d.folderId,
          }),
        });
        if (!res.ok) {
          throw new Error(
            await errorMessageFromResponse(res, t('action_failed', 'Action failed'))
          );
        }
        toaster.show(t('generation_submitted', 'Generation submitted'), 'success');
      }
      setResolved('sent');
    } catch (err: any) {
      toaster.show(err.message || t('action_failed', 'Action failed'), 'warning');
    } finally {
      setLoading(false);
    }
  };

  if (resolved) {
    return (
      <div className="mt-[8px] text-[11px] text-newTableText">
        {resolved === 'sent'
          ? t('approved_and_sent', 'Approved and sent')
          : t('rejected', 'Rejected')}
      </div>
    );
  }

  const title =
    pending.kind === 'comment'
      ? t('confirm_comment_reply', 'Confirm comment reply')
      : t('confirm_media_generation', 'Confirm media generation');

  return (
    <div className="mt-[8px] rounded-[8px] border border-amber-500/40 bg-amber-500/5 p-[10px]">
      <div className="text-[12px] font-[600] text-textColor mb-[6px]">{title}</div>
      {pending.kind === 'comment' ? (
        <div className="rounded-[6px] border border-newTableBorder bg-newBgColorInner p-[8px] text-[12px] text-textColor mb-[8px] whitespace-pre-wrap">
          {pending.draft.message}
        </div>
      ) : (
        <>
          {typeof pending.draft.input?.prompt === 'string' &&
            pending.draft.input.prompt && (
              // Show the prompt the user is approving — a paid generation must not
              // be approved blind on just provider·operation·model (3.2).
              <div className="rounded-[6px] border border-newTableBorder bg-newBgColorInner p-[8px] text-[12px] text-textColor mb-[8px] whitespace-pre-wrap">
                {pending.draft.input.prompt as string}
              </div>
            )}
          <div className="text-[12px] text-newTableText mb-[8px]">
            {pending.draft.provider} · {pending.draft.operation}
            {pending.draft.model ? ` · ${pending.draft.model}` : ''}
          </div>
        </>
      )}
      <div className="flex gap-[8px] justify-end">
        <button
          type="button"
          disabled={loading}
          onClick={() => setResolved('rejected')}
          className="text-[12px] text-newTableText hover:text-textColor px-[10px] py-[5px] disabled:opacity-50"
        >
          {t('reject', 'Reject')}
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={approve}
          className="bg-btnPrimary text-white text-[12px] rounded-[6px] px-[12px] py-[5px] disabled:opacity-50"
        >
          {loading ? t('sending', 'Sending...') : t('approve', 'Approve')}
        </button>
      </div>
    </div>
  );
};

const MediaJobStatusCard: FC<{ provider: string; jobId: string }> = ({
  provider,
  jobId,
}) => {
  const fetch = useFetch();
  const t = useT();
  const { data: jobs } = useSWR(
    `studio-jobs:${provider}`,
    async () => {
      const res = await fetch(`/media/studio/${provider}/jobs`);
      return (await res.json()) as Array<{
        id: string;
        status: 'pending' | 'processing' | 'completed' | 'failed';
        error: string | null;
        artifactUrl: string | null;
        fileId: string | null;
        operation: string;
      }>;
    },
    {
      // Stop polling once this job reaches a terminal state.
      refreshInterval: (latest) => {
        const current = latest?.find((j) => j.id === jobId);
        return current && (current.status === 'completed' || current.status === 'failed')
          ? 0
          : 5000;
      },
    }
  );

  const job = jobs?.find((j) => j.id === jobId);
  if (!job) return null;

  return (
    <div className="mt-[8px] text-[11px] text-newTableText">
      {t('job_status', 'Job status')}:{' '}
      <span
        className={`font-[600] ${
          job.status === 'completed'
            ? 'text-green-500'
            : job.status === 'failed'
            ? 'text-red-500'
            : 'text-amber-600'
        }`}
      >
        {job.status}
      </span>
      {job.status === 'completed' && job.artifactUrl && (
        <Link
          href={`/files?highlight=${job.fileId || ''}`}
          className="ml-[8px] text-btnPrimaryAccent hover:underline"
        >
          {t('view_in_library', 'View in library')}
        </Link>
      )}
      {job.status === 'failed' && job.error && (
        <div className="text-red-600 dark:text-red-400 mt-[4px]">{job.error}</div>
      )}
    </div>
  );
};

const OpenModal: FC<{
  respond: (value: any) => void;
  args: {
    list: {
      integrationId: string;
      date: string;
      settings?: Record<string, any>;
      posts: { content: string; attachments: { id: string; path: string }[] }[];
    }[];
  };
}> = ({ args, respond }) => {
  const modals = useModals();
  const { properties } = useContext(PropertiesContext);
  const t = useT();

  // CopilotKit can re-render the executing tool; the fallback div and the modal
  // sequence both call respond — guard so only the first wins (a double respond
  // corrupts the run).
  const respondedRef = useRef(false);
  const safeRespond = useCallback(
    (value: any) => {
      if (respondedRef.current) {
        return;
      }
      respondedRef.current = true;
      respond(value);
    },
    [respond]
  );

  const startModal = useCallback(async () => {
    let scheduled = 0;
    for (const integration of args.list) {
      // `mutate` fires only when the composer actually schedules; `customClose`
      // fires on dismiss. Track the difference so we don't tell the model
      // "scheduled" when the user simply closed the modal.
      const didSchedule = await new Promise<boolean>((res) => {
        const group = makeId(10);
        modals.openModal({
          id: 'add-edit-modal',
          closeOnClickOutside: false,
          removeLayout: true,
          closeOnEscape: false,
          withCloseButton: false,
          askClose: true,
          size: '80%',
          title: ``,
          classNames: {
            modal: 'w-[100%] max-w-[1400px] text-textColor',
          },
          children: (
            <ExistingDataContextProvider
              value={{
                group,
                integration: integration.integrationId,
                integrationPicture:
                  properties.find((p) => p.id === integration.integrationId)
                    ?.picture || '',
                settings: integration.settings || {},
                posts: integration.posts.map((p) => ({
                  content: p.content,
                  createdAt: new Date().toISOString(),
                  state: 'DRAFT',
                  id: makeId(10),
                  settings: JSON.stringify(integration.settings || {}),
                  group,
                  integrationId: integration.integrationId,
                  integration: properties.find(
                    (p) => p.id === integration.integrationId
                  ),
                  publishDate: dayjs.utc(integration.date).toISOString(),
                  image: p.attachments.map((a) => ({
                    id: a.id,
                    path: a.path,
                  })),
                })),
              }}
            >
              <Composer
                date={dayjs.utc(integration.date)}
                allIntegrations={properties}
                integrations={properties.filter(
                  (p) => p.id === integration.integrationId
                )}
                onlyValues={integration.posts.map((p) => ({
                  content: p.content,
                  id: makeId(10),
                  settings: integration.settings || {},
                  image: p.attachments.map((a) => ({
                    id: a.id,
                    path: a.path,
                  })),
                }))}
                reopenModal={() => {}}
                mutate={() => res(true)}
                customClose={() => res(false)}
              />
            </ExistingDataContextProvider>
          ),
        });
      });
      if (didSchedule) {
        scheduled += 1;
      }
    }

    if (scheduled === 0) {
      safeRespond('User closed the composer without scheduling any posts.');
    } else if (scheduled === args.list.length) {
      safeRespond('User scheduled all the posts.');
    } else {
      safeRespond(`User scheduled ${scheduled} of ${args.list.length} posts.`);
    }
  }, [args, safeRespond, properties, modals]);

  // The modal sequence must start exactly once on mount — guard with a ref so
  // the dependency list can stay exhaustive without reopening the modals.
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;
    startModal();
  }, [startModal]);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => safeRespond('continue')}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          safeRespond('continue');
        }
      }}
    >
      {t('opening_composer', 'Opening the composer…')}
    </div>
  );
};
