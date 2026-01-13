#!/usr/bin/env node
import { getDoctorHealth } from "../src/doctorHealth.js";

async function main() {
  const details = await getDoctorHealth();
  console.log(JSON.stringify(details, null, 2));
  if (details.actionItems?.length) {
    console.log("\nAction items:");
    for (const item of details.actionItems) {
      console.log(`- ${item}`);
    }
  }
  if (details.resolved) {
    console.log("\nResolved config:");
    for (const [key, value] of Object.entries(details.resolved)) {
      console.log(`${key}: ${value ?? "unset"}`);
    }
  }
}

main().catch((err) => {
  console.error("Doctor failed:", err?.message ?? err);
  process.exit(1);
});
