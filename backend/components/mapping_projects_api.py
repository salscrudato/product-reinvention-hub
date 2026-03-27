"""
Mapping Projects API
Handles persisting completed mapping projects to TinyDB for dashboard display
"""
from flask import Blueprint, request, jsonify
from tinydb import TinyDB, Query
from datetime import datetime
import os
from pathlib import Path

mapping_projects_bp = Blueprint('mapping_projects', __name__)

# TinyDB setup
DB_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'state_db.json'))
db = TinyDB(DB_PATH)
mapping_projects_table = db.table('mapping_projects')

def _timestamp():
    return datetime.utcnow().isoformat() + 'Z'


@mapping_projects_bp.route('/api/mapping-projects', methods=['GET'])
def list_mapping_projects():
    """
    Get all saved mapping projects
    Returns projects sorted by creation date (newest first)
    """
    import logging
    logger = logging.getLogger("agentic_orchestrator_auto")
    
    try:
        logger.info("[MappingProjects] GET /api/mapping-projects - Listing all projects")
        projects = mapping_projects_table.all()
        logger.info(f"[MappingProjects] Found {len(projects)} projects in database")
        
        # Sort by created_at descending
        projects.sort(key=lambda x: x.get('created_at', ''), reverse=True)
        
        if projects:
            logger.info(f"[MappingProjects] Project list: {[p.get('project_name') for p in projects]}")
        
        return jsonify({
            'status': 'success',
            'data': projects,
            'count': len(projects),
            'timestamp': _timestamp()
        }), 200
    except Exception as e:
        logger.error(f"[MappingProjects] Error retrieving projects: {str(e)}")
        return jsonify({
            'status': 'error',
            'message': f'Failed to retrieve projects: {str(e)}'
        }), 500


@mapping_projects_bp.route('/api/mapping-projects', methods=['POST'])
def save_mapping_project():
    """
    Save a completed mapping project
    """
    import logging
    logger = logging.getLogger("agentic_orchestrator_auto")
    
    try:
        payload = request.get_json()
        logger.info("[MappingProjects] POST /api/mapping-projects - Received save request")
        
        if not payload:
            logger.error("[MappingProjects] No data provided in request")
            return jsonify({
                'status': 'error',
                'message': 'No data provided'
            }), 400
        
        # Required fields
        project_name = payload.get('project_name', '').strip()
        if not project_name:
            logger.error("[MappingProjects] Missing required field: project_name")
            return jsonify({
                'status': 'error',
                'message': 'project_name is required'
            }), 400
        
        logger.info(f"[MappingProjects] Saving project: {project_name}")
        
        # Extract mapping information
        mappings = payload.get('mappings', [])
        synthesis_metadata = payload.get('synthesis_metadata', {})
        
        logger.info(f"[MappingProjects] Mappings count: {len(mappings)}")
        logger.info(f"[MappingProjects] Synthesis metadata: {synthesis_metadata}")
        
        # Calculate stats
        total_mappings = len(mappings)
        approved_mappings = len([m for m in mappings if m.get('approved', False)])
        mapped_fields = synthesis_metadata.get('mapped_targets', total_mappings)
        unmapped_fields = synthesis_metadata.get('unmapped_targets', 0)
        average_confidence = synthesis_metadata.get('average_confidence', 0)
        
        # Create project record
        project = {
            'id': f"map-{_timestamp().replace(':', '-').replace('.', '-')}",
            'project_name': project_name,
            'domain': payload.get('domain', 'general'),
            'source_type': payload.get('source_type', 'unknown'),
            'target_type': payload.get('target_type', 'unknown'),
            'mapping_type_id': payload.get('mapping_type_id'),
            'source_file_name': payload.get('source_file_name'),
            'target_file_name': payload.get('target_file_name'),
            'context': payload.get('context', {}),
            'mappings': mappings,
            'synthesis_metadata': synthesis_metadata,
            'stats': {
                'total_mappings': total_mappings,
                'approved_mappings': approved_mappings,
                'mapped_fields': mapped_fields,
                'unmapped_fields': unmapped_fields,
                'average_confidence': average_confidence,
            },
            'created_at': _timestamp(),
            'updated_at': _timestamp(),
            'created_by': payload.get('created_by', 'system'),
            'status': 'completed'
        }
        
        logger.info(f"[MappingProjects] Project record created with ID: {project['id']}")
        logger.info(f"[MappingProjects] Stats - Total: {total_mappings}, Approved: {approved_mappings}, Mapped: {mapped_fields}")
        
        # Save to TinyDB
        doc_id = mapping_projects_table.insert(project)
        project['doc_id'] = doc_id
        
        logger.info(f"[MappingProjects] Successfully saved to TinyDB with doc_id: {doc_id}")
        logger.info(f"[MappingProjects] Total projects in DB: {len(mapping_projects_table.all())}")
        
        return jsonify({
            'status': 'success',
            'message': 'Mapping project saved successfully',
            'data': project
        }), 201
        
    except Exception as e:
        import traceback
        logger.error(f"[MappingProjects] Error saving project: {str(e)}")
        logger.error(traceback.format_exc())
        traceback.print_exc()
        return jsonify({
            'status': 'error',
            'message': f'Failed to save project: {str(e)}'
        }), 500


@mapping_projects_bp.route('/api/mapping-projects/<project_id>', methods=['GET'])
def get_mapping_project(project_id):
    """Get a specific mapping project by ID"""
    try:
        Project = Query()
        project = mapping_projects_table.get(Project.id == project_id)
        
        if not project:
            return jsonify({
                'status': 'error',
                'message': f'Project {project_id} not found'
            }), 404
        
        return jsonify({
            'status': 'success',
            'data': project
        }), 200
        
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': f'Failed to retrieve project: {str(e)}'
        }), 500


@mapping_projects_bp.route('/api/mapping-projects/<project_id>', methods=['DELETE'])
def delete_mapping_project(project_id):
    """Delete a mapping project"""
    try:
        Project = Query()
        projects = mapping_projects_table.remove(Project.id == project_id)
        
        if not projects:
            return jsonify({
                'status': 'error',
                'message': f'Project {project_id} not found'
            }), 404
        
        return jsonify({
            'status': 'success',
            'message': 'Project deleted successfully'
        }), 200
        
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': f'Failed to delete project: {str(e)}'
        }), 500


@mapping_projects_bp.route('/api/mapping-projects/stats', methods=['GET'])
def get_mapping_stats():
    """Get aggregate statistics across all mapping projects"""
    try:
        projects = mapping_projects_table.all()
        
        total_projects = len(projects)
        total_mappings = sum(p.get('stats', {}).get('total_mappings', 0) for p in projects)
        total_approved = sum(p.get('stats', {}).get('approved_mappings', 0) for p in projects)
        
        # Group by domain
        by_domain = {}
        for project in projects:
            domain = project.get('domain', 'general')
            if domain not in by_domain:
                by_domain[domain] = 0
            by_domain[domain] += 1
        
        # Group by mapping type
        by_type = {}
        for project in projects:
            mapping_type = project.get('mapping_type_id', 'unknown')
            if mapping_type not in by_type:
                by_type[mapping_type] = 0
            by_type[mapping_type] += 1
        
        return jsonify({
            'status': 'success',
            'data': {
                'total_projects': total_projects,
                'total_mappings': total_mappings,
                'total_approved': total_approved,
                'by_domain': by_domain,
                'by_mapping_type': by_type
            },
            'timestamp': _timestamp()
        }), 200
        
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': f'Failed to retrieve stats: {str(e)}'
        }), 500
