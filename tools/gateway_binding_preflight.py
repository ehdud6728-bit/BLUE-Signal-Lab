"""Read-only frontend service binding preflight. Never print binding values."""
EXPECTED_SERVICE="blue-signal-lab-api-v2"
EXPECTED_ENTRYPOINT="BlueWebGateway"

def frontend_state(bindings):
    if not isinstance(bindings,list) or any(not isinstance(b,dict) for b in bindings):
        raise ValueError("BLOCKED: invalid frontend binding metadata")
    seen=False
    exact=False
    for b in bindings:
        if b.get("type") in ("assets","version_metadata"):
            continue
        if b.get("name")!="BLUE_API" or b.get("type")!="service" or b.get("service")!=EXPECTED_SERVICE or seen:
            raise ValueError("BLOCKED: unexpected frontend binding")
        seen=True
        entry=b.get("entrypoint")
        if entry not in (None,"",EXPECTED_ENTRYPOINT):
            raise ValueError("BLOCKED: unexpected frontend service entrypoint")
        exact=entry==EXPECTED_ENTRYPOINT
    return "EXACT" if exact else "ENTRYPOINT_UNREPORTED" if seen else "ABSENT"

def routine_decision(settings,version,mode):
    a=frontend_state(settings)
    if a=="EXACT" and version is None:
        return "VERIFIED_SETTINGS"
    b=frontend_state(version)
    if b=="EXACT":
        return "VERIFIED_ACTIVE_VERSION"
    if mode=="deploy_api_and_web":
        # Both Workers will be deployed with the exact repository binding.
        # This is an explicit repair, not evidence the existing binding is correct.
        return "REBUILD_FULL_DEPLOY"
    raise ValueError("BLOCKED: routine deployment requires existing same-origin service binding")
