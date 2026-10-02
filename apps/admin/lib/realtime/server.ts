import * as Ably from "ably";

export function isRealtimeConfigured(): boolean {
  return Boolean(process.env.ABLY_API_KEY?.trim());
}

let restClient: Ably.Rest | null = null;

function getRestClient(): Ably.Rest {
  const key = process.env.ABLY_API_KEY?.trim();
  if (!key) throw new Error("ABLY_API_KEY is not configured");
  if (!restClient) {
    restClient = new Ably.Rest({ key });
  }
  return restClient;
}

export async function publishToChannel(
  channel: string,
  event: string,
  data: unknown,
): Promise<boolean> {
  if (!isRealtimeConfigured()) return false;

  try {
    await getRestClient().channels.get(channel).publish(event, data);
    return true;
  } catch (error) {
    console.error("admin realtime: publish failed", error);
    return false;
  }
}
