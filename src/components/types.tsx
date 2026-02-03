type State =
  | { status: "IDLE" } // Scanner tab, waiting
  | { status: "LISTENING" } // Scanner tab, active
  | { status: "PROCESSING"; code: string } // Scanner tab, working
  | { status: "ERROR"; message: string } // Scanner tab, error
  | { status: "GENERATING"; feedback?: string }; // Generator tab (optional feedback msg)
