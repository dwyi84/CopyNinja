function pad2(value) {
    return String(value).padStart(2, '0');
}

/** Maccy-style timestamp: MM-dd HH:mm:ss in local time. */
export function formatTimestamp(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime()))
        return '--';
    return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ` +
        `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

export function formatBytes(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes <= 0)
        return '0 B';

    const units = ['B', 'KB', 'MB', 'GB'];
    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const amount = bytes / (1024 ** exponent);
    const rounded = exponent === 0 || amount >= 10 ? Math.round(amount) : amount.toFixed(1);
    return `${rounded} ${units[exponent]}`;
}

/** 1–9 for the first nine rows, 0 for the tenth, null afterwards. */
export function quickSlotLabel(index) {
    if (index >= 0 && index < 9)
        return String(index + 1);
    if (index === 9)
        return '0';
    return null;
}
