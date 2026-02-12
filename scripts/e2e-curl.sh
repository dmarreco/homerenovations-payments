#!/usr/bin/env bash
#
# E2E script: runs curl requests against the deployed API and asserts status codes and response fields.
# Usage: ./scripts/e2e-curl.sh [BASE_URL]
#   BASE_URL defaults to env E2E_BASE_URL or https://0z74f8i7oj.execute-api.us-east-1.amazonaws.com/dev
# Requires: curl, jq
#
set -euo pipefail

BASE_URL="${1:-${E2E_BASE_URL:-https://0z74f8i7oj.execute-api.us-east-1.amazonaws.com/dev}}"
# Use a unique resident per run to avoid DynamoDB version conflicts when re-running
RESIDENT_ID="${E2E_RESIDENT_ID:-resident-e2e-$(date +%s)}"

if ! command -v jq &>/dev/null; then
  echo "Error: jq is required. Install with: brew install jq (macOS) or apt install jq (Linux)"
  exit 1
fi

echo "E2E base URL: $BASE_URL"
echo "Resident ID:  $RESIDENT_ID"
echo "---"

# Helper: curl and capture status + body. Usage: curl_assert METHOD PATH [BODY] EXPECTED_STATUS
curl_assert() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local expected_status="${4:-200}"
  local url="${BASE_URL}${path}"
  local tmp
  tmp=$(mktemp)
  local status
  if [[ -n "$body" ]]; then
    status=$(curl -s -w '%{http_code}' -o "$tmp" -X "$method" -H 'Content-Type: application/json' -d "$body" "$url")
  else
    status=$(curl -s -w '%{http_code}' -o "$tmp" -X "$method" "$url")
  fi
  if [[ "$status" != "$expected_status" ]]; then
    echo "FAIL $method $path: expected HTTP $expected_status, got $status"
    echo "Response: $(cat "$tmp")"
    rm -f "$tmp"
    return 1
  fi
  cat "$tmp"
  rm -f "$tmp"
  return 0
}

# 1. Enroll payment method (mock Stripe accepts pm_card_visa-style id)
echo "1. Enroll payment method..."
resp=$(curl_assert POST "/residents/$RESIDENT_ID/payment-methods" '{"type":"card","paymentMethodId":"pm_card_visa"}' 201)
method_id=$(echo "$resp" | jq -r '.methodId')
if [[ -z "$method_id" || "$method_id" == "null" ]]; then
  echo "FAIL: expected methodId in response: $resp"
  exit 1
fi
echo "   methodId: $method_id"

# 2. Post charge
echo "2. Post charge..."
resp=$(curl_assert POST "/residents/$RESIDENT_ID/charges" '{"amount":2100,"chargeType":"RENT","description":"Rent"}' 201)
echo "$resp" | jq -e '.message' >/dev/null || { echo "FAIL: expected message in response: $resp"; exit 1; }
echo "   OK"

# 3. Get balance (should be 2100)
echo "3. Get balance..."
resp=$(curl_assert GET "/residents/$RESIDENT_ID/balance" "" 200)
balance=$(echo "$resp" | jq -r '.balance')
if [[ "$balance" != "2100" ]]; then
  echo "FAIL: expected balance 2100, got $balance"
  exit 1
fi
echo "   balance: $balance"

# 4. Make payment
echo "4. Make payment..."
resp=$(curl_assert POST "/residents/$RESIDENT_ID/payments" "{\"amount\":2100,\"paymentMethodId\":\"$method_id\"}" 202)
echo "$resp" | jq -e '.paymentId' >/dev/null || { echo "FAIL: expected paymentId: $resp"; exit 1; }
echo "$resp" | jq -e '.currentBalance' >/dev/null || { echo "FAIL: expected currentBalance: $resp"; exit 1; }
balance_after=$(echo "$resp" | jq -r '.balanceAfterPayment')
if [[ "$balance_after" != "0" ]]; then
  echo "FAIL: expected balanceAfterPayment 0, got $balance_after"
  exit 1
fi
payment_id=$(echo "$resp" | jq -r '.paymentId')
echo "   paymentId: $payment_id, balanceAfterPayment: $balance_after"

# 5. Get history
echo "5. Get payment history..."
resp=$(curl_assert GET "/residents/$RESIDENT_ID/payments" "" 200)
echo "$resp" | jq -e '.payments' >/dev/null || { echo "FAIL: expected payments array: $resp"; exit 1; }
count=$(echo "$resp" | jq '.payments | length')
echo "   payments count: $count"

# 6. Get balance again (may still show 2100 until webhook runs; with mock no webhook, so we only assert 200 and numeric balance)
echo "6. Get balance (after payment)..."
resp=$(curl_assert GET "/residents/$RESIDENT_ID/balance" "" 200)
balance=$(echo "$resp" | jq -r '.balance')
echo "$balance" | grep -qE '^[0-9]+$' || { echo "FAIL: balance should be numeric, got $balance"; exit 1; }
echo "   balance: $balance (note: with STRIPE_MOCK=true, webhook does not run so ledger may not yet show 0)"

echo "---"
echo "All assertions passed."
