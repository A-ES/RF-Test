"use client";

import { useEffect, useRef, useState } from "react";
import { orgChannel, type RealtimeScope } from "@/app/lib/realtime/channels";

/**
 * Subscribes to the organization-scoped realtime channel.
 *
 * Reuses ONE global Ably connection across the entire client app,
 * rather than opening multiple WebSocket connections.
 */

export interface RealtimeEvent {
  name: string;
  data: unknown;
}

import type * as AblyType from "ably";

interface SharedClient {
  realtime: AblyType.Realtime;
  refCount: number;
  currentChannel: string | null;
  organizationId: string | null;
}
let sharedClient: SharedClient | null = null;
let sharedClientPromise: Promise<AblyType.Realtime | null> | null = null;
let activeRequestedChannel: string | null = null;

async function getSharedRealtime(
  channelName?: string,
  organizationId?: string | null,
): Promise<AblyType.Realtime | null> {
  if (channelName) {
    activeRequestedChannel = channelName;
  }

  // If organization changed, close existing client and reset to maintain strict isolation
  if (
    sharedClient &&
    organizationId &&
    sharedClient.organizationId &&
    sharedClient.organizationId !== organizationId
  ) {
    try {
      sharedClient.realtime.close();
    } catch {}
    sharedClient = null;
  }

  if (sharedClient) {
    if (closeTimeout) {
      clearTimeout(closeTimeout);
      closeTimeout = null;
    }
    sharedClient.refCount++;
    if (channelName) {
      sharedClient.currentChannel = channelName;
    }
    return sharedClient.realtime;
  }
  if (sharedClientPromise) {
    return sharedClientPromise;
  }

  sharedClientPromise = (async () => {
    try {
      const Ably = await import("ably");
      // Use authCallback so every token request includes the channel parameter
      const realtime = new Ably.Realtime({
        authCallback: async (tokenParams, callback) => {
          try {
            const targetChannel = activeRequestedChannel || "";
            const query = targetChannel ? `?channel=${encodeURIComponent(targetChannel)}` : "";
            const res = await fetch(`/api/realtime/auth${query}`, { method: "GET" });
            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              const msg = err.error || `HTTP ${res.status}`;
              return (callback as any)(new Error(msg), null);
            }
            const tokenRequest = await res.json();
            (callback as any)(null, tokenRequest);
          } catch (err: any) {
            (callback as any)(err, null);
          }
        },
      });
      sharedClient = {
        realtime,
        refCount: 1,
        currentChannel: channelName ?? null,
        organizationId: organizationId ?? null,
      };
      return realtime;
    } finally {
      sharedClientPromise = null;
    }
  })();

  return sharedClientPromise;
}

let closeTimeout: NodeJS.Timeout | null = null;

function releaseSharedRealtime() {
  if (sharedClient) {
    sharedClient.refCount--;
    if (sharedClient.refCount <= 0) {
      if (closeTimeout) {
        clearTimeout(closeTimeout);
      }
      // Delay closing by ~1s so React StrictMode's mount/unmount/remount does not close the shared connection
      closeTimeout = setTimeout(() => {
        if (sharedClient && sharedClient.refCount <= 0) {
          const clientToClose = sharedClient.realtime;
          sharedClient = null;
          try {
            if (clientToClose && typeof clientToClose.close === "function") {
              clientToClose.close();
            }
          } catch {
            // Silently swallow already-closed or in-flight close errors
          }
        }
      }, 1000);
    }
  }
}

export function useOrgRealtime(
  organizationId: string | null | undefined,
  scope: RealtimeScope,
  onEvent: (event: RealtimeEvent) => void,
): { live: boolean } {
  const [live, setLive] = useState(false);
  const handlerRef = useRef(onEvent);

  useEffect(() => {
    handlerRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!organizationId) return;

    const channelName = orgChannel(organizationId, scope);
    let closed = false;
    let unsubscriber: (() => void) | null = null;

    async function connect() {
      try {
        // Fast probe to verify realtime auth endpoint is reachable
        const authProbe = `/api/realtime/auth?channel=${encodeURIComponent(channelName)}`;
        const probe = await fetch(authProbe, { method: "GET" });
        if (!probe.ok || closed) return;

        const realtime = await getSharedRealtime(channelName, organizationId);
        if (closed || !realtime) return;

        const channel = realtime.channels.get(channelName);
        const listener = (message: { name?: string; data?: unknown }) => {
          handlerRef.current({ name: message.name ?? "", data: message.data });
        };

        await channel.subscribe(listener);
        unsubscriber = () => {
          try {
            channel.unsubscribe(listener);
          } catch {}
        };

        if (!closed) setLive(true);
      } catch (error) {
        console.warn("realtime: subscription unavailable, falling back", error);
        if (!closed) setLive(false);
      }
    }

    void connect();

    return () => {
      closed = true;
      if (unsubscriber) unsubscriber();
      releaseSharedRealtime();
    };
  }, [organizationId, scope]);

  return { live };
}
