export const LINUX_FALLBACK_VERSION = '0.4.1';

export function normalizeVersion(version) {
    return String(version ?? '').trim().replace(/^[vV]/, '');
}

export function isNewerVersion(remote, current) {
    const parse = value => {
        const cleaned = normalizeVersion(value);
        if (!cleaned)
            return [];
        return cleaned.split('.').map(n => parseInt(n, 10) || 0);
    };

    const r = parse(remote);
    const c = parse(current);
    if (r.length === 0)
        return false;

    const len = Math.max(r.length, c.length, 3);
    for (let i = 0; i < len; i++) {
        const rv = r[i] ?? 0;
        const cv = c[i] ?? 0;
        if (rv > cv)
            return true;
        if (rv < cv)
            return false;
    }
    return false;
}

/**
 * Extracts a numeric version only from Linux/Ubuntu-specific release tags
 * (`linux-v0.4.2`, `ubuntu-0.5.0`), so macOS `v*` tags never trigger Ubuntu updates.
 */
export function parseLinuxTagVersion(tag) {
    const match = String(tag ?? '').trim().match(/^(?:linux|ubuntu)-v?(\d+(?:\.\d+)*)$/i);
    return match ? match[1] : null;
}

export function parseMetadataVersion(data) {
    if (!data || typeof data !== 'object')
        return null;
    const version = normalizeVersion(data['version-name']);
    return /^\d+(?:\.\d+)*$/.test(version) ? version : null;
}

export function pickLatestLinuxRelease(releases) {
    if (!Array.isArray(releases))
        return null;

    let best = null;
    for (const entry of releases) {
        if (!entry || entry.draft || entry.prerelease)
            continue;
        const version = parseLinuxTagVersion(entry.tag_name);
        if (!version)
            continue;
        if (!best || isNewerVersion(version, best.version)) {
            best = {
                version,
                ref: String(entry.tag_name).trim(),
                htmlUrl: String(entry.html_url || ''),
            };
        }
    }
    return best;
}
