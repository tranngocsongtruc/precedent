// Load .env for standalone tsx scripts (Next.js loads it automatically; tsx
// does not). Node 22 ships process.loadEnvFile.
export function loadEnv(): void {
  try {
    (process as NodeJS.Process & { loadEnvFile?: (p: string) => void }).loadEnvFile?.(".env");
  } catch {
    console.warn("[loadEnv] no .env file found; relying on process env.");
  }
}
