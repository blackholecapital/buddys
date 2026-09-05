import contextlib
import importlib.util
import io
import sys
sys.dont_write_bytecode = True
from pathlib import Path

spec = importlib.util.spec_from_file_location('inventory', Path(__file__).with_name('cloudflare-buddy-inventory.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
calls=[]
def fixture(token, path):
    calls.append(path)
    if '/settings' in path:
        return {'result':{'bindings':[
            {'name':'INTERNAL_CALL_SECRET','type':'secret_text','text':'DO-NOT-PRINT'},
            {'name':'CF_ACCESS_AUD','type':'plain_text','text':'DO-NOT-PRINT'},
            {'name':'ASSISTANT','type':'service','service':'buddys-assistant-adapter'},
            {'name':'DOCUSIGN_RSA_PRIVATE_KEY','type':'secrets_store_secret','store_id':module.STORE,'secret_name':'BUDDYS_RSA','value':'DO-NOT-PRINT'},
        ]}}
    page2='page=2' in path
    return {'result':[{'name':'XYZ_DEMO_DOCUSIGN_ACCOUNT_ID','status':'active','value':'DO-NOT-PRINT','comment':'DO-NOT-PRINT'}],
            'result_info':{'total_pages':2,'page':2 if page2 else 1}}
output=io.StringIO()
with contextlib.redirect_stdout(output):
    assert module.inventory('DO-NOT-PRINT',fixture)==0
assert 'DO-NOT-PRINT' not in output.getvalue()
assert len(calls)==8
assert any('page=2' in path for path in calls)
assert 'secret_name' in output.getvalue()
assert 'MISSING' in output.getvalue()
print('PASS: inventory allowlist redacts secret/plaintext values and comments, visits only Buddy workers, and paginates store metadata')
