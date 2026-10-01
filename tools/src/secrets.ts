/**
 * The API key comes only from the environment or the local .env (which git
 * ignores). It is never logged: everything this tool
 * prints goes through `redact`, and errors never include request headers.
 */

const NAMES = ['BALLDONTLIE_API_KEY'] as const;
export type SecretName = (typeof NAMES)[number];

/** Load the repo's .env (a real environment variable wins if both are set). */
export function loadLocalEnv(path: string): void {
  try {
    process.loadEnvFile(path);
  } catch {
    // No .env file: rely on the real environment.
  }
}

export function secret(name: SecretName): string | null {
  const v = process.env[name]?.trim();
  return v ? v : null;
}

/** Replace any secret value that slipped into a message. */
export function redact(text: string): string {
  let out = text;
  for (const name of NAMES) {
    const v = secret(name);
    if (v && v.length >= 6) out = out.split(v).join(`<${name}>`);
  }
  return out;
}

export function log(...parts: unknown[]): void {
  console.log(redact(parts.map(String).join(' ')));
}

export function fail(...parts: unknown[]): never {
  console.error(redact(parts.map(String).join(' ')));
  process.exit(1);
}
