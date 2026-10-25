"""Verify the configured owner's real memory binding using one temporary, non-personal marker.

Writes with infer=none, recalls, and erases only this run's unique scope. No profile
or processing consent is changed; no existing memory text or credentials are printed.
"""

import argparse
import json
import uuid

from surrealdb.memory import MemoryAPIError, MemoryServiceError

from app.config import load_settings
from app.memory import preference_scope
from app.rhythm.config import RhythmSettings
from app.rhythm.memory import Registry


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--user", help="Defaults to SPECTRON_OWNER_USER_ID; must already have a binding.")
    args = parser.parse_args()
    settings = load_settings()
    rhythm = RhythmSettings.load()
    user = args.user or settings.spectron_owner_user_id
    registry = Registry(
        rhythm.memory_contexts_json, settings.spectron_url, settings.spectron_context_id,
        app_api_key=settings.spectron_api_key, app_user_id=settings.spectron_owner_user_id,
    )
    try:
        binding = registry.services.get(user)
        if binding is None:
            raise SystemExit("No Context is assigned to the requested account.")
        service = binding[1]
        legacy = registry.legacy_services[user]
        marker_id = uuid.uuid4().hex
        marker = f"Rhythm connection verification marker {marker_id}."
        scope = preference_scope(user, marker_id, root=service.scope_root)
        observed = {"bindingConfigured": True, "write": False, "recall": False,
                    "eraseAcknowledged": False, "erase": False,
                    "legacyRecallSeparated": False, "otherUserBlocked": False}
        errors = []

        def check(name, action):
            try:
                value = action()
                observed[name] = value if isinstance(value, bool) else True
            except MemoryServiceError as error:
                errors.append({"step": name, "statusCode": getattr(error, "status_code", None)})

        try:
            check("write", lambda: service.remember_confirmed(user, marker_id, marker))
            if observed["write"]:
                check("recall", lambda: any(marker_id in fact.text for fact in service.recall(user, marker, k=3)))
                check("legacyRecallSeparated", lambda: not any(marker_id in fact.text for fact in legacy.recall(user, marker, k=3)))
            foreign = "user_RhythmUnassigned" if user != "user_RhythmUnassigned" else "user_RhythmOther"
            try:
                service.recall(foreign, marker)
            except MemoryAPIError as error:
                observed["otherUserBlocked"] = error.status_code == 403
        finally:
            # Even an uncertain write timeout gets an erase attempt under this run's exact scope.
            check("eraseAcknowledged", lambda: service.forget_scope(user, scope))
            check("erase", lambda: not any(marker_id in fact.text for fact in service.recall(user, marker, k=3)))
        print(json.dumps({**observed, "errors": errors, **({"cleanupScope": scope} if not observed["eraseAcknowledged"] else {})}, indent=2))
        if not all(observed.values()):
            raise SystemExit("A memory check did not pass; see the boolean results above.")
    finally:
        registry.close()


if __name__ == "__main__":
    main()
