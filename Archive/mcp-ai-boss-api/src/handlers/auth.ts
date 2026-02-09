/**
 * Authentication handler for AI-BOSS-API
 */

export class AuthHandler {
  private apiKey: string;

  constructor() {
    const apiKey = process.env.AI_BOSS_API_KEY || process.env.AMDOCS_API_KEY;
    
    if (!apiKey) {
      throw new Error(
        'AI_BOSS_API_KEY or AMDOCS_API_KEY environment variable is required'
      );
    }

    this.apiKey = apiKey;
  }

  /**
   * Get API key
   */
  getApiKey(): string {
    return this.apiKey;
  }

  /**
   * Get headers with authentication
   */
  getAuthHeaders(): Record<string, string> {
    return {
      'X-API-Key': this.apiKey,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Update API key (for runtime updates)
   */
  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
  }
}


