// The bounds of an organization's settings, for the API and the console.

// How many days agents' metrics readings are kept.
export const metricsRetentionDays = { min: 1, max: 90, default: 30 } as const
