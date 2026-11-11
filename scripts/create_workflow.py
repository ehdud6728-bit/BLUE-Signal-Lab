from pathlib import Path
from io import BytesIO
from zipfile import ZipFile,ZIP_DEFLATED
import base64,hashlib,textwrap
root=Path(__file__).resolve().parents[1]
files=[
'scripts/blue_r153_install.py',
'worker/src/performance.ts',
'collector/src/basket.mjs',
'web/src/r153-performance.css',
'tests/test_r153.mjs'
]
buf=BytesIO()
with ZipFile(buf,'w',compression=ZIP_DEFLATED,compresslevel=9) as z:
 for p in files:z.write(root/p,p)
data=buf.getvalue()
sha=hashlib.sha256(data).hexdigest()
payload='\n'.join('          '+s for s in textwrap.wrap(base64.b64encode(data).decode('ascii'),120))
expected='{'+','.join(repr(s) for s in files)+'}'
workflow=f"""name: BLUE R1.5.3 Basket Performance + Bottom Navigation (MANUAL)
on:
  workflow_dispatch:
    inputs:
      apply_changes:
        description: 'FALSE = test and dry-run only. TRUE = commit reviewed files to main. Deployment is SEPARATE.'
        type: boolean
        required: true
        default: false
permissions:
  contents: write
concurrency:
  group: blue-r153-basket-install
  cancel-in-progress: false
jobs:
  test_and_optional_install:
    runs-on: ubuntu-latest
    timeout-minutes: 22
    steps:
      - name: Guard correct repository and main branch
        shell: bash
        run: |
          test "$GITHUB_REPOSITORY" = 'ehdud6728-bit/BLUE-Signal-Lab'
          test "$GITHUB_REF_NAME" = 'main'
      - uses: actions/checkout@v4
        with:
          persist-credentials: true
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - name: Restore reviewed R1.5.3 code from this workflow
        shell: bash
        run: |
          python - <<'PYRESTORE'
          from pathlib import Path
          from io import BytesIO
          from zipfile import ZipFile
          import base64,hashlib
          data=base64.b64decode(''.join('''
{payload}
          '''.split()))
          assert hashlib.sha256(data).hexdigest()=='{sha}','Invalid signed-in-workflow payload hash'
          with ZipFile(BytesIO(data)) as z:
              expected={expected}
              assert set(z.namelist())==expected,'Unexpected installer paths'
              for name in z.namelist():
                  p=Path(name)
                  p.parent.mkdir(parents=True,exist_ok=True)
                  b=z.read(name)
                  if p.exists() and p.read_bytes()!=b:
                      raise SystemExit('R153_EXISTING_FILE_DIFF: '+name)
                  p.write_bytes(b)
                  print('R153_RESTORED',name)
          PYRESTORE
      - name: Assert strict anchors and patch only reviewed files in runner
        shell: bash
        run: |
          set -euo pipefail
          python scripts/blue_r153_install.py --check
          python scripts/blue_r153_install.py --apply
          python - <<'PYASSERT'
          from pathlib import Path
          main=Path('web/src/main.tsx').read_text()
          basket=Path('web/src/SmartBasket.tsx').read_text()
          api=Path('worker/src/index.ts').read_text()
          cron=Path('collector/src/index.mjs').read_text()
          core=Path('collector/src/core.mjs').read_text()
          conf=Path('collector/wrangler.jsonc').read_text()
          assert 'R153_BOTTOM_NAV_ONLY' in main and '<nav className="r152-main-tabs"' not in main
          assert 'R153_PERFORMANCE_MONITOR' in basket and 'r153-price-grid' in basket
          assert 'basketWatch(request,env)' in api and 'if (!access)' in api
          assert 'collectBasket(env)' in cron and 'minute%5===0' in cron
          assert 'export async function getKisQuote' in core
          assert '"* * * * *"' in conf and '"*/5 * * * *"' not in conf
          assert 'blue_r15_basket_v1' in basket and 'r151-quick-add' in main
          print('R153_ISOLATED_PATCHES_OK')
          PYASSERT
      - name: Unit tests for validated dates and historical high
        shell: bash
        run: node --experimental-strip-types --test tests/test_r153.mjs
      - name: Build production React frontend
        working-directory: web
        shell: bash
        run: |
          npm install --no-package-lock --no-audit --no-fund
          npm run build
      - name: Typecheck and build-check existing API Worker WITHOUT deployment
        working-directory: worker
        shell: bash
        run: |
          npm install --no-package-lock --no-audit --no-fund
          npx wrangler deploy --dry-run --outdir ../.r153-api-build
      - name: Test and build-check isolated KIS collector WITHOUT deployment
        working-directory: collector
        shell: bash
        run: |
          npm install --no-package-lock --no-audit --no-fund
          npm test
          npx wrangler deploy --dry-run --outdir ../.r153-collector-build
      - name: Commit reviewed sources, only when explicitly approved
        if: ${{{{ inputs.apply_changes }}}}
        shell: bash
        run: |
          set -euo pipefail
          git add scripts/blue_r153_install.py worker/src/performance.ts collector/src/basket.mjs web/src/r153-performance.css tests/test_r153.mjs \\
            web/src/main.tsx web/src/SmartBasket.tsx worker/src/index.ts collector/src/index.mjs collector/src/core.mjs collector/wrangler.jsonc
          if git diff --cached --quiet; then
            echo 'R153_ALREADY_APPLIED'
          else
            git config user.name 'BLUE R1.5.3 installer'
            git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
            git commit -m 'BLUE R1.5.3: verified basket performance queue and single bottom navigation'
            git push origin HEAD:main
          fi
      - name: Report safe deployment sequence
        shell: bash
        run: |
          echo 'R153_TEST_AND_BUILD_SUCCESS'
          echo 'If apply_changes=false, rerun with true to commit.'
          echo 'When committed, deploy API using blue_kis_r14_deploy_api.yml and collector using blue_r142_collector_deploy.yml deploy=true.'
          echo 'Frontend Cloudflare Git integration must also deploy. Check KIS token cache status; data is NOT guaranteed within 2 minutes.'
"""
path=root/'.github/workflows/blue_r153_basket_performance.yml';path.write_text(workflow,encoding='utf-8')
(Path('/mnt/data')/'blue_r153_basket_performance.yml').write_text(workflow,encoding='utf-8')
print('Generated',path,'size',path.stat().st_size,'payload sha',sha)
