"use client"

import {
    motion,
    useInView,
    type DOMMotionComponents,
    type HTMLMotionProps,
    type MotionProps,
} from "motion/react"
import {
    useEffect,
    useMemo,
    useReducer,
    useRef,
    type ComponentType,
    type RefAttributes,
    type RefObject,
} from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { PluggableList } from "unified"

import { cn } from "@/lib/utils"

const motionElements = {
  article: motion.article,
  div: motion.div,
  h1: motion.h1,
  h2: motion.h2,
  h3: motion.h3,
  h4: motion.h4,
  h5: motion.h5,
  h6: motion.h6,
  li: motion.li,
  p: motion.p,
  section: motion.section,
  span: motion.span,
} as const

type MotionElementType = Extract<
  keyof DOMMotionComponents,
  keyof typeof motionElements
>
type TypingAnimationMotionComponent = ComponentType<
  Omit<HTMLMotionProps<"span">, "ref"> & RefAttributes<HTMLElement>
>
type TypingPhase = "typing" | "pause" | "deleting"

interface TypingAnimationState {
  displayedText: string
  currentWordIndex: number
  currentCharIndex: number
  phase: TypingPhase
}

type TypingAnimationAction =
  | { type: "reset" }
  | { type: "patch"; patch: Partial<TypingAnimationState> }

const INITIAL_TYPING_STATE: TypingAnimationState = {
  displayedText: "",
  currentWordIndex: 0,
  currentCharIndex: 0,
  phase: "typing",
}

function typingAnimationReducer(
  state: TypingAnimationState,
  action: TypingAnimationAction
): TypingAnimationState {
  switch (action.type) {
    case "reset":
      return INITIAL_TYPING_STATE
    case "patch":
      return { ...state, ...action.patch }
    default:
      return state
  }
}

function TypingCursor({
  blinkCursor,
  cursorChar,
}: {
  blinkCursor: boolean
  cursorChar: string
}) {
  return (
    <span
      className={cn(
        "inline-block ml-0.5 align-middle",
        blinkCursor && "animate-blink-cursor"
      )}
    >
      {cursorChar}
    </span>
  )
}

interface TypingAnimationProps extends Omit<MotionProps, "children"> {
  children?: string
  words?: string[]
  className?: string
  duration?: number
  typeSpeed?: number
  deleteSpeed?: number
  delay?: number
  pauseDelay?: number
  loop?: boolean
  as?: MotionElementType
  startOnView?: boolean
  showCursor?: boolean
  blinkCursor?: boolean
  cursorStyle?: "line" | "block" | "underscore"
  onComplete?: () => void
  markdown?: boolean
  remarkPlugins?: PluggableList
}

export function TypingAnimation({
  children,
  words,
  className,
  duration = 100,
  typeSpeed,
  deleteSpeed,
  delay = 0,
  pauseDelay = 1000,
  loop = false,
  as: Component = "span",
  startOnView = true,
  showCursor = true,
  blinkCursor = true,
  cursorStyle = "line",
  onComplete,
  markdown = false,
  remarkPlugins = [remarkGfm],
  ...props
}: TypingAnimationProps) {
  const MotionComponent = motionElements[
    Component
  ] as TypingAnimationMotionComponent

  const [state, dispatchState] = useReducer(
    typingAnimationReducer,
    INITIAL_TYPING_STATE
  )
  const elementRef = useRef<HTMLElement | null>(null)
  const isInView = useInView(elementRef as RefObject<Element>, {
    amount: 0.3,
    once: true,
  })

  const wordsToAnimate = useMemo(
    () => words ?? (children ? [children] : []),
    [words, children]
  )
  const hasMultipleWords = wordsToAnimate.length > 1

  const typingSpeed = typeSpeed ?? duration
  const deletingSpeed = deleteSpeed ?? typingSpeed / 2

  const shouldStart = startOnView ? isInView : true
  const animationSourceKey = useMemo(
    () => (words ? words.join("\u0000") : (children ?? "")),
    [words, children]
  )
  const { displayedText, currentWordIndex, currentCharIndex, phase } = state

  // PREVENT RESET ON STREAMING:
  // Only reset if the text fundamentally changes (e.g. new session or major swap)
  // but if it's just being appended, we let the typing logic catch up.
  const lastBaseTextRef = useRef(animationSourceKey);
  useEffect(() => {
    // If the new text is shorter than the old one, it's a reset.
    // If it's a completely different start, it's a reset.
    if (!animationSourceKey.startsWith(lastBaseTextRef.current)) {
      dispatchState({ type: "reset" })
    }
    lastBaseTextRef.current = animationSourceKey;
  }, [animationSourceKey])

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | null = null

    if (shouldStart && wordsToAnimate.length > 0) {
      const timeoutDelay =
        delay > 0 && displayedText === ""
          ? delay
          : phase === "typing"
            ? typingSpeed
            : phase === "deleting"
              ? deletingSpeed
              : pauseDelay

      timeout = setTimeout(() => {
        const currentWord = wordsToAnimate[currentWordIndex] || ""
        const graphemes = Array.from(currentWord)

        switch (phase) {
          case "typing":
            if (currentCharIndex < graphemes.length) {
              const charGap = graphemes.length - currentCharIndex;
              // Catch-up: if we're far behind (> 10 chars), type faster
              const nextCharsCount = charGap > 50 ? 5 : charGap > 10 ? 2 : 1;
              const nextIndex = Math.min(graphemes.length, currentCharIndex + nextCharsCount);
              
              dispatchState({
                type: "patch",
                patch: {
                  displayedText: graphemes.slice(0, nextIndex).join(""),
                  currentCharIndex: nextIndex,
                },
              })
            } else {
              if (hasMultipleWords || loop) {
                const isLastWord =
                  currentWordIndex === wordsToAnimate.length - 1
                if (!isLastWord || loop) {
                  dispatchState({ type: "patch", patch: { phase: "pause" } })
                }
              }
            }
            break

          case "pause":
            dispatchState({ type: "patch", patch: { phase: "deleting" } })
            break

          case "deleting":
            if (currentCharIndex > 0) {
              dispatchState({
                type: "patch",
                patch: {
                  displayedText: graphemes.slice(0, currentCharIndex - 1).join(""),
                  currentCharIndex: currentCharIndex - 1,
                },
              })
            } else {
              const nextIndex = (currentWordIndex + 1) % wordsToAnimate.length
              dispatchState({
                type: "patch",
                patch: {
                  currentWordIndex: nextIndex,
                  phase: "typing",
                },
              })
            }
            break
        }
      }, timeoutDelay)
    }

    return () => {
      if (timeout !== null) {
        clearTimeout(timeout)
      }
    }
  }, [
    shouldStart,
    phase,
    currentCharIndex,
    currentWordIndex,
    displayedText,
    wordsToAnimate,
    hasMultipleWords,
    loop,
    typingSpeed,
    deletingSpeed,
    pauseDelay,
    delay,
  ])

  const currentWordGraphemes = Array.from(
    wordsToAnimate[currentWordIndex] || ""
  )
  const isComplete =
    !loop &&
    currentWordIndex === wordsToAnimate.length - 1 &&
    currentCharIndex >= currentWordGraphemes.length &&
    phase !== "deleting"

  useEffect(() => {
    if (isComplete && onComplete) {
      onComplete()
    }
  }, [isComplete, onComplete])

  const shouldShowCursor =
    showCursor &&
    !isComplete &&
    (hasMultipleWords || loop || currentCharIndex < currentWordGraphemes.length)

  const getCursorChar = () => {
    switch (cursorStyle) {
      case "block": return "▌"
      case "underscore": return "_"
      case "line":
      default: return "|"
    }
  }

  return (
    <MotionComponent
      ref={elementRef}
      className={cn(
        "leading-relaxed tracking-[-0.01em] m-0 p-0",
        !markdown && "whitespace-pre-wrap", // Markdown handles its own wrapping/newlines
        Component === "span" && "inline-block",
        className
      )}
      {...props}
    >
      {markdown ? (
        <ReactMarkdown
          remarkPlugins={remarkPlugins}
          components={{
            p: ({ children }) => (
              <p className="mb-4 last:mb-0">
                {children}
                {shouldShowCursor && <TypingCursor blinkCursor={blinkCursor} cursorChar={getCursorChar()} />}
              </p>
            ),
            li: ({ children }) => (
              <li className="mb-1 last:mb-0">
                {children}
                {shouldShowCursor && <TypingCursor blinkCursor={blinkCursor} cursorChar={getCursorChar()} />}
              </li>
            ),
          }}
        >
          {/* Trim leading whitespace to avoid interpreting stream-start spaces as code blocks */}
          {displayedText.trimStart()}
        </ReactMarkdown>
      ) : (
        <>
          {displayedText}
          {shouldShowCursor && <TypingCursor blinkCursor={blinkCursor} cursorChar={getCursorChar()} />}
        </>
      )}
    </MotionComponent>
  )
}
