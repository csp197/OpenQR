interface FooterProps {
  status: string;
  isListening: boolean;
  mode: { status: string };
  getStatusColor: (
    isGenerating: boolean,
    isPending: boolean,
    isProcessing: boolean,
    isListening: boolean,
  ) => string;
}

const Footer = ({ status, isListening, mode, getStatusColor }: FooterProps) => {
  const isProcessing = mode.status === "PROCESSING";
  const isPending = mode.status === "PENDING_REDIRECT";
  const isGenerating = mode.status === "GENERATING";

  return (
    <footer className="h-10 border-t bg-white dark:bg-zinc-950 dark:border-zinc-800 flex items-center px-4 text-xs text-zinc-500 transition-colors">
      <div className="flex items-center gap-2">
        <span
          className={`w-2 h-2 rounded-full transition-all duration-500 ${getStatusColor(isGenerating, isPending, isProcessing, isListening)}`}
        />
        <span className="font-medium tracking-tight">
          <span
            className={
              isPending || isProcessing
                ? "text-blue-600 dark:text-blue-400"
                : ""
            }
          >
            {status}
          </span>
        </span>
      </div>
    </footer>
  );
};

export default Footer;
