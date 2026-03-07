import { useAppStore } from '../../stores/useAppStore'

export default function AdvancedSecurity() {
  const agentConfig = useAppStore((s) => s.agentConfig)
  const updateYoloMode = useAppStore((s) => s.updateYoloMode)

  const isYoloEnabled = agentConfig?.yoloMode ?? false

  const handleToggle = async () => {
    await updateYoloMode(!isYoloEnabled)
  }

  return (
    <div className="max-w-[640px] mx-auto flex flex-col gap-5">
      <div>
        <h3 className="font-secondary text-[18px] font-semibold text-foreground">Security & Execution</h3>
        <p className="font-secondary text-[14px] text-muted mt-1">
          Configure how the agent executes actions and interacts with your system.
        </p>
      </div>

      <div className="bg-card border border-border rounded-xl p-5 flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1.5">
            <span className="font-secondary text-[14px] font-semibold text-foreground">YOLO Mode</span>
            <p className="font-secondary text-[13px] text-muted m-0" style={{ maxWidth: 400 }}>
              When enabled, the agent will execute commands and tools automatically without waiting for your approval. Use with extreme caution.
            </p>
          </div>
          <button
            onClick={handleToggle}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${isYoloEnabled ? 'bg-red-500' : 'bg-muted'}`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isYoloEnabled ? 'translate-x-6' : 'translate-x-1'}`}
            />
          </button>
        </div>
        <div className="flex items-start gap-2 mt-2">
          <span className="material-icon text-red-500 shrink-0" style={{ fontSize: 16 }}>warning</span>
          <p className="font-secondary text-[12px] text-red-500/80 m-0 leading-relaxed">
            Warning: In YOLO mode, Coworker can delete files, run arbitrary code, and make system changes without confirmation. Ensure you understand the risks before enabling.
          </p>
        </div>
      </div>
    </div>
  )
}
