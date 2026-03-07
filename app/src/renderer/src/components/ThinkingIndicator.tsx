import { memo, useState, useEffect } from 'react'

const THINKING_MESSAGES = [
  "Analyzing your request",
  "Considering the best approach",
  "Evaluating available tools",
  "Formulating a plan",
  "Preparing a response",
]

interface ThinkingIndicatorProps {
  message?: string
}

export const ThinkingIndicator = memo(function ThinkingIndicator({
  message,
}: ThinkingIndicatorProps) {
  const [messageIndex, setMessageIndex] = useState(0)
  const [fadeState, setFadeState] = useState<'in' | 'out'>('in')

  useEffect(() => {
    if (message) return // Don't cycle if custom message provided

    const cycleMessage = () => {
      setFadeState('out')
      setTimeout(() => {
        setMessageIndex((prev) => (prev + 1) % THINKING_MESSAGES.length)
        setFadeState('in')
      }, 200)
    }

    const interval = setInterval(cycleMessage, 2500)
    return () => clearInterval(interval)
  }, [message])

  const displayMessage = message || THINKING_MESSAGES[messageIndex]

  return (
    <div className="self-start flex items-center gap-3 py-3 px-4 bg-card border border-border rounded-xl max-w-[80%]">
      {/* Animated avatar */}
      <div className="relative flex-shrink-0">
        <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center">
          <span className="material-icon text-primary-foreground" style={{ fontSize: 18 }}>
            smart_toy
          </span>
        </div>
        {/* Pulsing ring animation */}
        <div className="absolute inset-0 rounded-full bg-primary animate-ping opacity-25" />
        {/* Secondary pulse */}
        <div className="absolute inset-0 rounded-full bg-primary animate-pulse opacity-15" style={{ animationDuration: '2s' }} />
      </div>

      {/* Text content */}
      <div className="flex flex-col gap-1 min-w-[200px]">
        {/* Main message with fade transition */}
        <div
          className={`flex items-center gap-1.5 text-foreground font-secondary text-[14px] font-medium transition-opacity duration-200 ${
            fadeState === 'in' ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <span>{displayMessage}</span>
          <span className="inline-flex">
            <span className="animate-bounce" style={{ animationDelay: '0ms' }}>.</span>
            <span className="animate-bounce" style={{ animationDelay: '150ms' }}>.</span>
            <span className="animate-bounce" style={{ animationDelay: '300ms' }}>.</span>
          </span>
        </div>

        {/* Subtle hint text */}
        <span className="text-muted-dim font-secondary text-[11px]">
          This may take a few moments...
        </span>

        {/* Progress bar */}
        <div className="w-full h-0.5 bg-border rounded-full mt-1 overflow-hidden">
          <div
            className="h-full bg-primary rounded-full animate-[shimmer_1.5s_ease-in-out_infinite]"
            style={{
              width: '40%',
              animation: 'shimmer 1.5s ease-in-out infinite',
            }}
          />
        </div>
      </div>

      {/* CSS for shimmer animation */}
      <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(250%); }
        }
      `}</style>
    </div>
  )
})
