from components.feedback_analytics import analytics_blueprint
import sys
import time
import os
startup_start = time.time()

# Load environment variables from .env file
from dotenv import load_dotenv
load_dotenv()  # Loads SERVICENOW_INSTANCE, SERVICENOW_USER, SERVICENOW_PASSWORD, etc.

if os.getenv("SNOWCHAT_DIAG"):
    print(f"[DIAG] Startup: Beginning app.py at {startup_start}", file=sys.stderr)

from flask import Flask, Blueprint, request, jsonify
startup_after_flask = time.time()
if os.getenv("SNOWCHAT_DIAG"):
    print(f"[DIAG] Startup: After Flask import at {startup_after_flask} (+{startup_after_flask-startup_start:.2f}s)", file=sys.stderr)

from flask_cors import CORS
startup_after_cors = time.time()
if os.getenv("SNOWCHAT_DIAG"):
    print(f"[DIAG] Startup: After flask_cors import at {startup_after_cors} (+{startup_after_cors-startup_start:.2f}s)", file=sys.stderr)

import importlib
startup_after_importlib = time.time()
if os.getenv("SNOWCHAT_DIAG"):
    print(f"[DIAG] Startup: After importlib import at {startup_after_importlib} (+{startup_after_importlib-startup_start:.2f}s)", file=sys.stderr)

startup_after_os = time.time()
if os.getenv("SNOWCHAT_DIAG"):
    print(f"[DIAG] Startup: After os import at {startup_after_os} (+{startup_after_os-startup_start:.2f}s)", file=sys.stderr)

from tinydb import TinyDB, Query
startup_after_tinydb = time.time()
if os.getenv("SNOWCHAT_DIAG"):
    print(f"[DIAG] Startup: After tinydb import at {startup_after_tinydb} (+{startup_after_tinydb-startup_start:.2f}s)", file=sys.stderr)

from datetime import datetime
startup_after_datetime = time.time()
if os.getenv("SNOWCHAT_DIAG"):
    print(f"[DIAG] Startup: After datetime import at {startup_after_datetime} (+{startup_after_datetime-startup_start:.2f}s)", file=sys.stderr)

from components.CustomWikiRAG import CustomWikiRAG
startup_after_customwikirag = time.time()
if os.getenv("SNOWCHAT_DIAG"):
    print(f"[DIAG] Startup: After CustomWikiRAG import at {startup_after_customwikirag} (+{startup_after_customwikirag-startup_start:.2f}s)", file=sys.stderr)

from langsmith import trace
startup_after_langsmith = time.time()
if os.getenv("SNOWCHAT_DIAG"):
    print(f"[DIAG] Startup: After langsmith import at {startup_after_langsmith} (+{startup_after_langsmith-startup_start:.2f}s)", file=sys.stderr)

from components.agentic_orchestrator_api import agentic_blueprint
from components.generic_tool_orchestrator import feedback_bp
from components.code_indexer import code_blueprint
from components.insuretechApis import insuretech_bp
from components.auth_api import auth_bp
from components.applications_api import applications_bp
from components.mapping_api import mapping_bp
from components.mapper_bridge_api import mapper_bridge_bp
from components.mapping_projects_api import mapping_projects_bp
from components.lamapper_api import lamapper_bp
startup_after_orchestrator_api = time.time()
if os.getenv("SNOWCHAT_DIAG"):
    print(f"[DIAG] Startup: After agentic_orchestrator_api import at {startup_after_orchestrator_api} (+{startup_after_orchestrator_api-startup_start:.2f}s)", file=sys.stderr)

import logging, json
from typing import Any, Dict
from werkzeug.exceptions import HTTPException
startup_after_logging = time.time()
if os.getenv("SNOWCHAT_DIAG"):
    print(f"[DIAG] Startup: After logging import at {startup_after_logging} (+{startup_after_logging-startup_start:.2f}s)", file=sys.stderr)

# Define the blueprint with a unique name
blueprint = Blueprint("snowaaone_unique", __name__)

# Example route
@blueprint.route("/example", methods=["GET"])
def example_route():
    return {"message": "This is an example route from snowaaone."}

# Configure logging to file only (console output disabled for cleaner development experience)
log_formatter = logging.Formatter('%(asctime)s %(levelname)s %(name)s: %(message)s')
file_handler = logging.FileHandler('snowchat_backend.log', mode='a', encoding='utf-8')
file_handler.setFormatter(log_formatter)
file_handler.setLevel(logging.INFO)

# Console handler disabled - all logs go to files only
# console_handler = logging.StreamHandler(sys.stdout)
# console_handler.setFormatter(log_formatter)
# console_handler.setLevel(logging.CRITICAL)  # Only show critical errors in console

logger = logging.getLogger("agentic_orchestrator_auto")  # unify all backend logs into orchestrator file
logger.setLevel(logging.INFO)
if not logger.hasHandlers():
    logger.addHandler(file_handler)
    # logger.addHandler(console_handler)  # Disabled - check agentic_orchestrator_auto.log instead

# Initialize the main Flask app
app = Flask(__name__)
app.register_blueprint(analytics_blueprint, url_prefix="/feedback_analytics")
app.register_blueprint(feedback_bp)

# Enable CORS on app (extended for multi-port dev frontends)
_cors_origin_env = os.getenv(
    "SNOWCHAT_CORS_ORIGINS",
    "http://localhost:3000,http://localhost:8081,http://127.0.0.1:3000,http://127.0.0.1:8081",
)
_required_dev_origins = {
    "http://localhost:3000", "http://127.0.0.1:3000", 
    "http://localhost:3001", "http://127.0.0.1:3001",
    "http://localhost:8081", "http://127.0.0.1:8081"  # Ensure 8081 is always included
}
_origin_set = {o.strip() for o in _cors_origin_env.split(',') if o.strip()}
_origin_set.update(_required_dev_origins)
_cors_origins = sorted(_origin_set)

# Log CORS origins for debugging
logger.info(f"[CORS] Configured origins: {_cors_origins}")

CORS(app, supports_credentials=True, resources={
    r"/*": {
        "origins": _cors_origins,
        "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        "allow_headers": ["Content-Type", "Authorization", "Accept", "X-Requested-With", "X-IncludeVectors", "x-includevectors"],
        "expose_headers": ["Authorization", "Content-Type"],
        "max_age": 3600  # Cache preflight for 1 hour
    }
})

# Apply CORS to blueprints as well with consistent configuration
_blueprint_cors_config = {
    "supports_credentials": True,
    "origins": _cors_origins,
    "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    "allow_headers": ["Content-Type", "Authorization", "Accept", "X-Requested-With", "X-IncludeVectors", "x-includevectors"],
}

CORS(blueprint, **_blueprint_cors_config)
CORS(agentic_blueprint, **_blueprint_cors_config)
CORS(insuretech_bp, **_blueprint_cors_config)
CORS(auth_bp, **_blueprint_cors_config)
CORS(applications_bp, **_blueprint_cors_config)
CORS(mapping_bp, **_blueprint_cors_config)
CORS(mapper_bridge_bp, **_blueprint_cors_config)
CORS(mapping_projects_bp, **_blueprint_cors_config)
CORS(lamapper_bp, **_blueprint_cors_config)

# Register the blueprint
app.register_blueprint(blueprint)
app.register_blueprint(agentic_blueprint)
app.register_blueprint(code_blueprint)
app.register_blueprint(insuretech_bp)
app.register_blueprint(auth_bp)
app.register_blueprint(applications_bp)
app.register_blueprint(mapping_bp)
app.register_blueprint(mapper_bridge_bp)
app.register_blueprint(mapping_projects_bp)
app.register_blueprint(lamapper_bp, url_prefix='/api/lamapper')  # Add URL prefix for lamapper routes

# ---------------- PHASE3/PHASE4: Prompt Catalog Endpoints ----------------
# Rollback: remove this block & any related imports. Feature gated by PROMPT_CATALOG_ENABLED.
try:
    from components.prompt_catalog import get_all as prompt_get_all, get_active as prompt_get_active, catalog_health
    from components.prompt_resolver import resolve_prompt
    from components.prompt_events import get_events as prompt_get_events
except Exception:
    def prompt_get_all(): return []  # type: ignore
    def prompt_get_active(persona): return []  # type: ignore
    def catalog_health(): return {'loaded': False}
    def resolve_prompt(*a, **k): return {'matched': False, 'reason': 'import_error'}  # type: ignore
    def prompt_get_events(*a, **k): return []  # type: ignore

# Import question suggester
try:
    from components.question_suggester import initialize_question_suggester, get_question_suggestions
    QUESTION_SUGGESTER_AVAILABLE = True
except Exception as e:
    logger.warning(f"Question suggester import failed: {e}")
    QUESTION_SUGGESTER_AVAILABLE = False
    def initialize_question_suggester(*a, **k): return {'error': 'not_available'}  # type: ignore
    def get_question_suggestions(*a, **k): return []  # type: ignore

def _catalog_enabled() -> bool:
    return os.getenv('PROMPT_CATALOG_ENABLED','1').lower() in ('1','true','yes','on')

def _get_correlation_id() -> str:
    # Prefer incoming header, else generate
    cid = request.headers.get('X-Correlation-Id') or request.headers.get('X-Request-Id')
    if cid and isinstance(cid, str) and cid.strip():
        return cid.strip()[:120]
    import uuid
    return f"pc-{uuid.uuid4().hex[:12]}"

def _extract_token() -> str | None:
    auth_header = request.headers.get('Authorization','')
    if auth_header.lower().startswith('bearer '):
        return auth_header.split(' ',1)[1].strip()
    return None

def _get_roles_from_token(token: str | None) -> list[str]:
    if not token:
        return []
    try:
        from components.keycloak_persona import decode_keycloak_token, extract_roles  # type: ignore
        payload = decode_keycloak_token(token)
        if not payload:
            return []
        return extract_roles(payload)
    except Exception:
        return []

def _has_prompt_admin(token: str | None) -> bool:
    allowed_raw = os.getenv('PROMPT_CATALOG_ADMIN_ROLES','prompt_admin')
    allowed = {r.strip().lower() for r in allowed_raw.split(',') if r.strip()}
    if not allowed:
        return False
    roles = _get_roles_from_token(token)
    return any(r.lower() in allowed for r in roles)

def _sanitize_str(val, max_len: int = 500) -> str:
    s = str(val or '').strip()
    if len(s) > max_len: s = s[:max_len]
    return ''.join(ch for ch in s if ord(ch) >= 32)

def _log_flow(phase: str, message: str, **extra: Any):  # type: ignore[name-defined]
    try:
        # Inject correlation id automatically
        cid = _get_correlation_id()
        payload = {"cid": cid, **extra}
        tail = json.dumps(payload, default=str)
        logger.info(f"FLOW[{phase}] {message} | {tail}")
    except Exception:
        logger.info(f"FLOW[{phase}] {message} | serialization_failed")

@app.errorhandler(Exception)
def _global_exception_handler(exc):
    if isinstance(exc, HTTPException):
        _log_flow('HTTP_ERROR', 'HTTP exception', error=str(exc), path=request.path, status=exc.code)
        # Use jsonify() to create proper JSON response
        error_data = {'error': exc.name.replace(' ', '_').lower(), 'detail': exc.description}
        return jsonify(error_data), exc.code or 500
    _log_flow('EXCEPTION', 'Unhandled exception', error=str(exc), path=request.path)
    return jsonify({'error': 'internal_error', 'detail': str(exc)[:300]}), 500

@app.route('/prompts', methods=['GET'])
def list_prompts():
    if not _catalog_enabled():
        _log_flow('PROMPT_ENDPOINT', 'catalog_disabled', endpoint='list')
        return jsonify({'error':'catalog_disabled'}), 404
    persona = request.args.get('persona')
    active_only = request.args.get('active','false').lower() in ('1','true','yes','on')
    try:
        entries = prompt_get_active(persona) if active_only else prompt_get_all()
        # Generate summary (what/why/how) if missing
        enriched = []
        for e in entries:
            if 'summary' not in e or not e.get('summary'):
                intent = e.get('intent','')
                personas = ', '.join(e.get('personas', []))
                tools = e.get('tool_hints', [])
                keywords = e.get('activation_keywords', [])
                extractors = e.get('param_extractors', [])
                what = f"Prompt targets intent '{intent}' for personas [{personas}] using keywords {keywords}."
                why_reason = []
                if tools:
                    why_reason.append(f"tools {tools} supply structured incident/context data")
                if extractors:
                    why_reason.append(f"extractors {extractors} auto-populate arguments")
                why = 'Why: ' + (', '.join(why_reason) if why_reason else 'improves consistency and reduces manual query crafting')
                how_steps = []
                if keywords:
                    how_steps.append('keyword match scoring')
                if extractors:
                    how_steps.append('regex extraction')
                if tools:
                    how_steps.append('sequential tool execution')
                how = 'How: ' + ' -> '.join(how_steps) if how_steps else 'How: direct prompt injection'
                e['summary'] = f"{what} {why} {how}"
            enriched.append(e)
        _log_flow('PROMPT_ENDPOINT', 'list_ok', persona=persona, active_only=active_only, count=len(enriched))
        return jsonify({'prompts': enriched, 'active_only': active_only, 'persona': persona})
    except Exception as e:
        _log_flow('PROMPT_ENDPOINT', 'list_failed', error=str(e))
        return jsonify({'error':'list_failed','detail': str(e)}), 500

@app.route('/prompts/suggest', methods=['POST'])
def suggest_prompt():
    if not _catalog_enabled():
        _log_flow('PROMPT_ENDPOINT', 'catalog_disabled', endpoint='suggest')
        return jsonify({'error':'catalog_disabled'}), 404
    data = request.get_json(silent=True) or {}
    question = _sanitize_str(data.get('question'), 800)
    persona = _sanitize_str(data.get('persona'), 40) if data.get('persona') else None
    if not question:
        _log_flow('PROMPT_ENDPOINT', 'question_required')
        return jsonify({'error':'question_required'}), 400
    metadata = {}
    try:
        res = resolve_prompt(question, persona, metadata)
        _log_flow('PROMPT_ENDPOINT', 'suggest_ok', persona=persona, matched=res.get('matched'), reason=res.get('reason'))
        return jsonify({'suggestion': res, 'question': question, 'persona': persona})
    except Exception as e:
        _log_flow('PROMPT_ENDPOINT', 'suggest_failed', error=str(e))
        return jsonify({'error':'suggest_failed','detail': str(e)}), 500

@app.route('/prompts/events', methods=['GET'])
def prompt_events_list():
    if not _catalog_enabled():
        _log_flow('PROMPT_ENDPOINT', 'catalog_disabled', endpoint='events')
        return jsonify({'error':'catalog_disabled'}), 404
    kind = request.args.get('type')
    limit_raw = request.args.get('limit','50')
    try:
        limit = max(1, min(200, int(limit_raw)))
    except ValueError:
        limit = 50
    try:
        events = prompt_get_events(kind, limit=limit)
        _log_flow('PROMPT_ENDPOINT', 'events_ok', count=len(events), kind=kind, limit=limit)
        return jsonify({'events': events, 'limit': limit, 'filter_type': kind})
    except Exception as e:
        _log_flow('PROMPT_ENDPOINT', 'events_failed', error=str(e))
        return jsonify({'error':'events_failed','detail': str(e)}), 500

# ---------------- Question Suggestion Endpoints ----------------

@app.route('/question_suggestions', methods=['POST'])
def get_suggestions():
    """Get personalized question suggestions for user."""
    if not QUESTION_SUGGESTER_AVAILABLE:
        return jsonify({'error': 'question_suggester_not_available', 'suggestions': []}), 503
    
    data = request.get_json(silent=True) or {}
    persona = _sanitize_str(data.get('persona', ''), 40) or None
    limit = data.get('limit', 5)
    context = data.get('context', {})
    
    try:
        limit = max(1, min(20, int(limit)))
    except (ValueError, TypeError):
        limit = 5
    
    try:
        suggestions = get_question_suggestions(persona=persona, context=context, limit=limit)
        logger.info(f"[QuestionSuggester] Returned {len(suggestions)} suggestions for persona={persona}")
        return jsonify({
            'suggestions': suggestions,
            'persona': persona,
            'count': len(suggestions)
        })
    except Exception as e:
        logger.error(f"[QuestionSuggester] Failed to get suggestions: {e}", exc_info=True)
        return jsonify({'error': 'suggestion_failed', 'detail': str(e), 'suggestions': []}), 500

@app.route('/question_suggestions/analyze', methods=['POST'])
def trigger_analysis():
    """Manually trigger log analysis to refresh suggestions."""
    if not QUESTION_SUGGESTER_AVAILABLE:
        return jsonify({'error': 'question_suggester_not_available'}), 503
    
    # Check for admin token (optional security)
    token = _extract_token()
    if not _has_prompt_admin(token):
        logger.warning("[QuestionSuggester] Unauthorized analysis trigger attempt")
        return jsonify({'error': 'unauthorized', 'message': 'Admin role required'}), 403
    
    try:
        stats = initialize_question_suggester()
        logger.info(f"[QuestionSuggester] Manual analysis triggered: {stats}")
        return jsonify({
            'status': 'success',
            'stats': stats,
            'message': 'Log analysis completed'
        })
    except Exception as e:
        logger.error(f"[QuestionSuggester] Analysis failed: {e}", exc_info=True)
        return jsonify({'error': 'analysis_failed', 'detail': str(e)}), 500

@app.route('/question_suggestions/health', methods=['GET'])
def suggester_health():
    """Get health status of question suggester."""
    if not QUESTION_SUGGESTER_AVAILABLE:
        return jsonify({
            'available': False,
            'error': 'module_not_loaded'
        }), 503
    
    try:
        from components.question_suggester import get_question_suggester
        suggester = get_question_suggester()
        
        return jsonify({
            'available': True,
            'last_analyzed': suggester.last_analyzed.isoformat() if suggester.last_analyzed else None,
            'patterns_loaded': len(suggester.patterns_by_persona),
            'popular_questions': len(suggester.popular_questions),
            'intents_tracked': len(suggester.intent_templates)
        })
    except Exception as e:
        return jsonify({
            'available': False,
            'error': str(e)
        }), 500

@app.route('/prompts/health', methods=['GET'])
def prompt_catalog_health():
    if not _catalog_enabled():
        _log_flow('PROMPT_ENDPOINT', 'catalog_disabled', endpoint='health')
        return jsonify({'error':'catalog_disabled'}), 404
    try:
        health: Dict[str, Any] = catalog_health() if isinstance(catalog_health(), dict) else {}
        dist: Dict[str, int] = {}
        for e in prompt_get_all():
            for p in e.get('personas', []):
                dist[p] = dist.get(p, 0) + 1
        health['persona_distribution'] = dist
        _log_flow('PROMPT_ENDPOINT', 'health_ok', prompt_count=health.get('prompt_count'), active=health.get('active_count'), missing_tool_sets=len(health.get('missing_tools', {})))
        return jsonify({'health': health})
    except Exception as e:
        _log_flow('PROMPT_ENDPOINT', 'health_failed', error=str(e))
        return jsonify({'error':'health_failed','detail': str(e)}), 500

# ---------------- PHASE4 (Optional): Upsert & enable toggle ----------------
try:
    from components.prompt_catalog import CATALOG_PATH, _validate_entry as _catalog_validate  # type: ignore
except Exception:
    CATALOG_PATH = None
    def _catalog_validate(e): return e

def _upsert_allowed() -> bool:
    return os.getenv('PROMPT_CATALOG_ALLOW_UPSERT','0').lower() in ('1','true','yes','on')

@app.route('/prompts/upsert', methods=['POST'])
def prompt_upsert():
    if not (_catalog_enabled() and _upsert_allowed()):
        _log_flow('PROMPT_ENDPOINT', 'upsert_disabled')
        return jsonify({'error':'upsert_disabled'}), 403
    token = _extract_token()
    if not _has_prompt_admin(token):
        _log_flow('PROMPT_ENDPOINT', 'upsert_forbidden', roles=_get_roles_from_token(token))
        return jsonify({'error':'forbidden','detail':'prompt_admin role required'}), 403
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        _log_flow('PROMPT_ENDPOINT', 'invalid_payload_type')
        return jsonify({'error':'invalid_payload'}), 400
    allow_fields = {"id","intent","personas","status","prompt","description","activation_keywords","tool_hints","param_extractors","expected_receipt","enabled","version","metadata","allowed_personas","summary"}
    extraneous = [k for k in data.keys() if k not in allow_fields]
    if extraneous:
        _log_flow('PROMPT_ENDPOINT', 'extraneous_fields', fields=extraneous)
        return jsonify({'error':'extraneous_fields','fields':extraneous}), 400
    for field, max_len in [('prompt',600),('description',400),('expected_receipt',800)]:
        if field in data:
            data[field] = _sanitize_str(data[field], max_len)
    try:
        validated = _catalog_validate(data)
        # If summary missing, generate one
        if not validated.get('summary'):
            intent = validated.get('intent','')
            personas = ', '.join(validated.get('personas', []))
            tools = validated.get('tool_hints', [])
            keywords = validated.get('activation_keywords', [])
            extractors = validated.get('param_extractors', [])
            what = f"Prompt targets intent '{intent}' for personas [{personas}] using keywords {keywords}."
            why_reason = []
            if tools:
                why_reason.append(f"tools {tools} supply structured incident/context data")
            if extractors:
                why_reason.append(f"extractors {extractors} auto-populate arguments")
            why = 'Why: ' + (', '.join(why_reason) if why_reason else 'improves consistency and reduces manual query crafting')
            how_steps = []
            if keywords:
                how_steps.append('keyword match scoring')
            if extractors:
                how_steps.append('regex extraction')
            if tools:
                how_steps.append('sequential tool execution')
            how = 'How: ' + ' -> '.join(how_steps) if how_steps else 'How: direct prompt injection'
            validated['summary'] = f"{what} {why} {how}"
    except Exception as e:
        _log_flow('PROMPT_ENDPOINT', 'validation_failed', error=str(e))
        return jsonify({'error':'validation_failed','detail':str(e)}), 400
    if not CATALOG_PATH:
        _log_flow('PROMPT_ENDPOINT', 'catalog_path_missing')
        return jsonify({'error':'catalog_path_missing'}), 500
    try:
        if os.path.exists(CATALOG_PATH):
            with open(CATALOG_PATH,'r',encoding='utf-8') as f:
                existing = json.load(f)
            if not isinstance(existing, list): existing = []
        else:
            existing = []
        replaced = False
        for i, e in enumerate(existing):
            if e.get('id') == validated.get('id'):
                existing[i] = validated
                replaced = True
                break
        if not replaced:
            existing.append(validated)
        with open(CATALOG_PATH,'w',encoding='utf-8') as f:
            json.dump(existing, f, indent=2, ensure_ascii=False)
        _log_flow('PROMPT_ENDPOINT', 'upsert_ok', id=validated.get('id'), replaced=replaced)
        return jsonify({'status':'ok','action':'replaced' if replaced else 'created','id': validated.get('id')})
    except Exception as e:
        _log_flow('PROMPT_ENDPOINT', 'persist_failed', error=str(e))
        return jsonify({'error':'persist_failed','detail':str(e)}), 500

@app.route('/prompts/<pid>/enable', methods=['PATCH'])
def prompt_enable_toggle(pid):
    if not (_catalog_enabled() and _upsert_allowed()):
        _log_flow('PROMPT_ENDPOINT', 'toggle_disabled', id=pid)
        return jsonify({'error':'toggle_disabled'}), 403
    token = _extract_token()
    if not _has_prompt_admin(token):
        _log_flow('PROMPT_ENDPOINT', 'toggle_forbidden', id=pid, roles=_get_roles_from_token(token))
        return jsonify({'error':'forbidden','detail':'prompt_admin role required'}), 403
    body = request.get_json(silent=True) or {}
    enabled = body.get('enabled')
    if not isinstance(enabled, bool):
        _log_flow('PROMPT_ENDPOINT', 'enabled_boolean_required', id=pid)
        return jsonify({'error':'enabled_boolean_required'}), 400
    if not CATALOG_PATH:
        _log_flow('PROMPT_ENDPOINT', 'catalog_path_missing', id=pid)
        return jsonify({'error':'catalog_path_missing'}), 500
    try:
        with open(CATALOG_PATH,'r',encoding='utf-8') as f:
            existing = json.load(f)
        if not isinstance(existing, list): existing = []
        found = False
        for e in existing:
            if e.get('id') == pid:
                e['enabled'] = enabled
                e.setdefault('metadata', {})
                e['metadata']['toggled_at'] = time.time()
                found = True
                break
        if not found:
            _log_flow('PROMPT_ENDPOINT', 'toggle_not_found', id=pid)
            return jsonify({'error':'not_found','id':pid}), 404
        with open(CATALOG_PATH,'w',encoding='utf-8') as f:
            json.dump(existing, f, indent=2, ensure_ascii=False)
        _log_flow('PROMPT_ENDPOINT', 'toggle_ok', id=pid, enabled=enabled)
        return jsonify({'status':'ok','id':pid,'enabled':enabled})
    except Exception as e:
        _log_flow('PROMPT_ENDPOINT', 'toggle_failed', id=pid, error=str(e))
        return jsonify({'error':'toggle_failed','detail':str(e)}), 500

# Function to dynamically load blueprints
def load_blueprints(app, components_dir="components"):
    components_path = os.path.join(os.path.dirname(__file__), components_dir)
    for filename in os.listdir(components_path):
        if filename.endswith(".py") and filename != "__init__.py":
            module_name = f"{components_dir}.{filename[:-3]}"
            module = importlib.import_module(module_name)
            if hasattr(module, "blueprint"):
                app.register_blueprint(module.blueprint)

# Function to dynamically load middleware
def load_middleware(app, middleware_dir="middleware"):
    middleware_path = os.path.join(os.path.dirname(__file__), middleware_dir)
    if not os.path.isdir(middleware_path):
        # Middleware directory does not exist, skip loading
        return
    for filename in os.listdir(middleware_path):
        if filename.endswith(".py") and filename != "__init__.py":
            module_name = f"{middleware_dir}.{filename[:-3]}"
            module = importlib.import_module(module_name)
            if hasattr(module, "apply_middleware"):
                module.apply_middleware(app)

# Load all components and middleware
load_blueprints(app)
load_middleware(app)

DB_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'state_db.json'))
db = TinyDB(DB_PATH)
interactions = db.table('interactions')

@app.route('/api/ask', methods=['POST'])
def ask():
    start_time = time.time()
    data = request.get_json(silent=True) or {}
    question = data.get('question')
    user_id = data.get('user_id') or data.get('username')  # fall back if only one provided
    session_id = data.get('session_id')
    corr_id = data.get('correlation_id') or os.getenv('REQUEST_ID') or f"ask-{int(start_time*1000)}"

    # Basic validation
    if not question or not str(question).strip():
        return jsonify({
            'error': 'Question is required',
            'correlation_id': corr_id
        }), 400

    # Reuse (or lazily create) a singleton RAG instance to avoid reloading FAISS each request
    global _RAG_SINGLETON
    try:
        _RAG_SINGLETON  # type: ignore # noqa
    except NameError:
        _RAG_SINGLETON = CustomWikiRAG()  # type: ignore

    rag = _RAG_SINGLETON  # type: ignore

    try:
        answer = rag.run_rag(question)
        latency_ms = int((time.time() - start_time) * 1000)
        source = getattr(rag, 'last_source', 'unknown')
        return jsonify({
            'response': answer,
            'context': source,
            'latency_ms': latency_ms,
            'correlation_id': corr_id,
            'user_id': user_id,
            'session_id': session_id
        })
    except Exception as e:  # pragma: no cover
        logging.getLogger(__name__).exception("/api/ask failed")
        return jsonify({
            'error': f'Failed to process ask request: {e}',
            'correlation_id': corr_id
        }), 500

@app.route('/api/interact', methods=['POST'])
def log_interaction():
    data = request.get_json(silent=True) or {}
    data['timestamp'] = datetime.utcnow().isoformat()
    interactions.insert(data)
    return jsonify({'status': 'ok'})

@app.route('/api/analytics/user/<user_id>', methods=['GET'])
def user_analytics(user_id):
    User = Query()
    user_data = interactions.search(User.user_id == user_id)
    return jsonify(user_data)

@app.route('/api/analytics/all', methods=['GET'])
def all_analytics():
    return jsonify(interactions.all())

@app.route('/healthz', methods=['GET'])
def health_check():
    """Simple health check endpoint for backend debugging."""
    return jsonify({"status": "ok", "message": "Backend is running"})

@app.route('/rag/health', methods=['GET'])
def rag_health():
    """Detailed RAG subsystem health diagnostics."""
    global _RAG_SINGLETON
    try:
        _RAG_SINGLETON  # type: ignore # noqa
    except NameError:
        _RAG_SINGLETON = CustomWikiRAG()  # type: ignore
    rag = _RAG_SINGLETON  # type: ignore
    try:
        return jsonify({'status': 'ok', 'rag': rag.rag_status()})
    except Exception as e:
        return jsonify({'status': 'error', 'error': str(e)}), 500


@app.route('/api/integrations/health', methods=['GET'])
def integrations_health():
    """
    Comprehensive health check for all external integrations.
    
    Returns:
        {
            "overall_status": "healthy" | "degraded" | "down",
            "services": {
                "servicenow": {...},
                "wiki": {...},
                "jira": {...}
            },
            "timestamp": float
        }
    """
    try:
        from components.service_health_check import get_all_services_health
        health_data = get_all_services_health()
        
        # Return appropriate HTTP status based on overall health
        status_code = 200
        if health_data["overall_status"] == "degraded":
            status_code = 503  # Service Unavailable
        elif health_data["overall_status"] == "down":
            status_code = 503
            
        return jsonify(health_data), status_code
    except Exception as e:
        logger.error(f"[IntegrationsHealth] Error checking services: {e}")
        return jsonify({
            "overall_status": "down",
            "error": str(e),
            "timestamp": time.time()
        }), 500


@app.route('/api/function_sequence/like', methods=['POST'])
def like_function_sequence():
    """Set like/dislike for a function sequence by its id."""
    data = request.get_json(silent=True) or {}
    seq_id = data.get('id')
    liked = data.get('liked')
    if seq_id is None or liked is None:
        return jsonify({'status': 'error', 'message': 'Missing id or liked'}), 400
    # Update the liked field in state_db.json
    from tinydb import Query
    FunctionSeq = Query()
    updated = interactions.update({'liked': liked}, FunctionSeq.id == seq_id)
    if updated:
        return jsonify({'status': 'ok', 'message': f'Function sequence {seq_id} updated', 'liked': liked})
    else:
        return jsonify({'status': 'error', 'message': 'Function sequence not found'}), 404

def _maybe_enable_debugpy():
    """Enable debugpy attach if requested.
    Two activation mechanisms:
    1. Environment variable BACKEND_DEBUG=1
    2. CLI flag --debug-listen
    This allows launch scripts to opt into an IDE attach workflow.
    """
    try:
        import debugpy  # noqa: F401
    except ImportError:
        print("[debug] debugpy not installed (add to requirements.txt)", file=sys.stderr)
        return
    host = os.getenv("DEBUG_HOST", "0.0.0.0")
    port = int(os.getenv("DEBUG_PORT", "5678"))
    if not getattr(_maybe_enable_debugpy, "_started", False):
        try:
            debugpy.listen((host, port))
            _maybe_enable_debugpy._started = True
            print(f"[debug] debugpy listening on {host}:{port}", file=sys.stderr)
        except Exception as e:
            print(f"[debug] Failed to start debugpy listener: {e}", file=sys.stderr)
    wait_flag = os.getenv("DEBUG_WAIT")
    if wait_flag:
        print("[debug] Waiting for debugger to attach...", file=sys.stderr)
        try:
            debugpy.wait_for_client()
            print("[debug] Debugger attached, continuing.", file=sys.stderr)
        except Exception as e:
            print(f"[debug] wait_for_client failed: {e}", file=sys.stderr)


if __name__ == "__main__":
    # Parse simple CLI flag for debug listen
    enable_listen = False
    if "--debug-listen" in sys.argv or os.getenv("BACKEND_DEBUG") == "1":
        enable_listen = True
    if enable_listen:
        _maybe_enable_debugpy()
    startup_before_run = time.time()
    if os.getenv("SNOWCHAT_DIAG"):
        print(f"[DIAG] Startup: Before app.run at {startup_before_run} (+{startup_before_run-startup_start:.2f}s)", file=sys.stderr)
    
    # Initialize question suggester on startup (loads cache only - analysis done by cron job)
    if QUESTION_SUGGESTER_AVAILABLE and not os.getenv("FLASK_NO_RELOAD") == "1":
        try:
            logger.info("[Startup] Loading question suggestion patterns from cache...")
            stats = initialize_question_suggester()
            if stats.get('cache_loaded'):
                logger.info(f"[Startup] Loaded {stats['patterns_count']} question patterns from cache")
            else:
                logger.warning("[Startup] No question patterns cache found - suggestions unavailable")
        except Exception as e:
            logger.error(f"[Startup] Failed to load question suggestion cache: {e}", exc_info=True)
    
    # Check for --no-reload flag or environment variable
    use_reloader = True
    if "--no-reload" in sys.argv or os.getenv("FLASK_NO_RELOAD") == "1":
        use_reloader = False
        print("[Flask] Reloader disabled", file=sys.stderr)
    
    app.run(debug=True, port=5000, use_reloader=use_reloader)