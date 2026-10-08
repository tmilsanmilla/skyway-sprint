/** Shared pixel art: changing modes must not change how familiar hazards look. */
export function Obstacle({ kind }: { kind: string }) {
  if (kind === "vortex") return <span className="vortex-shape" aria-hidden="true">◎</span>;
  if (kind === "gem") return <span>♦</span>;
  if (kind === "coin") return <span>●</span>;
  if (kind === "melon") return <span aria-hidden="true">🍉</span>;
  if (kind === "mushroom") return <span aria-hidden="true">🍄</span>;
  if (kind === "current") return <span aria-hidden="true">≈</span>;
  if (kind === "needle") return <div className="photon-needle" aria-hidden="true" />;
  if (kind === "warpstone") return <div className="photon-warpstone" aria-hidden="true" />;
  if (kind === "barrel") return <div className="barrel-shape"><i /><b /><em /></div>;
  if (kind === "car") return <div className="car-shape">
    <i className="windshield" /><i className="light left" /><i className="light right" />
    <i className="wheel left" /><i className="wheel right" /><b />
  </div>;
  if (kind === "spikes" || kind === "spike") return <div className="ground-spike-shape"><span>!</span><i /><i /><i /><i /></div>;
  if (kind === "log") return <div className="log-shape"><i /><b /><em /></div>;
  if (kind === "snowflake") return <span>❄</span>;
  return <div className="rock-shape"><u /><i /><b /><em /></div>;
}
