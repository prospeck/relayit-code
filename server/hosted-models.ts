import type { ModelSelection, InstanceConfigMap, ProviderInstance } from "./contracts.ts";
import type { Store } from "./store.ts";
// Legacy policy shape for saved task compatibility. No hosted gateway implementation is shipped.
export interface HostedModelPolicy { allows(selection: ModelSelection): boolean; select(selection?: ModelSelection): ModelSelection; resetTask(previous: ModelSelection, next: ModelSelection): Record<string, unknown>; error(): string; configs(): InstanceConfigMap; decorate(instance: ProviderInstance): ProviderInstance; reconcile(store: Store): void; }
export const HOSTED_PROVIDER_SETTINGS_ERROR = "Provider accounts are configured in Settings.";
