import { Trash2 } from "lucide-react";

const ListSection = ({ title, items, setItems, color, placeholder }: any) => (
  <div className="space-y-2">
    <h3 className={`text-[10px] font-bold uppercase tracking-widest ${color}`}>
      {title}
    </h3>
    <div className="space-y-1 min-h-10">
      {items.length > 0 ? (
        items.map((item: string, i: number) => (
          <div
            key={i}
            className="flex justify-between items-center p-2 bg-zinc-100 dark:bg-white/5 rounded-lg text-xs group"
          >
            <span className="truncate">{item}</span>
            <button
              onClick={() =>
                setItems(items.filter((_: any, idx: number) => idx !== i))
              }
              className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-red-500 transition-opacity"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))
      ) : (
        <div className="p-3 border border-dashed border-zinc-200 dark:border-white/10 rounded-lg">
          <p className="text-[10px] text-zinc-400 italic text-center leading-tight">
            {placeholder}
          </p>
        </div>
      )}
    </div>
  </div>
);

export default ListSection;
