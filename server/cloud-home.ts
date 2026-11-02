import type { CloudTeam } from "./cloud-team.ts";
export type CloudHomeRole = "home" | "team";
export interface CloudHomeConfig {
  /** `home`: one person's My Cloud. `team`: a Team Cloud several people use (docs/team-cloud.md). */
  role: CloudHomeRole;
  /** The team this machine is the home of; null on a My Cloud. */
  team: CloudTeam | null;
  machineId: string;
  adminOrigin: string;
  publicOrigin: string;
  bootstrapSecret: string;
  warnings: string[];
}
