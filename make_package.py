from pathlib import Path
from io import BytesIO
from zipfile import ZipFile, ZIP_DEFLATED
import base64,hashlib,textwrap
base=Path('/mnt/data/BLUE_R158_Long_Watch')
script=base/'blue_r158_apply.py'
css=base/'r158-long-watch.css'
yaml=Path('/mnt/data/blue_r158_protected_watchlist.yml')

buf=BytesIO()
with ZipFile(buf,'w',compression=ZIP_DEFLATED,compresslevel=9) as z:
    z.writestr('scripts/blue_r158_apply.py',script.read_text())
    z.writestr('web/src/r158-long-watch.css',css.read_text())
payload=buf.getvalue()
digest=hashlib.sha256(payload).hexdigest()
payload_lines='\n'.join(' '*10+s for s in textwrap.wrap(base64.b64encode(payload).decode(),100))

text=f"""name: BLUE R1.5.8 Protected Long-term Basket (MANUAL)
on:
  workflow_dispatch:
    inputs:
      apply_changes:
        description: 'FALSE test only; TRUE commit protected basket UI and 120-queue capacity to main'
        type: boolean
        required: true
        default: false
permissions:
  contents: write
concurrency:
  group: blue-r158-protected-watchlist
  cancel-in-progress: false
jobs:
  validate_and_optional_apply:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - name: Confirm correct repository and branch
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
      - name: Restore SHA-verified R1.5.8 patch and CSS (no external downloads)
        shell: bash
        run: |
          python - <<'PYRESTORE'
          import base64,hashlib
          from io import BytesIO
          from pathlib import Path
          from zipfile import ZipFile
          payload=base64.b64decode(''.join('''
{payload_lines}
          '''.split()),validate=True)
          assert hashlib.sha256(payload).hexdigest()=='{digest}', 'R158_PAYLOAD_SHA_MISMATCH'
          with ZipFile(BytesIO(payload)) as z:
              expected={{'scripts/blue_r158_apply.py','web/src/r158-long-watch.css'}}
              assert set(z.namelist())==expected, 'R158_UNEXPECTED_PAYLOAD'
              for name in sorted(expected):
                  raw=z.read(name)
                  f=Path(name)
                  if f.exists():
                      assert f.read_bytes()==raw, 'R158_EXISTING_FILE_MISMATCH '+name
                  else:
                      f.parent.mkdir(parents=True,exist_ok=True)
                      f.write_bytes(raw)
                  print('R158_RESTORED',name)
          PYRESTORE
      - name: Confirm R1.5.7 anchors and apply reviewed limited patch
        shell: bash
        run: |
          set -euo pipefail
          python scripts/blue_r158_apply.py --check
          python scripts/blue_r158_apply.py --apply
          python - <<'PYVERIFY'
          from pathlib import Path
          s=Path('web/src/SmartBasket.tsx').read_text()
          w=Path('worker/src/performance.ts').read_text()
          css=Path('web/src/r158-long-watch.css').read_text()
          assert 'R158_LONGTERM' in s
          assert 'MAX_REGULAR=100, MAX_PROTECTED=20' in s
          assert "import './r158-long-watch.css';" in s
          assert 'protected?:boolean' in s and 'x.protected||!ids.has(x.id)' in s
          assert '원래' not in css
          assert "length>=120)" in w and "length>=80)" not in w
          print('R158_PROTECTION_AND_QUOTA_STATIC_PASS')
          PYVERIFY
      - name: Existing AI basket regression tests
        shell: bash
        run: |
          set -euo pipefail
          node --test tests/test_basket_r15.mjs
      - name: Compile and build React web app
        working-directory: web
        shell: bash
        run: |
          set -euo pipefail
          npm install --no-package-lock --no-audit --no-fund
          npm run build
      - name: Check API Worker build without deploy
        working-directory: worker
        shell: bash
        run: |
          set -euo pipefail
          npm install --no-package-lock --no-audit --no-fund
          npx wrangler deploy --dry-run --outdir ../.r158-api-build
      - name: Restrict changed tracked files to approved modules
        shell: bash
        run: |
          python - <<'PYFILES'
          import subprocess
          changed=set(filter(None,subprocess.check_output(['git','diff','--name-only'],text=True).splitlines()))
          allowed={{'web/src/SmartBasket.tsx','worker/src/performance.ts'}}
          if not changed.issubset(allowed) or (changed and changed!=allowed):
              raise SystemExit('R158_UNEXPECTED_MODIFICATIONS '+repr(sorted(changed)))
          print('R158_CHANGED_FILES_OK', sorted(changed))
          PYFILES
      - name: Commit if user approved apply_changes
        if: ${{{{ inputs.apply_changes }}}}
        shell: bash
        run: |
          set -euo pipefail
          git config user.name 'github-actions[bot]'
          git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
          git add scripts/blue_r158_apply.py web/src/r158-long-watch.css web/src/SmartBasket.tsx worker/src/performance.ts
          if git diff --cached --quiet; then
            echo R158_ALREADY_INSTALLED
          else
            git commit -m 'BLUE R1.5.8: protected long-term basket and safe age cleanup'
            git push origin HEAD:main
          fi
      - name: Report deployment boundary
        shell: bash
        run: |
          echo R158_TESTS_AND_BUILD_PASS
          echo 'Test only: if false, rerun apply_changes=true to commit.'
          echo 'After commit, deploy existing API Worker and verify Cloudflare frontend separately. KIS Collector unchanged.'
"""
yaml.write_text(text)
with ZipFile('/mnt/data/BLUE_Signal_Lab_R158_Long_Term_Protected_Basket.zip','w',ZIP_DEFLATED,compresslevel=8) as z:
    z.write(yaml,yaml.name)
    z.write(base/'README_KO.md','README_KO.md')
    z.write(script,'scripts/blue_r158_apply.py')
    z.write(css,'web/src/r158-long-watch.css')
    z.write(base/'make_package.py','tools/make_package.py')
print('Generated',yaml,'bytes',yaml.stat().st_size,'zip',Path('/mnt/data/BLUE_Signal_Lab_R158_Long_Term_Protected_Basket.zip').stat().st_size, 'payload_sha',digest)
