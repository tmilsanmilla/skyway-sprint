import { broadLevelProgress } from "./progression-rules";

export function LevelProgress({ level, xp, required }: {
  level: number; xp: number; required: number;
}) {
  const progress = broadLevelProgress(xp, required);
  return <div className="player-level-card" aria-label={`Level ${level}`}>
    <span className="player-level-number"><small>LEVEL</small><b>{level}</b></span>
    <span className="player-level-meter">
      <i role="progressbar" aria-label="Progress toward next level"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}
        aria-valuetext={progress === 0 ? "Starting this level" : progress < 40 ? "Early progress" : progress < 80 ? "Making progress" : "Near the next level"}>
        <u style={{ width: `${progress}%` }} />
      </i>
    </span>
  </div>;
}
