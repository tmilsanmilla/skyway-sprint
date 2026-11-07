// Presentation only: unknown failures stay red; named progress/success notices
// remain neutral. This does not decide whether an authentication action succeeds.
const statusNotices = new Set([
  "Account created. Loading your runner profile…",
  "Signed in. Loading your runner profile…",
  "Opening Google sign-in…",
  "Opening Pixel Pulse…",
  "Checking this browser profile…",
  "Sending…",
  "Check your email.",
  "Verified.",
  "Password updated successfully.",
  "Password reset.",
  "Username saved. You can change it again in 30 days.",
  "Sign-in cancelled. Your account and progress are unchanged.",
  "Your account connection was already saved. Sign-in has been cancelled; your account and progress are unchanged.",
]);

export function accountNoticeTone(message: string): "status" | "error" {
  return !message || statusNotices.has(message) ? "status" : "error";
}
