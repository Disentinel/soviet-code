import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

export interface TweetResult {
  id: string;
  text: string;
}

interface TwitterSection {
  access_token: string;
  refresh_token: string;
  client_id: string;
  client_secret: string;
  bearer_token: string;
}

interface PolitburoToml {
  twitter: TwitterSection;
  [key: string]: unknown;
}

function politburoPath(): string {
  return resolve(process.cwd(), "politburo.toml");
}

function loadTwitterConfig(): { config: PolitburoToml; raw: string } {
  const path = politburoPath();
  const raw = readFileSync(path, "utf-8");
  const config = parseToml(raw) as PolitburoToml;
  if (!config.twitter) throw new Error("politburo.toml: missing [twitter] section");
  return { config, raw };
}

function saveTokens(newAccessToken: string, newRefreshToken: string): void {
  const path = politburoPath();
  let raw = readFileSync(path, "utf-8");

  // Point-replace tokens — avoids re-serializing the whole file
  raw = raw.replace(
    /^(access_token\s*=\s*")([^"]*")/m,
    `$1${newAccessToken}"`
  );
  raw = raw.replace(
    /^(refresh_token\s*=\s*")([^"]*")/m,
    `$1${newRefreshToken}"`
  );
  writeFileSync(path, raw);
}

async function refreshTokens(tw: TwitterSection): Promise<TwitterSection> {
  const creds = Buffer.from(`${tw.client_id}:${tw.client_secret}`).toString("base64");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: tw.refresh_token,
    client_id: tw.client_id,
  });

  const res = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${creds}`,
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Twitter token refresh failed (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as { access_token: string; refresh_token: string };
  saveTokens(data.access_token, data.refresh_token);

  return {
    ...tw,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  };
}

async function sendTweet(text: string, accessToken: string): Promise<TweetResult> {
  const res = await fetch("https://api.x.com/2/tweets", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ text }),
  });

  if (res.status === 401) {
    // Signal to caller that a refresh is needed
    throw Object.assign(new Error("Unauthorized"), { status: 401 });
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Twitter API error (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as { data: { id: string; text: string } };
  return { id: data.data.id, text: data.data.text };
}

export async function postTweet(text: string): Promise<TweetResult> {
  let { config } = loadTwitterConfig();
  let tw = config.twitter;

  try {
    return await sendTweet(text, tw.access_token);
  } catch (err: unknown) {
    if ((err as { status?: number }).status !== 401) throw err;

    // 401 → refresh and retry once
    tw = await refreshTokens(tw);
    return await sendTweet(text, tw.access_token);
  }
}
