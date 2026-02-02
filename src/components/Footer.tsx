interface FooterProps {
  status: string;
}

const Footer = ({ status }: FooterProps) => {
  return (
    <footer className="h-10 border-t bg-white dark:bg-zinc-950 dark:border-zinc-800 flex items-center px-4 text-xs text-zinc-500 transition-colors">
      <div className="flex items-center gap-2">
        <span
          className={`w-2 h-2 rounded-full ${status === "Ready" ? "bg-green-500" : "bg-blue-500 animate-pulse"}`}
        />
        <span className="font-medium tracking-tight">
          Status:{" "}
          <span
            className={
              status !== "Ready" ? "text-blue-600 dark:text-blue-400" : ""
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
