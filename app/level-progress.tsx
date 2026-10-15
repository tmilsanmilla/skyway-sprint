export function LevelProgress({ level, xp, required }: {
  level: number; xp: number; required: number;
}) {
  const total = Number.isFinite(required) ? Math.max(1, Math.floor(required)) : 1;
  const earned = Number.isFinite(xp) ? Math.min(total, Math.max(0, Math.floor(xp))) : 0;
  const progress = Math.min(100, earned / total * 100);
  return <div className="player-level-card" aria-label={`Level ${level}`}>
    <span className="player-level-number"><small>LEVEL</small><b>{level}</b></span>
    <span className="player-level-meter">
      <i role="progressbar" aria-label="Progress toward next level"
        aria-valuemin={0} aria-valuemax={total} aria-valuenow={earned}
        aria-valuetext={`${earned.toLocaleString()} of ${total.toLocaleString()} XP toward the next level`}>
        <u style={{ width: `${progress}%` }} />
      </i>
      <small className="player-level-xp">{earned.toLocaleString()} / {total.toLocaleString()} XP</small>
    </span>
  </div>;
}
