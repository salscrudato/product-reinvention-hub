"""VFS Tool Registration

Registers Virtual File System tools in the shared function registry
so they can be called during orchestration workflows.

Tools:
- vfs_write(path, content) - Write file to VFS
- vfs_read(path) - Read file from VFS
- vfs_list(directory) - List files in directory
- vfs_stats() - Get VFS statistics
"""

import logging
from typing import Dict, Any, List, Optional

logger = logging.getLogger("agentic_orchestrator_auto.vfs_tools")

# Import VFS
try:
    from .virtual_file_system import get_vfs
    VFS_AVAILABLE = True
except ImportError:
    logger.warning("VFS not available - tools will be no-ops")
    VFS_AVAILABLE = False


def vfs_write_tool(path: str, content: str, session_id: str = "default") -> Dict[str, Any]:
    """Write content to Virtual File System.
    
    Args:
        path: Virtual file path (must start with /)
        content: File content as string
        session_id: VFS session identifier
    
    Returns:
        Dict with status and metadata
    
    Example:
        vfs_write_tool("/investigation/INC001/logs.json", log_data)
    """
    try:
        if not VFS_AVAILABLE:
            return {"status": "unavailable", "message": "VFS not available"}
        
        vfs = get_vfs(session_id)
        result = vfs.write(path, content)
        
        logger.info(
            "FLOW[VFS_WRITE_TOOL] File written | %s",
            {"path": path, "size_bytes": result.get("size_bytes")}
        )
        
        return result
    
    except Exception as e:
        logger.error("FLOW[VFS_WRITE_TOOL_ERROR] %s", {"path": path, "error": str(e)})
        return {"status": "error", "message": str(e)}


def vfs_read_tool(path: str, session_id: str = "default") -> Optional[str]:
    """Read content from Virtual File System.
    
    Args:
        path: Virtual file path
        session_id: VFS session identifier
    
    Returns:
        File content as string, or None if not found
    
    Example:
        logs = vfs_read_tool("/investigation/INC001/logs.json")
    """
    try:
        if not VFS_AVAILABLE:
            return None
        
        vfs = get_vfs(session_id)
        content = vfs.read(path)
        
        if content:
            logger.info(
                "FLOW[VFS_READ_TOOL] File read | %s",
                {"path": path, "size": len(content)}
            )
        
        return content
    
    except Exception as e:
        logger.error("FLOW[VFS_READ_TOOL_ERROR] %s", {"path": path, "error": str(e)})
        return None


def vfs_list_tool(directory: str, session_id: str = "default") -> List[str]:
    """List files in VFS directory.
    
    Args:
        directory: Directory path (will auto-append / if needed)
        session_id: VFS session identifier
    
    Returns:
        List of file paths in directory
    
    Example:
        files = vfs_list_tool("/investigation/INC001/")
    """
    try:
        if not VFS_AVAILABLE:
            return []
        
        vfs = get_vfs(session_id)
        files = vfs.list_dir(directory)
        
        logger.info(
            "FLOW[VFS_LIST_TOOL] Directory listed | %s",
            {"directory": directory, "count": len(files)}
        )
        
        return files
    
    except Exception as e:
        logger.error("FLOW[VFS_LIST_TOOL_ERROR] %s", {"directory": directory, "error": str(e)})
        return []


def vfs_stats_tool(session_id: str = "default") -> Dict[str, Any]:
    """Get VFS statistics.
    
    Args:
        session_id: VFS session identifier
    
    Returns:
        Dict with VFS metrics
    
    Example:
        stats = vfs_stats_tool()
        print(f"VFS using {stats['total_mb']}MB")
    """
    try:
        if not VFS_AVAILABLE:
            return {"status": "unavailable"}
        
        vfs = get_vfs(session_id)
        stats = vfs.get_stats()
        
        logger.info("FLOW[VFS_STATS_TOOL] Stats retrieved | %s", stats)
        
        return stats
    
    except Exception as e:
        logger.error("FLOW[VFS_STATS_TOOL_ERROR] %s", {"error": str(e)})
        return {"error": str(e)}


# Register tools in shared registry
try:
    from .snowaaonetool import register_tool_function
    
    register_tool_function("vfs_write")(vfs_write_tool)
    register_tool_function("vfs_read")(vfs_read_tool)
    register_tool_function("vfs_list")(vfs_list_tool)
    register_tool_function("vfs_stats")(vfs_stats_tool)
    
    logger.info("FLOW[VFS_TOOLS_REGISTERED] VFS tools registered in function registry")

except ImportError as e:
    logger.warning("Could not register VFS tools - registry not available: %s", e)
