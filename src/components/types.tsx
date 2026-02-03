type AppState =
  | { status: "IDLE" }
  | { status: "LISTENING" }
  | { status: "PROCESSING"; code: string }
  | { status: "ERROR"; message: string }
  | { status: "GENERATING"; feedback?: string };

type ScanObject = {
  id: string;
  url: string;
  timestamp: string;
};
