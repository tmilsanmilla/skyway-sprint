import type { CSSProperties } from "react";
import { getPhotonCharacter, type PhotonCharacterKey } from "./photon-fury-rules";
import { PHOTON_SKINS } from "./photon-collection-rules";

/** The same equipped look is used in collection previews and the live arena. */
export function PhotonAvatar({ character, guarding = false, lane, skin = "" }: {
  character: PhotonCharacterKey;
  guarding?: boolean;
  lane?: number;
  skin?: string;
}) {
  const appearance = PHOTON_SKINS.find((s) => s.key === skin && s.character === character);
  const tier = appearance?.tier ?? "default";
  const style = {
    ...(lane === undefined ? {} : { left: `${(lane + 0.5) * 25}%` }),
    ...(appearance ? { "--photon-skin-color": appearance.color } : {}),
  } as CSSProperties;
  return (
    <div className={`runner photon-runner photon-character-${character} photon-skin-${tier}`}
      style={style} role="img" aria-label={`${getPhotonCharacter(character).name} · ${appearance?.name ?? "Default"}`}>
      <div className="head" />
      <div className="body" />
      <i className="arm a1" /><i className="arm a2" />
      <i className="leg g1" /><i className="leg g2" />
      <em /><i className="photon-accessory" />
      <span className="photon-suit-emblem" aria-hidden="true">{appearance?.emblem ?? "◈"}</span>
      {guarding ? <i className="photon-blade" /> : null}
    </div>
  );
}
