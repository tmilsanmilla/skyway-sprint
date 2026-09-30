"use client";

import {
  applyRefreshedTurnConfiguration,
  resolveTurnCredentialExpiresAtMs,
  resolveTurnRefreshDelayMs,
  resolveTurnRefreshRetryDelayMs,
} from "@/lib/realtime-refresh";
import { resolveRealtimeMode } from "./realtime-mode";
import {
  createPeerRateGuardState,
  createPeerSequenceGuardState,
  createPeerSignalQuotaState,
  createPeerMotionGuardState,
  guardPeerRate,
  guardPeerSequence,
  guardPeerSignalKind,
  guardPeerMotion,
  normalizePeerInvalidationDomains,
  PEER_CONTROL_RATE_LIMIT,
  PEER_CONTROL_RATE_WINDOW_MS,
  PEER_CONTROL_VIOLATION_LIMIT,
  PEER_MAX_PENDING_ICE_CANDIDATES,
  PEER_SIGNAL_VIOLATION_LIMIT,
  PeerInvalidationDispatcher,
  resolvePeerSignalingReconnect,
  sanitizePeerIceCandidate,
  type PeerMotionGuardState,
  type PeerRateGuardState,
  type PeerSequenceGuardState,
  type PeerSignalKind,
  type PeerSignalQuotaState,
  type RealtimeDomain,
} from "./realtime-peer-limits";

export type { RealtimeDomain } from "./realtime-peer-limits";

type RealtimeHooks = {
  onInvalidate: (domains: RealtimeDomain[]) => void | Promise<void>;
  onOpponentLane: (laneIndex: number) => void;
  onPeerStatus: (state: "joined" | "reconnecting" | "left") => void;
  onFallback: (message: string) => void;
};

type BootstrapPayload = {
  signalingUrl?: string;
  ticket?: string;
  ticketExpiresAt?: number;
  iceServers?: RTCIceServer[];
  iceServersExpiresAt?: number;
  error?: string;
};

type CompleteBootstrapPayload = BootstrapPayload & {
  signalingUrl: string;
  ticket: string;
  iceServers: RTCIceServer[];
};

type AccessTokenProvider = () => string | null | Promise<string | null>;

type WelcomeMessage = {
  v: 1;
  type: "welcome";
  selfSlot: 1 | 2;
  initiator: boolean;
  peerPresent: boolean;
};

const configuredMode = process.env.NEXT_PUBLIC_1V1_REALTIME_MODE?.trim();
export const realtimeMode = resolveRealtimeMode({
  configuredMode,
  neonDataApiUrl: process.env.NEXT_PUBLIC_NEON_DATA_API_URL,
});

const createClientInstanceId = () => {
  const storedKey = "skyway_realtime_client_instance_v1";
  try {
    const stored = window.sessionStorage.getItem(storedKey);
    if (stored && /^[A-Za-z0-9_-]{8,128}$/.test(stored)) return stored;
    const created = crypto.randomUUID().replaceAll("-", "");
    window.sessionStorage.setItem(storedKey, created);
    return created;
  } catch {
    return crypto.randomUUID().replaceAll("-", "");
  }
};

const signalingWebSocketUrl = (
  base: string,
  matchId: string,
  ticket: string,
) => {
  const url = new URL(base);
  url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
  url.pathname = `/v1/matches/${encodeURIComponent(matchId)}/connect`;
  url.search = new URLSearchParams({ ticket }).toString();
  return url.toString();
};

export class CloudflareVersusRealtime {
  private generation = 0;
  private socket: WebSocket | null = null;
  private peer: RTCPeerConnection | null = null;
  private motionChannel: RTCDataChannel | null = null;
  private controlChannel: RTCDataChannel | null = null;
  private pingTimer: number | null = null;
  private signalingReconnectTimer: number | null = null;
  private iceRefreshTimer: number | null = null;
  private iceRefreshFailures = 0;
  private iceServersExpiresAtMs = 0;
  private iceRefreshFallbackReported = false;
  private invalidationDispatcher: PeerInvalidationDispatcher | null = null;
  private controlSequenceGuard: PeerSequenceGuardState =
    createPeerSequenceGuardState();
  private controlRateGuard: PeerRateGuardState = createPeerRateGuardState();
  private controlViolations = 0;
  private motionGuard: PeerMotionGuardState = createPeerMotionGuardState();
  private signalQuota: PeerSignalQuotaState = createPeerSignalQuotaState();
  private signalViolations = 0;
  private signalingQuarantined = false;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private matchId = "";
  private accessTokenProvider: AccessTokenProvider | null = null;
  private hooks: RealtimeHooks | null = null;
  private iceServers: RTCIceServer[] = [];
  private initiator = false;
  private negotiationId = "";
  private peerGeneration = 0;
  private localOfferInFlight = false;
  private remoteOfferInFlight = false;
  private remoteAnswerInFlight = false;
  private sequence = 0;
  private motionSequence = 0;
  private controlSequence = 0;

  async connect(
    matchId: string,
    accessToken: string | AccessTokenProvider,
    hooks: RealtimeHooks,
  ) {
    this.close(false);
    this.matchId = matchId;
    this.accessTokenProvider =
      typeof accessToken === "function" ? accessToken : () => accessToken;
    this.hooks = hooks;
    const generation = this.generation;
    this.invalidationDispatcher = new PeerInvalidationDispatcher(
      async (domains) => {
        if (generation !== this.generation) return;
        await this.hooks?.onInvalidate(domains);
      },
    );
    await this.openSignaling(generation, 0);
  }

  private async requestBootstrap(generation: number) {
    const accessToken = (await this.accessTokenProvider?.())?.trim();
    if (
      generation !== this.generation ||
      !this.matchId ||
      !accessToken
    )
      throw new Error("Sign in required.");
    const response = await fetch("/api/realtime/bootstrap", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        matchId: this.matchId,
        clientInstanceId: createClientInstanceId(),
      }),
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => null)) as
      | BootstrapPayload
      | null;
    if (
      !response.ok ||
      !payload?.signalingUrl ||
      !payload.ticket ||
      !Array.isArray(payload.iceServers) ||
      payload.iceServers.length === 0
    )
      throw new Error(payload?.error || "Realtime relay is unavailable.");
    return payload as CompleteBootstrapPayload;
  }

  private clearIceRefreshTimer() {
    if (this.iceRefreshTimer !== null)
      window.clearTimeout(this.iceRefreshTimer);
    this.iceRefreshTimer = null;
  }

  private scheduleIceRefresh(generation: number, delayMs?: number) {
    this.clearIceRefreshTimer();
    const delay =
      delayMs ??
      resolveTurnRefreshDelayMs(this.iceServersExpiresAtMs);
    this.iceRefreshTimer = window.setTimeout(() => {
      this.iceRefreshTimer = null;
      void this.refreshIceServers(generation);
    }, delay);
  }

  private installIceServers(
    payload: BootstrapPayload,
    generation: number,
    applyToPeer: boolean,
  ) {
    if (
      generation !== this.generation ||
      !Array.isArray(payload.iceServers) ||
      payload.iceServers.length === 0
    )
      return;
    const nextIceServers = payload.iceServers;
    if (applyToPeer)
      applyRefreshedTurnConfiguration(this.peer, nextIceServers);
    this.iceServers = nextIceServers;
    this.iceServersExpiresAtMs = resolveTurnCredentialExpiresAtMs(
      payload.iceServersExpiresAt,
    );
    this.iceRefreshFailures = 0;
    this.iceRefreshFallbackReported = false;
    this.scheduleIceRefresh(generation);
  }

  private async refreshIceServers(generation: number) {
    if (
      generation !== this.generation ||
      !this.matchId ||
      !this.accessTokenProvider ||
      this.signalingQuarantined
    )
      return;
    try {
      const payload = await this.requestBootstrap(generation);
      if (generation !== this.generation) return;
      this.installIceServers(payload, generation, true);
    } catch {
      if (generation !== this.generation) return;
      this.iceRefreshFailures += 1;
      if (
        Date.now() >= this.iceServersExpiresAtMs &&
        !this.iceRefreshFallbackReported
      ) {
        this.iceRefreshFallbackReported = true;
        this.hooks?.onFallback(
          "Realtime relay credentials could not be refreshed. Safe match syncing is still active.",
        );
      }
      this.scheduleIceRefresh(
        generation,
        resolveTurnRefreshRetryDelayMs(this.iceRefreshFailures),
      );
    }
  }

  private async openSignaling(generation: number, attempt: number) {
    if (
      generation !== this.generation ||
      !this.matchId ||
      !this.accessTokenProvider ||
      this.signalingQuarantined
    )
      return;
    if (
      this.socket?.readyState === WebSocket.OPEN ||
      this.socket?.readyState === WebSocket.CONNECTING
    )
      return;
    try {
      const payload = await this.requestBootstrap(generation);
      if (generation !== this.generation) return;
      this.installIceServers(payload, generation, false);
      const socket = new WebSocket(
        signalingWebSocketUrl(
          payload.signalingUrl,
          this.matchId,
          payload.ticket,
        ),
      );
      this.socket = socket;
      let opened = false;
      socket.addEventListener("message", (event) => {
        if (
          generation !== this.generation ||
          this.socket !== socket ||
          typeof event.data !== "string"
        )
          return;
        void this.handleSignalMessage(event.data).catch(() => {
          this.noteSignalViolation(
            "Peer negotiation failed. Safe match syncing is still active.",
          );
        });
      });
      socket.addEventListener("open", () => {
        if (generation !== this.generation || this.socket !== socket) return;
        opened = true;
        this.pingTimer = window.setInterval(() => {
          this.sendSignal({
            v: 1,
            type: "ping",
            seq: ++this.sequence,
            clientTimeMs: Date.now(),
          });
        }, 15_000);
      });
      socket.addEventListener("close", (event) => {
        if (generation !== this.generation || this.socket !== socket) return;
        this.socket = null;
        if (this.pingTimer) window.clearInterval(this.pingTimer);
        this.pingTimer = null;
        if (this.signalingQuarantined) return;
        const reconnect = resolvePeerSignalingReconnect({
          closeCode: event.code,
          opened,
          peerConnected: this.peer?.connectionState === "connected",
          attempt,
        });
        if (reconnect)
          this.scheduleSignalingReconnect(
            generation,
            reconnect.attempt,
            reconnect.delayMs,
          );
        else if (this.peer?.connectionState !== "connected")
          this.hooks?.onFallback(
            "Realtime relay interrupted. Safe match syncing is still active.",
          );
      });
      socket.addEventListener("error", () => {
        if (generation === this.generation)
          this.hooks?.onFallback(
            "Realtime relay interrupted. Safe match syncing is still active.",
          );
      });
    } catch (error) {
      if (generation !== this.generation) return;
      if (attempt < 3) {
        this.scheduleSignalingReconnect(
          generation,
          attempt + 1,
          1_000 * 2 ** attempt,
        );
        return;
      }
      this.hooks?.onFallback(
        error instanceof Error
          ? error.message
          : "Realtime relay is unavailable. Safe match syncing is still active.",
      );
    }
  }

  private scheduleSignalingReconnect(
    generation: number,
    attempt: number,
    delayMs: number,
  ) {
    if (
      generation !== this.generation ||
      this.signalingQuarantined ||
      this.signalingReconnectTimer !== null
    )
      return;
    this.signalingReconnectTimer = window.setTimeout(() => {
      this.signalingReconnectTimer = null;
      void this.openSignaling(generation, attempt);
    }, delayMs);
  }

  private sendSignal(message: Record<string, unknown>) {
    if (this.socket?.readyState === WebSocket.OPEN)
      this.socket.send(JSON.stringify(message));
  }

  private quarantineSignaling(message: string) {
    if (this.signalingQuarantined) return;
    this.signalingQuarantined = true;
    if (this.signalingReconnectTimer !== null)
      window.clearTimeout(this.signalingReconnectTimer);
    this.signalingReconnectTimer = null;
    this.socket?.close(4008, "Peer signaling rejected");
    this.hooks?.onFallback(message);
  }

  private noteSignalViolation(message: string) {
    this.signalViolations += 1;
    if (this.signalViolations >= PEER_SIGNAL_VIOLATION_LIMIT)
      this.quarantineSignaling(message);
  }

  private consumeSignalQuota(kind: PeerSignalKind) {
    const result = guardPeerSignalKind(this.signalQuota, kind, Date.now());
    this.signalQuota = result.state;
    if (!result.accepted)
      this.quarantineSignaling(
        "Peer signaling rate exceeded. Safe match syncing is still active.",
      );
    return result.accepted;
  }

  private closeAbusiveControlChannel(channel: RTCDataChannel) {
    if (this.controlChannel !== channel) return;
    channel.close();
    this.controlChannel = null;
    this.invalidationDispatcher?.close();
    this.invalidationDispatcher = null;
    this.hooks?.onFallback(
      "Peer update traffic was rejected. Safe match syncing is still active.",
    );
  }

  private noteControlViolation(channel: RTCDataChannel) {
    this.controlViolations += 1;
    if (this.controlViolations >= PEER_CONTROL_VIOLATION_LIMIT)
      this.closeAbusiveControlChannel(channel);
  }

  private createPeer(negotiationId: string) {
    this.motionChannel?.close();
    this.controlChannel?.close();
    this.peer?.close();
    this.motionChannel = null;
    this.controlChannel = null;
    this.pendingCandidates = [];
    this.negotiationId = negotiationId;
    const peerGeneration = ++this.peerGeneration;
    // Motion sequencing is scoped to the unordered DataChannel, not the
    // longer-lived signaling session. A fresh negotiation must restart both
    // ends at the same baseline or a legitimate post-reconnect sequence can
    // look like an out-of-range burst after a long match.
    this.motionSequence = 0;
    this.controlSequence = 0;
    this.motionGuard = createPeerMotionGuardState();
    this.controlSequenceGuard = createPeerSequenceGuardState();
    this.controlRateGuard = createPeerRateGuardState();
    this.controlViolations = 0;
    this.invalidationDispatcher?.close();
    const connectionGeneration = this.generation;
    this.invalidationDispatcher = new PeerInvalidationDispatcher(
      async (domains) => {
        if (
          connectionGeneration !== this.generation ||
          peerGeneration !== this.peerGeneration
        )
          return;
        await this.hooks?.onInvalidate(domains);
      },
    );
    const peer = new RTCPeerConnection({
      iceServers: this.iceServers,
      iceTransportPolicy: "relay",
    });
    this.peer = peer;
    peer.addEventListener("icecandidate", (event) => {
      if (
        !event.candidate ||
        this.peer !== peer ||
        peerGeneration !== this.peerGeneration
      )
        return;
      this.sendSignal({
        v: 1,
        type: "signal",
        kind: "ice",
        negotiationId,
        candidate: event.candidate.toJSON(),
      });
    });
    peer.addEventListener("datachannel", (event) =>
      this.installDataChannel(event.channel, peerGeneration),
    );
    peer.addEventListener("connectionstatechange", () => {
      if (peer.connectionState === "failed")
        this.hooks?.onFallback(
          "Peer relay interrupted. Safe match syncing is still active.",
        );
    });
    return peer;
  }

  private installDataChannel(
    channel: RTCDataChannel,
    peerGeneration: number,
  ) {
    if (peerGeneration !== this.peerGeneration) {
      channel.close();
      return;
    }
    if (channel.label === "motion") {
      if (this.motionChannel && this.motionChannel !== channel) {
        channel.close();
        return;
      }
      this.motionChannel = channel;
    } else if (channel.label === "control") {
      if (this.controlChannel && this.controlChannel !== channel) {
        channel.close();
        return;
      }
      this.controlChannel = channel;
    } else {
      channel.close();
      return;
    }
    channel.addEventListener("message", (event) => {
      if (
        peerGeneration !== this.peerGeneration ||
        (channel.label === "motion"
          ? this.motionChannel !== channel
          : this.controlChannel !== channel)
      )
        return;
      if (channel.label === "control") {
        const rate = guardPeerRate(
          this.controlRateGuard,
          Date.now(),
          PEER_CONTROL_RATE_LIMIT,
          PEER_CONTROL_RATE_WINDOW_MS,
        );
        this.controlRateGuard = rate.state;
        if (!rate.accepted) {
          this.closeAbusiveControlChannel(channel);
          return;
        }
      }
      if (typeof event.data !== "string" || event.data.length > 16_384) return;
      try {
        const message = JSON.parse(event.data) as Record<string, unknown>;
        if (message.v !== 1 || message.matchId !== this.matchId) return;
        if (channel.label === "motion" && message.type === "motion") {
          const guarded = guardPeerMotion(
            this.motionGuard,
            { laneIndex: message.laneIndex, sequence: message.seq },
            Date.now(),
          );
          this.motionGuard = guarded.state;
          if (guarded.accepted)
            this.hooks?.onOpponentLane(message.laneIndex as number);
          return;
        }
        if (channel.label === "control" && message.type === "invalidate") {
          const sequence = guardPeerSequence(
            this.controlSequenceGuard,
            message.seq,
          );
          if (!sequence.accepted) {
            this.noteControlViolation(channel);
            return;
          }
          this.controlSequenceGuard = sequence.state;
          const domains = normalizePeerInvalidationDomains(message.domains);
          if (domains.length === 0) {
            this.noteControlViolation(channel);
            return;
          }
          this.invalidationDispatcher?.enqueue(domains);
        }
      } catch {
        // Ignore peer messages that do not match the tiny protocol above.
      }
    });
  }

  private async beginOffer() {
    if (
      !this.initiator ||
      !this.socket ||
      this.socket.readyState !== WebSocket.OPEN ||
      this.localOfferInFlight ||
      this.signalingQuarantined
    )
      return;
    this.localOfferInFlight = true;
    const generation = this.generation;
    const negotiationId = crypto.randomUUID().replaceAll("-", "");
    let peerGeneration = this.peerGeneration;
    try {
      this.remoteAnswerInFlight = false;
      const peer = this.createPeer(negotiationId);
      peerGeneration = this.peerGeneration;
      this.motionChannel = peer.createDataChannel("motion", {
        ordered: false,
        maxRetransmits: 0,
      });
      this.controlChannel = peer.createDataChannel("control", { ordered: true });
      this.installDataChannel(this.motionChannel, peerGeneration);
      this.installDataChannel(this.controlChannel, peerGeneration);
      const offer = await peer.createOffer();
      if (
        generation !== this.generation ||
        peerGeneration !== this.peerGeneration ||
        this.peer !== peer
      )
        return;
      await peer.setLocalDescription(offer);
      if (
        generation !== this.generation ||
        peerGeneration !== this.peerGeneration ||
        this.peer !== peer
      )
        return;
      this.sendSignal({
        v: 1,
        type: "signal",
        kind: "offer",
        negotiationId,
        sdp: offer.sdp,
      });
    } finally {
      if (generation === this.generation)
        this.localOfferInFlight = false;
    }
  }

  private async flushCandidates(
    peer: RTCPeerConnection,
    negotiationId: string,
    peerGeneration: number,
  ) {
    if (
      this.peer !== peer ||
      this.negotiationId !== negotiationId ||
      this.peerGeneration !== peerGeneration ||
      !peer.remoteDescription
    )
      return;
    const candidates = this.pendingCandidates.splice(0);
    for (const candidate of candidates) {
      if (
        this.peer !== peer ||
        this.negotiationId !== negotiationId ||
        this.peerGeneration !== peerGeneration
      )
        return;
      try {
        await peer.addIceCandidate(candidate);
      } catch {
        this.noteSignalViolation(
          "Peer connection data was rejected. Safe match syncing is still active.",
        );
      }
    }
  }

  private async handleSignalMessage(raw: string) {
    if (raw.length > 65_536) return;
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    if (message.v !== 1 || typeof message.type !== "string") return;
    if (message.type === "welcome") {
      const welcome = message as unknown as WelcomeMessage;
      this.initiator = welcome.initiator;
      if (welcome.initiator && welcome.peerPresent) await this.beginOffer();
      return;
    }
    if (message.type === "peer-status") {
      const state = String(message.state);
      if (state === "joined" || state === "reconnecting" || state === "left")
        this.hooks?.onPeerStatus(state);
      if (state === "joined" && this.initiator) await this.beginOffer();
      return;
    }
    if (message.type !== "signal") return;
    const negotiationId = String(message.negotiationId ?? "");
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(negotiationId)) return;
    if (message.kind === "offer") {
      if (!this.consumeSignalQuota("offer")) return;
      if (
        this.initiator ||
        this.remoteOfferInFlight ||
        negotiationId === this.negotiationId ||
        typeof message.sdp !== "string" ||
        message.sdp.length === 0 ||
        message.sdp.length > 60_000
      ) {
        this.noteSignalViolation(
          "Repeated peer negotiation was rejected. Safe match syncing is still active.",
        );
        return;
      }
      this.remoteOfferInFlight = true;
      const generation = this.generation;
      let peerGeneration = this.peerGeneration;
      try {
        this.remoteAnswerInFlight = false;
        const peer = this.createPeer(negotiationId);
        peerGeneration = this.peerGeneration;
        await peer.setRemoteDescription({ type: "offer", sdp: message.sdp });
        if (
          generation !== this.generation ||
          peerGeneration !== this.peerGeneration ||
          this.peer !== peer ||
          this.negotiationId !== negotiationId
        )
          return;
        await this.flushCandidates(peer, negotiationId, peerGeneration);
        const answer = await peer.createAnswer();
        if (
          generation !== this.generation ||
          peerGeneration !== this.peerGeneration ||
          this.peer !== peer
        )
          return;
        await peer.setLocalDescription(answer);
        if (
          generation !== this.generation ||
          peerGeneration !== this.peerGeneration ||
          this.peer !== peer
        )
          return;
        this.sendSignal({
          v: 1,
          type: "signal",
          kind: "answer",
          negotiationId,
          sdp: answer.sdp,
        });
      } finally {
        if (generation === this.generation)
          this.remoteOfferInFlight = false;
      }
      return;
    }
    if (message.kind === "answer") {
      if (!this.consumeSignalQuota("answer")) return;
      const peer = this.peer;
      const peerGeneration = this.peerGeneration;
      if (
        !this.initiator ||
        this.remoteAnswerInFlight ||
        !peer ||
        negotiationId !== this.negotiationId ||
        peer.signalingState !== "have-local-offer" ||
        typeof message.sdp !== "string" ||
        message.sdp.length === 0 ||
        message.sdp.length > 60_000
      ) {
        this.noteSignalViolation(
          "Unexpected peer answer was rejected. Safe match syncing is still active.",
        );
        return;
      }
      this.remoteAnswerInFlight = true;
      const generation = this.generation;
      try {
        await peer.setRemoteDescription({ type: "answer", sdp: message.sdp });
        if (
          generation !== this.generation ||
          peerGeneration !== this.peerGeneration ||
          this.peer !== peer ||
          this.negotiationId !== negotiationId
        )
          return;
        await this.flushCandidates(peer, negotiationId, peerGeneration);
      } finally {
        if (
          generation === this.generation &&
          peerGeneration === this.peerGeneration
        )
          this.remoteAnswerInFlight = false;
      }
      return;
    }
    if (message.kind === "ice") {
      if (!this.consumeSignalQuota("ice")) return;
      const peer = this.peer;
      if (!peer || negotiationId !== this.negotiationId) return;
      const candidate = sanitizePeerIceCandidate(message.candidate);
      if (!candidate) {
        this.noteSignalViolation(
          "Invalid peer connection data was rejected. Safe match syncing is still active.",
        );
        return;
      }
      const peerGeneration = this.peerGeneration;
      if (!peer.remoteDescription) {
        if (
          this.pendingCandidates.length >=
          PEER_MAX_PENDING_ICE_CANDIDATES
        ) {
          this.quarantineSignaling(
            "Peer connection data exceeded safe limits. Safe match syncing is still active.",
          );
          return;
        }
        this.pendingCandidates.push(candidate);
        return;
      }
      try {
        await peer.addIceCandidate(candidate);
      } catch {
        if (
          peerGeneration === this.peerGeneration &&
          this.peer === peer &&
          this.negotiationId === negotiationId
        )
          this.noteSignalViolation(
            "Invalid peer connection data was rejected. Safe match syncing is still active.",
          );
      }
    }
  }

  sendMotion(laneIndex: number) {
    if (this.motionChannel?.readyState !== "open") return;
    this.motionChannel.send(
      JSON.stringify({
        v: 1,
        type: "motion",
        matchId: this.matchId,
        seq: ++this.motionSequence,
        sentAtMs: Date.now(),
        laneIndex,
      }),
    );
  }

  sendInvalidate(domains: RealtimeDomain[], reason: string) {
    if (this.controlChannel?.readyState !== "open") return;
    this.controlChannel.send(
      JSON.stringify({
        v: 1,
        type: "invalidate",
        matchId: this.matchId,
        seq: ++this.controlSequence,
        sentAtMs: Date.now(),
        domains,
        reason,
      }),
    );
  }

  close(sendLeave = true) {
    this.generation += 1;
    if (sendLeave)
      this.sendSignal({ v: 1, type: "leave", reason: "home" });
    if (this.pingTimer) window.clearInterval(this.pingTimer);
    this.pingTimer = null;
    if (this.signalingReconnectTimer !== null)
      window.clearTimeout(this.signalingReconnectTimer);
    this.signalingReconnectTimer = null;
    this.clearIceRefreshTimer();
    this.invalidationDispatcher?.close();
    this.invalidationDispatcher = null;
    this.peerGeneration += 1;
    this.controlSequence = 0;
    this.controlSequenceGuard = createPeerSequenceGuardState();
    this.controlRateGuard = createPeerRateGuardState();
    this.controlViolations = 0;
    this.motionSequence = 0;
    this.motionGuard = createPeerMotionGuardState();
    this.signalQuota = createPeerSignalQuotaState();
    this.signalViolations = 0;
    this.signalingQuarantined = false;
    this.localOfferInFlight = false;
    this.remoteOfferInFlight = false;
    this.remoteAnswerInFlight = false;
    this.sequence = 0;
    this.negotiationId = "";
    this.initiator = false;
    this.pendingCandidates = [];
    this.motionChannel?.close();
    this.controlChannel?.close();
    this.peer?.close();
    this.socket?.close();
    this.motionChannel = null;
    this.controlChannel = null;
    this.peer = null;
    this.socket = null;
    this.matchId = "";
    this.accessTokenProvider = null;
    this.iceServers = [];
    this.iceServersExpiresAtMs = 0;
    this.iceRefreshFailures = 0;
    this.iceRefreshFallbackReported = false;
    this.hooks = null;
  }
}
