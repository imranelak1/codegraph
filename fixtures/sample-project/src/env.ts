export function readEnv(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}
