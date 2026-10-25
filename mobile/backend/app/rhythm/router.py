"""Clerk-authenticated UI routes. Agents use MCP and cannot impersonate a UI confirmation."""

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request

from app.deps import CurrentUser, Db, OptionalAI
from app.rhythm import browser, data, grants, learn, memory, profile, recommendations, search, tasks, transcripts
from app.rhythm.policy import Actor, Denied, Policy, run
from app.rhythm.schemas import BrowserInput, BrowserProof, InterestsInput, RecordId, Result, ShortlistInput, TaskInput
from app.rhythm.schemas import AgentApproval, ImportedTranscript, TranscriptInput, TranscriptUpload
from app.rhythm.schemas import FeedbackInput, RecommendationsInput, SearchInput, SettingsInput, SignalInput
from app.rhythm.schemas import ChoicesInput, ForgetTopicInput, ReactionInput
from app.schemas import InputModel, Text80

router = APIRouter(prefix="/rhythm", tags=["rhythm"])


def recommendations_on(request: Request) -> None:
    if not request.app.state.rhythm_settings.recommendations:
        raise HTTPException(404, "Video recommendations are turned off.")


# Video tasks, page grants, search and recommendations: only while RHYTHM_RECOMMENDATIONS is on.
videos = APIRouter(prefix="/rhythm", tags=["rhythm"], dependencies=[Depends(recommendations_on)])


@router.get("/interests", response_model=Result)
def get_interests(request: Request, user: CurrentUser):
    return run(request.app, Actor(user.user_id), profile.get_interests)


@router.put("/interests", response_model=Result)
def save_interests(body: InterestsInput, request: Request, user: CurrentUser):
    result = run(request.app, Actor(user.user_id), lambda p: profile.save_interests(p, body))
    if result.status == "ok":
        result.memory_status = memory.synchronize(request.app, user.user_id)
    return result


@router.put("/settings", response_model=Result)
def save_settings(body: SettingsInput, request: Request, user: CurrentUser, ai: OptionalAI, background: BackgroundTasks):
    """The user's switches. Interests are learned from activity, not typed in."""
    result = run(request.app, Actor(user.user_id), lambda p: profile.save_settings(p, body))
    if result.status == "ok":
        result.memory_status = memory.synchronize(request.app, user.user_id)
        if body.consent.learn:
            background.add_task(learn.refresh, request.app, user.user_id, ai, force=True)
    return result


@router.post("/signals", response_model=Result)
def add_signal(body: SignalInput, request: Request, user: CurrentUser, ai: OptionalAI, background: BackgroundTasks):
    """A watched fitness, health or food video, sent by the user's own extension once learning is on."""
    result = run(request.app, Actor(user.user_id), lambda p: learn.record(p, body))
    if result.status == "ok":
        background.add_task(learn.refresh, request.app, user.user_id, ai)
    return result


@router.post("/reactions", response_model=Result)
def add_reaction(body: ReactionInput, request: Request, user: CurrentUser, ai: OptionalAI, background: BackgroundTasks):
    """"Save to Rhythm" or "Not interested" on the current video, from the side panel."""
    result = run(request.app, Actor(user.user_id), lambda p: learn.react(p, body))
    if result.status == "ok":
        background.add_task(learn.refresh, request.app, user.user_id, ai, force=True)
    return result


@router.get("/learned", response_model=Result)
def learned_interests(request: Request, user: CurrentUser):
    """What Rhythm learned, the evidence for it, the user's own choices and any "You've watched…" suggestion."""
    return run(request.app, Actor(user.user_id), learn.view)


@router.put("/choices", response_model=Result)
def save_choices(body: ChoicesInput, request: Request, user: CurrentUser, ai: OptionalAI, background: BackgroundTasks):
    """Pins, blocks, answered prompts and the user's own level/length/equipment. They always win over inference."""
    result = run(request.app, Actor(user.user_id), lambda p: learn.save_choices(p, body))
    if result.status == "ok":
        background.add_task(learn.refresh, request.app, user.user_id, ai, force=True)
    return result


@router.post("/forget", response_model=Result)
def forget_topic(body: ForgetTopicInput, request: Request, user: CurrentUser, ai: OptionalAI, background: BackgroundTasks):
    """"Forget this": delete the stored videos behind one interest and stop counting earlier chats about it."""
    result = run(request.app, Actor(user.user_id), lambda p: learn.forget_topic(p, body))
    if result.status == "ok":
        background.add_task(learn.refresh, request.app, user.user_id, ai, force=True)
    return result


@videos.get("/metrics", response_model=Result)
def metrics(request: Request, user: CurrentUser):
    return run(request.app, Actor(user.user_id), profile.metrics)


@router.get("/connections", response_model=Result)
def connections(request: Request, user: CurrentUser):
    return run(request.app, Actor(user.user_id), grants.connections)


@router.post("/agents/{agent_id}/approve", response_model=Result)
def approve_agent(agent_id: str, body: AgentApproval, request: Request, user: CurrentUser):
    return run(request.app, Actor(user.user_id), lambda p: grants.approve(p, agent_id, body))


@router.delete("/agents/{agent_id}", response_model=Result)
def revoke_agent(agent_id: str, request: Request, user: CurrentUser):
    return run(request.app, Actor(user.user_id), lambda p: grants.revoke(p, agent_id))


class AgentTokenInput(AgentApproval):
    label: Text80


@router.post("/agents/token")
def create_agent_token(body: AgentTokenInput, request: Request, user: CurrentUser, db: Db):
    try:
        token, agent = grants.mint_token(Policy(db, Actor(user.user_id), request.app.state.rhythm_settings), body.label, body)
        db.commit()
        return {"status": "ok", "token": token, "agent": agent.model_dump(by_alias=True)}
    except Denied as exc:
        db.rollback()
        return Result(status=exc.status, message=exc.message)


@videos.post("/browsers", response_model=Result)
def permit_page(body: BrowserInput, request: Request, user: CurrentUser):
    return run(request.app, Actor(user.user_id), lambda p: browser.permit(p, body))


@videos.delete("/browsers/{browser_id}", response_model=Result)
def pause_browser(browser_id: str, request: Request, user: CurrentUser):
    return run(request.app, Actor(user.user_id), lambda p: browser.pause(p, browser_id))


@videos.post("/browsers/{browser_id}/disconnect", response_model=Result)
def disconnect_browser(browser_id: str, request: Request, user: CurrentUser):
    return run(request.app, Actor(user.user_id), lambda p: browser.pause(p, browser_id, revoke=False))


@videos.post("/browsers/{browser_id}/poll", response_model=Result)
def poll_browser(browser_id: str, body: BrowserProof, request: Request, user: CurrentUser):
    return run(request.app, Actor(user.user_id), lambda p: transcripts.poll(p, browser_id, body))


@videos.post("/tasks", response_model=Result)
def create_task(body: TaskInput, request: Request, user: CurrentUser):
    return run(request.app, Actor(user.user_id), lambda p: tasks.create(p, body))


@videos.get("/tasks", response_model=Result)
def list_tasks(request: Request, user: CurrentUser):
    return run(request.app, Actor(user.user_id), tasks.list_tasks)


@videos.get("/tasks/{task_id}", response_model=Result)
def task_status(task_id: str, request: Request, user: CurrentUser):
    return run(request.app, Actor(user.user_id), lambda p: tasks.status(p, task_id))


@videos.post("/tasks/{task_id}/approve", response_model=Result)
def approve_task(task_id: str, request: Request, user: CurrentUser):
    return run(request.app, Actor(user.user_id), lambda p: tasks.approve(p, task_id))


@videos.delete("/tasks/{task_id}", response_model=Result)
def cancel_task(task_id: str, request: Request, user: CurrentUser):
    return run(request.app, Actor(user.user_id), lambda p: tasks.cancel(p, task_id))


class SelectedInput(InputModel):
    browser_session_id: RecordId


@videos.post("/tasks/{task_id}/selected", response_model=Result)
def add_selected(task_id: str, body: SelectedInput, request: Request, user: CurrentUser):
    return run(request.app, Actor(user.user_id), lambda p: tasks.add_selected(p, task_id, body.browser_session_id))


@videos.post("/tasks/{task_id}/shortlist", response_model=Result)
def shortlist(task_id: str, body: ShortlistInput, request: Request, user: CurrentUser):
    return run(request.app, Actor(user.user_id), lambda p: tasks.shortlist(p, task_id, body))


@videos.post("/tasks/{task_id}/candidates/{candidate_id}/transcript", response_model=Result)
def get_transcript(task_id: str, candidate_id: str, body: TranscriptInput, request: Request, user: CurrentUser):
    return run(request.app, Actor(user.user_id), lambda p: transcripts.request(p, task_id, candidate_id, body))


@videos.post("/tasks/{task_id}/candidates/{candidate_id}/import", response_model=Result)
def import_transcript(task_id: str, candidate_id: str, body: ImportedTranscript, request: Request, user: CurrentUser):
    return run(request.app, Actor(user.user_id), lambda p: transcripts.import_text(p, task_id, candidate_id, body))


@videos.post("/browsers/{browser_id}/requests/{request_id}/claim", response_model=Result)
def claim_request(browser_id: str, request_id: str, body: BrowserProof, request: Request, user: CurrentUser):
    return run(request.app, Actor(user.user_id), lambda p: transcripts.claim(p, browser_id, request_id, body))


@videos.post("/browsers/{browser_id}/requests/{request_id}/complete", response_model=Result)
def complete_request(browser_id: str, request_id: str, body: TranscriptUpload, request: Request, user: CurrentUser):
    return run(request.app, Actor(user.user_id), lambda p: transcripts.complete(p, browser_id, request_id, body))


@videos.delete("/browsers/{browser_id}/requests/{request_id}", response_model=Result)
def cancel_request(browser_id: str, request_id: str, request: Request, user: CurrentUser):
    return run(request.app, Actor(user.user_id), lambda p: transcripts.cancel(p, browser_id, request_id))


@videos.post("/tasks/{task_id}/search", response_model=Result)
def search_videos(task_id: str, body: SearchInput, request: Request, user: CurrentUser):
    return search.search(request.app, Actor(user.user_id), task_id, body)


@videos.post("/tasks/{task_id}/recommendations", response_model=Result)
def show_recommendations(task_id: str, body: RecommendationsInput, request: Request, user: CurrentUser):
    return run(request.app, Actor(user.user_id), lambda p: recommendations.publish(p, task_id, body))


@videos.get("/recommendations", response_model=Result)
def saved_recommendations(request: Request, user: CurrentUser):
    return run(request.app, Actor(user.user_id), recommendations.list_saved)


@videos.post("/recommendations/{recommendation_id}/feedback", response_model=Result)
def feedback(recommendation_id: str, body: FeedbackInput, request: Request, user: CurrentUser):
    result = run(request.app, Actor(user.user_id), lambda p: recommendations.feedback(p, recommendation_id, body))
    if result.status == "ok":
        result.memory_status = memory.synchronize(request.app, user.user_id)
    return result


@videos.post("/recommendations/{recommendation_id}/displayed", response_model=Result)
def displayed(recommendation_id: str, body: SelectedInput, request: Request, user: CurrentUser):
    return run(request.app, Actor(user.user_id), lambda p: recommendations.displayed(p, recommendation_id, body.browser_session_id))


@router.get("/memories", response_model=Result)
def memories(request: Request, user: CurrentUser):
    result = run(request.app, Actor(user.user_id), memory.list_memories)
    result.memory_status = memory.synchronize(request.app, user.user_id)
    return result


@router.post("/memories/{memory_id}/approve", response_model=Result)
def approve_memory(memory_id: str, request: Request, user: CurrentUser):
    result = run(request.app, Actor(user.user_id), lambda p: memory.approve(p, memory_id))
    if result.status == "ok":
        result.memory_status = memory.synchronize(request.app, user.user_id)
    return result


@router.delete("/memories/{memory_id}", response_model=Result)
def delete_memory(memory_id: str, request: Request, user: CurrentUser):
    result = run(request.app, Actor(user.user_id), lambda p: memory.remove(p, memory_id))
    if result.status == "ok":
        result.memory_status = memory.synchronize(request.app, user.user_id)
    return result


@router.delete("/data", response_model=Result)
def delete_rhythm_data(request: Request, user: CurrentUser):
    return data.erase(request.app, user.user_id)
