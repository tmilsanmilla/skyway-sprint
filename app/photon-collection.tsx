import {
  PHOTON_CHARACTERS,
  PHOTON_WEAPONS,
  isPhotonWeaponCompatible,
  type PhotonCharacterKey,
  type PhotonWeaponKey,
} from "./photon-fury-rules";
import {
  PHOTON_SKINS,
  PHOTON_THEMES,
  PHOTON_BOX_COST,
  DEFAULT_PHOTON_THEME,
} from "./photon-collection-rules";
import { PhotonAvatar } from "./photon-avatar";
export type PhotonRewardView = {
  kind: string;
  key: string;
  is_new?: boolean;
  duplicate_gems?: number;
  amount?: number;
  name?: string;
};
export function PhotonCollection({
  character,
  characters,
  weapon,
  skins,
  skinChoices,
  themes,
  theme,
  weapons,
  level,
  gems,
  photons,
  busy,
  running,
  results,
  onEquip,
  onBuyWeapon,
  onOpen,
  onSkin,
  onTheme,
}: {
  character: PhotonCharacterKey;
  characters: readonly PhotonCharacterKey[];
  weapon: PhotonWeaponKey;
  skins: readonly string[];
  skinChoices: Record<string, string>;
  themes: readonly string[];
  theme: string;
  weapons: readonly PhotonWeaponKey[];
  level: number;
  gems: number;
  photons: number;
  busy: boolean;
  running: boolean;
  results: readonly PhotonRewardView[];
  onEquip: (key: PhotonWeaponKey) => void;
  onBuyWeapon: (key: PhotonWeaponKey) => void;
  onOpen: () => void;
  onSkin: (key: string) => void;
  onTheme: (key: string) => void;
}) {
  return (
    <div className="photon-collection-extras">
      <details className="photon-category">
        <summary>MYSTERY BOX · {PHOTON_BOX_COST} PHOTONS</summary>
        <p>
          One Traditional character, bonus characters and skins, then a theme
          pack, Gems or an Intermediate skin. Duplicates are allowed:
          repeat characters and themes return 5 Gems; Part B skins return 10
          Gems, and Part C skins return 5 Gems.
        </p>
        <details>
          <summary>BOX ODDS</summary>
          <p>A: Tick 48% · Trumpet 29% · Saxophone 23%.</p>
          <p>
            B: 35% two bonus categories + one skin; 65% one bonus category + two
            skins. Categories never repeat within B.
          </p>
          <p>
            Rush: Bull 41% · Nuclear 33% · Burner 26%. Strategic: Wrench 57% ·
            Bear 32% · Magnet 11%. Wild: Oyster 26% · Static 18% · Spade 11% ·
            skin instead 45%.
          </p>
          <p>
            Skins: all 16 characters equally likely; Intermediate 55% · Pro 40%
            · Divine 5%. C: two themes 65% · 20 Gems 15% · Intermediate skin
            20%.
          </p>
          <p>
            Themes: Common 40% · Uncommon 30% · Rare 15.1% · Epic 11.4% ·
            Legendary 3.3% · Mythic 0.2%.
          </p>
        </details>
        <button
          disabled={busy || running || photons < PHOTON_BOX_COST}
          onClick={onOpen}
        >
          {busy ? "OPENING…" : `OPEN BOX · ${PHOTON_BOX_COST} PHOTONS`}
        </button>
        {busy && (
          <div className="photon-box-opening" aria-label="Opening mystery box">
            ◇
          </div>
        )}
        {!!results.length && (
          <section
            className="photon-box-results"
            aria-label="Mystery box rewards"
          >
            {results.map((r, i) => (
              <article key={i}>
                <b>
                  {r.name ??
                    PHOTON_CHARACTERS[r.key as PhotonCharacterKey]?.name ??
                    PHOTON_SKINS.find((s) => s.key === r.key)?.name ??
                    PHOTON_THEMES.find((t) => t.key === r.key)?.name ??
                    r.key}
                </b>
                <small>
                  {r.kind === "gems"
                    ? `+${r.amount} GEMS`
                    : r.is_new
                      ? "NEW"
                      : `DUPLICATE · +${r.duplicate_gems ?? 0} GEMS`}
                </small>
              </article>
            ))}
          </section>
        )}
      </details>
      <details className="photon-category">
        <summary>CHARACTER SKINS</summary>
        <p>
          Skins are cosmetic only. Each character has a free Default look and
          three box-only looks.
        </p>
        {(Object.keys(PHOTON_CHARACTERS) as PhotonCharacterKey[]).map((key) => (
          <details className="photon-skin-group" key={key}>
            <summary>{PHOTON_CHARACTERS[key].name}</summary>
            <div className="photon-skin-grid">
              <button
                disabled={busy || running || !characters.includes(key)}
                className={characters.includes(key) && !skinChoices[key] ? "selected" : ""}
                onClick={() => onSkin(`default:${key}`)}
              >
                DEFAULT · {characters.includes(key) ? "OWNED" : "CHARACTER LOCKED"}
              </button>
              {PHOTON_SKINS.filter((s) => s.character === key).map((s) => (
                <button
                  key={s.key}
                  className={`skin-${s.tier}${skinChoices[key] === s.key ? " selected" : ""}`}
                  disabled={
                    busy ||
                    running ||
                    !characters.includes(key) ||
                    !skins.includes(s.key)
                  }
                  onClick={() => onSkin(s.key)}
                >
                  <b>{s.name}</b>
                  <span className="photon-skin-preview"><PhotonAvatar character={key} skin={s.key} /></span>
                  <small>{s.description}</small>
                  <small>{s.tier.toUpperCase()}</small>
                  <em>{skins.includes(s.key) ? "OWNED" : "LOCKED"}</em>
                </button>
              ))}
            </div>
          </details>
        ))}
      </details>
      <details className="photon-category">
        <summary>LASERDROME THEMES</summary>
        <p>Cosmetic environments only; no gameplay bonuses.</p>
        <div className="photon-theme-grid">
          {[DEFAULT_PHOTON_THEME, ...PHOTON_THEMES].map((t) => (
            <button
              key={t.key}
              className={theme === t.key ? "selected" : ""}
              disabled={
                busy ||
                running ||
                (t.key !== "default" && !themes.includes(t.key))
              }
              onClick={() => onTheme(t.key)}
            >
              <span
                style={{
                  background: `repeating-linear-gradient(90deg,transparent 0 22%,${t.glow} 23% 25%),linear-gradient(${t.floor},${t.accent})`,
                }}
              />
              <b>{t.name}</b>
              <small>
                {t.rarity.toUpperCase()} ·{" "}
                {t.key === "default" || themes.includes(t.key)
                  ? "OWNED"
                  : "LOCKED"}
              </small>
            </button>
          ))}
        </div>
      </details>
      <details className="photon-category">
        <summary>WEAPONS · UNLOCK PURCHASES AT LEVEL 35</summary>
        <p>
          Replace the Lightsaber for this mode only. Character abilities stay
          available; weapon abilities use F. Blaster, Magnetite Sword and
          Concentrated Laser cannot be paired with Bear or Magnet.
        </p>
        <div className="photon-weapon-grid">
          {(Object.keys(PHOTON_WEAPONS) as PhotonWeaponKey[]).map((key) => {
            const w = PHOTON_WEAPONS[key],
              owned = key === "lightsaber" || weapons.includes(key),
              compatible = isPhotonWeaponCompatible(key, character);
            return (
              <article key={key}>
                <b>{w.name}</b>
                <p>{w.description}</p>
                <small>
                  {key === "lightsaber"
                    ? "DEFAULT"
                    : `${w.photons.toLocaleString()} PHOTONS + ${w.gems} GEMS`}
                </small>
                {owned ? (
                  <button
                    disabled={busy || running || !compatible || weapon === key}
                    onClick={() => onEquip(key)}
                  >
                    {!compatible
                      ? "INCOMPATIBLE"
                      : weapon === key
                        ? "EQUIPPED"
                        : "EQUIP"}
                  </button>
                ) : (
                  <button
                    disabled={
                      busy ||
                      running ||
                      level < 35 ||
                      photons < w.photons ||
                      gems < w.gems
                    }
                    onClick={() => onBuyWeapon(key)}
                  >
                    {level < 35 ? "LEVEL 35 REQUIRED" : "UNLOCK WEAPON"}
                  </button>
                )}
              </article>
            );
          })}
        </div>
      </details>
    </div>
  );
}
