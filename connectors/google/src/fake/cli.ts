import { startFakeGoogle } from "./index.ts";

const fake = await startFakeGoogle();
console.log(`Fake Google: ${fake.url}`);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void fake.close().then(() => process.exit(0));
  });
}
