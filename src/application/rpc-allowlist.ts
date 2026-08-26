// Methods a paired local agent is permitted to execute on behalf of the hub.
// Anything not listed here (shell execution, arbitrary file access, arbitrary
// browser evaluation, ...) must be rejected by both the hub and the agent.
export const RPC_METHODS = new Set([
  "rts_session_status",
  "rts_open",
  "rts_inspect_portal",
  "rts_apply_site_filters",
  "rts_workspace",
  "rts_list_requests",
  "rts_search_advanced",
  "rts_analyze_summary",
  "rts_deadlines",
  "rts_get_request",
  "rts_build_dossier",
  "rts_track_request",
  "rts_compare_requests",
  "rts_prepare_offer_draft",
  "rts_assess_readiness",
  "rts_bid_economics",
  "rts_build_workplan",
  "rts_extract_tables",
  "rts_download_all_documents",
  "rts_screenshot",
  "rts_close",
]);

// Destructive operations. Reachable only through a dedicated, explicitly
// confirmed API route — never through the generic RPC gateway.
export const DESTRUCTIVE_RPC_METHODS = new Set(["rts_forget_profile"]);

export function isAllowedRpcMethod(method: string): boolean {
  // Destructive methods are intentionally never relayed through Railway. They
  // can only run in local transport with the additional MCP/config safeguards.
  return RPC_METHODS.has(method);
}
