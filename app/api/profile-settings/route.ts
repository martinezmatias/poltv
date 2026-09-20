import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { VIEWER_PROFILES } from "../../../config/profiles";

type ProfileSettings = {
  around_poltv_private: boolean;
};

const SETTINGS_DIR = path.join(process.cwd(), "data", "profile-settings");

function validProfile(profileId: string) {
  return VIEWER_PROFILES.some((profile) => profile.id === profileId);
}

function settingsFile(profileId: string) {
  return path.join(SETTINGS_DIR, `${profileId}.json`);
}

async function readSettings(profileId: string): Promise<ProfileSettings> {
  try {
    const value = JSON.parse(await readFile(settingsFile(profileId), "utf8")) as Partial<ProfileSettings>;
    return { around_poltv_private: value.around_poltv_private === true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { around_poltv_private: false };
  }
}

async function writeSettings(profileId: string, settings: ProfileSettings) {
  await mkdir(SETTINGS_DIR, { recursive: true });
  const target = settingsFile(profileId);
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

export async function GET(request: Request) {
  const profileId = new URL(request.url).searchParams.get("profileId") ?? "";
  if (!validProfile(profileId)) return NextResponse.json({ error: "Unknown profile." }, { status: 400 });
  return NextResponse.json(await readSettings(profileId));
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { profileId?: string; around_poltv_private?: boolean };
    if (!body.profileId || !validProfile(body.profileId)) return NextResponse.json({ error: "Unknown profile." }, { status: 400 });
    if (typeof body.around_poltv_private !== "boolean") return NextResponse.json({ error: "Invalid privacy setting." }, { status: 400 });
    const settings = { around_poltv_private: body.around_poltv_private };
    await writeSettings(body.profileId, settings);
    return NextResponse.json(settings);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save profile settings." }, { status: 500 });
  }
}
