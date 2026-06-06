import type { DrumEvent, DrumRole, HumanizerChange } from "../types/groove";
import { TICKS_PER_BEAT } from "../types/groove";
import { roleLabel } from "../engine/drumFormat";

type GrooveVisualizerProps = {
  originalEvents: DrumEvent[];
  transformedEvents: DrumEvent[];
  changes: HumanizerChange[];
};

const ROLE_ORDER: DrumRole[] = [
  "kick",
  "snare",
  "clap",
  "closed_hat",
  "open_hat",
  "perc",
  "unknown",
];

const ROLE_COLORS: Record<DrumRole, string> = {
  kick: "#2563eb",
  snare: "#e11d48",
  clap: "#f97316",
  closed_hat: "#0f766e",
  open_hat: "#14b8a6",
  perc: "#9333ea",
  unknown: "#64748b",
};

export function GrooveVisualizer({
  originalEvents,
  transformedEvents,
  changes,
}: GrooveVisualizerProps) {
  const roles = ROLE_ORDER.filter(
    (role) =>
      originalEvents.some((event) => event.role === role) ||
      transformedEvents.some((event) => event.role === role),
  );
  const maxTick = Math.max(
    TICKS_PER_BEAT * 4,
    ...originalEvents.map((event) => event.time + (event.duration ?? 0)),
    ...transformedEvents.map((event) => event.time + (event.duration ?? 0)),
  );
  const width = 1040;
  const left = 104;
  const right = 24;
  const top = 28;
  const laneHeight = 54;
  const height = top + roles.length * laneHeight + 34;
  const plotWidth = width - left - right;

  const xForTime = (time: number) => left + (time / maxTick) * plotWidth;
  const yForRole = (role: DrumRole) => top + roles.indexOf(role) * laneHeight + laneHeight / 2;
  const changesById = new Map(changes.map((change) => [change.id, change]));

  return (
    <div className="visualizer-shell" aria-label="Before and after groove timing">
      <svg viewBox={`0 0 ${width} ${height}`} role="img">
        {roles.map((role) => (
          <g key={role}>
            <text className="lane-label" x="18" y={yForRole(role) + 5}>
              {roleLabel(role)}
            </text>
            <line
              className="lane-line"
              x1={left}
              x2={width - right}
              y1={yForRole(role)}
              y2={yForRole(role)}
            />
          </g>
        ))}

        {Array.from({ length: Math.ceil(maxTick / TICKS_PER_BEAT) + 1 }).map((_, beat) => {
          const x = xForTime(beat * TICKS_PER_BEAT);
          return (
            <g key={beat}>
              <line className="beat-line" x1={x} x2={x} y1="14" y2={height - 24} />
              <text className="beat-label" x={x + 5} y={height - 8}>
                {beat + 1}
              </text>
            </g>
          );
        })}

        {transformedEvents.map((event) => {
          const change = changesById.get(event.id);
          if (!change) {
            return null;
          }

          const y = yForRole(event.role);
          const oldX = xForTime(change.originalTime);
          const newX = xForTime(event.time);
          const radius = 5 + event.velocity * 7;
          const color = ROLE_COLORS[event.role];

          return (
            <g key={event.id}>
              <line
                className={change.added ? "change-line ghost-line" : "change-line"}
                x1={oldX}
                x2={newX}
                y1={y}
                y2={y}
              />
              {!change.added && (
                <circle
                  className="original-dot"
                  cx={oldX}
                  cy={y}
                  r={Math.max(4, radius - 3)}
                >
                  <title>{`${roleLabel(event.role)} original at ${Math.round(
                    change.originalTime,
                  )} ticks`}</title>
                </circle>
              )}
              <circle cx={newX} cy={y} r={radius} fill={color}>
                <title>{`${roleLabel(event.role)} ${change.added ? "ghost" : "moved"} by ${
                  change.shiftMs
                } ms, velocity ${event.velocity}`}</title>
              </circle>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
