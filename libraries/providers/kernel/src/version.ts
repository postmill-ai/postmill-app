import { compare as compareSemver, parse as parseSemver, valid as validSemver } from 'semver';

function stripV(version: string): string {
  return version.startsWith('v') ? version.slice(1) : version;
}

/**
 * Pad shorthand versions to valid semver for comparison and prerelease detection.
 * Examples: '2' -> '2.0.0', '2.1' -> '2.1.0', '2-beta' -> '2.0.0-beta'.
 * Returns null when the version cannot be coerced to semver.
 */
export function toSemver(version: string): string | null {
  const stripped = stripV(version);
  if (validSemver(stripped)) return stripped;
  const majorOnly = /^(\d+)(-[a-zA-Z0-9.-]+)?$/.exec(stripped);
  if (majorOnly) {
    const [, major, suffix] = majorOnly;
    return validSemver(`${major}.0.0${suffix || ''}`);
  }
  const majorMinor = /^(\d+)\.(\d+)(-[a-zA-Z0-9.-]+)?$/.exec(stripped);
  if (majorMinor) {
    const [, major, minor, suffix] = majorMinor;
    return validSemver(`${major}.${minor}.0${suffix || ''}`);
  }
  return null;
}

export function compareVersions(a: string, b: string): number {
  const semverA = toSemver(a);
  const semverB = toSemver(b);
  if (semverA && semverB) {
    return compareSemver(semverA, semverB);
  }
  if (semverA) return 1;
  if (semverB) return -1;
  return a.localeCompare(b);
}

export function versionIsPrerelease(version: string): boolean {
  const semver = toSemver(version);
  if (!semver) return false;
  return parseSemver(semver)!.prerelease.length > 0;
}
