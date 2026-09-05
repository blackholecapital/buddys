#!/usr/bin/env python3
"""Read-only Buddy binding inventory. Prints names/types/IDs, never values.

Uses Cloudflare GET Worker Settings and List Store Secrets. Deliberately has no
write operation: existing INTERNAL_CALL_SECRET equality cannot be inferred from
matching binding names. Run on the authenticated server before provisioning.
"""
import getpass
import json
import os
import sys
import urllib.error
import urllib.request

ACCOUNT = '841893af4dee7e52549a8adbef936100'
STORE = '00b34d29f2c94685b0f250dc5b1ee875'
WORKERS = {
    'buddys-dashboard-worker': ['INTERNAL_CALL_SECRET', 'ASSISTANT', 'CONCIERGE', 'DB', 'BUDDY_DB', 'CF_ACCESS_TEAM_DOMAIN', 'CF_ACCESS_AUD', 'OPERATOR_ROLES_JSON'],
    'buddys-concierge-worker': ['INTERNAL_CALL_SECRET', 'DOCUSIGN_CONNECT_HMAC_SECRET', 'DOCUSIGN_RSA_PRIVATE_KEY', 'DOCUSIGN_ACCOUNT_ID', 'DOCUSIGN_USER_ID', 'DOCUSIGN_INTEGRATION_KEY', 'SMS', 'EMAIL', 'VOICE', 'DB', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'],
    'buddys-sms-worker': ['INTERNAL_CALL_SECRET', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER'],
    'buddys-email-worker': ['INTERNAL_CALL_SECRET', 'RESEND_API_KEY'],
    'buddys-voice-worker': ['INTERNAL_CALL_SECRET', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER', 'DEEPGRAM_API_KEY', 'BUDDY_RUNTIME_TOKEN'],
    'buddys-assistant-adapter': ['BLACKHOLE_RUNTIME_TOKEN', 'BLACKHOLE_CAPABILITY_TOKEN', 'VIDEO', 'ASSISTANT_ASSETS'],
}


def binding_summary(binding):
    # Do not print 'text', 'json', arbitrary attributes, or API error bodies.
    kind = binding.get('type', 'unknown')
    fields = {
        'service': ('service', 'environment'),
        'd1': ('id',),
        'kv_namespace': ('namespace_id',),
        'r2_bucket': ('bucket_name',),
        'secrets_store_secret': ('store_id', 'secret_name'),
    }.get(kind, ())
    return {'name': binding.get('name', ''), 'type': kind,
            **{key: binding[key] for key in fields if key in binding}}


def request(token, path):
    req = urllib.request.Request('https://api.cloudflare.com/client/v4' + path,
                                 headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/json'}, method='GET')
    try:
        with urllib.request.urlopen(req, timeout=25) as response:
            payload = json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f'HTTP {error.code}; check account and token permissions') from None
    except (urllib.error.URLError, TimeoutError, ValueError):
        raise RuntimeError('Cloudflare request failed; no response body printed') from None
    if payload.get('success') is not True:
        raise RuntimeError('Cloudflare did not confirm a successful read')
    return payload


def inventory(token, fetch=request):
    print('BUDDY CLOUDFLARE INVENTORY — READ ONLY')
    print('Account:', ACCOUNT)
    failures = 0
    for worker, required in WORKERS.items():
        print('\n' + worker)
        try:
            data = fetch(token, f'/accounts/{ACCOUNT}/workers/scripts/{worker}/settings')['result']
            bindings = data.get('bindings', [])
            by_name = {binding['name']: binding for binding in bindings}
            for name in required:
                binding = by_name.get(name)
                print('  ' + (json.dumps(binding_summary(binding)) if binding else name + ': MISSING'))
            for binding in bindings:
                if binding.get('type') in ('secret_text', 'secrets_store_secret') and binding.get('name') not in required:
                    print('  Additional secret binding: ' + json.dumps(binding_summary(binding)))
        except (RuntimeError, KeyError, TypeError) as error:
            # RuntimeError is generated locally above; malformed response errors do not include values.
            print('  UNVERIFIED: ' + (str(error) if isinstance(error, RuntimeError) else 'Unexpected response shape'))
            failures += 1
    print('\nRelevant account secret names (values are never retrieved):')
    try:
        page = 1
        while True:
            data = fetch(token, f'/accounts/{ACCOUNT}/secrets_store/stores/{STORE}/secrets?page={page}&per_page=100')
            for secret in data['result']:
                name = str(secret.get('name', ''))
                if name.startswith(('BUDDYS_', 'INTERNAL_', 'DOCUSIGN_', 'XYZ_DEMO_DOCUSIGN_', 'XYZ_DEMO_GOOGLE_', 'XYZ_DEMO_TWILIO_', 'XYZ_DEMO_RESEND_', 'XYZ_DEMO_DEEPGRAM_', 'XYZ_DEMO_RUNTIME_', 'XYZ_DEMO_EILA_RUNTIME_')):
                    print('  ' + json.dumps({key: secret.get(key) for key in ('name', 'status', 'scopes')}))
            if page >= int(data.get('result_info', {}).get('total_pages', 1)):
                break
            page += 1
            if page > 100:
                raise RuntimeError('Pagination limit reached; inventory incomplete')
    except (RuntimeError, KeyError, TypeError, ValueError) as error:
        print('  UNVERIFIED: ' + (str(error) if isinstance(error, RuntimeError) else 'Unexpected response shape'))
        failures += 1
    print('\nNo values were printed or changed. Matching secret names do not prove matching values.')
    print('MISSING means no binding with the expected name; alternate credentials may still be configured.')
    print('Send this report back before generating an internal secret or adding/rebinding credentials.')
    return 1 if failures else 0


if __name__ == '__main__':
    token = os.environ.get('CLOUDFLARE_API_TOKEN', '').strip()
    if not token:
        if not sys.stdin.isatty():
            sys.exit('Run in an interactive terminal or provide CLOUDFLARE_API_TOKEN in the environment.')
        token = getpass.getpass('Cloudflare API token (hidden): ').strip()
    if not token:
        sys.exit('No token supplied; nothing changed.')
    sys.exit(inventory(token))
