#!/usr/bin/env bash
set -euo pipefail

# Provision separate realm 'devpilot' without altering existing realms.
# Requires curl + jq and admin credentials.

BASE_URL=${BASE_URL:-http://localhost:8080}
REALM=${REALM:-devpilot}
CLIENT_ID=${CLIENT_ID:-devpilot-frontend}
ADMIN_USER=${KC_ADMIN:-admin}
ADMIN_PASS=${KC_ADMIN_PASSWORD:-admin}
USER_PWD=${USER_PASSWORD:-DevPass123!}

log(){ echo -e "\033[32m$1\033[0m"; }
warn(){ echo -e "\033[33m$1\033[0m"; }

token=$(curl -s -X POST "$BASE_URL/realms/master/protocol/openid-connect/token" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d "client_id=admin-cli&grant_type=password&username=$ADMIN_USER&password=$ADMIN_PASS" | jq -r '.access_token')
[[ -z "$token" || "$token" == null ]] && { echo "Failed to obtain admin token"; exit 1; }

kc_get(){ curl -s -H "Authorization: Bearer $token" "$1"; }
kc_post(){ curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $token" -H 'Content-Type: application/json' -d "$2" "$1"; }
kc_put(){ curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $token" -H 'Content-Type: application/json' -d "$2" "$1"; }

# Realm
if kc_get "$BASE_URL/admin/realms/$REALM" | jq -e '.realm' >/dev/null 2>&1; then
  log "Realm $REALM exists"
else
  log "Creating realm $REALM"
  code=$(kc_post "$BASE_URL/admin/realms" "{\"realm\":\"$REALM\",\"enabled\":true}")
  [[ $code == 201 ]] || { echo "Realm creation failed ($code)"; exit 1; }
fi

ensure_role(){
  local role=$1
  if kc_get "$BASE_URL/admin/realms/$REALM/roles/$role" | jq -e '.name' >/dev/null 2>&1; then
    log "Role $role exists"
  else
    log "Creating role $role"
    kc_post "$BASE_URL/admin/realms/$REALM/roles" "{\"name\":\"$role\"}" >/dev/null
  fi
}

ensure_role developer
ensure_role product_owner
ensure_role engineering_lead
ensure_role prompt_admin

# Client
if [[ $(kc_get "$BASE_URL/admin/realms/$REALM/clients?clientId=$CLIENT_ID" | jq 'length') -gt 0 ]]; then
  log "Client $CLIENT_ID exists"
else
  log "Creating client $CLIENT_ID"
  kc_post "$BASE_URL/admin/realms/$REALM/clients" '{"clientId":"'$CLIENT_ID'","publicClient":true,"protocol":"openid-connect","standardFlowEnabled":true,"directAccessGrantsEnabled":true,"redirectUris":["http://localhost:3000/*"],"webOrigins":["http://localhost:3000"],"attributes":{"pkce.code.challenge.method":"S256"}}' >/dev/null
fi

create_user(){
  local user=$1 role=$2
  if [[ $(kc_get "$BASE_URL/admin/realms/$REALM/users?username=$user" | jq 'length') -gt 0 ]]; then
    log "User $user exists"
  else
    log "Creating user $user"
    kc_post "$BASE_URL/admin/realms/$REALM/users" '{"username":"'$user'","enabled":true,"email":"'$user'@devpilot.test","emailVerified":true}' >/dev/null
  fi
  uid=$(kc_get "$BASE_URL/admin/realms/$REALM/users?username=$user" | jq -r '.[0].id')
  kc_put "$BASE_URL/admin/realms/$REALM/users/$uid/reset-password" '{"type":"password","value":"'$USER_PWD'","temporary":false}' >/dev/null
  rid=$(kc_get "$BASE_URL/admin/realms/$REALM/roles/$role" | jq -r '.id')
  existing=$(kc_get "$BASE_URL/admin/realms/$REALM/users/$uid/role-mappings/realm" | jq -r '.[].name' | grep -i "$role" || true)
  if [[ -z "$existing" ]]; then
    kc_post "$BASE_URL/admin/realms/$REALM/users/$uid/role-mappings/realm" '[{"id":"'$rid'","name":"'$role'"}]' >/dev/null
    log "Assigned $role -> $user"
  fi
}

create_user dev1 developer
# Assign prompt_admin to dev1 (reuse create_user invocation for primary role; then map secondary role)
rid_prompt=$(kc_get "$BASE_URL/admin/realms/$REALM/roles/prompt_admin" | jq -r '.id')
uid_dev1=$(kc_get "$BASE_URL/admin/realms/$REALM/users?username=dev1" | jq -r '.[0].id')
existing_prompt=$(kc_get "$BASE_URL/admin/realms/$REALM/users/$uid_dev1/role-mappings/realm" | jq -r '.[].name' | grep -i 'prompt_admin' || true)
if [[ -z "$existing_prompt" ]]; then
  kc_post "$BASE_URL/admin/realms/$REALM/users/$uid_dev1/role-mappings/realm" '[{"id":"'$rid_prompt'","name":"prompt_admin"}]' >/dev/null
  log "Assigned prompt_admin -> dev1"
fi
create_user po1 product_owner
create_user el1 engineering_lead

log "Provisioning complete (realm=$REALM client=$CLIENT_ID users=dev1|po1|el1 password=$USER_PWD)"
