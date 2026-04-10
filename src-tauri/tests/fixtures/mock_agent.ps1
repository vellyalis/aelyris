# Mock Claude Code agent that outputs stream-json events
# Used for testing Aether Terminal's agent integration

$events = @(
    '{"type":"system","subtype":"init","session_id":"mock-session-001"}',
    '{"type":"assistant","subtype":"text","content":"Analyzing the request..."}',
    '{"type":"assistant","subtype":"tool_use","tool_name":"Read","tool_input":{"path":"test.txt"}}',
    '{"type":"assistant","subtype":"tool_result","content":"file contents here"}',
    '{"type":"assistant","subtype":"text","content":"Done processing."}',
    '{"type":"result","subtype":"success","cost_usd":0.003,"total_tokens":250,"duration_ms":1200}'
)

foreach ($event in $events) {
    [Console]::Out.WriteLine($event)
    [Console]::Out.Flush()
    Start-Sleep -Milliseconds 50
}
