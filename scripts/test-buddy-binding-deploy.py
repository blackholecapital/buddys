import importlib.util
from pathlib import Path
import sys
import tomllib
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('deploy', Path(__file__).with_name('deploy-buddy-bindings.py'))
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)
for target in deploy.CORE + deploy.CHANNELS:
    config = tomllib.loads((deploy.ROOT / f'apps/{target}/wrangler.toml').read_text())
    assert config['name'].startswith('buddys-')
    bindings = [{'name': name, 'type': 'secret_text'} for name in config['secrets']['required']]
    if target == 'email-worker':
        bindings.append({'name':'FROM_EMAIL', 'type':'plain_text'})
    bindings += [{'name': b['binding'], 'type':'d1', 'id':b['database_id']} for b in config.get('d1_databases', [])]
    store = {b['secret_name']:{'status':'active', 'scopes':['workers']} for b in config.get('secrets_store_secrets', [])}
    remote = {'bindings':bindings}
    assert not deploy.validate_remote(config, remote, store)
    assert deploy.validate_remote(config, {'bindings':[]}, store), 'Missing prerequisites must block before deploy'
    if store:
        assert deploy.validate_remote(config, remote, {}), 'Missing central secret must block'
        first = config['secrets_store_secrets'][0]
        conflict = {'bindings':bindings + [{'name':first['binding'], 'type':'secret_text'}]}
        assert deploy.validate_remote(config, conflict, store), 'Never replace an unrelated existing credential'
        assert not deploy.validate_remote(config, {'bindings':bindings + [{'name':first['binding'], 'type':'secrets_store_secret', 'store_id':first['store_id'], 'secret_name':first['secret_name']}]}, store)
    if config.get('d1_databases'):
        bad = {'bindings':[dict(b, id='wrong-database') if b['type']=='d1' else b for b in bindings]}
        assert deploy.validate_remote(config, bad, store)
print('PASS: all five configs, missing prerequisites, central secret collisions, reruns and Buddy D1 ownership gates')
