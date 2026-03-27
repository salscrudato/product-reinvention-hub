#!/usr/bin/env bash
set -euo pipefail
BASE_URL=${BASE_URL:-http://localhost:8080}
REALM=${REALM:-devpilot}
ADMIN_USER=${KC_ADMIN:-admin}
ADMIN_PASS=${KC_ADMIN_PASSWORD:-admin}
USERS=${USERS:-dev1}
log(){ echo -e "\033[32m$1\033[0m"; }
warn(){ echo -e "\033[33m$1\033[0m"; }
token=$(curl -s -X POST "$BASE_URL/realms/master/protocol/openid-connect/token" -H 'Content-Type: application/x-www-form-urlencoded' -d "client_id=admin-cli&grant_type=password&username=$ADMIN_USER&password=$ADMIN_PASS" | jq -r '.access_token')
[[ -z "$token" || "$token" == null ]] && { echo 'Failed to obtain admin token'; exit 1; }
kc_get(){ curl -s -H "Authorization: Bearer $token" "$1"; }
kc_post(){ curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $token" -H 'Content-Type: application/json' -d "$2" "$1"; }
if kc_get "$BASE_URL/admin/realms/$REALM/roles/prompt_admin" | jq -e '.name' >/dev/null 2>&1; then
  log 'Role prompt_admin exists'
else
  log 'Creating role prompt_admin'
  kc_post "$BASE_URL/admin/realms/$REALM/roles" '{"name":"prompt_admin"}' >/dev/null
fi
for u in $(echo "$USERS" | tr ',' ' '); do
  uid=$(kc_get "$BASE_URL/admin/realms/$REALM/users?username=$u" | jq -r '.[0].id')
  if [[ -z "$uid" || "$uid" == null ]]; then warn "User $u not found"; continue; fi
  rid=$(kc_get "$BASE_URL/admin/realms/$REALM/roles/prompt_admin" | jq -r '.id')
  existing=$(kc_get "$BASE_URL/admin/realms/$REALM/users/$uid/role-mappings/realm" | jq -r '.[].name' | grep -i 'prompt_admin' || true)
  if [[ -z "$existing" ]]; then
    kc_post "$BASE_URL/admin/realms/$REALM/users/$uid/role-mappings/realm" '[{"id":"'$rid'","name":"prompt_admin"}]' >/dev/null
    log "Assigned prompt_admin -> $u"
  else
    log "User $u already has prompt_admin"
  fi
done
log 'prompt_admin role assignment complete'