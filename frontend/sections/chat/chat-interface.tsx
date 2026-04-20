"use client";

import { PresentationChoiceCard } from "@/components/chat/presentation-choice-card";
import { ThinkingBlock } from "@/components/chat/thinking-block";
import {
  WorkflowResultCard,
  WorkflowTraceDialog,
  shouldRenderWorkflowResultCard,
} from "@/components/chat/workflow-trace-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HyperText } from "@/components/ui/hyper-text";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  addSupervisorMessage,
  closeWorkflowTraceDialog,
  fetchSupervisorWorkflowTraceDetail,
  fetchSupervisorWorkflowTraces,
  openWorkflowTraceDialog,
  resolvePresentationPrompt,
  sendSupervisorMessage,
  stopSupervisorRun,
} from "@/lib/features/chat/chatSlice";
import {
  getOrchestrationLabel,
  getWorkflowTraceTimestamp,
  hasLeaderAgent,
  isTerminalWorkflowStatus,
  supportsDirectTargeting,
} from "@/lib/features/chat/workflowTypes";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import {
  Network,
  Send,
  StopCircle,
  UserCog,
} from "lucide-react";
import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type TimelineItem =
  | { type: "message"; id: string; timestamp: number }
  | { type: "workflow"; id: string; timestamp: number };

const ChatInput = React.memo(function ChatInput({
  onSend,
  onStop,
  inputDisabled,
  showStop,
  isStopping,
  stopDisabled,
  sessionKey,
}: {
  onSend: (message: string) => void;
  onStop: () => void;
  inputDisabled: boolean;
  showStop: boolean;
  isStopping: boolean;
  stopDisabled: boolean;
  sessionKey: string;
}) {
  const [value, setValue] = React.useState("");
  const inputRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    setValue("");
  }, [sessionKey]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !inputDisabled) {
        onSend(value);
        setValue("");
      }
    }
  };

  return (
    <div className="max-w-4xl mx-auto relative flex items-center gap-2">
      <Textarea
        ref={inputRef}
        placeholder="Give instructions to the team..."
        className="pr-12 py-3 min-h-14 max-h-48 rounded-2xl border-gray-200 shadow-sm focus-visible:ring-indigo-400 resize-none overflow-y-auto"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={inputDisabled}
      />
      {showStop ? (
        <Button
          size="icon"
          variant="outline"
          className="absolute right-2 h-10 w-10 rounded-full border-red-200 bg-white text-red-600 shadow-sm hover:bg-red-50 hover:text-red-700"
          onClick={onStop}
          disabled={isStopping || stopDisabled}
        >
          <StopCircle className="h-4 w-4" />
        </Button>
      ) : (
        <Button
          size="icon"
          className="absolute right-2 h-10 w-10 rounded-full bg-indigo-600 text-white shadow-sm hover:bg-indigo-700"
          onClick={() => {
            if (value.trim() && !inputDisabled) {
              onSend(value);
              setValue("");
            }
          }}
          disabled={inputDisabled || !value.trim()}
        >
          <Send className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
});

function formatWorkflowSummaryText(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (!normalized || normalized.includes("\n") || !normalized.includes(";")) {
    return content;
  }

  const parts = normalized
    .split(/;\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return content;
  }

  const first = parts[0];
  const match = first.match(/^(.*?workflow completed\.)\s+(.+?:\s+.+)$/i);
  if (match) {
    return [match[1], match[2], ...parts.slice(1)].join("\n");
  }

  return parts.join("\n");
}

const assistantMarkdownClassName =
  "text-xs leading-5 sm:text-sm sm:leading-relaxed text-gray-800 prose prose-sm prose-gray max-w-none min-w-0 overflow-hidden wrap-anywhere [overflow-wrap:anywhere] break-words flex flex-col gap-2 sm:gap-3 prose-p:my-0 prose-headings:my-0 prose-headings:text-base sm:prose-headings:text-lg prose-headings:leading-snug prose-headings:font-semibold prose-ul:my-0 prose-ol:my-0 prose-li:my-0 prose-li:text-inherit prose-code:bg-slate-100 prose-code:rounded-md prose-code:px-1.5 prose-code:py-0.5 prose-code:text-indigo-600 prose-code:font-semibold prose-code:before:content-none prose-code:after:content-none [&_a]:break-all [&_code]:break-all [&_pre]:max-w-full [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-indigo-700 [&_pre_code]:font-medium prose-pre:text-sm sm:prose-pre:text-base prose-pre:bg-indigo-50/50 prose-pre:text-indigo-700 prose-pre:shadow-sm prose-pre:border prose-pre:border-indigo-100/50 prose-pre:rounded-xl prose-pre:overflow-x-auto";

const chatViewportClassName =
  "overflow-x-hidden [scrollbar-gutter:stable] [scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.75)_transparent] [&::-webkit-scrollbar]:w-2.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:border-[3px] [&::-webkit-scrollbar-thumb]:border-transparent [&::-webkit-scrollbar-thumb]:bg-slate-300/85 [&::-webkit-scrollbar-thumb]:bg-clip-padding hover:[&::-webkit-scrollbar-thumb]:bg-slate-400/90";

export function ChatInterface() {
  const dispatch = useAppDispatch();
  const {
    messages,
    execSessionId,
    activeRunId,
    runStatus,
    isWorkflowRunning,
    isStopping,
    isLoading,
    streamingContent,
    isStreaming,
    thinkingContent,
    isThinking,
    executionAgents,
    selectedAgentId,
    streamingAgentId,
    orchestrationType,
    workflowTraces,
    activeWorkflowTraceId,
    isWorkflowDialogOpen,
    isWorkflowTraceLoading,
  } = useAppSelector((state) => state.chat.supervisor);
  const { executionSessions } = useAppSelector((state) => state.agent);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const canDirectTarget = supportsDirectTargeting(orchestrationType) && !hasLeaderAgent(executionAgents);
  const selectedAgent = canDirectTarget && selectedAgentId
    ? executionAgents.find((agent) => agent.id === selectedAgentId)
    : null;
  // When a leader is pre-selected (canDirectTarget is false), surface it as a routing hint.
  const routingLeader = !canDirectTarget && selectedAgentId
    ? (executionAgents.find((a) => a.id === selectedAgentId && a.is_leader) ?? null)
    : null;
  const streamingAgentRole = executionAgents.find(
    (agent) => agent.id === streamingAgentId,
  )?.role;
  const currentSession = executionSessions.find(
    (session) => session.session_id === execSessionId,
  );
  const sessionTitle =
    currentSession?.title ||
    (execSessionId ? `Session ${execSessionId.substring(0, 8)}` : "Agent Team");
  const activeWorkflowTrace = workflowTraces.find(
    (trace) => trace.trace_id === activeWorkflowTraceId,
  ) ?? null;
  const latestMessage = messages.at(-1) ?? null;
  const showInlineStop =
    (runStatus === "active" || runStatus === "stopping") &&
    (isWorkflowRunning || isLoading || isStreaming || !!activeRunId);

  const timelineItems = React.useMemo<TimelineItem[]>(() => {
    const messageItems = messages.map((message) => ({
      type: "message" as const,
      id: message.id,
      timestamp: message.timestamp,
    }));
    const workflowItems = workflowTraces
      .filter(shouldRenderWorkflowResultCard)
      .map((trace) => ({
        type: "workflow" as const,
        id: trace.trace_id,
        timestamp: getWorkflowTraceTimestamp(trace),
      }));

    return [...messageItems, ...workflowItems].sort((left, right) => {
      if (left.timestamp !== right.timestamp) {
        return left.timestamp - right.timestamp;
      }

      return left.id.localeCompare(right.id);
    });
  }, [messages, workflowTraces]);
  const latestTimelineItem = timelineItems.at(-1) ?? null;
  const isAwaitingVisibleTurnResponse =
    latestTimelineItem?.type === "message" &&
    latestMessage?.role === "user" &&
    latestTimelineItem.id === latestMessage.id;
  const showWaitingBubble =
    isAwaitingVisibleTurnResponse &&
    !isStreaming &&
    ((isWorkflowRunning && !isThinking && !thinkingContent) ||
      (isLoading && !isThinking && !thinkingContent) ||
      (isThinking && !thinkingContent));

  const avatarLabel = (agentRole?: string): string =>
    (agentRole ?? "AG").slice(0, 2).toUpperCase();

  React.useEffect(() => {
    if (!execSessionId) {
      return;
    }

    dispatch(fetchSupervisorWorkflowTraces({ sessionId: execSessionId }));
  }, [dispatch, execSessionId]);

  const cookingPhrases = [
    "🔍 Searching through documentation...",
    "🧠 Analyzing context and requirements...",
    "⚙️ Configuring agent capabilities...",
    "🛠️ Preparing specialized tools...",
    "📡 Establishing data connections...",
    "🔐 Securing session environment...",
    "✨ Refining response quality...",
    "🥘 Cooking up the perfect answer...",
  ];
  const [cookingIdx, setCookingIdx] = React.useState(0);

  // Auto-scroll to bottom
  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [timelineItems, streamingContent, thinkingContent, isThinking]);


  React.useEffect(() => {
    if ((!isLoading && !isWorkflowRunning) || isStreaming) return;
    const interval = setInterval(() => {
      setCookingIdx((i) => (i + 1) % cookingPhrases.length);
    }, 2000);
    return () => clearInterval(interval);
  }, [isLoading, isStreaming, isWorkflowRunning, cookingPhrases.length]);

  const handleOpenWorkflowTrace = (traceId: string) => {
    const trace = workflowTraces.find((item) => item.trace_id === traceId);
    dispatch(openWorkflowTraceDialog(traceId));
    if (!trace || (trace.nodes.length === 0 && isTerminalWorkflowStatus(trace.status))) {
      dispatch(fetchSupervisorWorkflowTraceDetail({ traceId }));
    }
  };

  const handleSendMessage = (message: string) => {
    if (!message.trim() || isLoading || isStreaming) return;
    dispatch(
      addSupervisorMessage({
        id: Date.now().toString(),
        role: "user",
        content: message,
      }),
    );

    setTimeout(() => {
      // Focus handled in Child component
    }, 100);

    if (execSessionId) {
      dispatch(
        sendSupervisorMessage({
          message,
          sessionId: execSessionId,
          targetAgentId: canDirectTarget ? selectedAgentId ?? undefined : undefined,
        }),
      );
    }
  };

  const handleStopRun = () => {
    if (!showInlineStop || isStopping) {
      return;
    }

    dispatch(stopSupervisorRun());
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden h-full">
      <div className="glass border-b border-white/20 pl-16 pr-16 lg:px-6 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 bg-indigo-500/15 rounded-full flex items-center justify-center text-indigo-600">
            <UserCog size={24} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900 truncate max-w-30 sm:max-w-none">
              {selectedAgent ? selectedAgent.role : sessionTitle}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-green-600">
              <span
                className={cn(
                  "h-2 w-2 rounded-full shrink-0",
                  execSessionId ? "bg-green-500" : "bg-gray-400",
                )}
              />
              <span className="truncate">
                {selectedAgent
                  ? selectedAgent.goal
                  : execSessionId
                    ? canDirectTarget
                      ? "Active"
                      : `${getOrchestrationLabel(orchestrationType)} manages routing for this session`
                    : "No session selected"}
              </span>
              {routingLeader && (
                <Badge variant="secondary" className="rounded-full bg-emerald-100/80 text-emerald-700">
                  Routing via {routingLeader.role}
                </Badge>
              )}
              {execSessionId && !canDirectTarget && !routingLeader ? (
                <Badge variant="secondary" className="rounded-full bg-indigo-100/80 text-indigo-700">
                  Direct target disabled
                </Badge>
              ) : null}
            </div>
          </div>
        </div>
        {showInlineStop ? (
          <Badge
            variant="secondary"
            className="rounded-full bg-red-100/80 px-3 py-1 text-red-700"
          >
            {isStopping ? "Stopping run" : "Run active"}
          </Badge>
        ) : null}
      </div>

      <div className="flex-1 flex flex-col bg-white/20 backdrop-blur-sm overflow-hidden">
        <ScrollArea className="flex-1" viewportClassName={chatViewportClassName}>
          <div className="mx-auto max-w-4xl space-y-5 overflow-x-hidden px-3 py-3 sm:space-y-6 sm:px-6 sm:py-6" role="log" aria-label="Team conversation" aria-live="polite" aria-relevant="additions text" aria-busy={isLoading || isStreaming || isThinking}>
            {timelineItems.map((item) => {
              if (item.type === "workflow") {
                const trace = workflowTraces.find((entry) => entry.trace_id === item.id);
                if (!trace) {
                  return null;
                }

                return (
                  <div key={trace.trace_id} className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <WorkflowResultCard
                      trace={trace}
                      onOpen={() => handleOpenWorkflowTrace(trace.trace_id)}
                    />
                  </div>
                );
              }

              const message = messages.find((entry) => entry.id === item.id);
              if (!message) {
                return null;
              }

              if (message.role === "presentation_prompt") {
                return (
                  <div
                    key={message.id}
                    className="flex gap-4 animate-in fade-in slide-in-from-bottom-2 duration-300"
                  >
                    <Avatar className="h-10 w-10 shrink-0">
                      <AvatarFallback className="bg-indigo-100 text-indigo-600">
                        {avatarLabel(message.agentRole)}
                      </AvatarFallback>
                    </Avatar>
                    <PresentationChoiceCard
                      question={message.question ?? ""}
                      promptId={message.promptId ?? ""}
                      originalMessage={message.originalMessage ?? ""}
                      sessionId={execSessionId ?? ""}
                      onChoose={(choice) => {
                        if (!execSessionId) return;
                        dispatch(
                          resolvePresentationPrompt({
                            promptId: message.promptId ?? "",
                            choice,
                            originalMessage: message.originalMessage ?? "",
                            sessionId: execSessionId,
                          }),
                        );
                      }}
                    />
                  </div>
                );
              }

              const renderedContent =
                message.role === "assistant"
                  ? formatWorkflowSummaryText(message.content)
                  : message.content;

              return (
                <div
                  key={message.id}
                  className={cn(
                    "flex w-full min-w-0 gap-2.5 sm:gap-4 animate-in fade-in slide-in-from-bottom-2 duration-300",
                    message.role === "assistant" ? "flex-row" : "flex-row-reverse",
                  )}
                >
                  <Avatar className="h-10 w-10 shrink-0">
                    {message.role === "assistant" ? (
                      <AvatarFallback className="bg-indigo-100 text-indigo-600">
                        {avatarLabel(message.agentRole)}
                      </AvatarFallback>
                    ) : (
                      <AvatarFallback className="bg-slate-200">ME</AvatarFallback>
                    )}
                  </Avatar>
                  {message.role === "assistant" ? (
                    <div className="flex w-full max-w-[85%] min-w-0 flex-col gap-2">
                      {message.agentRole && (
                        <span className="inline-flex items-center self-start text-xs font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 mb-1">
                          {message.agentRole}
                        </span>
                      )}
                      <div className="flex w-full max-w-full flex-col overflow-hidden bg-transparent px-0 py-0 text-gray-800 shadow-none">
                        <div className={assistantMarkdownClassName}>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {renderedContent}
                          </ReactMarkdown>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div
                      className="flex p-4 rounded-2xl max-w-[85%] min-w-0 bg-indigo-600 text-white rounded-tr-none shadow-md"
                    >
                      <p className="text-sm leading-relaxed">{message.content}</p>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Loading / Thinking bubble */}
            {showWaitingBubble && (
              <div className="flex w-full min-w-0 gap-2.5 sm:gap-4 animate-in fade-in duration-300">
                <Avatar className="h-10 w-10 shrink-0">
                  <AvatarFallback className="bg-indigo-100 text-indigo-600">
                    {avatarLabel(streamingAgentRole)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col gap-1.5 min-w-0 max-w-[85%]">
                  <HyperText
                    key={cookingIdx}
                    className="text-xs font-semibold px-1 py-0 bg-linear-to-r from-indigo-600 to-indigo-400 bg-clip-text text-transparent"
                    duration={800}
                  >
                    {cookingPhrases[cookingIdx]}
                  </HyperText>
                  <div className="self-start rounded-2xl border border-slate-200/70 bg-white/80 px-4 py-3 shadow-sm">
                    <div className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-indigo-500 animate-bounce [animation-delay:0ms]" />
                      <span className="h-2 w-2 rounded-full bg-indigo-500 animate-bounce [animation-delay:150ms]" />
                      <span className="h-2 w-2 rounded-full bg-indigo-500 animate-bounce [animation-delay:300ms]" />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Streaming bubble — shows live content */}
            {isStreaming ? (
              <div className="flex w-full min-w-0 gap-2.5 sm:gap-4 flex-row animate-in fade-in duration-300">
                <Avatar className="h-10 w-10 shrink-0">
                  <AvatarFallback className="bg-indigo-100 text-indigo-600">
                    {avatarLabel(streamingAgentRole)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex w-full max-w-[85%] min-w-0 flex-col gap-2">
                  {streamingAgentRole && (
                    <span className="inline-flex items-center self-start text-xs font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 mb-1">
                      {streamingAgentRole}
                    </span>
                  )}
                  <div className="flex w-full max-w-full flex-col overflow-hidden bg-transparent px-0 py-0 text-gray-800 shadow-none">
                    {streamingContent ? (
                      <>
                        <div className={assistantMarkdownClassName}>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {formatWorkflowSummaryText(streamingContent)}
                          </ReactMarkdown>
                        </div>
                        <span className="inline-block w-2 h-4 ml-1 bg-indigo-400 animate-pulse rounded-sm" />
                      </>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-indigo-500 animate-bounce [animation-delay:0ms]" />
                        <span className="h-2 w-2 rounded-full bg-indigo-500 animate-bounce [animation-delay:150ms]" />
                        <span className="h-2 w-2 rounded-full bg-indigo-500 animate-bounce [animation-delay:300ms]" />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : null}


            {(thinkingContent || isThinking) ? (
              <ThinkingBlock
                content={thinkingContent}
                isLive={isThinking}
                accent="indigo"
              />
            ) : null}

            <div ref={scrollRef} />
          </div>
        </ScrollArea>

        <div className="p-4 glass border-t border-white/20 shrink-0">
          <div className="max-w-4xl mx-auto space-y-2">
            {execSessionId && !canDirectTarget ? (
              <div className="flex items-center gap-2 rounded-2xl border border-indigo-100/80 bg-indigo-50/70 px-4 py-2 text-xs text-indigo-700">
                <Network className="h-3.5 w-3.5" />
                {getOrchestrationLabel(orchestrationType)} routes this turn across the workflow. Direct agent targeting is disabled.
              </div>
            ) : null}
            <ChatInput
              onSend={handleSendMessage}
              onStop={handleStopRun}
              inputDisabled={isLoading || isStreaming}
              showStop={showInlineStop}
              isStopping={isStopping}
              stopDisabled={false}
              sessionKey={execSessionId ?? ""}
            />
          </div>
        </div>
      </div>

      <WorkflowTraceDialog
        trace={activeWorkflowTrace}
        open={isWorkflowDialogOpen}
        isLoading={isWorkflowTraceLoading}
        onOpenChange={(open) => {
          if (open && activeWorkflowTraceId) {
            dispatch(openWorkflowTraceDialog(activeWorkflowTraceId));
            return;
          }

          dispatch(closeWorkflowTraceDialog());
        }}
      />
    </div>
  );
}
