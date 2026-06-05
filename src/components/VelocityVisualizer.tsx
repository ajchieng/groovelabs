import { roleLabel, type VelocityHumanizeChange } from "../engine/velocityHumanizer";
import type { DrumRole } from "../types/groove";
import { TICKS_PER_BEAT } from "../types/groove";

type VelocityVisualizerProps = {
  changes: VelocityHumanizeChange[];
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

export function VelocityVisualizer({ changes }: VelocityVisualizerProps) {
  const roles = ROLE_ORDER.filter((role) => changes.some((change) => change.role === role));
  const maxTick = Math.max(TICKS_PER_BEAT * 4, ...changes.map((change) => change.time));
  const width = 1040;
  const left = 104;
  const right = 24;
  const top = 28;
  const laneHeight = 62;
  const height = top + roles.length * laneHeight + 36;
  const plotWidth = width - left - right;
  const velocityHeight = 34;

  const xForTime = (time: number) => left + (time / maxTick) * plotWidth;
  const yForRole = (role: DrumRole) => top + roles.indexOf(role) * laneHeight + laneHeight / 2;
  const yForVelocity = (role: DrumRole, velocityMidi: number) => {
    const center = yForRole(role);
    return center + velocityHeight / 2 - (velocityMidi / 127) * velocityHeight;
  };

  return (
    <div className="visualizer-shell" aria-label="Before and after note velocities">
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

        {changes.map((change) => {
          const x = xForTime(change.time);
          const originalY = yForVelocity(change.role, change.originalVelocityMidi);
          const newY = yForVelocity(change.role, change.newVelocityMidi);
          const color = ROLE_COLORS[change.role];

          return (
            <g key={change.id}>
              <line className="change-line" x1={x} x2={x} y1={originalY} y2={newY} />
              <circle className="original-dot" cx={x} cy={originalY} r="5">
                <title>{`${roleLabel(change.role)} original velocity ${
                  change.originalVelocityMidi
                }`}</title>
              </circle>
              <circle cx={x} cy={newY} r="7" fill={color}>
                <title>{`${roleLabel(change.role)} velocity ${change.newVelocityMidi} (${
                  change.deltaMidi >= 0 ? "+" : ""
                }${change.deltaMidi})`}</title>
              </circle>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
