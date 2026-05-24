import { cn } from "@/lib/utils";
import type { ConnectionState } from "@/lib/realtime/types";

const STATUS_CONFIG: Record<
  ConnectionState,
  { dot: string; label: string }
> = {
  idle: { dot: "bg-gray-500", label: "Selecciona un personaje" },
  connecting: { dot: "bg-yellow-400 animate-pulse", label: "Conectando..." },
  connected: { dot: "bg-green-400", label: "Conectado" },
  error: { dot: "bg-red-500", label: "Error de conexión" },
};

export function ConnectionStatus({ state }: { state: ConnectionState }) {
  const { dot, label } = STATUS_CONFIG[state];
  return (
    <div className="flex items-center gap-2">
      <span className={cn("inline-block w-2 h-2 rounded-full", dot)} />
      <span className="text-sm text-gray-400">{label}</span>
    </div>
  );
}
