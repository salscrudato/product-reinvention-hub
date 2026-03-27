import inspect
import logging
import sys
import os

# Configure logging to file and console
log_formatter = logging.Formatter('%(asctime)s %(levelname)s %(name)s: %(message)s')
file_handler = logging.FileHandler('snowchat_backend.log', mode='a', encoding='utf-8')
file_handler.setFormatter(log_formatter)
file_handler.setLevel(logging.INFO)
console_handler = logging.StreamHandler(sys.stdout)
console_handler.setFormatter(log_formatter)
console_handler.setLevel(logging.WARNING)
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
if not logger.hasHandlers():
    logger.addHandler(file_handler)
    logger.addHandler(console_handler)

# Optional Elasticsearch logging
try:
    from .es_logging import install_elasticsearch_logging, search_elastic_logs  # type: ignore
    if os.getenv('ELASTICSEARCH_ENABLE','0').lower() in ('1','true','yes','on'):
        install_elasticsearch_logging()
except Exception as _es_init_err:  # pragma: no cover
    logger.warning(f"[shared_registry] Elasticsearch logging init failed: {_es_init_err}")

# Define a registry to store functions
FUNCTION_REGISTRY = {}

# --- Code Annotation Tool ---
import requests
def code_annotation_tool(question: str):
    """
    Calls the /code_annotation_query endpoint with a @code question and returns the response.
    Args:
        question (str): The user's question, must start with @code
    Returns:
        dict: The response from the code annotation API
    """
    if not question.lower().startswith("@code"):
        question = f"@code {question}"
    try:
        url = "http://localhost:5000/code_annotation_query"
        resp = requests.post(url, json={"question": question}, timeout=30)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        return {"error": f"Failed to call code_annotation_query: {str(e)}"}

FUNCTION_REGISTRY["code_annotation_tool"] = code_annotation_tool

# Register elastic log search tool if available
try:
    if 'search_elastic_logs' in globals():  # added by es_logging import
        FUNCTION_REGISTRY['search_elastic_logs'] = search_elastic_logs  # type: ignore
except Exception:
    pass

# --- Data Mapper Tools (Reuses mapping_agents parsers) ---
try:
    from .lamapperagents.document_processor import DocumentProcessor, process_document
    from typing import Optional
    
    def datamapper_parse_excel(file_path: str, project_id: Optional[str] = None):
        """
        Parse Excel file for Data Mapper (reuses mapping_agents parser).
        Args:
            file_path (str): Path to Excel file (.xlsx, .xls, .csv)
            project_id (str): Optional project identifier
        Returns:
            dict: Parsed Excel summary with sheets, objects, and metrics
        """
        try:
            processor = DocumentProcessor(project_id=project_id)
            result = processor.process_excel(file_path)
            # ExcelSummary has: sheets, objects, metrics, column_samples
            return {
                "status": "success",
                "file_type": "excel",
                "sheets": getattr(result, 'sheets', []),
                "objects_count": len(getattr(result, 'objects', [])),
                "metrics": getattr(result, 'metrics', {})
            }
        except Exception as e:
            return {"status": "error", "message": str(e)}
    
    def datamapper_parse_word(file_path: str, project_id: Optional[str] = None):
        """
        Parse Word document for Data Mapper (reuses mapping_agents parser).
        Args:
            file_path (str): Path to Word document (.docx, .doc)
            project_id (str): Optional project identifier
        Returns:
            dict: Parsed Word summary with fields, paragraphs, and headings
        """
        try:
            processor = DocumentProcessor(project_id=project_id)
            result = processor.process_word(file_path)
            # WordSummary has: fields, paragraphs, headings, stats
            return {
                "status": "success",
                "file_type": "word",
                "fields": len(getattr(result, 'fields', [])),
                "paragraphs": len(getattr(result, 'paragraphs', [])),
                "headings": len(getattr(result, 'headings', [])),
                "stats": getattr(result, 'stats', {})
            }
        except Exception as e:
            return {"status": "error", "message": str(e)}
    
    def datamapper_parse_swagger(file_path: str, project_id: Optional[str] = None):
        """
        Parse Swagger/OpenAPI spec for Data Mapper (reuses mapping_agents parser).
        Args:
            file_path (str): Path to Swagger file (.json, .yaml, .yml)
            project_id (str): Optional project identifier
        Returns:
            dict: Parsed Swagger summary with operations, endpoints, and API info
        """
        try:
            processor = DocumentProcessor(project_id=project_id)
            result = processor.process_swagger(file_path)
            # SwaggerSummary has: operations, total_endpoints, total_operations, api_title, api_version
            return {
                "status": "success",
                "file_type": "swagger",
                "total_endpoints": getattr(result, 'total_endpoints', 0),
                "total_operations": getattr(result, 'total_operations', 0),
                "operations": len(getattr(result, 'operations', [])),
                "api_title": getattr(result, 'api_title', ''),
                "api_version": getattr(result, 'api_version', '')
            }
        except Exception as e:
            return {"status": "error", "message": str(e)}
    
    def datamapper_process_document(file_path: str, project_id: Optional[str] = None):
        """
        Auto-detect and process any supported document type for Data Mapper.
        Args:
            file_path (str): Path to document (Excel, Word, or Swagger)
            project_id (str): Optional project identifier
        Returns:
            dict: Parsed document summary based on detected type
        """
        try:
            result = process_document(file_path, project_id=project_id)
            return {
                "status": "success",
                "file_path": file_path,
                "result": str(result)
            }
        except Exception as e:
            return {"status": "error", "message": str(e)}
    
    # Register Data Mapper tools
    FUNCTION_REGISTRY["datamapper_parse_excel"] = datamapper_parse_excel
    FUNCTION_REGISTRY["datamapper_parse_word"] = datamapper_parse_word
    FUNCTION_REGISTRY["datamapper_parse_swagger"] = datamapper_parse_swagger
    FUNCTION_REGISTRY["datamapper_process_document"] = datamapper_process_document
    
    logger.info("[shared_registry] Data Mapper tools registered successfully")
    
except ImportError as e:
    logger.warning(f"[shared_registry] Data Mapper tools not available: {e}")
except Exception as e:
    logger.error(f"[shared_registry] Error registering Data Mapper tools: {e}")

# Automatically register all functions in this file
current_module = sys.modules[__name__]
for name, obj in inspect.getmembers(current_module):
    if inspect.isfunction(obj) and obj.__module__ == __name__:
        FUNCTION_REGISTRY[name] = obj