"""
Data Mapper API Blueprint
==========================

Flask REST API for Data Mapper Wizard functionality.

Endpoints:
- POST   /api/lamapper/projects/<id>/documents/upload - Upload and process documents
- GET    /api/lamapper/projects/<id>/documents/status - Get processing status
- GET    /api/lamapper/projects/<id>/knowledge-base   - Retrieve knowledge base
- POST   /api/lamapper/projects/<id>/chat             - Agentic chat interface
- GET    /api/lamapper/projects/<id>/documents        - List uploaded documents
- DELETE /api/lamapper/projects/<id>                  - Delete project

Architecture: Reuses mapping_agents parsers via DocumentProcessor wrapper.
"""

import os
import json
import logging
import tempfile
import uuid
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any, Optional
from io import BytesIO

from flask import Blueprint, request, jsonify, current_app
from werkzeug.utils import secure_filename
from werkzeug.datastructures import FileStorage

# Import DocumentProcessor (reuses mapping_agents parsers)
from .lamapperagents.document_processor import DocumentProcessor
from .lamapperagents import DocumentProcessor as DP

# Import mapper agentic orchestrator
try:
    from .lamapperagents.mapper_agentic_orchestrator import MapperAgenticOrchestrator
except ImportError as e:
    logging.warning(f"MapperAgenticOrchestrator not available: {e}")
    MapperAgenticOrchestrator = None

# Import existing SnowChat capabilities
try:
    from .servicenowgenaitool import generate_embeddings
    from .shared_registry import FUNCTION_REGISTRY
except ImportError as e:
    logging.warning(f"Some SnowChat modules not available: {e}")

logger = logging.getLogger(__name__)

# Create Flask Blueprint
lamapper_bp = Blueprint('lamapper', __name__)

# Storage paths
CACHE_DIR = Path(__file__).resolve().parent.parent / "cache" / "lamapper"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

PROJECTS_FILE = CACHE_DIR / "projects.json"
DOCUMENTS_DIR = CACHE_DIR / "documents"
KNOWLEDGE_BASE_DIR = CACHE_DIR / "knowledge_base"

DOCUMENTS_DIR.mkdir(exist_ok=True)
KNOWLEDGE_BASE_DIR.mkdir(exist_ok=True)

# Initialize projects file
if not PROJECTS_FILE.exists():
    PROJECTS_FILE.write_text("[]", encoding="utf-8")

# Allowed file extensions
ALLOWED_EXTENSIONS = {
    'excel': ['xlsx', 'xls', 'csv'],
    'word': ['docx', 'doc'],
    'swagger': ['json', 'yaml', 'yml'],
    'pdf': ['pdf'],
    'image': ['png', 'jpg', 'jpeg', 'gif', 'bmp']
}


# ============================================================================
# Utility Functions
# ============================================================================

def _load_projects() -> List[Dict[str, Any]]:
    """Load projects from JSON file."""
    try:
        return json.loads(PROJECTS_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, FileNotFoundError):
        return []


def _save_projects(projects: List[Dict[str, Any]]) -> None:
    """Save projects to JSON file."""
    PROJECTS_FILE.write_text(json.dumps(projects, indent=2), encoding="utf-8")


def _timestamp() -> str:
    """Generate ISO timestamp."""
    return datetime.utcnow().isoformat() + "Z"


def _get_project(project_id: str) -> Optional[Dict[str, Any]]:
    """Get project by ID."""
    projects = _load_projects()
    for project in projects:
        if project.get('id') == project_id:
            return project
    return None


def _update_project(project_id: str, updates: Dict[str, Any]) -> bool:
    """Update project with new data."""
    projects = _load_projects()
    for i, project in enumerate(projects):
        if project.get('id') == project_id:
            projects[i].update(updates)
            projects[i]['updated_at'] = _timestamp()
            _save_projects(projects)
            return True
    return False


def _allowed_file(filename: str) -> bool:
    """Check if filename has allowed extension."""
    ext = filename.rsplit('.', 1)[1].lower() if '.' in filename else ''
    for file_type, extensions in ALLOWED_EXTENSIONS.items():
        if ext in extensions:
            return True
    return False


def _get_file_type(filename: str) -> str:
    """Determine file type from extension."""
    ext = filename.rsplit('.', 1)[1].lower() if '.' in filename else ''
    for file_type, extensions in ALLOWED_EXTENSIONS.items():
        if ext in extensions:
            return file_type
    return 'unknown'


def _save_uploaded_file(file: FileStorage, project_id: str) -> str:
    """Save uploaded file to disk and return path."""
    if not file.filename:
        raise ValueError("File has no filename")
    
    filename = secure_filename(file.filename)
    
    # Create project-specific directory
    project_dir = DOCUMENTS_DIR / project_id
    project_dir.mkdir(exist_ok=True)
    
    # Generate unique filename to prevent collisions
    unique_filename = f"{uuid.uuid4().hex}_{filename}"
    file_path = project_dir / unique_filename
    
    file.save(str(file_path))
    logger.info(f"Saved file: {file_path}")
    
    return str(file_path)


# ============================================================================
# API Endpoints
# ============================================================================

@lamapper_bp.route('/projects', methods=['POST'])
def create_project():
    """
    Create a new Data Mapper project.
    
    Request Body:
        {
            "project_name": "Insurance Data Mapping",
            "description": "Map policy data to ACORD forms",
            "tags": ["insurance", "acord", "policy"]
        }
    
    Returns:
        {
            "status": "success",
            "project": {
                "id": "uuid",
                "project_name": "...",
                "created_at": "...",
                ...
            }
        }
    """
    try:
        data = request.get_json() or {}
        
        project_id = str(uuid.uuid4())
        project = {
            'id': project_id,
            'project_name': data.get('project_name', f'Project {project_id[:8]}'),
            'description': data.get('description', ''),
            'tags': data.get('tags', []),
            'status': 'created',
            'created_at': _timestamp(),
            'updated_at': _timestamp(),
            'documents': [],
            'processing_status': {
                'stage': 'idle',
                'progress': 0,
                'message': 'Project created'
            },
            'knowledge_base': {
                'total_chunks': 0,
                'indexed': False
            }
        }
        
        projects = _load_projects()
        projects.append(project)
        _save_projects(projects)
        
        logger.info(f"Created project: {project_id}")
        
        return jsonify({
            'status': 'success',
            'project': project
        }), 201
        
    except Exception as e:
        logger.error(f"Error creating project: {e}")
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500


@lamapper_bp.route('/projects/<project_id>/documents/upload', methods=['POST'])
def upload_documents(project_id: str):
    """
    Upload and process documents for a project.
    
    Multipart Form Data:
        files: Multiple file uploads (Excel, Word, Swagger, PDF, Images)
    
    Returns:
        {
            "status": "success",
            "project_id": "...",
            "uploaded": 3,
            "results": [
                {
                    "filename": "data_dict.xlsx",
                    "file_type": "excel",
                    "file_size": 125000,
                    "processing_status": "completed",
                    "summary": {
                        "sheets": 3,
                        "fields": 150,
                        "tables": 5
                    }
                },
                ...
            ]
        }
    """
    try:
        # Get project
        project = _get_project(project_id)
        if not project:
            return jsonify({
                'status': 'error',
                'message': f'Project not found: {project_id}'
            }), 404
        
        # Get uploaded files
        files = request.files.getlist('files')
        if not files:
            return jsonify({
                'status': 'error',
                'message': 'No files provided'
            }), 400
        
        processor = DocumentProcessor(project_id=project_id)
        results = []
        
        # Update project status
        _update_project(project_id, {
            'status': 'processing',
            'processing_status': {
                'stage': 'upload',
                'progress': 0,
                'message': f'Uploading {len(files)} files...'
            }
        })
        
        for i, file in enumerate(files):
            if not file.filename:
                continue
            
            if not _allowed_file(file.filename):
                results.append({
                    'filename': file.filename,
                    'status': 'error',
                    'message': 'File type not allowed'
                })
                continue
            
            try:
                # Save file
                file_path = _save_uploaded_file(file, project_id)
                file_type = _get_file_type(file.filename)
                file_size = os.path.getsize(file_path)
                
                # Initialize result
                result = {
                    'filename': file.filename,
                    'file_type': file_type,
                    'file_size': file_size,
                    'file_path': file_path,
                    'processing_status': 'pending'
                }
                
                # Process file based on type (reuse mapping_agents parsers!)
                if file_type in ['excel', 'word', 'swagger']:
                    try:
                        # Update progress
                        progress = int((i + 0.5) / len(files) * 100)
                        _update_project(project_id, {
                            'processing_status': {
                                'stage': 'parsing',
                                'progress': progress,
                                'message': f'Processing {file.filename}...'
                            }
                        })
                        
                        # Process with DocumentProcessor (delegates to mapping_agents)
                        summary = processor.process_document(file_path)
                        
                        # Extract summary based on type (using correct dataclass attributes)
                        if file_type == 'excel':
                            # ExcelSummary: sheets, objects, metrics, column_samples
                            result['summary'] = {
                                'sheets': len(getattr(summary, 'sheets', [])),
                                'objects': len(getattr(summary, 'objects', [])),
                                'metrics': getattr(summary, 'metrics', {})
                            }
                        elif file_type == 'word':
                            # WordSummary: fields, paragraphs, headings, stats
                            result['summary'] = {
                                'fields': len(getattr(summary, 'fields', [])),
                                'paragraphs': len(getattr(summary, 'paragraphs', [])),
                                'headings': len(getattr(summary, 'headings', [])),
                                'stats': getattr(summary, 'stats', {})
                            }
                        elif file_type == 'swagger':
                            # SwaggerSummary: operations, total_endpoints, total_operations
                            result['summary'] = {
                                'total_endpoints': getattr(summary, 'total_endpoints', 0),
                                'total_operations': getattr(summary, 'total_operations', 0),
                                'operations': len(getattr(summary, 'operations', [])),
                                'api_title': getattr(summary, 'api_title', ''),
                                'api_version': getattr(summary, 'api_version', '')
                            }
                        
                        result['processing_status'] = 'completed'
                        
                    except Exception as parse_error:
                        logger.error(f"Parsing error for {file.filename}: {parse_error}")
                        result['processing_status'] = 'error'
                        result['error'] = str(parse_error)
                else:
                    # For PDF/images, mark as uploaded (processing later with OCR)
                    result['processing_status'] = 'uploaded'
                    result['message'] = 'File uploaded, OCR processing pending'
                
                results.append(result)
                
                # Update project documents
                project['documents'].append(result)
                
            except Exception as file_error:
                logger.error(f"Error processing {file.filename}: {file_error}")
                results.append({
                    'filename': file.filename,
                    'status': 'error',
                    'message': str(file_error)
                })
        
        # Update final project status
        completed = sum(1 for r in results if r.get('processing_status') == 'completed')
        _update_project(project_id, {
            'status': 'processed',
            'documents': results,
            'processing_status': {
                'stage': 'completed',
                'progress': 100,
                'message': f'Processed {completed}/{len(results)} files successfully'
            }
        })
        
        return jsonify({
            'status': 'success',
            'project_id': project_id,
            'uploaded': len(results),
            'results': results
        }), 200
        
    except Exception as e:
        logger.error(f"Error uploading documents: {e}")
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500


@lamapper_bp.route('/projects/<project_id>/documents/status', methods=['GET'])
def get_processing_status(project_id: str):
    """
    Get processing status for a project.
    
    Returns:
        {
            "status": "success",
            "project_id": "...",
            "processing_status": {
                "stage": "parsing",
                "progress": 45,
                "message": "Processing file 2 of 4..."
            }
        }
    """
    try:
        project = _get_project(project_id)
        if not project:
            return jsonify({
                'status': 'error',
                'message': f'Project not found: {project_id}'
            }), 404
        
        return jsonify({
            'status': 'success',
            'project_id': project_id,
            'processing_status': project.get('processing_status', {}),
            'documents_count': len(project.get('documents', []))
        }), 200
        
    except Exception as e:
        logger.error(f"Error getting status: {e}")
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500


@lamapper_bp.route('/projects/<project_id>/knowledge-base', methods=['GET'])
def get_knowledge_base(project_id: str):
    """
    Get knowledge base for a project.
    
    Query Parameters:
        search: Optional search query
        chunk_type: Filter by chunk type (text, table, image, code)
        limit: Max chunks to return (default 50)
    
    Returns:
        {
            "status": "success",
            "project_id": "...",
            "knowledge_base": {
                "total_chunks": 150,
                "chunks": [
                    {
                        "chunk_id": "abc123",
                        "type": "text",
                        "content": "...",
                        "source": "data_dict.xlsx",
                        "metadata": {...}
                    },
                    ...
                ]
            }
        }
    """
    try:
        project = _get_project(project_id)
        if not project:
            return jsonify({
                'status': 'error',
                'message': f'Project not found: {project_id}'
            }), 404
        
        # Query parameters
        search_query = request.args.get('search', '')
        chunk_type = request.args.get('chunk_type', 'all')
        limit = int(request.args.get('limit', 50))
        
        # TODO: Implement actual knowledge base retrieval with FAISS
        # For now, generate mock chunks from processed documents
        chunks = []
        for doc in project.get('documents', []):
            if doc.get('processing_status') == 'completed':
                # Mock chunk generation
                chunks.append({
                    'chunk_id': str(uuid.uuid4()),
                    'type': 'text',
                    'content': f"Content from {doc.get('filename')}",
                    'source': doc.get('filename'),
                    'metadata': {
                        'file_type': doc.get('file_type'),
                        'tokens': 250
                    }
                })
        
        return jsonify({
            'status': 'success',
            'project_id': project_id,
            'knowledge_base': {
                'total_chunks': len(chunks),
                'chunks': chunks[:limit]
            }
        }), 200
        
    except Exception as e:
        logger.error(f"Error getting knowledge base: {e}")
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500


@lamapper_bp.route('/projects/<project_id>/chat', methods=['POST'])
def agentic_chat(project_id: str):
    """
    Agentic chat interface with annotation support.
    
    Request Body:
        {
            "message": "What fields are in the data dictionary?",
            "annotations": ["@datamapper"],
            "settings": {
                "enable_planning": true,
                "show_citations": true,
                "stream_response": false
            }
        }
    
    Returns:
        {
            "status": "success",
            "response": {
                "message": "...",
                "sources": [...],
                "execution_plan": {...}
            }
        }
    """
    try:
        project = _get_project(project_id)
        if not project:
            return jsonify({
                'status': 'error',
                'message': f'Project not found: {project_id}'
            }), 404
        
        data = request.get_json() or {}
        message = data.get('message', '')
        annotations = data.get('annotations', [])
        settings = data.get('settings', {})
        
        if not message:
            return jsonify({
                'status': 'error',
                'message': 'Message is required'
            }), 400
        
        # TODO: Implement actual agentic orchestration with LangGraph
        # For now, return mock response
        response = {
            'message': f"I've analyzed your query: '{message}'. " +
                      f"Annotations detected: {', '.join(annotations) if annotations else 'none'}. " +
                      f"Based on the {len(project.get('documents', []))} documents in this project, " +
                      "I can help you with data mapping tasks.",
            'sources': [
                {
                    'document': doc.get('filename'),
                    'confidence': 0.85,
                    'preview': f"Content from {doc.get('filename')}"
                }
                for doc in project.get('documents', [])[:3]
            ]
        }
        
        if settings.get('enable_planning'):
            response['execution_plan'] = {
                'steps': [
                    {'tool': 'datamapper_search', 'status': 'completed'},
                    {'tool': 'synthesize_response', 'status': 'completed'}
                ]
            }
        
        return jsonify({
            'status': 'success',
            'response': response
        }), 200
        
    except Exception as e:
        logger.error(f"Error in agentic chat: {e}")
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500


@lamapper_bp.route('/projects/<project_id>/extract-entities', methods=['POST'])
def extract_entities(project_id: str):
    """
    Extract entity mappings from natural language question using agentic orchestration.
    
    This endpoint uses the hybrid orchestrator with 3 execution paths:
    - Simple queries → Recipes (0 LLM calls, instant)
    - Entity extraction → CrewAI (2-3 LLM calls)
    - Iterative refinement → LangGraph (future)
    
    Request Body:
        {
            "question": "I need customer name and address",
            "context": {
                "previous_entities": ["policy_number"],
                "conversation_id": "conv_123"
            },
            "settings": {
                "enable_streaming": true,
                "enable_recipes": true,
                "enable_crewai": true,
                "verbose": true
            }
        }
    
    Returns:
        {
            "status": "success",
            "result": {
                "entities": [
                    {
                        "entity_name": "customer name",
                        "business_definition": "Legal name of the customer as appears on official documents",
                        "tables": ["customer_master"],
                        "columns": ["first_name", "last_name"],
                        "population_logic": "CONCAT(first_name, ' ', last_name)",
                        "conditions": ["WHERE status='ACTIVE'"],
                        "test_data": [{"value": "John Doe", "row_id": 1001}],
                        "status": "approved",
                        "confidence": 0.95,
                        "sources": ["requirements_v2.3.docx", "data_dictionary.xlsx"],
                        "agent_contributions": {
                            "Business Analyst": ["business_definition"],
                            "Data Consultant": ["tables", "columns", "population_logic"],
                            "Tester": ["test_data"]
                        }
                    }
                ],
                "execution_summary": {
                    "routing_decision": "crewai",
                    "intent": "entity_extraction",
                    "llm_calls": 3,
                    "execution_time_seconds": 12.5,
                    "cost_estimate": 0.08
                },
                "traces": [
                    {
                        "timestamp": "2025-01-13T10:15:30Z",
                        "phase": "CLASSIFY",
                        "message": "Intent classified as entity_extraction"
                    }
                ],
                "events": [
                    {
                        "type": "mapper.entity.discovered",
                        "entity_name": "customer name",
                        "timestamp": "2025-01-13T10:15:32Z"
                    }
                ]
            }
        }
    
    Error Response:
        {
            "status": "error",
            "message": "Orchestrator not initialized",
            "error_code": "ORCHESTRATOR_UNAVAILABLE"
        }
    """
    try:
        # Check if orchestrator is available
        if MapperAgenticOrchestrator is None:
            return jsonify({
                'status': 'error',
                'message': 'Mapper orchestrator not available. Please check backend installation.',
                'error_code': 'ORCHESTRATOR_UNAVAILABLE'
            }), 503
        
        # Get project
        project = _get_project(project_id)
        if not project:
            return jsonify({
                'status': 'error',
                'message': f'Project not found: {project_id}',
                'error_code': 'PROJECT_NOT_FOUND'
            }), 404
        
        # Parse request
        data = request.get_json() or {}
        question = data.get('question', '').strip()
        context = data.get('context', {})
        settings = data.get('settings', {})
        
        if not question:
            return jsonify({
                'status': 'error',
                'message': 'Question is required',
                'error_code': 'MISSING_QUESTION'
            }), 400
        
        logger.info(f"[LAMAPPER_API] Extracting entities for project {project_id}")
        logger.info(f"[LAMAPPER_API] Question: {question[:100]}")
        
        # Add project context
        context['project_id'] = project_id
        context['project_name'] = project.get('project_name')
        context['documents'] = project.get('documents', [])
        
        # Metadata for orchestrator
        metadata = {
            'username': request.headers.get('X-User-Email', 'anonymous'),
            'session_id': context.get('conversation_id', str(uuid.uuid4())),
            'enable_recipes': settings.get('enable_recipes', True),
            'enable_crewai': settings.get('enable_crewai', True),
            'enable_langgraph': settings.get('enable_langgraph', False),
            'enable_streaming': settings.get('enable_streaming', False),
            'verbose': settings.get('verbose', False)
        }
        
        # Initialize orchestrator
        orchestrator = MapperAgenticOrchestrator(
            verbose=metadata['verbose']
        )
        
        # Execute orchestration
        result = orchestrator.solve(
            question=question,
            context=context,
            metadata=metadata
        )
        
        # Update project with extracted entities
        existing_entities = project.get('entities', [])
        new_entities = result.get('entities', [])
        
        # Merge entities (avoid duplicates)
        entity_names = {e.get('entity_name') for e in existing_entities}
        for entity in new_entities:
            if entity.get('entity_name') not in entity_names:
                existing_entities.append(entity)
        
        _update_project(project_id, {
            'entities': existing_entities,
            'last_query': question,
            'last_query_time': _timestamp()
        })
        
        logger.info(f"[LAMAPPER_API] Extracted {len(new_entities)} entities")
        
        return jsonify({
            'status': 'success',
            'result': result
        }), 200
        
    except ValueError as ve:
        logger.error(f"[LAMAPPER_API] Validation error: {ve}")
        return jsonify({
            'status': 'error',
            'message': str(ve),
            'error_code': 'VALIDATION_ERROR'
        }), 400
        
    except Exception as e:
        logger.error(f"[LAMAPPER_API] Error extracting entities: {e}", exc_info=True)
        return jsonify({
            'status': 'error',
            'message': f'Internal error: {str(e)}',
            'error_code': 'INTERNAL_ERROR'
        }), 500


@lamapper_bp.route('/projects/<project_id>/entities', methods=['GET'])
def get_entities(project_id: str):
    """
    Get all extracted entities for a project.
    
    Query Parameters:
        status: Filter by status (approved, needs_review, pending)
        confidence_threshold: Minimum confidence score (0.0-1.0)
        limit: Max entities to return
    
    Returns:
        {
            "status": "success",
            "project_id": "...",
            "entities": [...],
            "summary": {
                "total": 25,
                "approved": 20,
                "needs_review": 5,
                "avg_confidence": 0.87
            }
        }
    """
    try:
        project = _get_project(project_id)
        if not project:
            return jsonify({
                'status': 'error',
                'message': f'Project not found: {project_id}'
            }), 404
        
        # Query parameters
        status_filter = request.args.get('status')
        confidence_threshold = float(request.args.get('confidence_threshold', 0.0))
        limit = int(request.args.get('limit', 100))
        
        entities = project.get('entities', [])
        
        # Apply filters
        if status_filter:
            entities = [e for e in entities if e.get('status') == status_filter]
        
        if confidence_threshold > 0.0:
            entities = [e for e in entities if e.get('confidence', 0.0) >= confidence_threshold]
        
        # Calculate summary
        all_entities = project.get('entities', [])
        summary = {
            'total': len(all_entities),
            'approved': len([e for e in all_entities if e.get('status') == 'approved']),
            'needs_review': len([e for e in all_entities if e.get('status') == 'needs_review']),
            'pending': len([e for e in all_entities if e.get('status') == 'pending']),
            'avg_confidence': sum(e.get('confidence', 0.0) for e in all_entities) / len(all_entities) if all_entities else 0.0
        }
        
        return jsonify({
            'status': 'success',
            'project_id': project_id,
            'entities': entities[:limit],
            'summary': summary
        }), 200
        
    except Exception as e:
        logger.error(f"Error getting entities: {e}")
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500


@lamapper_bp.route('/projects/<project_id>/entities/<entity_name>', methods=['PATCH'])
def update_entity(project_id: str, entity_name: str):
    """
    Update an entity (e.g., approve, refine, add test data).
    
    Request Body:
        {
            "status": "approved",
            "business_definition": "Updated definition...",
            "population_logic": "Updated logic...",
            "test_data": [...]
        }
    
    Returns:
        {
            "status": "success",
            "entity": {...}
        }
    """
    try:
        project = _get_project(project_id)
        if not project:
            return jsonify({
                'status': 'error',
                'message': f'Project not found: {project_id}'
            }), 404
        
        entities = project.get('entities', [])
        entity_found = False
        
        updates = request.get_json() or {}
        
        for i, entity in enumerate(entities):
            if entity.get('entity_name') == entity_name:
                # Update entity
                entities[i].update(updates)
                entities[i]['updated_at'] = _timestamp()
                entity_found = True
                break
        
        if not entity_found:
            return jsonify({
                'status': 'error',
                'message': f'Entity not found: {entity_name}'
            }), 404
        
        _update_project(project_id, {'entities': entities})
        
        return jsonify({
            'status': 'success',
            'entity': entities[i]
        }), 200
        
    except Exception as e:
        logger.error(f"Error updating entity: {e}")
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500


@lamapper_bp.route('/projects/<project_id>/entities/export', methods=['GET'])
def export_training_data(project_id: str):
    """
    Export approved entities as ML training data.
    
    Query Parameters:
        format: json | csv | jsonl (default: json)
        status_filter: Only export entities with this status (default: approved)
    
    Returns:
        Training data in requested format
    """
    try:
        project = _get_project(project_id)
        if not project:
            return jsonify({
                'status': 'error',
                'message': f'Project not found: {project_id}'
            }), 404
        
        # Query parameters
        export_format = request.args.get('format', 'json')
        status_filter = request.args.get('status_filter', 'approved')
        
        entities = project.get('entities', [])
        
        # Filter by status
        if status_filter:
            entities = [e for e in entities if e.get('status') == status_filter]
        
        if export_format == 'json':
            return jsonify({
                'status': 'success',
                'format': 'json',
                'count': len(entities),
                'training_data': entities
            }), 200
            
        elif export_format == 'jsonl':
            # JSONL format (one entity per line)
            lines = [json.dumps(entity) for entity in entities]
            return '\n'.join(lines), 200, {'Content-Type': 'application/x-jsonlines'}
            
        elif export_format == 'csv':
            # CSV format (flattened)
            import csv
            from io import StringIO
            
            output = StringIO()
            if entities:
                fieldnames = ['entity_name', 'business_definition', 'tables', 'columns', 
                             'population_logic', 'conditions', 'status', 'confidence']
                writer = csv.DictWriter(output, fieldnames=fieldnames)
                writer.writeheader()
                
                for entity in entities:
                    row = {
                        'entity_name': entity.get('entity_name', ''),
                        'business_definition': entity.get('business_definition', ''),
                        'tables': '|'.join(entity.get('tables', [])),
                        'columns': '|'.join(entity.get('columns', [])),
                        'population_logic': entity.get('population_logic', ''),
                        'conditions': '|'.join(entity.get('conditions', [])),
                        'status': entity.get('status', ''),
                        'confidence': entity.get('confidence', 0.0)
                    }
                    writer.writerow(row)
            
            output.seek(0)
            return output.getvalue(), 200, {'Content-Type': 'text/csv'}
        
        else:
            return jsonify({
                'status': 'error',
                'message': f'Unsupported format: {export_format}'
            }), 400
        
    except Exception as e:
        logger.error(f"Error exporting training data: {e}")
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500


@lamapper_bp.route('/projects/<project_id>', methods=['DELETE'])
def delete_project(project_id: str):
    """Delete a project and its associated files."""
    try:
        projects = _load_projects()
        project = _get_project(project_id)
        
        if not project:
            return jsonify({
                'status': 'error',
                'message': f'Project not found: {project_id}'
            }), 404
        
        # Remove project from list
        projects = [p for p in projects if p.get('id') != project_id]
        _save_projects(projects)
        
        # Delete project files
        project_dir = DOCUMENTS_DIR / project_id
        if project_dir.exists():
            import shutil
            shutil.rmtree(project_dir)
        
        logger.info(f"Deleted project: {project_id}")
        
        return jsonify({
            'status': 'success',
            'message': f'Project {project_id} deleted'
        }), 200
        
    except Exception as e:
        logger.error(f"Error deleting project: {e}")
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500


@lamapper_bp.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint."""
    return jsonify({
        'status': 'healthy',
        'service': 'lamapper',
        'timestamp': _timestamp()
    }), 200


# Blueprint registration will be done in app.py
logger.info("Data Mapper API blueprint initialized")
