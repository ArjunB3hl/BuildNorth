"""Verify shared-Context isolation with two temporary, non-personal fixture identities.

Uses the existing Context only. Writes infer=none markers, checks scoped recall and
bound-service authorization, and erases only this run's exact marker scopes. This
checks the live memory service, not Clerk sign-in (covered separately by API tests).
"""

import argparse
import json
import uuid

from surrealdb.memory import Memory, MemoryAPIError, MemoryServiceError

from app.config import load_settings
from app.memory import MemoryService, preference_scope
from app.rhythm.memory import Registry


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--shared-preview", action="store_true",
                        help="Test shared mode before removing the deployed owner restriction; does not change configuration.")
    args = parser.parse_args()
    settings = load_settings()
    if not settings.memory_configured:
        raise SystemExit("SPECTRON_URL, SPECTRON_CONTEXT_ID and SPECTRON_API_KEY are required.")
    if settings.spectron_owner_user_id and not args.shared_preview:
        raise SystemExit("Owner restriction is set. Use --shared-preview to test shared mode without changing configuration.")
    marker_id = uuid.uuid4().hex
    users = [f"user_RhythmVerify{letter}{marker_id}" for letter in ("A", "B")]
    registry = Registry("", settings.spectron_url, settings.spectron_context_id,
                        app_api_key=settings.spectron_api_key)
    client = Memory(settings.spectron_context_id, endpoint=settings.spectron_url,
                    api_key=settings.spectron_api_key, timeout=20, max_retries=0)
    root = MemoryService(client, shared_context=True)
    checks, errors, cleanup = {}, [], []

    def record(name, action):
        try:
            checks[name] = bool(action())
        except MemoryServiceError as error:
            checks[name] = False
            errors.append({"step": name, "statusCode": getattr(error, "status_code", None)})

    def blocked(action):
        try:
            action()
        except MemoryAPIError as error:
            return error.status_code == 403
        return False

    try:
        for feature in ("app", "interests"):
            services = [root.bound_to(u) if feature == "app" else registry.for_user(u)[1] for u in users]
            texts = [f"Rhythm isolation test {marker_id}, {feature}, fixture {i}." for i in range(2)]
            scopes = []
            for i, (user, service, text) in enumerate(zip(users, services, texts)):
                scope = preference_scope(user, marker_id, root=service.scope_root)
                scopes.append(scope)
                cleanup.append((feature, i, user, service, scope, text))
                def write(service=service, user=user, text=text):
                    if feature == "app":
                        service.remember_preference(user, marker_id, text)
                    else:
                        service.remember_confirmed(user, marker_id, text)
                    return True
                record(f"{feature}.write{i}", write)
            for i, (user, service) in enumerate(zip(users, services)):
                def recall(i=i, user=user, service=service):
                    hits = [f.text for f in service.recall(user, " ".join(texts), k=8)]
                    return texts[i] in hits and texts[1 - i] not in hits
                record(f"{feature}.isolatedRecall{i}", recall)
                record(f"{feature}.forgedIdentity{i}", lambda i=i, service=service:
                       blocked(lambda: service.recall(users[1 - i], texts[1 - i])))
                record(f"{feature}.forgedErase{i}", lambda i=i, service=service:
                       blocked(lambda: service.forget_scope(users[1 - i], scopes[1 - i])))
            def erase_one():
                services[0].forget_scope(users[0], scopes[0])
                a = [f.text for f in services[0].recall(users[0], texts[0], k=8)]
                b = [f.text for f in services[1].recall(users[1], texts[1], k=8)]
                return texts[0] not in a and texts[1] in b
            record(f"{feature}.eraseKeepsOtherUser", erase_one)
    finally:
        unresolved = []
        for feature, i, user, service, scope, text in cleanup:
            def erase(user=user, service=service, scope=scope, text=text):
                service.forget_scope(user, scope)
                return not any(text == f.text for f in service.recall(user, text, k=8))
            name = f"{feature}.cleanup{i}"
            record(name, erase)
            if not checks[name]:
                unresolved.append(scope)
        registry.close()
        client.close()
        print(json.dumps({"checks": checks, "errors": errors,
                          "unresolvedCleanupScopes": unresolved}, indent=2))
    if not checks or not all(checks.values()):
        raise SystemExit("A shared memory check failed; see results above.")


if __name__ == "__main__":
    main()
