import { discoverProfiles, writeList } from "./my-list-demo.mjs";

const profiles = await discoverProfiles();
console.log("Clearing PolTV My Lists...\n");

for (const profile of profiles) {
  await writeList(profile.id, []);
  console.log(`${profile.name}: cleared`);
}

console.log("\nAll My Lists cleared. Profiles, Around PolTV activity, and other application state were preserved.");
