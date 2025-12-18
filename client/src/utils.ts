export type UnknownRecord = Record<string, unknown>;

// Utility to convert camelCase to Title Case
export const toTitleCase = (str: string): string => {
    return str
        .replace(/([A-Z])/g, ' $1') // Add space before capital letters
        .replace(/^./, (match) => match.toUpperCase()) // Capitalize first letter
        .trim();
};

export const asRecord = (value: unknown): UnknownRecord => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as UnknownRecord;
    }

    return {};
};

export const asString = (value: unknown): string => {
    return typeof value === 'string' ? value : '';
};

export const asNumber = (value: unknown): number | undefined => {
    return typeof value === 'number' ? value : undefined;
};
