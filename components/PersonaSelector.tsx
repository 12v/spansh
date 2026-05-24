import { cn } from "@/lib/utils";
import type { Persona } from "@/lib/personas/types";

interface PersonaSelectorProps {
  personas: Persona[];
  onSelect: (persona: Persona) => void;
  loading: boolean;
}

export function PersonaSelector({ personas, onSelect, loading }: PersonaSelectorProps) {
  return (
    <div className="w-full max-w-2xl mx-auto">
      <h2 className="text-lg font-medium text-gray-300 mb-4 text-center">
        ¿Con quién quieres hablar?
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {personas.map((persona) => (
          <button
            key={persona.id}
            onClick={() => onSelect(persona)}
            disabled={loading}
            className={cn(
              "group flex flex-col items-start gap-2 rounded-xl border border-gray-700",
              "bg-gray-900 hover:bg-gray-800 hover:border-indigo-500",
              "p-4 text-left transition-all duration-150",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              "focus:outline-none focus:ring-2 focus:ring-indigo-500"
            )}
          >
            <span className="font-semibold text-white text-sm leading-snug">
              {persona.displayName}
            </span>
            <span className="text-xs text-gray-400 leading-snug line-clamp-2">
              {persona.description}
            </span>
            <div className="flex flex-wrap gap-1 mt-1">
              <Badge>{persona.accentRegion}</Badge>
              <Badge variant="secondary">{persona.speakingStyle}</Badge>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function Badge({
  children,
  variant = "primary",
}: {
  children: React.ReactNode;
  variant?: "primary" | "secondary";
}) {
  return (
    <span
      className={cn(
        "inline-block rounded-full px-2 py-0.5 text-xs font-medium",
        variant === "primary"
          ? "bg-indigo-900 text-indigo-300"
          : "bg-gray-800 text-gray-400"
      )}
    >
      {children}
    </span>
  );
}
