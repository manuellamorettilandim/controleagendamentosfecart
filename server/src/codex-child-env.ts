// Keep credentials and control-plane configuration out of Codex subprocesses.
// The host process may hold Supabase and relay secrets, while the app-server
// only needs a small set of operating-system variables plus its account data.
const INHERITED_ENV_KEYS = [
  "PATH",
  "Path",
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "SystemRoot",
  "SYSTEMROOT",
  "ComSpec",
  "COMSPEC",
  "PATHEXT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "TZ",
  "USER",
  "LOGNAME",
] as const;

export function codexChildEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of INHERITED_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete environment[key];
    else environment[key] = value;
  }
  return environment;
}
