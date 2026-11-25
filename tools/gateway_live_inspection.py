"""Read-only diagnosis of live Worker deployments. No raw metadata or credentials are logged."""
import json
import os
import re
import urllib.request
import urllib.error
from urllib.parse import urlsplit
from tools.gateway_binding_preflight import frontend_state

API="blue-signal-lab-api-v2"
WEB="blue-signal-lab"
SOURCES={"unknown","api","wrangler","terraform","dash","cf_cli","dash_template","integration","quick_editor","playground","workersci"}
UUID=r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def source(value):
    return value if isinstance(value,str) and value in SOURCES else "UNREPORTED"

def date(value):
    return value if isinstance(value,str) and re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z",value) else "UNREPORTED"

def version_id(value):
    if not isinstance(value,str) or not re.fullmatch(UUID,value):
        raise ValueError("invalid version ID")
    return value

def summary_bindings(worker, bindings):
    if not isinstance(bindings,list) or any(not isinstance(b,dict) for b in bindings):
        return {"metadata":"UNREPORTED"}
    if worker==WEB:
        try:
            state=frontend_state(bindings)
        except ValueError:
            state="UNEXPECTED_BINDING"
        # No raw names or values. Only exact expected bindings and counts.
        return {"metadata":"REPORTED","gateway":state,"binding_count":len(bindings),
                "assets_present":any(b.get("type")=="assets" for b in bindings)}
    return {"metadata":"REPORTED","binding_count":len(bindings),
            "db":any(b.get("name")=="DB" and b.get("type")=="d1" for b in bindings),
            "collector":any(b.get("name")=="KIS_COLLECTOR" and b.get("type")=="service" for b in bindings),
            "access_team_present":any(b.get("name")=="BLUE_WEB_ACCESS_TEAM" and b.get("type")=="plain_text" for b in bindings),
            "access_aud_present":any(b.get("name")=="BLUE_WEB_ACCESS_AUD" and b.get("type")=="plain_text" for b in bindings)}

def history(result):
    records=result.get("deployments")
    if not isinstance(records,list) or not records:
        raise ValueError("deployment history missing")
    if any(not isinstance(d,dict) or date(d.get("created_on"))=="UNREPORTED" for d in records):
        raise ValueError("invalid deployment dates")
    out=[]
    for d in sorted(records,key=lambda d:d["created_on"],reverse=True)[:5]:
        versions=d.get("versions")
        if not isinstance(versions,list) or not versions:
            raise ValueError("deployment versions missing")
        safe=[]
        for v in versions:
            pct=v.get("percentage")
            if type(pct) not in (int,float) or not 0<=pct<=100:
                raise ValueError("invalid traffic percentage")
            safe.append({"id":version_id(v.get("version_id")),"percentage":pct})
        out.append({"created_on":date(d.get("created_on")),"source":source(d.get("source")),"versions":safe})
    return out

def version_summary(worker,detail,expected):
    if detail.get("id")!=expected:
        raise ValueError("version mismatch")
    resources=detail.get("resources")
    if not isinstance(resources,dict):
        raise ValueError("missing version resources")
    metadata=detail.get("metadata") or {}
    script=resources.get("script") or {}
    runtime=resources.get("script_runtime") or {}
    exports=runtime.get("exports") or {}
    named=script.get("named_handlers")
    entry=exports.get("BlueWebGateway") if isinstance(exports,dict) else None
    return {"id":expected,"source":source(metadata.get("source")),"created_on":date(metadata.get("created_on")),
            "bindings":summary_bindings(worker,resources.get("bindings")),
            "gateway_export":bool((isinstance(entry,dict) and entry.get("type")=="worker") or
                                  (isinstance(named,list) and any(isinstance(h,dict) and h.get("name")=="BlueWebGateway" for h in named))),
            "export_metadata_present":isinstance(named,list) or bool(exports)}

def probe(opener,url):
    """Unauthenticated GET; never follow redirects or read response body."""
    try:
        response=opener.open(urllib.request.Request(url,method="GET"),timeout=15)
    except urllib.error.HTTPError as e:
        response=e
    except Exception:
        return {"status":"UNREACHABLE","access":"UNVERIFIED"}
    try:
        status=response.code
        loc=response.headers.get("Location","")
        if status in (301,302,303,307,308):
            try:
                host=urlsplit(loc).hostname or ""
            except ValueError:
                host=""
            access="ACCESS_LOGIN_REDIRECT" if host.endswith(".cloudflareaccess.com") else "OTHER_REDIRECT"
        elif status in (401,403):
            access="UNAUTHENTICATED_DENIED"
        elif 200<=status<300:
            access="UNEXPECTED_UNAUTHENTICATED_SUCCESS"
        else:
            access="UNVERIFIED"
        return {"status":status,"access":access}
    finally:
        response.close()

def main():
    token=os.environ.get("CLOUDFLARE_API_TOKEN","")
    account=os.environ.get("CLOUDFLARE_ACCOUNT_ID","")
    if not token or not re.fullmatch(r"[a-f0-9]{32}",account):
        raise SystemExit("INSPECTION_BLOCKED: missing/invalid account credentials")
    opener=urllib.request.build_opener(NoRedirect())
    def get(worker,endpoint):
        url=f"https://api.cloudflare.com/client/v4/accounts/{account}/workers/scripts/{worker}/{endpoint}"
        req=urllib.request.Request(url,headers={"Authorization":"Bearer "+token},method="GET")
        try:
            with opener.open(req,timeout=20) as res:
                raw=json.load(res)
        except urllib.error.HTTPError as e:
            raise ValueError(f"Cloudflare GET failed HTTP {e.code}") from None
        except Exception:
            raise ValueError("Cloudflare GET failed") from None
        if raw.get("success") is not True or not isinstance(raw.get("result"),dict):
            raise ValueError("invalid Cloudflare response")
        return raw["result"]
    errors=[]
    for worker in (API,WEB):
        try:
            settings=get(worker,"settings")
            records=history(get(worker,"deployments"))
            print("BLUE_LIVE_HISTORY",worker,json.dumps(records))
            print("BLUE_LIVE_SETTINGS",worker,json.dumps(summary_bindings(worker,settings.get("bindings"))))
            for v in records[0]["versions"]:
                report=version_summary(worker,get(worker,"versions/"+v["id"]),v["id"])
                print("BLUE_LIVE_ACTIVE_VERSION",worker,json.dumps(report))
        except ValueError as e:
            # All raised messages above are fixed strings or numeric HTTP status.
            print("BLUE_LIVE_INSPECTION_INCOMPLETE",worker,str(e) if str(e).startswith("Cloudflare GET failed") else "invalid/incomplete metadata")
            errors.append(worker)
        except Exception:
            print("BLUE_LIVE_INSPECTION_INCOMPLETE",worker,"invalid/incomplete metadata")
            errors.append(worker)
    for worker in (WEB,API):
        result=probe(opener,f"https://{worker}.ehdud6728.workers.dev/api/eod/dates")
        print("BLUE_LIVE_ANONYMOUS_PROBE",worker,json.dumps(result))
        if result["access"] not in ("ACCESS_LOGIN_REDIRECT","UNAUTHENTICATED_DENIED"):
            errors.append(worker)
    print("BLUE_LIVE_INSPECTION_READ_ONLY; authenticated browser and DB results remain unverified")
    if errors:
        raise SystemExit("INSPECTION_INCOMPLETE_OR_ACCESS_WARNING")
if __name__=="__main__":
    main()
