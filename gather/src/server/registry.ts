/** Operations modules register here, so the MCP endpoint can dispatch to them without importing them in a cycle. */
export const cartOperations: { send?: (eventId: string, giftId: string) => Promise<unknown>; approve?: (eventId: string, giftId: string) => Promise<unknown> } = {};
