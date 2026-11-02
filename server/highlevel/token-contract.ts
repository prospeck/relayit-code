// Token rotation contract used by the direct API client. No network implementation.
export interface RelayTokens { accessToken: string; refreshToken: string; expiresIn: number; scope: string; locationId: string; companyId?: string; userId?: string }
export class HighLevelRelayError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "HighLevelRelayError";
    this.status = status;
    this.code = code;
  }
}
