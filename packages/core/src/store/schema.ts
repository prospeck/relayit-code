/** Row types. JSON columns are stored as TEXT; booleans as INTEGER 0/1. */

export interface KvTable { key: string; value: string; updated_at: string }
export interface SecretTable { name: string; blob: string; updated_at: string }

export interface ConversationTable {
  id: string; title: string; kind: string; created_at: string; updated_at: string;
}
export interface MessageTable {
  id: string; conversation_id: string; role: string; parts: string; usage: string | null; created_at: string;
}
export interface AgentRunTable {
  id: string; conversation_id: string; status: string; state: string; error: string | null;
  created_at: string; updated_at: string;
}
export interface PendingActionTable {
  id: string; run_id: string; conversation_id: string; tool_name: string; tool_call_id: string;
  title: string; summary: string; service: string; recipient: string | null; amount_inr: number | null;
  details: string; payload: string; status: string; tainted: number; involves_money: number;
  spend_cap_inr: number | null; idempotency_key: string; expires_at: string; created_at: string;
  resolved_at: string | null; result: string | null;
}
export interface ApprovalRuleTable { id: string; tool_name: string; service: string; label: string; created_at: string }
export interface AuditEventTable {
  id: string; ts: string; kind: string; tool_name: string | null; tool_class: string | null;
  summary: string; data: string; conversation_id: string | null;
}
export interface TaskTable {
  id: string; title: string; detail: string; status: string; source: string; source_ref: string | null;
  conversation_id: string | null; created_at: string; updated_at: string;
}
export interface McpServerTable {
  id: string; name: string; transport: string; command: string | null; args: string; env: string;
  url: string | null; domain: string; enabled: number; builtin: number; created_at: string;
}
export interface McpToolTable {
  server_id: string; name: string; description: string; tool_class: string; enabled: number; meta: string;
}
export interface OrderTable {
  id: string; provider: string; external_id: string; title: string; amount_inr: number; status: string;
  data: string; conversation_id: string | null; created_at: string; updated_at: string;
}
export interface PaymentTable {
  id: string; order_id: string; data: string; status: string; created_at: string; updated_at: string;
}
export interface SkillTable {
  id: string; slug: string; title: string; description: string; instructions: string; domains: string;
  builtin: number; updated_at: string;
}
export interface RoutineTable {
  id: string; title: string; prompt: string; cron: string; enabled: number; next_run_at: string | null;
  last_run_at: string | null; last_status: string | null; created_at: string;
}
export interface RoutineRunTable {
  id: string; routine_id: string; started_at: string; finished_at: string | null; status: string;
  conversation_id: string | null; error: string | null;
}
export interface MemoryFactTable {
  id: string; category: string; key: string; value: string; source: string; updated_at: string;
}

export interface DB {
  kv: KvTable;
  secrets: SecretTable;
  conversations: ConversationTable;
  messages: MessageTable;
  agent_runs: AgentRunTable;
  pending_actions: PendingActionTable;
  approval_rules: ApprovalRuleTable;
  audit_events: AuditEventTable;
  tasks: TaskTable;
  mcp_servers: McpServerTable;
  mcp_tools: McpToolTable;
  orders: OrderTable;
  payments: PaymentTable;
  skills: SkillTable;
  routines: RoutineTable;
  routine_runs: RoutineRunTable;
  memory_facts: MemoryFactTable;
}
