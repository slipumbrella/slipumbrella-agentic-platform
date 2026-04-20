"use client";

import {
  getInvalidSpecialistAssignments,
  ModelAssignmentReview,
} from "@/components/agent-builder/model-assignment-review";
import { AuroraText } from "@/components/ui/aurora-text";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HyperText } from "@/components/ui/hyper-text";
import { Input } from "@/components/ui/input";
import { PulsatingButton } from "@/components/ui/pulsating-button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { TypingAnimation } from "@/components/ui/typing-animation";
import {
  assignSessionThunk,
  createTeamThunk,
  fetchTeams,
  setActiveSessionId,
  setSelectedTeam,
} from "@/lib/features/agent/agentSlice";
import { selectUser } from "@/lib/features/auth/authSlice";
import {
  confirmModelAssignments,
  fetchActiveBuilderModels,
  fetchModelAssignments,
  type BuilderModelOption,
  type ModelAssignmentsState,
} from "@/lib/features/chat/builderAPI";
import {
  addBuilderMessage,
  createBuilderSession,
  executeBuilderPlan,
  restoreBuilderThinkContent,
  sendBuilderMessage,
  setTutorialActive,
} from "@/lib/features/chat/chatSlice";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowDown, ArrowRight, ChevronDown, FileText, HelpCircle, Send, Sparkles, Users, X, Zap } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const BuilderThinkingBlock = React.memo(function BuilderThinkingBlock({
  content,
  isLive,
  className,
}: {
  content: string;
  isLive: boolean;
  className?: string;
}) {
  const [open, setOpen] = React.useState(true);
  const panelId = React.useId();

  // Auto-collapse 800ms after thinking finishes
  React.useEffect(() => {
    if (!isLive && content) {
      const t = setTimeout(() => setOpen(false), 800);
      return () => clearTimeout(t);
    }
  }, [isLive, content]);

  if (!content && !isLive) return null;

  return (
    <div className={cn("w-full max-w-full", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        className="group flex w-full items-center gap-2 px-0 py-1 text-left transition-colors"
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70 transition-colors group-hover:bg-primary" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary/90 transition-colors group-hover:text-primary">
          {isLive ? "Tools Call" : "Tools Call Summary"}
        </span>
        <ChevronDown
          className={cn("ml-auto h-3.5 w-3.5 text-primary/50 transition-transform group-hover:text-primary", open && "rotate-180")}
        />
      </button>
      {open && (
        <div
          id={panelId}
          className="mt-1 max-h-48 overflow-y-auto pl-4 text-xs font-medium leading-relaxed whitespace-pre-wrap text-muted-foreground"
        >
          {content}
        </div>
      )}
    </div>
  );
});

type ChatInterfaceProps = {
  layoutMode?: "full" | "split";
  stackedSetupView?: boolean;
};

type ChatInputProps = {
  onSend: (message: string) => void;
  disabled: boolean;
  initialValue?: string;
  className?: string;
  textareaClassName?: string;
};

const ChatInput = React.memo(function ChatInput({
  onSend,
  disabled,
  initialValue = "",
  className,
  textareaClassName,
}: ChatInputProps) {
  const [value, setValue] = React.useState(initialValue);
  const textareaId = React.useId();

  React.useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  const submit = React.useCallback(() => {
    if (!value.trim() || disabled) {
      return;
    }

    onSend(value);
    setValue("");
  }, [disabled, onSend, value]);

  const handleKeyDown = React.useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }, [submit]);

  return (
    <div className={cn("relative mx-auto w-full max-w-3xl", className)}>
      <label htmlFor={textareaId} className="sr-only">
        Builder job description
      </label>
      <Textarea
        id={textareaId}
        placeholder="Describe the job you want this team to handle..."
        className={cn(
          "max-h-48 min-h-14 resize-none overflow-y-auto rounded-2xl border border-input bg-background pr-16 py-3 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:ring-primary sm:text-base",
          textareaClassName,
        )}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
      />
      <Button
        type="button"
        size="icon-lg"
        aria-label="Send builder prompt"
        className="absolute bottom-1.5 right-1.5 h-11 w-11 rounded-xl bg-primary text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
        onClick={submit}
        disabled={disabled || !value.trim()}
      >
        <Send className="h-4 w-4" />
      </Button>
    </div>
  );
});

export function ChatInterface({ layoutMode = "full", stackedSetupView = false }: ChatInterfaceProps) {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const { messages, sessionId, isLoading, isStreaming, streamingContent, builderThinkContent, isBuilderThinking, latestExecSessionId, availableSpecialists } =
    useAppSelector((state) => state.chat.builder);
  const chatHistory = useAppSelector((state) => state.chat.chatHistory);
  const user = useAppSelector(selectUser);
  const builderError = useAppSelector((state) => state.chat.builder.error);
  const supervisorState = useAppSelector((state) => state.chat.supervisor);

  const currentSession = chatHistory.find(h => h.id === sessionId);
  const sessionTitle = currentSession?.title;
  const isDefaultTitle = sessionTitle === "New Agent Session" || sessionTitle === "Untitled session";
  const cookingPhrases = [
    "Firing up the agent kitchen and sketching the team plan...",
    "Chopping the work into specialist-sized pieces...",
    "Matching each task with the right expert around the stove...",
    "Simmering the workflow so handoffs land in the right order...",
    "Seasoning the setup with tools, context, and guardrails...",
    "Plating the final checklist before your team is ready to serve...",
  ];
  const [cookingIdx, setCookingIdx] = React.useState(0);
  const [externalInputValue, setExternalInputValue] = React.useState("");
  const [isCreatingSession, setIsCreatingSession] = React.useState(false);
  const [isExecuting, setIsExecuting] = React.useState(false);
  const [teamDialogOpen, setTeamDialogOpen] = React.useState(false);
  const [teamDialogStep, setTeamDialogStep] = React.useState<"review" | "details">("review");
  const [teamName, setTeamName] = React.useState("");
  const [teamDesc, setTeamDesc] = React.useState("");
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [createTeamError, setCreateTeamError] = React.useState<string | null>(null);
  const [reviewAssignments, setReviewAssignments] = React.useState<ModelAssignmentsState | null>(null);
  const [reviewModels, setReviewModels] = React.useState<BuilderModelOption[]>([]);
  const [isLoadingReview, setIsLoadingReview] = React.useState(false);
  const [reviewError, setReviewError] = React.useState<string | null>(null);
  const [prefersReducedMotion, setPrefersReducedMotion] = React.useState(false);
  const chatScrollRootRef = React.useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = React.useRef(true);
  const lastMessageCountRef = React.useRef(messages.length);
  const deferredStreamingContent = React.useDeferredValue(streamingContent);
  const deferredBuilderThinkContent = React.useDeferredValue(builderThinkContent);
  const [showMobileHeader, setShowMobileHeader] = React.useState(true);
  const [showJumpToLatest, setShowJumpToLatest] = React.useState(false);
  const lastScrollYRef = React.useRef(0);


  // Auto-start tutorial for new users (null lastLogin)
  React.useEffect(() => {
    if (user && user.lastLogin === null) {
      const hasSeen = localStorage.getItem("ag_builder_tutorial_seen");
      if (!hasSeen) {
        dispatch(setTutorialActive(true));
        localStorage.setItem("ag_builder_tutorial_seen", "true");
      }
    }
  }, [user, dispatch]);

  React.useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);

    updatePreference();
    mediaQuery.addEventListener("change", updatePreference);

    return () => {
      mediaQuery.removeEventListener("change", updatePreference);
    };
  }, []);

  // Curtain lifecycle: keep mounted during exit animation, then unmount
  const hasMessages =
    messages.length > 0 || isLoading || isStreaming || isCreatingSession;
  const [isCurtainMounted, setIsCurtainMounted] = React.useState(!hasMessages);
  const [isCurtainExiting, setIsCurtainExiting] = React.useState(false);
  const isFullLayout = layoutMode === "full";
  const curtainWidthClass = isFullLayout ? "max-w-5xl" : "max-w-3xl";
  const curtainBodyWidthClass = isFullLayout ? "max-w-lg" : "max-w-xl";
  const curtainInputWidthClass = isFullLayout ? "max-w-5xl" : "max-w-3xl";
  const quickGuideGridClass = isFullLayout
    ? "md:grid-cols-2 xl:grid-cols-3"
    : "md:grid-cols-2";
  const chatContentWidthClass = isFullLayout ? "max-w-5xl" : "max-w-6xl";
  const chatContentContainerClass = "mx-auto w-full max-w-full";
  const assistantBubbleWidthClass = isFullLayout
    ? "max-w-full sm:max-w-[88%] lg:max-w-[84%]"
    : "max-w-full sm:max-w-[82%] lg:max-w-[72%]";
  const userBubbleWidthClass = isFullLayout
    ? "max-w-[85%] sm:max-w-[82%] lg:max-w-[80%]"
    : "max-w-[85%] sm:max-w-[74%] lg:max-w-[62%]";
  const hasPlan = Boolean(sessionId && availableSpecialists.length > 0);

  React.useEffect(() => {
    if (!hasMessages) {
      setIsCurtainMounted(true);
      setIsCurtainExiting(false);
    }
  }, [hasMessages]);

  React.useEffect(() => {
    if (!hasMessages || !isCurtainMounted) return;

    setIsCurtainExiting(true);
    const timer = setTimeout(() => {
      setIsCurtainMounted(false);
    }, 500);
    return () => clearTimeout(timer);
  }, [hasMessages, isCurtainMounted]);

  const getChatViewport = React.useCallback(() => {
    return (
      chatScrollRootRef.current?.querySelector<HTMLDivElement>(
        "[data-slot='scroll-area-viewport']",
      ) ?? null
    );
  }, []);

  const scrollToBottom = React.useCallback(
    (behavior: ScrollBehavior) => {
      const viewport = getChatViewport();
      shouldStickToBottomRef.current = true;
      setShowJumpToLatest(false);
      if (viewport) {
        if (typeof viewport.scrollTo === "function") {
          viewport.scrollTo({ top: viewport.scrollHeight, behavior });
        } else {
          viewport.scrollTop = viewport.scrollHeight;
        }
        return;
      }

      scrollRef.current?.scrollIntoView?.({ behavior, block: "end" });
    },
    [getChatViewport],
  );

  React.useEffect(() => {
    const viewport = getChatViewport();
    if (!viewport) {
      return;
    }

    const updateStickiness = () => {
      const distanceFromBottom =
        viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
      const isNearBottom = distanceFromBottom < 96;
      shouldStickToBottomRef.current = isNearBottom;
      setShowJumpToLatest(!isNearBottom);
    };

    updateStickiness();
    viewport.addEventListener("scroll", updateStickiness, { passive: true });
    return () => {
      viewport.removeEventListener("scroll", updateStickiness);
    };
  }, [getChatViewport, isCurtainMounted]);

  // Mobile header: hide on scroll down, show on scroll up
  React.useEffect(() => {
    if (isCurtainMounted) return;

    const viewport = getChatViewport();
    if (!viewport) return;

    const handleScroll = () => {
      const currentScrollY = viewport.scrollTop;
      if (currentScrollY === 0) {
        setShowMobileHeader(true);
      } else if (currentScrollY > lastScrollYRef.current + 8) {
        setShowMobileHeader(false);
      } else if (currentScrollY < lastScrollYRef.current - 8) {
        setShowMobileHeader(true);
      }
      lastScrollYRef.current = currentScrollY;
    };

    viewport.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      viewport.removeEventListener("scroll", handleScroll);
    };
  }, [getChatViewport, isCurtainMounted]);

  React.useEffect(() => {
    if (isCurtainMounted) {
      setShowJumpToLatest(false);
      return;
    }

    const hasNewMessage = messages.length !== lastMessageCountRef.current;
    lastMessageCountRef.current = messages.length;

    if (!shouldStickToBottomRef.current && !hasNewMessage) {
      return;
    }

    const rafId = window.requestAnimationFrame(() => {
      scrollToBottom(hasNewMessage ? "smooth" : "auto");
    });

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [
    deferredBuilderThinkContent,
    deferredStreamingContent,
    isBuilderThinking,
    isCurtainMounted,
    messages.length,
    scrollToBottom,
  ]);

  // Persist think content to localStorage when finalized so it survives page refresh
  const prevIsBuilderThinking = React.useRef(isBuilderThinking);
  React.useEffect(() => {
    if (prevIsBuilderThinking.current && !isBuilderThinking && builderThinkContent && sessionId) {
      try {
        localStorage.setItem(`su_think_${sessionId}`, builderThinkContent);
      } catch { /* quota exceeded, skip */ }
    }
    prevIsBuilderThinking.current = isBuilderThinking;
  }, [isBuilderThinking, builderThinkContent, sessionId]);

  // Restore think content from localStorage when a session is loaded
  React.useEffect(() => {
    if (!sessionId) return;
    try {
      const saved = localStorage.getItem(`su_think_${sessionId}`);
      if (saved) dispatch(restoreBuilderThinkContent(saved));
    } catch { /* localStorage unavailable, skip */ }
  }, [sessionId, dispatch]);

  React.useEffect(() => {
    const isThinking = (isLoading && !isStreaming) || isCreatingSession;
    if (!isThinking) return;
    const interval = setInterval(() => {
      setCookingIdx((i) => (i + 1) % cookingPhrases.length);
    }, 2000);
    return () => clearInterval(interval);
  }, [isLoading, isStreaming, isCreatingSession, cookingPhrases.length]);

  const loadModelReview = React.useCallback(async () => {
    if (!sessionId || !hasPlan) {
      return;
    }

    setIsLoadingReview(true);
    setReviewError(null);

    try {
      const [assignments, models] = await Promise.all([
        fetchModelAssignments(sessionId),
        fetchActiveBuilderModels(),
      ]);
      setReviewAssignments(assignments);
      setReviewModels(models);
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to load model review";
      setReviewError(message);
    } finally {
      setIsLoadingReview(false);
    }
  }, [hasPlan, sessionId]);

  React.useEffect(() => {
    if (!hasPlan) {
      setReviewAssignments(null);
      setReviewModels([]);
      setIsLoadingReview(false);
      setReviewError(null);
      return;
    }

    setReviewAssignments(null);
    setReviewModels([]);
    setReviewError(null);
    void loadModelReview();
  }, [hasPlan, loadModelReview]);

  const openTeamDialog = React.useCallback(() => {
    setTeamDialogStep("review");
    setCreateTeamError(null);
    setTeamDialogOpen(true);
    void loadModelReview();
  }, [loadModelReview]);

  const handleConfirmCreateTeam = React.useCallback(async () => {
    if (!sessionId || isExecuting || !teamName.trim()) return;
    setIsExecuting(true);
    setCreateTeamError(null);
    try {
      const [latestAssignments, latestModels] = await Promise.all([
        fetchModelAssignments(sessionId),
        fetchActiveBuilderModels(),
      ]);
      setReviewAssignments(latestAssignments);
      setReviewModels(latestModels);

      const invalidAssignments = getInvalidSpecialistAssignments(
        availableSpecialists,
        latestModels,
        latestAssignments,
      );
      if (invalidAssignments.length > 0) {
        setReviewError("Choose an active model for every specialist before continuing.");
        setTeamDialogStep("review");
        setTeamDialogOpen(true);
        return;
      }

      const confirmedAssignments = await confirmModelAssignments(sessionId);
      setReviewAssignments(confirmedAssignments);
      setReviewError(null);

      // Use the pre-persisted exec session from auto-execute; fall back to executing now.
      let execSessionId = latestExecSessionId;
      if (!execSessionId) {
        const planResult = await dispatch(
          executeBuilderPlan({ planningSessionId: sessionId }),
        ).unwrap();
        execSessionId = planResult.exec_session_id;
      }

      const teamResult = await dispatch(
        createTeamThunk({
          name: teamName.trim(),
          description: teamDesc.trim() || undefined,
        }),
      ).unwrap();
      const teamId = teamResult.id;
      await dispatch(
        assignSessionThunk({ teamId, sessionId: execSessionId }),
      ).unwrap();
      await dispatch(fetchTeams());
      dispatch(setSelectedTeam(teamId));
      dispatch(setActiveSessionId(execSessionId));
      setTeamName("");
      setTeamDesc("");
      setTeamDialogOpen(false);
      setTeamDialogStep("review");
      router.push("/my-agents");
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : (err as { message?: string })?.message ?? "Failed to create team";
      setCreateTeamError(msg);
      setTeamDialogOpen(true);
      setTeamDialogStep("details");
    } finally {
      setIsExecuting(false);
    }
  }, [sessionId, isExecuting, teamName, teamDesc, latestExecSessionId, dispatch, router, availableSpecialists]);

  const handleSendMessage = React.useCallback(async (message: string) => {
    if (!message.trim() || isCreatingSession || isLoading || isStreaming)
      return;

    setExternalInputValue("");

    // Clear persisted think content — will be re-saved if new response includes tool calls
    if (sessionId) {
      try { localStorage.removeItem(`su_think_${sessionId}`); } catch { /* skip */ }
    }

    // Create session on-demand if none exists
    if (!sessionId) {
      setIsCreatingSession(true);
      try {
        const result = await dispatch(
          createBuilderSession({ title: "New Agent Session" }),
        ).unwrap();
        const newSessionId = result.session_id;
        setIsCreatingSession(false);

        dispatch(
          addBuilderMessage({
            id: Date.now().toString(),
            role: "user",
            content: message,
          }),
        );
        dispatch(sendBuilderMessage({ message, sessionId: newSessionId }));
      } catch {
        setIsCreatingSession(false);
        return;
      }
    } else {
      dispatch(
        addBuilderMessage({
          id: Date.now().toString(),
          role: "user",
          content: message,
        }),
      );
      dispatch(sendBuilderMessage({ message, sessionId }));
    }

    setTimeout(() => {
      // Focus handled in Child component if needed, but not required for simple optimization
    }, 100);
  }, [dispatch, isCreatingSession, isLoading, isStreaming, sessionId]);

  const suggestions = React.useMemo(() => [
    { icon: Users, text: "Build a customer support team", color: "text-blue-600", bg: "bg-blue-50" },
    { icon: FileText, text: "Create a document analysis team", color: "text-indigo-600", bg: "bg-indigo-50" },
    { icon: Zap, text: "Design a sales automation team", color: "text-amber-600", bg: "bg-amber-50" },
  ], []);
  const quickGuide = React.useMemo(() => [
    {
      title: "Start with the job",
      body: "Describe the work you want done in one sentence.",
      icon: Sparkles,
      color: "text-purple-600",
      bg: "bg-purple-50",
    },
    {
      title: "Add your knowledge",
      body: "Upload files and links to use your real context.",
      icon: FileText,
      color: "text-blue-600",
      bg: "bg-blue-50",
    },
    {
      title: "Create the team",
      body: "Review the plan, then launch when ready.",
      icon: Users,
      color: "text-emerald-600",
      bg: "bg-emerald-50",
    },
  ], []);

  const invalidReviewAssignments = React.useMemo(
    () =>
      getInvalidSpecialistAssignments(
        availableSpecialists,
        reviewModels,
        reviewAssignments,
      ),
    [availableSpecialists, reviewModels, reviewAssignments],
  );

  const canLaunchTeam =
    hasPlan &&
    !isLoadingReview &&
    !reviewError &&
    !!reviewAssignments &&
    invalidReviewAssignments.length === 0;

  const canContinueToDetails =
    !isLoadingReview &&
    !reviewError &&
    !!reviewAssignments &&
    availableSpecialists.length > 0 &&
    invalidReviewAssignments.length === 0;
  const shouldShowReviewAction = hasPlan && !canLaunchTeam;
  const jumpToLatestMotionProps = React.useMemo(
    () =>
      prefersReducedMotion
        ? {
            initial: { opacity: 0 },
            animate: { opacity: 1 },
            exit: { opacity: 0 },
            transition: { duration: 0.12 },
          }
        : {
            initial: { opacity: 0, y: 10, scale: 0.94 },
            animate: { opacity: 1, y: 0, scale: 1 },
            exit: { opacity: 0, y: 6, scale: 0.96 },
            transition: {
              duration: 0.22,
              ease: [0.25, 1, 0.5, 1] as const,
            },
        },
    [prefersReducedMotion],
  );
  const teamNameInputId = React.useId();
  const teamDescInputId = React.useId();

  const header = React.useMemo(() => (
    <div className={cn(
      "z-10 flex shrink-0 flex-col gap-3 overflow-x-clip border-b border-border bg-background/95 px-3 py-3 shadow-sm backdrop-blur-md sm:flex-row sm:items-start sm:justify-between sm:px-4 sm:py-4 lg:px-5",
      "transition-transform duration-200 ease-out md:translate-y-0",
      "absolute left-0 right-0 top-0 md:relative",
      showMobileHeader ? "translate-y-0" : "-translate-y-full"
    )}>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 sm:gap-2 overflow-hidden">
          <div className="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center">
            <Image
              src="/favicon.svg"
              alt="Logo"
              width={24}
              height={24}
              className="h-full w-full object-contain"
            />
          </div>
          <h1 className="shrink-0 text-sm font-semibold tracking-tight text-foreground sm:text-base lg:text-xl">
            Create Your AI Agent
          </h1>
          {sessionTitle && !isDefaultTitle && (
            <>
              <span className="text-base font-light text-border lg:text-xl">/</span>
              <span className="max-w-20 truncate text-sm font-medium tracking-tight text-primary animate-in fade-in slide-in-from-left-2 duration-500 sm:max-w-none sm:text-lg">
                {sessionTitle}
              </span>
            </>
          )}
        </div>
        <p className="mt-0.5 text-xs font-medium text-muted-foreground sm:text-sm">
          Describe the job, then refine the team with your data and specialists
        </p>
      </div>
      <div className="flex w-full items-start justify-between gap-2 sm:w-auto sm:items-center sm:justify-end">
          <Button
            variant="ghost"
            size="icon-lg"
            type="button"
            aria-label="Open builder tutorial"
            onClick={() => dispatch(setTutorialActive(true))}
            className="pointer-events-auto h-11 w-11 rounded-full text-primary transition-colors hover:bg-accent hover:text-foreground"
          >
            <HelpCircle className="w-5 h-5" />
          </Button>
          <Dialog open={teamDialogOpen} onOpenChange={setTeamDialogOpen}>
            <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2 sm:w-auto sm:flex-none sm:flex-nowrap">
              {shouldShowReviewAction ? (
                <Button
                  variant="outline"
                  className="min-h-11 min-w-0 rounded-xl border-border bg-card px-4 text-foreground shadow-none hover:bg-accent sm:px-4"
                  disabled={isLoadingReview || isExecuting || supervisorState.isLoading}
                  onClick={openTeamDialog}
                >
                  <Users className="w-4 h-4 sm:mr-2" />
                  <span>{isLoadingReview ? "Checking setup" : "Review setup"}</span>
                </Button>
              ) : null}
              <div className="relative">
                {hasPlan ? (
                  <PulsatingButton
                    id="create-team-btn"
                    onClick={openTeamDialog}
                    disabled={isExecuting || supervisorState.isLoading}
                    className="relative min-h-11 min-w-0 animate-gradient-move rounded-xl bg-linear-to-r from-primary to-chart-5 bg-size-[200%_auto] px-4 font-bold text-white shadow-lg active:scale-95 transition-all duration-200"
                  >
                    <Users className="w-4 h-4 shrink-0" />
                    <span>{isCreatingSession || isExecuting ? "Creating..." : "Create Team"}</span>
                  </PulsatingButton>
                ) : (
                  <Button
                    id="create-team-btn"
                    variant="outline"
                    className="relative min-h-11 min-w-0 rounded-xl border-border bg-muted px-4 text-muted-foreground shadow-none hover:bg-muted hover:text-muted-foreground sm:px-4"
                    disabled={true}
                  >
                    <Users className="w-4 h-4 sm:mr-2" />
                    <span>Create Team</span>
                  </Button>
                )}
              </div>
            </div>
          <DialogContent className={cn(
            "flex flex-col overflow-hidden rounded-2xl border border-border bg-card p-0 shadow-xl sm:max-w-2xl sm:rounded-[2rem] [&>button:last-child]:hidden"
          )}>
            <DialogHeader className="relative flex-none p-5 pb-0 sm:p-8 sm:pb-0">
              <div className="flex items-center justify-between">
                <DialogTitle className="flex items-center gap-3 text-xl font-bold text-foreground sm:text-2xl">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-border bg-primary/10 text-primary">
                    <Users className="h-6 w-6" />
                  </div>
                  {teamDialogStep === "review" ? "Review specialist models" : "Create Team"}
                </DialogTitle>
                <DialogClose asChild>
                  <Button 
                    variant="ghost" 
                    size="icon-lg"
                    type="button"
                    aria-label="Close team dialog"
                    className="h-11 w-11 rounded-2xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <X className="h-5 w-5" />
                  </Button>
                </DialogClose>
              </div>
              <DialogDescription className="mt-2 text-sm text-muted-foreground">
                {teamDialogStep === "review"
                  ? "Check the final Builder model setup before continuing to team details."
                  : "Give the team a name, then create it with the reviewed Builder setup."}
              </DialogDescription>
            </DialogHeader>
            <div className="flex-1 overflow-hidden flex flex-col min-h-0">
              <ScrollArea className="flex-1">
                <div className="p-5 sm:p-8 pt-4">
                  {teamDialogStep === "review" ? (
                    <ModelAssignmentReview
                      specialists={availableSpecialists}
                      models={reviewModels}
                      assignments={reviewAssignments}
                      isLoading={isLoadingReview}
                      error={reviewError}
                    />
                  ) : (
                    <div className="space-y-6">
                      <div className="rounded-3xl border border-border bg-muted/50 px-4 py-4 shadow-sm">
                        <p className="text-[11px] font-black uppercase tracking-[0.16em] text-primary">
                          Models reviewed
                        </p>
                        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                          {availableSpecialists.length} specialist{availableSpecialists.length === 1 ? "" : "s"} ready with{" "}
                          {Object.keys(reviewAssignments?.overrides ?? {}).length} custom change{Object.keys(reviewAssignments?.overrides ?? {}).length === 1 ? "" : "s"}.
                        </p>
                        {invalidReviewAssignments.length > 0 && (
                          <p className="mt-2 text-sm text-amber-700 font-medium">
                            Choose an active model for every specialist before creating the team.
                          </p>
                        )}
                      </div>
                      <div className="space-y-5">
                        <div className="space-y-2">
                          <label htmlFor={teamNameInputId} className="ml-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Team Name</label>
                          <Input
                            id={teamNameInputId}
                            placeholder="e.g. Content Research Squad"
                            value={teamName}
                            onChange={(e) => setTeamName(e.target.value)}
                            className="h-12 rounded-2xl border-input bg-background focus-visible:border-primary focus-visible:ring-primary"
                          />
                        </div>
                        <div className="space-y-2">
                          <label htmlFor={teamDescInputId} className="ml-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Description <span className="text-[10px] font-medium lowercase opacity-60 italic">(optional)</span></label>
                          <Textarea
                            id={teamDescInputId}
                            placeholder="Describe the ultimate mission of this team..."
                            value={teamDesc}
                            onChange={(e) => setTeamDesc(e.target.value)}
                            className="min-h-28 resize-none rounded-2xl border-input bg-background focus-visible:border-primary focus-visible:ring-primary"
                          />
                        </div>
                      </div>
                      {createTeamError && (
                        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{createTeamError}</p>
                      )}
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
            <DialogFooter className="flex flex-none items-center justify-end gap-3 rounded-b-[2rem] border-t border-border bg-muted/40 p-4 sm:p-6">
              <DialogClose asChild>
                <Button variant="ghost" className="h-11 rounded-xl px-6 text-muted-foreground hover:bg-accent">Cancel</Button>
              </DialogClose>
              {teamDialogStep === "review" ? (
                <Button
                    className="h-11 rounded-xl bg-primary px-8 font-bold text-primary-foreground shadow-sm hover:bg-primary/90"
                    onClick={() => setTeamDialogStep("details")}
                    disabled={!canContinueToDetails}
                  >
                  Continue to team details
                </Button>
              ) : (
                <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
                    className="h-11 rounded-xl border-border px-6 text-foreground hover:bg-accent"
                    onClick={() => setTeamDialogStep("review")}
                  >
                    Back
                  </Button>
                  <PulsatingButton
                    className="h-11 animate-gradient-move rounded-xl bg-linear-to-r from-primary to-chart-5 bg-size-[200%_auto] px-10 font-bold text-white shadow-md active:scale-95 transition-all duration-200 lg:px-12"
                    onClick={handleConfirmCreateTeam}
                    disabled={!teamName.trim() || invalidReviewAssignments.length > 0}
                  >
                    Launch Team
                  </PulsatingButton>
                </div>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  ), [dispatch, sessionTitle, isDefaultTitle, teamDialogOpen, shouldShowReviewAction, teamDialogStep, teamName, teamDesc, isExecuting, supervisorState.isLoading, createTeamError, handleConfirmCreateTeam, openTeamDialog, availableSpecialists, reviewModels, reviewAssignments, isLoadingReview, reviewError, canContinueToDetails, invalidReviewAssignments.length, hasPlan, isCreatingSession, showMobileHeader, teamNameInputId, teamDescInputId]);

  const curtain = React.useMemo(() => (
    <div
      className={`flex-1 flex flex-col items-center justify-center px-4 py-6 sm:px-6 sm:py-8 lg:px-8 overflow-hidden ${
        isCurtainExiting
          ? "animate-out fade-out zoom-out-95 duration-500 fill-mode-forwards"
          : "animate-in fade-in duration-500"
      }`}
    >
      <div
        id="builder-curtain"
        data-curtain-layout={layoutMode}
        className={cn("flex w-full flex-col items-center text-center", curtainWidthClass)}
      >
        <div className={cn("w-full", curtainBodyWidthClass)}>
          <div className="mb-3 sm:mb-6">
            <div className="mx-auto flex h-14 w-14 sm:h-16 sm:w-16 items-center justify-center">
              <Image
                src="/favicon.svg"
                alt="Logo"
                width={64}
                height={64}
                className="h-full w-full object-contain"
              />
            </div>
          </div>

          <h2 className="mb-2 text-xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            What will your <AuroraText className="bg-clip-text font-extrabold uppercase tracking-tight">agentic AI team</AuroraText> help with?
          </h2>
          <p className="mx-auto mb-4 max-w-md text-xs leading-relaxed text-muted-foreground sm:mb-6 sm:text-sm">
            Start with the outcome you want, and the builder will guide the team,
            knowledge, and setup steps for you.
          </p>
          {!isLoading && builderError ? (
            <div role="alert" className="mx-auto mb-4 max-w-md rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-left shadow-sm">
              <p className="text-sm font-semibold text-red-700">Failed to load conversation</p>
              <p className="mt-1 text-sm text-red-600">{builderError}</p>
            </div>
          ) : null}
        </div>

        <div className={cn("mt-4 mb-3 w-full rounded-[28px] border border-border bg-card p-2.5 shadow-sm sm:hidden", curtainInputWidthClass)}>
          <ChatInput
            onSend={handleSendMessage}
            disabled={isLoading || isStreaming || isCreatingSession}
            initialValue={externalInputValue}
            className="max-w-none"
            textareaClassName="border-transparent bg-transparent shadow-none"
          />
        </div>

        <div className="mb-4 w-full text-left max-w-3xl">
          <div className="mb-2 flex items-center gap-2 px-1">
            <div className="h-1.5 w-1.5 rounded-full bg-primary" />
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-primary">
              How To Start
            </p>
          </div>
          <div className={cn("grid gap-2.5", quickGuideGridClass)}>
            {quickGuide.map((item, index) => (
              <div
                key={item.title}
                className={cn(
                  "group relative flex flex-col gap-2 rounded-xl border border-border bg-card p-3 transition-all duration-300 hover:-translate-y-1 hover:border-primary/20 hover:shadow-lg",
                  "animate-in fade-in slide-in-from-bottom-2 duration-700",
                )}
                style={{ animationDelay: `${index * 100}ms`, animationFillMode: "both" }}
              >
                <div className="flex items-start justify-between">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors">
                    <span className="text-xs font-black">0{index + 1}</span>
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-bold text-foreground">
                    {item.title}
                  </p>
                  <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground line-clamp-1">
                    {item.body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div id="curtain-suggestions" className="flex w-full flex-col gap-2 max-w-3xl">
          <div className="mb-1 flex items-center gap-2 px-1">
            <div className="h-1.5 w-1.5 rounded-full bg-primary" />
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-primary">
              Starter Prompts
            </p>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {suggestions.map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() => {
                  setExternalInputValue(s.text);
                }}
                className={cn(
                  "group flex w-full items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/20 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                  "animate-in fade-in slide-in-from-bottom-2 duration-700",
                )}
                style={{ animationDelay: `${400 + i * 100}ms`, animationFillMode: "both" }}
                aria-label={`Use starter prompt: ${s.text}`}
              >
                <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-200", s.bg, s.color)}>
                  <s.icon className="h-3.5 w-3.5" />
                </div>
                <span className="flex-1 truncate text-[11px] font-medium text-foreground">
                  {s.text}
                </span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/30 group-hover:text-primary transition-colors" />
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 hidden w-full rounded-[30px] border border-border bg-card p-3 shadow-sm sm:block sm:max-w-3xl">
          <ChatInput
            onSend={handleSendMessage}
            disabled={isLoading || isStreaming || isCreatingSession}
            initialValue={externalInputValue}
            className="max-w-none"
            textareaClassName="border-transparent bg-transparent shadow-none"
          />
        </div>
      </div>
    </div>
  ), [layoutMode, suggestions, quickGuide, handleSendMessage, isLoading, isStreaming, isCreatingSession, externalInputValue, isCurtainExiting, curtainBodyWidthClass, curtainInputWidthClass, curtainWidthClass, quickGuideGridClass, builderError]);

  return (
    <div className={cn("flex flex-col min-w-0 overflow-hidden relative", stackedSetupView ? "h-auto min-h-128 flex-none w-full" : "flex-1 h-full")}>
      {header}

      {isCurtainMounted ? (
        curtain
      ) : (
        <div ref={chatScrollRootRef} className="relative flex-1 min-h-0">
        <ScrollArea id="chat-area" className="flex-1 h-full" viewportClassName="overflow-x-hidden">
          <div
            className={cn("max-w-full space-y-5 overflow-x-hidden px-3 py-6 sm:space-y-6 sm:px-6 sm:py-10", chatContentContainerClass, chatContentWidthClass)}
            role="log"
            aria-label="Builder conversation"
            aria-live="polite"
            aria-relevant="additions text"
            aria-busy={isLoading || isStreaming || isCreatingSession || isBuilderThinking}
          >
            {isLoading && !isStreaming && messages.length === 0 && (
              <div className="flex flex-col gap-6 pt-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className={`flex gap-3 sm:gap-4 ${i % 2 !== 0 ? "flex-row-reverse" : "flex-row"}`}>
                    <div className="h-8 w-8 sm:h-10 sm:w-10 rounded-full bg-gray-200 animate-pulse shrink-0" />
                    <div className={`h-16 rounded-2xl bg-gray-200 animate-pulse ${i % 2 !== 0 ? "w-48" : "w-72"}`} />
                  </div>
                ))}
              </div>
            )}

            {!isLoading && builderError && messages.length === 0 && (
              <div role="alert" className="flex flex-col items-center justify-center px-6 py-20 text-center">
                <p className="text-sm font-medium text-red-700">Failed to load conversation</p>
                <p className="mt-1 text-xs text-red-600">{builderError}</p>
              </div>
            )}

            {messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  "flex w-full min-w-0 items-start gap-2.5 sm:gap-4 animate-in fade-in slide-in-from-bottom-2 duration-300",
                  message.role === "assistant" ? "flex-row" : "flex-row-reverse"
                )}
              >
                <Avatar className="mt-0.5 h-8 w-8 sm:h-10 sm:w-10 shrink-0 rounded-xl border-none shadow-none ring-0">
                  {message.role === "assistant" ? (
                    <>
                      <AvatarImage src="/favicon.svg" className="p-1.5" />
                      <AvatarFallback className="bg-purple-100 text-purple-600 font-bold rounded-xl">
                        AI
                      </AvatarFallback>
                    </>
                  ) : (
                    <>
                      <AvatarFallback className="bg-primary/10 text-primary font-bold rounded-xl">
                        {user?.username?.slice(0, 2).toUpperCase() || "ME"}
                      </AvatarFallback>
                    </>
                  )}
                </Avatar>
                <div
                  className={cn(
                    "flex min-w-0 w-full max-w-full flex-col gap-2",
                    message.role === "assistant"
                      ? assistantBubbleWidthClass
                      : userBubbleWidthClass,
                    message.role === "assistant" ? "items-start" : "items-end",
                  )}
                >
                  <div
                    className={`flex w-full sm:w-fit max-w-full flex-col overflow-hidden rounded-2xl px-3 py-3 sm:p-4 min-w-0 ${
                      message.role === "assistant"
                      ? "rounded-none bg-transparent px-0 py-0 text-gray-800 shadow-none"
                        : "rounded-tr-none bg-primary text-primary-foreground shadow-sm"
                    }`}
                  >
                    {message.role === "assistant" ? (
                      <div className="text-xs leading-5 sm:text-sm sm:leading-relaxed prose prose-sm prose-gray max-w-none min-w-0 overflow-hidden wrap-anywhere [overflow-wrap:anywhere] break-words flex flex-col gap-2 sm:gap-3 prose-p:my-0 prose-headings:my-0 prose-headings:text-base sm:prose-headings:text-lg prose-headings:leading-snug prose-headings:font-semibold prose-ul:my-0 prose-ol:my-0 prose-li:my-0 prose-li:text-inherit prose-code:bg-slate-100 prose-code:rounded-md prose-code:px-1.5 prose-code:py-0.5 prose-code:text-indigo-600 prose-code:font-semibold prose-code:before:content-none prose-code:after:content-none [&_a]:break-all [&_code]:break-all [&_pre]:max-w-full [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-indigo-700 [&_pre_code]:font-medium prose-pre:text-sm sm:prose-pre:text-base prose-pre:bg-indigo-50/50 prose-pre:text-indigo-700 prose-pre:shadow-sm prose-pre:border prose-pre:border-indigo-100/50 prose-pre:rounded-xl prose-pre:overflow-x-auto">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {message.content}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <p className="text-xs leading-5 sm:text-sm sm:leading-relaxed whitespace-pre-wrap wrap-anywhere [overflow-wrap:anywhere] break-words">{message.content}</p>
                    )}
                  </div>
                  {message.role === "assistant" && message.thinkContent && (
                    <BuilderThinkingBlock content={message.thinkContent} isLive={false} className="self-start mt-1" />
                  )}
                </div>
              </div>
            ))}

            {isStreaming && streamingContent && (
              <div className="flex w-full min-w-0 items-start gap-2.5 sm:gap-4 animate-in fade-in duration-300">
                <Avatar className="mt-0.5 h-8 w-8 sm:h-10 sm:w-10 shrink-0 rounded-xl border-none shadow-none ring-0">
                  <AvatarImage src="/favicon.svg" className="p-1.5" />
                  <AvatarFallback className="bg-purple-100 text-purple-600 font-bold rounded-xl">
                    AI
                  </AvatarFallback>
                </Avatar>
                <div className={cn("w-full max-w-full sm:w-auto min-w-0 overflow-hidden px-0 py-0", assistantBubbleWidthClass)}>
                  {prefersReducedMotion ? (
                    <>
                      <div className="text-xs leading-5 sm:text-sm sm:leading-relaxed text-gray-800 prose prose-sm prose-gray max-w-none min-w-0 wrap-anywhere [overflow-wrap:anywhere] break-words prose-p:my-0 prose-headings:my-0 prose-headings:text-base sm:prose-headings:text-lg prose-headings:leading-snug prose-headings:font-semibold prose-ul:my-0 prose-ol:my-0 prose-li:my-0 prose-li:text-inherit prose-code:bg-slate-100 prose-code:rounded-md prose-code:px-1.5 prose-code:py-0.5 prose-code:text-indigo-600 prose-code:font-semibold prose-code:before:content-none prose-code:after:content-none [&_a]:break-all [&_code]:break-all [&_pre]:max-w-full [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-indigo-700 [&_pre_code]:font-medium prose-pre:text-sm sm:prose-pre:text-base prose-pre:bg-indigo-50/50 prose-pre:text-indigo-700 prose-pre:shadow-sm prose-pre:border prose-pre:border-indigo-100/50 prose-pre:rounded-xl prose-pre:overflow-x-auto">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {deferredStreamingContent}
                        </ReactMarkdown>
                      </div>
                      <span className="inline-block w-1 h-3.5 mt-1 bg-purple-400 animate-pulse rounded-sm" />
                    </>
                  ) : (
                    <TypingAnimation
                      as="div"
                      startOnView={false}
                      markdown
                      showCursor
                      blinkCursor
                      typeSpeed={18}
                      className="text-xs leading-5 sm:text-sm sm:leading-relaxed text-gray-800 prose prose-sm prose-gray max-w-none min-w-0 wrap-anywhere [overflow-wrap:anywhere] break-words prose-p:my-0 prose-headings:my-0 prose-headings:text-base sm:prose-headings:text-lg prose-headings:leading-snug prose-headings:font-semibold prose-ul:my-0 prose-ol:my-0 prose-li:my-0 prose-li:text-inherit prose-code:bg-slate-100 prose-code:rounded-md prose-code:px-1.5 prose-code:py-0.5 prose-code:text-indigo-600 prose-code:font-semibold prose-code:before:content-none prose-code:after:content-none [&_a]:break-all [&_code]:break-all [&_pre]:max-w-full [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-indigo-700 [&_pre_code]:font-medium prose-pre:text-sm sm:prose-pre:text-base prose-pre:bg-indigo-50/50 prose-pre:text-indigo-700 prose-pre:shadow-sm prose-pre:border prose-pre:border-indigo-100/50 prose-pre:rounded-xl prose-pre:overflow-x-auto"
                    >
                      {deferredStreamingContent}
                    </TypingAnimation>
                  )}
                </div>
              </div>
            )}

            {(isBuilderThinking || (isStreaming && deferredBuilderThinkContent)) && (
              <div className="flex w-full min-w-0 gap-2.5 sm:gap-4 animate-in fade-in duration-300">
                <div className="hidden sm:block h-8 w-8 sm:h-10 sm:w-10 shrink-0" />
                <BuilderThinkingBlock
                  content={deferredBuilderThinkContent}
                  isLive={isBuilderThinking}
                  className={cn("mt-1 w-full max-w-full sm:w-auto", assistantBubbleWidthClass)}
                />
              </div>
            )}

            {(((isLoading && !isStreaming && !isBuilderThinking && !builderThinkContent) || isCreatingSession)) && (
              <div className="flex w-full min-w-0 items-center gap-2.5 sm:gap-4 animate-in fade-in duration-300">
                <Avatar className="h-8 w-8 sm:h-10 sm:w-10 shrink-0 rounded-xl border-none shadow-none ring-0">
                  <AvatarImage src="/favicon.svg" className="p-1.5" />
                  <AvatarFallback className="bg-purple-100 text-purple-600 font-bold rounded-xl">
                    AI
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col gap-1.5">
                  <HyperText
                    key={cookingIdx}
                    duration={800}
                    className="px-1 py-0 text-xs font-bold text-primary sm:text-sm"
                    as="div"
                    startOnView={false}
                  >
                    {cookingPhrases[cookingIdx]}
                  </HyperText>
                  <p className="px-1 text-xs text-muted-foreground">
                    Working through tools, knowledge, and handoffs.
                  </p>
                </div>
              </div>
            )}
            <div ref={scrollRef} />
          </div>
        </ScrollArea>
        <AnimatePresence>
          {showJumpToLatest ? (
            <motion.div
              className="pointer-events-none absolute bottom-4 right-4 z-20 sm:bottom-5 sm:right-5"
              {...jumpToLatestMotionProps}
            >
              <Button
                type="button"
                size="icon"
                aria-label="Jump to latest message"
                className="pointer-events-auto h-11 w-11 rounded-full border border-purple-200/80 bg-white/92 text-purple-700 shadow-[0_14px_30px_rgba(139,92,246,0.16)] backdrop-blur-xl transition-all hover:-translate-y-0.5 hover:bg-white hover:text-purple-800"
                onClick={() => scrollToBottom("smooth")}
              >
                <ArrowDown className="h-4.5 w-4.5" />
              </Button>
            </motion.div>
          ) : null}
        </AnimatePresence>
        </div>
      )}

      {!isCurtainMounted ? (
        <div className="z-10 shrink-0 border-t border-border bg-background/95 px-2 py-2 shadow-sm backdrop-blur-md sm:px-5 sm:py-4">
          <div className={cn("rounded-2xl border border-border bg-card p-2 shadow-sm sm:rounded-[30px] sm:p-3", chatContentContainerClass, chatContentWidthClass)}>
            <ChatInput
              onSend={handleSendMessage}
              disabled={isLoading || isStreaming || isCreatingSession}
              initialValue={externalInputValue}
              className="max-w-none"
              textareaClassName="border-transparent bg-transparent shadow-none"
            />
          </div>
        </div>
      ) : null}

    </div>
  );
}
