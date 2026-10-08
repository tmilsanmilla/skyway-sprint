import { EXTRACTION_BOXES, EXTRACTION_MAX_QUANTITY, EXTRACTION_RARITIES, PULL_PROFILES, canOpenBox, affordableBoxQuantity, type ExtractionOption, type PullProfile } from "./extraction-rules";

type Quantities = Record<ExtractionOption, number>;
type Props = {
  level: number; gems: number; busy: boolean; quantities: Quantities; extracting: ExtractionOption | null;
  setQuantities: (update: (current: Quantities) => Quantities) => void;
  onOpen: (option: ExtractionOption) => void;
};
export function ExtractionBoxCards({ level, gems, busy, quantities, extracting, setQuantities, onOpen }: Props) {
  return (
  <div className="extract-actions">
    {(Object.keys(EXTRACTION_BOXES) as ExtractionOption[]).map(
      (option) => {
        const box = EXTRACTION_BOXES[option];
        const levelLocked = !canOpenBox(option, level);
        const batchLimit = EXTRACTION_MAX_QUANTITY;
        const maxQuantity = levelLocked ? 0 : affordableBoxQuantity(option, gems);
        const quantity = Math.max(
          1,
          Math.min(batchLimit, quantities[option]),
        );
        const totalCost = quantity * box.cost;
        const setQuantity = (next: number) =>
          setQuantities((current) => ({
            ...current,
            [option]: Math.max(
              1,
              Math.min(
                Math.max(1, maxQuantity),
                Math.floor(next) || 1,
              ),
            ),
          }));
        return (
          <article key={option} className={`extract-box ${option}${levelLocked ? " level-locked" : ""}`}>
            <b>{box.name}</b>
            <strong className="box-price">♦ {box.cost}</strong>
            <small className="box-level">{levelLocked ? `UNLOCKS AT LEVEL ${box.minLevel}` : `LEVEL ${box.minLevel}+ · ${box.pullCount} PULLS`}</small>
            <small className="box-mix">{box.mix}</small>
            <details className="booster-odds">
              <summary>VIEW PULL ODDS</summary>
              {Array.from(new Set<PullProfile>(box.pulls)).map((profile) => (
                <section key={profile}>
                  <b>{profile.toUpperCase()} PULL</b>
                  <small>{PULL_PROFILES[profile].characterPercent}% CHARACTER · {100 - PULL_PROFILES[profile].characterPercent}% COSMETIC</small>
                  <span className="rarity-chances">
                    {EXTRACTION_RARITIES.map((rarity, i) => (
                      <small key={rarity} className={rarity}><b>{rarity}</b>{PULL_PROFILES[profile].weights[i]}%</small>
                    ))}
                  </span>
                </section>
              ))}
            </details>
            <div className="extract-quantity">
              <b>QTY</b>
              <button
                type="button"
                aria-label={`Decrease ${box.name} quantity`}
                disabled={busy || quantity <= 1}
                onClick={() => setQuantity(quantity - 1)}
              >
                −
              </button>
              <input
                aria-label={`${box.name} quantity`}
                type="number"
                inputMode="numeric"
                min={1}
                max={Math.max(1, maxQuantity)}
                value={quantity}
                disabled={busy || maxQuantity < 1}
                onChange={(event) =>
                  setQuantity(Number(event.target.value))
                }
              />
              <button
                type="button"
                aria-label={`Increase ${box.name} quantity`}
                disabled={
                  busy ||
                  maxQuantity < 1 ||
                  quantity >= maxQuantity
                }
                onClick={() => setQuantity(quantity + 1)}
              >
                +
              </button>
              <button
                type="button"
                className="quantity-max"
                aria-label={`Set ${box.name} quantity to maximum`}
                disabled={busy || maxQuantity < 1}
                onClick={() => setQuantity(maxQuantity)}
              >
                MAX
              </button>
            </div>
            <button
              aria-label={`Open ${quantity} ${box.name} with ${quantity * box.pullCount} pulls for ${totalCost} gems`}
              disabled={
                busy ||
                maxQuantity < 1 ||
                quantity > maxQuantity
              }
              onClick={() => onOpen(option)}
            >
              {busy && extracting === option
                ? "OPENING…"
                : levelLocked ? `LEVEL ${box.minLevel} REQUIRED` : "OPEN"}{" "}
              <span>TOTAL ♦ {totalCost}</span>
            </button>
          </article>
        );
      },
    )}
  </div>
  );
}
