#!/usr/bin/env python3
"""Preflight and deploy the Buddy-owned binding update. Never reads secret values."""
import argparse
import getpass
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import tomllib

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('inventory', ROOT / 'scripts/cloudflare-buddy-inventory.py')
inventory = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inventory)
CORE = ['blackhole-concierge-worker', 'dashboard']
CHANNELS = ['sms-worker', 'email-worker', 'voice-worker']


def validate_remote(config, remote, store):
    """Return actionable names only; never render arbitrary API content."""
    errors = []
    bindings = {b['name']: b for b in remote.get('bindings', [])}
    for name in config.get('secrets', {}).get('required', []):
        if bindings.get(name, {}).get('type') != 'secret_text':
            errors.append(f'{name}: ordinary Worker secret missing')
    for binding in config.get('secrets_store_secrets', []):
        name, secret = binding['binding'], binding['secret_name']
        if binding['store_id'] != inventory.STORE:
            errors.append(f'{name}: unexpected store')
        entry = store.get(secret, {})
        if entry.get('status') != 'active' or 'workers' not in entry.get('scopes', []):
            errors.append(f'{name}: central secret unavailable or not scoped to Workers')
        existing = bindings.get(name)
        if existing and not (existing.get('type') == 'secrets_store_secret'
                             and existing.get('store_id') == binding['store_id']
                             and existing.get('secret_name') == secret):
            errors.append(f'{name}: existing binding differs; refusing to replace it')
    for binding in config.get('d1_databases', []):
        name = binding['binding']
        existing = bindings.get(name, {})
        if existing.get('type') != 'd1' or existing.get('id') != binding['database_id']:
            errors.append(f'{name}: live database does not match verified Buddy database')
    if config['name'] == 'buddys-email-worker':
        if 'FROM_EMAIL' not in bindings and not config.get('vars', {}).get('FROM_EMAIL'):
            errors.append('FROM_EMAIL: verified Resend sender missing')
    return errors


def central_metadata(token):
    result, page = {}, 1
    while page <= 100:
        data = inventory.request(token, f'/accounts/{inventory.ACCOUNT}/secrets_store/stores/{inventory.STORE}/secrets?page={page}&per_page=100')
        for entry in data['result']:
            result[entry['name']] = entry
        if page >= int(data.get('result_info', {}).get('total_pages', 1)):
            return result
        page += 1
    raise RuntimeError('Secret metadata pagination incomplete')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Deploy after all selected targets pass preflight and bundling')
    parser.add_argument('--all', action='store_true', help='Also deploy SMS, email and voice; requires their existing Worker secrets')
    args = parser.parse_args()
    targets = CHANNELS + CORE if args.all else CORE
    configs = [(ROOT / f'apps/{target}/wrangler.toml') for target in targets]
    token = os.environ.get('CLOUDFLARE_API_TOKEN', '').strip()
    if not token:
        token = getpass.getpass('Cloudflare API token (hidden): ').strip()
    if not token:
        raise RuntimeError('No token supplied; nothing changed')
    store = central_metadata(token)
    blocked = False
    for path in configs:
        config = tomllib.loads(path.read_text())
        name = config['name']
        remote = inventory.request(token, f'/accounts/{inventory.ACCOUNT}/workers/scripts/{name}/settings')['result']
        errors = validate_remote(config, remote, store)
        print(name + ': ' + ('BLOCKED' if errors else 'preflight passed'), flush=True)
        for error in errors:
            print('  ' + error, flush=True)
        blocked = blocked or bool(errors)
        if name == 'buddys-dashboard-worker':
            names = {b['name'] for b in remote.get('bindings', [])}
            for key in ['CF_ACCESS_TEAM_DOMAIN', 'CF_ACCESS_AUD', 'OPERATOR_ROLES_JSON']:
                if key not in names:
                    print(f'  Operator access remains locked: {key} missing', flush=True)
    if blocked:
        raise RuntimeError('Preflight failed. No deployments or secret changes performed')
    # Explicitly restrict account and target; preserve remotely configured variables.
    env = {**os.environ, 'CLOUDFLARE_API_TOKEN': token, 'CLOUDFLARE_ACCOUNT_ID': inventory.ACCOUNT,
           'WRANGLER_SEND_METRICS': 'false'}
    subprocess.run(['npm', 'run', 'validate', '--prefix', 'blackhole-runtime'], cwd=ROOT, env=env, check=True)
    with tempfile.TemporaryDirectory(prefix='buddy-bindings-') as temp:
        for index, path in enumerate(configs):
            subprocess.run(['npx', '--yes', 'wrangler@4.126.0', 'deploy', '--env', '', '--config', str(path),
                            '--dry-run', '--outdir', str(Path(temp) / str(index))], cwd=ROOT, env=env, check=True)
    if not args.apply:
        print('Preflight and bundling passed. No deployment performed. Use --apply to deploy.')
        return
    for path in configs:
        subprocess.run(['npx', '--yes', 'wrangler@4.126.0', 'deploy', '--env', '', '--config', str(path), '--keep-vars'],
                       cwd=ROOT, env=env, check=True)
    print('Selected Buddy Workers deployed. Secret values were not read or rotated.')
    print('Provider authentication, delivery and operator access still require live acceptance.')
    if not args.all:
        print('SMS/email/voice unchanged. Use --all after their required secrets are configured.')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError) as error:
        sys.exit(str(error) if isinstance(error, RuntimeError) else 'Command failed; remaining deployments stopped. See output above.')
    except (KeyError, TypeError, ValueError):
        sys.exit('Unexpected configuration/API shape; remaining operations stopped. No API values printed.')
