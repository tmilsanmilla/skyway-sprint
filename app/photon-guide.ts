export const PHOTON_GUIDE = {
  introduction: "Dodge obstacles across four lanes and use your Lightsaber to turn them into points.",
  steps: [
    { title: "Move", text: "Use A/D or the arrow keys. On a phone, swipe or tap a lane to move one lane toward it." },
    { title: "Use your Lightsaber", text: "Press Q or tap LIGHTSABER just before an obstacle reaches you. Each swing blocks one obstacle, preventing damage and earning a point. A missed swing costs half a heart. Misses and unblocked needles wear down the saber; cars do not. Guard windows shorten as the run speeds up. Characters and weapons can change these rules." },
    { title: "Earn Photons", text: "Photons are this mode’s currency. Your points turn into Photons at the end of the run. Earn at least 5 points; 8 points earn 10 Photons. Jolt Shockwave needs at least 16 points and uses its own reward curve." },
  ],
  needle: "Watch for pink needles: they briefly make lane changes risky.",
} as const;
