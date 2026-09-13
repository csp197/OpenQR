import { Ban, Plus, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import { normalizeDomain } from "../lib/domain";

export type ListVariant = "block" | "allow";

interface ListSectionProps {
  /** Which card this renders: the blocklist or the allowlist. */
  variant: ListVariant;
  items: string[];
  onChange: (items: string[]) => void;
  /** Entries in the other list, so cross-list duplicates are rejected. */
  otherListItems: string[];
  /** Display name of the other list, used in the duplicate error message. */
  otherListName: string;
}

const VARIANT_CONFIG: Record<
  ListVariant,
  {
    title: string;
    description: string;
    icon: typeof Ban;
    iconClassName: string;
    inputAriaLabel: string;
    listAriaLabel: string;
    emptyText: string;
  }
> = {
  block: {
    title: "Blocked sites",
    description: "These sites will never open.",
    icon: Ban,
    iconClassName: "text-red-500",
    inputAriaLabel: "Add a blocked site",
    listAriaLabel: "Blocked sites",
    emptyText: "No blocked sites yet.",
  },
  allow: {
    title: "Only allow these sites",
    description: "Leave empty to allow every site that isn't blocked.",
    icon: ShieldCheck,
    iconClassName: "text-green-600 dark:text-green-500",
    inputAriaLabel: "Add an allowed site",
    listAriaLabel: "Allowed sites",
    emptyText: "No sites yet — all sites can open.",
  },
};

const ListSection = ({ variant, items, onChange, otherListItems, otherListName }: ListSectionProps) => {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const config = VARIANT_CONFIG[variant];
  const Icon = config.icon;
  const titleId = `list-section-${variant}-title`;
  const trimmed = value.trim();

  const handleAdd = () => {
    const domain = normalizeDomain(value);
    if (!domain) {
      setError("Enter a site like example.com");
      return;
    }
    if (items.includes(domain)) {
      setError(`${domain} is already in ${config.title}.`);
      return;
    }
    if (otherListItems.includes(domain)) {
      setError(`${domain} is already in ${otherListName}.`);
      return;
    }
    // Newest entries first.
    onChange([domain, ...items]);
    setValue("");
    setError(null);
  };

  const handleRemove = (domain: string) => {
    onChange(items.filter((item) => item !== domain));
  };

  return (
    <section
      aria-labelledby={titleId}
      className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/[0.03] p-4 space-y-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Icon size={16} className={`mt-0.5 shrink-0 ${config.iconClassName}`} />
          <div>
            <h3 id={titleId} className="text-sm font-semibold">
              {config.title}
            </h3>
            <p className="text-xs text-zinc-600 dark:text-zinc-400">{config.description}</p>
            {variant === "allow" && items.length > 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                Only {items.length} site{items.length === 1 ? "" : "s"} can open. Everything else
                is blocked.
              </p>
            )}
          </div>
        </div>
        {variant === "allow" && (
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
              items.length > 0
                ? "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
                : "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
            }`}
          >
            {items.length > 0 ? "On" : "Off"}
          </span>
        )}
      </div>

      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
          placeholder="example.com"
          aria-label={config.inputAriaLabel}
          className="flex-1 min-w-0 bg-white dark:bg-zinc-900 py-2 px-3 rounded-xl text-sm outline-none border border-zinc-300 dark:border-white/10 focus-visible:ring-2 focus-visible:ring-blue-500"
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={!trimmed}
          className="flex items-center gap-1 border border-zinc-300 dark:border-white/15 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-xl px-3 py-2 text-sm font-medium shrink-0 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <Plus size={14} />
          Add
        </button>
      </div>

      {error && (
        <p role="alert" className="text-xs text-red-500">
          {error}
        </p>
      )}

      {items.length > 0 ? (
        <ul
          aria-label={config.listAriaLabel}
          className="divide-y divide-zinc-200 dark:divide-white/10 rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900 overflow-hidden"
        >
          {items.map((item) => (
            <li key={item} className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="text-sm truncate" title={item}>
                {item}
              </span>
              <button
                type="button"
                onClick={() => handleRemove(item)}
                aria-label={`Remove ${item}`}
                className="p-1.5 rounded-md text-zinc-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 shrink-0 focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{config.emptyText}</p>
      )}
    </section>
  );
};

export default ListSection;
